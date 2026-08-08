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
  mapInvitationErrorKey,
  readCodeFromSearch,
  readPendingInvite,
  rememberPendingInvite,
  type InvitationErrorKey,
} from '../lib/inviteLink';

type Phase = 'validating' | 'invalid' | 'ready' | 'joining' | 'pending';

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

  // The code survives sign-up, sign-in, provider redirects and refreshes.
  const [code] = useState(() => readCodeFromSearch(location.search) || readPendingInvite());
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
      setErrorKey('family:join.missingCode');
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
        setErrorKey(mapInvitationErrorKey(error));
        setPhase('invalid');
      });
    return () => { cancelled = true; };
  }, [code]);

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
      setErrorKey(mapInvitationErrorKey(error));
      setPhase('invalid');
    }
  }, [code]);

  const handleDecline = () => {
    clearPendingInvite();
    navigate('/');
  };

  const returnTo = code ? buildJoinUrl(code, '') : '/join';

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-gray-900">{t('family:join.title')}</h1>

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
            <p className="mt-4 text-base text-gray-800">
              {preview.intendedRole === 'parent'
                ? t('family:join.confirmParent', { family: preview.familyName })
                : t('family:join.confirmChild', { family: preview.familyName })}
            </p>
            <p className="mt-1 text-sm text-gray-500">
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
    </div>
  );
}

export default JoinInvite;
