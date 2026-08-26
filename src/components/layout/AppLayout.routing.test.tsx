import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import i18n from '../../i18n/config';
import { AppLayout } from './AppLayout';
import { useStore } from '../../store/useStore';
import { AuthRoutingGate } from '../../auth/AuthRoutingGate';

// --- Mocks ---------------------------------------------------------------

const mockStoreState = {
  authStatus: 'authenticated',
  authUser: { uid: 'u1' },
  currentUser: { id: 'u1', familyId: 'f1', role: 'parent' },
  profileServerConfirmed: true,
  appReady: true,
  familyMembers: [],
  familyData: { id: 'f1', lifecycleState: 'active', setup: { welcomePromptCompleted: true } },
  familyLoading: false,
  bootstrapStatus: { family: 'ready', members: 'ready' },
  bootstrapError: null,
  pendingMembershipStatus: 'none',
  bootstrapAttempt: 0,
  retryBootstrap: vi.fn(),
};
let activeStoreState: any = mockStoreState;

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
vi.mock('../challenges/ChildChallengeCelebration', () => ({ ChildChallengeCelebration: () => null }));
vi.mock('../bug-report/BugReportSheet', () => ({ BugReportSheet: () => null }));

// Sign-out is the only API action exercised by the global routing gate here.
const { mockApiSignOut } = vi.hoisted(() => ({ mockApiSignOut: vi.fn(async () => {}) }));
vi.mock('../../lib/api', () => ({ signOut: mockApiSignOut }));
vi.mock('../../lib/firebase', () => ({ auth: {}, db: {} }));
vi.mock('../../lib/childLoginApi', () => ({
  completeChildPasswordChange: vi.fn(async () => {}),
  mapChildLoginError: () => 'Unable to update password.',
  validatePasswordClient: () => null,
}));

// --- Harnesses -----------------------------------------------------------

// AuthRoutingGate owns entry routing around the real AppLayout shell.
function renderAt(path: string, storeState: any = {}) {
  const state = { ...mockStoreState, ...storeState };
  activeStoreState = state;
  (useStore as any).mockImplementation((selector: any) => (selector ? selector(state) : state));
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthRoutingGate>
        <Routes>
          <Route path="/" element={<AppLayout />}>
            <Route index element={<div>DASHBOARD</div>} />
            <Route path="wallet" element={<div>WALLET</div>} />
            <Route path="goals" element={<div>GOALS</div>} />
          </Route>
          <Route path="/onboarding" element={<div>ONBOARDING FRONT DOOR</div>} />
          <Route path="/login" element={<div>LOGIN PAGE</div>} />
          <Route path="/no-family" element={<div>NO FAMILY CHOICE</div>} />
          <Route path="/join/pending" element={<div>PENDING MEMBERSHIP</div>} />
        </Routes>
      </AuthRoutingGate>
    </MemoryRouter>,
  );
}

function renderAppLayoutAt(path: string, storeState: any = {}) {
  return renderAt(path, storeState);
}

const signedOut = {
  authStatus: 'unauthenticated',
  authUser: null,
  currentUser: null,
  profileServerConfirmed: false,
  appReady: true,
};

beforeEach(async () => {
  vi.clearAllMocks();
  mockApiSignOut.mockImplementation(async () => {
    activeStoreState.authStatus = 'unauthenticated';
    activeStoreState.authUser = null;
    activeStoreState.currentUser = null;
    activeStoreState.profileServerConfirmed = false;
    activeStoreState.appReady = true;
    activeStoreState.bootstrapError = null;
  });
  await i18n.changeLanguage('en');
});

// --- Entry routing -------------------------------------------------------

describe('AuthRoutingGate around AppLayout — unauthenticated entry routing', () => {
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

describe('AuthRoutingGate around AppLayout — auth initialization', () => {
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

describe('AuthRoutingGate around AppLayout — authenticated guards', () => {
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
    expect(screen.queryByText('ONBOARDING FRONT DOOR')).not.toBeInTheDocument();
    expect(screen.getByText('DASHBOARD')).toBeInTheDocument();
  });

  it('parent without family is sent to the explicit create-or-join choice from /', () => {
    renderAt('/', {
      authStatus: 'authenticated',
      authUser: { uid: 'parent-1' },
      currentUser: { id: 'parent-1', familyId: null, role: 'parent' },
    });
    expect(screen.getByText('NO FAMILY CHOICE')).toBeInTheDocument();
    expect(screen.queryByText('ONBOARDING FRONT DOOR')).not.toBeInTheDocument();
    expect(screen.queryByText('DASHBOARD')).not.toBeInTheDocument();
  });

  it('managed child visiting /onboarding is redirected to the child app, never parent onboarding', () => {
    renderAppLayoutAt('/onboarding', {
      authStatus: 'authenticated',
      authUser: { uid: 'child-1' },
      currentUser: { id: 'child-1', familyId: 'family-x', role: 'child', isManaged: true },
    });
    expect(screen.queryByText('ONBOARDING FRONT DOOR')).not.toBeInTheDocument();
    expect(screen.getByText('DASHBOARD')).toBeInTheDocument();
  });
});

describe('AuthRoutingGate around AppLayout — sign-out recovery', () => {
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
    await waitFor(() => expect(screen.getByText('LOGIN PAGE')).toBeInTheDocument());
  });
});
