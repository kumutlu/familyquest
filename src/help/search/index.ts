import type { HelpArticle, HelpBlock, HelpSearchMatch } from '../types';
import { foldText, tokenize, tokenMatches } from './tokenize';

interface IndexedField {
  tokens: string[];
  weight: number;
}

interface IndexedArticle {
  article: HelpArticle;
  fields: IndexedField[];
  /** Flattened body text, used to build result snippets. */
  bodyText: string;
  foldedBody: string;
}

const FIELD_WEIGHTS = {
  title: 5,
  keywords: 4,
  category: 2,
  description: 2,
  body: 1,
} as const;

export function blockToText(block: HelpBlock): string {
  switch (block.kind) {
    case 'paragraph':
      return block.text;
    case 'list':
      return block.items.join(' ');
    case 'steps':
      return block.steps.map(step => `${step.title} ${step.detail ?? ''}`).join(' ');
    case 'callout':
      return block.text;
    case 'faq':
      return block.items.map(item => `${item.q} ${item.a}`).join(' ');
    default:
      return '';
  }
}

export function articleBodyText(article: HelpArticle): string {
  return article.sections
    .map(section => `${section.heading} ${section.blocks.map(blockToText).join(' ')}`)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildHelpIndex(articles: HelpArticle[], language = 'en'): IndexedArticle[] {
  return articles.map(article => {
    const bodyText = articleBodyText(article);
    return {
      article,
      bodyText,
      foldedBody: foldText(bodyText, language),
      fields: [
        { tokens: tokenize(article.title, language), weight: FIELD_WEIGHTS.title },
        {
          tokens: article.keywords.flatMap(keyword => tokenize(keyword, language)),
          weight: FIELD_WEIGHTS.keywords,
        },
        { tokens: tokenize(article.category, language), weight: FIELD_WEIGHTS.category },
        { tokens: tokenize(article.description, language), weight: FIELD_WEIGHTS.description },
        { tokens: tokenize(bodyText, language), weight: FIELD_WEIGHTS.body },
      ],
    };
  });
}

function buildSnippet(entry: IndexedArticle, queryTerm: string): string {
  const position = entry.foldedBody.indexOf(queryTerm);
  if (position < 0) return entry.article.description;
  const start = Math.max(0, position - 60);
  const end = Math.min(entry.bodyText.length, position + queryTerm.length + 90);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < entry.bodyText.length ? '…' : '';
  return `${prefix}${entry.bodyText.slice(start, end).trim()}${suffix}`;
}

export function searchHelpIndex(
  index: IndexedArticle[],
  query: string,
  language = 'en',
  limit = 20
): HelpSearchMatch[] {
  const terms = tokenize(query, language);
  if (terms.length === 0) return [];

  const results: HelpSearchMatch[] = [];

  for (const entry of index) {
    let score = 0;
    let matchedTerms = 0;

    for (const term of terms) {
      let termScore = 0;
      for (const field of entry.fields) {
        for (const token of field.tokens) {
          const match = tokenMatches(token, term);
          if (!match) continue;
          const exactness = token === term ? 1.5 : match === 'prefix' ? 1 : 0.5;
          termScore = Math.max(termScore, field.weight * exactness);
        }
      }
      if (termScore > 0) {
        matchedTerms += 1;
        score += termScore;
      }
    }

    // Require every term to match somewhere: it keeps multi-word queries precise.
    if (matchedTerms < terms.length) continue;
    if (entry.article.popular) score += 0.5;

    results.push({
      article: entry.article,
      score,
      snippet: buildSnippet(entry, terms[0]),
    });
  }

  return results
    .sort((a, b) => b.score - a.score || a.article.title.localeCompare(b.article.title))
    .slice(0, limit);
}

/** Convenience wrapper used by the UI when no persistent index is needed. */
export function searchHelpArticles(
  articles: HelpArticle[],
  query: string,
  language = 'en',
  limit = 20
): HelpSearchMatch[] {
  return searchHelpIndex(buildHelpIndex(articles, language), query, language, limit);
}
