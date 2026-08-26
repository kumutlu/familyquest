import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  profileServerConfirmed: true,
  appReady: true,
  bootstrapError: null as string | null,
  pendingMembershipStatus: 'none' as 'idle' | 'loading' | 'none' | 'pending' | 'recovery',
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
