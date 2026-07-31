import type { HelpArticle, HelpArticleId } from '../types';

/**
 * Locale registry.
 *
 * Every `data/<language>/index.ts` module default-exports the full article list
 * for that language. The glob is lazy, so a language bundle is only downloaded
 * the first time the Help Center is opened in that language.
 *
 * Adding a language = create `data/<language>/index.ts`. Nothing else here
 * changes.
 */
const loaders = import.meta.glob('./*/index.ts', { eager: false }) as Record<
  string,
  () => Promise<{ default: HelpArticle[] }>
>;

export const HELP_FALLBACK_LANGUAGE = 'en';

export function availableHelpLanguages(): string[] {
  return Object.keys(loaders)
    .map(path => path.replace('./', '').replace('/index.ts', ''))
    .sort();
}

const cache = new Map<string, Promise<HelpArticle[]>>();

function normaliseLanguage(language: string): string {
  // 'tr-TR' -> 'tr'
  return language.split('-')[0]?.toLowerCase() ?? HELP_FALLBACK_LANGUAGE;
}

function loadRaw(language: string): Promise<HelpArticle[]> {
  const loader = loaders[`./${language}/index.ts`];
  if (!loader) return Promise.resolve([]);
  const cached = cache.get(language);
  if (cached) return cached;
  const promise = loader()
    .then(mod => mod.default)
    .catch(() => [] as HelpArticle[]);
  cache.set(language, promise);
  return promise;
}

/**
 * Loads the articles for `language`, merged over the English fallback so a
 * partially translated language never shows an empty Help Center.
 */
export async function loadHelpArticles(language: string): Promise<HelpArticle[]> {
  const lng = normaliseLanguage(language);
  const fallback = await loadRaw(HELP_FALLBACK_LANGUAGE);
  if (lng === HELP_FALLBACK_LANGUAGE) return fallback;

  const localised = await loadRaw(lng);
  if (localised.length === 0) return fallback;

  const localisedById = new Map(localised.map(article => [article.id, article]));
  return fallback.map(article => localisedById.get(article.id) ?? article);
}

export async function loadHelpArticle(
  language: string,
  id: HelpArticleId
): Promise<HelpArticle | undefined> {
  const articles = await loadHelpArticles(language);
  return articles.find(article => article.id === id);
}

/**
 * True when the article shown for `language` is only available in the fallback
 * language, so the UI can surface a "not translated yet" notice.
 */
export async function isFallbackArticle(
  language: string,
  id: HelpArticleId
): Promise<boolean> {
  const lng = normaliseLanguage(language);
  if (lng === HELP_FALLBACK_LANGUAGE) return false;
  const localised = await loadRaw(lng);
  return !localised.some(article => article.id === id);
}

/** Test seam: clears the memoised language bundles. */
export function __resetHelpRegistryCache(): void {
  cache.clear();
}
