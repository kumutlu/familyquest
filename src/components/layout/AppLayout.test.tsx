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
    const navs = screen.getAllByTestId('mobile-bottom-nav');
    expect(navs).toHaveLength(1);
    const nav = navs[0];
    // Anchored to the viewport bottom, not to page content.
    expect(nav.className).toMatch(/\bfixed\b/);
    expect(nav.className).toMatch(/bottom-0/);
    expect(nav.className).toMatch(/inset-x-0/);
    expect(nav.className).toMatch(/pb-\[env\(safe-area-inset-bottom\)\]/);
    expect(nav.style.position).toBe('fixed');
    // Must be the last child of the layout root — never nested inside the
    // scrolling/transformable main content area.
    const root = container.querySelector('div.min-h-dvh')!;
    expect(root.lastElementChild).toBe(nav);
    expect(container.querySelector('main')!.contains(nav)).toBe(false);
  });

  it('uses min-h-dvh (dynamic viewport) instead of min-h-screen (100vh)', () => {
    const { container } = renderAppLayout();
    const outerDiv = container.querySelector('div.min-h-dvh');
    expect(outerDiv).toBeInTheDocument();
    // Ensure min-h-screen is NOT used (which would be 100vh on mobile)
    expect(container.querySelector('div.min-h-screen')).not.toBeInTheDocument();
  });

  it('main reserves space for bottom nav via safe-area padding', () => {
    const { container } = renderAppLayout();
    const main = container.querySelector('main');
    expect(main).toBeInTheDocument();
    // The main should have pb-[calc(4rem+env(safe-area-inset-bottom))] on mobile
    expect(main?.className).toMatch(/pb-\[calc\(4rem\+env\(safe-area-inset-bottom\)\)\]/);
  });

  it('bottom nav has valid safe-area padding class (not pb-safe)', () => {
    const { container } = renderAppLayout();
    const nav = container.querySelector('nav.md\\:hidden');
    expect(nav).toBeInTheDocument();
    // Should use pb-[env(safe-area-inset-bottom)], NOT pb-safe
    expect(nav?.className).toMatch(/pb-\[env\(safe-area-inset-bottom\)\]/);
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
    expect(screen.getAllByText('Home')).toHaveLength(2);
    expect(screen.getAllByText('Tasks')).toHaveLength(2);
    expect(screen.getAllByText('Rewards')).toHaveLength(2);

    await act(async () => { await i18n.changeLanguage('tr'); });

    expect(screen.getAllByText('Ana Sayfa')).toHaveLength(2);
    expect(screen.getAllByText('Görevler')).toHaveLength(2);
    expect(screen.getAllByText('Ödüller')).toHaveLength(2);
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
    expect(screen.getByRole('alert')).toHaveTextContent('[Family] permission-denied: nope');
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
