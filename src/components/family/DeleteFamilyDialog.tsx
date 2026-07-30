import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { signOut } from '../../lib/api';
import {
  requestFamilyDeletion,
  fetchFamilyDeletionStatus,
  generateClientReqId,
} from '../../lib/familyDeletionApi';

interface DeleteFamilyDialogProps {
  familyId: string;
  familyName: string;
  onClose: () => void;
}

type Stage = 'warning' | 'confirm' | 'deleting' | 'failed';

const POLL_INTERVAL_MS = 3_000;

/**
 * Two-stage, owner-only family deletion flow.
 *
 * Stage 1 explains exactly what is deleted. Stage 2 requires typing the
 * exact, case-sensitive family name. Progress is polled from the sanitized
 * server status; on completion the local session is signed out (which clears
 * the persisted auth state and Zustand store via the auth listener).
 */
export function DeleteFamilyDialog({ familyId, familyName, onClose }: DeleteFamilyDialogProps) {
  const { t } = useTranslation(['settings']);
  const [stage, setStage] = useState<Stage>('warning');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientReqIdRef = useRef<string>(generateClientReqId());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const finishDeletion = async () => {
    if (pollRef.current) clearInterval(pollRef.current);
    try {
      await signOut();
    } catch {
      /* session is already unusable; navigation falls back to auth guard */
    }
  };

  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const status = await fetchFamilyDeletionStatus(familyId);
        if (status.state === 'completed' || status.state === 'none') {
          await finishDeletion();
        } else if (status.state === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
          setStage('failed');
          setError(t('familySettings.deleteFamilyFailed'));
        }
      } catch (err: any) {
        // A not-found/permission error after the freeze means the account
        // membership was already dissolved: treat as completed.
        const code = err?.code as string | undefined;
        if (code === 'functions/not-found' || code === 'functions/permission-denied') {
          await finishDeletion();
        }
      }
    }, POLL_INTERVAL_MS);
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await requestFamilyDeletion({
        familyId,
        familyNameConfirmation: confirmation,
        clientReqId: clientReqIdRef.current,
      });
      if (result.state === 'completed') {
        await finishDeletion();
        return;
      }
      setStage('deleting');
      startPolling();
    } catch (err: any) {
      const code = err?.code as string | undefined;
      const message = err?.message as string | undefined;
      if (code === 'functions/failed-precondition' && message?.includes('NAME_MISMATCH')) {
        setError(t('familySettings.deleteFamilyNameMismatch'));
      } else if (code === 'functions/permission-denied') {
        setError(t('familySettings.deleteFamilyNotAuthorized'));
      } else {
        setError(t('familySettings.deleteFamilyError'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const busy = submitting || stage === 'deleting';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-family-dialog-title"
      data-testid="delete-family-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-6 w-6 text-red-600" aria-hidden="true" />
          <h2 id="delete-family-dialog-title" className="text-lg font-semibold text-red-700">
            {t('familySettings.deleteFamilyTitle')}
          </h2>
        </div>

        {stage === 'warning' && (
          <>
            <p className="text-sm text-gray-700">{t('familySettings.deleteFamilyWarning')}</p>
            <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1">
              <li>{t('familySettings.deleteFamilyScopeMembers')}</li>
              <li>{t('familySettings.deleteFamilyScopeData')}</li>
              <li>{t('familySettings.deleteFamilyScopeLogins')}</li>
            </ul>
            <p className="text-sm font-medium text-red-700">{t('familySettings.deleteFamilyIrreversible')}</p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>{t('familySettings.deleteFamilyCancel')}</Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={() => setStage('confirm')}
              >
                {t('familySettings.deleteFamilyContinue')}
              </Button>
            </div>
          </>
        )}

        {(stage === 'confirm' || stage === 'failed') && (
          <>
            <p className="text-sm text-gray-700">
              {t('familySettings.deleteFamilyTypeName', { name: familyName })}
            </p>
            <label htmlFor="delete-family-confirmation" className="sr-only">
              {t('familySettings.deleteFamilyConfirmationLabel')}
            </label>
            <input
              id="delete-family-confirmation"
              type="text"
              value={confirmation}
              onChange={e => { setConfirmation(e.target.value); setError(null); }}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            />
            {error && (
              <p role="alert" className="text-sm text-red-600">{error}</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose} disabled={submitting}>
                {t('familySettings.deleteFamilyCancel')}
              </Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={handleSubmit}
                disabled={busy || confirmation.length === 0}
                aria-label={t('familySettings.deleteFamilyConfirmAction')}
              >
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                {stage === 'failed'
                  ? t('familySettings.deleteFamilyRetry')
                  : t('familySettings.deleteFamilyConfirmAction')}
              </Button>
            </div>
          </>
        )}

        {stage === 'deleting' && (
          <div className="space-y-3 text-center" data-testid="delete-family-progress">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-red-600" aria-hidden="true" />
            <p className="text-sm text-gray-700" role="status">
              {t('familySettings.deleteFamilyInProgress')}
            </p>
            <p className="text-xs text-gray-500">{t('familySettings.deleteFamilyInProgressHint')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
