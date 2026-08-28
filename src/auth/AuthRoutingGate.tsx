import { type ReactNode, useEffect } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { signOut } from '../lib/api';
import { readCodeFromSearch, readLegacyInviteCode } from '../lib/inviteLink';
import { markStartupStage } from '../startupDiagnostics';
import { StartupScreen } from '../components/layout/StartupScreen';
import { useStore } from '../store/useStore';
import { readPendingInvite } from './pendingInviteIntent';
import { clearCreateFamilyIntent } from './createFamilyIntent';

export type AuthRouteDecision =
  | 'startup'
  | 'invite'
  | 'app'
  | 'pendingMembership'
  | 'noFamily'
  | 'createOnboarding'
  | 'publicOnboarding'
  | 'login';

export type PendingMembershipStatus = 'idle' | 'loading' | 'settling' | 'none' | 'pending' | 'recovery';

export interface AuthRouteDecisionInput {
  authStatus: 'initializing' | 'authenticated' | 'unauthenticated';
  authUser: { uid?: string } | null | undefined;
  currentUser: {
    id?: string;
    familyId?: string | null;
    lifecycle?: unknown;
    status?: unknown;
    disabled?: unknown;
  } | null;
  familyLifecycleState?: unknown;
  profileServerConfirmed: boolean;
  appReady: boolean;
  bootstrapError: string | null;
  pendingInviteToken: string | null;
  legacyInviteCode: string | null;
  pendingMembershipStatus: PendingMembershipStatus;
  hasExplicitCreateIntent: boolean;
  creationContinuation?: { authUid: string; familyId?: string } | null;
  pathname: string;
  search: string;
}

const CURRENT_V2_INVITE = /^\/invite\/([^/]+)\/?$/;
const CANONICAL_V2_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const LEGACY_INVITE_CODE = /^[A-Z0-9]{6}$/;
const PUBLIC_PASSTHROUGH_PATHS = new Set([
  '/join-family',
  '/privacy',
  '/terms',
  '/account-deletion',
]);

const isCurrentCreateRoute = (pathname: string, search: string) =>
  pathname === '/onboarding' && new URLSearchParams(search).get('mode') === 'create';

const isInviteAuthEntryRoute = (pathname: string) =>
  pathname === '/login' || pathname === '/signup';

const currentV2Token = (pathname: string) => {
  const token = CURRENT_V2_INVITE.exec(pathname)?.[1] ?? '';
  return CANONICAL_V2_TOKEN.test(token) ? token : null;
};

const currentLegacyCode = (pathname: string, search: string) => {
  if (pathname !== '/join') return null;
  const code = readCodeFromSearch(search);
  return LEGACY_INVITE_CODE.test(code) ? code : null;
};

/** A supplied invite-shaped URL owns the journey, even before validation. */
const suppliedInviteJourney = (pathname: string, search: string): boolean =>
  (pathname === '/join' && new URLSearchParams(search).has('code'))
  || pathname === '/invite'
  || pathname.startsWith('/invite/');

const hasActiveMembershipLifecycle = (input: AuthRouteDecisionInput) => {
  const member = input.currentUser;
  if (!member?.familyId) return false;
  if (member.lifecycle !== undefined && member.lifecycle !== 'active') return false;
  if (member.status === 'deleted' || member.status === 'disabled' || member.disabled === true) return false;
  return input.familyLifecycleState === undefined || input.familyLifecycleState === 'active';
};

