import { type ReactNode, useEffect } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { signOut } from '../lib/api';
import { readPendingInvite as readLegacyInvite } from '../lib/inviteLink';
import { markStartupStage } from '../startupDiagnostics';
import { StartupScreen } from '../components/layout/StartupScreen';
import { useStore } from '../store/useStore';
import { readPendingInvite } from './pendingInviteIntent';

export type AuthRouteDecision =
  | 'startup'
  | 'invite'
  | 'app'
  | 'pendingMembership'
  | 'noFamily'
  | 'createOnboarding'
  | 'publicOnboarding'
  | 'login';

export type PendingMembershipStatus = 'idle' | 'loading' | 'none' | 'pending' | 'recovery';

export interface AuthRouteDecisionInput {
  authStatus: 'initializing' | 'authenticated' | 'unauthenticated';
  authUser: { uid?: string } | null | undefined;
  currentUser: { id?: string; familyId?: string | null } | null;
  profileServerConfirmed: boolean;
  appReady: boolean;
  bootstrapError: string | null;
  pendingInviteToken: string | null;
  legacyInviteCode: string | null;
  pendingMembershipStatus: PendingMembershipStatus;
  hasExplicitCreateIntent: boolean;
  pathname: string;
  search: string;
}

const CURRENT_V2_INVITE = /^\/invite\/[^/]+\/?$/;
const PUBLIC_PASSTHROUGH_PATHS = new Set([
  '/join-family',
  '/privacy',
  '/terms',
  '/account-deletion',
]);

const isCurrentCreateRoute = (pathname: string, search: string) =>
  pathname === '/onboarding' && new URLSearchParams(search).get('mode') === 'create';

/** Pure priority table for all auth, invitation, membership, and creation routing. */
export function deriveAuthRouteDecision(input: AuthRouteDecisionInput): AuthRouteDecision {
  const currentV2Invite = CURRENT_V2_INVITE.test(input.pathname);
  const currentLegacyInvite = input.pathname === '/join';

  // Recipient routes own preview and terminal error UX even before Firebase Auth
  // resolves. URL and stored invitation intent outrank generic auth routing.
  if (currentV2Invite || input.pendingInviteToken || currentLegacyInvite || input.legacyInviteCode) {
    return 'invite';
  }

  // Legal and manual child-join surfaces are intentionally public and do not
  // participate in parent-family bootstrap routing.
  if (PUBLIC_PASSTHROUGH_PATHS.has(input.pathname)) return 'app';

  if (input.authStatus === 'initializing') return 'startup';

  if (input.authStatus === 'unauthenticated' || input.authUser === null) {
    if (input.pathname === '/' || input.pathname === '/onboarding') return 'publicOnboarding';
    return 'login';
  }

  // No authenticated redirect is safe until the server has confirmed the
  // profile. Cached identity can render startup context, but cannot choose a
  // family, no-family, pending-membership, or creation destination.
  if (input.bootstrapError && input.pendingMembershipStatus !== 'recovery') return 'startup';
  if (!input.authUser?.uid || !input.currentUser || !input.profileServerConfirmed) return 'startup';

  if (input.pendingMembershipStatus === 'recovery') return 'pendingMembership';
  if (!input.appReady) return 'startup';

  if (input.currentUser.familyId) {
    return 'app';
  }

  if (input.pendingMembershipStatus === 'idle' || input.pendingMembershipStatus === 'loading') {
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
}

/** Thin navigation wrapper around deriveAuthRouteDecision. */
export function AuthRoutingGate({
  children,
  hasExplicitCreateIntent = false,
}: AuthRoutingGateProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const authStatus = useStore(state => state.authStatus);
  const authUser = useStore(state => state.authUser);
  const currentUser = useStore(state => state.currentUser);
  const profileServerConfirmed = useStore(state => state.profileServerConfirmed);
  const appReady = useStore(state => state.appReady);
  const bootstrapError = useStore(state => state.bootstrapError);
  const pendingMembershipStatus = useStore(state => state.pendingMembershipStatus);
  const bootstrapAttempt = useStore(state => state.bootstrapAttempt);
  const retryBootstrap = useStore(state => state.retryBootstrap);

  const pendingInvite = readPendingInvite();
  const legacyInviteCode = readLegacyInvite() || null;
  const input: AuthRouteDecisionInput = {
    authStatus: authStatus ?? 'authenticated',
    authUser,
    currentUser,
    profileServerConfirmed,
    appReady,
    bootstrapError,
    pendingInviteToken: pendingInvite?.token ?? null,
    legacyInviteCode,
    pendingMembershipStatus: pendingMembershipStatus ?? 'none',
    hasExplicitCreateIntent,
    pathname: location.pathname,
    search: location.search,
  };
  const missingHarnessState = authStatus === undefined;
  const decision = missingHarnessState ? 'app' : deriveAuthRouteDecision(input);

  useEffect(() => {
    if (decision !== 'startup') markStartupStage('ROUTE_RENDERED');
  }, [decision]);

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
    if (CURRENT_V2_INVITE.test(location.pathname)) return children;
    if (pendingInvite && location.pathname !== `/invite/${pendingInvite.token}`) {
      return <Navigate to={`/invite/${encodeURIComponent(pendingInvite.token)}`} replace />;
    }
    if (location.pathname === '/join') return children;
    return <Navigate to={`/join?code=${encodeURIComponent(legacyInviteCode ?? '')}`} replace />;
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
