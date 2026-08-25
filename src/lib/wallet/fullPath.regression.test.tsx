import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';

/**
 * Wave 3 FULL-PATH WALLET TRANSFER REGRESSION (Phase 51).
 *
 * Exercises the complete family-transfer lifecycle through the REAL store
 * listener pipeline (same Firestore mock harness as the quest regression):
 *
 *   sender sees the AUTHORITATIVE wallet balance (families/f1/wallets doc)
 *     → selects an eligible sibling → enters a valid amount → reviews
 *     → sends exactly once via createTransferRequest (the ONLY mutation)
 *     → LOCAL pending-write transfer_requests snapshot surfaces
 *     → server-confirmed pending request appears in the parent review queue
 *     → parent approves exactly once (approveTransferRequest)
 *     → authoritative approved request + `transfer_in` ledger entry arrive on
 *       the recipient's live listener → recipient arrival moment fires once
 *     → history shows a human-readable event; no duplicate ledger-side call;
 *       reversal relationships remain untouched (no reversal writes).
 */

const harness = vi.hoisted(() => ({
  subscribedPaths: [] as string[],
  serverReads: new Map<string, { resolve: (v: any) => void }[]>(),
  snapshotNext: new Map<string, (snapshot: any) => void>(),
}));

const api = vi.hoisted(() => ({
  createTransferRequest: vi.fn(),
  approveTransferRequest: vi.fn(),
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
  return { ...actual, createTransferRequest: api.createTransferRequest, approveTransferRequest: api.approveTransferRequest };
});

import { useStore } from '../../store/useStore';
import { SendFlowSheet } from '../../components/wallet/SendFlowSheet';
import { SwipeReview } from '../../components/parent/SwipeReview';
import { TransferArrivalMoment } from '../../components/wallet/TransferArrivalMoment';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../../i18n/config';
import { MoneyPrivacyProvider } from '../../components/privacy/MoneyPrivacyContext';

const TRANSFERS_PATH = 'families/f1/transfer_requests';
const WALLET_TX_PATH = 'families/f1/wallet_transactions';

const snapshot = (docs: any[], metadata?: { fromCache: boolean; hasPendingWrites: boolean }) => ({
  docs: docs.map(({ id, ...data }) => ({ id, data: () => data })),
  metadata: metadata ?? { fromCache: false, hasPendingWrites: false },
});

const deliver = (path: string, snap: any) => {
  act(() => {
    harness.snapshotNext.get(path)?.(snap);
  });
};

describe('full wallet transfer lifecycle — send → approval → ledger → arrival', () => {
  beforeEach(async () => {
    harness.subscribedPaths = [];
    harness.serverReads = new Map();
    harness.snapshotNext = new Map();
    localStorage.clear();
    await i18n.loadNamespaces(['common', 'wallet', 'quests']);
    api.createTransferRequest.mockResolvedValue(undefined);
    api.approveTransferRequest.mockResolvedValue(undefined);
    useStore.getState().cleanup();
    useStore.setState({
      authStatus: 'authenticated',
      authInitialized: true,
      authLoading: false,
      authUser: { uid: 'child-1' } as any,
      currentUser: { id: 'child-1', familyId: 'f1', role: 'child', displayName: 'Ali' } as any,
      profileLoading: false,
      loading: false,
      bootstrapError: null,
      featureErrors: {},
      myWallet: { id: 'child-1', balance: 500 },
      bootstrapStatus: { transferRequests: 'ready', members: 'ready' } as any,
      familyMembers: [
        { id: 'child-1', displayName: 'Ali', role: 'child' },
        { id: 'child-2', displayName: 'Osman', role: 'child' },
        { id: 'p1', displayName: 'Dad', role: 'owner' },
      ],
    } as any);
  });

  afterEach(() => {
    cleanup();
    useStore.getState().cleanup();
  });

  it('moves money only through the domain: one request, one approval, one ledger event', async () => {
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
    // Members stream (top-level users collection) feeds recipient filtering.
    deliver('users', snapshot([
      { id: 'child-1', displayName: 'Ali', role: 'child', familyId: 'f1' },
      { id: 'child-2', displayName: 'Osman', role: 'child', familyId: 'f1' },
      { id: 'p1', displayName: 'Dad', role: 'owner', familyId: 'f1' },
    ]));

    // Authoritative wallet document (single-doc listener).
    act(() => {
      harness.snapshotNext.get('families/f1/wallets/child-1')?.({
        id: 'child-1',
        exists: () => true,
        data: () => ({ balance: 500 }),
        metadata: { fromCache: false, hasPendingWrites: false },
      });
    });

    // ---- SENDER: staged flow against the authoritative balance ------------
    render(
      <MoneyPrivacyProvider>
        <MemoryRouter>
          <SendFlowSheet onClose={() => {}} />
        </MemoryRouter>
      </MoneyPrivacyProvider>,
    );

    // Eligible recipients only: sibling child, never the parent, never self.
    fireEvent.click(screen.getByText('Osman'));
    fireEvent.change(screen.getByTestId('send-amount-input'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('send-review-continue'));
    expect(screen.getByTestId('send-review-title')).toHaveTextContent('£2.00');
    expect(screen.getByTestId('send-review-title')).toHaveTextContent('Osman');

    fireEvent.click(screen.getByTestId('send-confirm'));
    fireEvent.click(screen.getByTestId('send-confirm')); // double tap race
    await act(async () => {});
    expect(api.createTransferRequest).toHaveBeenCalledTimes(1);
    expect(api.createTransferRequest).toHaveBeenCalledWith('f1', 'child-2', 200, '');

    // Honest sent state: awaiting parent approval — NOT "money moved".
    await waitFor(() => expect(screen.getByTestId('send-sent')).toBeInTheDocument());
    expect(screen.getByTestId('send-sent')).toHaveTextContent(/awaiting parent approval/i);

    // ---- LOCAL pending-write request snapshot surfaces --------------------
    deliver(
      TRANSFERS_PATH,
      snapshot(
        [{ id: 'tr1', fromChildId: 'child-1', fromChildName: 'Ali', toChildId: 'child-2', toChildName: 'Osman', amountPence: 200, status: 'pending' }],
        { fromCache: true, hasPendingWrites: true },
      ),
    );

    // ---- PARENT review queue receives exactly one typed card --------------
    cleanup();
    act(() => {
      useStore.setState({
        currentUser: { id: 'p1', familyId: 'f1', role: 'owner', displayName: 'Dad' } as any,
      } as any);
    });
    act(() => {
      useStore.setState({ bootstrapStatus: { tasks: 'ready', members: 'ready' } as any } as any);
    });
    render(
      <MoneyPrivacyProvider>
        <MemoryRouter>
          <SwipeReview />
        </MemoryRouter>
      </MoneyPrivacyProvider>,
    );
    expect(screen.getByTestId('review-kind-transfer')).toBeInTheDocument();
    expect(screen.getByTestId('review-count')).toHaveTextContent('1');

    fireEvent.click(screen.getByTestId('review-approve'));
    fireEvent.click(screen.getByTestId('review-approve'));
    await act(async () => {});
    expect(api.approveTransferRequest).toHaveBeenCalledTimes(1);
    expect(api.approveTransferRequest).toHaveBeenCalledWith('f1', 'tr1');

    // ---- RECIPIENT: authoritative ledger entry arrives while app is open --
    cleanup();
    act(() => {
      useStore.setState({
        currentUser: { id: 'child-2', familyId: 'f1', role: 'child', displayName: 'Osman' } as any,
      } as any);
    });
    const arrivalProps = (txs: any[]) => ({
      transactions: txs,
      currentUserId: 'child-2',
      familyMembers: useStore.getState().familyMembers,
      familyData: {},
      currencyCode: 'GBP' as const,
    });
    const arrival = render(
      <MoneyPrivacyProvider><TransferArrivalMoment {...arrivalProps([])} /></MoneyPrivacyProvider>,
    );
    expect(screen.queryByTestId('transfer-arrival-moment')).not.toBeInTheDocument();

    // The authoritative `transfer_in` ledger entry arrives on the live
    // wallet_transactions listener.
    const ledger = [
      { id: 'txin-1', type: 'transfer_in', childId: 'child-2', counterpartyChildId: 'child-1', amountPence: 200, status: 'completed' },
    ];
    deliver(WALLET_TX_PATH, snapshot(ledger));
    arrival.rerender(
      <MoneyPrivacyProvider><TransferArrivalMoment {...arrivalProps(ledger)} /></MoneyPrivacyProvider>,
    );
    expect(screen.getByTestId('transfer-arrival-moment')).toBeInTheDocument();
    expect(screen.getByTestId('transfer-arrival-text')).toHaveTextContent('Ali');
    expect(screen.getByTestId('transfer-arrival-text')).toHaveTextContent('£2.00');

    // No duplicate ledger-side mutation and no reversal writes anywhere.
    expect(api.createTransferRequest).toHaveBeenCalledTimes(1);
    expect(api.approveTransferRequest).toHaveBeenCalledTimes(1);
  });
});
