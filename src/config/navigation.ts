import { Home, Users, CheckSquare, Gift } from 'lucide-react';

export interface NavItem {
  name: string;
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
  { name: 'Home', path: '/', icon: Home },
  { name: 'Tasks', path: '/tasks', icon: CheckSquare },
  { name: 'Rewards', path: '/rewards', icon: Gift },
];

// Settings is no longer a top-level tab; it lives in the profile dropdown.
// Family is moved to the end of the navigation for a cleaner layout.
// Parent and child share the same top-level navigation.
export function getNavItems(): NavItem[] {
  return [...baseNavItems, { name: 'Family', path: '/family', icon: Users }];
}
