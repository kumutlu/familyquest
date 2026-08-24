import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * FEATURE-PARITY REGRESSION TEST
 *
 * Guards the full user-facing product surface against redesign regressions
 * (the Queki v2 migration accidentally dropped Goals and Cat Box from all
 * navigation). If a redesign removes a route or its entry point, this test
 * must fail.
 *
 * Two layers:
 *  1. Route layer — every legacy feature route still mounts a page.
 *  2. Entry-point layer — the More hub (secondary navigation) exposes every
 *     required destination per role, and the primary nav config is intact.
 */

vi.mock('../../src/store/useStore', () => ({
  useStore: (selector: any) => selector({ initAuth: vi.fn() }),
  logAuthTrace: vi.fn(),
}));
vi.mock('../../src/components/layout/AppLayout', async () => {
  const { Outlet } = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { AppLayout: () => <div><span>layout</span><Outlet /></div> };
});
vi.mock('../../src/pages/Dashboard', () => ({ Dashboard: () => <span>dashboard-page</span> }));
vi.mock('../../src/pages/Family', () => ({ Family: () => <span>family-page</span> }));
vi.mock('../../src/pages/MemberProfile', () => ({ MemberProfile: () => <span>member-page</span> }));
vi.mock('../../src/pages/Tasks', () => ({ Tasks: () => <span>tasks-page</span> }));
vi.mock('../../src/pages/Rewards', () => ({ Rewards: () => <span>rewards-page</span> }));
vi.mock('../../src/pages/Wallet', () => ({ Wallet: () => <span>wallet-page</span> }));
vi.mock('../../src/pages/Wallets', () => ({ Wallets: () => <span>wallets-page</span> }));
vi.mock('../../src/pages/Goals', () => ({ Goals: () => <span>goals-page</span> }));
vi.mock('../../src/pages/FundsDashboard', () => ({ FundsDashboard: () => <span>catbox-page</span> }));
vi.mock('../../src/pages/Notifications', () => ({ Notifications: () => <span>notifications-page</span> }));
vi.mock('../../src/pages/Settings', () => ({ Settings: () => <span>settings-page</span> }));
vi.mock('../../src/pages/Login', () => ({ Login: () => <span>login-page</span> }));
vi.mock('../../src/pages/Signup', () => ({ Signup: () => <span>signup-page</span> }));
vi.mock('../../src/onboarding/OnboardingFlow', () => ({ OnboardingFlow: () => <span>onboarding-page</span> }));
vi.mock('../../src/components/history/TransactionHistoryScreen', () => ({
  TransactionHistoryScreen: () => <span>history-page</span>,
}));

import App from '../../src/App';
import { getMoreDestinations } from '../../src/components/layout/MoreMenu';
import { getNavItems, getQuekiNavItems } from '../../src/config/navigation';

// Every legacy pre-v2 route that must keep working (route layer).
const LEGACY_ROUTES: Array<[string, string]> = [
  ['/', 'dashboard-page'],
  ['/tasks', 'tasks-page'],
  ['/rewards', 'rewards-page'],
  ['/family', 'family-page'],
  ['/family/abc', 'member-page'],
  ['/wallet', 'wallet-page'],
  ['/wallets', 'wallets-page'],
  ['/goals', 'goals-page'],
  ['/pet-box', 'catbox-page'],
  ['/notifications', 'notifications-page'],
  ['/history', 'history-page'],
  ['/settings', 'settings-page'],
];

describe('feature parity — route layer', () => {
  for (const [route, marker] of LEGACY_ROUTES) {
    it(`mounts ${marker} at ${route}`, async () => {
      window.history.pushState({}, '', route);
      const { unmount } = render(<App />);
      expect(await screen.findByText(marker)).toBeInTheDocument();
      unmount();
    });
  }
});

describe('feature parity — entry-point layer', () => {
  it('primary bottom navigation keeps the four daily tabs', () => {
    const paths = getQuekiNavItems().map(i => i.path);
    expect(paths).toEqual(['/', '/tasks', '/rewards', '/family']);
    // Legacy nav must stay aligned (no divergence between shells).
    expect(getNavItems().map(i => i.path)).toEqual(paths);
  });

  it('parent can reach every major product area from the More hub', () => {
    const paths = getMoreDestinations('owner').map(d => d.path);
    for (const p of ['/goals', '/wallets', '/pet-box', '/history', '/notifications', '/settings', '/help']) {
      expect(paths, `owner missing entry point for ${p}`).toContain(p);
    }
  });

  it('child can reach permitted areas without parent-only exposure', () => {
    const paths = getMoreDestinations('child').map(d => d.path);
    for (const p of ['/goals', '/wallet', '/history', '/notifications', '/settings', '/help']) {
      expect(paths, `child missing entry point for ${p}`).toContain(p);
    }
    expect(paths).not.toContain('/pet-box');
    expect(paths).not.toContain('/wallets');
  });
});
