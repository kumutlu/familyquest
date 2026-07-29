import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { formatDate } from '../../i18n/format';
import {
  disableChildLogin,
  enableChildLogin,
  mapChildLoginError,
  resetChildPassword,
  validatePasswordClient,
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
 *
 * Reset / Disable / Enable actions are part of a later phase; the backend
 * callables do not exist yet, so the buttons are shown disabled with a
 * "Coming soon" hint (we do not invent temporary APIs).
 */
export function ChildLoginSection({ member, onRequestCreate }: ChildLoginSectionProps) {
  const { t } = useTranslation('family');
  const [resetOpen, setResetOpen] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

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
      {feedback && <p className="text-xs text-gray-600" role="status">{feedback}</p>}
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
    </div>
  );
}
