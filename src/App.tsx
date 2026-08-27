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
import { Suspense, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { consumeGoogleRedirectResult } from './lib/googleRedirectAuth';
import { markStartupStage } from './startupDiagnostics';
import { E2EBootstrapDiagnostics } from './components/E2EBootstrapDiagnostics';
import { AuthRoutingGate } from './auth/AuthRoutingGate';
import {
  clearCreateFamilyIntent,
  hasCreateFamilyIntent,
  subscribeCreateFamilyIntent,
} from './auth/createFamilyIntent';

type CreationContinuation = { authUid: string; familyId: string };

function App() {
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
  const endCreationJourney = useCallback(() => setCreationContinuation(null), []);

  useEffect(() => {
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
  }, [initAuth]);

  useEffect(() => {
    if (authStatus === 'unauthenticated' || currentFamilyId) {
      clearCreateFamilyIntent();
    }
  }, [authStatus, currentFamilyId]);

  useEffect(() => {
    if (
      authStatus === 'unauthenticated' ||
      (creationContinuation && creationContinuation.authUid !== authUid) ||
      (creationContinuation && currentFamilyId && creationContinuation.familyId !== currentFamilyId)
    ) {
      setCreationContinuation(null);
    }
  }, [authStatus, authUid, creationContinuation, currentFamilyId]);

  useEffect(() => {
    // Best-effort: wire foreground push handling. The handler is intentionally a
    // no-op so we do NOT show a duplicate browser notification — the realtime
    // Notification Center (Firestore listener) is the primary UI.
    initForegroundMessaging().catch(() => undefined);
  }, []);

  return (
    <Suspense fallback={<div data-testid="route-translations-loading" aria-busy="true" className="min-h-screen bg-gray-50" />}>
      <Router>
        <RequestDetailProvider>
          <E2EBootstrapDiagnostics />
          <AuthRoutingGate
            hasExplicitCreateIntent={hasExplicitCreateIntent}
            creationContinuation={creationContinuation}
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
                onFamilyCreationConfirmed={setCreationContinuation}
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
      </Router>
    </Suspense>
  );
}

export default App;
