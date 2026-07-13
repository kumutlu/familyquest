import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const bootstrapListeners: Array<{ target: string; next: (snapshot: any) => void }> = [];
let componentAuthNext: ((user: any) => Promise<void> | void) | undefined;

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, path: string) => path),
  doc: vi.fn((_db: unknown, path: string, id?: string) => id ? `${path}/${id}` : path),
  query: vi.fn((target: string) => target),
  orderBy: vi.fn(),
  where: vi.fn(),
  onSnapshot: vi.fn((target: string, optionsOrNext: any, nextOrError: any) => {
    bootstrapListeners.push({ target, next: typeof optionsOrNext === 'function' ? optionsOrNext : nextOrError });
    return vi.fn();
  }),
  getDocFromServer: vi.fn(() => new Promise(() => {})),
  getDocsFromServer: vi.fn(() => new Promise(() => {})),
  getFirestore: vi.fn(),
}));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn((_auth: unknown, next: typeof componentAuthNext) => {
    componentAuthNext = next;
    return vi.fn();
  }),
  getAuth: vi.fn(),
}));
vi.mock('../../src/lib/firebase', () => ({ db: {}, auth: {} }));

import { AppLayout } from '../../src/components/layout/AppLayout';
import { Dashboard } from '../../src/pages/Dashboard';
import { useStore } from '../../src/store/useStore';

