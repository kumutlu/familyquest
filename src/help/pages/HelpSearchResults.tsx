import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SearchX } from 'lucide-react';
import { HelpSearchBox } from '../components/HelpSearchBox';
import { HelpArticleCard } from '../components/HelpArticleCard';
import { HelpBreadcrumbs, HelpSkeleton } from '../components/HelpChrome';
import { HelpCategoryGrid } from '../components/HelpCategoryGrid';
import { useHelpArticles, useHelpSearch } from '../useHelpArticles';

export function HelpSearchResults() {
  const { t } = useTranslation('help');
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const { results, loading } = useHelpSearch(query);
  const { articles } = useHelpArticles();

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-24 pt-6 sm:px-6">
      <HelpBreadcrumbs
        crumbs={[{ label: t('breadcrumbs.home'), to: '/help' }, { label: t('search.title') }]}
      />

      <div className="mb-8">
        <HelpSearchBox withSuggestions={false} initialQuery={query} autoFocus />
      </div>

      {loading ? (
        <HelpSkeleton lines={3} />
      ) : results.length === 0 ? (
        <div className="space-y-8">
          <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center">
            <SearchX size={28} aria-hidden className="mx-auto mb-3 text-gray-300" />
            <h1 className="font-semibold text-gray-900">{t('search.noResults', { query })}</h1>
            <p className="mt-1 text-sm text-gray-600">{t('search.noResultsHint')}</p>
          </div>
          <HelpCategoryGrid articles={articles} />
        </div>
      ) : (
        <>
          <h1 className="mb-4 text-sm text-gray-500" aria-live="polite">
            {t('search.resultCount', { count: results.length, query })}
          </h1>
          <div className="grid gap-3">
            {results.map(match => (
              <HelpArticleCard
                key={match.article.id}
                article={match.article}
                snippet={match.snippet}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
