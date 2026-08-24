import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { AppLayout } from './AppLayout';
import { useStore } from '../../store/useStore';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import i18n from '../../i18n/config';

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
  useStore: vi.fn((selector: any) => selector ? selector(mockStoreState) : mockStoreState),
}));

vi.mock('../../config/navigation', () => ({
  getNavItems: () => [
    { labelKey: 'nav.home', path: '/', icon: () => null },
    { labelKey: 'nav.tasks', path: '/tasks', icon: () => null },
    { labelKey: 'nav.rewards', path: '/rewards', icon: () => null },
    { labelKey: 'nav.family', path: '/family', icon: () => null },
  ],
  getQuekiNavItems: () => [
    { labelKey: 'nav.home', path: '/', icon: () => null, testId: 'queki-nav-home' },
    { labelKey: 'nav.tasks', path: '/tasks', icon: () => null, testId: 'queki-nav-quests' },
    { labelKey: 'nav.rewards', path: '/rewards', icon: () => null, testId: 'queki-nav-rewards' },
    { labelKey: 'nav.family', path: '/family', icon: () => null, testId: 'queki-nav-family' },
  ],
}));

vi.mock('./ProfileDropdown', () => ({
  ProfileDropdown: () => <div>ProfileDropdown</div>,
}));

vi.mock('./NotificationCenter', () => ({
  NotificationCenter: () => <div>NotificationCenter</div>,
}));

describe('AppLayout — mobile bottom navigation layout', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const renderAppLayout = (storeState: any = {}) => {
    const state = { ...mockStoreState, ...storeState };
    (useStore as any).mockImplementation((selector: any) => selector ? selector(state) : state);
    return render(
      <MemoryRouter initialEntries={['/']}>
        <AppLayout />
      </MemoryRouter>
    );
  };

  it('renders exactly one mobile bottom navigation, anchored to the viewport', () => {
    const { container } = renderAppLayout();
    const navs = screen.getAllByTestId('queki-bottom-nav');
    expect(navs).toHaveLength(1);
    const nav = navs[0];
    // Anchored to the viewport bottom, not to page content.
    expect(nav.className).toMatch(/\bfixed\b/);
    expect(nav.className).toMatch(/bottom-0/);
    expect(nav.className).toMatch(/inset-x-0/);
    // Safe area handled via the env() padding utility class.
    expect(nav.className).toMatch(/pb-\[env\(safe-area-inset-bottom\)\]/);
    expect(nav.style.position).toBe('fixed');
    // Must be the last child of the layout root — never nested inside the
    // scrolling/transformable main content area. (The composer sheet portals
    // to body only when opened, so it never breaks this invariant.)
    const root = container.querySelector('div.min-h-dvh')!;
    expect(root.lastElementChild).toBe(nav);
    expect(container.querySelector('main')!.contains(nav)).toBe(false);
  });

  it('keeps the desktop header simple with Home, Tasks, Rewards, Family and More only', () => {
    renderAppLayout();
    const desktopNav = screen.getByTestId('desktop-primary-navigation');
    expect(desktopNav).toHaveTextContent('HomeTasksRewardsFamilyMore');
    expect(desktopNav).not.toHaveTextContent('Goals');
    expect(desktopNav).not.toHaveTextContent('Wallets');
    expect(desktopNav).not.toHaveTextContent('Pet Box');
    expect(screen.getByTestId('desktop-more-menu-button')).toHaveAccessibleName('More');
  });

  it('keeps a labelled More affordance in the mobile header without changing bottom-nav items', () => {
    renderAppLayout();
    expect(screen.getByTestId('mobile-more-menu-button')).toHaveTextContent('More');
    expect(screen.getByTestId('queki-bottom-nav')).not.toHaveTextContent('More');
    expect(screen.getByTestId('queki-bottom-nav')).not.toHaveTextContent('Goals');
  });

  it('uses min-h-dvh (dynamic viewport) instead of min-h-screen (100vh)', () => {
    const { container } = renderAppLayout();
    const outerDiv = container.querySelector('div.min-h-dvh');
    expect(outerDiv).toBeInTheDocument();
    // Ensure min-h-screen is NOT used (which would be 100vh on mobile)
    expect(container.querySelector('div.min-h-screen')).not.toBeInTheDocument();
  });

  it('main reserves space for the taller Queki v2 nav via safe-area padding', () => {
    const { container } = renderAppLayout();
    const main = container.querySelector('main');
    expect(main).toBeInTheDocument();
    // Clears the overhanging centre Action button plus the safe area.
    expect(main?.className).toMatch(/pb-\[calc\(6rem\+env\(safe-area-inset-bottom\)\)\]/);
  });

  it('bottom nav has valid safe-area padding (not pb-safe)', () => {
    renderAppLayout();
    const nav = screen.getByTestId('queki-bottom-nav');
    expect(nav.className).toMatch(/pb-\[env\(safe-area-inset-bottom\)\]/);
    expect(nav.className).not.toMatch(/pb-safe/);
  });

  it('bottom nav is fixed to viewport bottom on mobile', () => {
    const { container } = renderAppLayout();
    const nav = container.querySelector('nav.md\\:hidden');
    expect(nav?.className).toMatch(/fixed/);
    expect(nav?.className).toMatch(/bottom-0/);
  });

  it('updates every mounted navigation label without remounting AppLayout', async () => {
    await act(async () => { await i18n.changeLanguage('en'); });
    renderAppLayout();
    expect(screen.getAllByText('Home').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Tasks').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Rewards').length).toBeGreaterThanOrEqual(2);

    await act(async () => { await i18n.changeLanguage('tr'); });

    expect(screen.getAllByText('Ana Sayfa').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Görevler').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Ödüller').length).toBeGreaterThanOrEqual(2);
    await act(async () => { await i18n.changeLanguage('en'); });
  });

  it('does not mount the first-child prompt globally outside Home', () => {
    renderAppLayout({
      currentUser: { id: 'u1', uid: 'u1', familyId: 'f1', role: 'owner' },
      familyData: { id: 'f1' },
      familyMembers: [],
    });
    expect(screen.queryByRole('dialog', { name: 'Set up your family' })).not.toBeInTheDocument();
  });
});

