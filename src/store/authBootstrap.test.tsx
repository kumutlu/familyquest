import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createElement } from 'react';

// ---------------------------------------------------------------------------
// Regression tests for the auth/bootstrap race conditions described in the bug
// report:
//   1. After Google sign-in the app returned to /login (self-navigate timeout
//      raced the async onAuthStateChanged listener).
//   2. The dashboard could stay on "Loading Dashboard..." forever (profile
//      loading flag never cleared).
//
// These tests drive the real Zustand store (useStore) with mocked Firebase so
// we exercise the actual startup/auth data flow, not a stub.
// ---------------------------------------------------------------------------

const authState = vi.hoisted(() => ({
  currentUser: null as any,
  // Captured onAuthStateChanged callback so tests can fire auth events.
  listener: null as ((user: any) => void) | null,
  errorListener: null as ((error: any) => void) | null,
}));

const firestoreState = vi.hoisted(() => ({
  // Profile doc snapshot the getDocFromServer / onSnapshot will resolve with.
  profileSnapshot: null as any,
  cachedProfileSnapshot: null as any,
  profileError: null as any,
  deferServer: false,
  serverResolve: null as ((snapshot: any) => void) | null,
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn((_auth, next, error) => {
    authState.listener = next;
    authState.errorListener = error;
    return () => {};
  }),
  getAuth: vi.fn(() => ({}) as any),
  GoogleAuthProvider: class {},
  initializeApp: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, _col, id) => ({ __id: id, type: 'doc' })),
  getDocFromServer: vi.fn(() => {
    if (firestoreState.profileError) return Promise.reject(firestoreState.profileError);
    if (firestoreState.deferServer) {
      return new Promise(resolve => { firestoreState.serverResolve = resolve; });
    }
    return Promise.resolve(firestoreState.profileSnapshot);
  }),
  onSnapshot: vi.fn((_ref: any, _opts: any, next?: any, error?: any) => {
    // Immediately deliver the configured snapshot (or error) to mimic a
    // server-resolved event. We do NOT deliver a fromCache event first so the
    // test focuses on the authoritative resolve path.
    if (next && firestoreState.cachedProfileSnapshot) {
      queueMicrotask(() => next({ ...firestoreState.cachedProfileSnapshot, metadata: { fromCache: true } }));
    }
    if (error && firestoreState.profileError) {
      queueMicrotask(() => error(firestoreState.profileError));
    } else if (next && firestoreState.profileSnapshot && !firestoreState.deferServer) {
      queueMicrotask(() => next({ ...firestoreState.profileSnapshot, metadata: { fromCache: false } }));
    }
    return () => {};
  }),
  getFirestore: vi.fn(() => ({}) as any),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDocsFromServer: vi.fn(() => Promise.resolve({ docs: [] })),
}));

vi.mock('../lib/firebase', () => ({
  app: {},
  auth: {},
  db: {},
  googleProvider: {},
}));

// AppLayout renders NotificationCenter which subscribes to Firestore. Mock the
// hook so the test focuses purely on the auth/route-guard flow.
vi.mock('../lib/useNotifications', () => ({
  useNotifications: () => ({
    notifications: [],
    readIds: new Set<string>(),
    unreadCount: 0,
    error: null,
    loading: false,
    loadingMore: false,
    hasMore: false,
    connectionState: 'connected',
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    loadMore: vi.fn(),
    retry: vi.fn(),
  }),
}));

// Import AFTER mocks are registered.
import { useStore } from './useStore';
import { AppLayout } from '../components/layout/AppLayout';
import i18n from '../i18n';

const resetStore = () => {
  useStore.setState({
    authStatus: 'initializing',
    authInitialized: false,
    authLoading: true,
    profileLoading: false,
    familyLoading: false,
    appReady: false,
    loading: true,
    bootstrapError: null,
    featureErrors: {},
    activeFamilyId: null,
    authUser: undefined,
    currentUser: null,
    familyData: null,
    bootstrapStatus: {} as any,
    error: null,
    // Stub the family-data bootstrap so these tests focus on the auth/profile
    // race (the actual bug). The stub flips appReady so the route guard can
    // render the protected layout without needing a full Firestore mock.
    loadFamilyData: ((_uid: string, _familyId: string) => {
      useStore.setState({ familyLoading: false, appReady: true, loading: false });
    }) as any,
  } as any);
};

