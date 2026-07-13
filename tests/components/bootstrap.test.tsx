import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), doc: vi.fn(), onSnapshot: vi.fn(), query: vi.fn(), orderBy: vi.fn(), where: vi.fn(), getFirestore: vi.fn(),
}));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn(), getAuth: vi.fn() }));
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

  it('shows a bootstrap error before the authenticated missing-profile placeholder', () => {
    useStore.setState({ currentUser: null, bootstrapError: '[Profile] permission-denied', appReady: false });
    renderApp();
    expect(screen.getByText('Connection Error')).toBeInTheDocument();
    expect(screen.queryByText('Setting up...')).not.toBeInTheDocument();
  });

  it('routes an authenticated resolved profile without familyId to onboarding', async () => {
    useStore.setState({ currentUser: { id: 'parent1', role: 'parent', displayName: 'Parent' }, appReady: true, loading: false });
    renderApp();
    expect(await screen.findByText('Onboarding Screen')).toBeInTheDocument();
  });
});
