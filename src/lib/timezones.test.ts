import { describe, expect, it, vi } from 'vitest';
import { getTimezoneOptions } from './timezones';

describe('timezone options', () => {
  it('includes canonical Europe/Istanbul and broad regional coverage', () => {
    const values = getTimezoneOptions('en', 'Europe/London').map(option => option.value);
    expect(values).toContain('Europe/Istanbul');
    expect(values.some(value => value.startsWith('America/'))).toBe(true);
    expect(values.some(value => value.startsWith('Asia/'))).toBe(true);
    expect(values.some(value => value.startsWith('Africa/'))).toBe(true);
    expect(values.some(value => value.startsWith('Australia/'))).toBe(true);
  });

  it('retains an existing valid canonical value omitted by enumeration', () => {
    const supportedValuesOf = (Intl as any).supportedValuesOf;
    (Intl as any).supportedValuesOf = vi.fn(() => ['Europe/London']);
    try {
      expect(getTimezoneOptions('en', 'Pacific/Auckland').map(option => option.value))
        .toContain('Pacific/Auckland');
    } finally {
      (Intl as any).supportedValuesOf = supportedValuesOf;
    }
  });

  it('uses canonical IDs as values and friendly labels', () => {
    const istanbul = getTimezoneOptions('en').find(option => option.value === 'Europe/Istanbul');
    expect(istanbul).toEqual(expect.objectContaining({
      value: 'Europe/Istanbul',
      label: expect.stringContaining('Istanbul'),
    }));
  });
});
