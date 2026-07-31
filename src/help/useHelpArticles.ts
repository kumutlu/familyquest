import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HelpArticle, HelpArticleId, HelpCategoryId, HelpSearchMatch } from './types';
import { isFallbackArticle, loadHelpArticles } from './data/registry';
import { buildHelpIndex, searchHelpIndex } from './search';

/** Loads every article for the active language (English merged as fallback). */
export function useHelpArticles(): { articles: HelpArticle[]; loading: boolean; language: string } {
  const { i18n } = useTranslation('help');
  const language = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const [articles, setArticles] = useState<HelpArticle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadHelpArticles(language)
      .then(next => {
        if (!cancelled) setArticles(next);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [language]);

  return { articles, loading, language };
}

export function useHelpArticle(id: HelpArticleId | undefined) {
  const { articles, loading, language } = useHelpArticles();
  const [untranslated, setUntranslated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!id) return;
    isFallbackArticle(language, id).then(value => {
      if (!cancelled) setUntranslated(value);
    });
    return () => {
      cancelled = true;
    };
  }, [id, language]);

  const article = useMemo(
    () => (id ? articles.find(candidate => candidate.id === id) : undefined),
    [articles, id]
  );

  return { article, loading, untranslated, allArticles: articles };
}

export function useHelpSearch(query: string): { results: HelpSearchMatch[]; loading: boolean } {
  const { articles, loading, language } = useHelpArticles();
  const index = useMemo(() => buildHelpIndex(articles, language), [articles, language]);
  const trimmed = query.trim();
  const results = useMemo(
    () => (trimmed.length === 0 ? [] : searchHelpIndex(index, trimmed, language)),
    [index, trimmed, language]
  );
  return { results, loading };
}

export function articlesByCategory(
  articles: HelpArticle[],
  categoryId: HelpCategoryId
): HelpArticle[] {
  return articles.filter(article => article.category === categoryId);
}

export function gettingStartedArticles(articles: HelpArticle[]): HelpArticle[] {
  return articles
    .filter(article => article.gettingStartedOrder !== undefined)
    .sort((a, b) => (a.gettingStartedOrder ?? 0) - (b.gettingStartedOrder ?? 0));
}

export function popularArticles(articles: HelpArticle[], limit = 6): HelpArticle[] {
  return articles.filter(article => article.popular).slice(0, limit);
}

export function recentlyUpdatedArticles(articles: HelpArticle[], limit = 5): HelpArticle[] {
  return [...articles]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}