describe('AppLayout — global startup gate', () => {
  const renderWith = (storeState: any, path = '/') => {
    const state = { ...mockStoreState, ...storeState };
    (useStore as any).mockImplementation((selector: any) => (selector ? selector(state) : state));
    return render(
      <MemoryRouter initialEntries={[path]}>
        <AppLayout />
      </MemoryRouter>,
    );
  };

  beforeEach(async () => {
    await act(async () => { await i18n.changeLanguage('en'); });
  });

  it('shows the deterministic startup screen while auth is initializing', () => {
    renderWith({ authStatus: 'initializing', authUser: undefined, currentUser: null, appReady: false });
    expect(screen.getByRole('status')).toHaveTextContent('Preparing your family dashboard…');
    expect(screen.getByText('Checking your sign-in')).toBeInTheDocument();
  });

  it('shows the profile step when the user document has not arrived yet', () => {
    renderWith({ currentUser: null, appReady: false });
    expect(screen.getByText('Loading your profile')).toBeInTheDocument();
  });

  it('shows the family step while family data is still bootstrapping', () => {
    renderWith({ appReady: false });
    expect(screen.getByText('Preparing your family data')).toBeInTheDocument();
  });

  it('shows a recoverable error with Retry wired to the store, not an endless spinner', async () => {
    const retryBootstrap = vi.fn();
    renderWith({ appReady: false, bootstrapError: '[Family] permission-denied: nope', retryBootstrap });
    expect(screen.getByRole('alert')).toHaveTextContent('family access');
    expect(screen.getByRole('alert')).not.toHaveTextContent('permission-denied');
    await act(async () => { screen.getByRole('button', { name: 'Retry' }).click(); });
    expect(retryBootstrap).toHaveBeenCalledTimes(1);
  });

  it('renders the dashboard chrome once startup is ready', () => {
    renderWith({});
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getAllByText('Home')).toHaveLength(2);
  });

  it('redirects an existing family owner away from /onboarding', () => {
    const state = {
      ...mockStoreState,
      currentUser: { id: 'u1', uid: 'u1', familyId: 'f1', role: 'owner' },
    };
    (useStore as any).mockImplementation((selector: any) => (selector ? selector(state) : state));
    render(
      <MemoryRouter initialEntries={['/onboarding']}>
        <Routes>
          <Route path="/" element={<AppLayout />}>
            <Route index element={<div>DASHBOARD</div>} />
            <Route path="onboarding" element={<div>CREATE FAMILY SCREEN</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    // The onboarding route must never render for a user who already has a
    // family; the layout redirects to the dashboard instead.
    expect(screen.queryByText('CREATE FAMILY SCREEN')).not.toBeInTheDocument();
    expect(screen.getByText('DASHBOARD')).toBeInTheDocument();
  });
});
