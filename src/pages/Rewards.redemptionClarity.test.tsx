import { render as rtlRender, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n/config';

/**
 * Regression test for the reported production problem:
 *
 *   "On Rewards → Redemption history, the UI still renders the old
 *    redemption-history rows." (ac55a54 only touched ReversalHistoryPanel,
 *    which is the HOME → Reversible history screen, NOT Rewards.)
 *
 * The ACTUAL renderer for Rewards → Redemption history is
 * `src/pages/Rewards.tsx`, which renders each row with the main body
 * (child name, "{{name}} redeemed \"{{reward}}\"", "{{value}} points redeemed",
 * date) and a small <HistoryActionControl sourceKind="reward_redemption" /> on
 * the right. The reversal state is ONLY shown inside that small action-control
 * badge — the MAIN row body is rendered identically whether the redemption is
 * active or reversed/refunded. That is the "old presentation": a parent scanning
 * the list sees "Mostium redeemed test / 1 points redeemed" and cannot tell from
 * the main body that the points were refunded.
 *
 * This test reproduces the exact production scenario (Mostium, reward "test",
 * 1 point, reversed with reason "Donation refunded" by Kemal) and asserts the
 * intended user-visible clarity: the reversed/refunded state must be presented
 * in the MAIN row body (not only inside the small action-control badge).
 */

const api = vi.hoisted(() => ({
  createReward: vi.fn(),
  updateReward: vi.fn(),
  redeemReward: vi.fn(),
}));
vi.mock('../lib/api', () => api);

const useStoreMock = vi.fn();
vi.mock('../store/useStore', () => ({ useStore: (...args: any[]) => useStoreMock(...args) }));

import { Rewards } from './Rewards';
import { MoneyPrivacyProvider } from '../components/privacy/MoneyPrivacyContext';

function render(ui: ReactElement) {
  return rtlRender(<MoneyPrivacyProvider>{ui}</MoneyPrivacyProvider>);
}

// Fixed instant so the relative-time label is deterministic ("2 weeks ago").
const FIXTURE_NOW = new Date('2026-08-06T21:18:00Z');

const reversedRedemption = {
  id: 'rd_mostium_test',
  rewardId: 'r_test',
  userId: 'mostium',
  costPaid: 1,
  redeemedAt: { toDate: () => new Date('2026-07-23T21:18:00Z') },
  createdAt: { toDate: () => new Date('2026-07-23T21:18:00Z') },
  status: 'completed',
  effectSnapshot: {
    schemaVersion: 1,
    entityType: 'reward_redemption',
    familyId: 'fam',
    actorId: 'mostium',
    childId: 'mostium',
    rewardId: 'r_test',
    pointsDelta: -1,
    xpAdjustment: 0,
  },
};

function makeStore(overrides: any = {}) {
  return {
    currentUser: { id: 'u1', familyId: 'fam', role: 'owner', rewardPoints: 100 },
    rewards: [{ id: 'r_test', title: 'test', cost: 1, icon: 'Gift', isActive: true, inventory: null }],
    redemptions: [],
    familyMembers: [{ id: 'mostium', displayName: 'Mostium', role: 'child' }],
    loading: false,
    ...overrides,
  };
}

describe('Rewards → Redemption history — reversed/refunded clarity', () => {
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

  it('clearly presents a reversed reward redemption in the MAIN row body (not only a small action badge)', () => {
    useStoreMock.mockReturnValue(makeStore({
      redemptions: [reversedRedemption],
      reversals: [{
        sourceKind: 'reward_redemption',
        sourceId: 'rd_mostium_test',
        reason: 'Donation refunded',
        actorName: 'Kemal',
        completedAt: { toDate: () => new Date('2026-08-06T21:18:00Z') },
      }],
    }));
    render(<Rewards />);

    // Main body content (existing behaviour that must be preserved).
    expect(screen.getByText('Mostium redeemed "test"')).toBeInTheDocument();
    expect(screen.getByText('1 points redeemed')).toBeInTheDocument();

    // Intended clarity: the reversed/refunded state must be presented in the
    // MAIN row body via a dedicated status element, not only inside the small
    // HistoryActionControl badge. This element is absent before the fix, so the
    // test is RED until Rewards → Redemption history is updated.
    const status = screen.getByTestId('reversal-status');
    expect(status).toHaveTextContent(/Reversed|Refunded/);
  });

  it('does NOT show a main-body reversal status for an active (non-reversed) redemption', () => {
    useStoreMock.mockReturnValue(makeStore({
      redemptions: [reversedRedemption],
      reversals: [],
    }));
    render(<Rewards />);
    expect(screen.getByText('Mostium redeemed "test"')).toBeInTheDocument();
    expect(screen.queryByTestId('reversal-status')).not.toBeInTheDocument();
  });
});
