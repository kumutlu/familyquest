import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { Dashboard } from './pages/Dashboard';
import { Family } from './pages/Family';
import { MemberProfile } from './pages/MemberProfile';
import { Tasks } from './pages/Tasks';
import { ReviewPage } from './pages/ReviewPage';
import { Rewards } from './pages/Rewards';
import { Wallet } from './pages/Wallet';
import { Wallets } from './pages/Wallets';
import { Settings } from './pages/Settings';
import { ContinueSetup } from './pages/ContinueSetup';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { JoinFamily } from './pages/JoinFamily';
import { JoinInvite } from './pages/JoinInvite';
import { AdultInvite } from './pages/AdultInvite';
import { PendingMembership } from './pages/PendingMembership';
import { NoFamilyChoice } from './pages/NoFamilyChoice';
import { OnboardingFlow } from './onboarding/OnboardingFlow';
import { PrivacyPolicy } from './pages/legal/PrivacyPolicy';
import { TermsOfService } from './pages/legal/TermsOfService';
import { AccountDeletion } from './pages/legal/AccountDeletion';
import { FundsDashboard } from './pages/FundsDashboard';
import { Goals } from './pages/Goals';
import { GoalDetail } from './pages/GoalDetail';
import { Notifications } from './pages/Notifications';
import { TransactionHistoryScreen } from './components/history/TransactionHistoryScreen';
import { HelpHome } from './help/pages/HelpHome';
import { HelpArticlePage } from './help/pages/HelpArticlePage';
import { HelpCategoryPage } from './help/pages/HelpCategoryPage';
import { HelpSearchResults } from './help/pages/HelpSearchResults';
import { useStore, logAuthTrace } from './store/useStore';
import { initForegroundMessaging } from './lib/pushNotifications';
import { RequestDetailProvider } from './components/requests/RequestDetailContext';
import { MoneyPrivacyProvider } from './components/privacy/MoneyPrivacyContext';
import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { consumeGoogleRedirectResult } from './lib/googleRedirectAuth';
import { markStartupStage } from './startupDiagnostics';
import { E2EBootstrapDiagnostics } from './components/E2EBootstrapDiagnostics';
import { AuthRoutingGate } from './auth/AuthRoutingGate';
import { DevPreviewRoot } from './components/preview/EngagementPreviewRoute';
import { ThemeShop } from './pages/ThemeShop';
import { isDevPreviewQueryActive } from './components/preview/engagementPreviewUrl';
import {
  clearCreateFamilyIntent,
  hasCreateFamilyIntent,
  subscribeCreateFamilyIntent,
} from './auth/createFamilyIntent';

/**
 * Returns true only when the URL carries `?dev-preview=engagement` AND the
 * build is NOT production. Lives at module scope so it can be called during
 * render without hook-order constraints. Re-evaluated on every render so it
 * tracks in-app navigation that mutates `window.location.search`.
 *
 * The production guard is enforced at the call site by `isProductionBuild()`
 * — see `EngagementPreviewRoute.tsx`. This function only inspects the URL.
 *
 * The contract is owned by `engagementPreviewUrl.ts`; this function is
 * just a thin wrapper so the rest of `App.tsx` can keep its current shape.
 */
function isDevPreviewRequested(): boolean {
  if (typeof window === 'undefined') return false
  return isDevPreviewQueryActive(window.location?.search ?? '')
}

type CreationContinuation = { authUid: string; familyId?: string };

