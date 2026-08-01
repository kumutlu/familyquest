import { useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { updateFamilySettings, updateParentDailyCheckinPreference } from '../../lib/api';
import { resolvedDailyCheckinSettings, resolvedParentParticipation } from '../../lib/dailyCheckins';
import { isOwnerRole, isParentRole } from '../../lib/roles';
import { useStore } from '../../store/useStore';
import { Card, CardContent } from '../ui/Card';

interface SettingsToggleProps {
  checked: boolean;
  description: string;
  disabled: boolean;
  error: string | null;
  label: string;
  onClick: () => void;
}

function SettingsToggle({ checked, description, disabled, error, label, onClick }: SettingsToggleProps) {
  return (
    <div className="py-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-gray-900">{label}</p>
          <p className="mt-1 text-sm text-gray-500">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          {disabled && <Loader2 className="h-4 w-4 animate-spin text-primary-500" aria-hidden="true" />}
          <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:opacity-50 ${
              checked ? 'bg-primary-500' : 'bg-gray-300'
            }`}
          >
            <span
              aria-hidden="true"
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                checked ? 'translate-x-5' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
    </div>
  );
}

type ToggleKey = 'children' | 'parent' | 'history';
type FamilyCheckinSettings = ReturnType<typeof resolvedDailyCheckinSettings>;

const emptyToggleState = (): Record<ToggleKey, boolean> => ({
  children: false,
  parent: false,
  history: false,
});

const emptyErrorState = (): Record<ToggleKey, string | null> => ({
  children: null,
  parent: null,
  history: null,
});

export function DailyCheckinSettings() {
  const { t } = useTranslation('checkins');
  const currentUser = useStore(state => state.currentUser);
  const familyData = useStore(state => state.familyData);
  const locks = useRef(new Set<ToggleKey>());
  const familyWriteQueue = useRef<Promise<unknown>>(Promise.resolve());
  const familyWriteBaseline = useRef<{
    familyId: string;
    settings: FamilyCheckinSettings;
  } | null>(null);
  const [saving, setSaving] = useState(emptyToggleState);
  const [errors, setErrors] = useState(emptyErrorState);
  const parent = isParentRole(currentUser?.role);
  const owner = isOwnerRole(currentUser?.role);

  if (!parent) return null;

  const familySettings = resolvedDailyCheckinSettings(familyData?.dailyCheckins);
  const parentParticipationEnabled = resolvedParentParticipation(currentUser?.dailyCheckins);

  const runWrite = async (key: ToggleKey, write: () => Promise<unknown>) => {
    if (locks.current.has(key)) return;
    locks.current.add(key);
    setSaving(current => ({ ...current, [key]: true }));
    setErrors(current => ({ ...current, [key]: null }));

    try {
      await write();
    } catch {
      setErrors(current => ({ ...current, [key]: t('settings.error') }));
    } finally {
      locks.current.delete(key);
      setSaving(current => ({ ...current, [key]: false }));
    }
  };

  const updateFamilyToggle = (
    key: 'children' | 'history',
    field: 'childrenEnabled' | 'historyVisibleToParents',
  ) => {
    if (!familyData?.id) return;
    const familyId = familyData.id;
    const enabled = !familySettings[field];
    void runWrite(key, () => {
      const write = familyWriteQueue.current
        .catch(() => undefined)
        .then(async () => {
          const persisted = resolvedDailyCheckinSettings(useStore.getState().familyData?.dailyCheckins);
          const baseline = familyWriteBaseline.current?.familyId === familyId
            ? familyWriteBaseline.current.settings
            : persisted;
          const next = { ...baseline, [field]: enabled };

          try {
            await updateFamilySettings(familyId, { dailyCheckins: next });
            familyWriteBaseline.current = { familyId, settings: next };
          } catch (error) {
            familyWriteBaseline.current = {
              familyId,
              settings: resolvedDailyCheckinSettings(useStore.getState().familyData?.dailyCheckins),
            };
            throw error;
          }
        });
      familyWriteQueue.current = write;
      return write;
    });
  };

  const updateParentToggle = () => {
    if (!currentUser?.id) return;
    void runWrite('parent', () => updateParentDailyCheckinPreference(
      currentUser.id,
      !parentParticipationEnabled,
    ));
  };

  return (
    <Card>
      <CardContent className="p-5">
        <h3 className="font-semibold text-gray-900">{t('settings.title')}</h3>
        <p className="mt-1 text-sm text-gray-500">{t('settings.description')}</p>
        <div className="mt-3 divide-y divide-gray-100">
          {owner && (
            <SettingsToggle
              checked={familySettings.childrenEnabled}
              disabled={saving.children}
              error={errors.children}
              label={t('settings.children')}
              description={t('settings.childrenDescription')}
              onClick={() => updateFamilyToggle('children', 'childrenEnabled')}
            />
          )}
          <SettingsToggle
            checked={parentParticipationEnabled}
            disabled={saving.parent}
            error={errors.parent}
            label={t('settings.parent')}
            description={t('settings.parentDescription')}
            onClick={updateParentToggle}
          />
          {owner && (
            <SettingsToggle
              checked={familySettings.historyVisibleToParents}
              disabled={saving.history}
              error={errors.history}
              label={t('settings.history')}
              description={t('settings.historyDescription')}
              onClick={() => updateFamilyToggle('history', 'historyVisibleToParents')}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
