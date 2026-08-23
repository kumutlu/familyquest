import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({
  approveTaskCompletion: vi.fn(),
  rejectTaskCompletion: vi.fn(),
  approveTransferRequest: vi.fn(),
  rejectTransferRequest: vi.fn(),
  approveMoneyRequest: vi.fn(),
  rejectMoneyRequest: vi.fn(),
  mapApprovalError: vi.fn(),
}));
vi.mock('../../lib/api', () => api);

const useStoreMock = vi.fn();
vi.mock('../../store/useStore', () => ({ useStore: (...args: any[]) => useStoreMock(...args) }));

import { SwipeReview } from './SwipeReview';

function completion(overrides: Record<string, unknown> & { id: string }) {
  return {
    taskId: 't1',
    assigneeId: 'childA',
    status: 'pending_approval',
    completedAt: { toDate: () => new Date(2026, 7, 21, 10, 0, 0) },
    periodKey: '2026-08-21',
    ...overrides,
  };
}

function makeStore(overrides: any = {}) {
  return {
    currentUser: { id: 'p1', familyId: 'fam', role: 'owner' },
    tasks: [{ id: 't1', title: 'Feed the cat', pointsReward: 10 }],
    taskCompletions: [completion({ id: 'c1' })],
    familyMembers: [
      { id: 'childA', displayName: 'Ali', role: 'child', avatarUrl: 'a.png' },
      { id: 'childB', displayName: 'Osman', role: 'child' },
    ],
    bootstrapStatus: { tasks: 'ready', members: 'ready' },
    ...overrides,
  };
}

function renderReview() {
  return render(
    <MemoryRouter>
      <SwipeReview />
    </MemoryRouter>,
  );
}

