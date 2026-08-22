import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Regression suite for the two-stage bootstrap.
//
// Before: loadFamilyData() started the entire role plan (~25 reads) at once, so
// the five critical resources (family/members/tasks/rewards/wallets) competed
// with ~20 non-critical reads on the startup hot path.
//
// After: stage 1 starts ONLY criticalBootstrapResources; appReady is granted by
// the unchanged readiness semantics as soon as they resolve; stage 2 starts the
// remaining role-plan subscriptions in the background.
//
// The Firestore mock hands out deferred promises so each test controls the exact
// resolution order — no sleeps, no timing assumptions.
// ---------------------------------------------------------------------------

type Deferred = { resolve: (value: any) => void; reject: (error: any) => void };

const harness = vi.hoisted(() => ({
  subscribedPaths: [] as string[],
  serverReads: new Map<string, Deferred[]>(),
  snapshotNext: new Map<string, (snapshot: any) => void>(),
  snapshotError: new Map<string, (error: any) => void>(),
}));

const pathOf = (target: any): string => (target && target.path) || 'unknown';

const deferredFor = (target: any) => {
  const path = pathOf(target);
  return new Promise((resolve, reject) => {
    const existing = harness.serverReads.get(path) ?? [];
    existing.push({ resolve, reject });
    harness.serverReads.set(path, existing);
  });
};

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
  // query() must preserve the underlying path so the harness can identify reads.
  query: vi.fn((target: any) => ({ ...target, type: 'query' })),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getFirestore: vi.fn(() => ({})),
  getDocFromServer: vi.fn((target: any) => deferredFor(target)),
  getDocsFromServer: vi.fn((target: any) => deferredFor(target)),
  onSnapshot: vi.fn((target: any, _options: any, next: any, error: any) => {
    harness.subscribedPaths.push(pathOf(target));
    harness.snapshotNext.set(pathOf(target), next);
    harness.snapshotError.set(pathOf(target), error);
    return () => {};
  }),
}));

vi.mock('../lib/firebase', () => ({ app: {}, auth: {}, db: {}, googleProvider: {} }));

import { useStore } from './useStore';
import { criticalBootstrapResources } from '../lib/bootstrapQueries';

const FAMILY_PATH = 'families/f1';
const OPTIONAL_DASHBOARD_PATHS = [
  'families/f1/tasks',
  'families/f1/rewards',
  'families/f1/wallets',
  'users',
];

const querySnapshot = () => ({ docs: [], metadata: { fromCache: false } });
const documentSnapshot = (id: string) => ({
  id,
  exists: () => true,
  data: () => ({ name: 'Family' }),
  metadata: { fromCache: false },
});

const resolveRead = async (path: string, snapshot: any) => {
  const pending = harness.serverReads.get(path) ?? [];
  harness.serverReads.set(path, []);
  pending.forEach(deferred => deferred.resolve(snapshot));
  await Promise.resolve();
  await Promise.resolve();
};

const rejectRead = async (path: string, error: any) => {
  const pending = harness.serverReads.get(path) ?? [];
  harness.serverReads.set(path, []);
  pending.forEach(deferred => deferred.reject(error));
  await Promise.resolve();
  await Promise.resolve();
};

const optionalPaths = () =>
  harness.subscribedPaths.filter(path => path !== FAMILY_PATH);

const signedInFamilyState = () => ({
  authStatus: 'authenticated' as const,
  authInitialized: true,
  authLoading: false,
  authUser: { uid: 'u1' } as any,
  currentUser: { id: 'u1', familyId: 'f1', role: 'owner' } as any,
  profileLoading: false,
  familyLoading: true,
  appReady: false,
  loading: true,
  bootstrapError: null,
  featureErrors: {},
  activeFamilyId: null,
});

