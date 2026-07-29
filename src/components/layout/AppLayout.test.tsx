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
