import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { rememberPendingInvite as rememberLegacyInvite } from '../lib/inviteLink';
import { capturePendingInvite } from './pendingInviteIntent';
import {
  AuthRoutingGate,
  deriveAuthRouteDecision,
  type AuthRouteDecisionInput,
} from './AuthRoutingGate';

const TOKEN = 'CwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCws';
const TOKEN_B = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc';

const storeState = vi.hoisted(() => ({
  authStatus: 'authenticated' as 'initializing' | 'authenticated' | 'unauthenticated',
  authUser: { uid: 'u1' } as any,
  currentUser: { id: 'u1', familyId: undefined, role: 'parent' } as any,
  familyData: null as any,
  profileServerConfirmed: true,
  appReady: true,
  bootstrapError: null as string | null,
  pendingMembershipStatus: 'none' as 'idle' | 'loading' | 'settling' | 'none' | 'pending' | 'recovery',
  bootstrapAttempt: 0,
  retryBootstrap: vi.fn(),
}));

vi.mock('../store/useStore', () => ({
  useStore: (selector: any) => selector(storeState),
}));

vi.mock('../lib/api', () => ({ signOut: vi.fn(async () => {}) }));

const readyInput: AuthRouteDecisionInput = {
  authStatus: 'authenticated',
  authUser: { uid: 'u1' },
  currentUser: { id: 'u1', familyId: undefined },
  familyLifecycleState: undefined,
  profileServerConfirmed: true,
  appReady: true,
  bootstrapError: null,
  pendingInviteToken: null,
  legacyInviteCode: null,
  pendingMembershipStatus: 'none',
  hasExplicitCreateIntent: false,
  pathname: '/',
  search: '',
};

function CurrentPath() {
  const location = useLocation();
  return <div data-testid="current-path">{location.pathname}{location.search}</div>;
}

function renderGate(path = '/', hasExplicitCreateIntent = false) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthRoutingGate hasExplicitCreateIntent={hasExplicitCreateIntent}>
        <Routes>
          <Route path="*" element={<CurrentPath />} />
        </Routes>
      </AuthRoutingGate>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  storeState.authStatus = 'authenticated';
  storeState.authUser = { uid: 'u1' };
  storeState.currentUser = { id: 'u1', familyId: undefined, role: 'parent' };
  storeState.familyData = null;
  storeState.profileServerConfirmed = true;
  storeState.appReady = true;
  storeState.bootstrapError = null;
  storeState.pendingMembershipStatus = 'none';
  storeState.retryBootstrap.mockClear();
});

