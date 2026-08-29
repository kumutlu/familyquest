import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from './i18n/config';
import userEvent from '@testing-library/user-event';

const appStoreState = vi.hoisted(() => ({
  authStatus: 'authenticated',
  authUser: { uid: 'u1' } as any,
  currentUser: { id: 'u1', familyId: 'family-1', role: 'owner', lifecycle: 'active', displayName: 'Owner' } as any,
  familyData: { id: 'family-1', lifecycleState: 'active', currencyCode: 'GBP' } as any,
  familyMembers: [{ id: 'child-1', displayName: 'Dashboard Child', role: 'child' }] as any[],
  tasks: [] as any[],
  rewards: [] as any[],
  profileServerConfirmed: true,
  appReady: true,
  bootstrapError: null as string | null,
  pendingMembershipStatus: 'none',
  bootstrapAttempt: 0,
  retryBootstrap: vi.fn(),
  initAuth: vi.fn(),
}));

vi.mock('./store/useStore', () => ({
  useStore: (selector: any) => selector(appStoreState),
  logAuthTrace: vi.fn(),
}));
vi.mock('./lib/api', () => ({
  signOut: vi.fn(async () => {}),
}));
vi.mock('./components/layout/AppLayout', async () => {
  const { Outlet } = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { AppLayout: () => <div><span>layout</span><Outlet /></div> };
});
vi.mock('./pages/Dashboard', async () => {
  const { useRequestDetail } = await import('./components/requests/RequestDetailContext');
  return {
    Dashboard: () => {
      const { openRequest } = useRequestDetail();
      return (
        <button
          type="button"
          onClick={() => openRequest({
            id: 'request-1',
            category: 'money_request',
            requesterId: 'child-1',
            requesterName: 'Dashboard Child',
            requestedFromId: 'u1',
            requestedFromName: 'Owner',
            requestedFromRole: 'owner',
            amountPence: 556,
            status: 'pending_acceptance',
            createdAt: { toDate: () => new Date('2026-08-25T12:00:00Z') },
          })}
        >
          Open real request detail
        </button>
      );
    },
  };
});
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

beforeEach(() => {
  appStoreState.authStatus = 'authenticated';
  appStoreState.authUser = { uid: 'u1' };
  appStoreState.currentUser = { id: 'u1', familyId: 'family-1', role: 'owner', lifecycle: 'active', displayName: 'Owner' };
  appStoreState.familyData = { id: 'family-1', lifecycleState: 'active', currencyCode: 'GBP' };
  appStoreState.profileServerConfirmed = true;
  appStoreState.appReady = true;
  appStoreState.bootstrapError = null;
  appStoreState.pendingMembershipStatus = 'none';
  appStoreState.retryBootstrap.mockClear();
});

describe('application routes', () => {
  beforeEach(async () => {
    localStorage.clear();
    await i18n.loadNamespaces(['requests', 'common']);
    await i18n.changeLanguage('en');
  });

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

  it('opens the real request detail sheet through the authenticated App provider composition', async () => {
    localStorage.setItem('queki.moneyPrivacy:u1', 'true');
    window.history.pushState({}, '', '/');
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open real request detail' }));

    expect(await screen.findByRole('heading', { name: 'Money Request' })).toBeInTheDocument();
    expect(screen.getByText('£••••')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('£5.56');
  });

  it('resolves /join/pending to an accessible waiting page with a recovery action', async () => {
    const user = userEvent.setup();
    appStoreState.currentUser = { id: 'u1', role: 'parent', lifecycle: 'active' };
    appStoreState.familyData = null;
    appStoreState.pendingMembershipStatus = 'pending';
    window.history.pushState({}, '', '/join/pending');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Your request is waiting for approval' })).toBeInTheDocument();
    expect(screen.getByText(/family owner needs to approve/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(appStoreState.retryBootstrap).toHaveBeenCalledTimes(1);
  });

  it('renders a clear recovery state at /join/pending when membership cannot be verified', async () => {
    appStoreState.currentUser = { id: 'u1', familyId: 'family-1', role: 'parent', lifecycle: 'archived' };
    appStoreState.familyData = { id: 'family-1', lifecycleState: 'active' };
    appStoreState.pendingMembershipStatus = 'none';
    window.history.pushState({}, '', '/join/pending');

    render(<App />);

    expect(await screen.findByRole('heading', { name: "We couldn't verify your family access" })).toBeInTheDocument();
    expect(screen.getByText(/membership may have changed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
