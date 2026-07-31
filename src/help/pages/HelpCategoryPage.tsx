import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HelpArticleCard } from '../components/HelpArticleCard';
import { HelpBreadcrumbs, HelpSkeleton } from '../components/HelpChrome';
import { getHelpCategory } from '../data/categories';
import { articlesByCategory, useHelpArticles } from '../useHelpArticles';
import { HELP_CATEGORY_IDS, type HelpCategoryId } from '../types';

export function HelpCategoryPage() {
  const { t } = useTranslation('help');
  const { categoryId } = useParams();
  const { articles, loading } = useHelpArticles();

  const valid = (HELP_CATEGORY_IDS as readonly string[]).includes(categoryId ?? '');
  const category = valid ? getHelpCategory(categoryId as HelpCategoryId) : undefined;

  if (!category) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-10 text-center sm:px-6">
        <h1 className="text-xl font-semibold text-gray-900">{t('category.notFound')}</h1>
        <Link to="/help" className="mt-4 inline-block text-indigo-600 hover:underline">
          {t('article.notFound.cta')}
        </Link>
      </div>
    );
  }

  const list = articlesByCategory(articles, category.id);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-24 pt-6 sm:px-6">
      <HelpBreadcrumbs
        crumbs={[{ label: t('breadcrumbs.home'), to: '/help' }, { label: t(category.labelKey) }]}
      />
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t(category.labelKey)}</h1>
        <p className="mt-1 text-[15px] text-gray-600">{t(category.descriptionKey)}</p>
      </header>

      {loading ? (
        <HelpSkeleton lines={4} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map(article => (
            <HelpArticleCard key={article.id} article={article} />
          ))}
        </div>
      )}
    </div>
  );
}
