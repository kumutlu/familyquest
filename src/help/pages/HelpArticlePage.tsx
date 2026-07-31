import { useEffect, useMemo, useRef } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Clock, Users } from 'lucide-react';
import { HelpBody, HelpCallout } from '../components/HelpBody';
import { HelpBreadcrumbs, HelpSkeleton, RelatedArticles } from '../components/HelpChrome';
import { getHelpCategory } from '../data/categories';
import { useHelpArticle } from '../useHelpArticles';
import { HELP_ARTICLE_IDS, type HelpArticleId } from '../types';

function isArticleId(value: string | undefined): value is HelpArticleId {
  return !!value && (HELP_ARTICLE_IDS as readonly string[]).includes(value);
}

export function HelpArticlePage() {
  const { t } = useTranslation('help');
  const { articleId } = useParams();
  const [searchParams] = useSearchParams();
  const from = searchParams.get('from');
  const headingRef = useRef<HTMLHeadingElement>(null);

  const id = isArticleId(articleId) ? articleId : undefined;
  const { article, loading, untranslated, allArticles } = useHelpArticle(id);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    headingRef.current?.focus();
  }, [id]);

  const related = useMemo(
    () =>
      article
        ? article.related
            .map(relatedId => allArticles.find(candidate => candidate.id === relatedId))
            .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
        : [],
    [article, allArticles]
  );

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 sm:px-6">
        <HelpSkeleton />
      </div>
    );
  }

  if (!article) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-10 text-center sm:px-6">
        <h1 className="text-xl font-semibold text-gray-900">{t('article.notFound.title')}</h1>
        <p className="mt-2 text-gray-600">{t('article.notFound.body')}</p>
        <Link
          to="/help"
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          {t('article.notFound.cta')}
        </Link>
      </div>
    );
  }

  const category = getHelpCategory(article.category);

  return (
    <article className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 sm:px-6">
      {from ? (
        <Link
          to={from}
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:underline"
        >
          <ArrowLeft size={16} aria-hidden />
          {t('article.backToApp')}
        </Link>
      ) : null}

      <HelpBreadcrumbs
        crumbs={[
          { label: t('breadcrumbs.home'), to: '/help' },
          ...(category
            ? [{ label: t(category.labelKey), to: `/help/category/${category.id}` }]
            : []),
          { label: article.title },
        ]}
      />

      <header className="mb-8">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-2xl font-bold leading-tight text-gray-900 outline-none sm:text-3xl"
        >
          {article.title}
        </h1>
        <p className="mt-2 text-[15px] leading-7 text-gray-600">{article.description}</p>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500">
          <span className="inline-flex items-center gap-1">
            <Clock size={13} aria-hidden />
            {t('readingTime', { count: article.readingTimeMinutes })}
          </span>
          <span className="inline-flex items-center gap-1">
            <Users size={13} aria-hidden />
            {article.audience.map(audience => t(`audience.${audience}`)).join(', ')}
          </span>
          <span>{t('article.updatedOn', { date: article.updatedAt })}</span>
        </div>
      </header>

      {untranslated ? (
        <div className="mb-8">
          <HelpCallout tone="info">{t('article.untranslated')}</HelpCallout>
        </div>
      ) : null}

      <HelpBody sections={article.sections} />

      <RelatedArticles articles={related} />
    </article>
  );
}