describe('two-stage family bootstrap sequencing', () => {
  beforeEach(() => {
    harness.subscribedPaths = [];
    harness.serverReads = new Map();
    harness.snapshotNext = new Map();
    harness.snapshotError = new Map();
    useStore.setState(signedInFamilyState() as any);
  });

  it('starts only family validation on the global critical path', () => {
    useStore.getState().loadFamilyData('u1', 'f1');

    expect(harness.subscribedPaths).toEqual([FAMILY_PATH]);
    expect(criticalBootstrapResources).toEqual(['family']);
  });

  it('starts optional dashboard reads after family access is validated', async () => {
    useStore.getState().loadFamilyData('u1', 'f1');

    await resolveRead(FAMILY_PATH, documentSnapshot('f1'));

    expect(harness.subscribedPaths).toEqual(expect.arrayContaining([FAMILY_PATH, ...OPTIONAL_DASHBOARD_PATHS]));
    expect(optionalPaths().length).toBeGreaterThan(OPTIONAL_DASHBOARD_PATHS.length);
  });

  it('sets appReady as soon as family access is validated', async () => {
    useStore.getState().loadFamilyData('u1', 'f1');
    await resolveRead(FAMILY_PATH, documentSnapshot('f1'));

    expect(useStore.getState().appReady).toBe(true);
    expect(useStore.getState().familyLoading).toBe(false);
    expect(useStore.getState().loading).toBe(false);
  });

  it('keeps cached family state provisional until authoritative validation succeeds', async () => {
    useStore.getState().loadFamilyData('u1', 'f1');
    harness.snapshotNext.get(FAMILY_PATH)?.({
      ...documentSnapshot('f1'),
      metadata: { fromCache: true, hasPendingWrites: false },
    });
    await Promise.resolve();

    expect(useStore.getState()).toMatchObject({
      familyData: { id: 'f1', name: 'Family' },
      familyLoading: true,
      appReady: false,
      bootstrapError: null,
    });

    await resolveRead(FAMILY_PATH, documentSnapshot('f1'));

    expect(useStore.getState()).toMatchObject({
      familyLoading: false,
      appReady: true,
      bootstrapError: null,
    });
  });

  it('accepts a non-cache family listener snapshot as authoritative validation', async () => {
    useStore.getState().loadFamilyData('u1', 'f1');
    harness.snapshotNext.get(FAMILY_PATH)?.({
      ...documentSnapshot('f1'),
      metadata: { fromCache: true, hasPendingWrites: false },
    });
    await Promise.resolve();
    expect(useStore.getState().appReady).toBe(false);

    harness.snapshotNext.get(FAMILY_PATH)?.(documentSnapshot('f1'));
    await Promise.resolve();

    expect(useStore.getState()).toMatchObject({
      familyLoading: false,
      appReady: true,
      bootstrapError: null,
      bootstrapStatus: { family: 'ready' },
    });
  });

  it('keeps retryable family validation failures recoverable until a listener confirms the family', async () => {
    useStore.getState().loadFamilyData('u1', 'f1');
    harness.snapshotNext.get(FAMILY_PATH)?.({
      ...documentSnapshot('f1'),
      metadata: { fromCache: true, hasPendingWrites: false },
    });
    await rejectRead(FAMILY_PATH, { code: 'unavailable', message: 'transport unavailable' });

    expect(useStore.getState()).toMatchObject({
      familyData: { id: 'f1', name: 'Family' },
      familyLoading: true,
      appReady: false,
      bootstrapStatus: { family: 'loading' },
    });
    expect(useStore.getState().bootstrapError).toContain('[FamilyVerificationDelayed] unavailable');

    harness.snapshotNext.get(FAMILY_PATH)?.(documentSnapshot('f1'));
    await Promise.resolve();

    expect(useStore.getState()).toMatchObject({
      familyLoading: false,
      appReady: true,
      bootstrapError: null,
      bootstrapStatus: { family: 'ready' },
    });
  });

  it('revokes cached family readiness when server permission validation fails', async () => {
    useStore.getState().loadFamilyData('u1', 'f1');
    harness.snapshotNext.get(FAMILY_PATH)?.({
      ...documentSnapshot('f1'),
      metadata: { fromCache: true },
    });
    await Promise.resolve();
    expect(useStore.getState().appReady).toBe(false);

    await rejectRead(FAMILY_PATH, { code: 'permission-denied', message: 'denied' });
    expect(useStore.getState().appReady).toBe(false);
    expect(useStore.getState().bootstrapError).toContain('permission-denied');
  });

  it.each(OPTIONAL_DASHBOARD_PATHS)(
    'does not gate an existing parent dashboard when %s never resolves',
    async stalledPath => {
      useStore.getState().loadFamilyData('u1', 'f1');
      await resolveRead(FAMILY_PATH, documentSnapshot('f1'));

      for (const path of OPTIONAL_DASHBOARD_PATHS) {
        if (path !== stalledPath) await resolveRead(path, querySnapshot());
      }

      expect(useStore.getState().appReady).toBe(true);
      expect(useStore.getState().bootstrapStatus[
        stalledPath === 'users' ? 'members' : stalledPath.split('/').at(-1) as 'tasks' | 'rewards' | 'wallets'
      ]).toBe('loading');
    },
  );

  it('does not gate an existing child dashboard on optional family resources', async () => {
    useStore.setState({
      ...signedInFamilyState(),
      currentUser: { id: 'c1', familyId: 'f1', role: 'child' },
    } as any);

    useStore.getState().loadFamilyData('c1', 'f1');
    await resolveRead(FAMILY_PATH, documentSnapshot('f1'));

    expect(useStore.getState().appReady).toBe(true);
    expect(useStore.getState().bootstrapStatus.members).toBe('loading');
    expect(useStore.getState().bootstrapStatus.tasks).toBe('loading');
    expect(useStore.getState().bootstrapStatus.rewards).toBe('loading');
    expect(useStore.getState().bootstrapStatus.wallets).toBe('loading');
  });

  it('preserves critical failure behaviour', async () => {
    useStore.getState().loadFamilyData('u1', 'f1');
    await rejectRead('families/f1', { code: 'permission-denied', message: 'denied' });

    const state = useStore.getState();
    expect(state.appReady).toBe(false);
    expect(state.bootstrapError).toContain('Family');
    expect(state.activeFamilyId).toBeNull();
    expect(optionalPaths()).toEqual([]);
  });

  it('does not revert appReady when a non-critical resource fails', async () => {
    useStore.getState().loadFamilyData('u1', 'f1');
    await resolveRead(FAMILY_PATH, documentSnapshot('f1'));
    expect(useStore.getState().appReady).toBe(true);

    const [failingPath] = optionalPaths();
    await rejectRead(failingPath, { code: 'unavailable', message: 'offline' });

    const state = useStore.getState();
    expect(state.appReady).toBe(true);
    expect(state.bootstrapError).toBeNull();
    // The error is surfaced, never swallowed.
    expect(Object.values(state.featureErrors).filter(Boolean).length).toBeGreaterThan(0);
  });

  it('still supports retry after a critical failure', async () => {
    useStore.getState().loadFamilyData('u1', 'f1');
    await rejectRead('families/f1', { code: 'unavailable', message: 'offline' });
    expect(useStore.getState().bootstrapError).toBeTruthy();

    harness.subscribedPaths = [];
    useStore.getState().retryBootstrap();

    expect(harness.subscribedPaths).toEqual([FAMILY_PATH]);
    expect(useStore.getState().bootstrapError).toBeNull();

    await resolveRead(FAMILY_PATH, documentSnapshot('f1'));
    expect(useStore.getState().appReady).toBe(true);
  });

  it('cannot let a stale stage 1 set appReady after the family changed', async () => {
    useStore.getState().loadFamilyData('u1', 'f1');

    // Family switch mid-bootstrap.
    useStore.setState({
      currentUser: { id: 'u1', familyId: 'f2', role: 'owner' },
      activeFamilyId: 'f2',
      appReady: false,
    } as any);

    await resolveRead(FAMILY_PATH, documentSnapshot('f1'));

    expect(useStore.getState().appReady).toBe(false);
    expect(optionalPaths()).toEqual([]);
  });

  it('keeps loaded data behaviour intact across both stages', async () => {
    useStore.getState().loadFamilyData('u1', 'f1');
    await resolveRead(FAMILY_PATH, documentSnapshot('f1'));

    expect(useStore.getState().familyData).toMatchObject({ id: 'f1', name: 'Family' });

    const feedSnapshot = {
      docs: [{ id: 'feed1', data: () => ({ type: 'note' }) }],
      metadata: { fromCache: false },
    };
    await resolveRead('families/f1/feed', feedSnapshot);
    expect(useStore.getState().feed).toEqual([{ id: 'feed1', type: 'note' }]);
  });
});
