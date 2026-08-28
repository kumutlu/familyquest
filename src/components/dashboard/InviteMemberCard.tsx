import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, ChevronDown, Copy, Loader2, Share2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { useStore } from '../../store/useStore';
import { createFamilyInvitation, type IntendedRole } from '../../lib/familyInvitationApi';
import { buildInviteMessage, buildJoinUrl } from '../../lib/inviteLink';
import { isOwnerRole } from '../../lib/roles';
import { AdultInviteCard } from '../family/AdultInviteCard';

// ---------------------------------------------------------------------------
// INVITE MEMBER
// ---------------------------------------------------------------------------
//
// A two-step, single-column flow:
//
//   1. Choose who you are inviting (parent / child with a device / managed).
//   2. Share the invitation that was created for that exact role.
//
// Nothing about codes, tokens or URLs is shown by default: the parent only
// ever decides *who* they are inviting, and then shares. The manual family
// code remains available as a clearly secondary fallback.
//
// This is presentation only. Invitation creation, role validation and token
// handling are untouched server-side concerns.
// ---------------------------------------------------------------------------

type Step = 'choose' | 'ready';
type Feedback = 'idle' | 'copied' | 'error';

/** Minimum comfortable touch target on iPhone. */
const TOUCH = 'min-h-[44px]';

