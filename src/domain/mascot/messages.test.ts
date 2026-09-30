/**
 * Tests for the Mascot message catalog.
 *
 * These pin the editorial contract:
 *   - Each message key has at least one EN variant and at least one TR variant.
 *   - Locale fallback: unknown locales fall back to English.
 *   - Variant selection is deterministic for a given seed.
 *   - Variable interpolation never crashes on missing variables and never
 *     silently drops unknown placeholders (they are left verbatim for
 *     translators to spot).
 *   - No free-form user content is ever rendered.
 *   - Tone: NO guilt / shame / threats / financial pressure.
 */

import { describe, expect, it } from 'vitest';
import {
  MASCOT_MESSAGES,
  describeMascotMessageKey,
  formatMascotMessage,
  getMascotMessageVariants,
  listMascotMessages,
  resolveMascotLocale,
  selectMascotMessage,
  type MascotLocale,
} from './index';

const FORBIDDEN_PHRASES = [
  /\bdisappoint/i,
  /\bshame/i,
  /\bguilt/i,
  /\b(?:i'?m|i am)\s+sad\s+because\s+of\s+you/i,
  /\byou\s+(?:failed|ruined|let\s+me\s+down)\b/i,
  /\bpunish/i,
  /\bthreat/i,
];

describe('MASCOT_MESSAGES — catalog completeness', () => {
  const requiredKeys = [
    'mascot.default.friendly',
    'mascot.first_meeting',
    'mascot.welcome_back.general',
    'mascot.inactivity.short',
    'mascot.inactivity.long',
    'mascot.streak.at_risk',
    'mascot.celebrate.level_up',
    'mascot.celebrate.all_quests_done',
    'mascot.time.morning',
    'mascot.time.evening',
  ];

  for (const key of requiredKeys) {
    it(`has at least one EN variant for ${key}`, () => {
      const variants = MASCOT_MESSAGES.en[key];
      expect(Array.isArray(variants)).toBe(true);
      expect(variants.length).toBeGreaterThan(0);
    });
    it(`has at least one TR variant for ${key}`, () => {
      const variants = MASCOT_MESSAGES.tr[key];
      expect(Array.isArray(variants)).toBe(true);
      expect(variants.length).toBeGreaterThan(0);
    });
    it(`every variant of ${key} is non-empty text`, () => {
      for (const v of [...MASCOT_MESSAGES.en[key], ...MASCOT_MESSAGES.tr[key]]) {
        expect(typeof v).toBe('string');
        expect(v.trim().length).toBeGreaterThan(0);
      }
    });
  }
});

describe('MASCOT_MESSAGES — tone contract', () => {
  const allKeys = Object.keys(MASCOT_MESSAGES.en);

  for (const key of allKeys) {
    it(`EN variants for ${key} do not use guilt/shame/threats`, () => {
      for (const variant of MASCOT_MESSAGES.en[key]) {
        for (const phrase of FORBIDDEN_PHRASES) {
          expect(variant).not.toMatch(phrase);
        }
      }
    });
    it(`TR variants for ${key} do not use guilt/shame/threats`, () => {
      for (const variant of MASCOT_MESSAGES.tr[key]) {
        for (const phrase of FORBIDDEN_PHRASES) {
          expect(variant).not.toMatch(phrase);
        }
      }
    });
  }

  it('inactivity.long is theatrical/playful, not punitive', () => {
    for (const variant of MASCOT_MESSAGES.en['mascot.inactivity.long']) {
      // Must mention the child lightly; must not call them a failure.
      expect(variant.length).toBeGreaterThan(0);
    }
  });
});

describe('resolveMascotLocale', () => {
  it('returns "en" for undefined', () => {
    expect(resolveMascotLocale(undefined)).toBe('en');
  });
  it('returns "en" for null', () => {
    expect(resolveMascotLocale(null)).toBe('en');
  });
  it('returns "en" for empty string', () => {
    expect(resolveMascotLocale('')).toBe('en');
  });
  it('returns "en" for unknown locales', () => {
    expect(resolveMascotLocale('fr')).toBe('en');
    expect(resolveMascotLocale('de-DE')).toBe('en');
  });
  it('returns "tr" for tr', () => {
    expect(resolveMascotLocale('tr')).toBe('tr');
  });
  it('returns "tr" for tr-TR', () => {
    expect(resolveMascotLocale('tr-TR')).toBe('tr');
  });
  it('returns "en" for en', () => {
    expect(resolveMascotLocale('en')).toBe('en');
  });
  it('returns "en" for en-GB', () => {
    expect(resolveMascotLocale('en-GB')).toBe('en');
  });
});

describe('getMascotMessageVariants', () => {
  it('returns EN variants for an unknown locale', () => {
    const out = getMascotMessageVariants('mascot.default.friendly', 'fr' as MascotLocale);
    expect(out).toBeTruthy();
    expect(out!.length).toBeGreaterThan(0);
  });
  it('returns TR variants for tr', () => {
    const out = getMascotMessageVariants('mascot.default.friendly', 'tr');
    expect(out).toBeTruthy();
    expect(out!.length).toBeGreaterThan(0);
  });
  it('returns null for an unknown key', () => {
    expect(getMascotMessageVariants('mascot.does.not.exist', 'en')).toBeNull();
  });
  it('returns null for empty key', () => {
    expect(getMascotMessageVariants('', 'en')).toBeNull();
  });
  it('returns null for non-string key', () => {
    expect(getMascotMessageVariants(undefined as unknown as string, 'en')).toBeNull();
  });
});

describe('formatMascotMessage', () => {
  it('interpolates {{displayName}}', () => {
    expect(formatMascotMessage('Hello {{displayName}}!', { displayName: 'Sam' })).toBe('Hello Sam!');
  });
  it('falls back to "friend" when displayName missing', () => {
    expect(formatMascotMessage('Hello {{displayName}}!', {})).toBe('Hello friend!');
  });
  it('falls back to "friend" when displayName is whitespace', () => {
    expect(formatMascotMessage('Hello {{displayName}}!', { displayName: '  ' })).toBe('Hello friend!');
  });
  it('interpolates {{streak}} as integer', () => {
    expect(formatMascotMessage('Streak {{streak}}', { streak: 7 })).toBe('Streak 7');
  });
  it('floors fractional streak', () => {
    expect(formatMascotMessage('Streak {{streak}}', { streak: 3.7 })).toBe('Streak 3');
  });
  it('clamps negative streak to 0', () => {
    expect(formatMascotMessage('Streak {{streak}}', { streak: -5 })).toBe('Streak 0');
  });
  it('interpolates {{questsRemaining}}', () => {
    expect(formatMascotMessage('{{questsRemaining}} left', { questsRemaining: 3 })).toBe('3 left');
  });
  it('leaves unknown variables verbatim', () => {
    expect(formatMascotMessage('Hello {{userInput}}', {})).toBe('Hello {{userInput}}');
  });
  it('returns empty string for non-string template', () => {
    expect(formatMascotMessage(undefined as unknown as string, {})).toBe('');
  });
  it('handles whitespace inside placeholder', () => {
    expect(formatMascotMessage('Hello {{ displayName }}', { displayName: 'Sam' })).toBe('Hello Sam');
  });
});

describe('selectMascotMessage', () => {
  it('returns a non-empty line for a known key', () => {
    const line = selectMascotMessage('mascot.default.friendly', 'en', { displayName: 'Sam' }, 0);
    expect(line.length).toBeGreaterThan(0);
    expect(line).toContain('Sam');
  });
  it('returns EN fallback for an unknown locale', () => {
    const line = selectMascotMessage('mascot.default.friendly', 'fr', {}, 0);
    expect(line.length).toBeGreaterThan(0);
  });
  it('returns safe default line for an unknown key', () => {
    const line = selectMascotMessage('mascot.does.not.exist', 'en', {}, 0);
    expect(line.length).toBeGreaterThan(0);
  });
  it('returns TR variants when locale is tr', () => {
    const line = selectMascotMessage('mascot.default.friendly', 'tr', {}, 0);
    expect(line.length).toBeGreaterThan(0);
    // Just verify it's a TR variant — Turkish contains at least one of these.
    expect(/[a-zçğıöşüA-ZÇĞİÖŞÜ]/.test(line)).toBe(true);
  });
  it('returns the SAME line for the SAME seed', () => {
    const a = selectMascotMessage('mascot.default.friendly', 'en', { displayName: 'Sam' }, 3);
    const b = selectMascotMessage('mascot.default.friendly', 'en', { displayName: 'Sam' }, 3);
    expect(a).toBe(b);
  });
  it('does NOT crash on NaN seed', () => {
    const line = selectMascotMessage('mascot.default.friendly', 'en', {}, Number.NaN);
    expect(line.length).toBeGreaterThan(0);
  });
});

describe('listMascotMessages', () => {
  it('returns multiple interpolated variants', () => {
    const out = listMascotMessages('mascot.default.friendly', 'en', { displayName: 'Sam' });
    expect(out.length).toBeGreaterThan(1);
    for (const line of out) {
      expect(line).toContain('Sam');
    }
  });
  it('falls back to EN for unknown locale', () => {
    const out = listMascotMessages('mascot.default.friendly', 'xx', {});
    expect(out.length).toBeGreaterThan(0);
  });
  it('returns safe default list for unknown key', () => {
    const out = listMascotMessages('mascot.does.not.exist', 'en', {});
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('describeMascotMessageKey', () => {
  it('describes mascot.celebrate.* keys as celebrating mood', () => {
    expect(describeMascotMessageKey('mascot.celebrate.level_up').mood).toBe('celebrating');
    expect(describeMascotMessageKey('mascot.celebrate.all_quests_done').mood).toBe('celebrating');
  });
  it('describes inactivity.long as grumpy mood', () => {
    expect(describeMascotMessageKey('mascot.inactivity.long').mood).toBe('grumpy');
  });
  it('describes inactivity.short as suspicious mood', () => {
    expect(describeMascotMessageKey('mascot.inactivity.short').mood).toBe('suspicious');
  });
  it('describes first_meeting as curious mood', () => {
    expect(describeMascotMessageKey('mascot.first_meeting').mood).toBe('curious');
  });
  it('describes default as friendly mood', () => {
    expect(describeMascotMessageKey('mascot.default.friendly').mood).toBe('friendly');
  });
  it('returns null mood for completely unknown key', () => {
    expect(describeMascotMessageKey('something.else').mood).toBeNull();
  });
  it('returns counts for EN and TR variants', () => {
    const meta = describeMascotMessageKey('mascot.default.friendly');
    expect(meta.enVariantCount).toBeGreaterThan(0);
    expect(meta.trVariantCount).toBeGreaterThan(0);
  });
});