import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserPlus } from 'lucide-react';
import { Button } from '../ui/Button';
import { createManagedMember } from '../../lib/api';
import { AvatarPicker } from '../profile/AvatarPicker';
import { CreateChildLoginDialog } from './CreateChildLoginDialog';
import { useAccessibleDialog } from './useAccessibleDialog';

interface AddChildModalProps {
  familyId: string;
  onClose: () => void;
  onChildAdded?: () => void;
  startAtForm?: boolean;
}

export function AddChildModal({ familyId, onClose, onChildAdded }: AddChildModalProps) {
  const { t } = useTranslation(['auth', 'common']);
  const [step, setStep] = useState<'profile' | 'login-choice'>('profile');
  const [name, setName] = useState('');
  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [createdChild, setCreatedChild] = useState<{ id: string; displayName: string } | null>(null);
  const [createLoginFor, setCreateLoginFor] = useState<{ id: string; displayName: string } | null>(null);
  const dialogRef = useAccessibleDialog(onClose, !createLoginFor);

  const handleCreateChild = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || submitting || createdChild) {
      if (!name.trim()) setFormError(t('auth:childOnboarding.nameRequired'));
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const childId = await createManagedMember(
        familyId,
        'child',
        name.trim(),
        avatarId ? { avatarId } : undefined,
      );
      setCreatedChild({ id: childId, displayName: name.trim() });
      setStep('login-choice');
    } catch (caught: any) {
      setFormError(caught?.message || t('common:errorOccurred'));
    } finally {
      setSubmitting(false);
    }
  };

  const finish = () => {
    onChildAdded?.();
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 backdrop-blur-sm p-4">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal={createLoginFor ? undefined : 'true'}
          aria-hidden={createLoginFor ? true : undefined}
          aria-labelledby="add-child-dialog-title"
          tabIndex={-1}
          className="bg-white w-full max-w-md rounded-3xl shadow-xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200 outline-none"
        >
          {step === 'profile' && (
            <div className="p-8">
              <div className="mb-6 text-center">
                <UserPlus className="mx-auto mb-3 h-12 w-12 text-primary-600" />
                <h2 id="add-child-dialog-title" className="text-2xl font-bold text-gray-900">
                  {t('auth:childOnboarding.createTitle')}
                </h2>
                <p className="mt-2 text-sm text-gray-600">
                  {t('auth:childOnboarding.managedProfileExplanation')}
                </p>
              </div>
              <form className="space-y-5" onSubmit={handleCreateChild}>
                <div>
                  <label htmlFor="child-name" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('auth:childOnboarding.displayNameLabel')}
                  </label>
                  <input
                    id="child-name"
                    required
                    value={name}
                    onChange={event => setName(event.target.value)}
                    placeholder={t('auth:childOnboarding.namePlaceholder')}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 outline-none"
                  />
                </div>
                <div>
                  <span className="block text-sm font-medium text-gray-700 mb-2">
                    {t('auth:childOnboarding.avatarLabel')}
                  </span>
                  <AvatarPicker
                    selectedAvatarId={avatarId}
                    ownedAvatarIds={[]}
                    pointsBalance={0}
                    onSelect={setAvatarId}
                    onRequestUnlock={() => undefined}
                  />
                </div>
                {formError && <p className="text-sm text-red-600" role="alert">{formError}</p>}
                <div className="flex gap-3">
                  <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
                    {t('common:cancel')}
                  </Button>
                  <Button type="submit" className="flex-1" disabled={submitting}>
                    {submitting ? t('common:loading') : t('auth:childOnboarding.createChild')}
                  </Button>
                </div>
              </form>
            </div>
          )}

          {step === 'login-choice' && createdChild && (
            <div className="p-8 text-center">
              <h2 id="add-child-dialog-title" className="text-2xl font-bold text-gray-900">
                {t('auth:childOnboarding.createLoginQuestion')}
              </h2>
              <p className="mt-2 text-sm text-gray-600">
                {t('auth:childOnboarding.profileCreated', { name: createdChild.displayName })}
              </p>
              <div className="mt-6 flex flex-col gap-3">
                <Button onClick={() => setCreateLoginFor(createdChild)}>
                  {t('auth:childOnboarding.createLogin')}
                </Button>
                <Button variant="secondary" onClick={finish}>
                  {t('auth:childOnboarding.notNow')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {createLoginFor && (
        <CreateChildLoginDialog
          member={createLoginFor}
          profileAlreadyCreated
          onClose={() => setCreateLoginFor(null)}
          onSuccess={() => {
            setCreateLoginFor(null);
            finish();
          }}
        />
      )}
    </>
  );
}
