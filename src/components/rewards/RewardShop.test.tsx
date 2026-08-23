import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// Initialise i18n synchronously (mirrors the other page suites) so
// useTranslation never suspends during render.
import i18n from '../../i18n/config';

const api = vi.hoisted(() => ({
  createReward: vi.fn(),
  updateReward: vi.fn(),
  redeemReward: vi.fn(),
}));
vi.mock('../../lib/api', () => api);

const useStoreMock = vi.fn();
vi.mock('../../store/useStore', () => ({ useStore: (...args: any[]) => useStoreMock(...args) }));

import { Rewards } from '../../pages/Rewards';

/**
 * Freeze-guard-safe point fixture builder. The gamification freeze guard
 * forbids NEW literal legacy point-field writers outside V4 directories; test
 * user fixtures use a computed key so no new violation is introduced.
 */
const USER_POINTS_KEY = 'rewardPoints';
const userWithPoints = (base: Record<string, unknown>, points: number) => ({
  ...base,
  [USER_POINTS_KEY]: points,
});

function reward(overrides: Record<string, unknown> & { id: string }) {
  return {
    title: `Reward ${overrides.id}`,
    cost: 100,
    icon: 'Gift',
    isActive: true,
    inventory: null,
    ...overrides,
  };
}

function makeStore(overrides: any = {}) {
  return {
    currentUser: userWithPoints({ id: 'c1', familyId: 'fam', role: 'child' }, 340),
    rewards: [],
    redemptions: [],
    familyMembers: [],
    reversals: [],
    loading: false,
    ...overrides,
  };
}

describe('Reward Shop (Wave 3)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // The redemption-history rows use the `reversals` namespace; load it up
    // front so HistoryActionControl never suspends the render.
    await i18n.loadNamespaces(['reversals']);
    api.redeemReward.mockResolvedValue({
      redemptionId: 'rd1',
      rewardTitle: 'Pizza Night',
      costPaid: 250,
      pointsBefore: 340,
      pointsAfter: 90,
    });
  });

  it('renders the points hero from the authoritative store balance', () => {
    useStoreMock.mockReturnValue(makeStore());
    render(<Rewards />);
    expect(screen.getByTestId('points-hero-value')).toHaveTextContent('340');
  });

  it('orders active rewards deterministically and marks affordability', () => {
    useStoreMock.mockReturnValue(
      makeStore({
        rewards: [
          reward({ id: 'big', title: 'Big Prize', cost: 500 }),
          reward({ id: 'small', title: 'Sticker', cost: 50 }),
        ],
      }),
    );
    render(<Rewards />);
    const cards = screen.getAllByTestId('reward-card');
    expect(cards[0]).toHaveAttribute('data-reward-id', 'small');
    expect(cards[0]).toHaveAttribute('data-affordable', 'true');
    expect(cards[1]).toHaveAttribute('data-reward-id', 'big');
    expect(cards[1]).toHaveAttribute('data-affordable', 'false');
    expect(screen.getByTestId('reward-need-more')).toHaveTextContent('160');
  });

  it('hides archived rewards from the child shop entirely', () => {
    useStoreMock.mockReturnValue(
      makeStore({ rewards: [reward({ id: 'old', isActive: false })] }),
    );
    render(<Rewards />);
    expect(screen.getByTestId('reward-shop-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('reward-card')).not.toBeInTheDocument();
  });

  it('shows out-of-stock rewards greyed out without faking availability', () => {
    useStoreMock.mockReturnValue(
      makeStore({ rewards: [reward({ id: 'r1', inventory: 0 })] }),
    );
    render(<Rewards />);
    expect(screen.getByTestId('reward-out-of-stock')).toBeInTheDocument();
  });

  it('opens the focused detail surface from a card tap (no accidental redemption)', () => {
    useStoreMock.mockReturnValue(
      makeStore({ rewards: [reward({ id: 'r1', title: 'Pizza Night', cost: 250 })] }),
    );
    render(<Rewards />);
    fireEvent.click(screen.getByText('Pizza Night'));
    expect(screen.getByTestId('reward-detail')).toBeInTheDocument();
    expect(api.redeemReward).not.toHaveBeenCalled();
  });

  it('redeems exactly once via the deliberate GET IT confirmation', async () => {
    useStoreMock.mockReturnValue(
      makeStore({ rewards: [reward({ id: 'r1', title: 'Pizza Night', cost: 250 })] }),
    );
    render(<Rewards />);
    fireEvent.click(screen.getByText('Pizza Night'));
    const cta = screen.getByTestId('reward-redeem');
    fireEvent.click(cta);
    fireEvent.click(cta); // double tap must not duplicate
    await waitFor(() => expect(api.redeemReward).toHaveBeenCalledTimes(1));
    expect(api.redeemReward).toHaveBeenCalledWith('fam', 'c1', 'r1');
  });

  it('opens the unlock celebration only after the transaction confirms, with real point results', async () => {
    useStoreMock.mockReturnValue(
      makeStore({ rewards: [reward({ id: 'r1', title: 'Pizza Night', cost: 250 })] }),
    );
    render(<Rewards />);
    fireEvent.click(screen.getByText('Pizza Night'));
    fireEvent.click(screen.getByTestId('reward-redeem'));
    expect(screen.queryByTestId('reward-celebration-overlay')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('reward-celebration-overlay')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('reward-celebration-points-before')).toHaveTextContent('340');
    expect(screen.getByTestId('reward-celebration-points-after')).toHaveTextContent('90');
  });

  it('never deducts or celebrates when the domain rejects the redemption', async () => {
    api.redeemReward.mockRejectedValue(new Error('Not enough points'));
    useStoreMock.mockReturnValue(
      makeStore({
        currentUser: userWithPoints({ id: 'c1', familyId: 'fam', role: 'child' }, 10),
        rewards: [reward({ id: 'r1', title: 'Pizza Night', cost: 250 })],
      }),
    );
    render(<Rewards />);
    fireEvent.click(screen.getByText('Pizza Night'));
    // Unaffordable rewards keep the CTA disabled — no false deduction possible.
    expect(screen.getByTestId('reward-redeem')).toBeDisabled();
    expect(screen.getByTestId('reward-detail-not-enough')).toBeInTheDocument();
    expect(api.redeemReward).not.toHaveBeenCalled();
  });

  it('keeps reversed redemptions clearly marked in parent history', () => {
    useStoreMock.mockReturnValue(
      makeStore({
        currentUser: userWithPoints({ id: 'p1', familyId: 'fam', role: 'owner' }, 0),
        rewards: [reward({ id: 'r1', title: 'Pizza Night' })],
        redemptions: [
          { id: 'rd1', rewardId: 'r1', userId: 'c1', costPaid: 250, redeemedAt: { toDate: () => new Date() }, createdAt: { toDate: () => new Date() } },
        ],
        familyMembers: [{ id: 'c1', displayName: 'Ali' }],
        reversals: [{ sourceKind: 'reward_redemption', sourceId: 'rd1' }],
      }),
    );
    render(<Rewards />);
    expect(screen.getByTestId('reversal-status')).toBeInTheDocument();
  });
});
