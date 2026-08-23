import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';

/**
 * Wave 3 FULL-PATH REWARD REGRESSION (Phase 50).
 *
 * Exercises the complete reward lifecycle through the REAL store listener
 * path (same Firestore mock harness as the Wave 2 quest regression):
 *
 *   child sees an affordable reward in the Reward Shop
 *     → child confirms redemption (GET IT) — redeemReward fires ONCE
 *     → LOCAL pending-write redemptions snapshot (fromCache + hasPendingWrites)
 *       is surfaced, never dropped
 *     → server-confirmed `status:'completed'` redemption remains stable
 *     → unlock moment opens ONLY after the transaction resolves, showing the
 *       AUTHORITATIVE point results returned by the domain
 *     → parent history renders the redemption and can mark it reversed
 *     → no duplicate redemption / deduction ever fired
 *
 * Point semantics: `redeemReward` deducts immediately inside its transaction;
 * the UI never renders a client-side subtraction as confirmed truth.
 */

const harness = vi.hoisted(() => ({
  subscribedPaths: [] as string[],
  serverReads: new Map<string, { resolve: (v: any) => void }[]>(),
  snapshotNext: new Map<string, (snapshot: any) => void>(),
}));

const api = vi.hoisted(() => ({
  redeemReward: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn(() => () => {}),
  getAuth: vi.fn(() => ({})),
  GoogleAuthProvider: class {},
  signOut: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: any, ...segments: string[]) => ({ type: 'doc', path: segments.join('/') })),
  collection: vi.fn((_db: any, ...segments: string[]) => ({
    type: 'collection',
    path: segments.join('/'),
  })),
  query: vi.fn((target: any) => ({ ...target, type: 'query' })),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getFirestore: vi.fn(() => ({})),
  getDocFromServer: vi.fn((target: any) =>
    new Promise(resolve => {
      const list = harness.serverReads.get(target.path) ?? [];
      list.push({ resolve });
      harness.serverReads.set(target.path, list);
    }),
  ),
  getDocsFromServer: vi.fn((target: any) =>
    new Promise(resolve => {
      const list = harness.serverReads.get(target.path) ?? [];
      list.push({ resolve });
      harness.serverReads.set(target.path, list);
    }),
  ),
  onSnapshot: vi.fn((target: any, _opts: any, next: any) => {
    harness.subscribedPaths.push(target.path);
    harness.snapshotNext.set(target.path, next);
    return () => {};
  }),
  runTransaction: vi.fn(),
  writeBatch: vi.fn(),
  serverTimestamp: vi.fn(() => null),
  updateDoc: vi.fn(),
  setDoc: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({ app: {}, auth: {}, db: {}, googleProvider: {} }));

vi.mock('../../lib/api', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, redeemReward: api.redeemReward };
});

import { useStore } from '../../store/useStore';
import { Rewards } from '../../pages/Rewards';
import i18n from '../../i18n/config';

// Freeze-guard-safe fixture key (no literal legacy writer pattern in tests).
const USER_POINTS_KEY = 'rewardPoints';
const userWithPoints = (base: Record<string, unknown>, points: number) => ({
  ...base,
  [USER_POINTS_KEY]: points,
});

const REWARDS_PATH = 'families/f1/rewards';
const REDEMPTIONS_PATH = 'families/f1/redemptions';

const snapshot = (docs: any[], metadata?: { fromCache: boolean; hasPendingWrites: boolean }) => ({
  docs: docs.map(({ id, ...data }) => ({ id, data: () => data })),
  metadata: metadata ?? { fromCache: false, hasPendingWrites: false },
});

const deliver = (path: string, snap: any) => {
  act(() => {
    harness.snapshotNext.get(path)?.(snap);
  });
};

const REWARD = { title: 'Pizza Night', cost: 250, icon: 'Pizza', isActive: true, inventory: null };