export function InviteMemberCard({
  onAddChild,
  onManagedChild,
}: {
  onAddChild?: () => void;
  /** Alias kept for call sites that name the managed-child flow explicitly. */
  onManagedChild?: () => void;
}) {
  const { t } = useTranslation(['family', 'common']);
  const { familyData, currentUser } = useStore();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('choose');
  const [role, setRole] = useState<IntendedRole | null>(null);
  const [creating, setCreating] = useState(false);
  const [failed, setFailed] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>('idle');
  const [showManual, setShowManual] = useState(false);
  const [showAdultInvite, setShowAdultInvite] = useState(false);
  // One invitation per role is created and then reused for the session, so
  // going back and forth never floods the family with dangling invitations.
  const [codes, setCodes] = useState<Partial<Record<IntendedRole, string>>>({});

  const titleRef = useRef<HTMLHeadingElement | null>(null);

  const familyCode = familyData?.inviteCode ?? '';
  const code = role ? codes[role] ?? '' : '';
  const url = code ? buildJoinUrl(code) : '';

  // Focus moves to the success title as soon as the invitation is ready, so
  // screen reader and keyboard users land exactly where the next action is.
  useEffect(() => {
    if (step === 'ready' && !creating && !failed) titleRef.current?.focus();
  }, [step, creating, failed]);

  const flash = useCallback((next: Feedback) => {
    setFeedback(next);
    window.setTimeout(() => setFeedback('idle'), 2500);
  }, []);

  const copy = useCallback(
    async (text: string) => {
      if (!text) return false;
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(text);
        flash('copied');
        return true;
      } catch (error) {
        console.error('Failed to copy invitation:', error);
        flash('error');
        return false;
      }
    },
    [flash],
  );

  const intro = (forRole: IntendedRole) =>
    forRole === 'parent' ? t('family:invite.shareIntroParent') : t('family:invite.shareIntroChild');

  /**
   * Creates (or reuses) the role-specific invitation and moves straight to the
   * share screen. The role is stored server-side only — it is never encoded in
   * the URL, so the link cannot be tampered with.
   */
  const startInvite = useCallback(
    async (nextRole: IntendedRole) => {
      setRole(nextRole);
      setStep('ready');
      setFailed(false);
      setShowManual(false);
      if (codes[nextRole]) return;
      setCreating(true);
      try {
        const invitation = await createFamilyInvitation(nextRole);
        setCodes(current => ({ ...current, [nextRole]: invitation.code }));
      } catch (error) {
        console.error('Failed to create invite link:', error);
        setFailed(true);
      } finally {
        setCreating(false);
      }
    },
    [codes],
  );

  const share = async () => {
    if (!role || !url) return;
    const message = intro(role);
    const shareData: ShareData = { title: t('common:appName'), text: message, url };
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        // Share sheet dismissed or unavailable — fall back to the clipboard.
      }
    }
    await copy(buildInviteMessage(message, url));
  };

  const openManagedChild = () => {
    const handler = onManagedChild ?? onAddChild;
    if (handler) handler();
    else navigate('/family');
  };

  const back = () => {
    setStep('choose');
    setRole(null);
    setFailed(false);
    setShowManual(false);
  };

  if (showAdultInvite) {
    return (
      <AdultInviteCard
        defaultRole="parent"
        autoCreate
        onClose={() => setShowAdultInvite(false)}
      />
    );
  }

  // -------------------------------------------------------------------------
  // Step 1 — who are you inviting?
  // -------------------------------------------------------------------------
  if (step === 'choose') {
    return (
      <div className="mx-auto w-full max-w-md">
        <h2 className="text-2xl font-bold tracking-tight text-gray-900">
          {t('family:invite.title')}
        </h2>
        <p className="mt-1 text-base text-gray-500">{t('family:invite.subtitle')}</p>

        <div data-testid="invite-choices" className="mt-5 flex flex-col gap-3">
          {isOwnerRole(currentUser?.role) && (
            <Choice
              emoji="👨‍👩‍👧"
              title={t('family:invite.typeParent')}
              hint={t('family:invite.typeParentHint')}
              body={t('family:invite.typeParentBody')}
              cta={t('family:invite.continue')}
              onClick={() => setShowAdultInvite(true)}
            />
          )}
          <Choice
            emoji="📱"
            title={t('family:invite.typeChild')}
            hint={t('family:invite.typeChildHint')}
            body={t('family:invite.typeChildBody')}
            cta={t('family:invite.continue')}
            onClick={() => startInvite('child')}
          />
          <Choice
            emoji="👶"
            title={t('family:invite.typeManaged')}
            hint={t('family:invite.typeManagedHint')}
            body={t('family:invite.typeManagedBody')}
            cta={t('family:invite.createManaged')}
            onClick={openManagedChild}
          />
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Step 2 — the invitation is ready to share
  // -------------------------------------------------------------------------
  const isParent = role === 'parent';

  return (
    <div className="mx-auto w-full max-w-md text-center">
      {creating && (
        <div className="flex flex-col items-center py-10">
          <Loader2 className="h-8 w-8 animate-spin text-primary-500" aria-hidden="true" />
          <p className="mt-4 text-base font-medium text-gray-700">{t('family:invite.creating')}</p>
        </div>
      )}

      {!creating && failed && (
        <div className="flex flex-col items-center py-8">
          <AlertTriangle className="h-8 w-8 text-red-500" aria-hidden="true" />
          <p className="mt-3 text-base text-red-600" role="alert">
            {t('family:invite.linkFailed')}
          </p>
          <Button
            className={`mt-5 w-full ${TOUCH}`}
            onClick={() => role && startInvite(role)}
          >
            {t('family:invite.retry')}
          </Button>
          <button
            type="button"
            onClick={back}
            className={`mt-3 w-full text-sm font-medium text-gray-500 underline underline-offset-4 ${TOUCH}`}
          >
            {t('family:invite.inviteSomeoneElse')}
          </button>
        </div>
      )}

      {!creating && !failed && (
        <>
          {/* Success illustration — deliberately the only decorative element. */}
          <div className="mx-auto flex h-24 w-24 animate-[pulse_1s_ease-out_1] items-center justify-center rounded-full bg-primary-50 text-5xl">
            <span aria-hidden="true">{isParent ? '👨‍👩‍👧' : '📱'}</span>
          </div>

          <h2
            ref={titleRef}
            tabIndex={-1}
            className="mt-5 text-2xl font-bold tracking-tight text-gray-900 outline-none"
          >
            {isParent ? t('family:invite.readyParent') : t('family:invite.readyChild')}
          </h2>
          <p className="mt-2 text-base text-gray-500">
            {isParent ? t('family:invite.readyParentBody') : t('family:invite.readyChildBody')}
          </p>

          <p role="status" aria-live="polite" className="mt-3 text-sm font-medium text-green-600">
            {feedback === 'copied'
              ? t('family:invite.copied')
              : t('family:invite.readyAnnouncement')}
          </p>

          <div className="mt-5 flex flex-col gap-3">
            <Button
              data-invite-action="primary"
              className={`w-full justify-center text-base ${TOUCH}`}
              onClick={share}
            >
              <Share2 size={18} className="mr-2" aria-hidden="true" />
              {t('family:invite.shareInvitation')}
            </Button>
            <Button
              data-invite-action="primary"
              variant="secondary"
              className={`w-full justify-center text-base ${TOUCH}`}
              onClick={() => copy(url)}
            >
              {feedback === 'copied' ? (
                <Check size={18} className="mr-2" aria-hidden="true" />
              ) : (
                <Copy size={18} className="mr-2" aria-hidden="true" />
              )}
              {t('family:invite.copyLink')}
            </Button>
          </div>

          <button
            type="button"
            onClick={back}
            className={`mt-4 w-full text-sm font-medium text-primary-700 underline underline-offset-4 ${TOUCH}`}
          >
            {t('family:invite.inviteSomeoneElse')}
          </button>

          {/* Secondary fallback — collapsed, quiet, never competing. */}
          <div className="mt-6 border-t border-gray-100 pt-3 text-left">
            <button
              type="button"
              aria-expanded={showManual}
              aria-controls="invite-manual-code"
              onClick={() => setShowManual(current => !current)}
              className={`flex w-full items-center justify-between text-sm text-gray-400 ${TOUCH}`}
            >
              {t('family:invite.advanced')}
              <ChevronDown
                size={16}
                aria-hidden="true"
                className={showManual ? 'rotate-180 transition' : 'transition'}
              />
            </button>
            {showManual && (
              <div
                id="invite-manual-code"
                className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-xs text-gray-400">{t('family:invite.manualCode')}</p>
                  <p className="font-mono text-sm font-semibold tracking-widest text-gray-600">
                    {familyCode || '—'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className={TOUCH}
                  disabled={!familyCode}
                  onClick={() => copy(familyCode)}
                >
                  {t('family:invite.copyCode')}
                </Button>
              </div>
            )}
          </div>

          {feedback === 'error' && (
            <p className="mt-3 text-sm text-red-600" role="alert">
              {t('family:invite.linkFailed')}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** One large, obvious, single-purpose invite choice. */
function Choice({
  emoji,
  title,
  hint,
  body,
  cta,
  onClick,
}: {
  emoji: string;
  title: string;
  hint: string;
  body: string;
  cta: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group w-full rounded-2xl border border-gray-200 bg-white p-4 text-left transition hover:border-primary-400 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 ${TOUCH}`}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-2xl">
          {emoji}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-gray-900">{title}</p>
          <p className="mt-0.5 text-sm text-gray-600">{hint}</p>
          <p className="mt-1 text-sm text-gray-500">{body}</p>
        </div>
      </div>
      <span className="mt-3 flex w-full items-center justify-center rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition group-hover:bg-primary-700">
        {cta}
      </span>
    </button>
  );
}
