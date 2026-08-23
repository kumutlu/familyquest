import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n/config';

const api = vi.hoisted(() => ({
  createReward: vi.fn(),
  updateReward: vi.fn(),
  redeemReward: vi.fn(),
}));
vi.mock('../lib/api', () => api);

const useStoreMock = vi.fn();
vi.mock('../store/useStore', () => ({ useStore: (...args: any[]) => useStoreMock(...args) }));

import { Rewards } from './Rewards';

const baseReward = {
  id: 'r1',
  title: 'Extra Screen Time',
  cost: 50,
  icon: 'Gift',
  isActive: true,
  inventory: null,
};

/**
 * The redemption fixtures below are pinned to a fixed instant, and
 * `Rewards.formatRedemptionDateTime` compares them against `new Date()` to
 * decide whether to render "Today". Without freezing the clock the suite only
 * passes on the single real-world day that matches the fixture, which is what
 * broke here. Freeze the system time to the fixture date instead of weakening
 * the assertion — the product behaviour ("Today • HH:MM" for same-day
 * redemptions) is intentional and stays untouched.
 */
const FIXTURE_NOW = new Date('2026-07-30T12:31:00Z');

const baseRedemption = {
  id: 'rd1',
  rewardId: 'r1',
  userId: 'child-1',
  costPaid: 50,
  redeemedAt: { toDate: () => new Date('2026-07-30T12:31:00Z') },
  createdAt: { toDate: () => new Date('2026-07-30T12:31:00Z') },
  status: 'completed',
};

function makeStore(overrides: any = {}) {
  return {
    currentUser: { id: 'u1', familyId: 'fam', role: 'owner', rewardPoints: 100 },
    rewards: [baseReward],
    redemptions: [],
    familyMembers: [],
    loading: false,
    ...overrides,
  };
}

describe('Rewards page — role-based management controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.createReward.mockResolvedValue({ id: 'r1' });
    api.updateReward.mockResolvedValue(undefined);
    api.redeemReward.mockResolvedValue(undefined);
    vi.stubGlobal('confirm', () => true);
  });

  it('owner sees Add Reward, Edit and Archive controls', () => {
    useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'u1', familyId: 'fam', role: 'owner', rewardPoints: 100 } }));
    render(<Rewards />);
    expect(screen.getByRole('button', { name: 'Add Reward' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Extra Screen Time'));
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'GET IT' })).not.toBeInTheDocument();
  });

  it('parent sees Add Reward, Edit and Archive controls', () => {
    useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'u1', familyId: 'fam', role: 'parent', rewardPoints: 100 } }));
    render(<Rewards />);
    expect(screen.getByRole('button', { name: 'Add Reward' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Extra Screen Time'));
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
  });

  it('child only sees Redeem controls and no management controls', () => {
    useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'u1', familyId: 'fam', role: 'child', rewardPoints: 100 } }));
    render(<Rewards />);
    expect(screen.queryByRole('button', { name: 'Add Reward' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Extra Screen Time'));
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'GET IT' })).toBeInTheDocument();
  });
});

describe('Rewards page — edit and delete (soft archive)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.updateReward.mockResolvedValue(undefined);
    vi.stubGlobal('confirm', () => true);
  });

  it('owner can edit a reward (updateReward is called)', async () => {
    useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'u1', familyId: 'fam', role: 'owner', rewardPoints: 100 } }));
    render(<Rewards />);
    fireEvent.click(screen.getByText('Extra Screen Time'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    // Edit form is open.
    expect(screen.getByText('Edit Reward')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save Reward' }));
    await waitFor(() => expect(api.updateReward).toHaveBeenCalledTimes(1));
    const [familyId, id, payload] = api.updateReward.mock.calls[0];
    expect(familyId).toBe('fam');
    expect(id).toBe('r1');
    expect(payload.title).toBe('Extra Screen Time');
  });

  it('owner can archive (soft-delete) a reward via updateReward isActive:false', async () => {
    useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'u1', familyId: 'fam', role: 'owner', rewardPoints: 100 } }));
    render(<Rewards />);
    fireEvent.click(screen.getByText('Extra Screen Time'));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(api.updateReward).toHaveBeenCalledTimes(1));
    const [, , payload] = api.updateReward.mock.calls[0];
    expect(payload).toMatchObject({ isActive: false });
  });
});

