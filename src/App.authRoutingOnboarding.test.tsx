import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearDraft, saveDraft } from './onboarding/lib/onboardingDraft';
import {
  clearCreateFamilyIntent,
  readCreateFamilyIntent,
  startCreateFamilyIntent,
} from './auth/createFamilyIntent';

const appStoreState = vi.hoisted(() => ({
  authStatus: 'initializing' as 'initializing' | 'authenticated' | 'unauthenticated',
  authUser: undefined as any,
  currentUser: null as any,
  familyData: null as any,
  familyMembers: [] as any[],
  profileServerConfirmed: false,
  profileLoading: false,
  appReady: false,
  bootstrapError: null as string | null,
  pendingMembershipStatus: 'idle',
  bootstrapAttempt: 0,
  initAuth: vi.fn(),
  retryBootstrap: vi.fn(),
  refreshCurrentUser: vi.fn(),
}));
const appStoreListeners = vi.hoisted(() => new Set<() => void>());

const firestoreBoundary = vi.hoisted(() => ({
  transactions: 0,
  familyWrites: [] as Array<{ path: string; data: unknown }>,
  publishMembershipDuringTransaction: false,
}));

vi.mock('./store/useStore', async () => {
  const { useSyncExternalStore } = await import('react');
  const useStore = ((selector: any) => useSyncExternalStore(
    (listener) => {
      appStoreListeners.add(listener);
      return () => appStoreListeners.delete(listener);
    },
    () => selector(appStoreState),
    () => selector(appStoreState),
  )) as any;
  useStore.getState = () => appStoreState;
  useStore.setState = (partial: Record<string, unknown>) => {
    Object.assign(appStoreState, partial);
    appStoreListeners.forEach(listener => listener());
  };
  return { useStore, logAuthTrace: vi.fn() };
});

vi.mock('./lib/firebase', () => ({
  app: {},
  auth: { currentUser: {
    uid: 'owner-1', emailVerified: true,
    reload: vi.fn(async () => {}),
    getIdTokenResult: vi.fn(async () => ({ claims: { email_verified: true, firebase: { sign_in_provider: 'password' } } })),
  } },
  db: {},
  googleProvider: {},
}));

vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, path: string) => ({ path, kind: 'collection' })),
  doc: vi.fn((parent: any, path?: string, id?: string) => {
    if (parent?.kind === 'collection') return { path: parent.path, id: 'family-created' };
    return { path, id };
  }),
  runTransaction: vi.fn(async (_db: unknown, operation: (transaction: any) => Promise<void>) => {
    firestoreBoundary.transactions += 1;
    await operation({
      get: vi.fn(async (reference: any) => ({
        exists: () => reference.path === 'users' && reference.id === 'owner-1',
        id: reference.id,
        data: () => ({ role: 'parent' }),
      })),
      set: vi.fn((reference: any, data: unknown) => {
        firestoreBoundary.familyWrites.push({ path: reference.path, data });
      }),
      update: vi.fn((reference: any) => {
        if (firestoreBoundary.publishMembershipDuringTransaction && reference.path === 'users') {
          appStoreState.currentUser = {
            ...appStoreState.currentUser,
            familyId: 'family-created',
            role: 'owner',
          };
          appStoreListeners.forEach(listener => listener());
        }
      }),
    });
  }),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  addDoc: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  getDocs: vi.fn(),
  getDoc: vi.fn(async (reference: any) => ({
    exists: () => reference.path === 'users' && reference.id === 'owner-1',
    id: reference.id,
    data: () => ({ uid: 'owner-1', familyId: 'family-created', role: 'owner' }),
  })),
  serverTimestamp: vi.fn(() => 'server-timestamp'),
  deleteDoc: vi.fn(),
  writeBatch: vi.fn(() => ({
    set: vi.fn(),
    commit: vi.fn(async () => undefined),
  })),
}));

vi.mock('./lib/googleRedirectAuth', () => ({
  consumeGoogleRedirectResult: vi.fn(async () => ({ error: null })),
  startGoogleAuthentication: vi.fn(async () => undefined),
}));
vi.mock('./lib/pushNotifications', () => ({ initForegroundMessaging: vi.fn(async () => undefined) }));
vi.mock('./components/E2EBootstrapDiagnostics', () => ({ E2EBootstrapDiagnostics: () => null }));
vi.mock('./components/requests/RequestDetailContext', () => ({ RequestDetailProvider: ({ children }: any) => children }));
vi.mock('./components/layout/AppLayout', () => ({
  AppLayout: () => <div data-testid="app-layout" />,
}));

