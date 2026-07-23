import { create } from 'zustand';
import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import {
  bootstrapResources,
  bootstrapResourcesForRole,
  criticalBootstrapResources,
  createBootstrapQueryPlan,
  type BootstrapResource,
  type BootstrapRole,
} from '../lib/bootstrapQueries';

export type BootstrapStatus = 'idle' | 'loading' | 'ready' | 'error';

const createBootstrapStatus = (
  status: BootstrapStatus,
  resources: BootstrapResource[] = bootstrapResources,
): Record<BootstrapResource, BootstrapStatus> =>
  Object.fromEntries(bootstrapResources.map(resource => [resource, resources.includes(resource) ? status : 'idle'])) as Record<BootstrapResource, BootstrapStatus>;

const validatedFamilyId = (value: unknown): string | null => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim() !== value) {
    throw new Error('Profile familyId must be a non-empty, trimmed string.');
  }
  return value;
};

const timestampMillis = (value: any): number => {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value?.seconds === 'number') {
    return value.seconds * 1_000 + Math.floor((value.nanoseconds ?? 0) / 1_000_000);
  }
  return 0;
};

const normalizeHistory = (items: any[]) => items
  .map(item => item.timestamp == null && item.createdAt != null
    ? { ...item, timestamp: item.createdAt }
    : item)
  .sort((left, right) => {
    const timeDifference = timestampMillis(right.timestamp ?? right.createdAt)
      - timestampMillis(left.timestamp ?? left.createdAt);
    return timeDifference || String(left.id).localeCompare(String(right.id));
  });

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
  goalRequests: [] as any[],
  goalContributions: [] as any[],
  goalLedger: [] as any[],
  goalMatchProposals: [] as any[],
  behaviourEvents: [] as any[],
  challenges: [] as any[],
  funds: [] as any[],
  fundTransactions: [] as any[],
  redemptions: [] as any[],
  transferRequests: [] as any[],
  moneyRequests: [] as any[],
  petboxRequests: [] as any[],
  profileUpdateRequests: [] as any[],
  reversals: [] as any[],
  avatarUnlocks: [] as any[],
  myWallet: null,
  childWallets: [] as any[],
  gamificationSummaries: [] as any[],
  dailyProgress: [] as any[],
  myGamificationSummary: null as any,
  myDailyProgress: null as any,
});

interface AppState {
  // Distinct auth initialization state. `initializing` means Firebase Auth has
  // not yet resolved the first auth state; `authenticated`/`unauthenticated`
  // are only set once the first onAuthStateChanged callback has fired. This
  // removes the ambiguity of using `authUser === undefined` to mean both
  // "not yet checked" and "signed out".
  authStatus: 'initializing' | 'authenticated' | 'unauthenticated';
  authInitialized: boolean;
  authLoading: boolean;
  profileLoading: boolean;
  familyLoading: boolean;
  appReady: boolean;
  loading: boolean;
  bootstrapError: string | null;
  featureErrors: Record<string, string | null>;
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
  goalRequests: any[];
  goalContributions: any[];
  goalLedger: any[];
  goalMatchProposals: any[];
  behaviourEvents: any[];
  challenges: any[];
  funds: any[];
  fundTransactions: any[];
  redemptions: any[];
  transferRequests: any[];
  moneyRequests: any[];
  petboxRequests: any[];
  profileUpdateRequests: any[];
  reversals: any[];
  avatarUnlocks: any[];
  myWallet: any | null;
  childWallets: any[];
  gamificationSummaries: any[];
  dailyProgress: any[];
  myGamificationSummary: any | null;
  myDailyProgress: any | null;
  error: string | null;

  initAuth: () => void;
  loadFamilyData: (uid: string, familyId: string) => void;
  retryBootstrap: () => void;
  loadReversals: () => void;
  retryFeature: (name: string) => void;
  cleanup: () => void;
}

let authUnsubscribe: (() => void) | null = null;
let profileUnsubscribe: (() => void) | null = null;
type ListenerRegistration = {
  critical: boolean;
  unsubscribe: () => void;
};

let familyListeners = new Map<string, ListenerRegistration>();
let authGeneration = 0;
let familyGeneration = 0;

const stopProfileListener = () => {
  profileUnsubscribe?.();
  profileUnsubscribe = null;
};

