import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import i18n from '../../i18n/config';
import { AppLayout } from './AppLayout';
import { useStore } from '../../store/useStore';

// --- Mocks ---------------------------------------------------------------

const mockStoreState = {
  authStatus: 'authenticated',
  authUser: { uid: 'u1' },
  currentUser: { id: 'u1', familyId: 'f1', role: 'parent' },
  appReady: true,
  familyMembers: [],
  familyData: { id: 'f1', setup: { welcomePromptCompleted: true } },
  familyLoading: false,
  bootstrapStatus: { family: 'ready', members: 'ready' },
  bootstrapError: null,
  retryBootstrap: vi.fn(),
};

vi.mock('../../store/useStore', () => ({
  useStore: vi.fn((selector: any) => (selector ? selector(mockStoreState) : mockStoreState)),
}));

vi.mock('../../config/navigation', () => ({
  getNavItems: () => [
    { labelKey: 'nav.home', path: '/', icon: () => null },
    { labelKey: 'nav.tasks', path: '/tasks', icon: () => null },
    { labelKey: 'nav.rewards', path: '/rewards', icon: () => null },
  ],
  getQuekiNavItems: () => [
    { labelKey: 'nav.home', path: '/', icon: () => null, testId: 'queki-nav-home' },
    { labelKey: 'nav.tasks', path: '/tasks', icon: () => null, testId: 'queki-nav-quests' },
    { labelKey: 'nav.rewards', path: '/rewards', icon: () => null, testId: 'queki-nav-rewards' },
    { labelKey: 'nav.family', path: '/family', icon: () => null, testId: 'queki-nav-family' },
  ],
}));

vi.mock('./ProfileDropdown', () => ({ ProfileDropdown: () => <div>ProfileDropdown</div> }));
vi.mock('./NotificationCenter', () => ({ NotificationCenter: () => <div>NotificationCenter</div> }));

// Capture programmatic navigation so we can assert the startup/recovery
// sign-out lands on /login.
const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// Sign-out is the only api import AppLayout uses here.
const { mockApiSignOut } = vi.hoisted(() => ({ mockApiSignOut: vi.fn(async () => {}) }));
vi.mock('../../lib/api', () => ({ signOut: mockApiSignOut }));

// --- Harnesses -----------------------------------------------------------

// AppLayout owns "/", with a few nested protected routes. Top-level
// "/onboarding" and "/login" stand in for the real public routes so we can
// assert where an unauthenticated visitor is sent.
function renderAt(path: string, storeState: any = {}) {
  const state = { ...mockStoreState, ...storeState };
  (useStore as any).mockImplementation((selector: any) => (selector ? selector(state) : state));
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<div>DASHBOARD</div>} />
          <Route path="wallet" element={<div>WALLET</div>} />
          <Route path="goals" element={<div>GOALS</div>} />
        </Route>
        <Route path="/onboarding" element={<div>ONBOARDING FRONT DOOR</div>} />
        <Route path="/login" element={<div>LOGIN PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

// Harness for exercising AppLayout's own /onboarding guard (AppLayout is the
// element rendered at /onboarding via a nested route, mirroring the legacy
// nested-route shape used by the existing guard test).
function renderAppLayoutAt(path: string, storeState: any = {}) {
  const state = { ...mockStoreState, ...storeState };
  (useStore as any).mockImplementation((selector: any) => (selector ? selector(state) : state));
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<div>DASHBOARD</div>} />
          <Route path="onboarding" element={<div>NESTED ONBOARDING</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const signedOut = {
  authStatus: 'unauthenticated',
  authUser: null,
  currentUser: null,
  appReady: true,
};

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('en');
});

// --- Entry routing -------------------------------------------------------

