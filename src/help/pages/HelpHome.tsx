import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { HelpSearchBox } from '../components/HelpSearchBox';
import { HelpCategoryGrid } from '../components/HelpCategoryGrid';
import { HelpArticleCard } from '../components/HelpArticleCard';
import { HelpSectionHeading, HelpSkeleton } from '../components/HelpChrome';
import {
  gettingStartedArticles,
  popularArticles,
  recentlyUpdatedArticles,
  useHelpArticles,
} from '../useHelpArticles';

export function HelpHome() {
  const { t, i18n } = useTranslation('help');
  const { articles, loading } = useHelpArticles();

  const gettingStarted = gettingStartedArticles(articles);
  const popular = popularArticles(articles);
  const recent = recentlyUpdatedArticles(articles);
  const dateFormatter = new Intl.DateTimeFormat(i18n.resolvedLanguage ?? 'en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-6 sm:px-6">
      <header className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">{t('home.title')}</h1>
        <p className="mx-auto mt-2 max-w-xl text-[15px] leading-7 text-gray-600">
          {t('home.subtitle')}
        </p>
      </header>

      <div className="mx-auto mb-10 max-w-2xl">
        <HelpSearchBox />
      </div>

      {loading ? (
        <HelpSkeleton />
      ) : (
        <div className="space-y-12">
          <section aria-labelledby="getting-started-heading">
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-5">
              <div className="mb-3 flex items-center gap-2">
                <Compass size={18} aria-hidden className="text-indigo-600" />
                <h2 id="getting-started-heading" className="text-lg font-semibold text-gray-900">
                  {t('home.gettingStarted')}
                </h2>
              </div>
              <p className="mb-4 text-sm text-gray-600">{t('home.gettingStartedHint')}</p>
              <ol className="grid gap-3 sm:grid-cols-2">
                {gettingStarted.map((article, index) => (
                  <li key={article.id} className="flex gap-3">
                    <span
                      aria-hidden
                      className="mt-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-sm font-semibold text-indigo-700 shadow-sm"
                    >
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <HelpArticleCard article={article} />
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section aria-labelledby="popular-heading">
            <HelpSectionHeading title={t('home.popular')} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {popular.map(article => (
                <HelpArticleCard key={article.id} article={article} />
              ))}
            </div>
          </section>

          <section aria-labelledby="categories-heading">
            <HelpSectionHeading title={t('home.categories')} />
            <HelpCategoryGrid articles={articles} />
          </section>

          <section aria-labelledby="recent-heading">
            <HelpSectionHeading title={t('home.recentUpdates')} />
            <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-100 bg-white">
              {recent.map(article => (
                <li key={article.id}>
                  <Link
                    to={`/help/${article.id}`}
                    className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-gray-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-gray-900">
                        {article.title}
                      </span>
                      <span className="block truncate text-sm text-gray-500">
                        {article.description}
                      </span>
                    </span>
                    <time
                      dateTime={article.updatedAt}
                      className="shrink-0 text-xs text-gray-400"
                    >
                      {dateFormatter.format(new Date(article.updatedAt))}
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
