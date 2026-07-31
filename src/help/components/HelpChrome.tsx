import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import type { HelpArticle } from '../types';
import { HelpArticleCard } from './HelpArticleCard';

export interface Crumb {
  label: string;
  to?: string;
}

export function HelpBreadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  const { t } = useTranslation('help');
  return (
    <nav aria-label={t('breadcrumbs.label')} className="mb-4">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-gray-500">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
              {crumb.to && !isLast ? (
                <Link to={crumb.to} className="hover:text-indigo-600 hover:underline">
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current={isLast ? 'page' : undefined} className="text-gray-700">
                  {crumb.label}
                </span>
              )}
              {!isLast ? <ChevronRight size={14} aria-hidden className="text-gray-300" /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function RelatedArticles({ articles }: { articles: HelpArticle[] }) {
  const { t } = useTranslation('help');
  if (articles.length === 0) return null;
  return (
    <section aria-labelledby="related-heading" className="mt-12">
      <h2 id="related-heading" className="mb-3 text-lg font-semibold text-gray-900">
        {t('related.heading')}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {articles.map(article => (
          <HelpArticleCard key={article.id} article={article} />
        ))}
      </div>
    </section>
  );
}

export function HelpSkeleton({ lines = 6 }: { lines?: number }) {
  return (
    <div className="animate-pulse space-y-4" aria-hidden>
      <div className="h-8 w-2/3 rounded-lg bg-gray-100" />
      <div className="h-4 w-1/3 rounded bg-gray-100" />
      {Array.from({ length: lines }).map((_, index) => (
        <div key={index} className="h-4 w-full rounded bg-gray-100" />
      ))}
    </div>
  );
}

export function HelpSectionHeading({
  title,
  action,
}: {
  title: string;
  action?: { label: string; to: string };
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      {action ? (
        <Link to={action.to} className="text-sm font-medium text-indigo-600 hover:underline">
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