function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="onboarding" element={<div>Onboarding Screen</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('rendered bootstrap boundary', () => {
  beforeEach(() => {
    useStore.getState().cleanup();
    bootstrapListeners.length = 0;
    componentAuthNext = undefined;
    useStore.setState({
      authInitialized: true,
      authUser: { uid: 'parent1' },
      currentUser: { id: 'parent1', familyId: 'fam1', role: 'parent', displayName: 'Parent' },
      familyData: null,
      familyMembers: [],
      tasks: [],
      rewards: [],
      childWallets: [],
      taskCompletions: [],
      transferRequests: [],
      moneyRequests: [],
      petboxRequests: [],
      appReady: false,
      loading: false,
      bootstrapError: null,
      featureErrors: {},
    });
  });

  it('14/15. hard refresh shows loading, never temporary zero summaries, then renders real data', async () => {
    renderApp();
    expect(screen.getByText('Loading Dashboard...')).toBeInTheDocument();
    expect(screen.queryByText('Children')).not.toBeInTheDocument();
    expect(screen.queryByText('Pending (0)')).not.toBeInTheDocument();

    act(() => useStore.setState({
      appReady: true,
      loading: false,
      familyData: { id: 'fam1', currency: '£' },
      familyMembers: [{ id: 'child1', role: 'child', displayName: 'Ava', walletBalance: 250 }],
      tasks: [{ id: 'task1', title: 'Tidy room', isActive: true }],
      rewards: [{ id: 'reward1', title: 'Movie', isActive: true }],
      childWallets: [{ id: 'child1', balance: 250 }],
      transferRequests: [{ id: 'request1', status: 'pending', fromChildId: 'child1', toChildId: 'child2', amountPence: 50 }],
    }));

    expect(await screen.findByText('Parent Console')).toBeInTheDocument();
    expect(screen.getByText('Children')).toBeInTheDocument();
    expect(screen.getByText('Pending (1)')).toBeInTheDocument();
    expect(screen.queryByText('Pending (0)')).not.toBeInTheDocument();
  });

  it('drives persisted auth, profile, and every parent resource before revealing dashboard values', async () => {
    useStore.getState().cleanup();
    renderApp();
    expect(screen.getByText('Loading...')).toBeInTheDocument();

    act(() => useStore.getState().initAuth());
    await act(async () => {
      await componentAuthNext!({ uid: 'parent1', getIdToken: vi.fn().mockResolvedValue('token') });
    });
    expect(bootstrapListeners.map(item => item.target)).toEqual(['users/parent1']);

    act(() => bootstrapListeners[0].next({
      exists: () => true,
      id: 'parent1',
      data: () => ({ familyId: 'fam1', role: 'parent', displayName: 'Parent' }),
      metadata: { fromCache: false },
    }));

    expect(screen.getByText('Loading Dashboard...')).toBeInTheDocument();
    expect(screen.queryByText('Children')).not.toBeInTheDocument();
    expect(screen.queryByText('Pending (0)')).not.toBeInTheDocument();

    act(() => {
      for (const subscription of bootstrapListeners.slice(1)) {
        if (subscription.target === 'families/fam1') {
          subscription.next({ exists: () => true, id: 'fam1', data: () => ({ currency: '£' }), metadata: { fromCache: false } });
          continue;
        }
        const data = subscription.target === 'users'
          ? [{ id: 'child1', role: 'child', displayName: 'Ava', walletBalance: 250 }]
          : subscription.target === 'families/fam1/tasks'
            ? [{ id: 'task1', title: 'Tidy room', isActive: true }]
            : subscription.target === 'families/fam1/rewards'
              ? [{ id: 'reward1', title: 'Movie', isActive: true }]
              : subscription.target === 'families/fam1/wallets'
                ? [{ id: 'child1', balance: 250 }]
                : subscription.target === 'families/fam1/transfer_requests'
                  ? [{ id: 'request1', status: 'pending', fromChildId: 'child1', toChildId: 'child2', amountPence: 50 }]
                  : [];
        subscription.next({ docs: data.map(({ id, ...fields }) => ({ id, data: () => fields })), metadata: { fromCache: false } });
      }
    });

    expect(await screen.findByText('Parent Console')).toBeInTheDocument();
    expect(screen.getByText('Pending (1)')).toBeInTheDocument();
    expect(screen.queryByText('Pending (0)')).not.toBeInTheDocument();
  });

  it('renders the owner app shell and parent dashboard without invoking the reversals loader', async () => {
    const loadReversals = vi.fn();
    useStore.setState({
      currentUser: { id: 'owner1', familyId: 'fam1', role: 'owner', displayName: 'Owner' },
      appReady: true,
      loading: false,
      familyData: { id: 'fam1', currency: '£' },
      loadReversals,
    });

    renderApp();

    expect(await screen.findByText('Parent Console')).toBeInTheDocument();
    expect(loadReversals).not.toHaveBeenCalled();
    expect(bootstrapListeners.some(listener => listener.target === 'families/fam1/reversals')).toBe(false);
  });

  it('shows a bootstrap error before the authenticated missing-profile placeholder', () => {
    useStore.setState({ currentUser: null, bootstrapError: '[Profile] permission-denied', appReady: false });
    renderApp();
    expect(screen.getByText('Connection Error')).toBeInTheDocument();
    expect(screen.queryByText('Setting up...')).not.toBeInTheDocument();
  });

  it('shows the whole-app connection error for a critical family listener failure', () => {
    useStore.setState({
      bootstrapError: '[Family] permission-denied: Missing or insufficient permissions',
      appReady: false,
    });
    renderApp();

    expect(screen.getByText('Connection Error')).toBeInTheDocument();
    expect(screen.getByText(/\[Family\] permission-denied/)).toBeInTheDocument();
    expect(screen.queryByText('Parent Console')).not.toBeInTheDocument();
  });

  it('shows an auth observer error instead of unresolved auth loading', () => {
    useStore.setState({ authUser: undefined, currentUser: null, bootstrapError: '[Auth observer] network-request-failed', appReady: false });
    renderApp();
    expect(screen.getByText('Connection Error')).toBeInTheDocument();
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });

  it('routes an authenticated resolved profile without familyId to onboarding', async () => {
    useStore.setState({ currentUser: { id: 'parent1', role: 'parent', displayName: 'Parent' }, appReady: true, loading: false });
    renderApp();
    expect(await screen.findByText('Onboarding Screen')).toBeInTheDocument();
  });
});
