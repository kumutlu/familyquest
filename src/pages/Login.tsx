import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppWindow, ListChecks, Wallet, Gift } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/Button';
import { signIn, signInWithGoogle } from '../lib/api';
import { signInChild, mapSignInChildError, normalizeUsernamePreview } from '../lib/childLoginApi';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { useStore } from '../store/useStore';
import { postAuthDestination } from '../lib/inviteLink';

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
  const authStatus = useStore(state => state.authStatus);
  const bootstrapError = useStore(state => state.bootstrapError);

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
    if (authStatus === 'authenticated') {
      // Resume a pending invitation instead of the dashboard when the visitor
      // arrived from a /join link; the code survived the sign-in round trip.
      navigate(postAuthDestination('/'), { replace: true });
    }
  }, [authStatus, navigate]);

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
      setError(err.message);
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
      setError(err.message);
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
      className="w-11 h-11 bg-white/15 rounded-xl flex items-center justify-center text-white"
    >
      <AppWindow size={26} />
    </span>
  ) : (
    <img
      src="/favicon.svg"
      alt="Queki"
      className="w-11 h-11 rounded-xl bg-white/10 p-1"
      onError={() => setLogoFailed(true)}
    />
  );

  const benefits = [
    { icon: ListChecks, label: t('auth:intro.benefitTasks') },
    { icon: Wallet, label: t('auth:intro.benefitWallets') },
    { icon: Gift, label: t('auth:intro.benefitRewards') },
  ];

  return (
    <div className="min-h-screen bg-gray-50 lg:grid lg:grid-cols-2">
      {/* ------------------------------------------------------------------ */}
      {/* Left: product introduction. On mobile this collapses to a compact  */}
      {/* intro above the form; the detailed preview cards are hidden.        */}
      {/* ------------------------------------------------------------------ */}
      <aside
        aria-label={t('auth:intro.aboutLabel')}
        className="bg-gradient-to-br from-primary-600 to-primary-800 text-white px-6 py-5 sm:px-10 sm:py-6 lg:px-16 lg:py-12 flex flex-col justify-center"
      >
        <div className="mx-auto w-full max-w-md lg:max-w-lg">
          {/* Brand */}
          <div className="flex items-center gap-3">
            {brandMark}
            <span className="text-xl font-bold tracking-tight">{t('auth:intro.brand')}</span>
          </div>

          {/* Headline + supporting copy. On phones the intro must stay compact
              so the auth card remains near the top of the viewport, so the
              supporting paragraph is desktop-only. */}
          <h1 className="mt-3 lg:mt-10 text-lg sm:text-xl lg:text-4xl font-extrabold leading-tight">
            {t('auth:intro.headline')}
          </h1>
          <p className="mt-3 lg:mt-4 text-sm sm:text-base lg:text-lg text-primary-100 hidden lg:block">
            {t('auth:intro.supporting')}
          </p>

          {/* Benefits — desktop only; on phones they would push the sign-in
              form below the fold. */}
          <ul className="mt-6 lg:mt-8 space-y-3 lg:space-y-4 hidden lg:block">
            {benefits.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white/15"
                >
                  <Icon size={18} />
                </span>
                <span className="text-sm sm:text-base font-medium leading-snug">{label}</span>
              </li>
            ))}
          </ul>

          {/* Product preview — decorative, desktop only. Marked aria-hidden so
              screen readers skip the illustrative sample data. */}
          <div aria-hidden="true" className="mt-10 hidden lg:grid grid-cols-1 gap-4">
            <div className="rounded-2xl bg-white/95 p-4 text-gray-900 shadow-lg">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                {t('auth:intro.previewTasksTitle')}
              </p>
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <ListChecks size={16} className="text-primary-500" />
                    {t('auth:intro.previewTask1')}
                  </span>
                  <span className="text-sm font-semibold text-success-500">
                    +10 {t('auth:intro.previewPointsSuffix')}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <ListChecks size={16} className="text-primary-500" />
                    {t('auth:intro.previewTask2')}
                  </span>
                  <span className="text-sm font-semibold text-success-500">
                    +15 {t('auth:intro.previewPointsSuffix')}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-2xl bg-white/95 p-4 text-gray-900 shadow-lg">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  <Wallet size={14} /> {t('auth:intro.previewWalletTitle')}
                </p>
                <p className="mt-2 text-xs text-gray-500">{t('auth:intro.previewWalletLabel')}</p>
                <p className="text-2xl font-extrabold text-gray-900">120</p>
              </div>
              <div className="rounded-2xl bg-white/95 p-4 text-gray-900 shadow-lg">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  <Gift size={14} /> {t('auth:intro.previewRewardsTitle')}
                </p>
                <div className="mt-3 flex items-center justify-between rounded-lg bg-reward-400/15 px-3 py-2">
                  <span className="text-sm font-medium">{t('auth:intro.previewReward1')}</span>
                  <span className="text-sm font-semibold text-reward-500">
                    50 {t('auth:intro.previewPointsSuffix')}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* ------------------------------------------------------------------ */}
      {/* Right: existing authentication card (logic unchanged).             */}
      {/* ------------------------------------------------------------------ */}
      <main className="flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900">
            {t('auth:signInTitle', { appName: t('common:appName') })}
          </h2>
        </div>

        <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
            {/* Tab switcher */}
            <div role="tablist" aria-label={t('auth:chooseSignInMethod')} className="flex border-b border-gray-200 mb-6">
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
              <div role="alert" className="mb-4 text-red-500 text-sm">
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
                        className="appearance-none block w-full min-h-[44px] px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
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
                        className="appearance-none block w-full min-h-[44px] px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
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
                      <span className="px-2 bg-white text-gray-500">{t('auth:orContinueWith')}</span>
                    </div>
                  </div>

                  <div className="mt-6">
                    <button
                      type="button"
                      onClick={handleGoogleLogin}
                      disabled={signingIn}
                      className="w-full min-h-[44px] flex items-center justify-center gap-3 px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary-500 disabled:opacity-60"
                    >
                      <svg className="h-5 w-5" viewBox="0 0 24 24">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                      </svg>
                      {t('auth:signInWithGoogle')}
                    </button>
                  </div>
                </div>

                <div className="mt-6 text-center">
                  <Link to="/signup" className="text-sm font-medium text-primary-600 hover:text-primary-500">{t('auth:noAccount')} {t('auth:signUp')}</Link>
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
                        className="appearance-none block w-full min-h-[44px] px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
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
                        className="appearance-none block w-full min-h-[44px] px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
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
                        className="appearance-none block w-full min-h-[44px] px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
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
