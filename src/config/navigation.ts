import { Home, Users, CheckSquare, Gift } from 'lucide-react';

export interface NavItem {
  labelKey: 'nav.home' | 'nav.tasks' | 'nav.rewards' | 'nav.family';
  path: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }> | React.FC;
}

// Single source of truth for the application navigation.
//
// V2 (2026-09-02): Goals is no longer a primary child navigation tab at any
// width. The /goals route, the Goals feature, and the savings-goals data
// remain fully reachable from:
//   * the Child Home › Your Journey › Current Goal zone
//   * the More menu (`MORE_DESTINATIONS` in `src/components/layout/MoreMenu.tsx`)
//   * the dedicated /goals deep link
// Per the PO-approved V2 spec, Goals must never reappear as a primary tab at
// desktop width either, so the desktop primary nav mirrors the mobile
// four-tab hierarchy.
const desktopNavItems: NavItem[] = [
  { labelKey: 'nav.home', path: '/', icon: Home },
  { labelKey: 'nav.tasks', path: '/tasks', icon: CheckSquare },
  { labelKey: 'nav.rewards', path: '/rewards', icon: Gift },
  { labelKey: 'nav.family', path: '/family', icon: Users },
];

export function getNavItems(): NavItem[] {
  return [...desktopNavItems];
}

// ---------------------------------------------------------------------------
// Queki v2 shell navigation
// ---------------------------------------------------------------------------

/**
 * Queki v2 bottom-navigation slots. The centre Action slot is NOT part of this
 * array — it is rendered separately by QuekiBottomNavigation as the visually
 * dominant, role-aware button between "Quests" and "Rewards".
 *
 * Routes are intentionally identical to the legacy items (no duplicate routes):
 * "Quests" is the v2 presentation of /tasks.
 */
export function getQuekiNavItems(): Array<NavItem & { testId: string }> {
  return [
    { labelKey: 'nav.home', path: '/', icon: Home, testId: 'queki-nav-home' },
    { labelKey: 'nav.tasks', path: '/tasks', icon: CheckSquare, testId: 'queki-nav-quests' },
    { labelKey: 'nav.rewards', path: '/rewards', icon: Gift, testId: 'queki-nav-rewards' },
    { labelKey: 'nav.family', path: '/family', icon: Users, testId: 'queki-nav-family' },
  ];
}
