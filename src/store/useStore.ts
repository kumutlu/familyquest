import { create } from 'zustand';
import {
  collection,
  collectionGroup,
  doc,
  getDocFromServer,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
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
import i18n, { applyDocumentDirection, applyLanguage, resolveProfileLanguage } from '../i18n';
import { recordE2ETimeline } from '../lib/e2eDiagnostics';
import {
  finishStartupResource,
  markStartupStage,
  startStartupResource,
  type OptionalStartupResource,
} from '../startupDiagnostics';

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

const normalizeRedemptions = (items: any[]) => [...items].sort((left, right) => {
  const timeDifference = timestampMillis(right.redeemedAt || right.createdAt)
    - timestampMillis(left.redeemedAt || left.createdAt);
  return timeDifference || String(left.id).localeCompare(String(right.id));
});

const emptyFamilyState = () => ({
  familyData: null,
  familyMembers: [] as any[],
  joinRequests: [] as any[],
  childJoinRequests: [] as any[],
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
  profileServerConfirmed: boolean;
  familyLoading: boolean;
  appReady: boolean;
  loading: boolean;
  bootstrapError: string | null;
  /**
   * Monotonic counter incremented by retryBootstrap(). The startup screen keys
   * its timers off it so a retry restarts the timeout even when the derived
   * startup phase label is unchanged.
   */
  bootstrapAttempt: number;
  featureErrors: Record<string, string | null>;
  bootstrapStatus: Record<BootstrapResource, BootstrapStatus>;
  activeFamilyId: string | null;
  pendingMembershipStatus: 'idle' | 'loading' | 'settling' | 'none' | 'pending' | 'recovery';

  authUser: any | null | undefined;
  currentUser: any | null;
  familyData: any | null;
  familyMembers: any[];
  joinRequests: any[];
  childJoinRequests: any[];
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
  refreshCurrentUser: (uid: string, updatedUser: { familyId: string; role: string }) => void;
  retryBootstrap: () => void;
  loadReversals: () => void;
  retryFeature: (name: string) => void;
  cleanup: () => void;
}

let authUnsubscribe: (() => void) | null = null;
let profileUnsubscribe: (() => void) | null = null;
let pendingMembershipUnsubscribe: (() => void) | null = null;
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

const stopPendingMembershipListener = () => {
  pendingMembershipUnsubscribe?.();
  pendingMembershipUnsubscribe = null;
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

const RETRYABLE_FAMILY_VALIDATION_CODES = new Set([
  'aborted',
  'cancelled',
  'deadline-exceeded',
  'unavailable',
]);

const isRetryableFamilyValidationError = (error: any) =>
  RETRYABLE_FAMILY_VALIDATION_CODES.has(String(error?.code || '').replace(/^firestore\//, ''));

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
export const logAuthTrace = (event: string, detail?: Record<string, unknown>) => {
  if (import.meta.env?.PROD) return;
  // eslint-disable-next-line no-console
  console.info(`[auth-trace] ${new Date().toISOString()} ${event}`, detail ?? {});
};

export const useStore = create<AppState>((set, get) => ({
  authStatus: 'initializing',
  authInitialized: false,
  authLoading: true,
  profileLoading: false,
  profileServerConfirmed: false,
  familyLoading: false,
  appReady: false,
  loading: true,
  bootstrapError: null,
  bootstrapAttempt: 0,
  featureErrors: {},
  bootstrapStatus: createBootstrapStatus('idle'),
  activeFamilyId: null,
  pendingMembershipStatus: 'idle',

  authUser: undefined,
  currentUser: null,
  ...emptyFamilyState(),
  error: null,

  initAuth: () => {
    if (authUnsubscribe) return;
    markStartupStage('AUTH_LISTENER_ATTACHED');
    logAuthTrace('auth-listener-registered');

    authUnsubscribe = onAuthStateChanged(auth, async user => {
      const generation = ++authGeneration;
      stopProfileListener();
      stopPendingMembershipListener();
      stopFamilyListeners();
      logAuthTrace('auth-listener-fired', { signedIn: Boolean(user), generation });
      recordE2ETimeline('auth-listener-fired', { signedIn: Boolean(user), generation });
      markStartupStage('AUTH_RESOLVED');

      if (!user) {
        set({
          authStatus: 'unauthenticated',
          authUser: null,
          authInitialized: true,
          authLoading: false,
          profileLoading: false,
          profileServerConfirmed: false,
          familyLoading: false,
          currentUser: null,
          ...emptyFamilyState(),
          bootstrapStatus: createBootstrapStatus('idle'),
          bootstrapError: null,
          featureErrors: {},
          error: null,
          activeFamilyId: null,
          pendingMembershipStatus: 'idle',
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
        profileServerConfirmed: false,
        familyLoading: false,
        currentUser: null,
        ...emptyFamilyState(),
        bootstrapStatus: createBootstrapStatus('idle'),
        bootstrapError: null,
        featureErrors: {},
        error: null,
        activeFamilyId: null,
        pendingMembershipStatus: 'idle',
        appReady: false,
        loading: true,
      });
      logAuthTrace('auth-status-changed', { authStatus: 'authenticated', uid: user.uid });

      try {
        await user.getIdToken();
        if (generation !== authGeneration || get().authUser?.uid !== user.uid) return;

        const tokenResult = typeof user.getIdTokenResult === 'function'
          ? await user.getIdTokenResult()
          : { claims: {} };
        const claims = tokenResult.claims as Record<string, unknown>;
        const managedChildId =
          claims.managedChild === true && typeof claims.childId === 'string'
            ? claims.childId
            : null;
        const profileId = managedChildId || user.uid;
        const profileReference = doc(db, 'users', profileId);
        markStartupStage('PROFILE_START');
        let profileResolved = false;
        let profileServerConfirmed = false;
        let profileSnapshotRevision = 0;
        let handleProfileSnapshot: (profileSnapshot: any, authoritative?: boolean) => void;

        let pendingMembershipLookupStarted = false;
        let settlementRecoveryLatched = false;
        const resolvePendingMembership = (resolvedProfileId: string) => {
          if (pendingMembershipLookupStarted) return;
          pendingMembershipLookupStarted = true;
          set({ pendingMembershipStatus: 'loading', appReady: false, loading: true });

          let pendingRequestQuery;
          try {
            pendingRequestQuery = query(
              collectionGroup(db, 'join_requests'),
              where('uid', '==', resolvedProfileId),
              where('status', '==', 'pending'),
              limit(1),
            );
          } catch (error: any) {
            pendingMembershipLookupStarted = false;
            set({
              pendingMembershipStatus: 'idle',
              bootstrapError: errorText('PendingMembership', error),
              appReady: false,
              loading: false,
            });
            return;
          }

          let serverConfirmed = false;
          const acceptPendingSnapshot = (snapshot: any) => {
            if (
              generation !== authGeneration ||
              get().authUser?.uid !== user.uid ||
              get().currentUser?.id !== resolvedProfileId ||
              get().currentUser?.familyId
            ) return;
            serverConfirmed = true;
            const hasPendingRequest = snapshot.docs.length > 0;
            if (!hasPendingRequest && get().pendingMembershipStatus === 'pending') {
              set({
                pendingMembershipStatus: 'settling',
                bootstrapError: null,
                appReady: false,
                loading: true,
              });
              void getDocFromServer(profileReference)
                .then(authoritativeProfile => {
                  if (generation !== authGeneration || get().authUser?.uid !== user.uid) return;
                  profileServerConfirmed = true;
                  handleProfileSnapshot(authoritativeProfile, true);
                })
                .catch(error => handlePendingMembershipError(error, true));
              return;
            }
            // A settlement profile read failed after an approved request
            // disappeared. An empty pending-query snapshot is not profile
            // authority, so it must never erase that recovery state.
            if (get().pendingMembershipStatus === 'recovery') return;
            if (!hasPendingRequest && get().pendingMembershipStatus === 'settling') return;
            set({
              pendingMembershipStatus: hasPendingRequest ? 'pending' : 'none',
              bootstrapError: null,
              appReady: true,
              loading: false,
            });
          };
          const handlePendingMembershipError = (error: any, recovery = false) => {
            if (generation !== authGeneration || get().authUser?.uid !== user.uid) return;
            if (recovery) settlementRecoveryLatched = true;
            pendingMembershipLookupStarted = false;
            set({
              pendingMembershipStatus: recovery || settlementRecoveryLatched ? 'recovery' : 'idle',
              bootstrapError: errorText('PendingMembership', error),
              appReady: false,
              loading: false,
            });
          };

          stopPendingMembershipListener();
          pendingMembershipUnsubscribe = onSnapshot(
            pendingRequestQuery,
            { includeMetadataChanges: true },
            snapshot => {
              if (!snapshot.metadata?.fromCache) acceptPendingSnapshot(snapshot);
            },
            handlePendingMembershipError,
          );
          void getDocsFromServer(pendingRequestQuery)
            .then(snapshot => {
              if (!serverConfirmed) acceptPendingSnapshot(snapshot);
            })
            .catch(error => {
              if (!serverConfirmed) handlePendingMembershipError(error);
            });
        };

        handleProfileSnapshot = (profileSnapshot: any, authoritative = !profileSnapshot.metadata?.fromCache) => {
          if (generation !== authGeneration || get().authUser?.uid !== user.uid) return;
          // Once a settlement read has failed, only a new server profile
          // confirmation can release recovery. A cached listener update may be
          // stale relative to the approval and must not replace that authority.
          if (settlementRecoveryLatched && !authoritative) return;
          recordE2ETimeline('profile-listener-result', { exists: profileSnapshot.exists(), fromCache: Boolean(profileSnapshot.metadata?.fromCache) });
          const snapshotRevision = ++profileSnapshotRevision;

          if (!profileSnapshot.exists()) {
            set({
              currentUser: null,
              profileLoading: false,
              profileServerConfirmed: false,
              bootstrapError: '[Profile] not-found: User profile is not available yet',
              appReady: false,
              loading: false,
            });
            return;
          }

          const profile: any = { id: profileSnapshot.id, ...profileSnapshot.data() };
          if (
            managedChildId &&
            (
              profileSnapshot.id !== managedChildId ||
              profile.authUid !== user.uid ||
              profile.familyId !== claims.familyId ||
              profile.role !== 'child' ||
              profile.isManaged !== true
            )
          ) {
            set({
              currentUser: null,
              profileLoading: false,
              profileServerConfirmed: false,
              bootstrapError: '[Profile] managed-child-link-invalid: Managed child identity could not be verified',
              appReady: false,
              loading: false,
            });
            return;
          }
          let familyId: string | null;
          try {
            familyId = validatedFamilyId(profile.familyId);
          } catch (error: any) {
            set({
              currentUser: null,
              profileLoading: false,
              profileServerConfirmed: false,
              bootstrapError: `[Profile] invalid-familyId: ${error.message}`,
              appReady: false,
              loading: false,
            });
            return;
          }

          profileResolved = true;
          const language = resolveProfileLanguage(profile.language);
          const finishProfileHydration = () => {
            if (
              generation !== authGeneration ||
              get().authUser?.uid !== user.uid ||
              snapshotRevision !== profileSnapshotRevision
            ) return;
            const validatedProfile = {
              ...profile,
              language,
              ...(familyId ? { familyId } : { familyId: undefined }),
            };
            const pendingStatus = get().pendingMembershipStatus;
            const preserveSettlementRecovery = pendingStatus === 'recovery' && !authoritative;
            set({
              currentUser: validatedProfile,
              profileLoading: false,
              bootstrapError: preserveSettlementRecovery ? get().bootstrapError : null,
              profileServerConfirmed: authoritative ? true : get().profileServerConfirmed,
            });
            logAuthTrace('profile-request-completed', { hasFamilyId: Boolean(familyId) });

            if (
              managedChildId &&
              validatedProfile.requiresPasswordChange === true
            ) {
              stopFamilyListeners();
              set({
                ...emptyFamilyState(),
                bootstrapStatus: createBootstrapStatus('ready'),
                pendingMembershipStatus: 'none',
                familyLoading: false,
                activeFamilyId: familyId,
                appReady: true,
                loading: false,
              });
              return;
            }

            if (!familyId) {
              stopFamilyListeners();
              if (!profileServerConfirmed) {
                set({
                  ...emptyFamilyState(),
                  bootstrapStatus: createBootstrapStatus('idle'),
                  pendingMembershipStatus: 'idle',
                  familyLoading: false,
                  activeFamilyId: null,
                  appReady: false,
                  loading: true,
                });
                return;
              }
              set({
                ...emptyFamilyState(),
                bootstrapStatus: createBootstrapStatus('idle'),
                familyLoading: false,
                bootstrapError: preserveSettlementRecovery ? get().bootstrapError : null,
                activeFamilyId: null,
                appReady: false,
                loading: true,
              });
              if (get().pendingMembershipStatus === 'settling') {
                set({
                  pendingMembershipStatus: 'none',
                  appReady: true,
                  loading: false,
                });
                return;
              }
              if (get().pendingMembershipStatus === 'recovery') {
                if (!authoritative) return;
                settlementRecoveryLatched = false;
                set({
                  pendingMembershipStatus: 'none',
                  bootstrapError: null,
                  appReady: true,
                  loading: false,
                });
                return;
              }
              resolvePendingMembership(validatedProfile.id);
              return;
            }

            if (!profileServerConfirmed) {
              set({
                pendingMembershipStatus: 'none',
                familyLoading: false,
                appReady: false,
                loading: true,
              });
              return;
            }
            settlementRecoveryLatched = false;
            stopPendingMembershipListener();
            set({ pendingMembershipStatus: 'none' });
            get().loadFamilyData(validatedProfile.id, familyId);
          };

          if (i18n.language === language) {
            applyDocumentDirection(language);
            finishProfileHydration();
          } else {
            void applyLanguage(language).then(finishProfileHydration);
          }
        };

        profileUnsubscribe = onSnapshot(
          profileReference,
          { includeMetadataChanges: true },
          profileSnapshot => {
            if (generation !== authGeneration || get().authUser?.uid !== user.uid) return;
            // Auth fixed `profileId` for this generation before this listener
            // was attached, so a cache hit for this exact document is safe for
            // a fast render. It is provisional only: the server listener/read
            // below remains authoritative and can replace it or surface an
            // auth/permission failure. Generation checks prevent cross-account
            // callbacks after sign-out or account switching.
            if (profileSnapshot.metadata?.fromCache) markStartupStage('PROFILE_CACHE_RESULT');
            else {
              profileServerConfirmed = true;
              recordE2ETimeline('profile-server-confirmed');
              markStartupStage('PROFILE_SERVER_CONFIRMED');
            }
            handleProfileSnapshot(profileSnapshot, !profileSnapshot.metadata?.fromCache);
          },
          error => {
            if (generation !== authGeneration) return;
            profileSnapshotRevision += 1;
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
            profileServerConfirmed = true;
            recordE2ETimeline('profile-server-confirmed', { source: 'getDocFromServer', exists: snapshot.exists() });
            markStartupStage('PROFILE_SERVER_CONFIRMED');
            handleProfileSnapshot(snapshot, true);
          })
          .catch(error => {
            if (generation !== authGeneration || profileServerConfirmed) return;
            profileSnapshotRevision += 1;
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
      pendingMembershipStatus: 'none',
      familyLoading: true,
      appReady: false,
      loading: true,
    });
    logAuthTrace('family-load-started', { familyId, role });
    markStartupStage('FAMILY_START');

    const isCurrent = () =>
      familyGeneration === generation &&
      authGeneration === owningAuthGeneration &&
      get().activeFamilyId === familyId &&
      get().currentUser?.familyId === familyId;

    // Stage 2 (non-critical background load) is installed by the stage-1 block
    // below and invoked only once every critical resource has resolved.
    let startNonCriticalBootstrap: () => void = () => {};
    let backgroundCompleteLogged = false;

    const markReady = (resource: BootstrapResource) => {
      const status = get().bootstrapStatus[resource];
      if (!isCurrent() || status === 'ready' || status === 'error') return;
      set(current => ({
        bootstrapStatus: { ...current.bootstrapStatus, [resource]: 'ready' },
      }));
      const optionalMetric = ({
        members: 'MEMBERS', tasks: 'TASKS', rewards: 'REWARDS', wallets: 'WALLETS',
      } as Partial<Record<BootstrapResource, OptionalStartupResource>>)[resource];
      if (optionalMetric) finishStartupResource(optionalMetric);

      if (requiredResources.every(key => get().bootstrapStatus[key] === 'ready')) {
        logAuthTrace('family-load-completed', { requiredCount: requiredResources.length, role });
        set({ familyLoading: false, appReady: true, loading: false });
        markStartupStage('CRITICAL_BOOTSTRAP_COMPLETE');
        startNonCriticalBootstrap();
      }

      // Dev-only trace point: when the background (stage 2) fan-out finishes.
      if (
        !backgroundCompleteLogged &&
        get().appReady &&
        roleResources.every(key => {
          const value = get().bootstrapStatus[key];
          return value === 'ready' || value === 'error';
        })
      ) {
        backgroundCompleteLogged = true;
        logAuthTrace('family-background-load-completed', { resourceCount: roleResources.length, role });
      }
    };

    const handleCriticalListenerError = (resource: BootstrapResource, context: string, error: any) => {
      if (!isCurrent()) return;
      if (resource === 'family' && isRetryableFamilyValidationError(error)) {
        set(current => ({
          bootstrapStatus: { ...current.bootstrapStatus, [resource]: 'loading' },
          bootstrapError: errorText('FamilyVerificationDelayed', error),
          familyLoading: true,
          appReady: false,
          loading: true,
        }));
        return;
      }
      stopFamilyListeners();
      set(current => ({
        bootstrapStatus: { ...current.bootstrapStatus, [resource]: 'error' },
        bootstrapError: errorText(context, error),
        activeFamilyId: null,
        pendingMembershipStatus: resource === 'family' ? 'recovery' : current.pendingMembershipStatus,
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
      let serverConfirmed = false;
      const acceptSnapshot = (snapshot: any) => {
        if (!isCurrent()) return;
        const authoritative = !snapshot.metadata?.fromCache;
        if (authoritative) {
          serverConfirmed = true;
          if (get().bootstrapError?.startsWith('[FamilyVerificationDelayed]')) {
            set({ bootstrapError: null });
          }
        }
        applySnapshot(snapshot);
        if (readyOnSnapshot && authoritative) markReady(resource);
      };
      const unsubscribe = onSnapshot(
        target,
        { includeMetadataChanges: true },
        snapshot => {
          if (!isCurrent()) return;
          // A cached family document is safe for a fast render only because the
          // profile already fixed the authenticated identity and exact family
          // generation. The server read/listener remains authoritative and may
          // revoke readiness on permission/auth failure below. Optional cached
          // collections stay ignored to avoid presenting stale feature data.
          if (snapshot.metadata?.fromCache && !snapshot.metadata?.hasPendingWrites && !critical) return;
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
          if (!serverConfirmed || get().bootstrapStatus[resource] !== 'ready') acceptSnapshot(snapshot);
        })
        .catch(error => {
          if (!serverConfirmed && (critical || get().bootstrapStatus[resource] !== 'ready')) {
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

    const currentUser = state.currentUser;

    // ------------------------------------------------------------------
    // STAGE 2 — non-critical background load.
    // Installed here, executed only after every critical resource resolved
    // (see markReady). It re-checks isCurrent() so a stale bootstrap (sign
    // out / family switch during stage 1) can never attach listeners.
    // ------------------------------------------------------------------
    let nonCriticalStarted = false;
    startNonCriticalBootstrap = () => {
      if (nonCriticalStarted || !isCurrent()) return;
      nonCriticalStarted = true;
      logAuthTrace('family-background-load-started', { familyId, role });
      try {
        // Dashboard resources hydrate independently after family access has
        // been validated. None of them decides authentication, role, family
        // identity or route access, so none may hold the global shell hostage.
        startStartupResource('TASKS');
        startStartupResource('REWARDS');
        startStartupResource('MEMBERS');
        startStartupResource('WALLETS');
        subscribePlanned('tasks', 'Tasks', snapshot => set({ tasks: docs(snapshot) }));
        subscribePlanned('rewards', 'Rewards', snapshot => set({ rewards: docs(snapshot) }));
        subscribePlanned('members', 'Members', snapshot => set({ familyMembers: docs(snapshot) }));

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

        if (currentUser?.role === 'parent' || currentUser?.role === 'owner') {
          subscribePlanned('joinRequests', 'Join requests', snapshot => set({ joinRequests: docs(snapshot) }));
          subscribePlanned('childJoinRequests', 'Child join requests', snapshot => set({ childJoinRequests: docs(snapshot) }));
          subscribePlanned('taskCompletions', 'Task completions', snapshot => set({ taskCompletions: docs(snapshot) }));
          subscribePlanned('redemptions', 'Redemptions', snapshot => set({ redemptions: normalizeRedemptions(docs(snapshot)) }));
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
          subscribePlanned('redemptions', 'Redemptions', snapshot => set({ redemptions: normalizeRedemptions(docs(snapshot)) }));
          subscribePlanned('walletTransactions', 'Wallet transactions', snapshot => set({ walletTransactions: normalizeHistory(docs(snapshot)) }));
          subscribePlanned('savingsGoals', 'Savings goals', snapshot => {
            const goals = docs(snapshot);
            set({ savingsGoals: goals });
            subscribeGoalSubcollections(goals.map((goal: any) => goal.id));
          });
          subscribePlanned('goalRequests', 'Goal requests', snapshot => set({
            goalRequests: docs(snapshot).sort((a: any, b: any) => {
              const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt || 0).getTime();
              const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt || 0).getTime();
              return timeB - timeA;
            }),
          }));
          subscribePlanned('transferRequests', 'Transfer requests', snapshot => set({ transferRequests: docs(snapshot) }));
          subscribePlanned('petboxRequests', 'Pet Box requests', snapshot => set({ petboxRequests: docs(snapshot) }));
          subscribePlanned('profileUpdateRequests', 'Profile update requests', snapshot => set({ profileUpdateRequests: docs(snapshot) }));
          subscribePlanned('avatarUnlocks', 'Avatar unlocks', snapshot => set({ avatarUnlocks: docs(snapshot) }));

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
        // A background-stage failure must never drag the app back into startup:
        // appReady has already been granted by the critical stage. Surface it as
        // a feature error instead of swallowing it.
        if (!isCurrent()) return;
        logDevError('Background bootstrap', error, {});
        set(current => ({
          featureErrors: { ...current.featureErrors, backgroundBootstrap: errorText('Bootstrap', error) },
        }));
      }
    };

    // ------------------------------------------------------------------
    // STAGE 1 — critical resources only (criticalBootstrapResources).
    // appReady is granted by markReady as soon as these resolve.
    // ------------------------------------------------------------------
    try {
      subscribePlanned('family', 'Family', snapshot => {
        if (snapshot.metadata?.fromCache) markStartupStage('FAMILY_CACHE_RESULT');
        else markStartupStage('FAMILY_SERVER_CONFIRMED');
        if (!snapshot.exists() && snapshot.metadata?.fromCache) return;
        if (!snapshot.exists()) {
          handleCriticalListenerError('family', 'Family', { code: 'not-found', message: 'Family document does not exist' });
          return;
        }
        set({ familyData: { id: snapshot.id, ...snapshot.data() } });
      });

    } catch (error: any) {
      handleCriticalListenerError('family', 'Bootstrap', error);
    }
  },

  /**
   * Refreshes the current user in the store after an onboarding update.
   * This is called after the atomic family/owner bootstrap to immediately
   * publish the authoritative familyId and role while the profile listener
   * independently converges on the same Firestore document.
   */
  refreshCurrentUser: (uid, updatedUser) => {
    const state = get();

    // Authoritative identity for the signed-in session. Callers may pass a
    // denormalised value (or nothing at all); we never let that decide whether
    // the family state is applied. Only an explicit mismatch with the
    // authenticated session is ignored — a late refresh for a user who has
    // since signed out or switched accounts.
    const authoritativeUid = state.authUser?.uid ?? state.currentUser?.id ?? uid;
    if (!authoritativeUid) return;
    if (uid && uid !== authoritativeUid && uid !== state.currentUser?.id) return;

    // Update the currentUser with the authoritative familyId and role.
    set(current => ({
      currentUser: current.currentUser
        ? { ...current.currentUser, familyId: updatedUser.familyId, role: updatedUser.role }
        : { id: authoritativeUid, familyId: updatedUser.familyId, role: updatedUser.role },
    }));

    // Now load the family data since we have a familyId
    get().loadFamilyData(authoritativeUid, updatedUser.familyId);
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
      // A retry must genuinely restart the family bootstrap. Previously we
      // called loadFamilyData() directly, but it short-circuits when the family
      // is already active with attached listeners — exactly the stuck/slow state
      // in which Retry is offered — so the button was a no-op and users had to
      // reload the page. Tear the listeners down and clear activeFamilyId so the
      // guard cannot swallow the retry.
      stopFamilyListeners();
      set(current => ({
        bootstrapError: null,
        featureErrors: {},
        activeFamilyId: null,
        familyLoading: true,
        appReady: false,
        loading: true,
        bootstrapAttempt: current.bootstrapAttempt + 1,
      }));
      get().loadFamilyData(currentUser.id, currentUser.familyId);
      return;
    }

    authGeneration += 1;
    stopProfileListener();
    stopPendingMembershipListener();
    stopFamilyListeners();
    authUnsubscribe?.();
    authUnsubscribe = null;
    set(current => ({
      authStatus: 'initializing' as const,
      authInitialized: false,
      authLoading: true,
      profileLoading: false,
      authUser: undefined,
      currentUser: null,
      pendingMembershipStatus: 'idle',
      bootstrapError: null,
      featureErrors: {},
      appReady: false,
      loading: true,
      bootstrapAttempt: current.bootstrapAttempt + 1,
    }));
    get().initAuth();
  },

  cleanup: () => {
    authGeneration += 1;
    stopProfileListener();
    stopPendingMembershipListener();
    stopFamilyListeners();
    authUnsubscribe?.();
    authUnsubscribe = null;
    set({
      authStatus: 'initializing',
      authInitialized: false,
      authLoading: true,
      profileLoading: false,
      profileServerConfirmed: false,
      familyLoading: false,
      authUser: undefined,
      currentUser: null,
      ...emptyFamilyState(),
      bootstrapStatus: createBootstrapStatus('idle'),
      bootstrapError: null,
      featureErrors: {},
      error: null,
      activeFamilyId: null,
      pendingMembershipStatus: 'idle',
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
