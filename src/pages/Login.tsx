import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AppWindow, ListChecks, Wallet, Gift, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/Button';
import { GoogleButton } from '../components/ui/GoogleButton';
import { signIn, signInWithGoogle } from '../lib/api';
import { signInChild, mapSignInChildError, normalizeUsernamePreview } from '../lib/childLoginApi';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { useStore } from '../store/useStore';
import { postAuthDestination } from '../lib/inviteLink';
import { bindPendingInviteToUid, readPendingInvite } from '../auth/pendingInviteIntent';
import { safeInternalReturnPath } from '../lib/googleRedirectAuth';
import { mapAuthErrorKey } from '../auth/authErrorMessage';
import { readCreateFamilyIntent } from '../auth/createFamilyIntent';

type LoginTab = 'parent' | 'child';

export function Login() {
  const { t } = useTranslation(['auth', 'common']);
  const [tab, setTab] = useState<LoginTab>('parent');
  const [logoFailed, setLogoFailed] = useState(false);

  // Parent credentials
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Child credentials (no email — only Family Code, username, password)
  const [familyCode, setFamilyCode] = useState('');
  const [username, setUsername] = useState('');
  const [childPassword, setChildPassword] = useState('');

  const [error, setError] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const authStatus = useStore(state => state.authStatus);
  const authUser = useStore(state => state.authUser);
  const bootstrapError = useStore(state => state.bootstrapError);
  const navigationStarted = useRef(false);

  const validatedNext = safeInternalReturnPath(new URLSearchParams(location.search).get('next'));
  const pendingInvite = readPendingInvite();
  const pendingInvitePath = pendingInvite
    ? `/invite/${encodeURIComponent(pendingInvite.token)}`
    : null;
  const authReturnPath = pendingInvitePath ?? validatedNext;
  const signupPath = authReturnPath
    ? `/signup?next=${encodeURIComponent(authReturnPath)}`
    : '/signup';

  useEffect(() => {
    if (bootstrapError === 'Google sign-in could not be completed. Please try again.') {
      setError(t('auth:googleRedirectStateError'));
    }
  }, [bootstrapError, t]);

  // Initial focus on Family Code when the Child tab is shown (accessibility).
  const familyCodeRef = useRef<HTMLInputElement>(null);

  // Once Firebase Auth reports the user as authenticated, the AppLayout route
  // guard performs the redirect to the correct protected route (the child
  // dashboard for a managed child). We must NOT navigate during render (calling
  // navigate() in the render body triggers React's "Cannot update a component
  // while rendering a different component" warning and can corrupt the mounted
  // tree). Defer it to an effect.
  useEffect(() => {
    if (authStatus !== 'authenticated' || !authUser?.uid || navigationStarted.current) return;

    try {
      bindPendingInviteToUid(authUser.uid);
    } catch {
      // The canonical invite route owns stable account-mismatch UX.
    }

    const resumedInvite = readPendingInvite();
    const resumedCreate = !resumedInvite
      && validatedNext === '/onboarding'
      && readCreateFamilyIntent(authUser.uid) !== null;
    const destination = resumedInvite
      ? `/invite/${encodeURIComponent(resumedInvite.token)}`
      : resumedCreate
        ? '/onboarding?mode=create'
        : validatedNext ?? postAuthDestination('/');
    navigationStarted.current = true;
    navigate(destination, { replace: true });
  }, [authStatus, authUser?.uid, navigate, validatedNext]);

  // Move focus to the first field of the Child form whenever that tab is shown.
  useEffect(() => {
    if (tab === 'child') {
      familyCodeRef.current?.focus();
    }
  }, [tab]);

  if (authStatus === 'authenticated') {
    return null;
  }

  const handleParentLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSigningIn(true);
    setError('');
    try {
      await signIn(email, password);
      // Do not navigate here. The route guard redirects once auth is ready.
    } catch (err: any) {
      setError(t(mapAuthErrorKey(err, { pendingInvite: pendingInvite !== null })));
      setSigningIn(false);
    }
  };

  const handleGoogleLogin = async () => {
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

  const handleChildLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Client-side required-field validation (friendly, generic — never reveals
    // which specific field is missing beyond the obvious prompt).
    const trimmedFamily = familyCode.trim();
    const trimmedUsername = username.trim();
    if (!trimmedFamily || !trimmedUsername || !childPassword) {
      setError(t('auth:childFieldsRequired'));
      return;
    }

    setSigningIn(true);
    try {
      // 1. Exchange (familyCode, username, password) for a Firebase custom token.
      //    The backend resolves the private synthetic email server-side and
      //    returns ONLY the custom token. The frontend never sees an email.
      const { customToken } = await signInChild({
        familyCode: trimmedFamily,
        username: normalizeUsernamePreview(trimmedUsername),
        password: childPassword,
      });

      // 2. Authenticate with the custom token. The existing auth bootstrap
      //    (onAuthStateChanged) then refreshes the user profile, role, and
      //    family, and the route guard redirects to the child dashboard.
      await signInWithCustomToken(auth, customToken);

      // 3. Clear the password from memory immediately after a successful
      //    exchange. We never cache it, never log it, and never store it in
      //    Zustand.
      setChildPassword('');
    } catch (err: unknown) {
      // Generic error only — never reveal whether the family, username, or
      // password was the problem.
      setError(mapSignInChildError(err));
      // Clear the password after a failed attempt (do not cache it).
      setChildPassword('');
      setSigningIn(false);
    }
  };

  // The Queki brand mark. Rendered exactly once (a second instance would break
  // the fallback contract). Falls back to a neutral icon — never a letter —
  // when the SVG fails to load.
  const brandMark = logoFailed ? (
    <span
      aria-hidden="true"
      className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 text-white"
    >
      <AppWindow size={26} />
    </span>
  ) : (
    <img
      src="/favicon.svg"
      alt="Queki"
      className="h-11 w-11 rounded-xl bg-white/10 p-1"
      onError={() => setLogoFailed(true)}
    />
  );

  // Abstract representation of Queki's loop: effort becomes points, points
  // unlock rewards, and rewards feed savings. Decorative only.
  const systemNodes = [
    { key: 'tasks', label: t('auth:intro.systemTasks'), icon: <ListChecks size={18} /> },
    { key: 'points', label: t('auth:intro.systemPoints'), icon: <span className="text-base font-bold leading-none">★</span> },
    { key: 'rewards', label: t('auth:intro.systemRewards'), icon: <Gift size={18} /> },
    { key: 'savings', label: t('auth:intro.systemSavings'), icon: <Wallet size={18} /> },
  ];

  return (
    <div data-testid="public-auth-shell" className="min-h-dvh bg-gradient-to-br from-amber-50 via-white to-indigo-50 dark:from-slate-950 dark:via-slate-950 dark:to-indigo-950 lg:grid lg:grid-cols-[45%_55%]">
      {/* ------------------------------------------------------------------ */}
      {/* Left: brand area (desktop only). A deliberate, premium composition   */}
      {/* that makes the page feel intentionally designed rather than a form   */}
      {/* floating in empty space.                                            */}
      {/* ------------------------------------------------------------------ */}
      <aside
        aria-label={t('auth:intro.aboutLabel')}
        className="relative hidden overflow-hidden bg-gradient-to-br from-purple-600 via-primary-600 to-indigo-700 px-6 py-10 text-white dark:from-purple-700 dark:via-indigo-700 dark:to-violet-950 lg:flex lg:flex-col lg:justify-center lg:px-16 lg:py-12"
      >
        {/* Soft glows for depth — restrained, not childish. */}
        <div aria-hidden="true" className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-white/20 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -right-16 h-80 w-80 rounded-full bg-purple-300/30 blur-3xl" />

        <div className="relative mx-auto w-full max-w-lg">
          {/* Brand */}
          <div className="flex items-center gap-3">
            {brandMark}
            <span className="text-xl font-bold tracking-tight">{t('auth:intro.brand')}</span>
          </div>

          {/* Headline + supporting copy */}
          <h1 className="mt-10 text-4xl font-extrabold leading-tight lg:text-[2.75rem]">
            {t('auth:intro.brandHeadline')}
          </h1>
          <p className="mt-4 text-lg text-white/80">{t('auth:intro.supporting')}</p>

          {/* System visualization: Tasks → Points → Rewards → Savings */}
          <div aria-hidden="true" className="mt-10">
            <p className="text-xs font-semibold uppercase tracking-wider text-white/70">
              {t('auth:intro.systemCaption')}
            </p>
            <div className="mt-4 flex items-center gap-2">
              {systemNodes.map((node, i) => (
                <Fragment key={node.key}>
                  <div className="flex-1 rounded-2xl bg-white/10 p-3 text-center backdrop-blur-sm">
                    <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 text-white">
                      {node.icon}
                    </div>
                    <p className="text-xs font-semibold">{node.label}</p>
                  </div>
                  {i < systemNodes.length - 1 && (
                    <ArrowRight size={16} className="shrink-0 text-white/60" aria-hidden="true" />
                  )}
                </Fragment>
              ))}
            </div>
            {/* Progress motif — abstract, not a cartoon. */}
            <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-white/15">
              <div className="h-full w-3/4 rounded-full bg-white/70" />
            </div>
          </div>

          {/* Tasteful example chips (decorative). */}
          <div aria-hidden="true" className="mt-6 flex flex-wrap gap-2">
            <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium backdrop-blur-sm">
              {t('auth:intro.exampleHomework')} · {t('auth:intro.exampleHomeworkPoints')}
            </span>
            <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium backdrop-blur-sm">
              {t('auth:intro.exampleGoal')} · {t('auth:intro.exampleGoalProgress')}
            </span>
            <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium backdrop-blur-sm">
              {t('auth:intro.exampleSaved')} · {t('auth:intro.exampleSavedAmount')}
            </span>
          </div>
        </div>
      </aside>

      {/* ------------------------------------------------------------------ */}
      {/* Right: authentication card (logic unchanged).                      */}
      {/* ------------------------------------------------------------------ */}
      <main className="flex flex-col justify-center px-4 py-8 sm:px-6 lg:px-10">
        {/* Compact brand header on mobile (the left panel is hidden). Text
            wordmark only — the single logo <img> instance lives in the desktop
            brand area to preserve the fallback-contract (exactly one logo). */}
        <div className="mb-6 flex items-center gap-2 lg:hidden">
          <span className="text-lg font-bold tracking-tight text-gray-900">{t('auth:intro.brand')}</span>
        </div>

        <div className="mx-auto w-full max-w-[420px]">
          <div className="mb-6 text-center lg:text-left">
            <h2 className="text-2xl font-extrabold text-gray-900 sm:text-3xl">
              {t('auth:welcomeBack')}
            </h2>
            <p className="mt-2 text-sm text-gray-500">{t('auth:welcomeBackSubtitle')}</p>
          </div>

          <div className="rounded-[1.75rem] border border-white/80 bg-white/90 p-6 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/90 sm:p-8">
            {/* Tab switcher */}
            <div role="tablist" aria-label={t('auth:chooseSignInMethod')} className="mb-6 flex border-b border-gray-200">
              <button
                type="button"
                role="tab"
                id="tab-parent"
                aria-selected={tab === 'parent'}
                aria-controls="panel-parent"
                onClick={() => setTab('parent')}
                className={`-mb-px flex-1 min-h-[44px] py-2 text-sm font-medium border-b-2 ${
                  tab === 'parent'
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t('auth:parent')}
              </button>
              <button
                type="button"
                role="tab"
                id="tab-child"
                aria-selected={tab === 'child'}
                aria-controls="panel-child"
                onClick={() => setTab('child')}
                className={`-mb-px flex-1 min-h-[44px] py-2 text-sm font-medium border-b-2 ${
                  tab === 'child'
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t('auth:child')}
              </button>
            </div>

            {error && (
              <div role="alert" className="mb-4 text-sm text-red-500">
                {error}
              </div>
            )}

            {/* Parent panel (logic unchanged) */}
            {tab === 'parent' && (
              <div role="tabpanel" id="panel-parent" aria-labelledby="tab-parent">
                <form className="space-y-6" onSubmit={handleParentLogin}>
                  <div>
                    <label htmlFor="parent-email" className="block text-sm font-medium text-gray-700">{t('auth:emailAddress')}</label>
                    <div className="mt-1">
                      <input
                        id="parent-email"
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        className="block w-full min-h-[44px] rounded-md border border-gray-300 px-3 py-2 text-gray-900 shadow-sm placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-primary-500 sm:text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="parent-password" className="block text-sm font-medium text-gray-700">{t('auth:password')}</label>
                    <div className="mt-1">
                      <input
                        id="parent-password"
                        type="password"
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        className="block w-full min-h-[44px] rounded-md border border-gray-300 px-3 py-2 text-gray-900 shadow-sm placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-primary-500 sm:text-sm"
                      />
                    </div>
                  </div>

                  <Button type="submit" fullWidth disabled={signingIn}>
                    {signingIn ? t('auth:signingIn') : t('auth:signIn')}
                  </Button>
                </form>

                <div className="mt-6">
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-gray-300" />
                    </div>
                    <div className="relative flex justify-center text-sm">
                      <span className="bg-white px-2 text-gray-500">{t('auth:orContinueWith')}</span>
                    </div>
                  </div>

                  <div className="mt-6">
                    <GoogleButton onClick={handleGoogleLogin} disabled={signingIn}>
                      {t('auth:signInWithGoogle')}
                    </GoogleButton>
                  </div>
                </div>

                <div className="mt-6 text-center">
                  <Link to={signupPath} className="text-sm font-medium text-primary-600 hover:text-primary-500">{t('auth:noAccount')} {t('auth:signUp')}</Link>
                </div>
              </div>
            )}

            {/* Child panel (Phase 3, logic unchanged) */}
            {tab === 'child' && (
              <div role="tabpanel" id="panel-child" aria-labelledby="tab-child">
                <h3 className="mb-4 text-lg font-semibold text-gray-900">{t('auth:childSignIn')}</h3>
                <form className="space-y-6" onSubmit={handleChildLogin} noValidate>
                  <div>
                    <label htmlFor="child-family-code" className="block text-sm font-medium text-gray-700">{t('auth:familyCode')}</label>
                    <div className="mt-1">
                      <input
                        id="child-family-code"
                        ref={familyCodeRef}
                        type="text"
                        autoComplete="off"
                        required
                        value={familyCode}
                        onChange={e => setFamilyCode(e.target.value)}
                        className="block w-full min-h-[44px] rounded-md border border-gray-300 px-3 py-2 text-gray-900 shadow-sm placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-primary-500 sm:text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="child-username" className="block text-sm font-medium text-gray-700">{t('auth:username')}</label>
                    <div className="mt-1">
                      <input
                        id="child-username"
                        type="text"
                        autoComplete="username"
                        required
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        className="block w-full min-h-[44px] rounded-md border border-gray-300 px-3 py-2 text-gray-900 shadow-sm placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-primary-500 sm:text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="child-password" className="block text-sm font-medium text-gray-700">{t('auth:password')}</label>
                    <div className="mt-1">
                      <input
                        id="child-password"
                        type="password"
                        autoComplete="current-password"
                        required
                        value={childPassword}
                        onChange={e => setChildPassword(e.target.value)}
                        className="block w-full min-h-[44px] rounded-md border border-gray-300 px-3 py-2 text-gray-900 shadow-sm placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-primary-500 sm:text-sm"
                      />
                    </div>
                  </div>

                  <Button type="submit" fullWidth disabled={signingIn}>
                    {signingIn ? t('auth:signingIn') : t('auth:signIn')}
                  </Button>
                </form>

                <div className="mt-6 text-center">
                  <Link to="/join-family" className="text-sm font-medium text-primary-600 hover:text-primary-500">{t('auth:firstTimeHere')} {t('auth:joinYourFamily')}</Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
