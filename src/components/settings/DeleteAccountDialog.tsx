import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { signOut } from '../../lib/api';
import { useStore } from '../../store/useStore';
import { isParentRole } from '../../lib/roles';
import {
  requestAccountDeletion,
  getReauthMethod,
  reauthenticateWithPassword,
  reauthenticateWithGoogle,
  type DeleteAccountInput,
} from '../../lib/accountDeletionApi';
import { fetchFamilyDeletionStatus } from '../../lib/familyDeletionApi';

interface DeleteAccountDialogProps {
  onClose: () => void;
}

type Stage =
  | 'warning'
  | 'confirm'
  | 'successor'
  | 'family_confirmation'
  | 'reauth'
  | 'deleting'
  | 'pending_family';

const POLL_INTERVAL_MS = 3_000;

/**
 * App Store-compliant in-app account deletion.
 *
 * Two-stage confirmation that is clearly distinct from "Delete family" and
 * "Sign out". Handles the server's role verdicts: successor selection for
 * owners, the family-deletion cascade for sole owners, and reauthentication
 * (password or Google) when the login is not recent. On success the session
 * is signed out, which clears persisted auth and the Zustand store.
 */
export function DeleteAccountDialog({ onClose }: DeleteAccountDialogProps) {
  const { t } = useTranslation(['settings']);
  const currentUser = useStore(state => state.currentUser);
  const familyData = useStore(state => state.familyData);
  const familyMembers = useStore(state => state.familyMembers);

  const [stage, setStage] = useState<Stage>('warning');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [successorUid, setSuccessorUid] = useState('');
  const [familyNameConfirmation, setFamilyNameConfirmation] = useState('');
  const [password, setPassword] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingInputRef = useRef<DeleteAccountInput>({});

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const eligibleSuccessors = (familyMembers ?? []).filter(
    m => m.id !== currentUser?.id && isParentRole(m.role) && !m.isManaged,
  );

  const finish = async () => {
    if (pollRef.current) clearInterval(pollRef.current);
    try {
      await signOut();
    } catch {
      /* the session is already unusable */
    }
  };

  const startFamilyPolling = (familyId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const status = await fetchFamilyDeletionStatus(familyId);
        if (status.state === 'completed' || status.state === 'none') {
          // Family gone: resume the account deletion; the server treats this
          // as an idempotent completion (no duplicate work).
          await requestAccountDeletion({}).catch(() => undefined);
          await finish();
        }
      } catch {
        // Permission/not-found after cleanup means our membership is gone.
        await requestAccountDeletion({}).catch(() => undefined);
        await finish();
      }
    }, POLL_INTERVAL_MS);
  };

  const submit = async (input: DeleteAccountInput) => {
    if (busy) return;
    pendingInputRef.current = input;
    setBusy(true);
    setError(null);
    try {
      const result = await requestAccountDeletion(input);
      if (result.status === 'completed') {
        await finish();
        return;
      }
      // pending_family_deletion
      setStage('pending_family');
      if (familyData?.id) startFamilyPolling(familyData.id);
    } catch (err: any) {
      const code = err?.code as string | undefined;
      const message = (err?.message as string | undefined) ?? '';
      if (message.includes('RECENT_LOGIN_REQUIRED') || code === 'auth/requires-recent-login') {
        setStage('reauth');
      } else if (message.includes('SUCCESSOR_REQUIRED') || message.includes('SUCCESSOR_NOT_ELIGIBLE')) {
        setStage('successor');
        if (message.includes('SUCCESSOR_NOT_ELIGIBLE')) {
          setError(t('deleteAccount.successorNotEligible'));
        }
      } else if (message.includes('FAMILY_DELETION_CONFIRMATION_REQUIRED')) {
        setStage('family_confirmation');
      } else if (message.includes('MANAGED_CHILD_ACCOUNT')) {
        setError(t('deleteAccount.managedChild'));
      } else {
        setError(t('deleteAccount.genericError'));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleReauth = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const method = getReauthMethod();
      if (method === 'password') {
        await reauthenticateWithPassword(password);
      } else if (method === 'google') {
        await reauthenticateWithGoogle();
      } else {
        setError(t('deleteAccount.reauthUnavailable'));
        return;
      }
      setBusy(false);
      // Resume exactly where we left off; the server never repeats work.
      await submit(pendingInputRef.current);
      return;
    } catch {
      setError(t('deleteAccount.reauthFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-account-dialog-title"
      data-testid="delete-account-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-6 w-6 text-red-600" aria-hidden="true" />
          <h2 id="delete-account-dialog-title" className="text-lg font-semibold text-red-700">
            {t('deleteAccount.title')}
          </h2>
        </div>

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

        {stage === 'warning' && (
          <>
            <p className="text-sm text-gray-700">{t('deleteAccount.warning')}</p>
            <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1">
              <li>{t('deleteAccount.scopeProfile')}</li>
              <li>{t('deleteAccount.scopeMembership')}</li>
              <li>{t('deleteAccount.scopeLogin')}</li>
            </ul>
            <p className="text-sm font-medium text-red-700">{t('deleteAccount.irreversible')}</p>
            <p className="text-xs text-gray-500">{t('deleteAccount.notSignOut')}</p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>{t('deleteAccount.cancel')}</Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={() => setStage('confirm')}
              >
                {t('deleteAccount.continue')}
              </Button>
            </div>
          </>
        )}

        {stage === 'confirm' && (
          <>
            <p className="text-sm text-gray-700">{t('deleteAccount.finalPrompt')}</p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose} disabled={busy}>
                {t('deleteAccount.cancel')}
              </Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white"
                disabled={busy}
                onClick={() => submit({})}
              >
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                {t('deleteAccount.confirmAction')}
              </Button>
            </div>
          </>
        )}

        {stage === 'successor' && (
          <>
            <p className="text-sm text-gray-700">{t('deleteAccount.successorPrompt')}</p>
            <label htmlFor="delete-account-successor" className="sr-only">
              {t('deleteAccount.successorLabel')}
            </label>
            <select
              id="delete-account-successor"
              value={successorUid}
              onChange={e => setSuccessorUid(e.target.value)}
              disabled={busy}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">{t('deleteAccount.successorPlaceholder')}</option>
              {eligibleSuccessors.map(member => (
                <option key={member.id} value={member.id}>{member.displayName}</option>
              ))}
            </select>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose} disabled={busy}>
                {t('deleteAccount.cancel')}
              </Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white"
                disabled={busy || !successorUid}
                onClick={() => submit({ successorUid })}
              >
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                {t('deleteAccount.successorConfirm')}
              </Button>
            </div>
          </>
        )}

        {stage === 'family_confirmation' && (
          <>
            <p className="text-sm text-gray-700">{t('deleteAccount.familyCascadeExplain')}</p>
            <p className="text-sm text-gray-700">
              {t('deleteAccount.familyTypeName', { name: familyData?.name ?? '' })}
            </p>
            <label htmlFor="delete-account-family-confirmation" className="sr-only">
              {t('deleteAccount.familyConfirmationLabel')}
            </label>
            <input
              id="delete-account-family-confirmation"
              type="text"
              value={familyNameConfirmation}
              onChange={e => setFamilyNameConfirmation(e.target.value)}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose} disabled={busy}>
                {t('deleteAccount.cancel')}
              </Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white"
                disabled={busy || familyNameConfirmation.length === 0}
                onClick={() => submit({ familyNameConfirmation })}
              >
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                {t('deleteAccount.familyCascadeConfirm')}
              </Button>
            </div>
          </>
        )}

        {stage === 'reauth' && (
          <>
            <p className="text-sm text-gray-700">{t('deleteAccount.reauthPrompt')}</p>
            {getReauthMethod() === 'password' && (
              <>
                <label htmlFor="delete-account-password" className="sr-only">
                  {t('deleteAccount.passwordLabel')}
                </label>
                <input
                  id="delete-account-password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={busy}
                  autoComplete="current-password"
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
                />
              </>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose} disabled={busy}>
                {t('deleteAccount.cancel')}
              </Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white"
                disabled={busy || (getReauthMethod() === 'password' && password.length === 0)}
                onClick={handleReauth}
              >
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                {t('deleteAccount.reauthConfirm')}
              </Button>
            </div>
          </>
        )}

        {(stage === 'deleting' || stage === 'pending_family') && (
          <div className="space-y-3 text-center" data-testid="delete-account-progress">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-red-600" aria-hidden="true" />
            <p className="text-sm text-gray-700" role="status">
              {stage === 'pending_family'
                ? t('deleteAccount.pendingFamily')
                : t('deleteAccount.inProgress')}
            </p>
            <p className="text-xs text-gray-500">{t('deleteAccount.inProgressHint')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