describe('AppLayout — unauthenticated entry routing', () => {
  it('sends a clean signed-out visitor from / to /onboarding (Refined Queki front door)', () => {
    renderAt('/', signedOut);
    expect(screen.getByText('ONBOARDING FRONT DOOR')).toBeInTheDocument();
    expect(screen.queryByText('DASHBOARD')).not.toBeInTheDocument();
  });

  it('sends a signed-out visitor on a protected deep link (/wallet) to /login, NOT onboarding', () => {
    renderAt('/wallet', signedOut);
    expect(screen.getByText('LOGIN PAGE')).toBeInTheDocument();
    expect(screen.queryByText('ONBOARDING FRONT DOOR')).not.toBeInTheDocument();
    expect(screen.queryByText('WALLET')).not.toBeInTheDocument();
  });

  it('sends a signed-out visitor on another protected deep link (/goals) to /login', () => {
    renderAt('/goals', signedOut);
    expect(screen.getByText('LOGIN PAGE')).toBeInTheDocument();
    expect(screen.queryByText('GOALS')).not.toBeInTheDocument();
  });

  it('does NOT globally redirect every unauthenticated route to onboarding', () => {
    // Only the bare root becomes the onboarding front door; everything else
    // (here /wallet) must go to /login.
    renderAt('/wallet', signedOut);
    expect(screen.queryByText('ONBOARDING FRONT DOOR')).not.toBeInTheDocument();
  });
});

describe('AppLayout — auth initialization', () => {
  it('keeps the startup/bootstrap UI while auth is initializing at / (no premature redirect)', () => {
    renderAt('/', {
      authStatus: 'initializing',
      authUser: undefined,
      currentUser: null,
      appReady: false,
    });
    // Startup screen is shown, not onboarding and not login.
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('ONBOARDING FRONT DOOR')).not.toBeInTheDocument();
    expect(screen.queryByText('LOGIN PAGE')).not.toBeInTheDocument();
  });
});

describe('AppLayout — authenticated guards (must remain unchanged)', () => {
  it('established parent with family lands on the dashboard at /', () => {
    renderAt('/', {
      authStatus: 'authenticated',
      authUser: { uid: 'owner-1' },
      currentUser: { id: 'owner-1', familyId: 'family-x', role: 'owner' },
    });
    expect(screen.getByText('DASHBOARD')).toBeInTheDocument();
  });

  it('established parent with family is redirected out of /onboarding to the app', () => {
    renderAppLayoutAt('/onboarding', {
      authStatus: 'authenticated',
      authUser: { uid: 'owner-1' },
      currentUser: { id: 'owner-1', familyId: 'family-x', role: 'owner' },
    });
    expect(screen.queryByText('NESTED ONBOARDING')).not.toBeInTheDocument();
    expect(screen.getByText('DASHBOARD')).toBeInTheDocument();
  });

  it('parent without family is sent into onboarding/setup from /', () => {
    renderAt('/', {
      authStatus: 'authenticated',
      authUser: { uid: 'parent-1' },
      currentUser: { id: 'parent-1', familyId: null, role: 'parent' },
    });
    expect(screen.getByText('ONBOARDING FRONT DOOR')).toBeInTheDocument();
    expect(screen.queryByText('DASHBOARD')).not.toBeInTheDocument();
  });

  it('managed child visiting /onboarding is redirected to the child app, never parent onboarding', () => {
    renderAppLayoutAt('/onboarding', {
      authStatus: 'authenticated',
      authUser: { uid: 'child-1' },
      currentUser: { id: 'child-1', familyId: 'family-x', role: 'child', isManaged: true },
    });
    expect(screen.queryByText('NESTED ONBOARDING')).not.toBeInTheDocument();
    expect(screen.getByText('DASHBOARD')).toBeInTheDocument();
  });
});

describe('AppLayout — sign-out companion fix', () => {
  it('navigates to /login (replace) after sign-out from the startup/recovery screen', async () => {
    const user = userEvent.setup();
    // Authenticated session that hit a bootstrap error → StartupScreen with a
    // sign-out affordance (onSignOut is provided because authUser exists).
    renderAt('/', {
      authStatus: 'authenticated',
      authUser: { uid: 'u1' },
      currentUser: { id: 'u1', familyId: 'f1', role: 'parent' },
      appReady: false,
      bootstrapError: '[Family] permission-denied: nope',
    });

    const signOutButton = await screen.findByRole('button', { name: /sign out/i });
    await user.click(signOutButton);

    await waitFor(() => expect(mockApiSignOut).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true }));
  });
});
