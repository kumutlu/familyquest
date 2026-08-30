import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/Button';
import { signUp, signInWithGoogle } from '../lib/api';
import { useStore } from '../store/useStore';
import { postAuthDestination } from '../lib/inviteLink';
import { PublicAuthShell } from '../onboarding/components/PublicAuthShell';
import { OnboardingVisual } from '../onboarding/components/OnboardingVisual';
import { FamilyHomeScene } from '../onboarding/visuals/OnboardingScenes';
import { bindPendingInviteToUid, readPendingInvite } from '../auth/pendingInviteIntent';
import { safeInternalReturnPath } from '../lib/googleRedirectAuth';
import { mapAuthErrorKey } from '../auth/authErrorMessage';
import { readCreateFamilyIntent } from '../auth/createFamilyIntent';

export function Signup() {
  const { t } = useTranslation(['auth', 'common']);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const authStatus = useStore(state => state.authStatus);
  const authUser = useStore(state => state.authUser);
  const navigationStarted = useRef(false);

  // When the visitor reached signup from the pre-auth onboarding flow, return
  // them to /onboarding after auth so the post-auth setup (P1–P3) resumes. The
  // value is validated to avoid an open redirect.
  const returnTo = safeInternalReturnPath(new URLSearchParams(location.search).get('next'));
  const pendingInvite = readPendingInvite();
  const pendingInvitePath = pendingInvite
    ? `/invite/${encodeURIComponent(pendingInvite.token)}`
    : null;
  const authReturnPath = pendingInvitePath ?? returnTo;
  const loginPath = authReturnPath
    ? `/login?next=${encodeURIComponent(authReturnPath)}`
    : '/login';

  // Once Firebase Auth reports the user as authenticated, the AppLayout route
  // guard performs the redirect to the correct protected route.
  useEffect(() => {
    if (authStatus !== 'authenticated' || !authUser?.uid || navigationStarted.current) return;

    try {
      bindPendingInviteToUid(authUser.uid);
    } catch {
      // The canonical invite route owns stable account-mismatch UX.
    }

    const resumedInvite = readPendingInvite();
    const resumedCreate = !resumedInvite
      && returnTo === '/onboarding'
      && readCreateFamilyIntent(authUser.uid) !== null;
    const destination = resumedInvite
      ? `/invite/${encodeURIComponent(resumedInvite.token)}`
      : resumedCreate
        ? '/onboarding?mode=create'
        : returnTo ?? postAuthDestination('/');
    navigationStarted.current = true;
    navigate(destination, { replace: true });
  }, [authStatus, authUser?.uid, navigate, returnTo]);

  if (authStatus === 'authenticated') {
    return null;
  }

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSigningIn(true);
    setError('');
    try {
      await signUp(email, password, name);
      // Do not navigate here. The route guard redirects once auth is ready.
    } catch (err: any) {
      setError(t(mapAuthErrorKey(err, { pendingInvite: pendingInvite !== null })));
      setSigningIn(false);
    }
  };

  const handleGoogleSignup = async () => {
    setSigningIn(true);
    setError('');
    try {
      await signInWithGoogle();
      // Do not navigate here. The route guard redirects once auth is ready.
    } catch (err: any) {
      setError(t(mapAuthErrorKey(err, { pendingInvite: pendingInvite !== null })));
      setSigningIn(false);
    }
  };

  const inputClass = 'block min-h-12 w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-100 dark:placeholder-slate-500';

  return (
    <PublicAuthShell
      visual={<OnboardingVisual title={t('auth:createParentAccount')}><FamilyHomeScene label={t('auth:createParentAccount')} /></OnboardingVisual>}
      visualTitle={t('auth:createParentAccount')}
    >
      <div className="text-center lg:text-left">
        <h1 className="text-3xl font-extrabold text-gray-900 dark:text-slate-50">{t('auth:createParentAccount')}</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-slate-300">{t('auth:createParentSubtitle')}</p>
      </div>

      <div className="mt-6">
        <div className="rounded-[1.75rem] border border-white/80 bg-white/90 px-5 py-7 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/90 sm:px-8">
          <form className="space-y-6" onSubmit={handleSignup}>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">{t('auth:displayName')}</label>
              <div className="mt-1">
                <input type="text" required value={name} onChange={e => setName(e.target.value)} className={inputClass} />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">{t('auth:emailAddress')}</label>
              <div className="mt-1">
                <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className={inputClass} />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">{t('auth:password')}</label>
              <div className="mt-1">
                <input type="password" required value={password} onChange={e => setPassword(e.target.value)} className={inputClass} />
              </div>
            </div>

            {error && <div role="alert" className="mb-4 text-red-500 text-sm">{error}</div>}

            <Button type="submit" fullWidth disabled={signingIn}>
              {signingIn ? t('auth:signingIn') : t('auth:signUp')}
            </Button>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-white px-2 text-gray-500 dark:bg-slate-900 dark:text-slate-400">{t('auth:orContinueWith')}</span>
              </div>
            </div>

            <div className="mt-6">
              <button
                type="button"
                onClick={handleGoogleSignup}
                disabled={signingIn}
                className="flex min-h-12 w-full items-center justify-center gap-3 rounded-2xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                {t('auth:continueWithGoogle')}
              </button>
            </div>
          </div>

          <div className="mt-6 text-center">
            <Link to={loginPath} className="text-sm font-medium text-primary-600 hover:text-primary-500">{t('auth:hasAccount')} {t('auth:signIn')}</Link>
          </div>
        </div>
      </div>
    </PublicAuthShell>
  );
}