const stopFamilyListeners = () => {
  familyGeneration += 1;
  const subscriptions = [...familyListeners.values()];
  familyListeners.clear();
  subscriptions.forEach(({ unsubscribe }) => unsubscribe());
};

const stopFamilyListener = (name: string) => {
  const registration = familyListeners.get(name);
  if (!registration) return;
  familyListeners.delete(name);
  registration.unsubscribe();
};

const errorText = (context: string, error: any) =>
  `[${context}] ${error?.code || 'unknown'}: ${error?.message || 'Listener failed'}`;

// Surface the underlying Firebase error in development only. This is how we
// diagnose issues like a missing composite index (`failed-precondition`) or a
// rules/query mismatch (`permission-denied`) without ever exposing raw Firebase
// errors to end users in production.
const logDevError = (context: string, error: any, queryShape?: unknown) => {
  if (import.meta.env?.PROD) return;
  // eslint-disable-next-line no-console
  console.error(`[dev] ${context} failed:`, {
    code: error?.code,
    message: error?.message,
    queryShape,
  });
};

// Temporary development-only trace logging for the auth/bootstrap startup flow.
// Timestamps every key step so we can diagnose redirect/loading races. No
// tokens, credentials, or sensitive user data are ever logged. Remove once the
// auth bootstrap bugs are confirmed fixed in production.
const logAuthTrace = (event: string, detail?: Record<string, unknown>) => {
  if (import.meta.env?.PROD) return;
  // eslint-disable-next-line no-console
  console.info(`[auth-trace] ${new Date().toISOString()} ${event}`, detail ?? {});
};

