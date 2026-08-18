import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ensureFamily, type SetupDeps } from '../onboarding/lib/onboardingSetup';
import { createEmptyDraft } from '../onboarding/lib/onboardingDraft';
import { useStore } from '../store/useStore';

// ---------------------------------------------------------------------------
// P0 regression: after a family is created successfully the user must NOT be
// bounced back to onboarding with "User already has a family".
//
// Root cause (historical): the onboarding completion path identified the user
// through the denormalised `currentUser.uid` profile field instead of the
// authoritative identity (auth uid / user document id). `refreshCurrentUser`
// silently no-ops when the uid does not match `authUser.uid`, so the store kept
// `currentUser.familyId === undefined` and the route guard redirected back to
// /onboarding.
//
// The new flow calls `ensureFamily`, which uses the injected authoritative
// `deps.uid` (auth uid) for BOTH `createFamilyAndParent` and
// `refreshCurrentUser`. This pins that contract so the regression cannot
// silently return.
// ---------------------------------------------------------------------------

const apiState = vi.hoisted(() => ({
  createFamilyAndParent: vi.fn(),
  refreshCurrentUser: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  createFamilyAndParent: apiState.createFamilyAndParent,
  signOut: vi.fn(),
}));

vi.mock('../lib/firebase', () => ({ app: {}, auth: {}, db: {}, googleProvider: {} }));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn(() => () => {}),
  getAuth: vi.fn(() => ({}) as any),
  GoogleAuthProvider: class {},
  signOut: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, _col, id) => ({ __id: id, type: 'doc' })),
  getDocFromServer: vi.fn(() => Promise.resolve({ exists: () => false })),
  onSnapshot: vi.fn(() => () => {}),
  getFirestore: vi.fn(() => ({}) as any),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDocsFromServer: vi.fn(() => Promise.resolve({ docs: [] })),
}));

function makeDeps(uid: string): SetupDeps {
  return {
    uid,
    createFamilyAndParent: apiState.createFamilyAndParent,
    createManagedMember: vi.fn().mockResolvedValue('child-1'),
    createTask: vi.fn().mockResolvedValue({ id: 'task-1' }),
    refreshCurrentUser: apiState.refreshCurrentUser,
    getFamilyMembers: () => [],
  };
}

describe('Onboarding — family creation completion (P0)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiState.createFamilyAndParent.mockResolvedValue({
      familyId: 'family-1',
      inviteCode: 'ABC123',
      user: { id: 'auth-uid-1', familyId: 'family-1', role: 'owner' },
    });
  });

  it('creates the family with the authoritative user id (never a denormalised field)', async () => {
    const draft = {
      ...createEmptyDraft('p1'),
      parentFirstName: 'Kemal',
      familyName: 'Kemal Family',
    };
    const result = await ensureFamily(draft, makeDeps('auth-uid-1'));

    // Authoritative uid is used for the server call...
    expect(apiState.createFamilyAndParent).toHaveBeenCalledWith(
      'auth-uid-1',
      'Kemal',
      'Kemal Family',
    );
    // ...and for publishing the family state to the store, so the route guard
    // can never bounce the user back to onboarding.
    expect(apiState.refreshCurrentUser).toHaveBeenCalledWith('auth-uid-1', {
      familyId: 'family-1',
      role: 'owner',
    });
    expect(result.familyId).toBe('family-1');
  });

  it('creates the family exactly once across a refresh/retry (no duplicate)', async () => {
    const draft = {
      ...createEmptyDraft('p1'),
      parentFirstName: 'Kemal',
      familyName: 'Kemal Family',
    };
    const deps = makeDeps('auth-uid-1');
    const first = await ensureFamily(draft, deps);
    const second = await ensureFamily(first, deps); // simulate retry/refresh
    expect(apiState.createFamilyAndParent).toHaveBeenCalledTimes(1);
    expect(second.familyId).toBe('family-1');
  });
});

describe('useStore.refreshCurrentUser — authoritative family state', () => {
  const loadFamilyData = vi.fn();

  beforeEach(() => {
    loadFamilyData.mockReset();
    useStore.setState({
      authStatus: 'authenticated',
      authInitialized: true,
      authUser: { uid: 'auth-uid-1' } as any,
      currentUser: { id: 'auth-uid-1', role: 'parent' } as any,
      loadFamilyData: loadFamilyData as any,
    });
  });

  it('applies the family state when called with the profile document id', () => {
    useStore.getState().refreshCurrentUser('auth-uid-1', { familyId: 'family-1', role: 'owner' });
    expect(useStore.getState().currentUser?.familyId).toBe('family-1');
    expect(loadFamilyData).toHaveBeenCalledWith('auth-uid-1', 'family-1');
  });

  it('ignores refreshes for a different user', () => {
    useStore.getState().refreshCurrentUser('someone-else', { familyId: 'family-9', role: 'owner' });
    expect(useStore.getState().currentUser?.familyId).toBeUndefined();
    expect(loadFamilyData).not.toHaveBeenCalled();
  });

  it('never leaves the family state unset when the uid is omitted by a caller', () => {
    useStore.getState().refreshCurrentUser(undefined as any, { familyId: 'family-1', role: 'owner' });
    expect(useStore.getState().currentUser?.familyId).toBe('family-1');
  });
});