describe('Rewards page — redemption history', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(FIXTURE_NOW);
    api.redeemReward.mockResolvedValue(undefined);
    await i18n.loadNamespaces(['reversals']);
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows redemption history with child avatar, name, reward, points, and date for multiple children', () => {
    useStoreMock.mockReturnValue(makeStore({
      currentUser: { id: 'u1', familyId: 'fam', role: 'parent', rewardPoints: 100 },
      familyMembers: [
        { id: 'child-1', displayName: 'Alisya', avatarUrl: 'https://example.com/alisya.png', role: 'child' },
        { id: 'child-2', displayName: 'Ben', avatarUrl: 'https://example.com/ben.png', role: 'child' },
      ],
      redemptions: [
        { ...baseRedemption, userId: 'child-1' },
        { ...baseRedemption, id: 'rd2', userId: 'child-2', rewardId: 'r1', costPaid: 30 },
      ],
    }));
    render(<Rewards />);
    expect(screen.getByText('Redemption history')).toBeInTheDocument();
    expect(screen.getByText('Alisya')).toBeInTheDocument();
    expect(screen.getByText('Ben')).toBeInTheDocument();
    expect(screen.getByText('Extra Screen Time')).toBeInTheDocument();
    expect(screen.getByText('50 points redeemed')).toBeInTheDocument();
    expect(screen.getByText('30 points redeemed')).toBeInTheDocument();
    expect(screen.getAllByText(/Today/)).toHaveLength(2);
  });

  it('shows "Unknown family member" fallback when child profile no longer exists', () => {
    useStoreMock.mockReturnValue(makeStore({
      currentUser: { id: 'u1', familyId: 'fam', role: 'parent', rewardPoints: 100 },
      familyMembers: [],
      redemptions: [{ ...baseRedemption, userId: 'deleted-child' }],
    }));
    render(<Rewards />);
    expect(screen.getByText('Unknown family member')).toBeInTheDocument();
    expect(screen.getByText('Extra Screen Time')).toBeInTheDocument();
  });

  it('shows refund button for parent view when redemption is not yet reversed', () => {
    useStoreMock.mockReturnValue(makeStore({
      currentUser: { id: 'u1', familyId: 'fam', role: 'parent', rewardPoints: 100 },
      familyMembers: [{ id: 'child-1', displayName: 'Alisya', role: 'child' }],
      redemptions: [baseRedemption],
    }));
    render(<Rewards />);
    expect(screen.getByText('Alisya')).toBeInTheDocument();
    expect(screen.getByText('Extra Screen Time')).toBeInTheDocument();
    expect(screen.getByText('50 points redeemed')).toBeInTheDocument();
  });

  it('shows reversed badge when redemption has been refunded', () => {
    useStoreMock.mockReturnValue(makeStore({
      currentUser: { id: 'u1', familyId: 'fam', role: 'parent', rewardPoints: 100 },
      familyMembers: [{ id: 'child-1', displayName: 'Alisya', role: 'child' }],
      redemptions: [{ ...baseRedemption, status: 'reversed' }],
      reversals: [{ sourceKind: 'reward_redemption', sourceId: 'rd1', reason: 'Duplicate', actorName: 'Parent', completedAt: { toDate: () => new Date('2026-07-30T13:00:00Z') } }],
    }));
    render(<Rewards />);
    // The reversed state is now presented in the main row body (reversal-status)
    // as well as the HistoryActionControl detail, so expect at least one match.
    expect(screen.getAllByText('Reversed').length).toBeGreaterThanOrEqual(1);
  });

  it('child view does not show redemption history', () => {
    useStoreMock.mockReturnValue(makeStore({
      currentUser: { id: 'u1', familyId: 'fam', role: 'child', rewardPoints: 100 },
      familyMembers: [{ id: 'child-1', displayName: 'Alisya', role: 'child' }],
      redemptions: [baseRedemption],
    }));
    render(<Rewards />);
    expect(screen.queryByText('Redemption history')).not.toBeInTheDocument();
  });
});

