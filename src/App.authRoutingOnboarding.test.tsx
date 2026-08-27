import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearDraft, saveDraft } from './onboarding/lib/onboardingDraft';

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

const firestoreBoundary = vi.hoisted(() => ({
  transactions: 0,
  familyWrites: [] as Array<{ path: string; data: unknown }>,
}));

vi.mock('./store/useStore', () => ({
  useStore: (selector: any) => selector(appStoreState),
  logAuthTrace: vi.fn(),
}));

vi.mock('./lib/firebase', () => ({
  app: {},
  auth: { currentUser: { uid: 'owner-1' } },
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
      update: vi.fn(),
    });
  }),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  addDoc: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  getDocs: vi.fn(),
  getDoc: vi.fn(),
  serverTimestamp: vi.fn(() => 'server-timestamp'),
  deleteDoc: vi.fn(),
  writeBatch: vi.fn(),
}));

vi.mock('./lib/googleRedirectAuth', () => ({
  consumeGoogleRedirectResult: vi.fn(async () => ({ error: null })),
  startGoogleAuthentication: vi.fn(async () => undefined),
}));
vi.mock('./lib/pushNotifications', () => ({ initForegroundMessaging: vi.fn(async () => undefined) }));
vi.mock('./components/E2EBootstrapDiagnostics', () => ({ E2EBootstrapDiagnostics: () => null }));
vi.mock('./components/requests/RequestDetailContext', () => ({ RequestDetailProvider: ({ children }: any) => children }));
vi.mock('./components/layout/AppLayout', () => ({ AppLayout: () => null }));

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

function savePostAuthCreateDraft() {
  saveDraft({
    version: 1,
    step: 'p1',
    parentFirstName: 'Kemal',
    parentRoleDisplay: 'parent',
    childFirstName: '',
    familyName: 'Kemal Family',
    updatedAt: Date.now(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  clearDraft();
  firestoreBoundary.transactions = 0;
  firestoreBoundary.familyWrites = [];
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
  appStoreState.initAuth.mockClear();
  appStoreState.retryBootstrap.mockClear();
  appStoreState.refreshCurrentUser.mockClear();
  window.history.pushState({}, '', '/');
});

describe('App auth routing and onboarding composition', () => {
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

    render(<App explicitCreateAuthorized />);

    await waitFor(() => expect(firestoreBoundary.transactions).toBe(1));
    expect(firestoreBoundary.familyWrites).toHaveLength(1);
    expect(firestoreBoundary.familyWrites[0]?.path).toBe('families');
  });
});