describe('SwipeReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.approveTaskCompletion.mockResolvedValue(undefined);
    api.rejectTaskCompletion.mockResolvedValue(undefined);
    api.mapApprovalError.mockReturnValue({ stale: false, message: 'Failed' });
  });

  it('shows skeletons while snapshots hydrate — never a false all-caught-up', () => {
    useStoreMock.mockReturnValue(makeStore({ bootstrapStatus: { tasks: 'loading', members: 'loading' } }));
    renderReview();
    expect(screen.getByTestId('swipe-review-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('swipe-review-caught-up')).not.toBeInTheDocument();
  });

  it('renders one card with child identity, quest context and visible controls', () => {
    useStoreMock.mockReturnValue(makeStore());
    renderReview();
    expect(screen.getByTestId('review-card')).toBeInTheDocument();
    expect(screen.getByText('Ali')).toBeInTheDocument();
    expect(screen.getByText('Feed the cat')).toBeInTheDocument();
    expect(screen.getByTestId('review-approve')).toBeInTheDocument();
    expect(screen.getByTestId('review-reject')).toBeInTheDocument();
    expect(screen.getByTestId('review-count')).toHaveTextContent('1');
  });

  it('approve button fires the mutation exactly once (double click safe)', async () => {
    useStoreMock.mockReturnValue(makeStore());
    renderReview();
    const approve = screen.getByTestId('review-approve');
    fireEvent.click(approve);
    fireEvent.click(approve);
    await waitFor(() => expect(api.approveTaskCompletion).toHaveBeenCalledTimes(1));
    expect(api.approveTaskCompletion).toHaveBeenCalledWith('fam', 'c1');
  });

  it('swipe right past the threshold approves exactly once', async () => {
    useStoreMock.mockReturnValue(makeStore());
    renderReview();
    const card = screen.getByTestId('review-card');
    fireEvent.pointerDown(card, { pointerId: 1, clientX: 200 });
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 400 });
    expect(card.getAttribute('data-intent')).toBe('approve');
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 400 });
    await waitFor(() => expect(api.approveTaskCompletion).toHaveBeenCalledTimes(1));
  });

  it('a swipe below the threshold does not commit', async () => {
    useStoreMock.mockReturnValue(makeStore());
    renderReview();
    const card = screen.getByTestId('review-card');
    fireEvent.pointerDown(card, { pointerId: 1, clientX: 200 });
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 210 });
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 210 });
    expect(api.approveTaskCompletion).not.toHaveBeenCalled();
    expect(api.rejectTaskCompletion).not.toHaveBeenCalled();
  });

  it('a committed swipe followed by a button click does not duplicate', async () => {
    useStoreMock.mockReturnValue(makeStore());
    renderReview();
    const card = screen.getByTestId('review-card');
    fireEvent.pointerDown(card, { pointerId: 1, clientX: 200 });
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 420 });
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 420 });
    fireEvent.click(screen.getByTestId('review-approve'));
    await waitFor(() => expect(api.approveTaskCompletion).toHaveBeenCalledTimes(1));
  });

  it('rejection requires a reason and sends it through the domain contract', async () => {
    useStoreMock.mockReturnValue(makeStore());
    renderReview();
    fireEvent.click(screen.getByTestId('review-reject'));
    const sheet = await screen.findByRole('dialog', { name: 'What should be different?' });
    const confirm = screen.getByRole('button', { name: 'Send back' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Please redo it' } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(api.rejectTaskCompletion).toHaveBeenCalledWith('fam', 'c1', 'Please redo it'));
    // The reason sheet closes once the mutation is dispatched.
    await waitFor(() => expect(sheet).not.toBeInTheDocument());
  });

  it('a failed mutation restores the card with actionable feedback', async () => {
    api.approveTaskCompletion.mockRejectedValue(new Error('network unreachable'));
    api.mapApprovalError.mockReturnValue({ stale: false, message: 'Network problem' });
    useStoreMock.mockReturnValue(makeStore());
    renderReview();
    fireEvent.click(screen.getByTestId('review-approve'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    // The card is NOT discarded — it can be retried.
    expect(screen.getByTestId('review-card')).toBeInTheDocument();
    expect(screen.getByTestId('review-count')).toHaveTextContent('1');
  });

  it('a stale (already reviewed) item is dropped with a neutral note', async () => {
    api.approveTaskCompletion.mockRejectedValue(new Error('already handled'));
    api.mapApprovalError.mockReturnValue({ stale: true, message: 'Already handled' });
    useStoreMock.mockReturnValue(makeStore());
    renderReview();
    fireEvent.click(screen.getByTestId('review-approve'));
    await waitFor(() => expect(screen.getByText(/already handled/i)).toBeInTheDocument());
    expect(screen.getByTestId('swipe-review-caught-up')).toBeInTheDocument();
  });

  it('multi-child queue keeps child identity on every card', () => {
    useStoreMock.mockReturnValue(
      makeStore({
        taskCompletions: [
          completion({ id: 'c1', assigneeId: 'childA' }),
          completion({ id: 'c2', assigneeId: 'childB', taskId: 't1' }),
        ],
      }),
    );
    renderReview();
    expect(screen.getByText('Ali')).toBeInTheDocument();
    expect(screen.queryByText('Osman')).not.toBeInTheDocument(); // one at a time
    expect(screen.getByTestId('review-count')).toHaveTextContent('2');
  });

  it('single-child review renders without any child filter UI', () => {
    useStoreMock.mockReturnValue(makeStore({ familyMembers: [{ id: 'childA', displayName: 'Ali', role: 'child' }] }));
    renderReview();
    expect(screen.getByText('Ali')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('shows the all-caught-up state with an exit path when the queue empties', () => {
    useStoreMock.mockReturnValue(makeStore({ taskCompletions: [] }));
    renderReview();
    expect(screen.getByTestId('swipe-review-caught-up')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to Home' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Wave 3 — unified typed review queue (transfer + money request kinds)
// ---------------------------------------------------------------------------

function transfer(overrides: Record<string, unknown> & { id: string }) {
  return {
    fromChildId: 'childA',
    fromChildName: 'Ali',
    toChildId: 'childB',
    toChildName: 'Osman',
    amountPence: 200,
    status: 'pending',
    createdAt: { toDate: () => new Date(2026, 7, 21, 11, 0, 0) },
    ...overrides,
  };
}

function moneyRequest(overrides: Record<string, unknown> & { id: string }) {
  return {
    requesterId: 'childB',
    requesterName: 'Osman',
    requestedFromId: 'p1',
    requestedFromName: 'Dad',
    amountPence: 300,
    status: 'pending',
    createdAt: { toDate: () => new Date(2026, 7, 21, 12, 0, 0) },
    ...overrides,
  };
}

describe('SwipeReview — Wave 3 typed kinds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.approveTaskCompletion.mockResolvedValue(undefined);
    api.rejectTaskCompletion.mockResolvedValue(undefined);
    api.approveTransferRequest.mockResolvedValue(undefined);
    api.rejectTransferRequest.mockResolvedValue(undefined);
    api.approveMoneyRequest.mockResolvedValue(undefined);
    api.rejectMoneyRequest.mockResolvedValue(undefined);
    api.mapApprovalError.mockReturnValue({ stale: false, message: 'Failed' });
  });

  it('renders a transfer card with a distinct kind badge and both children', () => {
    useStoreMock.mockReturnValue(makeStore({ taskCompletions: [], transferRequests: [transfer({ id: 'tr1' })] }));
    renderReview();
    expect(screen.getByTestId('review-kind-transfer')).toHaveTextContent('Money transfer');
    // Sender appears as actor identity AND inside the transfer summary row.
    expect(screen.getAllByText('Ali').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Osman').length).toBeGreaterThan(0);
    expect(screen.getByText('£2.00')).toBeInTheDocument();
  });

  it('approving a transfer calls the transfer mutation exactly once (never the quest one)', async () => {
    useStoreMock.mockReturnValue(makeStore({ taskCompletions: [], transferRequests: [transfer({ id: 'tr1' })] }));
    renderReview();
    fireEvent.click(screen.getByTestId('review-approve'));
    await waitFor(() => expect(api.approveTransferRequest).toHaveBeenCalledTimes(1));
    expect(api.approveTransferRequest).toHaveBeenCalledWith('fam', 'tr1');
    expect(api.approveTaskCompletion).not.toHaveBeenCalled();
  });

  it('renders a money-request card with its own kind badge and funder context', () => {
    useStoreMock.mockReturnValue(
      makeStore({
        taskCompletions: [],
        moneyRequests: [moneyRequest({ id: 'mr1', status: 'pending_acceptance' })],
      }),
    );
    renderReview();
    expect(screen.getByTestId('review-kind-money-request')).toHaveTextContent('Money request');
    expect(screen.getByText(/Waiting for Dad to accept/)).toBeInTheDocument();
  });

  it('approving a money request calls the money-request mutation exactly once', async () => {
    useStoreMock.mockReturnValue(makeStore({ taskCompletions: [], moneyRequests: [moneyRequest({ id: 'mr1' })] }));
    renderReview();
    fireEvent.click(screen.getByTestId('review-approve'));
    fireEvent.click(screen.getByTestId('review-approve'));
    await waitFor(() => expect(api.approveMoneyRequest).toHaveBeenCalledTimes(1));
    expect(api.approveMoneyRequest).toHaveBeenCalledWith('fam', 'mr1');
  });

  it('rejecting a transfer keeps the reason-required contract and calls the right mutation', async () => {
    useStoreMock.mockReturnValue(makeStore({ taskCompletions: [], transferRequests: [transfer({ id: 'tr1' })] }));
    renderReview();
    fireEvent.click(screen.getByTestId('review-reject'));
    const confirm = screen.getByRole('button', { name: 'Send back' });
    expect(confirm).toBeDisabled(); // reason required
    fireEvent.change(screen.getByPlaceholderText(/Add a short note/), { target: { value: 'Save your money' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(api.rejectTransferRequest).toHaveBeenCalledTimes(1));
    expect(api.rejectTransferRequest).toHaveBeenCalledWith('fam', 'tr1', 'Save your money');
  });

  it('restores a failed transfer card instead of silently dropping it', async () => {
    api.approveTransferRequest.mockRejectedValue(new Error('Sender no longer has sufficient funds.'));
    useStoreMock.mockReturnValue(makeStore({ taskCompletions: [], transferRequests: [transfer({ id: 'tr1' })] }));
    renderReview();
    fireEvent.click(screen.getByTestId('review-approve'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByTestId('review-card')).toBeInTheDocument();
    expect(screen.queryByTestId('swipe-review-caught-up')).not.toBeInTheDocument();
  });

  it('merges kinds into one FIFO queue and reaches all-caught-up after mixed decisions', async () => {
    useStoreMock.mockReturnValue(
      makeStore({
        taskCompletions: [completion({ id: 'c1', completedAt: { toDate: () => new Date(2026, 7, 21, 9, 0, 0) } })],
        transferRequests: [transfer({ id: 'tr1' })],
        moneyRequests: [moneyRequest({ id: 'mr1' })],
      }),
    );
    renderReview();
    expect(screen.getByTestId('review-count')).toHaveTextContent('3');
    // Oldest first: the quest card (09:00).
    expect(screen.getByTestId('review-kind-quest')).toBeInTheDocument();

    const approve = () => screen.getByTestId('review-approve');
    fireEvent.click(approve());
    await waitFor(() => expect(api.approveTaskCompletion).toHaveBeenCalledTimes(1));
    // Next card is the transfer (11:00); wait for the exit animation to clear.
    await waitFor(() => expect(screen.getByTestId('review-kind-transfer')).toBeInTheDocument());
    await waitFor(() => expect(approve()).toBeEnabled());
    fireEvent.click(approve());
    await waitFor(() => expect(api.approveTransferRequest).toHaveBeenCalledTimes(1));
    // Last card is the money request (12:00).
    await waitFor(() => expect(screen.getByTestId('review-kind-money-request')).toBeInTheDocument());
    await waitFor(() => expect(approve()).toBeEnabled());
    fireEvent.click(approve());
    await waitFor(() => expect(screen.getByTestId('swipe-review-caught-up')).toBeInTheDocument());
  });
});
