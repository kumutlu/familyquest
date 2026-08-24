import { Home, Users, CheckSquare, Gift, Target } from 'lucide-react';

export interface NavItem {
  labelKey: 'nav.home' | 'nav.tasks' | 'nav.goals' | 'nav.rewards' | 'nav.family';
  path: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }> | React.FC;
}

// Single source of truth for the application navigation.
//
// Desktop primary navigation exposes recurring product areas directly. Mobile
// deliberately uses the separate compact list below to preserve its five-slot
// bottom-navigation hierarchy.
const desktopNavItems: NavItem[] = [
  { labelKey: 'nav.home', path: '/', icon: Home },
  { labelKey: 'nav.tasks', path: '/tasks', icon: CheckSquare },
  { labelKey: 'nav.goals', path: '/goals', icon: Target },
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
