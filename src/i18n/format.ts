import i18n from './config';

/**
 * Locale-aware formatting helpers built on the standard `Intl` APIs.
 *
 * Each helper accepts an optional explicit `locale`. When omitted it falls back
 * to the active i18next language, so future locale-aware formatting requires no
 * component rewrites — just call `formatCurrency(amount, 'USD')` and the active
 * language is used automatically.
 */
function resolveLocale(locale?: string): string {
  if (locale) return locale;
  if (typeof i18n !== 'undefined' && i18n.language) return i18n.language;
  return 'en';
}

export function formatNumber(
  value: number,
  locale?: string,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(resolveLocale(locale), options).format(value);
}

export function formatCurrency(
  amount: number,
  currency: string,
  locale?: string,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(resolveLocale(locale), {
    style: 'currency',
    currency,
    ...options,
  }).format(amount);
}

/**
 * Convenience wrapper for the canonical storage unit used across the app:
 * amounts are kept in integer pence. Divides by 100 before delegating to
 * `formatCurrency` so callers can pass the raw stored value directly.
 */
export function formatPence(
  pence: number,
  currency: string,
  locale?: string,
  options?: Intl.NumberFormatOptions,
): string {
  return formatCurrency(pence / 100, currency, locale, options);
}

export function formatDate(
  value: Date | number | string,
  locale?: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(resolveLocale(locale), options).format(date);
}

const RELATIVE_DIVISIONS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 60 * 60 * 24 * 365],
  ['month', 60 * 60 * 24 * 30],
  ['week', 60 * 60 * 24 * 7],
  ['day', 60 * 60 * 24],
  ['hour', 60 * 60],
  ['minute', 60],
  ['second', 1],
];

export function formatRelativeTime(
  value: Date | number | string,
  locale?: string,
  now: Date = new Date(),
): string {
  const date = value instanceof Date ? value : new Date(value);
  const rtf = new Intl.RelativeTimeFormat(resolveLocale(locale), { numeric: 'auto' });
  const diffSeconds = (date.getTime() - now.getTime()) / 1000;
  for (const [unit, amount] of RELATIVE_DIVISIONS) {
    if (Math.abs(diffSeconds) >= amount || unit === 'second') {
      return rtf.format(Math.round(diffSeconds / amount), unit);
    }
  }
  return rtf.format(Math.round(diffSeconds), 'second');
}

/**
 * Map a display currency symbol (as stored on `familyData.currency`) to its
 * ISO 4217 code so `Intl.NumberFormat` can format amounts locale-aware.
 * Unknown / missing symbols fall back to GBP to keep the UI functional.
 */
export type SupportedCurrencyCode = 'GBP' | 'EUR' | 'USD' | 'TRY';

const SUPPORTED_CURRENCY_CODES: readonly SupportedCurrencyCode[] = ['GBP', 'EUR', 'USD', 'TRY'];

const SYMBOL_TO_CURRENCY_CODE: Record<string, SupportedCurrencyCode> = {
  '£': 'GBP',
  $: 'USD',
  '€': 'EUR',
  '₺': 'TRY',
};

const CURRENCY_CODE_TO_SYMBOL: Record<SupportedCurrencyCode, string> = {
  GBP: '£',
  EUR: '€',
  USD: '$',
  TRY: '₺',
};

const isSupportedCurrencyCode = (value: unknown): value is SupportedCurrencyCode =>
  typeof value === 'string' && SUPPORTED_CURRENCY_CODES.includes(value as SupportedCurrencyCode);

function normalizeLegacyCurrency(value: unknown): SupportedCurrencyCode | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const symbolCode = SYMBOL_TO_CURRENCY_CODE[trimmed];
  if (symbolCode) return symbolCode;
  const legacyCode = trimmed.toUpperCase();
  return isSupportedCurrencyCode(legacyCode) ? legacyCode : null;
}

/**
 * Resolve the family's canonical ISO currency code without mutating legacy data.
 * A strictly valid currencyCode wins; otherwise the legacy currency symbol/code
 * is normalized, and unsupported or missing values deterministically use GBP.
 */
export function resolveFamilyCurrencyCode(
  family?: { currencyCode?: unknown; currency?: unknown } | null,
): SupportedCurrencyCode {
  if (isSupportedCurrencyCode(family?.currencyCode)) return family.currencyCode;
  return normalizeLegacyCurrency(family?.currency) ?? 'GBP';
}

export function currencyCodeFromSymbol(symbol?: string): SupportedCurrencyCode {
  return normalizeLegacyCurrency(symbol) ?? 'GBP';
}

export function currencySymbolFromCode(currencyCode: SupportedCurrencyCode): string {
  return CURRENCY_CODE_TO_SYMBOL[currencyCode];
}
