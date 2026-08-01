import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = {
  path: string;
  target: any;
  next: (snapshot: any) => void;
  error: (error: any) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
};

const firestore = vi.hoisted(() => ({
  listeners: [] as Listener[],
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn(() => () => {}),
  getAuth: vi.fn(() => ({})),
  GoogleAuthProvider: class {},
  signOut: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, path: string, id?: string) => ({
    type: 'document',
    path: id === undefined ? path : `${path}/${id}`,
  })),
  collection: vi.fn((_db: unknown, path: string) => ({ type: 'collection', path })),
  query: vi.fn((target: any, ...constraints: any[]) => ({
    type: 'query',
    path: target.path,
    constraints,
  })),
  where: vi.fn((...args: any[]) => ({ kind: 'where', args })),
  orderBy: vi.fn((...args: any[]) => ({ kind: 'orderBy', args })),
  limit: vi.fn((value: number) => ({ kind: 'limit', value })),
  getFirestore: vi.fn(() => ({})),
  getDocFromServer: vi.fn(() => new Promise(() => {})),
  getDocsFromServer: vi.fn(() => new Promise(() => {})),
  onSnapshot: vi.fn((target: any, optionsOrNext: any, nextOrError?: any, maybeError?: any) => {
    const next = typeof optionsOrNext === 'function' ? optionsOrNext : nextOrError;
    const error = typeof optionsOrNext === 'function' ? nextOrError : maybeError;
    const listener: Listener = {
      path: target.path,
      target,
      next,
      error,
      unsubscribe: vi.fn(),
    };
    firestore.listeners.push(listener);
    return listener.unsubscribe;
  }),
}));

vi.mock('../lib/firebase', () => ({ app: {}, auth: {}, db: {}, googleProvider: {} }));

import { useStore } from './useStore';

const activeListeners = (path: string) =>
  firestore.listeners.filter(listener => listener.path === path && !listener.unsubscribe.mock.calls.length);

const emitFamily = (data: Record<string, unknown>) => {
  const listener = activeListeners('families/family-1').at(-1);
  if (!listener) throw new Error('Family listener was not registered.');
  listener.next({
    id: 'family-1',
    exists: () => true,
    data: () => data,
    metadata: { fromCache: false },
  });
};

const emitDocument = (path: string, data?: Record<string, unknown>) => {
  const listener = activeListeners(path).at(-1);
  if (!listener) throw new Error(`Listener was not registered for ${path}.`);
  listener.next({
    id: path.split('/').at(-1),
    exists: () => data !== undefined,
    data: () => data,
    metadata: { fromCache: false },
  });
};

const emitCollection = (listener: Listener, items: Array<{ id: string; data: Record<string, unknown> }>) => {
  listener.next({
    docs: items.map(item => ({ id: item.id, data: () => item.data })),
    metadata: { fromCache: false },
  });
};

const hydrate = (role: 'child' | 'parent' | 'owner' = 'child') => {
  useStore.setState({
    authStatus: 'authenticated',
    authInitialized: true,
    authLoading: false,
    authUser: { uid: 'auth-1' },
    currentUser: { id: role === 'child' ? 'child-1' : 'adult-1', familyId: 'family-1', role },
    profileLoading: false,
    activeFamilyId: null,
  } as any);
  useStore.getState().loadFamilyData(role === 'child' ? 'child-1' : 'adult-1', 'family-1');
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-01T12:00:00Z'));
  firestore.listeners = [];
  useStore.getState().cleanup();
});

