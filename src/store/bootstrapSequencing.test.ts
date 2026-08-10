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
  onSnapshot: vi.fn((target: any) => {
    harness.subscribedPaths.push(pathOf(target));
    return () => {};
  }),
}));

vi.mock('../lib/firebase', () => ({ app: {}, auth: {}, db: {}, googleProvider: {} }));

import { useStore } from './useStore';
import { criticalBootstrapResources } from '../lib/bootstrapQueries';

const CRITICAL_PATHS = [
  'families/f1',
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

const resolveAllCritical = async () => {
  await resolveRead('families/f1', documentSnapshot('f1'));
  for (const path of CRITICAL_PATHS.filter(candidate => candidate !== 'families/f1')) {
    await resolveRead(path, querySnapshot());
  }
};

const nonCriticalPaths = () =>
  harness.subscribedPaths.filter(path => !CRITICAL_PATHS.includes(path));

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
    useStore.setState(signedInFamilyState() as any);
  });

  it('starts only the critical resources in stage 1', () => {
    useStore.getState().loadFamilyData('u1', 'f1');

    expect(new Set(harness.subscribedPaths)).toEqual(new Set(CRITICAL_PATHS));
    expect(nonCriticalPaths()).toEqual([]);
    // The critical set is the single existing definition, not a copy.
    expect(criticalBootstrapResources).toEqual(['family', 'members', 'tasks', 'rewards', 'wallets']);
  });

  it('does not start non-critical reads until every critical resource resolved', async () => {
    useStore.getState().loadFamilyData('u1', 'f1');

    await resolveRead('families/f1', documentSnapshot('f1'));
    await resolveRead('families/f1/tasks', querySnapshot());
    await resolveRead('families/f1/rewards', querySnapshot());
    await resolveRead('families/f1/wallets', querySnapshot());

    // Members still outstanding → stage 2 must not have started.
    expect(nonCriticalPaths()).toEqual([]);
    expect(useStore.getState().appReady).toBe(false);

    await resolveRead('users', querySnapshot());

    expect(nonCriticalPaths().length).toBeGreaterThan(0);
  });

  it('sets appReady as soon as the five critical resources complete', async () => {
    useStore.getState().loadFamilyData('u1', 'f1');
    await resolveAllCritical();

    expect(useStore.getState().appReady).toBe(true);
    expect(useStore.getState().familyLoading).toBe(false);
    expect(useStore.getState().loading).toBe(false);
  });

  it('does not wait for non-critical resources before appReady', async () => {
    useStore.getState().loadFamilyData('u1', 'f1');
    await resolveAllCritical();

    // Stage 2 reads are still outstanding at this point.
    const outstanding = [...harness.serverReads.entries()].filter(
      ([path, pending]) => !CRITICAL_PATHS.includes(path) && pending.length > 0,
    );
    expect(outstanding.length).toBeGreaterThan(0);
    expect(useStore.getState().appReady).toBe(true);
  });

  it('preserves critical failure behaviour', async () => {
    useStore.getState().loadFamilyData('u1', 'f1');
    await rejectRead('families/f1', { code: 'permission-denied', message: 'denied' });

    const state = useStore.getState();
    expect(state.appReady).toBe(false);
    expect(state.bootstrapError).toContain('Family');
    expect(state.activeFamilyId).toBeNull();
    expect(nonCriticalPaths()).toEqual([]);
  });

  it('does not revert appReady when a non-critical resource fails', async () => {
    useStore.getState().loadFamilyData('u1', 'f1');
    await resolveAllCritical();
    expect(useStore.getState().appReady).toBe(true);

    const [failingPath] = nonCriticalPaths();
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

    expect(new Set(harness.subscribedPaths)).toEqual(new Set(CRITICAL_PATHS));
    expect(useStore.getState().bootstrapError).toBeNull();

    await resolveAllCritical();
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

    await resolveAllCritical();

    expect(useStore.getState().appReady).toBe(false);
    expect(nonCriticalPaths()).toEqual([]);
  });

  it('keeps loaded data behaviour intact across both stages', async () => {
    useStore.getState().loadFamilyData('u1', 'f1');
    await resolveAllCritical();

    expect(useStore.getState().familyData).toMatchObject({ id: 'f1', name: 'Family' });

    const feedSnapshot = {
      docs: [{ id: 'feed1', data: () => ({ type: 'note' }) }],
      metadata: { fromCache: false },
    };
    await resolveRead('families/f1/feed', feedSnapshot);
    expect(useStore.getState().feed).toEqual([{ id: 'feed1', type: 'note' }]);
  });
});
