import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { AppLayout } from './AppLayout';
import { useStore } from '../../store/useStore';
import { MemoryRouter } from 'react-router-dom';
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

vi.mock('../../lib/api', () => ({ signOut: vi.fn(async () => {}) }));

vi.mock('../../lib/firebase', () => ({ auth: {} }));
vi.mock('firebase/auth', () => ({ signOut: vi.fn(async () => {}) }));
vi.mock('../../lib/childLoginApi', () => ({
  completeChildPasswordChange: vi.fn(async () => {}),
  mapChildLoginError: () => 'Unable to update password.',
  validatePasswordClient: () => null,
}));

vi.mock('../../lib/useNotifications', () => ({
  useNotifications: () => ({
    notifications: [],
    readIds: new Set<string>(),
    unreadCount: 0,
    error: null,
    loading: false,
    loadingMore: false,
    hasMore: false,
    connectionState: 'connected',
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    loadMore: vi.fn(),
    retry: vi.fn(),
  }),
}));

vi.mock('../challenges/ChildChallengeCelebration', () => ({
  ChildChallengeCelebration: () => null,
}));

vi.mock('../bug-report/BugReportSheet', () => ({
  BugReportSheet: () => null,
}));

vi.mock('../../config/navigation', () => ({
  getNavItems: () => [
    { labelKey: 'nav.home', path: '/', icon: () => null },
    { labelKey: 'nav.tasks', path: '/tasks', icon: () => null },
    { labelKey: 'nav.goals', path: '/goals', icon: () => null },
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

  it('shows Goals and a text-labelled More action in desktop navigation', () => {
    renderAppLayout();
    const desktopNav = screen.getByTestId('desktop-primary-navigation');
    expect(desktopNav).toHaveTextContent('Goals');
    expect(desktopNav).toHaveTextContent('More');
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

describe('AppLayout — visual shell and managed-child gate', () => {
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

  it('renders the visual shell for a resolved member', () => {
    renderWith({});
    expect(screen.getAllByText('Home')).toHaveLength(2);
  });

  it('does not own no-family routing policy', () => {
    renderWith({ currentUser: { id: 'u1', familyId: undefined, role: 'parent' } });
    expect(screen.getAllByText('Home')).toHaveLength(2);
  });

  it('keeps the managed-child password-change gate ahead of the visual shell', () => {
    renderWith({
      currentUser: {
        id: 'child-1',
        familyId: 'f1',
        role: 'child',
        isManaged: true,
        requiresPasswordChange: true,
      },
    });
    expect(screen.getByRole('heading', { name: 'Create your private password' })).toBeInTheDocument();
    expect(screen.queryByTestId('desktop-primary-navigation')).not.toBeInTheDocument();
  });
});
