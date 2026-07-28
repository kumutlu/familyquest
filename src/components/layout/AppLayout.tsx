import { useState } from 'react';
import { Link, Outlet, useLocation, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { useStore } from '../../store/useStore';
import { getNavItems } from '../../config/navigation';
import { ProfileDropdown } from './ProfileDropdown';
import { NotificationCenter } from './NotificationCenter';
import { shouldShowFamilySetupPrompt } from '../../lib/familySetup';
import { FamilySetupPrompt } from '../family/FamilySetupPrompt';

export function AppLayout() {
  const { t } = useTranslation('common');
  const [setupPromptHidden, setSetupPromptHidden] = useState(false);
  const location = useLocation();
  const authStatus = useStore(state => state.authStatus);
  const authUser = useStore(state => state.authUser);
  const currentUser = useStore(state => state.currentUser);
  const appReady = useStore(state => state.appReady);
  const familyMembers = useStore(state => state.familyMembers);
  const familyData = useStore(state => state.familyData);
  const familyLoading = useStore(state => state.familyLoading);
  const bootstrapStatus = useStore(state => state.bootstrapStatus);
  const bootstrapError = useStore(state => state.bootstrapError);
  const retryBootstrap = useStore(state => state.retryBootstrap);

  // Firebase Auth is still initializing - never redirect to /login while the
  // first auth state has not resolved. This prevents the temporary redirect to
  // /login that forced users to close & reopen the PWA.
  if (authStatus === 'initializing') {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center">Loading...</div>;
  }

  // A recoverable bootstrap/auth error takes precedence over the login
  // redirect (matches the previous contract where an error screen was shown
  // even when authUser was null).
  if (bootstrapError) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-6 rounded-2xl shadow-xl max-w-md w-full text-center border border-red-100">
          <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl font-bold">!</span>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Connection Error</h2>
          <p className="text-gray-500 mb-6 text-sm">{bootstrapError}</p>
          <button
            onClick={retryBootstrap}
            className="w-full bg-primary-600 hover:bg-primary-700 text-white font-bold py-3 rounded-xl transition-colors"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  // Not logged in -> Login
  if (authStatus === 'unauthenticated' || authUser === null) {
    return <Navigate to="/login" replace />;
  }

  // Logged in but no user doc yet (takes a moment to sync)
  if (authUser && currentUser === null) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center">Setting up...</div>;
  }

  // Logged in, user doc exists, but no familyId -> Onboarding (unless already there)
  if (currentUser && !currentUser.familyId && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }

  if (currentUser?.familyId && !appReady) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center animate-pulse">Loading Dashboard...</div>;
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
              <div className="w-8 h-8 bg-primary-500 rounded-xl flex items-center justify-center text-white font-bold">
                F
              </div>
              <span className="text-xl font-extrabold tracking-tight text-gray-900">FamilyQuest</span>
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

      {/* Main Content Area */}
      <main className="flex-1 max-w-5xl mx-auto w-full p-4 pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-8">
        <Outlet />
      </main>

      {/* Bottom Navigation (Mobile Only) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 pb-[env(safe-area-inset-bottom)] z-40">
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
      {!setupPromptHidden && shouldShowFamilySetupPrompt({
        appReady,
        familyLoading,
        familyData,
        familyMembers,
        currentUser,
        bootstrapStatus,
      }) && currentUser?.familyId && (currentUser?.uid || currentUser?.id) && (
        <FamilySetupPrompt
          familyId={currentUser.familyId}
          ownerId={currentUser.uid || currentUser.id}
          familyMembers={familyMembers}
          onHide={() => setSetupPromptHidden(true)}
        />
      )}
    </div>
  );
}
