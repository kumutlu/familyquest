import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./store/useStore', () => ({
  useStore: (selector: any) => selector({ initAuth: vi.fn() }),
  logAuthTrace: vi.fn(),
}));
vi.mock('./components/layout/AppLayout', async () => {
  const { Outlet } = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { AppLayout: () => <div><span>layout</span><Outlet /></div> };
});
vi.mock('./pages/Dashboard', () => ({ Dashboard: () => null }));
vi.mock('./pages/Family', () => ({ Family: () => null }));
vi.mock('./pages/MemberProfile', () => ({ MemberProfile: () => null }));
vi.mock('./pages/Tasks', () => ({ Tasks: () => null }));
vi.mock('./pages/Rewards', () => ({ Rewards: () => null }));
vi.mock('./pages/Wallet', () => ({ Wallet: () => null }));
vi.mock('./pages/Settings', () => ({ Settings: () => null }));
vi.mock('./pages/Login', () => ({ Login: () => null }));
vi.mock('./pages/Signup', () => ({ Signup: () => null }));
vi.mock('./onboarding/OnboardingFlow', () => ({ OnboardingFlow: () => null }));
vi.mock('./pages/FundsDashboard', () => ({ FundsDashboard: () => <span>Pet Box funds</span> }));
vi.mock('./pages/Notifications', () => ({ Notifications: () => <span>Notifications page</span> }));
vi.mock('./components/history/TransactionHistoryScreen', () => ({
  TransactionHistoryScreen: () => <span>Transaction history page</span>,
}));

import App from './App';

describe('application routes', () => {
  it('mounts the fund dashboard at /pet-box', async () => {
    window.history.pushState({}, '', '/pet-box');
    render(<App />);
    expect(await screen.findByText('Pet Box funds')).toBeInTheDocument();
  });

  it('mounts the notifications page at /notifications (no white screen)', async () => {
    window.history.pushState({}, '', '/notifications');
    render(<App />);
    expect(await screen.findByText('Notifications page')).toBeInTheDocument();
  });

  it('mounts the transaction history screen at /history', async () => {
    window.history.pushState({}, '', '/history');
    render(<App />);
    expect(await screen.findByText('Transaction history page')).toBeInTheDocument();
  });
});
