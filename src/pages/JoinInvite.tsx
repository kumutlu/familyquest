import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/Button';
import { useStore } from '../store/useStore';
import {
  acceptInvitation,
  previewInvitation,
  type InvitationPreview,
} from '../lib/familyInvitationApi';
import {
  buildJoinUrl,
  clearPendingInvite,
  isLegacyInviteCode,
  mapInvitationErrorKey,
  readCodeFromSearch,
  readLegacyInviteCode,
  rememberPendingInvite,
  type InvitationErrorKey,
} from '../lib/inviteLink';
import { PublicAuthShell } from '../onboarding/components/PublicAuthShell';
import { OnboardingVisual } from '../onboarding/components/OnboardingVisual';
import { CodeInvitationScene } from '../onboarding/visuals/OnboardingScenes';

type Phase = 'validating' | 'invalid' | 'ready' | 'joining' | 'pending';

const TERMINAL_INVITATION_ERRORS = new Set<InvitationErrorKey>([
  'family:join.invalid',
  'family:join.expired',
  'family:join.revoked',
  'family:join.used',
  'family:join.alreadyInThisFamily',
]);

/**
 * Code-specific join route (`/join?code=XXXXXX`).
 *
 * SECURITY BOUNDARY: the URL carries a code and nothing else. The resulting
 * role is decided entirely by the server-side invitation record, so editing the
 * URL (for example adding `type=parent`) has no effect. No family information
 * is rendered until `previewInvitation` has validated the code.
 */
export function JoinInvite() {
  const { t } = useTranslation(['family', 'common', 'auth']);
  const location = useLocation();
  const navigate = useNavigate();
  const authStatus = useStore(state => state.authStatus);
  const currentUser = useStore(state => state.currentUser);
  const hasInvalidUrlCode = new URLSearchParams(location.search).has('code')
    && !isLegacyInviteCode(readCodeFromSearch(location.search));

  // The code survives sign-up, sign-in, provider redirects and refreshes.
  const [code] = useState(() => {
    const hasUrlCode = new URLSearchParams(location.search).has('code');
    const urlCode = readCodeFromSearch(location.search);
    // A supplied URL owns this route; never replace an opaque/malformed value
    // with unrelated legacy storage intent.
    if (hasUrlCode) return isLegacyInviteCode(urlCode) ? urlCode : '';
    return readLegacyInviteCode();
  });
  const [phase, setPhase] = useState<Phase>('validating');
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [errorKey, setErrorKey] = useState<InvitationErrorKey | null>(null);

  useEffect(() => {
    if (code) rememberPendingInvite(code);
  }, [code]);

  useEffect(() => {
    let cancelled = false;
    if (!code) {
      setPhase('invalid');
      setErrorKey(hasInvalidUrlCode ? 'family:join.invalid' : 'family:join.missingCode');
      if (hasInvalidUrlCode) clearPendingInvite();
      return;
    }
    setPhase('validating');
    previewInvitation(code)
      .then(result => {
        if (cancelled) return;
        setPreview(result);
        setPhase('ready');
      })
      .catch(error => {
        if (cancelled) return;
        const key = mapInvitationErrorKey(error);
        if (TERMINAL_INVITATION_ERRORS.has(key)) clearPendingInvite();
        setErrorKey(key);
        setPhase('invalid');
      });
    return () => { cancelled = true; };
  }, [code, hasInvalidUrlCode]);

  const handleAccept = useCallback(async () => {
    if (!code) return;
    setPhase('joining');
    setErrorKey(null);
    try {
      // No role is sent — the server derives it from the invitation record.
      await acceptInvitation(code);
      clearPendingInvite();
      setPhase('pending');
    } catch (error) {
      const key = mapInvitationErrorKey(error);
      if (TERMINAL_INVITATION_ERRORS.has(key)) clearPendingInvite();
      setErrorKey(key);
      setPhase('invalid');
    }
  }, [code]);

  const handleDecline = () => {
    clearPendingInvite();
    navigate('/');
  };

  const returnTo = code ? buildJoinUrl(code, '') : '/join';

  return (
    <PublicAuthShell
      visual={<OnboardingVisual title={t('family:join.title')}><CodeInvitationScene label={t('family:join.title')} /></OnboardingVisual>}
      visualTitle={t('family:join.title')}
      visualCopy={preview?.familyName}
    >
      <div className="rounded-[1.75rem] border border-white/80 bg-white/90 p-6 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/90 sm:p-8">
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-slate-50">{t('family:join.title')}</h1>

        {phase === 'validating' && (
          <p className="mt-4 text-sm text-gray-600" role="status">{t('family:join.validating')}</p>
        )}

        {phase === 'invalid' && (
          <>
            <p className="mt-4 text-sm text-red-600" role="alert">
              {t(errorKey ?? 'family:join.genericError')}
            </p>
            <div className="mt-6">
              {/* The manual family-code flow remains available. */}
              <Link to="/join-family" className="text-sm font-medium text-primary-600 hover:text-primary-500">
                {t('family:join.manualEntry')}
              </Link>
            </div>
          </>
        )}

        {(phase === 'ready' || phase === 'joining') && preview && (
          <>
            <p className="mt-5 rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-base font-semibold text-gray-800 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-slate-100">
              {preview.intendedRole === 'parent'
                ? t('family:join.confirmParent', { family: preview.familyName })
                : t('family:join.confirmChild', { family: preview.familyName })}
            </p>
            <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">
              {preview.intendedRole === 'parent'
                ? t('family:join.roleParent')
                : t('family:join.roleChild')}
            </p>

            {authStatus === 'unauthenticated' ? (
              <div className="mt-6 space-y-3">
                <p className="text-sm text-gray-600">{t('family:join.signInPrompt')}</p>
                <div className="flex gap-2">
                  <Link
                    to={`/login?redirect=${encodeURIComponent(returnTo)}`}
                    className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-medium text-white"
                  >
                    {t('family:join.signIn')}
                  </Link>
                  <Link
                    to={`/signup?redirect=${encodeURIComponent(returnTo)}`}
                    className="rounded-xl border border-primary-200 px-4 py-2 text-sm font-medium text-primary-700"
                  >
                    {t('family:join.signUp')}
                  </Link>
                </div>
              </div>
            ) : (
              <div className="mt-6 flex gap-2">
                {/* Nothing happens without this explicit confirmation. */}
                <Button onClick={handleAccept} disabled={phase === 'joining' || !currentUser}>
                  {phase === 'joining' ? t('family:join.joining') : t('family:join.confirm')}
                </Button>
                <Button variant="ghost" onClick={handleDecline} disabled={phase === 'joining'}>
                  {t('family:join.decline')}
                </Button>
              </div>
            )}
          </>
        )}

        {phase === 'pending' && (
          <>
            <h2 className="mt-4 text-base font-semibold text-gray-900">{t('family:join.pendingTitle')}</h2>
            <p className="mt-1 text-sm text-gray-600">{t('family:join.pendingBody')}</p>
            <Button className="mt-6" variant="secondary" onClick={() => navigate('/')}>
              {t('common:continue')}
            </Button>
          </>
        )}
      </div>
    </PublicAuthShell>
  );
}

export default JoinInvite;
