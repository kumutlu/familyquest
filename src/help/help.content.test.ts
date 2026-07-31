import { describe, expect, it } from 'vitest';
import en from './data/en/index';
import tr from './data/tr/index';
import { HELP_ARTICLE_IDS, HELP_CATEGORY_IDS, HELP_SECTION_IDS } from './types';
import { HELP_CATEGORIES } from './data/categories';
import { helpRouteEntries } from './helpRouteMap';
import { articleBodyText, searchHelpArticles } from './search';

const LOCALES: [string, typeof en][] = [
  ['en', en],
  ['tr', tr],
];

describe('help content integrity', () => {
  it.each(LOCALES)('%s contains every declared article exactly once', (_lng, articles) => {
    const ids = articles.map(article => article.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...HELP_ARTICLE_IDS].sort());
  });

  it.each(LOCALES)('%s articles use the mandated section structure', (_lng, articles) => {
    for (const article of articles) {
      const sectionIds = article.sections.map(section => section.id);
      expect(sectionIds, article.id).toEqual([...HELP_SECTION_IDS]);
      for (const section of article.sections) {
        expect(section.heading.length, `${article.id}/${section.id}`).toBeGreaterThan(0);
        expect(section.blocks.length, `${article.id}/${section.id}`).toBeGreaterThan(0);
      }
    }
  });

  it.each(LOCALES)('%s articles carry usable metadata', (_lng, articles) => {
    for (const article of articles) {
      expect(article.title.trim(), article.id).not.toBe('');
      expect(article.description.trim(), article.id).not.toBe('');
      expect(article.keywords.length, article.id).toBeGreaterThanOrEqual(3);
      expect(article.readingTimeMinutes, article.id).toBeGreaterThan(0);
      expect(article.updatedAt, article.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(article.audience.length, article.id).toBeGreaterThan(0);
      expect(HELP_CATEGORY_IDS, article.id).toContain(article.category);
    }
  });

  it.each(LOCALES)('%s related links resolve to real articles', (_lng, articles) => {
    const ids = new Set(articles.map(article => article.id));
    for (const article of articles) {
      expect(article.related.length, article.id).toBeGreaterThan(0);
      for (const related of article.related) {
        expect(ids, `${article.id} -> ${related}`).toContain(related);
        expect(related, article.id).not.toBe(article.id);
      }
    }
  });

  it('English and Turkish sets are structurally identical', () => {
    expect(tr.map(a => a.id)).toEqual(en.map(a => a.id));
    en.forEach((article, index) => {
      const translated = tr[index];
      expect(translated.category, article.id).toBe(article.category);
      expect(translated.audience, article.id).toEqual(article.audience);
      expect(translated.popular, article.id).toBe(article.popular);
      expect(translated.gettingStartedOrder, article.id).toBe(article.gettingStartedOrder);
      expect(translated.related, article.id).toEqual(article.related);
      expect(
        translated.sections.map(s => s.id),
        article.id
      ).toEqual(article.sections.map(s => s.id));
    });
  });

  it('Turkish articles are actually translated', () => {
    // 'Pet Box' is a product name and is intentionally identical in both languages.
    const UNTRANSLATED_BY_DESIGN = new Set(['pet-box']);
    en.forEach((article, index) => {
      if (UNTRANSLATED_BY_DESIGN.has(article.id)) {
        expect(tr[index].description, article.id).not.toBe(article.description);
        return;
      }
      expect(tr[index].title, article.id).not.toBe(article.title);
    });
  });

  it('every category has at least one article', () => {
    for (const category of HELP_CATEGORIES) {
      expect(en.filter(a => a.category === category.id).length, category.id).toBeGreaterThan(0);
    }
  });

  it('getting started is an ordered, gap-free sequence', () => {
    const orders = en
      .map(a => a.gettingStartedOrder)
      .filter((value): value is number => value !== undefined)
      .sort((a, b) => a - b);
    expect(orders).toEqual(orders.map((_, index) => index + 1));
  });

  it('every contextual route maps to an existing article', () => {
    const ids = new Set(en.map(article => article.id));
    for (const [route, id] of helpRouteEntries()) {
      expect(ids, route).toContain(id);
    }
  });

  it('article bodies are substantial enough to be useful', () => {
    for (const article of en) {
      expect(articleBodyText(article).length, article.id).toBeGreaterThan(600);
    }
  });
});

describe('help search', () => {
  it('finds an article by title', () => {
    const results = searchHelpArticles(en, 'wallet', 'en');
    expect(results[0]?.article.id).toBe('wallet');
  });

  it('finds an article by keyword that is absent from the title', () => {
    const results = searchHelpArticles(en, 'invite code', 'en');
    expect(results.map(r => r.article.id)).toContain('getting-started');
  });

  it('finds an article by category name', () => {
    const results = searchHelpArticles(en, 'money', 'en');
    expect(results.length).toBeGreaterThan(0);
  });

  it('finds an article by body text only', () => {
    const results = searchHelpArticles(en, 'dishwasher', 'en');
    expect(results.map(r => r.article.id)).toContain('tasks');
  });

  it('returns nothing for an empty query', () => {
    expect(searchHelpArticles(en, '   ', 'en')).toEqual([]);
  });

  it('handles Turkish casing and ASCII spelling', () => {
    const withDiacritics = searchHelpArticles(tr, 'çocuk', 'tr');
    const asciiSpelling = searchHelpArticles(tr, 'cocuk', 'tr');
    expect(withDiacritics.length).toBeGreaterThan(0);
    expect(asciiSpelling.map(r => r.article.id)).toEqual(
      withDiacritics.map(r => r.article.id)
    );
  });

  it('requires every term of a multi-word query to match', () => {
    const results = searchHelpArticles(en, 'wallet zzzznotaword', 'en');
    expect(results).toEqual([]);
  });

  it('produces a snippet for each result', () => {
    for (const match of searchHelpArticles(en, 'approval', 'en')) {
      expect(match.snippet.length).toBeGreaterThan(0);
    }
  });
});