function App() {
  // Track `window.location.search` reactively so navigating to the dev
  // preview URL after first mount still re-routes the preview surface.
  // The router's own `useLocation` would also work, but `BrowserRouter`
  // is mounted AFTER this short-circuit — reading directly is the
  // narrowest solution that does not move the Router earlier in the tree.
  // IMPORTANT: this hook is unconditional so the Rules of Hooks are
  // preserved on every render (preview or not).
  const [searchTick, setSearchTick] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const bump = () => setSearchTick(t => t + 1);
    window.addEventListener('popstate', bump);
    // Patch history.pushState / replaceState so SPA navigations that don't
    // dispatch popstate also re-render this component.
    const originalPush = window.history.pushState;
    const originalReplace = window.history.replaceState;
    const wrap =
      (orig: typeof window.history.pushState) =>
      (...args: Parameters<typeof orig>) => {
        const out = orig.apply(window.history, args);
        bump();
        return out;
      };
    window.history.pushState = wrap(originalPush) as typeof window.history.pushState;
    window.history.replaceState = wrap(originalReplace) as typeof window.history.replaceState;
    return () => {
      window.removeEventListener('popstate', bump);
      window.history.pushState = originalPush;
      window.history.replaceState = originalReplace;
    };
  }, []);
  // Reading searchTick into the dependency array guarantees the render
  // observes URL mutations without breaking the Rules of Hooks.
  void searchTick;
  const devPreviewActive = isDevPreviewRequested();

  const initAuth = useStore(state => state.initAuth);
  const authStatus = useStore(state => state.authStatus);
  const authUser = useStore(state => state.authUser);
  const currentFamilyId = useStore(state => state.currentUser?.familyId);
  const authUid = authUser?.uid ?? null;
  const hasExplicitCreateIntent = useSyncExternalStore(
    subscribeCreateFamilyIntent,
    () => authUid ? hasCreateFamilyIntent(authUid) : false,
    () => false,
  );
  const [creationContinuation, setCreationContinuation] = useState<CreationContinuation | null>(null);
  // Firestore can publish the new family membership while React batches the
  // state update from the onboarding callback. The ref is the synchronous
  // handoff used by the routing gate during that narrow ordering window; state
  // still drives ordinary React renders and lifecycle cleanup.
  const creationContinuationRef = useRef<CreationContinuation | null>(null);
  const confirmFamilyCreation = useCallback((continuation: CreationContinuation) => {
    creationContinuationRef.current = continuation;
    setCreationContinuation(continuation);
  }, []);
  const endCreationJourney = useCallback(() => {
    creationContinuationRef.current = null;
    setCreationContinuation(null);
  }, []);

  useEffect(() => {
    if (devPreviewActive) return; // preview harness must NEVER touch Firebase.
    markStartupStage('REACT_MOUNTED');
    logAuthTrace('app-mount');
    initAuth();
    void consumeGoogleRedirectResult()
      .then(result => {
        if (result.error === 'redirect-state-missing') {
          useStore.setState({
            bootstrapError: 'Google sign-in could not be completed. Please try again.',
          });
        }
      })
      .catch(error => {
        console.error('[auth] Google redirect bootstrap failed', { code: error?.code });
      });
  }, [initAuth, devPreviewActive]);

  useEffect(() => {
    // Keep the UID-bound intent for the whole P1-P3 journey. Clearing it as
    // soon as the profile listener publishes familyId races the in-flight P1
    // transaction and can eject the user before its continuation is confirmed.
    if (authStatus === 'unauthenticated') clearCreateFamilyIntent();
  }, [authStatus]);

  useEffect(() => {
    if (
      authStatus === 'unauthenticated' ||
      (creationContinuationRef.current && creationContinuationRef.current.authUid !== authUid) ||
      (creationContinuationRef.current?.familyId !== undefined
        && currentFamilyId
        && creationContinuationRef.current.familyId !== currentFamilyId)
    ) {
      creationContinuationRef.current = null;
      setCreationContinuation(null);
    }
  }, [authStatus, authUid, creationContinuation, currentFamilyId]);

  useEffect(() => {
    // Best-effort: wire foreground push handling. The handler is intentionally a
    // no-op so we do NOT show a duplicate browser notification — the realtime
    // Notification Center (Firestore listener) is the primary UI.
    initForegroundMessaging().catch(() => undefined);
  }, []);

  if (devPreviewActive) {
    // DEV-only preview harness: rendered BEFORE the router, BEFORE
    // AuthRoutingGate, BEFORE any Firebase-aware context. It must NEVER
    // touch the auth store, Firestore, or family membership state.
    return (
      <Suspense
        fallback={
          <div
            data-testid="route-translations-loading"
            aria-busy="true"
            className="min-h-screen bg-gray-50"
          />
        }
      >
        <DevPreviewRoot />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<div data-testid="route-translations-loading" aria-busy="true" className="min-h-screen bg-gray-50" />}>
      <Router>
        <MoneyPrivacyProvider>
          <RequestDetailProvider>
            <E2EBootstrapDiagnostics />
            <AuthRoutingGate
              hasExplicitCreateIntent={hasExplicitCreateIntent}
              creationContinuation={creationContinuationRef.current ?? creationContinuation}
              onCreationJourneyEnded={endCreationJourney}
            >
            <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/join-family" element={<JoinFamily />} />
          {/* Code-specific invitation link. Public: the invitation is
              validated server-side before any family detail is rendered. */}
          <Route path="/join" element={<JoinInvite />} />
          {/* Opaque adult invitations own their auth/confirmation journey and
              must run before the authenticated AppLayout onboarding guard. */}
          <Route path="/invite/:token" element={<AdultInvite />} />
          <Route path="/join/pending" element={<PendingMembership />} />
          <Route path="/no-family" element={<NoFamilyChoice />} />

          {/* Public pre-auth onboarding. Rendered OUTSIDE <AppLayout> so it is
              reachable by unauthenticated visitors; it carries its own internal
              guards (established-family owner / managed child → redirected). */}
          <Route
            path="/onboarding"
            element={(
              <OnboardingFlow
                onFamilyCreationStarted={confirmFamilyCreation}
                onFamilyCreationConfirmed={confirmFamilyCreation}
                onCreationJourneyEnded={endCreationJourney}
              />
            )}
          />

          {/* Public legal surfaces — intentionally outside <AppLayout> so they
              render without authentication and without app navigation. */}
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/terms" element={<TermsOfService />} />
          <Route path="/account-deletion" element={<AccountDeletion />} />

          <Route path="/" element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="family" element={<Family />} />
            <Route path="family/:id" element={<MemberProfile />} />
            <Route path="tasks" element={<Tasks />} />
            {/* Queki v2 Wave 2: parent fast review (swipe) flow. */}
            <Route path="review" element={<ReviewPage />} />
            <Route path="rewards" element={<Rewards />} />
            <Route path="themes" element={<ThemeShop />} />
            <Route path="pet-box" element={<FundsDashboard />} />
            <Route path="wallet" element={<Wallet />} />
            <Route path="wallets" element={<Wallets />} />
            <Route path="goals" element={<Goals />} />
            <Route path="goals/:goalId" element={<GoalDetail />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="history" element={<TransactionHistoryScreen />} />
            <Route path="settings" element={<Settings />} />
            <Route path="continue-setup" element={<ContinueSetup />} />

            {/* Help Center. `search` and `category/:id` are declared before the
                catch-all `:articleId` so they are never swallowed by it. */}
            <Route path="help" element={<HelpHome />} />
            <Route path="help/search" element={<HelpSearchResults />} />
            <Route path="help/category/:categoryId" element={<HelpCategoryPage />} />
            <Route path="help/:articleId" element={<HelpArticlePage />} />
          </Route>
            </Routes>
            </AuthRoutingGate>
          </RequestDetailProvider>
        </MoneyPrivacyProvider>
      </Router>
    </Suspense>
  );
}

export default App;
