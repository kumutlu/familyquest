import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import * as icons from 'lucide-react';
import { sortedHelpCategories } from '../data/categories';
import type { HelpArticle } from '../types';

function CategoryIcon({ name }: { name: string }) {
  const Icon = (icons as unknown as Record<string, icons.LucideIcon>)[name] ?? icons.BookOpen;
  return <Icon size={20} aria-hidden className="text-indigo-600" />;
}

export function HelpCategoryGrid({ articles }: { articles: HelpArticle[] }) {
  const { t } = useTranslation('help');
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {sortedHelpCategories().map(category => {
        const count = articles.filter(article => article.category === category.id).length;
        return (
          <Link
            key={category.id}
            to={`/help/category/${category.id}`}
            className="group flex gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm transition hover:border-indigo-200 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50">
              <CategoryIcon name={category.icon} />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-gray-900 group-hover:text-indigo-700">
                {t(category.labelKey)}
              </span>
              <span className="block text-sm text-gray-600">{t(category.descriptionKey)}</span>
              <span className="mt-1 block text-xs text-gray-400">
                {t('articleCount', { count })}
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