const makeProfileSnapshot = (familyId: string | null, language?: unknown) => ({
  exists: () => true,
  id: 'user-1',
  data: () => ({
    uid: 'user-1',
    role: 'parent',
    displayName: 'Tester',
    familyId,
    ...(language === undefined ? {} : { language }),
  }),
});

const makeAuthUser = () => ({
  uid: 'user-1',
  getIdToken: vi.fn(async () => 'fake-token'),
});

const fireSignedIn = () => {
  act(() => {
    authState.listener?.(makeAuthUser());
  });
};

const renderAppLayoutAt = (path: string) =>
  render(
    createElement(
      MemoryRouter,
      { initialEntries: [path] },
      createElement(
        Routes,
        null,
        createElement(Route, { path: '/', element: createElement(AppLayout) }),
        createElement(Route, { path: '/login', element: createElement('div', null, 'Login Page') }),
        createElement(Route, { path: '/onboarding', element: createElement('div', null, 'Onboarding Page') }),
      ),
    ),
  );

beforeEach(() => {
  authState.currentUser = null;
  authState.listener = null;
  authState.errorListener = null;
  firestoreState.profileSnapshot = null;
  firestoreState.cachedProfileSnapshot = null;
  firestoreState.profileError = null;
  firestoreState.deferServer = false;
  firestoreState.serverResolve = null;
  resetStore();
  // initAuth registers the onAuthStateChanged listener.
  act(() => {
    useStore.getState().initAuth();
  });
});

afterEach(async () => {
  act(() => {
    useStore.getState().cleanup();
  });
  await i18n.changeLanguage('en');
  vi.clearAllMocks();
});

