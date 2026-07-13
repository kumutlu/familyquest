import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { Dashboard } from './pages/Dashboard';
import { Family } from './pages/Family';
import { MemberProfile } from './pages/MemberProfile';
import { Tasks } from './pages/Tasks';
import { Rewards } from './pages/Rewards';
import { Wallet } from './pages/Wallet';
import { Settings } from './pages/Settings';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { Onboarding } from './pages/Onboarding';
import { FundsDashboard } from './pages/FundsDashboard';
import { useStore } from './store/useStore';
import { useEffect } from 'react';

function App() {
  const initAuth = useStore(state => state.initAuth);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        
        <Route path="/" element={<AppLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="onboarding" element={<Onboarding />} />
          <Route path="family" element={<Family />} />
          <Route path="family/:id" element={<MemberProfile />} />
          <Route path="tasks" element={<Tasks />} />
          <Route path="rewards" element={<Rewards />} />
          <Route path="pet-box" element={<FundsDashboard />} />
          <Route path="wallet" element={<Wallet />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