vi.mock('./pages/Dashboard', () => ({ Dashboard: () => null }));
vi.mock('./pages/Family', () => ({ Family: () => null }));
vi.mock('./pages/MemberProfile', () => ({ MemberProfile: () => null }));
vi.mock('./pages/Tasks', () => ({ Tasks: () => null }));
vi.mock('./pages/ReviewPage', () => ({ ReviewPage: () => null }));
vi.mock('./pages/Rewards', () => ({ Rewards: () => null }));
vi.mock('./pages/Wallet', () => ({ Wallet: () => null }));
vi.mock('./pages/Wallets', () => ({ Wallets: () => null }));
vi.mock('./pages/Settings', () => ({ Settings: () => null }));
vi.mock('./pages/ContinueSetup', () => ({ ContinueSetup: () => null }));
vi.mock('./pages/Login', () => ({ Login: () => null }));
vi.mock('./pages/Signup', () => ({ Signup: () => null }));
vi.mock('./pages/JoinFamily', () => ({ JoinFamily: () => null }));
vi.mock('./pages/JoinInvite', () => ({ JoinInvite: () => null }));
vi.mock('./pages/AdultInvite', () => ({ AdultInvite: () => null }));
vi.mock('./pages/PendingMembership', () => ({ PendingMembership: () => null }));
vi.mock('./pages/legal/PrivacyPolicy', () => ({ PrivacyPolicy: () => null }));
vi.mock('./pages/legal/TermsOfService', () => ({ TermsOfService: () => null }));
vi.mock('./pages/legal/AccountDeletion', () => ({ AccountDeletion: () => null }));
vi.mock('./pages/FundsDashboard', () => ({ FundsDashboard: () => null }));
vi.mock('./pages/Goals', () => ({ Goals: () => null }));
vi.mock('./pages/GoalDetail', () => ({ GoalDetail: () => null }));
vi.mock('./pages/Notifications', () => ({ Notifications: () => null }));
vi.mock('./components/history/TransactionHistoryScreen', () => ({ TransactionHistoryScreen: () => null }));
vi.mock('./help/pages/HelpHome', () => ({ HelpHome: () => null }));
vi.mock('./help/pages/HelpArticlePage', () => ({ HelpArticlePage: () => null }));
vi.mock('./help/pages/HelpCategoryPage', () => ({ HelpCategoryPage: () => null }));
vi.mock('./help/pages/HelpSearchResults', () => ({ HelpSearchResults: () => null }));

import App from './App';

function savePostAuthCreateDraft(childFirstName = '') {
  saveDraft({
    version: 1,
    step: 'p1',
    parentFirstName: 'Kemal',
    parentRoleDisplay: 'parent',
    childFirstName,
    familyName: 'Kemal Family',
    updatedAt: Date.now(),
  });
}

function publishStore(partial: Record<string, unknown>) {
  Object.assign(appStoreState, partial);
  appStoreListeners.forEach(listener => listener());
}

beforeEach(() => {
  vi.clearAllMocks();
  clearDraft();
  clearCreateFamilyIntent();
  firestoreBoundary.transactions = 0;
  firestoreBoundary.familyWrites = [];
  firestoreBoundary.publishMembershipDuringTransaction = false;
  appStoreState.authStatus = 'initializing';
  appStoreState.authUser = undefined;
  appStoreState.currentUser = null;
  appStoreState.familyData = null;
  appStoreState.familyMembers = [];
  appStoreState.profileServerConfirmed = false;
  appStoreState.profileLoading = false;
  appStoreState.appReady = false;
  appStoreState.bootstrapError = null;
  appStoreState.pendingMembershipStatus = 'idle';
  appStoreListeners.clear();
  appStoreState.initAuth.mockClear();
  appStoreState.retryBootstrap.mockClear();
  appStoreState.refreshCurrentUser.mockClear();
  appStoreState.refreshCurrentUser.mockImplementation((uid: string, updated: Record<string, unknown>) => {
    if (appStoreState.currentUser?.id !== uid) return;
    publishStore({ currentUser: { ...appStoreState.currentUser, ...updated } });
  });
  window.history.pushState({}, '', '/');
});

