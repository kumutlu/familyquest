import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Regression suite for the "Retry does nothing, only a refresh helps" symptom.
//
// Root cause: loadFamilyData() short-circuits when the requested family is
// already the active family AND listeners are attached:
//
//     if (state.activeFamilyId === familyId && familyListeners.size > 0) return;
//
// That guard exists to prevent duplicate subscriptions on re-render, but it
// also makes retryBootstrap() a no-op in exactly the situation the Retry button
// is offered: a slow/stuck family bootstrap where listeners ARE attached but
// have not reported ready. The user is then forced to reload the page.
// ---------------------------------------------------------------------------

const subscriptions = vi.hoisted(() => ({ count: 0 }));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn(() => () => {}),
  getAuth: vi.fn(() => ({})),
  GoogleAuthProvider: class {},
  signOut: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, _col, id) => ({ __id: id, type: 'doc' })),
  collection: vi.fn(() => ({ type: 'collection' })),
  query: vi.fn(() => ({ type: 'query' })),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getFirestore: vi.fn(() => ({})),
  // Server reads never settle: this models a slow/blocked connection, which is
  // precisely the state in which the timeout screen and Retry are shown.
  getDocFromServer: vi.fn(() => new Promise(() => {})),
  getDocsFromServer: vi.fn(() => new Promise(() => {})),
  onSnapshot: vi.fn(() => {
    subscriptions.count += 1;
    return () => {};
  }),
}));

vi.mock('../lib/firebase', () => ({ app: {}, auth: {}, db: {}, googleProvider: {} }));

import { useStore } from './useStore';

const signedInFamilyState = () => ({
  authStatus: 'authenticated' as const,
  authInitialized: true,
  authLoading: false,
  authUser: { uid: 'u1' } as any,
  currentUser: { id: 'u1', familyId: 'f1', role: 'parent' } as any,
  profileLoading: false,
  familyLoading: true,
  appReady: false,
  loading: true,
  bootstrapError: null,
  featureErrors: {},
  activeFamilyId: null,
});

describe('retryBootstrap', () => {
  beforeEach(() => {
    subscriptions.count = 0;
    useStore.setState(signedInFamilyState() as any);
  });

  it('restarts the family bootstrap even though listeners are already attached', () => {
    useStore.getState().loadFamilyData('u1', 'f1');
    const firstPass = subscriptions.count;
    expect(firstPass).toBeGreaterThan(0);
    expect(useStore.getState().activeFamilyId).toBe('f1');

    // The stuck state the user sees: active family, live listeners, not ready.
    expect(useStore.getState().appReady).toBe(false);

    useStore.getState().retryBootstrap();

    // A real retry must re-subscribe, not silently no-op.
    expect(subscriptions.count).toBeGreaterThan(firstPass);
    expect(useStore.getState().bootstrapError).toBeNull();
    expect(useStore.getState().familyLoading).toBe(true);
  });

  it('clears a recorded bootstrap error when retrying a family bootstrap', () => {
    useStore.getState().loadFamilyData('u1', 'f1');
    useStore.setState({ bootstrapError: '[Family] unavailable' } as any);
    useStore.getState().retryBootstrap();
    expect(useStore.getState().bootstrapError).toBeNull();
  });

  it('does nothing when the user is signed out', () => {
    useStore.setState({ authUser: null, currentUser: null } as any);
    const before = subscriptions.count;
    useStore.getState().retryBootstrap();
    expect(subscriptions.count).toBe(before);
  });
});
