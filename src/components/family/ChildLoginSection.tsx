import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { formatDate } from '../../i18n/format';
import {
  disableChildLogin,
  enableChildLogin,
  mapChildLoginError,
  resetChildPassword,
  validatePasswordClient,
  deleteChild,
} from '../../lib/childLoginApi';

export interface ChildLoginMember {
  id: string;
  displayName: string;
  hasLogin?: boolean;
  username?: string;
  loginEnabled?: boolean;
  requiresPasswordChange?: boolean;
  /** Optional last-login timestamp (Firestore Timestamp, Date, or epoch ms). */
  lastLogin?: unknown;
  /** Whether this child is a managed child (parent-created). */
  isManaged?: boolean;
}

interface ChildLoginSectionProps {
  member: ChildLoginMember;
  onRequestCreate: (member: ChildLoginMember) => void;
}

/** Best-effort, safe formatting of an optional last-login timestamp. */
function formatLastLogin(value: unknown, neverLabel: string): string {
  if (!value) return neverLabel;
  try {
    let date: Date | null = null;
    if (typeof value === 'number') date = new Date(value);
    else if (value instanceof Date) date = value;
    else if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
      date = (value as { toDate: () => Date }).toDate();
    } else if (typeof (value as { toMillis?: () => number }).toMillis === 'function') {
      date = new Date((value as { toMillis: () => number }).toMillis());
    }
    if (date && !Number.isNaN(date.getTime())) {
      return formatDate(date);
    }
  } catch {
    /* fall through */
  }
  return 'Never';
}

/**
 * Compact "Login" block for a managed child card. Never renders authUid,
 * synthetic email, internal IDs, or server-only fields.
 */
