import { create } from 'zustand';
import { collection, doc, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../lib/firebase';

export type BootstrapStatus = 'idle' | 'loading' | 'ready' | 'error';

export type BootstrapResource =
  | 'family'
  | 'members'
  | 'joinRequests'
  | 'tasks'
  | 'taskCompletions'
  | 'rewards'
  | 'feed'
  | 'walletTransactions'
  | 'savingsGoals'
  | 'behaviourEvents'
  | 'challenges'
  | 'funds'
  | 'fundTransactions'
  | 'redemptions'
  | 'transferRequests'
  | 'moneyRequests'
  | 'petboxRequests'
  | 'wallets';

const bootstrapResources: BootstrapResource[] = [
  'family',
  'members',
  'joinRequests',
  'tasks',
  'taskCompletions',
  'rewards',
  'feed',
  'walletTransactions',
  'savingsGoals',
  'behaviourEvents',
  'challenges',
  'funds',
  'fundTransactions',
  'redemptions',
  'transferRequests',
  'moneyRequests',
  'petboxRequests',
  'wallets',
];

const createBootstrapStatus = (status: BootstrapStatus): Record<BootstrapResource, BootstrapStatus> =>
  Object.fromEntries(bootstrapResources.map(resource => [resource, status])) as Record<BootstrapResource, BootstrapStatus>;

const emptyFamilyState = () => ({
  familyData: null,
  familyMembers: [] as any[],
  joinRequests: [] as any[],
  tasks: [] as any[],
  taskCompletions: [] as any[],
  rewards: [] as any[],
  feed: [] as any[],
  walletTransactions: [] as any[],
  savingsGoals: [] as any[],
  behaviourEvents: [] as any[],
  challenges: [] as any[],
  funds: [] as any[],
  fundTransactions: [] as any[],
  redemptions: [] as any[],
  transferRequests: [] as any[],
  moneyRequests: [] as any[],
  petboxRequests: [] as any[],
  myWallet: null,
  childWallets: [] as any[],
});

interface AppState {
  authInitialized: boolean;
  authLoading: boolean;
  profileLoading: boolean;
  familyLoading: boolean;
  appReady: boolean;
  loading: boolean;
  bootstrapError: string | null;
  bootstrapStatus: Record<BootstrapResource, BootstrapStatus>;
  activeFamilyId: string | null;

  authUser: any | null | undefined;
  currentUser: any | null;
  familyData: any | null;
  familyMembers: any[];
  joinRequests: any[];
  tasks: any[];
  taskCompletions: any[];
  rewards: any[];
  feed: any[];
  walletTransactions: any[];
  savingsGoals: any[];
  behaviourEvents: any[];
  challenges: any[];
  funds: any[];
  fundTransactions: any[];
  redemptions: any[];
  transferRequests: any[];
  moneyRequests: any[];
  petboxRequests: any[];
  myWallet: any | null;
  childWallets: any[];
  error: string | null;

  initAuth: () => void;
  loadFamilyData: (uid: string, familyId: string) => void;
  retryBootstrap: () => void;
  cleanup: () => void;
}

let authUnsubscribe: (() => void) | null = null;
let profileUnsubscribe: (() => void) | null = null;
let familyUnsubscribes: (() => void)[] = [];
let authGeneration = 0;
let familyGeneration = 0;

const stopProfileListener = () => {
  profileUnsubscribe?.();
  profileUnsubscribe = null;
};

const stopFamilyListeners = () => {
  familyGeneration += 1;
  const subscriptions = familyUnsubscribes;
  familyUnsubscribes = [];
  subscriptions.forEach(unsubscribe => unsubscribe());
};

const errorText = (context: string, error: any) =>
  `[${context}] ${error?.code || 'unknown'}: ${error?.message || 'Listener failed'}`;

export const useStore = create<AppState>((set, get) => ({
  authInitialized: false,
  authLoading: true,
  profileLoading: false,
  familyLoading: false,
  appReady: false,
  loading: true,
  bootstrapError: null,
  bootstrapStatus: createBootstrapStatus('idle'),
  activeFamilyId: null,

  authUser: undefined,
  currentUser: null,
  ...emptyFamilyState(),
  error: null,

  initAuth: () => {
    if (authUnsubscribe) return;

    authUnsubscribe = onAuthStateChanged(auth, async user => {
      const generation = ++authGeneration;
      stopProfileListener();
      stopFamilyListeners();

      if (!user) {
        set({
          authUser: null,
          authInitialized: true,
          authLoading: false,
          profileLoading: false,
          familyLoading: false,
          currentUser: null,
          ...emptyFamilyState(),
          bootstrapStatus: createBootstrapStatus('idle'),
          bootstrapError: null,
          error: null,
          activeFamilyId: null,
          appReady: true,
          loading: false,
        });
        return;
      }

      set({
        authUser: user,
        authInitialized: true,
        authLoading: false,
        profileLoading: true,
        familyLoading: false,
        currentUser: null,
        ...emptyFamilyState(),
        bootstrapStatus: createBootstrapStatus('idle'),
        bootstrapError: null,
        error: null,
        activeFamilyId: null,
        appReady: false,
        loading: true,
      });

      try {
        await user.getIdToken();
        if (generation !== authGeneration || get().authUser?.uid !== user.uid) return;

        profileUnsubscribe = onSnapshot(
          doc(db, 'users', user.uid),
          { includeMetadataChanges: true },
          profileSnapshot => {
            if (generation !== authGeneration || get().authUser?.uid !== user.uid) return;
            if (profileSnapshot.metadata?.fromCache) return;

            if (!profileSnapshot.exists()) {
              set({
                currentUser: null,
                profileLoading: false,
                bootstrapError: '[Profile] not-found: User profile does not exist',
                appReady: false,
                loading: false,
              });
              return;
            }

            const profile: any = { id: profileSnapshot.id, ...profileSnapshot.data() };
            set({ currentUser: profile, profileLoading: false });

            if (!profile.familyId) {
              stopFamilyListeners();
              set({
                ...emptyFamilyState(),
                bootstrapStatus: createBootstrapStatus('idle'),
                familyLoading: false,
                bootstrapError: null,
                activeFamilyId: null,
                appReady: true,
                loading: false,
              });
              return;
            }

            get().loadFamilyData(profile.id, profile.familyId);
          },
          error => {
            if (generation !== authGeneration) return;
            set({
              profileLoading: false,
              bootstrapError: errorText('Profile', error),
              appReady: false,
              loading: false,
            });
          },
        );
      } catch (error: any) {
        if (generation !== authGeneration) return;
        set({
          profileLoading: false,
          bootstrapError: errorText('Auth', error),
          appReady: false,
          loading: false,
        });
      }
    });
  },

  loadFamilyData: (_uid, familyId) => {
    const state = get();
    if (
      !familyId ||
      !state.authInitialized ||
      !state.authUser ||
      !state.currentUser ||
      state.currentUser.familyId !== familyId
    ) return;

    if (state.activeFamilyId === familyId && familyUnsubscribes.length > 0) return;

    stopFamilyListeners();
    const generation = familyGeneration;
    const owningAuthGeneration = authGeneration;

    set({
      ...emptyFamilyState(),
      bootstrapStatus: createBootstrapStatus('loading'),
      bootstrapError: null,
      error: null,
      activeFamilyId: familyId,
      familyLoading: true,
      appReady: false,
      loading: true,
    });

    const isCurrent = () =>
      familyGeneration === generation &&
      authGeneration === owningAuthGeneration &&
      get().activeFamilyId === familyId &&
      get().currentUser?.familyId === familyId;

    const markReady = (resource: BootstrapResource) => {
      if (!isCurrent() || get().bootstrapStatus[resource] === 'ready') return;
      set(current => ({
        bootstrapStatus: { ...current.bootstrapStatus, [resource]: 'ready' },
      }));

      if (bootstrapResources.every(key => get().bootstrapStatus[key] === 'ready')) {
        set({ familyLoading: false, appReady: true, loading: false });
      }
    };

    const fail = (resource: BootstrapResource, context: string, error: any) => {
      if (!isCurrent()) return;
      stopFamilyListeners();
      set(current => ({
        bootstrapStatus: { ...current.bootstrapStatus, [resource]: 'error' },
        bootstrapError: errorText(context, error),
        activeFamilyId: null,
        familyLoading: false,
        appReady: false,
        loading: false,
      }));
    };

    const subscribe = (
      resource: BootstrapResource,
      context: string,
      target: any,
      applySnapshot: (snapshot: any) => void,
    ) => {
      const unsubscribe = onSnapshot(
        target,
        { includeMetadataChanges: true },
        snapshot => {
          if (!isCurrent()) return;
          if (snapshot.metadata?.fromCache) return;
          applySnapshot(snapshot);
          markReady(resource);
        },
        error => fail(resource, context, error),
      );
      familyUnsubscribes.push(unsubscribe);
    };

    const docs = (snapshot: any) => snapshot.docs.map((item: any) => ({ id: item.id, ...item.data() }));

    try {
      subscribe('family', 'Family', doc(db, 'families', familyId), snapshot => {
        if (!snapshot.exists()) {
          fail('family', 'Family', { code: 'not-found', message: 'Family document does not exist' });
          return;
        }
        set({ familyData: { id: snapshot.id, ...snapshot.data() } });
      });

      subscribe('tasks', 'Tasks', collection(db, `families/${familyId}/tasks`), snapshot => set({ tasks: docs(snapshot) }));
      subscribe('rewards', 'Rewards', collection(db, `families/${familyId}/rewards`), snapshot => set({ rewards: docs(snapshot) }));

      const currentUser = get().currentUser;
      if (currentUser?.role === 'parent' || currentUser?.role === 'owner') {
        subscribe('wallets', 'Wallets', collection(db, `families/${familyId}/wallets`), snapshot => set({ childWallets: docs(snapshot) }));
      } else if (currentUser?.role === 'child') {
        subscribe('wallets', 'Wallets', doc(db, `families/${familyId}/wallets/${currentUser.id}`), snapshot => {
          set({
            myWallet: snapshot.exists()
              ? { id: snapshot.id, ...snapshot.data() }
              : { id: currentUser.id, balance: currentUser.walletBalance || 0 },
          });
        });
      } else {
        markReady('wallets');
      }

      subscribe('members', 'Members', query(collection(db, 'users'), where('familyId', '==', familyId)), snapshot => set({ familyMembers: docs(snapshot) }));
      subscribe('joinRequests', 'Join requests', collection(db, `families/${familyId}/join_requests`), snapshot => set({ joinRequests: docs(snapshot) }));
      subscribe('taskCompletions', 'Task completions', collection(db, `families/${familyId}/task_completions`), snapshot => set({ taskCompletions: docs(snapshot) }));
      subscribe('redemptions', 'Redemptions', collection(db, `families/${familyId}/redemptions`), snapshot => set({ redemptions: docs(snapshot) }));
      subscribe('feed', 'Feed', query(collection(db, `families/${familyId}/feed`), orderBy('timestamp', 'desc')), snapshot => set({ feed: docs(snapshot) }));
      subscribe('walletTransactions', 'Wallet transactions', query(collection(db, `families/${familyId}/wallet_transactions`), orderBy('timestamp', 'desc')), snapshot => set({ walletTransactions: docs(snapshot) }));
      subscribe('savingsGoals', 'Savings goals', collection(db, `families/${familyId}/savings_goals`), snapshot => set({ savingsGoals: docs(snapshot) }));
      subscribe('behaviourEvents', 'Behaviour events', query(collection(db, `families/${familyId}/behaviour_events`), orderBy('timestamp', 'desc')), snapshot => set({ behaviourEvents: docs(snapshot) }));
      subscribe('challenges', 'Challenges', query(collection(db, `families/${familyId}/challenges`), orderBy('createdAt', 'desc')), snapshot => set({ challenges: docs(snapshot) }));
      subscribe('funds', 'Funds', collection(db, `families/${familyId}/funds`), snapshot => set({ funds: docs(snapshot) }));
      subscribe('fundTransactions', 'Fund transactions', query(collection(db, `families/${familyId}/fund_transactions`), orderBy('createdAt', 'desc')), snapshot => set({ fundTransactions: docs(snapshot) }));
      subscribe('transferRequests', 'Transfer requests', query(collection(db, `families/${familyId}/transfer_requests`), orderBy('createdAt', 'desc')), snapshot => set({ transferRequests: docs(snapshot) }));
      subscribe('moneyRequests', 'Money requests', query(collection(db, `families/${familyId}/money_requests`), orderBy('createdAt', 'desc')), snapshot => set({ moneyRequests: docs(snapshot) }));
      subscribe('petboxRequests', 'Pet Box requests', query(collection(db, `families/${familyId}/petbox_requests`), orderBy('createdAt', 'desc')), snapshot => set({ petboxRequests: docs(snapshot) }));
    } catch (error: any) {
      fail('family', 'Bootstrap', error);
    }
  },

  retryBootstrap: () => {
    const { currentUser, authUser } = get();
    if (!authUser) return;
    if (currentUser?.familyId) {
      set({ bootstrapError: null });
      get().loadFamilyData(currentUser.id, currentUser.familyId);
      return;
    }

    authGeneration += 1;
    stopProfileListener();
    stopFamilyListeners();
    authUnsubscribe?.();
    authUnsubscribe = null;
    set({
      authInitialized: false,
      authLoading: true,
      profileLoading: false,
      authUser: undefined,
      currentUser: null,
      bootstrapError: null,
      appReady: false,
      loading: true,
    });
    get().initAuth();
  },

  cleanup: () => {
    authGeneration += 1;
    stopProfileListener();
    stopFamilyListeners();
    authUnsubscribe?.();
    authUnsubscribe = null;
    set({
      authInitialized: false,
      authLoading: true,
      profileLoading: false,
      familyLoading: false,
      authUser: undefined,
      currentUser: null,
      ...emptyFamilyState(),
      bootstrapStatus: createBootstrapStatus('idle'),
      bootstrapError: null,
      error: null,
      activeFamilyId: null,
      appReady: false,
      loading: true,
    });
  },
}));
