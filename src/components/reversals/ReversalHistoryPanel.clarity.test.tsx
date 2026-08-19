import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import enReversals from '../../i18n/locales/en/reversals.json';

const api = vi.hoisted(() => ({ reverseTransaction: vi.fn(), cancelPendingApproval: vi.fn() }));
vi.mock('../../lib/reversalApi', () => ({ reverseTransaction: api.reverseTransaction }));
vi.mock('../../lib/api', () => ({ cancelPendingApproval: api.cancelPendingApproval }));

// Two independent events that share the *visible* title "Auction":
//   Event A — Mostium, wallet_transaction (withdrawal), 400 minor units, title "Auction"
//   Event B — Mnalium, reward_redemption, reward titled "Auction", 500 points
// The current UX renders both with the title "Auction" and only a developer-term
// source kind ("wallet transaction" / "reward redemption"), so they look like
// duplicates. This test asserts the clearer, source-aware presentation.
const withdrawalTime = new Date('2026-08-19T11:01:00');
const redemptionTime = new Date('2026-08-19T10:05:00');

vi.mock('../../store/useStore', () => ({
  useStore: () => ({
    currentUser: { id: 'parent-1', familyId: 'family-1', role: 'parent', displayName: 'Kemal' },
    familyData: { currency: '£' },
    familyMembers: [
      { id: 'child-1', displayName: 'Mostium', rewardPoints: 0 },
      { id: 'child-2', displayName: 'Mnalium', rewardPoints: 0 },
    ],
    childWallets: [
      { id: 'child-1', balance: 1000 },
      { id: 'child-2', balance: 1000 },
    ],
    funds: [],
    reversals: [],
    walletTransactions: [{
      id: 'wt-1',
      type: 'withdrawal',
      status: 'completed',
      title: 'Auction',
      timestamp: { toDate: () => withdrawalTime },
      childId: 'child-1',
      effectSnapshot: {
        schemaVersion: 1,
        entityType: 'wallet_transaction',
        familyId: 'family-1',
        actorId: 'parent-1',
        childId: 'child-1',
        walletDeltaPence: -400,
        xpAdjustment: 0,
      },
    }],
    fundTransactions: [],
    behaviourEvents: [],
    taskCompletions: [],
    redemptions: [{
      id: 'rd-1',
      rewardId: 'reward-auction',
      type: 'redemption',
      status: 'completed',
      redeemedAt: { toDate: () => redemptionTime },
      childId: 'child-2',
      effectSnapshot: {
        schemaVersion: 1,
        entityType: 'reward_redemption',
        familyId: 'family-1',
        actorId: 'parent-1',
        childId: 'child-2',
        pointsDelta: -500,
      },
    }],
    transferRequests: [],
    moneyRequests: [],
    petboxRequests: [],
    tasks: [],
    rewards: [{ id: 'reward-auction', title: 'Auction' }],
  }),
}));

import { ReversalHistoryPanel } from './ReversalHistoryPanel';
import i18n from '../../i18n/config';

describe('ReversalHistoryPanel clarity — independent events with identical titles', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Load the reversals namespace directly so the assertions target the
    // presentation logic rather than the test environment's lazy loader.
    i18n.addResourceBundle('en', 'reversals', enReversals as Record<string, unknown>, true, true);
    await i18n.changeLanguage('en');
  });

  it('distinguishes the wallet withdrawal from the reward redemption despite both being titled "Auction"', () => {
    render(<ReversalHistoryPanel />);

    // Event A — wallet withdrawal by Mostium: must expose the subject, a
    // human-readable type, and the monetary amount (currently missing).
    expect(screen.getByText(/Mostium/)).toBeInTheDocument();
    expect(screen.getByText(/Cash withdrawal/)).toBeInTheDocument();
    expect(screen.getByText('£4.00')).toBeInTheDocument();

    // Event B — reward redemption by Mnalium: must expose the subject, a
    // human-readable type, the original title, and the point amount.
    expect(screen.getByText(/Mnalium/)).toBeInTheDocument();
    expect(screen.getByText(/Reward redemption/)).toBeInTheDocument();
    expect(screen.getAllByText(/Auction/).length).toBeGreaterThan(0);
    expect(screen.getByText(/−500/)).toBeInTheDocument();
  });
});