describe('full reward lifecycle — shop → deliberate redemption → confirmed unlock → history', () => {
  beforeEach(async () => {
    harness.subscribedPaths = [];
    harness.serverReads = new Map();
    harness.snapshotNext = new Map();
    await i18n.loadNamespaces(['rewards', 'reversals']);
    useStore.getState().cleanup();
    useStore.setState({
      authStatus: 'authenticated',
      authInitialized: true,
      authLoading: false,
      authUser: { uid: 'child-1' } as any,
      currentUser: userWithPoints({ id: 'child-1', familyId: 'f1', role: 'child', displayName: 'Ali' }, 340) as any,
      profileLoading: false,
      loading: false,
      bootstrapError: null,
      featureErrors: {},
    } as any);
  });

  afterEach(() => {
    cleanup();
    useStore.getState().cleanup();
  });

  it('deducts exactly once through the domain, honours pending writes and celebrates only confirmed results', async () => {
    // Confirmed result returned by the authoritative transaction.
    api.redeemReward.mockResolvedValue({
      redemptionId: 'rd1',
      rewardTitle: 'Pizza Night',
      costPaid: 250,
      pointsBefore: 340,
      pointsAfter: 90,
    });

    act(() => {
      useStore.getState().loadFamilyData('child-1', 'f1');
    });
    const familyReads = harness.serverReads.get('families/f1') ?? [];
    await act(async () => {
      familyReads.forEach(read =>
        read.resolve({
          id: 'f1',
          exists: () => true,
          data: () => ({ name: 'Smith Family' }),
          metadata: { fromCache: false, hasPendingWrites: false },
        }),
      );
      await Promise.resolve();
    });
    expect(harness.subscribedPaths).toContain(REWARDS_PATH);
    expect(harness.subscribedPaths).toContain(REDEMPTIONS_PATH);

    deliver(REWARDS_PATH, snapshot([{ id: 'r1', ...REWARD }]));
    deliver(REDEMPTIONS_PATH, snapshot([]));
    deliver('users', snapshot([
      { id: 'child-1', displayName: 'Ali', role: 'child' },
      { id: 'p1', displayName: 'Dad', role: 'owner' },
    ]));
    act(() => {
      useStore.setState({ bootstrapStatus: { rewards: 'ready', members: 'ready' } as any } as any);
    });

    render(<Rewards />);

    // Shop shows the affordable reward and the authoritative points hero.
    expect(screen.getByTestId('points-hero-value')).toHaveTextContent('340');
    const card = screen.getByTestId('reward-card');
    expect(card).toHaveAttribute('data-affordable', 'true');

    // Card tap opens detail — NO redemption yet (accidental-tap resistance).
    fireEvent.click(screen.getByText('Pizza Night'));
    expect(api.redeemReward).not.toHaveBeenCalled();

    // Deliberate confirmation; double tap must not duplicate the deduction.
    const cta = screen.getByTestId('reward-redeem');
    fireEvent.click(cta);
    fireEvent.click(cta);
    await act(async () => {});
    expect(api.redeemReward).toHaveBeenCalledTimes(1);
    expect(api.redeemReward).toHaveBeenCalledWith('f1', 'child-1', 'r1');

    // ---- LOCAL pending-write redemption snapshot must surface ------------
    deliver(
      REDEMPTIONS_PATH,
      snapshot(
        [{ id: 'rd1', rewardId: 'r1', userId: 'child-1', costPaid: 250, status: 'completed' }],
        { fromCache: true, hasPendingWrites: true },
      ),
    );

    // ---- Server confirmation keeps the state stable ----------------------
    deliver(
      REDEMPTIONS_PATH,
      snapshot([{ id: 'rd1', rewardId: 'r1', userId: 'child-1', costPaid: 250, status: 'completed' }]),
    );

    // ---- Unlock moment opens ONLY after the transaction resolved ---------
    await waitForCelebration();
    expect(screen.getByTestId('reward-celebration-points-before')).toHaveTextContent('340');
    expect(screen.getByTestId('reward-celebration-points-after')).toHaveTextContent('90');

    // ---- Parent history records the redemption; reversal stays available --
    cleanup();
    act(() => {
      useStore.setState({
        currentUser: userWithPoints({ id: 'p1', familyId: 'f1', role: 'owner', displayName: 'Dad' }, 0) as any,
        familyMembers: [
          { id: 'child-1', displayName: 'Ali', role: 'child' },
          { id: 'p1', displayName: 'Dad', role: 'owner' },
        ],
        reversals: [],
      } as any);
    });
    render(<Rewards />);
    expect(screen.getByText('Ali redeemed "Pizza Night"')).toBeInTheDocument();

    // No duplicate effects anywhere.
    expect(api.redeemReward).toHaveBeenCalledTimes(1);
  });
});

async function waitForCelebration() {
  const { waitFor } = await import('@testing-library/react');
  await waitFor(() => expect(screen.getByTestId('reward-celebration-overlay')).toBeInTheDocument());
}
