import type { HelpArticleId } from './types';

/**
 * Contextual help: maps an application route to the single Help article that
 * documents it. There is deliberately no per-page help copy anywhere in the
 * app — the `?` button always opens the canonical article, so content can
 * never drift out of sync.
 */
const EXACT_ROUTES: Record<string, HelpArticleId> = {
  '/': 'dashboard',
  '/onboarding': 'getting-started',
  '/tasks': 'tasks',
  '/rewards': 'rewards',
  '/wallet': 'wallet',
  '/wallets': 'wallet',
  '/history': 'wallet',
  '/goals': 'savings-goals',
  '/pet-box': 'pet-box',
  '/family': 'family-management',
  '/notifications': 'notifications',
  '/settings': 'account-security',
  '/login': 'getting-started',
  '/signup': 'getting-started',
};

const PREFIX_ROUTES: [string, HelpArticleId][] = [
  ['/goals/', 'savings-goals'],
  ['/family/', 'family-management'],
];

export function helpArticleForRoute(pathname: string): HelpArticleId | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const exact = EXACT_ROUTES[path];
  if (exact) return exact;
  const prefix = PREFIX_ROUTES.find(([candidate]) => pathname.startsWith(candidate));
  return prefix?.[1];
}

export function helpRouteEntries(): [string, HelpArticleId][] {
  return [...Object.entries(EXACT_ROUTES), ...PREFIX_ROUTES];
}

export function helpArticlePath(id: HelpArticleId, from?: string): string {
  return from ? `/help/${id}?from=${encodeURIComponent(from)}` : `/help/${id}`;
}