/** Pure priority table for all auth, invitation, membership, and creation routing. */
export function deriveAuthRouteDecision(input: AuthRouteDecisionInput): AuthRouteDecision {
  const validCurrentV2Invite = currentV2Token(input.pathname) !== null;
  const validCurrentLegacyInvite = currentLegacyCode(input.pathname, input.search) !== null;

  // Recipient routes own preview and terminal error UX even before Firebase Auth
  // resolves. URL and stored invitation intent outrank generic auth routing.
  if (
    suppliedInviteJourney(input.pathname, input.search) ||
    validCurrentV2Invite ||
    validCurrentLegacyInvite ||
    input.pendingInviteToken ||
    input.legacyInviteCode ||
    CURRENT_V2_INVITE.test(input.pathname) ||
    input.pathname === '/join'
  ) {
    return 'invite';
  }

  // Legal and manual child-join surfaces are intentionally public and do not
  // participate in parent-family bootstrap routing.
  if (PUBLIC_PASSTHROUGH_PATHS.has(input.pathname)) return 'app';

  if (input.authStatus === 'initializing') return 'startup';

  // An observer failure can set authStatus to unauthenticated as its fallback.
  // The recorded error is authoritative and must remain recoverable startup,
  // never masquerade as a normal signed-out route decision.
  if (
    input.bootstrapError &&
    (input.authStatus === 'unauthenticated' || input.authUser === null || input.pendingMembershipStatus !== 'recovery')
  ) return 'startup';

  if (input.authStatus === 'unauthenticated' || input.authUser === null) {
    if (input.pathname === '/' || input.pathname === '/onboarding') return 'publicOnboarding';
    return 'login';
  }

  // No authenticated redirect is safe until the server has confirmed the
  // profile. Cached identity can render startup context, but cannot choose a
  // family, no-family, pending-membership, or creation destination.
  if (!input.authUser?.uid || !input.currentUser || !input.profileServerConfirmed) return 'startup';

  if (input.pendingMembershipStatus === 'recovery') return 'pendingMembership';

  if (input.currentUser.familyId) {
    const continuation = input.creationContinuation;
    if (
      isCurrentCreateRoute(input.pathname, input.search) &&
      (
        input.hasExplicitCreateIntent ||
        (
          continuation?.authUid === input.authUser.uid &&
          (continuation.familyId === undefined || continuation.familyId === input.currentUser.familyId)
        )
      )
    ) {
      return 'createOnboarding';
    }
    if (!input.appReady) return 'startup';
    if (!hasActiveMembershipLifecycle(input)) return 'pendingMembership';
    return 'app';
  }

  if (!input.appReady) return 'startup';

  if (
    input.pendingMembershipStatus === 'idle' ||
    input.pendingMembershipStatus === 'loading' ||
    input.pendingMembershipStatus === 'settling'
  ) {
    return 'startup';
  }
  if (input.pendingMembershipStatus === 'pending') {
    return 'pendingMembership';
  }

  // The generic no-family choice outranks stale creation state. Creation is a
  // narrower exception only after the user explicitly requested mode=create
  // and Task 8 supplies a current UID-bound intent.
  if (!input.hasExplicitCreateIntent || !isCurrentCreateRoute(input.pathname, input.search)) {
    return 'noFamily';
  }
  return 'createOnboarding';
}

function startupPhase(input: AuthRouteDecisionInput): 'auth' | 'profile' | 'family' | 'error' {
  if (input.bootstrapError) return 'error';
  if (input.authStatus === 'initializing') return 'auth';
  if (!input.currentUser || !input.profileServerConfirmed) return 'profile';
  return 'family';
}

function requestedInternalPath(pathname: string, search: string): string {
  return `${pathname}${search}`;
}

export interface AuthRoutingGateProps {
  children: ReactNode;
  /** Task 8 supplies true only for a fresh create-family intent bound to authUser.uid. */
  hasExplicitCreateIntent?: boolean;
  /** In-memory continuation created only after this mounted flow receives a successful family response. */
  creationContinuation?: { authUid: string; familyId?: string } | null;
  onCreationJourneyEnded?: () => void;
}

