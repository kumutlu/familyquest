import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';

/**
 * Wave 2 FULL-PATH REGRESSION (Phase 39).
 *
 * Exercises the complete quest lifecycle through the REAL store listener
 * path (the same Firestore mock harness as reversalsLiveUpdate.test.ts):
 *
 *   child has an assigned quest
 *     → child submits (completeTask transaction mock)
 *     → LOCAL pending-write snapshot arrives (fromCache:true + hasPendingWrites:true)
 *     → UI shows PENDING (never dropped — the historical bug class)
 *     → server-confirmed pending snapshot keeps the state stable
 *     → parent review queue contains exactly one item; approve fires ONCE
 *     → authoritative approved snapshot arrives
 *     → gamification effect observable (approved status → confirmed UI only now)
 *     → child observes confirmed state ("1 of 1", done strip, reward moment)
 *     → no duplicate mutation ever fired
 */

const harness = vi.hoisted(() => ({
  subscribedPaths: [] as string[],
  serverReads: new Map<string, { resolve: (v: any) => void }[]>(),
  snapshotNext: new Map<string, (snapshot: any) => void>(),
}));

const api = vi.hoisted(() => ({
  completeTask: vi.fn(),
  approveTaskCompletion: vi.fn(),
  rejectTaskCompletion: vi.fn(),
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

// Mock ONLY the mutation entry points — their transaction internals are covered
// by the dedicated api tests and Firestore emulator suites.
vi.mock('../../lib/api', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, completeTask: api.completeTask, approveTaskCompletion: api.approveTaskCompletion };
});

import { useStore } from '../../store/useStore';
import { QuestBoard } from '../../components/quests/QuestBoard';
import { SwipeReview } from '../../components/parent/SwipeReview';
import { MemoryRouter } from 'react-router-dom';

const TASKS_PATH = 'families/f1/tasks';
const COMPLETIONS_PATH = 'families/f1/task_completions';

const snapshot = (docs: any[], metadata?: { fromCache: boolean; hasPendingWrites: boolean }) => ({
  docs: docs.map(({ id, ...data }) => ({ id, data: () => data })),
  metadata: metadata ?? { fromCache: false, hasPendingWrites: false },
});

const deliver = (path: string, snap: any) => {
  act(() => {
    harness.snapshotNext.get(path)?.(snap);
  });
};

const TASK = { title: 'Feed the cat', pointsReward: 10, type: 'daily', requiresApproval: true, isActive: true, assigneeId: 'child-1' };

describe('full quest lifecycle — submit → pending-write safety → approval → confirmed result', () => {
  beforeEach(() => {
    harness.subscribedPaths = [];
    harness.serverReads = new Map();
    harness.snapshotNext = new Map();
    api.completeTask.mockResolvedValue(undefined);
    api.approveTaskCompletion.mockResolvedValue(undefined);
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
    } as any);
  });

  afterEach(() => {
    cleanup();
    useStore.getState().cleanup();
  });

  it('survives local pending writes, reload semantics and duplicate guards end-to-end', async () => {
    // Boot the real listener pipeline (family doc read gates the collections).
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
    expect(harness.subscribedPaths).toContain(TASKS_PATH);
    expect(harness.subscribedPaths).toContain(COMPLETIONS_PATH);

    // Initial SERVER-confirmed snapshots: one assigned quest, no completions.
    deliver(TASKS_PATH, snapshot([{ id: 't1', ...TASK }])); 
    deliver(COMPLETIONS_PATH, snapshot([]));
    // Members subscribe to the top-level `users` collection (familyId filter).
    deliver('users', snapshot([
      { id: 'child-1', displayName: 'Ali', role: 'child' },
      { id: 'p1', displayName: 'Dad', role: 'owner' },
    ]));

    // Resource readiness bookkeeping is covered by bootstrapSequencing tests;
    // here we open the UI gate so the lifecycle itself is under test.
    act(() => {
      useStore.setState({
        bootstrapStatus: { tasks: 'ready', members: 'ready' } as any,
      } as any);
    });

    // The board is actionable.
    render(
      <MemoryRouter>
        <QuestBoard />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('featured-quest')).toBeInTheDocument();
    expect(screen.getByText('Feed the cat')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByTestId('hold-to-complete'), { key: 'Enter' });
    await act(async () => {});
    expect(api.completeTask).toHaveBeenCalledTimes(1);
    expect(api.completeTask).toHaveBeenCalledWith('f1', 't1', 'child-1', true, expect.any(Date));

    // ---- LOCAL pending-write snapshot (fromCache:true + hasPendingWrites:true)
    // This is the exact historical bug shape: dropping it made submitted quests
    // vanish until refresh. It MUST surface immediately.
    const periodKey = (() => {
      const n = new Date();
      return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
    })();
    deliver(
      COMPLETIONS_PATH,
      snapshot(
        [{ id: 'child-1__t1__' + periodKey, taskId: 't1', assigneeId: 'child-1', status: 'pending_approval', periodKey }],
        { fromCache: true, hasPendingWrites: true },
      ),
    );
    expect(screen.getByTestId('pending-quest')).toBeInTheDocument();
    // Pending quests cannot be resubmitted.
    expect(screen.queryByTestId('hold-to-complete')).not.toBeInTheDocument();

    // ---- SERVER confirmation of the same pending record ------------------
    deliver(COMPLETIONS_PATH, snapshot([
      { id: 'child-1__t1__' + periodKey, taskId: 't1', assigneeId: 'child-1', status: 'pending_approval', periodKey },
    ]));
    expect(screen.getByTestId('pending-quest')).toBeInTheDocument();

    // ---- PARENT review queue receives exactly one item -------------------
    cleanup();
    useStore.setState({
      currentUser: { id: 'p1', familyId: 'f1', role: 'owner', displayName: 'Dad' } as any,
    } as any);
    render(
      <MemoryRouter>
        <SwipeReview />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('review-card')).toBeInTheDocument();
    expect(screen.getByText('Ali')).toBeInTheDocument();
    expect(screen.getByTestId('review-count')).toHaveTextContent('1');

    // Button + swipe race: approve must fire EXACTLY once.
    fireEvent.click(screen.getByTestId('review-approve'));
    fireEvent.click(screen.getByTestId('review-approve'));
    await act(async () => {});
    expect(api.approveTaskCompletion).toHaveBeenCalledTimes(1);

    // ---- AUTHORITATIVE approval arrives WHILE THE CHILD IS WATCHING ------
    cleanup();
    useStore.setState({
      currentUser: { id: 'child-1', familyId: 'f1', role: 'child', displayName: 'Ali' } as any,
    } as any);
    render(
      <MemoryRouter>
        <QuestBoard />
      </MemoryRouter>,
    );
    // Establish the pending baseline first (server-confirmed), then let the
    // approval land through the live listener.
    deliver(COMPLETIONS_PATH, snapshot([
      { id: 'child-1__t1__' + periodKey, taskId: 't1', assigneeId: 'child-1', status: 'pending_approval', periodKey },
    ]));
    expect(screen.getByTestId('pending-quest')).toBeInTheDocument();
    deliver(COMPLETIONS_PATH, snapshot([
      { id: 'child-1__t1__' + periodKey, taskId: 't1', assigneeId: 'child-1', status: 'approved', periodKey },
    ]));

    // Confirmed result: done strip + honest ratio + reward moment.
    expect(screen.getByTestId('done-quest')).toBeInTheDocument();
    expect(screen.getByTestId('today-progress')).toHaveTextContent('1 of 1');
    // FullScreenMoment does not forward data-testid; the XP readout is the
    // stable marker of the confirmed-award moment.
    expect(screen.getByTestId('approved-xp')).toBeInTheDocument();

    // No duplicate effects anywhere in the pipeline.
    expect(api.completeTask).toHaveBeenCalledTimes(1);
    expect(api.approveTaskCompletion).toHaveBeenCalledTimes(1);
  });
});
