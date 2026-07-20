import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';

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
      return date.toLocaleString();
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
        <Button type="button" size="sm" variant="outline" disabled title={t('login.comingSoon')}>
          {t('login.resetPassword')}
        </Button>
        {member.loginEnabled ? (
          <Button type="button" size="sm" variant="outline" disabled title={t('login.comingSoon')}>
            {t('login.disableLogin')}
          </Button>
        ) : (
          <Button type="button" size="sm" variant="outline" disabled title={t('login.comingSoon')}>
            {t('login.enableLogin')}
          </Button>
        )}
        <span className="text-xs text-gray-400">{t('login.comingSoon')}</span>
      </div>
    </div>
  );
}
