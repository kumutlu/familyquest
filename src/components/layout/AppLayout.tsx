import { Suspense, useEffect, useState } from 'react';
import { Link, Outlet, useLocation, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppWindow } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useStore } from '../../store/useStore';
import { getNavItems } from '../../config/navigation';
import { ProfileDropdown } from './ProfileDropdown';
import { NotificationCenter } from './NotificationCenter';
import { MandatoryChildPasswordChange } from '../auth/MandatoryChildPasswordChange';
import { ChildChallengeCelebration } from '../challenges/ChildChallengeCelebration';
import { StartupScreen } from './StartupScreen';
import { deriveStartupPhase } from './startupState';
import { signOut } from '../../lib/api';
import { markStartupStage } from '../../startupDiagnostics';

export function AppLayout() {
  const { t } = useTranslation('common');
  // Header brand mark. Falls back to a neutral generic app icon if the logo
  // asset fails to load — never a letter glyph.
  const [logoFailed, setLogoFailed] = useState(false);
  const location = useLocation();
  const authStatus = useStore(state => state.authStatus);
  const authUser = useStore(state => state.authUser);
  const currentUser = useStore(state => state.currentUser);
  const appReady = useStore(state => state.appReady);
  const bootstrapError = useStore(state => state.bootstrapError);
  const bootstrapAttempt = useStore(state => state.bootstrapAttempt);
  const retryBootstrap = useStore(state => state.retryBootstrap);

  // Single deterministic source of truth for the global startup gate. Each
  // non-ready phase renders the bounded StartupScreen, which times out into a
  // recoverable error instead of spinning forever.
  const startupPhase = deriveStartupPhase({
    authStatus,
    authUser,
    currentUser,
    appReady,
    bootstrapError,
  });

  useEffect(() => {
    if (startupPhase === 'ready') markStartupStage('ROUTE_RENDERED');
  }, [startupPhase]);

  if (startupPhase !== 'ready') {
    return (
      <StartupScreen
        phase={startupPhase}
        attempt={bootstrapAttempt}
        error={bootstrapError}
        onRetry={retryBootstrap}
        onSignOut={authUser ? () => { void signOut(); } : undefined}
      />
    );
  }

  // Not logged in -> Login
  if (authStatus === 'unauthenticated' || authUser === null) {
    return <Navigate to="/login" replace />;
  }

  // Logged in, user doc exists, but no familyId -> Onboarding (unless already there)
  if (currentUser && !currentUser.familyId && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }

  // Logged in with a family -> onboarding is complete and must never render
  // again, even when the route is opened directly or restored from history.
  if (currentUser?.familyId && location.pathname === '/onboarding') {
    return <Navigate to="/" replace />;
  }

  if (
    currentUser?.role === 'child' &&
    currentUser?.isManaged === true &&
    currentUser?.requiresPasswordChange === true
  ) {
    return <MandatoryChildPasswordChange />;
  }

  // Single source of truth for navigation, shared by the desktop header and the
  // mobile bottom navigation. See src/config/navigation.ts.
  const navItems = getNavItems();

  return (
    <div className="min-h-dvh bg-gray-50 flex flex-col font-sans">
      {/* Top Navigation (Desktop & Mobile Header) */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Link to="/" className="flex items-center space-x-2 hover:opacity-80 transition-opacity">
              {logoFailed ? (
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 items-center justify-center rounded-xl bg-gray-100 text-gray-400"
                >
                  <AppWindow size={18} />
                </span>
              ) : (
                <img
                  src="/favicon.svg"
                  alt="Queki"
                  className="h-8 w-8 rounded-xl"
                  onError={() => setLogoFailed(true)}
                />
              )}
              <span className="text-xl font-extrabold tracking-tight text-gray-900">Queki</span>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex ml-8 space-x-6">
              {navItems.map((item) => {
                const isActive = location.pathname === item.path;
                const IconComp = item.icon as any;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={cn(
                      "flex items-center space-x-2 text-sm font-bold transition-colors",
                      isActive ? "text-primary-600" : "text-gray-500 hover:text-gray-900"
                    )}
                  >
                    {typeof item.icon === 'function' ? <IconComp /> : <IconComp size={16} />}
                    <span>{t(item.labelKey)}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center space-x-4">
            <NotificationCenter />
            <ProfileDropdown />
          </div>
        </div>
      </header>

      {/* One-time child celebration for a claimed Family Challenge.
          Presentation only — driven by the persisted notification + its
          existing per-user read state. Renders nothing for parents. */}
      <ChildChallengeCelebration />

      {/* Main Content Area */}
      <main className="flex-1 max-w-5xl mx-auto w-full p-4 pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-8">
        <Suspense fallback={<div data-testid="route-translations-loading" aria-busy="true" className="h-40 animate-pulse rounded-2xl bg-gray-100" />}>
          <Outlet />
        </Suspense>
      </main>

      {/* Bottom Navigation (Mobile Only).
          Single shared instance owned by the app shell. It is the last child of
          the layout root and must never be nested inside transformed or
          scrolling containers, otherwise `position: fixed` would resolve
          against that ancestor instead of the viewport. */}
      <nav
        data-testid="mobile-bottom-nav"
        aria-label={t('nav.primary', { defaultValue: 'Primary' })}
        className="md:hidden fixed inset-x-0 bottom-0 bg-white border-t border-gray-100 pb-[env(safe-area-inset-bottom)] z-40"
        style={{ position: 'fixed', left: 0, right: 0, bottom: 0 }}
      >
        <div className="flex justify-around items-center h-16">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            const IconComp = item.icon as any;

            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors",
                  isActive ? "text-primary-600" : "text-gray-400 hover:text-gray-600"
                )}
              >
                <div className={cn(
                  "p-1 rounded-xl transition-all duration-200",
                  isActive ? "bg-primary-50 scale-110" : ""
                )}>
                  {typeof item.icon === 'function' ? <IconComp /> : <IconComp size={22} strokeWidth={isActive ? 2.5 : 2} />}
                </div>
                <span className="text-[10px] font-semibold">{t(item.labelKey)}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