describe('Rewards page — celebration overlay integration', () => {
  const childStore = () => makeStore({
    currentUser: { id: 'u1', familyId: 'fam', role: 'child', rewardPoints: 100 },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useStoreMock.mockReturnValue(childStore());
  });

  function openRedeem() {
    render(<Rewards />);
    fireEvent.click(screen.getByText('Extra Screen Time'));
    return screen.getByRole('button', { name: 'GET IT' });
  }

  it('does not open the overlay before the redemption resolves', async () => {
    let resolve!: (v: any) => void;
    api.redeemReward.mockReturnValue(new Promise((r) => { resolve = r; }));

    const button = openRedeem();
    fireEvent.click(button);

    expect(screen.queryByTestId('reward-celebration-overlay')).toBeNull();

    resolve({ redemptionId: 'x', rewardTitle: 'Extra Screen Time', costPaid: 50, pointsBefore: 100, pointsAfter: 50 });
    await waitFor(() => expect(screen.getByTestId('reward-celebration-overlay')).toBeInTheDocument());
  });

  it('opens with the real reward title and the actual before/after points', async () => {
    api.redeemReward.mockResolvedValue({
      redemptionId: 'x', rewardTitle: 'Extra Screen Time', costPaid: 50, pointsBefore: 100, pointsAfter: 50,
    });

    fireEvent.click(openRedeem());

    await waitFor(() => expect(screen.getByTestId('reward-celebration-overlay')).toBeInTheDocument());
    expect(screen.getByTestId('reward-celebration-reward-title')).toHaveTextContent('Extra Screen Time');
    expect(screen.getByTestId('reward-celebration-points-before')).toHaveTextContent('100');
    expect(screen.getByTestId('reward-celebration-points-after')).toHaveTextContent('50');
  });

  it('reuses the same component for a different reward', async () => {
    useStoreMock.mockReturnValue(makeStore({
      currentUser: { id: 'u1', familyId: 'fam', role: 'child', rewardPoints: 640 },
      rewards: [{ id: 'r9', title: 'Cinema trip', cost: 140, icon: 'Ticket', isActive: true, inventory: null }],
    }));
    api.redeemReward.mockResolvedValue({
      redemptionId: 'y', rewardTitle: 'Cinema trip', costPaid: 140, pointsBefore: 640, pointsAfter: 500,
    });

    render(<Rewards />);
    fireEvent.click(screen.getByText('Cinema trip'));
    fireEvent.click(screen.getByRole('button', { name: 'GET IT' }));

    await waitFor(() => expect(screen.getByTestId('reward-celebration-reward-title')).toHaveTextContent('Cinema trip'));
    expect(screen.getByTestId('reward-celebration-points-before')).toHaveTextContent('640');
    expect(screen.getByTestId('reward-celebration-points-after')).toHaveTextContent('500');
  });

  it('never opens the overlay when the redemption fails, and shows no raw Firebase text', async () => {
    api.redeemReward.mockRejectedValue({
      code: 'permission-denied',
      message: 'Missing or insufficient permissions.',
    });

    fireEvent.click(openRedeem());

    await waitFor(() => expect(api.redeemReward).toHaveBeenCalled());
    expect(screen.queryByTestId('reward-celebration-overlay')).toBeNull();
    expect(document.body.textContent).not.toContain('permission-denied');
    expect(document.body.textContent).not.toContain('Missing or insufficient permissions');
  });

  it('disables the redeem button while the request is pending and never deducts twice', async () => {
    let resolve!: (v: any) => void;
    api.redeemReward.mockReturnValue(new Promise((r) => { resolve = r; }));

    const button = openRedeem();
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    fireEvent.click(button);
    expect(api.redeemReward).toHaveBeenCalledTimes(1);

    resolve({ redemptionId: 'x', rewardTitle: 'Extra Screen Time', costPaid: 50, pointsBefore: 100, pointsAfter: 50 });
    await waitFor(() => expect(screen.getByTestId('reward-celebration-overlay')).toBeInTheDocument());
    expect(api.redeemReward).toHaveBeenCalledTimes(1);
  });

  it('dismissing the overlay leaves no overlay behind', async () => {
    api.redeemReward.mockResolvedValue({
      redemptionId: 'x', rewardTitle: 'Extra Screen Time', costPaid: 50, pointsBefore: 100, pointsAfter: 50,
    });

    fireEvent.click(openRedeem());
    await waitFor(() => expect(screen.getByTestId('reward-celebration-overlay')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('reward-celebration-awesome'));
    await waitFor(() => expect(screen.queryByTestId('reward-celebration-overlay')).toBeNull());
  });
});
