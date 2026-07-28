import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { Toast, type ToastData } from '../ui/Toast';
import { AddChildModal } from './AddChildModal';
import { completeFamilyWelcomeSetup } from '../../lib/api';
import { isChildRole } from '../../lib/roles';

export function FamilySetupPrompt({
  familyId,
  ownerId,
  familyMembers,
  onHide,
}: {
  familyId: string;
  ownerId: string;
  familyMembers: any[];
  onHide: () => void;
}) {
  const { t } = useTranslation(['auth', 'common']);
  const navigate = useNavigate();
  const [addingChild, setAddingChild] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  const hasChild = familyMembers.some(member => isChildRole(member.role));

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
              onClick={() => {
                onHide();
                navigate('/settings?familySection=members');
              }}
            >
              {t('auth:familySetup.addAdult')}
            </Button>
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