afterEach(() => {
  useStore.getState().cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('daily check-in store subscriptions', () => {
  it('resolves current-day state only after both deterministic documents emit', () => {
    hydrate('child');
    emitFamily({
      timezone: 'Europe/London',
      dailyCheckins: { childrenEnabled: true, historyVisibleToParents: true },
    });

    const checkinPath = 'families/family-1/daily_checkins/child-1_2026-08-01';
    const skipPath = 'families/family-1/daily_checkin_skips/child-1_2026-08-01';
    expect(activeListeners(checkinPath)).toHaveLength(1);
    expect(activeListeners(skipPath)).toHaveLength(1);
    expect(useStore.getState().dailyCheckinDay).toBe('2026-08-01');
    expect(useStore.getState().dailyCheckinStateResolved).toBe(false);

    emitDocument(checkinPath);
    expect(useStore.getState().dailyCheckinStateResolved).toBe(false);
    emitDocument(skipPath);

    expect(useStore.getState().dailyCheckinStateResolved).toBe(true);
    expect(useStore.getState().todayDailyCheckin).toBeNull();
    expect(useStore.getState().todayDailyCheckinSkip).toBeNull();
  });

  it('switches both deterministic listeners at family-local rollover', () => {
    hydrate('child');
    emitFamily({ timezone: 'Europe/London' });

    const oldCheckinPath = 'families/family-1/daily_checkins/child-1_2026-08-01';
    const oldSkipPath = 'families/family-1/daily_checkin_skips/child-1_2026-08-01';
    const oldCheckin = activeListeners(oldCheckinPath)[0];
    const oldSkip = activeListeners(oldSkipPath)[0];

    useStore.getState().refreshDailyCheckinDay(new Date('2026-08-02T00:01:00Z'));

    expect(oldCheckin.unsubscribe).toHaveBeenCalledOnce();
    expect(oldSkip.unsubscribe).toHaveBeenCalledOnce();
    expect(activeListeners('families/family-1/daily_checkins/child-1_2026-08-02')).toHaveLength(1);
    expect(activeListeners('families/family-1/daily_checkin_skips/child-1_2026-08-02')).toHaveLength(1);
    expect(useStore.getState().dailyCheckinDay).toBe('2026-08-02');
    expect(useStore.getState().dailyCheckinStateResolved).toBe(false);

    oldCheckin.next({
      id: 'child-1_2026-08-01',
      exists: () => true,
      data: () => ({ userId: 'child-1', localDate: '2026-08-01', animal: 'owl' }),
      metadata: { fromCache: false },
    });
    oldSkip.next({
      id: 'child-1_2026-08-01',
      exists: () => true,
      data: () => ({ userId: 'child-1', localDate: '2026-08-01' }),
      metadata: { fromCache: false },
    });
    expect(useStore.getState().todayDailyCheckin).toBeNull();
    expect(useStore.getState().todayDailyCheckinSkip).toBeNull();
    expect(useStore.getState().dailyCheckinStateResolved).toBe(false);
  });

  it.each(['parent', 'owner'] as const)(
    'loads bounded newest-first history for a %s when family visibility is enabled',
    role => {
      hydrate(role);
      emitFamily({
        timezone: 'Europe/London',
        dailyCheckins: { childrenEnabled: true, historyVisibleToParents: true },
      });

      const history = activeListeners('families/family-1/daily_checkins')
        .find(listener => listener.target.type === 'query');
      expect(history).toBeDefined();
      expect(history?.target.constraints).toEqual([
        { kind: 'orderBy', args: ['createdAt', 'desc'] },
        { kind: 'limit', value: 100 },
      ]);
      expect(useStore.getState().dailyCheckinHistoryResolved).toBe(false);
    },
  );

  it('does not query history for a child or while family visibility is disabled', () => {
    hydrate('child');
    emitFamily({ dailyCheckins: { historyVisibleToParents: true } });
    expect(activeListeners('families/family-1/daily_checkins')).toHaveLength(0);
    expect(useStore.getState().dailyCheckinHistoryResolved).toBe(true);

    useStore.getState().cleanup();
    firestore.listeners = [];
    hydrate('parent');
    emitFamily({ dailyCheckins: { historyVisibleToParents: false } });
    expect(activeListeners('families/family-1/daily_checkins')).toHaveLength(0);
    expect(useStore.getState().dailyCheckinHistoryResolved).toBe(true);
  });

  it('clears loaded history immediately and ignores late snapshots when visibility turns off', () => {
    hydrate('parent');
    emitFamily({ dailyCheckins: { historyVisibleToParents: true } });
    const history = activeListeners('families/family-1/daily_checkins')
      .find(listener => listener.target.type === 'query')!;
    emitCollection(history, [{
      id: 'child-1_2026-08-01',
      data: {
        familyId: 'family-1',
        userId: 'child-1',
        localDate: '2026-08-01',
        animal: 'owl',
        catalogVersion: 1,
        createdAt: 2,
        updatedAt: 2,
      },
    }]);
    expect(useStore.getState().dailyCheckinHistory).toHaveLength(1);
    expect(useStore.getState().dailyCheckinHistoryResolved).toBe(true);

    emitFamily({ dailyCheckins: { historyVisibleToParents: false } });
    expect(history.unsubscribe).toHaveBeenCalledOnce();
    expect(useStore.getState().dailyCheckinHistory).toEqual([]);
    expect(useStore.getState().dailyCheckinHistoryResolved).toBe(true);

    emitCollection(history, [{
      id: 'late',
      data: {
        familyId: 'family-1', userId: 'child-1', localDate: '2026-07-31',
        animal: 'fox', catalogVersion: 1, createdAt: 1, updatedAt: 1,
      },
    }]);
    expect(useStore.getState().dailyCheckinHistory).toEqual([]);
  });
});
