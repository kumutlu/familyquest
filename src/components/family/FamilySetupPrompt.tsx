import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { Toast, type ToastData } from '../ui/Toast';
import { AddChildModal } from './AddChildModal';
import { completeFamilyWelcomeSetup } from '../../lib/api';
import { isChildRole } from '../../lib/roles';

export function FamilySetupPrompt({
  familyId,
  ownerId,
  familyCode,
  familyMembers,
  onHide,
}: {
  familyId: string;
  ownerId: string;
  familyCode: string;
  familyMembers: any[];
  onHide: () => void;
}) {
  const { t } = useTranslation(['auth', 'common']);
  const [addingChild, setAddingChild] = useState(false);
  const [showJoinCode, setShowJoinCode] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  const hasChild = familyMembers.some(member => isChildRole(member.role));

  const copyFamilyCode = async () => {
    try {
      await navigator.clipboard.writeText(familyCode);
      setCopyFailed(false);
    } catch (error) {
      console.error('Failed to copy family code', error);
      setCopyFailed(true);
    }
  };

  const complete = async () => {
    setSaving(true);
    try {
      await completeFamilyWelcomeSetup(familyId, ownerId);
      onHide();
    } catch (error) {
      console.error('Failed to persist family setup completion', error);
      setToast({ id: Date.now(), type: 'error', message: t('auth:familySetup.saveFailed') });
    } finally {
      setSaving(false);
    }
  };

  if (addingChild) {
    return (
      <AddChildModal
        familyId={familyId}
        onClose={() => setAddingChild(false)}
        onChildAdded={() => void complete()}
        startAtForm
      />
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4">
        <section role="dialog" aria-modal="true" aria-labelledby="family-setup-title" className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-xl">
          <h2 id="family-setup-title" className="text-2xl font-bold text-gray-900">{t('auth:familySetup.title')}</h2>
          <p className="mt-2 text-gray-600">{t('auth:familySetup.body')}</p>
          <div className="mt-6 flex flex-col gap-3">
            <Button onClick={() => setAddingChild(true)}>
              {hasChild ? t('auth:familySetup.addAnotherChild') : t('auth:familySetup.addChild')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setShowJoinCode(true)}
            >
              {t('auth:familySetup.letThemJoin')}
            </Button>
            {showJoinCode && (
              <div className="rounded-xl border border-primary-100 bg-primary-50 p-4 text-left">
                <p className="text-sm text-primary-900">
                  {t('auth:familySetup.joinExplanation')}
                </p>
                <p className="mt-2 text-center font-mono text-2xl font-bold tracking-widest text-primary-700">
                  {familyCode || '—'}
                </p>
                <Button
                  fullWidth
                  size="sm"
                  variant="secondary"
                  className="mt-3"
                  disabled={!familyCode}
                  onClick={() => void copyFamilyCode()}
                >
                  {t('common:copy')}
                </Button>
                {copyFailed && (
                  <p className="mt-2 text-sm text-red-600" role="alert">
                    {t('auth:familySetup.copyFailed')}
                  </p>
                )}
              </div>
            )}
            <Button variant="ghost" disabled={saving} onClick={() => void complete()}>
              {saving ? t('common:saving') : t('auth:familySetup.skip')}
            </Button>
          </div>
        </section>
      </div>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
