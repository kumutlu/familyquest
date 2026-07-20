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
