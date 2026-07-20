import { afterEach, describe, expect, it } from 'vitest';
import i18n, { DEFAULT_LANGUAGE, NAMESPACES } from './config';
import { applyDocumentDirection } from './index';
import { formatPence } from './format';

const ORIGINAL_LANGUAGE = i18n.language;

afterEach(async () => {
  await i18n.changeLanguage(ORIGINAL_LANGUAGE);
  // i18next is a singleton; unload lazily-loaded namespaces so each test starts
  // from the same state (only the seeded `common` namespace is present).
  for (const ns of NAMESPACES) {
    if (ns === 'common') continue;
    i18n.removeResourceBundle('en', ns);
    i18n.removeResourceBundle('tr', ns);
  }
  applyDocumentDirection(ORIGINAL_LANGUAGE);
});

describe('Phase 2E — new namespaces are registered and lazy-loadable', () => {
  it('registers the requests and reversals namespaces', () => {
    expect(NAMESPACES).toContain('requests');
    expect(NAMESPACES).toContain('reversals');
  });

  it('lazily loads the requests namespace and returns English values', async () => {
    expect(i18n.hasResourceBundle('en', 'requests')).toBe(false);
    await i18n.loadNamespaces(['requests']);
    expect(i18n.hasResourceBundle('en', 'requests')).toBe(true);
    expect(i18n.t('requests:type.moneyRequest')).toBe('Money Request');
    expect(i18n.t('requests:type.siblingMoneyRequest')).toBe('Sibling Money Request');
  });

  it('lazily loads the reversals namespace and returns English values', async () => {
    await i18n.loadNamespaces(['reversals']);
    expect(i18n.t('reversals:refunded')).toBe('Refunded');
    expect(i18n.t('reversals:actionLabel.undo')).toBe('Undo');
    expect(i18n.t('reversals:actionLabel.refund')).toBe('Refund');
    expect(i18n.t('reversals:actionLabel.cancelRequest')).toBe('Cancel request');
    expect(i18n.t('reversals:modal.loading.undo')).toBe('Undoing…');
  });
});

describe('Phase 2E — language switching returns translated values', () => {
  it('switches requests/reversals copy to Turkish', async () => {
    await i18n.loadNamespaces(['requests', 'reversals']);
    await i18n.changeLanguage('tr');
    expect(i18n.t('requests:type.moneyRequest')).toBe('Para İsteği');
    expect(i18n.t('reversals:refunded')).toBe('İade edildi');
    expect(i18n.t('reversals:actionLabel.undo')).toBe('Geri al');
    expect(i18n.t('reversals:modal.loading.refund')).toBe('İade ediliyor…');
  });

  it('falls back to English for an unsupported language', async () => {
    await i18n.loadNamespaces(['requests']);
    expect(i18n.t('requests:type.moneyRequest', { lng: 'xx' })).toBe('Money Request');
  });
});

describe('Phase 2E — interpolation and pluralization', () => {
  it('interpolates the money-request summary with a formatted amount', async () => {
    await i18n.loadNamespaces(['requests']);
    expect(
      i18n.t('requests:summary.moneyRequest', { requesterName: 'Mnalium', amount: '£5.56' }),
    ).toBe('Mnalium requested £5.56');
    await i18n.changeLanguage('tr');
    expect(
      i18n.t('requests:summary.moneyRequest', { requesterName: 'Mnalium', amount: '£5.56' }),
    ).toBe('Mnalium istedi £5.56');
  });

  it('interpolates the due-today count (singular and plural)', async () => {
    await i18n.loadNamespaces(['dashboard']);
    expect(i18n.t('dashboard:taskSummary.dueToday', { count: 1 })).toBe('1 due today');
    expect(i18n.t('dashboard:taskSummary.dueToday', { count: 3 })).toBe('3 due today');
    await i18n.changeLanguage('tr');
    expect(i18n.t('dashboard:taskSummary.dueToday', { count: 1 })).toBe('1 bugün vadesi');
  });
});

describe('Phase 2E — accessibility labels are translated', () => {
  it('translates notification and avatar filter labels', async () => {
    await i18n.loadNamespaces(['notifications', 'profile']);
    expect(i18n.t('notifications:filtersLabel')).toBe('Notification filters');
    expect(i18n.t('profile:avatar.filterLabel')).toBe('Filter avatars');
    await i18n.changeLanguage('tr');
    expect(i18n.t('notifications:filtersLabel')).toBe('Bildirim filtreleri');
    expect(i18n.t('profile:avatar.filterLabel')).toBe('Avatarları filtrele');
  });
});

describe('Phase 2E — missing-key behaviour', () => {
  it('returns the key (not null) for an unknown key when returnNull is false', async () => {
    await i18n.loadNamespaces(['requests']);
    expect(i18n.t('requests:thisKeyDoesNotExist' as any)).toBe('thisKeyDoesNotExist');
  });
});

describe('Phase 2E — formatting helper (formatPence)', () => {
  it('formats an integer minor-unit amount with the active locale', () => {
    expect(formatPence(556, 'GBP', 'en')).toBe('£5.56');
    expect(formatPence(300, 'GBP', 'en')).toBe('£3.00');
    expect(formatPence(556, 'USD', 'en')).toBe('$5.56');
  });
});

describe('Phase 2E — document direction', () => {
  it('sets lang and ltr direction for a left-to-right language', () => {
    applyDocumentDirection('tr');
    expect(document.documentElement.lang).toBe('tr');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('sets rtl direction for a right-to-left base language', () => {
    applyDocumentDirection('ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('restores the default language direction', () => {
    applyDocumentDirection(DEFAULT_LANGUAGE);
    expect(document.documentElement.lang).toBe(DEFAULT_LANGUAGE);
    expect(document.documentElement.dir).toBe('ltr');
  });
});