export const useStore = create<AppState>((set, get) => ({
  authStatus: 'initializing',
  authInitialized: false,
  authLoading: true,
  profileLoading: false,
  familyLoading: false,
  appReady: false,
  loading: true,
  bootstrapError: null,
  featureErrors: {},
  bootstrapStatus: createBootstrapStatus('idle'),
  activeFamilyId: null,

  authUser: undefined,
  currentUser: null,
  ...emptyFamilyState(),
  error: null,

  initAuth: () => {
    if (authUnsubscribe) return;
    logAuthTrace('auth-listener-registered');

    authUnsubscribe = onAuthStateChanged(auth, async user => {
      const generation = ++authGeneration;
      stopProfileListener();
      stopFamilyListeners();
      logAuthTrace('auth-listener-fired', { signedIn: Boolean(user), generation });

      if (!user) {
        set({
          authStatus: 'unauthenticated',
          authUser: null,
          authInitialized: true,
          authLoading: false,
          profileLoading: false,
          familyLoading: false,
          currentUser: null,
          ...emptyFamilyState(),
          bootstrapStatus: createBootstrapStatus('idle'),
          bootstrapError: null,
          featureErrors: {},
          error: null,
          activeFamilyId: null,
          appReady: true,
          loading: false,
        });
        logAuthTrace('auth-status-changed', { authStatus: 'unauthenticated' });
        return;
      }

      set({
        authStatus: 'authenticated',
        authUser: user,
        authInitialized: true,
        authLoading: false,
        profileLoading: true,
        familyLoading: false,
        currentUser: null,
        ...emptyFamilyState(),
        bootstrapStatus: createBootstrapStatus('idle'),
        bootstrapError: null,
        featureErrors: {},
        error: null,
        activeFamilyId: null,
        appReady: false,
        loading: true,
      });
      logAuthTrace('auth-status-changed', { authStatus: 'authenticated', uid: user.uid });

      try {
        await user.getIdToken();
        if (generation !== authGeneration || get().authUser?.uid !== user.uid) return;

        const profileReference = doc(db, 'users', user.uid);
        let profileResolved = false;

        const handleProfileSnapshot = (profileSnapshot: any) => {
          if (generation !== authGeneration || get().authUser?.uid !== user.uid) return;

          if (!profileSnapshot.exists()) {
            set({
              currentUser: null,
              profileLoading: false,
              bootstrapError: '[Profile] not-found: User profile is not available yet',
              appReady: false,
              loading: false,
            });
            return;
          }

          const profile: any = { id: profileSnapshot.id, ...profileSnapshot.data() };
          let familyId: string | null;
          try {
            familyId = validatedFamilyId(profile.familyId);
          } catch (error: any) {
            set({
              currentUser: null,
              profileLoading: false,
              bootstrapError: `[Profile] invalid-familyId: ${error.message}`,
              appReady: false,
              loading: false,
            });
            return;
          }

          profileResolved = true;
          const validatedProfile = { ...profile, ...(familyId ? { familyId } : { familyId: undefined }) };
          set({ currentUser: validatedProfile, profileLoading: false, bootstrapError: null });
          logAuthTrace('profile-request-completed', { hasFamilyId: Boolean(familyId) });

          if (!familyId) {
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

          get().loadFamilyData(validatedProfile.id, familyId);
        };

        profileUnsubscribe = onSnapshot(
          profileReference,
          { includeMetadataChanges: true },
          profileSnapshot => {
            if (generation !== authGeneration || get().authUser?.uid !== user.uid) return;
            // Cached snapshots are ignored for the authoritative resolve, but we
            // must NOT leave loading stuck if the only event we ever receive is a
            // cached one — the getDocFromServer fallback below guarantees a
            // server-resolution path. We still skip fromCache here to avoid
            // flashing stale data.
            if (profileSnapshot.metadata?.fromCache) return;
            handleProfileSnapshot(profileSnapshot);
          },
          error => {
            if (generation !== authGeneration) return;
            logAuthTrace('profile-request-failed', { code: error?.code });
            set({
              profileLoading: false,
              bootstrapError: errorText('Profile', error),
              appReady: false,
              loading: false,
            });
          },
        );

        logAuthTrace('profile-request-started', { uid: user.uid });
        void getDocFromServer(profileReference)
          .then(snapshot => {
            if (!profileResolved) handleProfileSnapshot(snapshot);
          })
          .catch(error => {
            if (generation !== authGeneration || profileResolved) return;
            logAuthTrace('profile-request-failed', { code: error?.code });
            set({
              profileLoading: false,
              bootstrapError: errorText('Profile', error),
              appReady: false,
              loading: false,
            });
          })
          .finally(() => {
            // Guarantee loading is cleared even if both the snapshot listener and
            // the server read are somehow discarded by a generation bump. Without
            // this, profileLoading/loading could remain true indefinitely. Only
            // apply the not-found fallback if no authoritative error was already
            // recorded by the .catch above.
            const alreadyErrored = Boolean(get().bootstrapError);
            if (generation === authGeneration && get().authUser?.uid === user.uid && !profileResolved && !alreadyErrored) {
              set({
                profileLoading: false,
                bootstrapError: '[Profile] not-found: User profile is not available yet',
                appReady: false,
                loading: false,
              });
            }
          });
      } catch (error: any) {
        if (generation !== authGeneration) return;
        logAuthTrace('auth-token-failed', { code: error?.code });
        set({
          profileLoading: false,
          bootstrapError: errorText('Auth', error),
          appReady: false,
          loading: false,
        });
      }
    }, error => {
      logAuthTrace('auth-observer-failed', { code: (error as any)?.code });
      set({
        authStatus: 'unauthenticated',
        authInitialized: true,
        authLoading: false,
        profileLoading: false,
        bootstrapError: errorText('Auth observer', error),
        appReady: false,
        loading: false,
      });
    });
  },

  loadFamilyData: (_uid, familyId) => {
    const state = get();
    let safeFamilyId: string | null;
    try {
      safeFamilyId = validatedFamilyId(familyId);
    } catch (error: any) {
      set({ bootstrapError: `[Profile] invalid-familyId: ${error.message}`, appReady: false, loading: false });
      return;
    }
    if (
      !safeFamilyId ||
      !state.authInitialized ||
      !state.authUser ||
      !state.currentUser ||
      state.currentUser.familyId !== safeFamilyId
    ) return;

    familyId = safeFamilyId;

    if (state.activeFamilyId === familyId && familyListeners.size > 0) return;

    stopFamilyListeners();
    const generation = familyGeneration;
    const owningAuthGeneration = authGeneration;

    const role = state.currentUser.role as BootstrapRole;
    const roleResources = bootstrapResourcesForRole(role);
    const requiredResources = criticalBootstrapResources.filter(resource => roleResources.includes(resource));
    const queryPlan = createBootstrapQueryPlan(db, {
      familyId,
      userId: state.currentUser.id,
      role,
    });
    const queryPlanEntry = (key: string) => {
      const entry = queryPlan.find(candidate => candidate.key === key);
      if (!entry) throw new Error(`Bootstrap query plan is missing ${key}.`);
      return entry;
    };

    set({
      ...emptyFamilyState(),
      bootstrapStatus: createBootstrapStatus('loading', roleResources),
      bootstrapError: null,
      featureErrors: {},
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
      const status = get().bootstrapStatus[resource];
      if (!isCurrent() || status === 'ready' || status === 'error') return;
      set(current => ({
        bootstrapStatus: { ...current.bootstrapStatus, [resource]: 'ready' },
      }));

      if (requiredResources.every(key => get().bootstrapStatus[key] === 'ready')) {
        set({ familyLoading: false, appReady: true, loading: false });
      }
    };

    const handleCriticalListenerError = (resource: BootstrapResource, context: string, error: any) => {
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

    const handleOptionalListenerError = (name: string, resource: BootstrapResource, context: string, error: any) => {
      if (!isCurrent()) return;
      stopFamilyListener(name);
      set(current => ({
        bootstrapStatus: { ...current.bootstrapStatus, [resource]: 'error' },
        featureErrors: { ...current.featureErrors, [name]: errorText(context, error) },
      }));
    };

    const subscribe = (
      resource: BootstrapResource,
      context: string,
      target: any,
      serverRead: (target: any) => Promise<any>,
      applySnapshot: (snapshot: any) => void,
      listenerName: string = resource,
      critical = requiredResources.includes(resource),
      readyOnSnapshot = true,
    ) => {
      const acceptSnapshot = (snapshot: any) => {
        if (!isCurrent()) return;
        applySnapshot(snapshot);
        if (readyOnSnapshot) markReady(resource);
      };
      const unsubscribe = onSnapshot(
        target,
        { includeMetadataChanges: true },
        snapshot => {
          if (!isCurrent()) return;
          if (snapshot.metadata?.fromCache) return;
          acceptSnapshot(snapshot);
        },
        error => {
          logDevError(context, error, { collection: String(target?.type || "query") });
          if (critical) handleCriticalListenerError(resource, context, error);
          else handleOptionalListenerError(listenerName, resource, context, error);
        },
      );
      stopFamilyListener(listenerName);
      familyListeners.set(listenerName, { critical, unsubscribe });
      void serverRead(target)
        .then(snapshot => {
          if (get().bootstrapStatus[resource] !== 'ready') acceptSnapshot(snapshot);
        })
        .catch(error => {
          if (get().bootstrapStatus[resource] !== 'ready') {
            logDevError(context, error, { collection: String(target?.type || "query") });
            if (critical) handleCriticalListenerError(resource, context, error);
            else handleOptionalListenerError(listenerName, resource, context, error);
          }
        });
    };

    const docs = (snapshot: any) => snapshot.docs.map((item: any) => ({ id: item.id, ...item.data() }));
    const subscribePlanned = (
      resource: BootstrapResource,
      context: string,
      applySnapshot: (snapshot: any) => void,
      key = resource,
    ) => {
      const entry = queryPlanEntry(key);
      subscribe(
        resource,
        context,
        entry.target,
        entry.kind === 'document' ? getDocFromServer : getDocsFromServer,
        applySnapshot,
        key,
      );
    };
  
    // Goals reuse the `savings_goals` collection (design §13). Each goal owns
    // nested subcollections (`contributions`, `goal_ledger`, `match_proposals`)
    // that cannot be read with a single top-level bootstrap query. We subscribe
    // to each goal's subcollections and aggregate the results into the three
    // store arrays. These are optional (non-critical) listeners: a goal with no
    // activity simply contributes no rows, and a listener error is surfaced as a
    // feature error rather than blocking bootstrap.
    const GOAL_COLLECTION = 'savings_goals';
    const goalFamilyPath = `families/${familyId}`;
    type GoalSubResource = 'goalContributions' | 'goalLedger' | 'goalMatchProposals';
    const goalSubResources: readonly GoalSubResource[] = [
      'goalContributions',
      'goalLedger',
      'goalMatchProposals',
    ];
    const goalSubBuffers: Record<GoalSubResource, Record<string, any[]>> = {
      goalContributions: {},
      goalLedger: {},
      goalMatchProposals: {},
    };
    const goalSubReady: Record<GoalSubResource, Set<string>> = {
      goalContributions: new Set(),
      goalLedger: new Set(),
      goalMatchProposals: new Set(),
    };
    let activeGoalIds = new Set<string>();
    const flushGoalSubs = () => {
      if (!isCurrent()) return;
      set({
        goalContributions: Object.values(goalSubBuffers.goalContributions).flat(),
        goalLedger: Object.values(goalSubBuffers.goalLedger).flat(),
        goalMatchProposals: Object.values(goalSubBuffers.goalMatchProposals).flat(),
      });
      for (const resource of goalSubResources) {
        if ([...activeGoalIds].every(goalId => goalSubReady[resource].has(goalId))) {
          markReady(resource);
        }
      }
    };
    const subscribeGoalSubcollection = (goalId: string, sub: GoalSubResource, subPath: string) => {
      const target = collection(db, `${goalFamilyPath}/${GOAL_COLLECTION}/${goalId}/${subPath}`);
      const listenerName = `${sub}:${goalId}`;
      const apply = (snapshot: any) => {
        goalSubBuffers[sub][goalId] = docs(snapshot);
        goalSubReady[sub].add(goalId);
        flushGoalSubs();
      };
      subscribe(
        sub,
        `Goal ${sub}`,
        target,
        getDocsFromServer,
        apply,
        listenerName,
        false,
        false,
      );
    };
    const subscribeGoalSubcollections = (goalIds: string[]) => {
      const nextGoalIds = new Set(goalIds);
      for (const previousGoalId of activeGoalIds) {
        if (nextGoalIds.has(previousGoalId)) continue;
        for (const resource of goalSubResources) {
          stopFamilyListener(`${resource}:${previousGoalId}`);
          delete goalSubBuffers[resource][previousGoalId];
          goalSubReady[resource].delete(previousGoalId);
        }
      }
      activeGoalIds = nextGoalIds;
      if (goalIds.length === 0) {
        flushGoalSubs();
        return;
      }
      for (const goalId of goalIds) {
        subscribeGoalSubcollection(goalId, 'goalContributions', 'contributions');
        subscribeGoalSubcollection(goalId, 'goalLedger', 'goal_ledger');
        subscribeGoalSubcollection(goalId, 'goalMatchProposals', 'match_proposals');
      }
    };

    try {
      subscribePlanned('family', 'Family', snapshot => {
        if (!snapshot.exists()) {
          handleCriticalListenerError('family', 'Family', { code: 'not-found', message: 'Family document does not exist' });
          return;
        }
        set({ familyData: { id: snapshot.id, ...snapshot.data() } });
      });

      subscribePlanned('tasks', 'Tasks', snapshot => set({ tasks: docs(snapshot) }));
      subscribePlanned('rewards', 'Rewards', snapshot => set({ rewards: docs(snapshot) }));

      const currentUser = state.currentUser;
      if (currentUser?.role === 'parent' || currentUser?.role === 'owner') {
        subscribePlanned('wallets', 'Wallets', snapshot => set({ childWallets: docs(snapshot) }));
      } else if (currentUser?.role === 'child') {
      subscribePlanned('wallets', 'Wallets', snapshot => {
        set({
          myWallet: snapshot.exists()
            ? { id: snapshot.id, ...snapshot.data() }
            : { id: currentUser.id, balance: 0 },
        });
      });
      } else {
        markReady('wallets');
      }

      subscribePlanned('members', 'Members', snapshot => set({ familyMembers: docs(snapshot) }));
      if (currentUser?.role === 'parent' || currentUser?.role === 'owner') {
        subscribePlanned('joinRequests', 'Join requests', snapshot => set({ joinRequests: docs(snapshot) }));
        subscribePlanned('taskCompletions', 'Task completions', snapshot => set({ taskCompletions: docs(snapshot) }));
        subscribePlanned('redemptions', 'Redemptions', snapshot => set({ redemptions: docs(snapshot) }));
        subscribePlanned('walletTransactions', 'Wallet transactions', snapshot => set({ walletTransactions: normalizeHistory(docs(snapshot)) }));
        subscribePlanned('savingsGoals', 'Savings goals', snapshot => {
          const goals = docs(snapshot);
          set({ savingsGoals: goals });
          subscribeGoalSubcollections(goals.map((goal: any) => goal.id));
        });
        subscribePlanned('goalRequests', 'Goal requests', snapshot => set({ goalRequests: docs(snapshot) }));
        subscribePlanned('transferRequests', 'Transfer requests', snapshot => set({ transferRequests: docs(snapshot) }));
        subscribePlanned('moneyRequests', 'Money requests', snapshot => set({ moneyRequests: docs(snapshot) }));
        subscribePlanned('petboxRequests', 'Pet Box requests', snapshot => set({ petboxRequests: docs(snapshot) }));
        subscribePlanned('profileUpdateRequests', 'Profile update requests', snapshot => set({ profileUpdateRequests: docs(snapshot) }));
        subscribePlanned('reversals', 'Reversals', snapshot => set({ reversals: docs(snapshot) }));
        subscribePlanned('avatarUnlocks', 'Avatar unlocks', snapshot => set({ avatarUnlocks: docs(snapshot) }));
      } else {
        subscribePlanned('taskCompletions', 'Task completions', snapshot => set({ taskCompletions: docs(snapshot) }));
        subscribePlanned('redemptions', 'Redemptions', snapshot => set({ redemptions: docs(snapshot) }));
        subscribePlanned('walletTransactions', 'Wallet transactions', snapshot => set({ walletTransactions: normalizeHistory(docs(snapshot)) }));
        subscribePlanned('savingsGoals', 'Savings goals', snapshot => {
          const goals = docs(snapshot);
          set({ savingsGoals: goals });
          subscribeGoalSubcollections(goals.map((goal: any) => goal.id));
        });
        subscribePlanned('goalRequests', 'Goal requests', snapshot => set({ goalRequests: docs(snapshot) }));
        subscribePlanned('transferRequests', 'Transfer requests', snapshot => set({ transferRequests: docs(snapshot) }));
        subscribePlanned('petboxRequests', 'Pet Box requests', snapshot => set({ petboxRequests: docs(snapshot) }));
        subscribePlanned('profileUpdateRequests', 'Profile update requests', snapshot => set({ profileUpdateRequests: docs(snapshot) }));

        const moneyRequestResults: any[][] = [[], []];
        const moneyRequestReady = [false, false];
        const moneyQueries = [
          queryPlanEntry('moneyRequests:requester'),
          queryPlanEntry('moneyRequests:requestedFrom'),
        ].map(entry => {
          if (entry.kind !== 'query') throw new Error(`${entry.key} must be a query.`);
          return entry.target;
        });
        const acceptMoneySnapshot = (index: number, snapshot: any) => {
          if (!isCurrent()) return;
          moneyRequestResults[index] = docs(snapshot);
          moneyRequestReady[index] = true;
          const merged = new Map<string, any>();
          moneyRequestResults.flat().forEach(item => merged.set(item.id, item));
          set({ moneyRequests: [...merged.values()] });
          if (moneyRequestReady.every(Boolean)) markReady('moneyRequests');
        };
        moneyQueries.forEach((moneyQuery, index) => {
          const unsubscribe = onSnapshot(
            moneyQuery,
            { includeMetadataChanges: true },
            snapshot => {
              if (!snapshot.metadata?.fromCache) acceptMoneySnapshot(index, snapshot);
            },
            error => handleOptionalListenerError(`moneyRequests:${index}`, 'moneyRequests', 'Money requests', error),
          );
          const listenerName = `moneyRequests:${index}`;
          stopFamilyListener(listenerName);
          familyListeners.set(listenerName, { critical: false, unsubscribe });
          void getDocsFromServer(moneyQuery)
            .then(snapshot => {
              if (!moneyRequestReady[index]) acceptMoneySnapshot(index, snapshot);
            })
            .catch(error => {
              if (!moneyRequestReady[index]) handleOptionalListenerError(listenerName, 'moneyRequests', 'Money requests', error);
            });
        });
      }

      subscribePlanned('feed', 'Feed', snapshot => set({ feed: docs(snapshot) }));
      subscribePlanned('behaviourEvents', 'Behaviour events', snapshot => set({ behaviourEvents: normalizeHistory(docs(snapshot)) }));
      subscribePlanned('challenges', 'Challenges', snapshot => set({ challenges: docs(snapshot) }));
      subscribePlanned('funds', 'Funds', snapshot => set({ funds: docs(snapshot) }));
      subscribePlanned('fundTransactions', 'Fund transactions', snapshot => set({ fundTransactions: docs(snapshot) }));

      // Gamification subscriptions: parent/owner reads all family summaries/progress,
      // child reads only own summary and today's progress
      if (currentUser?.role === 'parent' || currentUser?.role === 'owner') {
        subscribePlanned('gamificationSummaries', 'Gamification summaries', snapshot => set({ gamificationSummaries: docs(snapshot) }));
        subscribePlanned('dailyProgress', 'Daily progress', snapshot => set({ dailyProgress: docs(snapshot) }))
      } else {
        // Child: read own summary and filter today's progress client-side
        subscribePlanned('gamificationSummaries', 'Gamification summaries', snapshot => {
          if (snapshot.exists()) {
            set({ myGamificationSummary: { id: snapshot.id, ...snapshot.data() } })
          } else {
            set({ myGamificationSummary: null })
          }
        })
        subscribePlanned('dailyProgress', 'Daily progress', snapshot => {
          // For child, find today's progress from the query results
          // The dayKey format is YYYYMMDD, but we need to match the server format
          // For now, just store all progress and let the adapter filter
          set({ dailyProgress: docs(snapshot) })
        })
      }
    } catch (error: any) {
      handleCriticalListenerError('family', 'Bootstrap', error);
    }
  },

  loadReversals: () => {
    const { activeFamilyId, currentUser } = get();
    if (
      !activeFamilyId ||
      currentUser?.familyId !== activeFamilyId ||
      (currentUser?.role !== 'parent' && currentUser?.role !== 'owner') ||
      familyListeners.has('reversals')
    ) return;

    const generation = familyGeneration;
    const userId = currentUser.id;
    const isCurrent = () =>
      familyGeneration === generation &&
      get().activeFamilyId === activeFamilyId &&
      get().currentUser?.id === userId &&
      get().currentUser?.familyId === activeFamilyId;
    const target = query(
      collection(db, `families/${activeFamilyId}/reversals`),
      orderBy('completedAt', 'desc'),
    );
    set(current => ({ featureErrors: { ...current.featureErrors, reversals: null } }));
    const unsubscribe = onSnapshot(
      target,
      snapshot => {
        if (!isCurrent()) return;
        set({ reversals: snapshot.docs.map(item => ({ id: item.id, ...item.data() })) });
      },
      error => {
        if (!isCurrent()) return;
        stopFamilyListener('reversals');
        set(current => ({
          featureErrors: { ...current.featureErrors, reversals: errorText('Reversals', error) },
        }));
      },
    );
    familyListeners.set('reversals', { critical: false, unsubscribe });
  },

  retryFeature: name => {
    if (name !== 'reversals') return;
    stopFamilyListener(name);
    get().loadReversals();
  },

  retryBootstrap: () => {
    const { currentUser, authUser } = get();
    if (authUser === null) return;
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
      authStatus: 'initializing',
      authInitialized: false,
      authLoading: true,
      profileLoading: false,
      authUser: undefined,
      currentUser: null,
      bootstrapError: null,
      featureErrors: {},
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
      authStatus: 'initializing',
      authInitialized: false,
      authLoading: true,
      profileLoading: false,
      familyLoading: false,
      authUser: undefined,
      currentUser: null,
      ...emptyFamilyState(),
      bootstrapStatus: createBootstrapStatus('idle'),
      bootstrapError: null,
      featureErrors: {},
      error: null,
      activeFamilyId: null,
      appReady: false,
      loading: true,
    });
  },
}));

// Derives the per-goal contributor breakdown from the immutable goal ledger
// (`goalContributions`), NOT from `wallet_transactions`. Groups entries by
// `type` and `ownerId` and sums `amountPence`, mirroring the ContributionType
// taxonomy in goalContracts.ts. Parent and match funds are kept distinct from
// child contributions so the UI can never present them as child wallet money.
export interface GoalContributionGroup {
  type: string;
  ownerId: string | null;
  ownerType: string | null;
  totalPence: number;
  count: number;
}

export function goalContributionBreakdown(contributions: any[]): GoalContributionGroup[] {
  const groups = new Map<string, GoalContributionGroup>();
  for (const entry of contributions ?? []) {
    const type = entry?.type ?? 'unknown';
    const ownerId = entry?.ownerId ?? null;
    const ownerType = entry?.ownerType ?? null;
    const key = `${type}::${ownerId ?? ''}`;
    const amount = typeof entry?.amountPence === 'number' ? entry.amountPence : 0;
    const existing = groups.get(key);
    if (existing) {
      existing.totalPence += amount;
      existing.count += 1;
    } else {
      groups.set(key, { type, ownerId, ownerType, totalPence: amount, count: 1 });
    }
  }
  return [...groups.values()];
}
