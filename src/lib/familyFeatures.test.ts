import { describe, expect, it } from 'vitest';
import { isPetBoxEnabled } from './familyFeatures';

describe('Pet Box family feature resolver', () => {
  it('keeps legacy families enabled when the field is missing', () => {
    expect(isPetBoxEnabled(null)).toBe(true);
    expect(isPetBoxEnabled({})).toBe(true);
  });

  it('only disables Pet Box for explicit false', () => {
    expect(isPetBoxEnabled({ petBoxEnabled: true })).toBe(true);
    expect(isPetBoxEnabled({ petBoxEnabled: false })).toBe(false);
  });
});
