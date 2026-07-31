import type { HelpCategory, HelpCategoryId } from '../types';

/**
 * Category metadata is language-independent: labels are resolved through the
 * `help` i18n namespace so a new language never needs to touch this file.
 */
export const HELP_CATEGORIES: HelpCategory[] = [
  {
    id: 'basics',
    labelKey: 'categories.basics.label',
    descriptionKey: 'categories.basics.description',
    icon: 'Sparkles',
    order: 1,
  },
  {
    id: 'roles',
    labelKey: 'categories.roles.label',
    descriptionKey: 'categories.roles.description',
    icon: 'Users',
    order: 2,
  },
  {
    id: 'daily',
    labelKey: 'categories.daily.label',
    descriptionKey: 'categories.daily.description',
    icon: 'CheckSquare',
    order: 3,
  },
  {
    id: 'money',
    labelKey: 'categories.money.label',
    descriptionKey: 'categories.money.description',
    icon: 'Wallet',
    order: 4,
  },
  {
    id: 'family',
    labelKey: 'categories.family.label',
    descriptionKey: 'categories.family.description',
    icon: 'Home',
    order: 5,
  },
  {
    id: 'account',
    labelKey: 'categories.account.label',
    descriptionKey: 'categories.account.description',
    icon: 'ShieldCheck',
    order: 6,
  },
  {
    id: 'support',
    labelKey: 'categories.support.label',
    descriptionKey: 'categories.support.description',
    icon: 'LifeBuoy',
    order: 7,
  },
];

const byId = new Map<HelpCategoryId, HelpCategory>(
  HELP_CATEGORIES.map(category => [category.id, category])
);

export function getHelpCategory(id: HelpCategoryId): HelpCategory | undefined {
  return byId.get(id);
}

export function sortedHelpCategories(): HelpCategory[] {
  return [...HELP_CATEGORIES].sort((a, b) => a.order - b.order);
}
