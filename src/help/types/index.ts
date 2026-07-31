/**
 * Help Center domain types.
 *
 * Content is data-driven: articles are plain data objects that live under
 * `src/help/data/<language>/`. Components never hardcode content, and content
 * never imports components. This keeps the two concerns fully separated and
 * makes adding a new language a pure data operation.
 */

export const HELP_CATEGORY_IDS = [
  'basics',
  'roles',
  'daily',
  'money',
  'family',
  'account',
  'support',
] as const;

export type HelpCategoryId = (typeof HELP_CATEGORY_IDS)[number];

export const HELP_ARTICLE_IDS = [
  'welcome',
  'getting-started',
  'parent-guide',
  'child-guide',
  'dashboard',
  'tasks',
  'behaviours',
  'rewards',
  'wallet',
  'child-transfers',
  'weekly-allowance',
  'savings-goals',
  'pet-box',
  'family-bulletin',
  'approval-center',
  'family-management',
  'account-security',
  'notifications',
  'faq',
  'troubleshooting',
] as const;

export type HelpArticleId = (typeof HELP_ARTICLE_IDS)[number];

export type HelpAudience = 'parent' | 'child' | 'everyone';

export type HelpCalloutTone = 'tip' | 'warning' | 'info' | 'comingSoon';

export interface HelpStep {
  title: string;
  detail?: string;
}

export interface HelpFaqItem {
  q: string;
  a: string;
}

export type HelpBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[]; ordered?: boolean }
  | { kind: 'steps'; steps: HelpStep[] }
  | { kind: 'callout'; tone: HelpCalloutTone; text: string }
  | { kind: 'faq'; items: HelpFaqItem[] };

/**
 * Canonical section ids. Every article answers the same questions in the same
 * order so readers always know where to look.
 */
export const HELP_SECTION_IDS = [
  'what',
  'why',
  'who',
  'how',
  'steps',
  'tips',
  'mistakes',
] as const;

export type HelpSectionId = (typeof HELP_SECTION_IDS)[number];

export interface HelpSection {
  id: HelpSectionId;
  heading: string;
  blocks: HelpBlock[];
}

export interface HelpArticle {
  id: HelpArticleId;
  title: string;
  description: string;
  category: HelpCategoryId;
  keywords: string[];
  /** Author-provided estimate; the UI recomputes it when it is omitted. */
  readingTimeMinutes: number;
  /** ISO date (YYYY-MM-DD) powering the "Recent updates" rail. */
  updatedAt: string;
  audience: HelpAudience[];
  popular?: boolean;
  /** Ordered position inside "Getting started". Absent = not part of it. */
  gettingStartedOrder?: number;
  sections: HelpSection[];
  related: HelpArticleId[];
}

export interface HelpCategory {
  id: HelpCategoryId;
  /** i18n key inside the `help` namespace. */
  labelKey: string;
  descriptionKey: string;
  /** lucide-react icon name rendered by HelpCategoryGrid. */
  icon: string;
  order: number;
}

export interface HelpSearchMatch {
  article: HelpArticle;
  score: number;
  /** Plain-text excerpt around the best match, used for result snippets. */
  snippet: string;
}
