import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Link2, Loader2, Share2, ShieldCheck, X } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { isOwnerRole } from '../../lib/roles';
import {
  createAdultInvitation,
  revokeAdultInvitation,
  type AdultRole,
  type CreatedAdultInvitation,
} from '../../lib/adultInvitationApi';
import { Button } from '../ui/Button';

export interface AdultInviteCardProps {
  defaultRole?: AdultRole;
  onClose?: () => void;
}

type Feedback = 'idle' | 'copied' | 'error';

function requestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `invite-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function liveInviteUrl(token: string): string {
  if (!token) return '';
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/invite/${encodeURIComponent(token)}`;
}

/**
 * The single owner-only surface for creating adult invitations. The raw
 * bearer token exists only in React state for the lifetime of this card. The
 * server-returned invitation id is the only value used for revocation.
 */
export function AdultInviteCard({ defaultRole = 'parent', onClose }: AdultInviteCardProps) {
  const { t } = useTranslation(['family', 'common']);
  const currentUser = useStore(state => state.currentUser);
  const [role, setRole] = useState<AdultRole>(defaultRole === 'adult' ? 'adult' : 'parent');
  const [invitation, setInvitation] = useState<CreatedAdultInvitation | null>(null);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>('idle');
  const [error, setError] = useState<'create' | 'copy' | 'revoke' | null>(null);
  const [revoked, setRevoked] = useState(false);
  const inFlightCreate = useRef(false);

  const copy = useCallback(async (value: string): Promise<boolean> => {
    if (!value) return false;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard-unavailable');
      await navigator.clipboard.writeText(value);
      setFeedback('copied');
      setError(null);
      return true;
    } catch {
      setFeedback('error');
      setError('copy');
      return false;
    }
  }, []);

  const create = useCallback(async () => {
    if (inFlightCreate.current || invitation) return;
    inFlightCreate.current = true;
    setCreating(true);
    setError(null);
    setFeedback('idle');
    setRevoked(false);
    try {
      const created = await createAdultInvitation({ intendedRole: role, clientReqId: requestId() });
      // Deliberately keep the raw token in component memory only. Never log or
      // pass it to persistence APIs; invitationId is sufficient for revoke.
      setInvitation(created);
    } catch {
      setError('create');
    } finally {
      inFlightCreate.current = false;
      setCreating(false);
    }
  }, [invitation, role]);

  const share = useCallback(async () => {
    if (!invitation) return;
    const url = liveInviteUrl(invitation.token);
    const message = t('family:adultInviteCard.shareIntro');
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: t('common:appName'), text: message, url });
        return;
      } catch {
        // A dismissed/unavailable share sheet gets the same clipboard fallback.
      }
    }
    await copy(`${message}\n${url}`);
  }, [copy, invitation, t]);

  const revoke = useCallback(async () => {
    if (!invitation || revoking) return;
    setRevoking(true);
    setError(null);
    try {
      await revokeAdultInvitation({ invitationId: invitation.invitationId, clientReqId: requestId() });
      setInvitation(null);
      setRevoked(true);
      setFeedback('idle');
    } catch {
      setError('revoke');
    } finally {
      setRevoking(false);
    }
  }, [invitation, revoking]);

  // Defense in depth: callers should hide this card, but the primitive itself
  // must never expose an owner action to a parent, adult, child, or unknown role.
  if (!isOwnerRole(currentUser?.role)) return null;

  const url = invitation ? liveInviteUrl(invitation.token) : '';

  return (
    <section data-testid="adult-invite-card" className="space-y-4 rounded-2xl border border-primary-100 bg-primary-50/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{t('family:adultInviteCard.title')}</h2>
          <p className="mt-1 text-sm text-gray-600">{t('family:adultInviteCard.subtitle')}</p>
        </div>
        {onClose && (
          <button type="button" aria-label={t('common:closeDialog')} onClick={onClose} className="rounded-full p-2 text-gray-500 hover:bg-white">
            <X size={18} aria-hidden="true" />
          </button>
        )}
      </div>

      {!invitation && (
        <>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-gray-700">{t('family:adultInviteCard.roleLabel')}</legend>
            <label className="flex min-h-11 items-center gap-2 rounded-xl bg-white px-3 text-sm font-medium text-gray-800">
              <input type="radio" name="adult-invite-role" value="parent" checked={role === 'parent'} onChange={() => setRole('parent')} />
              {t('family:adultInviteCard.parent')}
            </label>
            <label className="flex min-h-11 items-center gap-2 rounded-xl bg-white px-3 text-sm font-medium text-gray-800">
              <input type="radio" name="adult-invite-role" value="adult" checked={role === 'adult'} onChange={() => setRole('adult')} />
              {t('family:adultInviteCard.adult')}
            </label>
          </fieldset>
          <Button fullWidth onClick={() => void create()} disabled={creating}>
            {creating ? <Loader2 size={17} className="mr-2 animate-spin" aria-hidden="true" /> : <ShieldCheck size={17} className="mr-2" aria-hidden="true" />}
            {creating ? t('family:adultInviteCard.creating') : t('family:adultInviteCard.create')}
          </Button>
        </>
      )}

      {invitation && (
        <>
          <p className="text-sm font-medium text-green-700" role="status">{t('family:adultInviteCard.ready')}</p>
          <a
            data-testid="adult-invite-link"
            href={url}
            className="flex items-center gap-2 break-all rounded-xl bg-white px-3 py-2 text-sm text-primary-700 underline"
          >
            <Link2 size={16} className="shrink-0" aria-hidden="true" />
            {t('family:adultInviteCard.linkLabel')}
          </a>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button onClick={() => void copy(url)} disabled={!url}>
              {feedback === 'copied' ? <Check size={17} className="mr-2" aria-hidden="true" /> : <Copy size={17} className="mr-2" aria-hidden="true" />}
              {feedback === 'copied' ? t('family:adultInviteCard.copied') : t('family:adultInviteCard.copy')}
            </Button>
            <Button variant="secondary" onClick={() => void share()} disabled={!url}>
              <Share2 size={17} className="mr-2" aria-hidden="true" />
              {t('family:adultInviteCard.share')}
            </Button>
          </div>
          <Button variant="ghost" onClick={() => void revoke()} disabled={revoking}>
            {revoking ? t('family:adultInviteCard.revoking') : t('family:adultInviteCard.revoke')}
          </Button>
        </>
      )}

      {revoked && <p className="text-sm text-gray-600" role="status">{t('family:adultInviteCard.revoked')}</p>}
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error === 'copy' ? t('family:adultInviteCard.copyUnavailable') : t('family:adultInviteCard.unavailable')}
        </p>
      )}
    </section>
  );
}
