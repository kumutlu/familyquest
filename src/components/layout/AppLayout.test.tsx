import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { AppLayout } from './AppLayout';
import { useStore } from '../../store/useStore';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';

const mockStoreState = {
  authStatus: 'authenticated',
  authUser: { uid: 'u1' },
  currentUser: { id: 'u1', familyId: 'f1', role: 'parent' },
  appReady: true,
  familyMembers: [],
  bootstrapError: null,
  retryBootstrap: vi.fn(),
};

vi.mock('../../store/useStore', () => ({
  useStore: vi.fn((selector: any) => selector ? selector(mockStoreState) : mockStoreState),
}));

vi.mock('../../config/navigation', () => ({
  getNavItems: () => [
    { name: 'Home', path: '/', icon: () => null },
    { name: 'Tasks', path: '/tasks', icon: () => null },
    { name: 'Rewards', path: '/rewards', icon: () => null },
  ],
}));

vi.mock('./ProfileDropdown', () => ({
  ProfileDropdown: () => <div>ProfileDropdown</div>,
}));

vi.mock('./NotificationCenter', () => ({
  NotificationCenter: () => <div>NotificationCenter</div>,
}));

vi.mock('../../lib/childOnboarding', () => ({
  shouldStartChildOnboarding: () => false,
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
});