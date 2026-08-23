import { Suspense, lazy, useEffect, useState } from 'react';
import { Link, Outlet, useLocation, Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppWindow, CheckSquare, Gift, ClipboardList } from 'lucide-react';
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
import { QuekiBottomNavigation } from '../queki/QuekiBottomNavigation';
import { BottomSheet } from '../queki/BottomSheet';
import { TactileButton } from '../queki/TactileButton';

// Creation flows are heavy and belong to the composer only — keep them out of
// the critical startup path behind route-local lazy chunks.
const TaskFormModal = lazy(() =>
  import('../forms/TaskFormModal').then(m => ({ default: m.TaskFormModal })),
);
const RewardFormModal = lazy(() =>
  import('../forms/RewardFormModal').then(m => ({ default: m.RewardFormModal })),
);
const BehaviourFormModal = lazy(() =>
  import('../forms/BehaviourFormModal').then(m => ({ default: m.BehaviourFormModal })),
);

export function AppLayout() {
  const { t } = useTranslation('common');
  // Header brand mark. Falls back to a neutral generic app icon if the logo
  // asset fails to load — never a letter glyph.
  const [logoFailed, setLogoFailed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const authStatus = useStore(state => state.authStatus);
  const authUser = useStore(state => state.authUser);
  const currentUser = useStore(state => state.currentUser);
  const appReady = useStore(state => state.appReady);
  const bootstrapError = useStore(state => state.bootstrapError);
  const bootstrapAttempt = useStore(state => state.bootstrapAttempt);
  const retryBootstrap = useStore(state => state.retryBootstrap);
  const familyMembers = useStore(state => state.familyMembers);

  // Wave 1 Action Composer state (sheet + lazily-mounted creation forms).
  // Declared with the other hooks, BEFORE any early return, so the hook order
  // is stable across the startup → ready transition.
  const [composerOpen, setComposerOpen] = useState(false);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [rewardModalOpen, setRewardModalOpen] = useState(false);
  const [eventModalOpen, setEventModalOpen] = useState(false);

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
        onSignOut={
          authUser
            ? () => {
                void signOut()
                  .then(() => navigate('/login', { replace: true }))
                  .catch(() => {});
              }
            : undefined
        }
      />
    );
  }

  // Not logged in -> the bare root becomes the Refined Queki onboarding front
  // door; every other unauthenticated route still falls through to Login so
  // protected deep links are preserved. Auth is already resolved here (the
  // startup gate above short-circuits while initializing), so we never
  // prematurely redirect during bootstrap.
  if (authStatus === 'unauthenticated' || authUser === null) {
    return <Navigate to={location.pathname === '/' ? '/onboarding' : '/login'} replace />;
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
  // Queki v2 bottom navigation. See src/config/navigation.ts.
  const navItems = getNavItems();
  const isParent = currentUser?.role === 'owner' || currentUser?.role === 'parent' || currentUser?.role === 'admin';

  return (
    <div className="min-h-dvh qk-bg-page flex flex-col font-sans">
      {/* Top Navigation (Desktop & Mobile Header) */}
      <header className="qk-bg-card border-b qk-border-subtle sticky top-0 z-40">
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

      {/* Main Content Area. Bottom padding clears the taller Queki v2 nav
          (including the overhanging centre Action button) plus the safe area. */}
      <main className="flex-1 max-w-5xl mx-auto w-full p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-10">
        <Suspense fallback={<div data-testid="route-translations-loading" aria-busy="true" className="h-40 animate-pulse rounded-2xl bg-gray-100" />}>
          <Outlet />
        </Suspense>
      </main>

      {/* Queki v2 Bottom Navigation (Mobile Only).
          Single shared instance owned by the app shell — last child of the
          layout root so `position: fixed` always resolves against the viewport.
          The centre Action button is role-aware and opens the composer sheet. */}
      <QuekiBottomNavigation
        role={currentUser?.role}
        onActionPress={() => setComposerOpen(true)}
      />

      {/* Wave 1 Action Composer: a temporary Queki v2 sheet with the correct
          top-level actions. Full creation flows arrive in a later wave; these
          buttons reuse the existing production forms unchanged. */}
      <BottomSheet
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        aria-label={t('composer.title', { defaultValue: 'What do you want to do?' })}
        title={t('composer.title', { defaultValue: 'What do you want to do?' })}
      >
        {isParent ? (
          <div className="grid gap-3 pb-2" data-testid="action-composer-parent">
            <ComposerAction
              testId="composer-new-task"
              icon={<CheckSquare size={20} aria-hidden="true" />}
              label={t('composer.newTask', { defaultValue: 'New quest' })}
              onPress={() => {
                setComposerOpen(false);
                setTaskModalOpen(true);
              }}
            />
            <ComposerAction
              testId="composer-new-reward"
              icon={<Gift size={20} aria-hidden="true" />}
              label={t('composer.newReward', { defaultValue: 'New reward' })}
              tone="coral"
              onPress={() => {
                setComposerOpen(false);
                setRewardModalOpen(true);
              }}
            />
            <ComposerAction
              testId="composer-log-behaviour"
              icon={<ClipboardList size={20} aria-hidden="true" />}
              label={t('composer.logBehaviour', { defaultValue: 'Log behaviour' })}
              tone="family"
              onPress={() => {
                setComposerOpen(false);
                setEventModalOpen(true);
              }}
            />
          </div>
        ) : (
          <div className="grid gap-3 pb-2" data-testid="action-composer-child">
            <ComposerAction
              testId="composer-do-quests"
              icon={<CheckSquare size={20} aria-hidden="true" />}
              label={t('composer.doQuests', { defaultValue: 'Do my quests' })}
              onPress={() => {
                setComposerOpen(false);
                navigate('/tasks');
              }}
            />
            <ComposerAction
              testId="composer-view-rewards"
              icon={<Gift size={20} aria-hidden="true" />}
              label={t('composer.viewRewards', { defaultValue: 'See rewards' })}
              tone="coral"
              onPress={() => {
                setComposerOpen(false);
                navigate('/rewards');
              }}
            />
          </div>
        )}
      </BottomSheet>

      {/* Lazy creation forms — mounted only after the composer opened them. */}
      {(taskModalOpen || rewardModalOpen || eventModalOpen) && (
        <Suspense fallback={null}>
          {eventModalOpen && (
            <BehaviourFormModal
              isOpen={eventModalOpen}
              onClose={() => setEventModalOpen(false)}
              childrenList={(currentUser && familyMembers.filter(m => m?.role === 'child')) || []}
            />
          )}
          {taskModalOpen && (
            <TaskFormModal isOpen={taskModalOpen} onClose={() => setTaskModalOpen(false)} />
          )}
          {rewardModalOpen && (
            <RewardFormModal isOpen={rewardModalOpen} onClose={() => setRewardModalOpen(false)} />
          )}
        </Suspense>
      )}
    </div>
  );
}

function ComposerAction({
  icon,
  label,
  onPress,
  tone = 'brand',
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  tone?: 'brand' | 'coral' | 'family';
  testId?: string;
}) {
  const tones = {
    brand: 'bg-primary-50 text-primary-600 dark:bg-primary-100',
    coral: 'bg-coral-50 text-coral-500',
    family: 'bg-family-50 text-family-600',
  } as const;
  return (
    <TactileButton
      variant="secondary"
      size="lg"
      fullWidth
      onClick={onPress}
      data-testid={testId}
      className="justify-start gap-3 px-4"
    >
      <span aria-hidden="true" className={cn('flex h-9 w-9 items-center justify-center rounded-xl', tones[tone])}>
        {icon}
      </span>
      <span className="font-button">{label}</span>
    </TactileButton>
  );
}
