import { Home, Users, CheckSquare, Gift } from 'lucide-react';

export interface NavItem {
  labelKey: 'nav.home' | 'nav.tasks' | 'nav.rewards' | 'nav.family';
  path: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }> | React.FC;
}

// Single source of truth for the application navigation.
//
// Phase 1 navigation simplification: the top-level navigation is reduced to 4
// items (Home, Tasks, Rewards, Family). The removed tabs (Goals, Pet Box,
// Wallet/Wallets) keep their routes working — they are reached via deep links,
// notifications, and in-app navigation — but are no longer top-level tabs.
//
// Both the desktop header and the mobile bottom navigation consume this exact
// same array so the two can never diverge.
const baseNavItems: NavItem[] = [
  { labelKey: 'nav.home', path: '/', icon: Home },
  { labelKey: 'nav.tasks', path: '/tasks', icon: CheckSquare },
  { labelKey: 'nav.rewards', path: '/rewards', icon: Gift },
];

// Settings is no longer a top-level tab; it lives in the profile dropdown.
// Family is moved to the end of the navigation for a cleaner layout.
// Parent and child share the same top-level navigation.
export function getNavItems(): NavItem[] {
  return [...baseNavItems, { labelKey: 'nav.family', path: '/family', icon: Users }];
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
