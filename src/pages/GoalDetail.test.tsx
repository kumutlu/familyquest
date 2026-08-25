import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Capture onSnapshot callbacks so tests can push ledger / proposal updates.
const snapshotCallbacks: Record<string, (snap: any) => void> = {};
const firestoreMock = vi.hoisted(() => ({
  onSnapshot: vi.fn((_q: any, cb: any) => {
    const key = `q-${Object.keys(snapshotCallbacks).length}`;
    snapshotCallbacks[key] = cb;
    return () => undefined;
  }),
  collection: vi.fn((_db: any, path: string) => ({ path })),
  query: vi.fn((ref: any) => ref),
  orderBy: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  ...firestoreMock,
  db: { name: 'db' },
}));
vi.mock('../lib/firebase', () => ({ db: { name: 'db' }, auth: {} }));

const mockStore: any = {
  currentUser: { id: 'child-1', familyId: 'family-1', role: 'child', displayName: 'Alice' },
  familyData: { id: 'family-1', currency: '£' },
  savingsGoals: [],
  familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Alice' }],
  loading: false,
  bootstrapError: null,
  featureErrors: {},
  bootstrapStatus: {},
  retryBootstrap: vi.fn(),
};

vi.mock('../store/useStore', () => ({ useStore: () => mockStore }));
vi.mock('../lib/api', () => ({
  completeGoalPurchased: vi.fn().mockResolvedValue(undefined),
  returnGoalFunds: vi.fn().mockResolvedValue(undefined),
  cancelGoal: vi.fn().mockResolvedValue(undefined),
  approveMatchProposal: vi.fn().mockResolvedValue(undefined),
  rejectMatchProposal: vi.fn().mockResolvedValue(undefined),
}));

import { GoalDetail } from './GoalDetail';
import { completeGoalPurchased, returnGoalFunds, cancelGoal } from '../lib/api';

beforeEach(() => {
  Object.keys(snapshotCallbacks).forEach(k => delete snapshotCallbacks[k]);
  firestoreMock.onSnapshot.mockClear();
  mockStore.currentUser = { id: 'child-1', familyId: 'family-1', role: 'child', displayName: 'Alice' };
  mockStore.savingsGoals = [{
    id: 'g1', title: 'Bike', kind: 'child', childId: 'child-1',
    targetAmountPence: 10000, currentAmountPence: 6000, status: 'active', version: 1,
  }];
  (completeGoalPurchased as any).mockClear();
  (returnGoalFunds as any).mockClear();
  (cancelGoal as any).mockClear();
});

function renderDetail(goalId = 'g1') {
  return render(
    <MemoryRouter initialEntries={[`/goals/${goalId}`]}>
      <Routes>
        <Route path="/goals/:goalId" element={<GoalDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Goal detail page', () => {
  it('does not subscribe to goal history for a direct sibling goal URL absent from the child store', () => {
    mockStore.savingsGoals = [
      { id: 'family-goal', title: 'Family holiday', kind: 'family', targetAmountPence: 10000, currentAmountPence: 1000, status: 'active', version: 1 },
      { id: 'g1', title: 'Bike', kind: 'child', childId: 'child-1', targetAmountPence: 10000, currentAmountPence: 6000, status: 'active', version: 1 },
    ];

    renderDetail('sibling-goal');

    expect(screen.getByText('Goal not found.')).toBeInTheDocument();
    expect(firestoreMock.onSnapshot).not.toHaveBeenCalled();
  });

  it('shows contribution breakdown derived from the ledger', async () => {
    renderDetail();
    // Push a ledger with a child contribution + parent contribution + auto match.
    const cb = Object.values(snapshotCallbacks)[0];
    cb({
      docs: [
        { id: 'c1', data: () => ({ contribId: 'c1', type: 'child_contribution', ownerType: 'child', ownerId: 'child-1', amountPence: 6000, status: 'applied' }) },
        { id: 'c2', data: () => ({ contribId: 'c2', type: 'parent_contribution', ownerType: 'parent', ownerId: 'parent-1', amountPence: 2000, status: 'applied' }) },
        { id: 'c3', data: () => ({ contribId: 'c3', type: 'auto_match', ownerType: 'parent', ownerId: 'parent-1', amountPence: 1000, status: 'applied' }) },
      ],
    });
    await waitFor(() => expect(screen.getByText('Contribution Breakdown')).toBeInTheDocument());
    expect(screen.getByText('Child savings')).toBeInTheDocument();
    expect(screen.getByText('Parent contributions')).toBeInTheDocument();
    expect(screen.getByText('Auto matches')).toBeInTheDocument();
  });

  it('renders reached status banner when target reached', async () => {
    mockStore.savingsGoals = [{
      id: 'g1', title: 'Bike', kind: 'child', childId: 'child-1',
      targetAmountPence: 10000, currentAmountPence: 10000, status: 'reached', version: 1,
    }];
    renderDetail();
    await waitFor(() => expect(screen.getByText(/Target reached/)).toBeInTheDocument());
  });

  it('shows terminal (purchased) closed state with no action buttons', async () => {
    mockStore.currentUser = { id: 'parent-1', familyId: 'family-1', role: 'parent', displayName: 'Parent' };
    mockStore.savingsGoals = [{
      id: 'g1', title: 'Bike', kind: 'child', childId: 'child-1',
      targetAmountPence: 10000, currentAmountPence: 10000, status: 'completed_purchased', version: 1,
    }];
    renderDetail();
    await waitFor(() => expect(screen.getByText(/is purchased and is now closed/)).toBeInTheDocument());
    expect(screen.queryByText('Contribute')).not.toBeInTheDocument();
  });

  it('parent can mark purchased / return / cancel', async () => {
    mockStore.currentUser = { id: 'parent-1', familyId: 'family-1', role: 'parent', displayName: 'Parent' };
    renderDetail();
    await waitFor(() => expect(screen.getByText('Mark Purchased')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Mark Purchased'));
    await waitFor(() => expect(completeGoalPurchased).toHaveBeenCalled());
    fireEvent.click(screen.getByText('Return Funds'));
    await waitFor(() => expect(returnGoalFunds).toHaveBeenCalled());
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(cancelGoal).toHaveBeenCalled());
  });
});
