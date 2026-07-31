import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { Dashboard } from './pages/Dashboard';
import { Family } from './pages/Family';
import { MemberProfile } from './pages/MemberProfile';
import { Tasks } from './pages/Tasks';
import { Rewards } from './pages/Rewards';
import { Wallet } from './pages/Wallet';
import { Wallets } from './pages/Wallets';
import { Settings } from './pages/Settings';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { Onboarding } from './pages/Onboarding';
import { PrivacyPolicy } from './pages/legal/PrivacyPolicy';
import { TermsOfService } from './pages/legal/TermsOfService';
import { AccountDeletion } from './pages/legal/AccountDeletion';
import { FundsDashboard } from './pages/FundsDashboard';
import { Goals } from './pages/Goals';
import { GoalDetail } from './pages/GoalDetail';
import { Notifications } from './pages/Notifications';
import { TransactionHistoryScreen } from './components/history/TransactionHistoryScreen';
import { useStore } from './store/useStore';
import { initForegroundMessaging } from './lib/pushNotifications';
import { RequestDetailProvider } from './components/requests/RequestDetailContext';
import { useEffect } from 'react';
import { consumeGoogleRedirectResult } from './lib/googleRedirectAuth';

function App() {
  const initAuth = useStore(state => state.initAuth);

  useEffect(() => {
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
    // Best-effort: wire foreground push handling. The handler is intentionally a
    // no-op so we do NOT show a duplicate browser notification — the realtime
    // Notification Center (Firestore listener) is the primary UI.
    initForegroundMessaging().catch(() => undefined);
  }, []);

  return (
    <Router>
      <RequestDetailProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />

          {/* Public legal surfaces — intentionally outside <AppLayout> so they
              render without authentication and without app navigation. */}
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/terms" element={<TermsOfService />} />
          <Route path="/account-deletion" element={<AccountDeletion />} />

          <Route path="/" element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="onboarding" element={<Onboarding />} />
            <Route path="family" element={<Family />} />
            <Route path="family/:id" element={<MemberProfile />} />
            <Route path="tasks" element={<Tasks />} />
            <Route path="rewards" element={<Rewards />} />
            <Route path="pet-box" element={<FundsDashboard />} />
            <Route path="wallet" element={<Wallet />} />
            <Route path="wallets" element={<Wallets />} />
            <Route path="goals" element={<Goals />} />
            <Route path="goals/:goalId" element={<GoalDetail />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="history" element={<TransactionHistoryScreen />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </RequestDetailProvider>
    </Router>
  );
}

export default App;
