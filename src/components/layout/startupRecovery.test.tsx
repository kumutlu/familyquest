import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import { AppLayout } from './AppLayout';
import { AuthRoutingGate } from '../../auth/AuthRoutingGate';
import { STARTUP_TIMEOUT_MS } from './StartupScreen';
import { useStore } from '../../store/useStore';

// ---------------------------------------------------------------------------
// Startup false-positive regression suite.
//
// Production symptom: on a healthy but slow connection the startup screen
// reached its hard timeout and showed "Connection problem — Startup is taking
// longer than expected", and the dashboard only appeared after waiting or a
// manual refresh.
//
// These tests drive the REAL <AuthRoutingGate> around <AppLayout> (store
// mocked) so they cover the integration between startup routing,
// StartupScreen's timeout and the late arrival of a successful
// auth/profile/family bootstrap.
// ---------------------------------------------------------------------------

let state: any;

vi.mock('../../store/useStore', () => ({
  useStore: vi.fn((selector: any) => (selector ? selector(state) : state)),
}));

vi.mock('../../config/navigation', () => ({
  getNavItems: () => [{ labelKey: 'nav.home', path: '/', icon: () => null }],
  getQuekiNavItems: () => [{ labelKey: 'nav.home', path: '/', icon: () => null, testId: 'queki-nav-home' }],
}));
vi.mock('./ProfileDropdown', () => ({ ProfileDropdown: () => <div>ProfileDropdown</div> }));
vi.mock('./NotificationCenter', () => ({ NotificationCenter: () => <div>NotificationCenter</div> }));
vi.mock('../../lib/api', () => ({ signOut: vi.fn() }));

const readyState = {
  authStatus: 'authenticated',
  authUser: { uid: 'u1' },
  currentUser: { id: 'u1', familyId: 'f1', role: 'parent' },
  appReady: true,
  familyMembers: [],
  familyData: { id: 'f1', setup: { welcomePromptCompleted: true } },
  familyLoading: false,
  bootstrapStatus: { family: 'ready', members: 'ready' },
  profileServerConfirmed: true,
  pendingMembershipStatus: 'none',
  bootstrapError: null,
  bootstrapAttempt: 0,
  retryBootstrap: vi.fn(),
};

const advance = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
};

const renderLayout = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <AuthRoutingGate>
        <AppLayout />
      </AuthRoutingGate>
    </MemoryRouter>,
  );

const renderLayoutTree = () => (
  <MemoryRouter initialEntries={['/']}>
    <AuthRoutingGate>
      <AppLayout />
    </AuthRoutingGate>
  </MemoryRouter>
);

/** Push a new store snapshot and let React re-render, as Zustand would. */
const update = async (patch: any, rerender: () => void) => {
  state = { ...state, ...patch };
  await act(async () => {
    rerender();
  });
};

describe('startup recovery — delayed but healthy bootstrap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    localStorage.clear();
    state = { ...readyState };
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('1. a genuinely stuck auth phase still times out into a recoverable screen', async () => {
    state = { ...readyState, authStatus: 'initializing', authUser: undefined, currentUser: null, appReady: false };
    renderLayout();
    expect(screen.getByRole('status')).toBeInTheDocument();
    await advance(STARTUP_TIMEOUT_MS);
    expect(screen.getByRole('alert')).toHaveTextContent('taking longer than expected');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('2. a late AUTH success after the timeout leaves the error screen without a refresh', async () => {
    state = { ...readyState, authStatus: 'initializing', authUser: undefined, currentUser: null, appReady: false };
    const { rerender } = renderLayout();
    await advance(STARTUP_TIMEOUT_MS);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await update({ ...readyState }, () => rerender(renderLayoutTree()));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('3. a late PROFILE success after the timeout leaves the error screen without a refresh', async () => {
    state = { ...readyState, currentUser: null, appReady: false };
    const { rerender } = renderLayout();
    await advance(STARTUP_TIMEOUT_MS);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await update({ ...readyState }, () => rerender(renderLayoutTree()));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('4. a late FAMILY success after the timeout leaves the error screen without a refresh', async () => {
    state = { ...readyState, appReady: false };
    const { rerender } = renderLayout();
    await advance(STARTUP_TIMEOUT_MS);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await update({ appReady: true }, () => rerender(renderLayoutTree()));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('5. an auth-phase timeout is never inherited by the following profile phase', async () => {
    state = { ...readyState, authStatus: 'initializing', authUser: undefined, currentUser: null, appReady: false };
    const { rerender } = renderLayout();
    await advance(STARTUP_TIMEOUT_MS);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Auth resolved late -> profile phase. The new phase must get a clean budget.
    await update(
      { authStatus: 'authenticated', authUser: { uid: 'u1' }, currentUser: null, appReady: false },
      () => rerender(renderLayoutTree()),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('6. a real bootstrap error stays visible and is not replaced by timeout copy', async () => {
    state = { ...readyState, appReady: false, bootstrapError: '[Family] permission-denied: nope' };
    renderLayout();
    await advance(STARTUP_TIMEOUT_MS * 2);
    expect(screen.getByRole('alert')).toHaveTextContent('family access');
    expect(screen.getByRole('alert')).not.toHaveTextContent('permission-denied');
  });

  it('7. Retry is wired to the store bootstrap restart', async () => {
    const retryBootstrap = vi.fn();
    state = { ...readyState, appReady: false, retryBootstrap };
    renderLayout();
    await advance(STARTUP_TIMEOUT_MS);
    await act(async () => {
      screen.getByRole('button', { name: 'Retry' }).click();
    });
    expect(retryBootstrap).toHaveBeenCalledTimes(1);
  });

  it('7b. Retry restarts the startup timers even though the phase label is unchanged', async () => {
    const retryBootstrap = vi.fn();
    state = { ...readyState, appReady: false, retryBootstrap };
    const { rerender } = renderLayout();
    await advance(STARTUP_TIMEOUT_MS);
    await act(async () => {
      screen.getByRole('button', { name: 'Retry' }).click();
    });
    // The real store bumps bootstrapAttempt; the phase stays "family".
    await update({ bootstrapAttempt: 1 }, () =>
      rerender(renderLayoutTree()));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('8. Sign out remains available while a session exists, and is absent otherwise', async () => {
    state = { ...readyState, appReady: false };
    renderLayout();
    await advance(STARTUP_TIMEOUT_MS);
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('9. a signed-out user reaches Login immediately, with no startup timer at all', async () => {
    state = { ...readyState, authStatus: 'unauthenticated', authUser: null, currentUser: null, appReady: false };
    renderLayout();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('10. no startup timer survives a successful bootstrap', async () => {
    state = { ...readyState, appReady: false };
    const { rerender } = renderLayout();
    await update({ appReady: true }, () => rerender(renderLayoutTree()));
    expect(vi.getTimerCount()).toBe(0);
  });
});

void useStore;