describe('App auth routing and onboarding composition', () => {
  it('honours the initial Set up your family choice after authentication without asking Create or Join again', async () => {
    const user = userEvent.setup();
    publishStore({
      authStatus: 'unauthenticated',
      authUser: null,
      currentUser: null,
      profileServerConfirmed: false,
      appReady: true,
    });
    window.history.pushState({}, '', '/onboarding');

    const view = render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Set up your family' }));

    await act(async () => {
      savePostAuthCreateDraft();
      publishStore({
        authStatus: 'authenticated',
        authUser: { uid: 'owner-1' },
        currentUser: { id: 'owner-1', role: 'parent' },
        profileServerConfirmed: true,
        appReady: true,
        pendingMembershipStatus: 'none',
      });
      view.rerender(<App />);
    });

    await waitFor(() => expect(window.location.pathname).toBe('/onboarding'));
    await waitFor(() => expect(window.location.search).toBe('?mode=create'));
    await waitFor(() => expect(firestoreBoundary.transactions).toBe(1));
    expect(screen.queryByRole('button', { name: 'Create a family' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Join a family' })).not.toBeInTheDocument();
  });

  it('does not create a family when an auth transition reaches no-family root routing with a stale post-auth draft', async () => {
    savePostAuthCreateDraft();
    // Task 8 owns the /no-family screen itself. Task 7 deliberately owns the
    // redirect, so silence React Router's temporary no-route diagnostic while
    // asserting the actual location selected by the real App composition.
    const routerWarning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const view = render(<App />);

      await act(async () => {
        appStoreState.authStatus = 'authenticated';
        appStoreState.authUser = { uid: 'owner-1' };
        appStoreState.currentUser = { id: 'owner-1', role: 'parent' };
        appStoreState.profileServerConfirmed = true;
        appStoreState.appReady = true;
        appStoreState.pendingMembershipStatus = 'none';
        view.rerender(<App />);
      });

      await waitFor(() => expect(window.location.pathname).toBe('/no-family'));
      expect(firestoreBoundary.transactions).toBe(0);
      expect(firestoreBoundary.familyWrites).toEqual([]);
    } finally {
      routerWarning.mockRestore();
    }
  });

  it('reaches the real onboarding creation boundary through App when explicit creation is authorized', async () => {
    savePostAuthCreateDraft();
    appStoreState.authStatus = 'authenticated';
    appStoreState.authUser = { uid: 'owner-1' };
    appStoreState.currentUser = { id: 'owner-1', role: 'parent' };
    appStoreState.profileServerConfirmed = true;
    appStoreState.appReady = true;
    appStoreState.pendingMembershipStatus = 'none';
    window.history.pushState({}, '', '/onboarding?mode=create');
    startCreateFamilyIntent('owner-1');

    render(<App />);

    await waitFor(() => expect(firestoreBoundary.transactions).toBe(1));
    expect(firestoreBoundary.familyWrites).toHaveLength(1);
    expect(firestoreBoundary.familyWrites[0]?.path).toBe('families');
  });

  it('reacts to Create inside the real App and stays on exact creation onboarding without a reload', async () => {
    const user = userEvent.setup();
    savePostAuthCreateDraft();
    publishStore({
      authStatus: 'authenticated',
      authUser: { uid: 'owner-1' },
      currentUser: { id: 'owner-1', role: 'parent' },
      profileServerConfirmed: true,
      appReady: true,
      pendingMembershipStatus: 'none',
    });
    window.history.pushState({}, '', '/no-family');

    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Create a family' }));

    await waitFor(() => expect(window.location.pathname).toBe('/onboarding'));
    expect(window.location.search).toBe('?mode=create');
    await waitFor(() => expect(firestoreBoundary.transactions).toBe(1));
  });

  it('keeps the authoritative creation journey through P2/P3, then completion restores app priority', async () => {
    const user = userEvent.setup();
    savePostAuthCreateDraft('Osman');
    publishStore({
      authStatus: 'authenticated',
      authUser: { uid: 'owner-1' },
      currentUser: { id: 'owner-1', role: 'parent' },
      profileServerConfirmed: true,
      appReady: true,
      pendingMembershipStatus: 'none',
    });
    window.history.pushState({}, '', '/no-family');

    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Create a family' }));

    await waitFor(() => expect(appStoreState.refreshCurrentUser).toHaveBeenCalledWith('owner-1', {
      familyId: 'family-created',
      role: 'owner',
    }));
    await waitFor(() => expect(appStoreState.currentUser?.familyId).toBe('family-created'));
    expect(window.location.pathname).toBe('/onboarding');
    expect(window.location.search).toBe('?mode=create');
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: /first win/i })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(await screen.findByRole('button', { name: 'Go to my dashboard' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Go to my dashboard' }));

    await waitFor(() => expect(window.location.pathname).toBe('/'));
  });

  it('keeps P1 mounted when the profile listener publishes family membership before the create promise resolves', async () => {
    const user = userEvent.setup();
    savePostAuthCreateDraft('Osman');
    firestoreBoundary.publishMembershipDuringTransaction = true;
    publishStore({
      authStatus: 'authenticated',
      authUser: { uid: 'owner-1' },
      currentUser: { id: 'owner-1', role: 'parent' },
      profileServerConfirmed: true,
      appReady: true,
      pendingMembershipStatus: 'none',
    });
    window.history.pushState({}, '', '/no-family');

    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Create a family' }));

    await waitFor(() => expect(appStoreState.currentUser?.familyId).toBe('family-created'));
    expect(window.location.pathname).toBe('/onboarding');
    expect(window.location.search).toBe('?mode=create');
    expect(await screen.findByRole('button', { name: 'Continue' })).toBeVisible();
  });

  it('lets an existing active family beat a forged fresh intent on initial mount', async () => {
    savePostAuthCreateDraft();
    startCreateFamilyIntent('owner-1');
    publishStore({
      authStatus: 'authenticated',
      authUser: { uid: 'owner-1' },
      currentUser: { id: 'owner-1', role: 'owner', familyId: 'existing-family' },
      profileServerConfirmed: true,
      appReady: true,
      pendingMembershipStatus: 'none',
    });
    window.history.pushState({}, '', '/onboarding?mode=create');

    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(firestoreBoundary.transactions).toBe(0);
  });

  it('clears reactive intent and creation continuation across sign-out and account replacement', async () => {
    const user = userEvent.setup();
    savePostAuthCreateDraft('Osman');
    publishStore({
      authStatus: 'authenticated',
      authUser: { uid: 'owner-1' },
      currentUser: { id: 'owner-1', role: 'parent' },
      profileServerConfirmed: true,
      appReady: true,
      pendingMembershipStatus: 'none',
    });
    window.history.pushState({}, '', '/no-family');
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Create a family' }));
    await waitFor(() => expect(appStoreState.refreshCurrentUser).toHaveBeenCalledWith('owner-1', {
      familyId: 'family-created',
      role: 'owner',
    }));
    await waitFor(() => expect(appStoreState.currentUser?.familyId).toBe('family-created'));

    await act(async () => publishStore({
      authStatus: 'unauthenticated',
      authUser: null,
      currentUser: null,
      profileServerConfirmed: false,
      appReady: true,
    }));
    await waitFor(() => expect(window.location.pathname).toBe('/onboarding'));
    expect(readCreateFamilyIntent('owner-1')).toBeNull();

    await act(async () => {
      window.history.pushState({}, '', '/onboarding?mode=create');
      window.dispatchEvent(new PopStateEvent('popstate'));
      publishStore({
        authStatus: 'authenticated',
        authUser: { uid: 'owner-1' },
        currentUser: { id: 'owner-1', role: 'owner', familyId: 'family-created' },
        profileServerConfirmed: true,
        appReady: true,
        pendingMembershipStatus: 'none',
      });
    });

    await waitFor(() => expect(window.location.pathname).toBe('/'));
  });

  it('cannot reuse an authoritative continuation after a direct account switch', async () => {
    const user = userEvent.setup();
    savePostAuthCreateDraft('Osman');
    publishStore({
      authStatus: 'authenticated',
      authUser: { uid: 'owner-1' },
      currentUser: { id: 'owner-1', role: 'parent' },
      profileServerConfirmed: true,
      appReady: true,
      pendingMembershipStatus: 'none',
    });
    window.history.pushState({}, '', '/no-family');
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Create a family' }));
    await waitFor(() => expect(appStoreState.currentUser?.familyId).toBe('family-created'));

    await act(async () => publishStore({
      authUser: { uid: 'owner-2' },
      currentUser: { id: 'owner-2', role: 'owner', familyId: 'other-family' },
    }));
    await waitFor(() => expect(window.location.pathname).toBe('/'));

    await act(async () => {
      window.history.pushState({}, '', '/onboarding?mode=create');
      window.dispatchEvent(new PopStateEvent('popstate'));
      publishStore({
        authUser: { uid: 'owner-1' },
        currentUser: { id: 'owner-1', role: 'owner', familyId: 'family-created' },
      });
    });

    await waitFor(() => expect(window.location.pathname).toBe('/'));
  });

  it('cannot reuse an authoritative continuation after the creation route unmounts', async () => {
    const user = userEvent.setup();
    savePostAuthCreateDraft('Osman');
    publishStore({
      authStatus: 'authenticated',
      authUser: { uid: 'owner-1' },
      currentUser: { id: 'owner-1', role: 'parent' },
      profileServerConfirmed: true,
      appReady: true,
      pendingMembershipStatus: 'none',
    });
    window.history.pushState({}, '', '/no-family');
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Create a family' }));
    await waitFor(() => expect(appStoreState.currentUser?.familyId).toBe('family-created'));

    await act(async () => {
      window.history.pushState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(await screen.findByTestId('app-layout')).toBeVisible();

    await act(async () => {
      window.history.pushState({}, '', '/onboarding?mode=create');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(await screen.findByTestId('app-layout')).toBeVisible();
    await waitFor(() => expect(window.location.pathname).toBe('/'));
  });
});