/** Thin navigation wrapper around deriveAuthRouteDecision. */
export function AuthRoutingGate({
  children,
  hasExplicitCreateIntent = false,
  creationContinuation = null,
  onCreationJourneyEnded,
}: AuthRoutingGateProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const authStatus = useStore(state => state.authStatus);
  const authUser = useStore(state => state.authUser);
  const currentUser = useStore(state => state.currentUser);
  const familyData = useStore(state => state.familyData);
  const profileServerConfirmed = useStore(state => state.profileServerConfirmed);
  const appReady = useStore(state => state.appReady);
  const bootstrapError = useStore(state => state.bootstrapError);
  const pendingMembershipStatus = useStore(state => state.pendingMembershipStatus);
  const bootstrapAttempt = useStore(state => state.bootstrapAttempt);
  const retryBootstrap = useStore(state => state.retryBootstrap);

  const pendingInvite = readPendingInvite();
  const legacyInviteCode = readLegacyInviteCode() || null;
  const input: AuthRouteDecisionInput = {
    authStatus: authStatus ?? 'authenticated',
    authUser,
    currentUser,
    familyLifecycleState: familyData?.lifecycleState,
    profileServerConfirmed,
    appReady,
    bootstrapError,
    pendingInviteToken: pendingInvite?.token ?? null,
    legacyInviteCode,
    pendingMembershipStatus: pendingMembershipStatus ?? 'none',
    hasExplicitCreateIntent,
    creationContinuation,
    pathname: location.pathname,
    search: location.search,
  };
  const missingHarnessState = authStatus === undefined;
  const decision = missingHarnessState ? 'app' : deriveAuthRouteDecision(input);

  useEffect(() => {
    if (decision !== 'startup') markStartupStage('ROUTE_RENDERED');
  }, [decision]);

  useEffect(() => {
    if (
      currentUser?.familyId &&
      !isCurrentCreateRoute(location.pathname, location.search) &&
      (hasExplicitCreateIntent || creationContinuation)
    ) {
      clearCreateFamilyIntent();
      onCreationJourneyEnded?.();
    }
  }, [creationContinuation, currentUser?.familyId, hasExplicitCreateIntent, location.pathname, location.search, onCreationJourneyEnded]);

  // Actual store state always supplies authStatus. This passthrough keeps older
  // isolated route harnesses that intentionally mock only initAuth usable.
  if (missingHarnessState) return children;

  if (decision === 'startup') {
    return (
      <StartupScreen
        phase={startupPhase(input)}
        attempt={bootstrapAttempt}
        error={bootstrapError}
        onRetry={retryBootstrap}
        onSignOut={authUser
          ? () => {
              void signOut()
                .then(() => navigate('/login', { replace: true }))
                .catch(() => {});
            }
          : undefined}
      />
    );
  }

  if (decision === 'invite') {
    if (suppliedInviteJourney(location.pathname, location.search)) return children;
    if (currentV2Token(location.pathname)) return children;
    if (currentLegacyCode(location.pathname, location.search)) return children;
    // A pending invitation owns the post-auth destination, but the user must
    // still be able to enter the public email auth routes that carry it there.
    if (
      pendingInvite
      && !isInviteAuthEntryRoute(location.pathname)
      && location.pathname !== `/invite/${pendingInvite.token}`
    ) {
      return <Navigate to={`/invite/${encodeURIComponent(pendingInvite.token)}`} replace />;
    }
    if (legacyInviteCode) {
      return <Navigate to={`/join?code=${encodeURIComponent(legacyInviteCode)}`} replace />;
    }
    return children;
  }

  if (decision === 'pendingMembership') {
    return location.pathname === '/join/pending'
      ? children
      : <Navigate to="/join/pending" replace />;
  }

  if (decision === 'noFamily') {
    return location.pathname === '/no-family'
      ? children
      : <Navigate to="/no-family" replace />;
  }

  if (decision === 'createOnboarding') {
    return isCurrentCreateRoute(location.pathname, location.search)
      ? children
      : <Navigate to="/onboarding?mode=create" replace />;
  }

  if (decision === 'publicOnboarding') {
    return location.pathname === '/onboarding'
      ? children
      : <Navigate to="/onboarding" replace />;
  }

  if (decision === 'login') {
    if (location.pathname === '/login' || location.pathname === '/signup') return children;
    const next = requestedInternalPath(location.pathname, location.search);
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  if (
    currentUser?.familyId &&
    ['/login', '/signup', '/onboarding', '/no-family', '/join/pending'].includes(location.pathname)
  ) {
    return <Navigate to="/" replace />;
  }
  return children;
}