export function ChildLoginSection({ member, onRequestCreate }: ChildLoginSectionProps) {
  const { t } = useTranslation(['family', 'common']);
  const [resetOpen, setResetOpen] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

  // Delete child state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteNameInput, setDeleteNameInput] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteFeedback, setDeleteFeedback] = useState('');

  const changeEnabledState = async () => {
    setBusy(true);
    setFeedback('');
    try {
      if (member.loginEnabled) await disableChildLogin(member.id);
      else await enableChildLogin(member.id);
    } catch (error) {
      setFeedback(mapChildLoginError(error));
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async () => {
    const validation = validatePasswordClient(temporaryPassword);
    if (validation) {
      setFeedback(validation);
      return;
    }
    setBusy(true);
    setFeedback('');
    try {
      await resetChildPassword(member.id, temporaryPassword);
      setTemporaryPassword('');
      setResetOpen(false);
      setFeedback('Temporary password set. The child has been signed out and must create a new private password.');
    } catch (error) {
      setFeedback(mapChildLoginError(error));
    } finally {
      setBusy(false);
    }
  };

  const openDeleteDialog = () => {
    setDeleteNameInput('');
    setDeleteFeedback('');
    setDeleteOpen(true);
  };

  const closeDeleteDialog = () => {
    setDeleteOpen(false);
    setDeleteNameInput('');
    setDeleteFeedback('');
  };

  const nameConfirmed = deleteNameInput.trim() === member.displayName;

  const submitDelete = async () => {
    if (!nameConfirmed) {
      setDeleteFeedback(t('login.deleteNameMismatch'));
      return;
    }
    setDeleteBusy(true);
    setDeleteFeedback('');
    try {
      await deleteChild(member.id, member.displayName);
      closeDeleteDialog();
      setFeedback(t('login.deleteSuccess'));
    } catch (error) {
      setDeleteFeedback(mapChildLoginError(error));
    } finally {
      setDeleteBusy(false);
    }
  };

  if (!member.hasLogin) {
    return (
      <div className="mt-3 pt-3 border-t border-gray-100">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{t('login.label')}</p>
            <p className="text-sm text-gray-500">{t('login.noLogin')}</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRequestCreate(member);
            }}
          >
            {t('login.create')}
          </Button>
        </div>
      </div>
    );
  }

  const status = member.loginEnabled ? t('login.enabled') : t('login.disabled');

  return (
    <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{t('login.label')}</p>

      <dl className="text-sm text-gray-700 space-y-0.5">
        <div className="flex justify-between gap-3">
          <dt className="text-gray-500">{t('login.username')}</dt>
          <dd className="font-medium truncate">{member.username}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-500">{t('login.status')}</dt>
          <dd className="font-medium">{status}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-500">{t('login.requiresPasswordChange')}</dt>
          <dd className="font-medium">{member.requiresPasswordChange ? t('login.yes') : t('login.no')}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-500">{t('login.lastLogin')}</dt>
          <dd className="font-medium">{formatLastLogin(member.lastLogin, t('login.never'))}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setResetOpen(true)}>
          {t('login.resetPassword')}
        </Button>
        {member.loginEnabled ? (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={changeEnabledState}>
            {t('login.disableLogin')}
          </Button>
        ) : (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={changeEnabledState}>
            {t('login.enableLogin')}
          </Button>
        )}
      </div>

      {/* Delete Child action — only for managed children */}
      {member.isManaged !== false && (
        <div className="pt-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="text-red-600 border-red-300 hover:bg-red-50 hover:text-red-700"
            onClick={openDeleteDialog}
          >
            {t('login.deleteChild')}
          </Button>
        </div>
      )}

      {feedback && <p className="text-xs text-gray-600" role="status">{feedback}</p>}
      {deleteFeedback && <p className="text-xs text-red-600" role="alert">{deleteFeedback}</p>}

      {resetOpen && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-3">
          <p className="text-sm text-amber-900">
            Set a temporary password. The child will be signed out on all devices and must create a new private password the next time they sign in.
          </p>
          <input
            type="password"
            value={temporaryPassword}
            onChange={event => setTemporaryPassword(event.target.value)}
            aria-label="Temporary password"
            autoComplete="new-password"
            className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2"
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={submitReset}>
              Set temporary password
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => {
              setTemporaryPassword('');
              setResetOpen(false);
            }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 backdrop-blur-sm p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-child-dialog-title"
            tabIndex={-1}
            className="bg-white w-full max-w-sm rounded-3xl shadow-xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200 outline-none"
          >
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
              <h3 id="delete-child-dialog-title" className="text-xl font-bold text-red-600">{t('login.deleteChildTitle')}</h3>
              <button type="button" aria-label={t('common:closeDialog')} onClick={closeDeleteDialog} className="p-2 -mr-2 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-500 transition-colors">
                ✕
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-700">
                {t('login.deleteChildExplanation')}
              </p>
              <p className="text-sm font-medium text-red-600">
                {t('login.deleteChildWarning')}
              </p>
              <div>
                <label htmlFor="delete-child-name" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('login.deleteChildNameLabel')}
                </label>
                <input
                  id="delete-child-name"
                  type="text"
                  value={deleteNameInput}
                  onChange={e => setDeleteNameInput(e.target.value)}
                  placeholder={member.displayName}
                  aria-describedby="delete-child-hint"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none transition-all"
                  autoFocus
                />
                {!nameConfirmed && (
                  <p id="delete-child-hint" className="text-xs text-gray-500 mt-1.5">
                    {t('login.deleteChildHint', { name: member.displayName })}
                  </p>
                )}
              </div>
              {deleteFeedback && (
                <p className="text-sm text-red-600" role="alert">{deleteFeedback}</p>
              )}
              <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  fullWidth
                  disabled={deleteBusy}
                  onClick={closeDeleteDialog}
                  className="min-w-0 whitespace-nowrap"
                >
                  {t('common:cancel')}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  fullWidth
                  disabled={deleteBusy || !nameConfirmed}
                  onClick={submitDelete}
                  className="min-w-0 whitespace-nowrap"
                >
                  {deleteBusy ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                      {t('common:deleting')}
                    </span>
                  ) : (
                    t('login.deleteChildConfirm')
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
