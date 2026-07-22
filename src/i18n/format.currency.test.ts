import { describe, expect, it } from 'vitest';
import {
  currencyCodeFromSymbol,
  currencySymbolFromCode,
  formatPence,
  resolveFamilyCurrencyCode,
} from './format';

describe('resolveFamilyCurrencyCode', () => {
  it.each(['GBP', 'EUR', 'USD', 'TRY'] as const)(
    'uses a valid canonical family currencyCode (%s)',
    currencyCode => {
      expect(resolveFamilyCurrencyCode({ currencyCode, currency: '$' })).toBe(currencyCode);
    },
  );

  it.each([
    ['£', 'GBP'],
    ['GBP', 'GBP'],
    ['€', 'EUR'],
    ['eur', 'EUR'],
    ['$', 'USD'],
    ['usd', 'USD'],
    ['₺', 'TRY'],
    ['try', 'TRY'],
  ] as const)('normalizes legacy family.currency %s to %s', (legacyCurrency, expected) => {
    expect(resolveFamilyCurrencyCode({ currency: legacyCurrency })).toBe(expected);
  });

  it('ignores an invalid canonical value and falls back to a valid legacy value', () => {
    expect(resolveFamilyCurrencyCode({ currencyCode: 'try', currency: '€' })).toBe('EUR');
  });

  it.each([undefined, null, '', 'CAD', '¥', 123])(
    'falls back to GBP for missing or unsupported family data (%s)',
    currency => {
      expect(resolveFamilyCurrencyCode({ currency })).toBe('GBP');
    },
  );

  it('falls back to GBP when family data is missing', () => {
    expect(resolveFamilyCurrencyCode()).toBe('GBP');
  });
});

describe('currency compatibility formatting', () => {
  it('keeps integer minor units unchanged when formatting', () => {
    expect(formatPence(1_234, resolveFamilyCurrencyCode({ currencyCode: 'GBP' }), 'en-GB')).toBe('£12.34');
  });

  it('keeps legacy symbol conversion compatible and exposes canonical symbols', () => {
    expect(currencyCodeFromSymbol('₺')).toBe('TRY');
    expect(currencyCodeFromSymbol('TRY')).toBe('TRY');
    expect(currencySymbolFromCode('TRY')).toBe('₺');
    expect(currencySymbolFromCode('GBP')).toBe('£');
  });
});