describe('deriveAuthRouteDecision', () => {
  it('prioritizes a pending v2 invitation over no-family and explicit creation state', () => {
    expect(deriveAuthRouteDecision({
      ...readyInput,
      pendingInviteToken: TOKEN,
      hasExplicitCreateIntent: true,
      pathname: '/onboarding',
      search: '?mode=create',
    })).toBe('invite');
  });

  it('keeps the current invitation route available before auth bootstrap resolves', () => {
    expect(deriveAuthRouteDecision({
      ...readyInput,
      authStatus: 'initializing',
      authUser: undefined,
      currentUser: null,
      profileServerConfirmed: false,
      appReady: false,
      pathname: `/invite/${TOKEN}`,
    })).toBe('invite');
  });

  it('waits for server-confirmed profile and pending-membership readiness without redirecting', () => {
    expect(deriveAuthRouteDecision({
      ...readyInput,
      profileServerConfirmed: false,
      appReady: false,
    })).toBe('startup');
    expect(deriveAuthRouteDecision({
      ...readyInput,
      appReady: false,
      pendingMembershipStatus: 'loading',
    })).toBe('startup');
    expect(deriveAuthRouteDecision({
      ...readyInput,
      authUser: undefined,
    })).toBe('startup');
    expect(deriveAuthRouteDecision({
      ...readyInput,
      appReady: false,
    })).toBe('startup');
  });

  it('lets active membership outrank a stale create draft', () => {
    expect(deriveAuthRouteDecision({
      ...readyInput,
      currentUser: { id: 'u1', familyId: 'family-1' },
      hasExplicitCreateIntent: true,
      pathname: '/onboarding',
      search: '?mode=create',
    })).toBe('app');
  });

  it('allows only the matching authoritative in-session creation continuation to finish onboarding', () => {
    const activeCreation = {
      ...readyInput,
      currentUser: { id: 'u1', familyId: 'family-1' },
      hasExplicitCreateIntent: false,
      pathname: '/onboarding',
      search: '?mode=create',
    };

    expect(deriveAuthRouteDecision({
      ...activeCreation,
      creationContinuation: { authUid: 'u1', familyId: 'family-1' },
    })).toBe('createOnboarding');
    expect(deriveAuthRouteDecision({
      ...activeCreation,
      creationContinuation: { authUid: 'u1', familyId: 'forged-family' },
    })).toBe('app');
    expect(deriveAuthRouteDecision({
      ...activeCreation,
      creationContinuation: { authUid: 'other-account', familyId: 'family-1' },
    })).toBe('app');
  });

  it('requires canonical active member and family lifecycle before routing to the app', () => {
    for (const lifecycle of [undefined, 'active']) {
      expect(deriveAuthRouteDecision({
        ...readyInput,
        currentUser: { id: 'u1', familyId: 'family-1', lifecycle },
        familyLifecycleState: 'active',
      })).toBe('app');
    }

    for (const lifecycle of ['archived', 'removed', 'inactive', 'deleting', 'recovery']) {
      expect(deriveAuthRouteDecision({
        ...readyInput,
        currentUser: { id: 'u1', familyId: 'family-1', lifecycle },
        familyLifecycleState: 'active',
      })).toBe('pendingMembership');
    }

    for (const familyLifecycleState of ['deleting', 'deleted', 'inactive', 'recovery']) {
      expect(deriveAuthRouteDecision({
        ...readyInput,
        currentUser: { id: 'u1', familyId: 'family-1', lifecycle: 'active' },
        familyLifecycleState,
      })).toBe('pendingMembership');
    }

    expect(deriveAuthRouteDecision({
      ...readyInput,
      currentUser: { id: 'u1', familyId: 'family-1', lifecycle: 'active', status: 'disabled' },
      familyLifecycleState: 'active',
    })).toBe('pendingMembership');
    expect(deriveAuthRouteDecision({
      ...readyInput,
      currentUser: { id: 'u1', familyId: 'family-1', lifecycle: 'active', disabled: true },
      familyLifecycleState: 'active',
    })).toBe('pendingMembership');
  });

  it('routes pending or recovery membership ahead of creation onboarding', () => {
    for (const pendingMembershipStatus of ['pending', 'recovery'] as const) {
      expect(deriveAuthRouteDecision({
        ...readyInput,
        pendingMembershipStatus,
        hasExplicitCreateIntent: true,
        pathname: '/onboarding',
        search: '?mode=create',
      })).toBe('pendingMembership');
    }
  });

  it('routes an authenticated no-family user to the choice despite a stale create intent', () => {
    expect(deriveAuthRouteDecision({
      ...readyInput,
      hasExplicitCreateIntent: true,
      pathname: '/',
    })).toBe('noFamily');
  });

  it('allows creation only for an explicit create route with a UID-bound intent', () => {
    expect(deriveAuthRouteDecision({
      ...readyInput,
      hasExplicitCreateIntent: true,
      pathname: '/onboarding',
      search: '?mode=create',
    })).toBe('createOnboarding');
    expect(deriveAuthRouteDecision({
      ...readyInput,
      pathname: '/onboarding',
      search: '?mode=create',
    })).toBe('noFamily');
  });

  it('sends signed-out root traffic to public onboarding and protected traffic to login', () => {
    const signedOut = {
      ...readyInput,
      authStatus: 'unauthenticated' as const,
      authUser: null,
      currentUser: null,
      profileServerConfirmed: false,
      appReady: true,
    };
    expect(deriveAuthRouteDecision(signedOut)).toBe('publicOnboarding');
    expect(deriveAuthRouteDecision({ ...signedOut, pathname: '/wallet' })).toBe('login');
  });

  it('keeps an auth observer error on recoverable startup instead of signed-out routing', () => {
    expect(deriveAuthRouteDecision({
      ...readyInput,
      authStatus: 'unauthenticated',
      authUser: null,
      currentUser: null,
      profileServerConfirmed: false,
      appReady: false,
      bootstrapError: '[Auth observer] unavailable: try again',
    })).toBe('startup');
  });
});

describe('AuthRoutingGate navigation', () => {
  it('routes an authenticated no-family invite recipient to the invite, never onboarding', () => {
    capturePendingInvite(TOKEN);
    renderGate('/');
    expect(screen.getByTestId('current-path')).toHaveTextContent(`/invite/${TOKEN}`);
    expect(screen.getByTestId('current-path')).not.toHaveTextContent('/onboarding');
  });

  it('keeps the canonical URL token ahead of an older stored v2 token', () => {
    capturePendingInvite(TOKEN_B);
    renderGate(`/invite/${TOKEN}`);
    expect(screen.getByTestId('current-path')).toHaveTextContent(`/invite/${TOKEN}`);
  });

  it('keeps a valid canonical URL token ahead of a stored legacy invite', () => {
    rememberLegacyInvite('ABC123');
    renderGate(`/invite/${TOKEN}`);
    expect(screen.getByTestId('current-path')).toHaveTextContent(`/invite/${TOKEN}`);
  });

  it('keeps a valid legacy URL code ahead of a stored v2 invite', () => {
    capturePendingInvite(TOKEN_B);
    renderGate('/join?code=ABC123');
    expect(screen.getByTestId('current-path')).toHaveTextContent('/join?code=ABC123');
  });

  it('does not redirect an opaque token stored under the legacy key', () => {
    localStorage.setItem('queki.pendingInviteCode', TOKEN);
    renderGate('/');
    expect(screen.getByTestId('current-path')).toHaveTextContent('/no-family');
    expect(screen.getByTestId('current-path')).not.toHaveTextContent('/join');
  });

  it('routes an authenticated no-family user without invite to /no-family', () => {
    renderGate('/');
    expect(screen.getByTestId('current-path')).toHaveTextContent('/no-family');
  });

  it('routes a pending legacy membership to /join/pending without a navigation loop', () => {
    storeState.pendingMembershipStatus = 'pending';
    renderGate('/join/pending');
    expect(screen.getByTestId('current-path')).toHaveTextContent('/join/pending');
  });

  it('holds the startup screen on bootstrap error instead of entering onboarding', () => {
    storeState.profileServerConfirmed = false;
    storeState.appReady = false;
    storeState.bootstrapError = '[Profile] permission-denied: unavailable';
    renderGate('/');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('current-path')).not.toBeInTheDocument();
  });
});