describe('auth bootstrap regression', () => {
  it('uses a matching cached profile while server revalidation is pending', async () => {
    firestoreState.cachedProfileSnapshot = makeProfileSnapshot('fam-1');
    firestoreState.profileSnapshot = makeProfileSnapshot('fam-1');
    firestoreState.deferServer = true;
    fireSignedIn();

    await waitFor(() => expect(useStore.getState().currentUser?.familyId).toBe('fam-1'));
    expect(useStore.getState().appReady).toBe(true);
    expect(firestoreState.serverResolve).not.toBeNull();
  });

  it('ignores a late cached profile callback after the authenticated user changes', async () => {
    firestoreState.cachedProfileSnapshot = makeProfileSnapshot('fam-1');
    firestoreState.profileSnapshot = makeProfileSnapshot('fam-1');
    firestoreState.deferServer = true;
    fireSignedIn();
    await waitFor(() => expect(useStore.getState().currentUser?.familyId).toBe('fam-1'));

    await act(async () => authState.listener?.(null));
    firestoreState.serverResolve?.(makeProfileSnapshot('fam-1'));
    await Promise.resolve();

    expect(useStore.getState().authStatus).toBe('unauthenticated');
    expect(useStore.getState().currentUser).toBeNull();
  });

  it('hydrates a managed child by trusted childId claim and gates the layout at password change', async () => {
    firestoreState.profileSnapshot = {
      exists: () => true,
      id: 'child-1',
      data: () => ({
        role: 'child',
        familyId: 'fam-1',
        displayName: 'Alex',
        isManaged: true,
        authUid: 'auth-child-1',
        requiresPasswordChange: true,
      }),
    };
    const managedAuthUser = {
      uid: 'auth-child-1',
      getIdToken: vi.fn(async () => 'token'),
      getIdTokenResult: vi.fn(async () => ({
        claims: {
          role: 'child',
          managedChild: true,
          childId: 'child-1',
          familyId: 'fam-1',
        },
      })),
    };
    await act(async () => {
      await authState.listener?.(managedAuthUser);
    });

    await waitFor(() => expect(useStore.getState().appReady).toBe(true));
    expect(useStore.getState().currentUser.id).toBe('child-1');
    expect(useStore.getState().familyData).toBeNull();
    renderAppLayoutAt('/');
    expect(screen.getByRole('heading', { name: 'Create your private password' })).toBeInTheDocument();
    expect(screen.queryByText('FamilyQuest')).not.toBeInTheDocument();
  });

  it('hydrates a saved Turkish preference before authenticated readiness', async () => {
    firestoreState.profileSnapshot = makeProfileSnapshot('fam-1', 'tr');
    fireSignedIn();

    await waitFor(() => expect(useStore.getState().appReady).toBe(true));
    expect(useStore.getState().currentUser.language).toBe('tr');
    expect(i18n.language).toBe('tr');
    expect(document.documentElement.lang).toBe('tr');
  });

  it('falls directly to English for an invalid saved preference', async () => {
    await i18n.changeLanguage('tr');
    firestoreState.profileSnapshot = makeProfileSnapshot('fam-1', 'de');
    fireSignedIn();

    await waitFor(() => expect(useStore.getState().appReady).toBe(true));
    expect(useStore.getState().currentUser.language).toBe('en');
    expect(i18n.language).toBe('en');
  });

  it('restores the profile preference again after sign-out and sign-in', async () => {
    firestoreState.profileSnapshot = makeProfileSnapshot('fam-1', 'tr');
    fireSignedIn();
    await waitFor(() => expect(useStore.getState().appReady).toBe(true));

    await act(async () => authState.listener?.(null));
    await waitFor(() => expect(useStore.getState().authStatus).toBe('unauthenticated'));
    await i18n.changeLanguage('en');
    await act(async () => authState.listener?.(makeAuthUser()));

    await waitFor(() => expect(useStore.getState().appReady).toBe(true));
    expect(i18n.language).toBe('tr');
  });

  it('1. protected route shows loading while auth is initializing and does NOT redirect to /login', () => {
    // authStatus is 'initializing' and no auth event fired yet.
    renderAppLayoutAt('/');
    expect(screen.getByText('Preparing your family dashboard…')).toBeInTheDocument();
    expect(screen.queryByText('Login Page')).not.toBeInTheDocument();
  });

  it('2. Google sign-in completes: auth state updates and user reaches protected route without PWA restart', async () => {
    firestoreState.profileSnapshot = makeProfileSnapshot('fam-1');
    fireSignedIn();

    await waitFor(() => {
      const s = useStore.getState();
      expect(s.authStatus).toBe('authenticated');
      expect(s.authUser?.uid).toBe('user-1');
    });

    // The route guard should now render the protected layout (not redirect).
    const { container } = renderAppLayoutAt('/');
    await waitFor(() => {
      // Once authenticated + profile resolved + family ready, appReady flips true.
      expect(useStore.getState().appReady).toBe(true);
    });
    expect(container.textContent).not.toContain('Login Page');
  });

  it('3. authenticated user profile loading succeeds: dashboard loading ends', async () => {
    firestoreState.profileSnapshot = makeProfileSnapshot('fam-1');
    fireSignedIn();

    await waitFor(() => {
      const s = useStore.getState();
      expect(s.profileLoading).toBe(false);
      expect(s.currentUser).not.toBeNull();
      expect(s.loading).toBe(false);
    });
  });

  it('4. profile loading fails: loading ends and an error screen appears (no infinite spinner)', async () => {
    firestoreState.profileError = { code: 'permission-denied', message: 'Missing or insufficient permissions.' };
    fireSignedIn();

    await waitFor(() => {
      const s = useStore.getState();
      expect(s.profileLoading).toBe(false);
      expect(s.loading).toBe(false);
      expect(s.bootstrapError).toContain('permission-denied');
    });

    renderAppLayoutAt('/');
    expect(await screen.findByText('Connection problem')).toBeInTheDocument();
    expect(screen.queryByText('Preparing your family dashboard…')).not.toBeInTheDocument();
  });

  it('5. authenticated session restored on cold launch: no temporary redirect to /login', async () => {
    // Simulate a restored session: onAuthStateChanged immediately reports a
    // signed-in user (as happens on cold launch with persisted auth).
    firestoreState.profileSnapshot = makeProfileSnapshot('fam-1');
    fireSignedIn();

    const { container } = renderAppLayoutAt('/');
    // At no point should the guard render the Login Page.
    await waitFor(() => expect(useStore.getState().appReady).toBe(true));
    expect(container.textContent).not.toContain('Login Page');
  });

  it('6. React StrictMode double effect: no duplicate auth listener, no stuck loading', async () => {
    // initAuth is guarded by `if (authUnsubscribe) return`, so calling it twice
    // (as StrictMode does) must register exactly one listener.
    act(() => {
      useStore.getState().initAuth();
    });
    expect(authState.listener).not.toBeNull();

    firestoreState.profileSnapshot = makeProfileSnapshot('fam-1');
    fireSignedIn();

    await waitFor(() => {
      const s = useStore.getState();
      expect(s.authStatus).toBe('authenticated');
      expect(s.loading).toBe(false);
      expect(s.profileLoading).toBe(false);
    });
  });
});
