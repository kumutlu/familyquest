/// <reference types="node" />
/**
 * Tests for the experience-theme resolver.
 *
 * Each test pins ONE precedence case from the spec:
 *   1. Base only                          → base
 *   2. Base + weekly                      → weekly
 *   3. Base + weekly + enabled seasonal   → seasonal
 *   4. Base + weekly + disabled seasonal  → weekly
 *   5. Equipped child override            → equipped
 *   6. Expired seasonal                   → ignored (weekly wins)
 *   7. Future seasonal                    → ignored (weekly wins)
 *   8. Ramadan disabled                   → ignored
 *   9. Unknown event theme id             → safe base + diagnostic
 *  10. Unknown future celebration         → safe base
 *  11. weeklyThemes=false                 → disables weekly layer
 */

import { describe, expect, it } from 'vitest';
import {
  CHRISTMAS_EVENT_2026,
  CHRISTMAS_THEME,
  EID_THEME,
  EVENT_CATALOG,
  HALLOWEEN_EVENT_2026,
  HALLOWEEN_THEME,
  NEON_WEEK_EVENT,
  NEON_WEEK_THEME,
  RAMADAN_EVENT_2026,
  STANDARD_THEME,
  THEME_CATALOG,
  type EventDefinition,
  type ExperiencePreferences,
  resolveExperienceTheme,
  isEventLive,
  isPreferenceEnabled,
  normaliseExperiencePreferences,
  pickLiveSeasonalEvent,
  pickLiveWeeklyEvent,
} from './index';

const PREFS_ALL_ON: ExperiencePreferences = normaliseExperiencePreferences({
  weeklyThemes: true,
  seasonalEvents: { christmas: true, halloween: true, ramadan: true, eid: true },
});

function liveChristmas(now: number): EventDefinition {
  return { ...CHRISTMAS_EVENT_2026, startsAt: now - 1000, endsAt: now + 1000 };
}
function liveWeekly(now: number): EventDefinition {
  return { ...NEON_WEEK_EVENT, startsAt: now - 1000, endsAt: now + 1000 };
}
function liveRamadan(now: number): EventDefinition {
  return { ...RAMADAN_EVENT_2026, startsAt: now - 1000, endsAt: now + 1000 };
}

describe('resolveExperienceTheme — precedence', () => {
  const now = Date.UTC(2026, 11, 15, 12, 0, 0);

  it('1) base only → base', () => {
    const out = resolveExperienceTheme({
      baseTheme: STANDARD_THEME,
      preferences: PREFS_ALL_ON,
      now,
      themes: THEME_CATALOG,
    });
    expect(out.theme.id).toBe(STANDARD_THEME.id);
    expect(out.source).toBe('base');
    expect(out.appliedEventName).toBeNull();
  });

  it('2) base + weekly → weekly', () => {
    const out = resolveExperienceTheme({
      baseTheme: STANDARD_THEME,
      weeklyEvent: liveWeekly(now),
      preferences: PREFS_ALL_ON,
      now,
      themes: THEME_CATALOG,
    });
    expect(out.theme.id).toBe(NEON_WEEK_THEME.id);
    expect(out.source).toBe('weekly');
    expect(out.appliedEventName).toBe(NEON_WEEK_EVENT.name);
  });

  it('3) base + weekly + enabled seasonal → seasonal', () => {
    const out = resolveExperienceTheme({
      baseTheme: STANDARD_THEME,
      weeklyEvent: liveWeekly(now),
      seasonalEvent: liveChristmas(now),
      preferences: PREFS_ALL_ON,
      now,
      themes: THEME_CATALOG,
    });
    expect(out.theme.id).toBe(CHRISTMAS_THEME.id);
    expect(out.source).toBe('seasonal');
    expect(out.appliedEventName).toBe(CHRISTMAS_EVENT_2026.name);
  });

  it('4) base + weekly + DISABLED seasonal → weekly', () => {
    const prefs = normaliseExperiencePreferences({
      weeklyThemes: true,
      seasonalEvents: { christmas: false },
    });
    const out = resolveExperienceTheme({
      baseTheme: STANDARD_THEME,
      weeklyEvent: liveWeekly(now),
      seasonalEvent: liveChristmas(now),
      preferences: prefs,
      now,
      themes: THEME_CATALOG,
    });
    expect(out.theme.id).toBe(NEON_WEEK_THEME.id);
    expect(out.source).toBe('weekly');
  });

  it('5) equipped child override wins over seasonal + weekly + base', () => {
    const out = resolveExperienceTheme({
      baseTheme: STANDARD_THEME,
      weeklyEvent: liveWeekly(now),
      seasonalEvent: liveChristmas(now),
      equipped: { themeId: EID_THEME.id },
      preferences: PREFS_ALL_ON,
      now,
      themes: THEME_CATALOG,
    });
    expect(out.theme.id).toBe(EID_THEME.id);
    expect(out.source).toBe('equipped');
    expect(out.appliedEventName).toBeNull();
  });

  it('6) expired seasonal event is ignored → weekly still applies', () => {
    const expired: EventDefinition = {
      ...liveChristmas(now),
      endsAt: now - 1,
    };
    const out = resolveExperienceTheme({
      baseTheme: STANDARD_THEME,
      weeklyEvent: liveWeekly(now),
      seasonalEvent: expired,
      preferences: PREFS_ALL_ON,
      now,
      themes: THEME_CATALOG,
    });
    expect(out.theme.id).toBe(NEON_WEEK_THEME.id);
    expect(out.source).toBe('weekly');
  });

  it('7) future seasonal event is ignored → weekly still applies', () => {
    const future: EventDefinition = {
      ...liveChristmas(now),
      startsAt: now + 60_000,
      endsAt: now + 120_000,
    };
    const out = resolveExperienceTheme({
      baseTheme: STANDARD_THEME,
      weeklyEvent: liveWeekly(now),
      seasonalEvent: future,
      preferences: PREFS_ALL_ON,
      now,
      themes: THEME_CATALOG,
    });
    expect(out.theme.id).toBe(NEON_WEEK_THEME.id);
    expect(out.source).toBe('weekly');
  });

  it('8) Ramadan disabled → Ramadan event ignored, weekly wins', () => {
    const prefs = normaliseExperiencePreferences({
      weeklyThemes: true,
      seasonalEvents: { ramadan: false },
    });
    const out = resolveExperienceTheme({
      baseTheme: STANDARD_THEME,
      weeklyEvent: liveWeekly(now),
      seasonalEvent: liveRamadan(now),
      preferences: prefs,
      now,
      themes: THEME_CATALOG,
    });
    expect(out.theme.id).toBe(NEON_WEEK_THEME.id);
    expect(out.source).toBe('weekly');
  });

  it('9) themed event pointing at a non-existent theme falls back to base safely', () => {
    const brokenEvent: EventDefinition = {
      ...liveChristmas(now),
      themeId: 'theme.does-not-exist',
    };
    const out = resolveExperienceTheme({
      baseTheme: STANDARD_THEME,
      weeklyEvent: null,
      seasonalEvent: brokenEvent,
      preferences: PREFS_ALL_ON,
      now,
      themes: THEME_CATALOG,
    });
    expect(out.theme.id).toBe(STANDARD_THEME.id);
    expect(out.source).toBe('unknown-event-theme');
    // Applied event name is still surfaced for diagnostics.
    expect(out.appliedEventName).toBe(CHRISTMAS_EVENT_2026.name);
  });

  it('10) completely unknown future celebration (e.g. Diwali) without a preference gate is opt-in neutral', () => {
    // An event without a preferenceKey is opt-in neutral: the resolver
    // accepts it. Adding Diwali requires NO schema change.
    const diwali: EventDefinition = {
      id: 'event.diwali.2027',
      type: 'seasonal',
      name: 'Diwali 2027',
      startsAt: now - 1000,
      endsAt: now + 1000,
      status: 'active',
    };
    const out = resolveExperienceTheme({
      baseTheme: STANDARD_THEME,
      weeklyEvent: null,
      seasonalEvent: diwali,
      preferences: normaliseExperiencePreferences(null),
      now,
      themes: THEME_CATALOG,
    });
    // No themeId is attached (which is legal): the seasonal layer is
    // recognised, the theme falls back to base because no theme to apply.
    expect(out.theme.id).toBe(STANDARD_THEME.id);
    expect(out.source).toBe('seasonal');
    expect(out.appliedEventName).toBe('Diwali 2027');
  });

  it('10b) completely unknown future celebration with a preference gate is denied by default', () => {
    // Adding a new preferenceKey the family hasn't opted in to MUST
    // not silently enable the event.
    const diwali: EventDefinition = {
      id: 'event.diwali.2027',
      type: 'seasonal',
      name: 'Diwali 2027',
      startsAt: now - 1000,
      endsAt: now + 1000,
      status: 'active',
      eligibility: { preferenceKey: 'diwali' },
    };
    const out = resolveExperienceTheme({
      baseTheme: STANDARD_THEME,
      weeklyEvent: null,
      seasonalEvent: diwali,
      preferences: normaliseExperiencePreferences({
        weeklyThemes: true,
        seasonalEvents: {},
      }),
      now,
      themes: THEME_CATALOG,
    });
    expect(out.theme.id).toBe(STANDARD_THEME.id);
    expect(out.source).toBe('base');
  });

  it('11) draft / scheduled / ended events are never applied', () => {
    const draft: EventDefinition = { ...liveChristmas(now), status: 'draft' };
    const scheduled: EventDefinition = { ...liveChristmas(now), status: 'scheduled' };
    const ended: EventDefinition = { ...liveChristmas(now), status: 'ended' };
    for (const evt of [draft, scheduled, ended]) {
      const out = resolveExperienceTheme({
        baseTheme: STANDARD_THEME,
        seasonalEvent: evt,
        preferences: PREFS_ALL_ON,
        now,
        themes: THEME_CATALOG,
      });
      expect(out.source).toBe('base');
    }
  });

  it('12) weeklyThemes preference=false disables the weekly layer', () => {
    const prefs = normaliseExperiencePreferences({
      weeklyThemes: false,
      seasonalEvents: {},
    });
    const out = resolveExperienceTheme({
      baseTheme: STANDARD_THEME,
      weeklyEvent: liveWeekly(now),
      preferences: prefs,
      now,
      themes: THEME_CATALOG,
    });
    expect(out.theme.id).toBe(STANDARD_THEME.id);
    expect(out.source).toBe('base');
  });

  it('13) no theme catalog entries → still returns a valid theme object', () => {
    const out = resolveExperienceTheme({
      baseTheme: STANDARD_THEME,
      preferences: PREFS_ALL_ON,
      now,
      themes: [],
    });
    expect(out.theme.id).toBe(STANDARD_THEME.id);
    expect(out.source).toBe('base');
  });

  it('14) malformed event (endsAt <= startsAt) is rejected as inactive', () => {
    const malformed: EventDefinition = {
      ...liveChristmas(now),
      startsAt: now + 1000,
      endsAt: now - 1000,
    };
    const out = resolveExperienceTheme({
      baseTheme: STANDARD_THEME,
      seasonalEvent: malformed,
      preferences: PREFS_ALL_ON,
      now,
      themes: THEME_CATALOG,
    });
    expect(out.source).toBe('base');
  });
});

describe('isEventLive', () => {
  it('treats draft/scheduled/ended as inactive', () => {
    const now = 1_000;
    for (const status of ['draft', 'scheduled', 'ended'] as const) {
      expect(
        isEventLive({ ...CHRISTMAS_EVENT_2026, status, startsAt: now - 1, endsAt: now + 1 }, now),
      ).toBe(false);
    }
  });

  it('treats out-of-window events as inactive', () => {
    const future = { ...CHRISTMAS_EVENT_2026, startsAt: 2000, endsAt: 3000, status: 'active' as const };
    expect(isEventLive(future, 1000)).toBe(false);
  });
});

describe('isPreferenceEnabled', () => {
  const prefs = normaliseExperiencePreferences({
    weeklyThemes: true,
    seasonalEvents: { christmas: true, ramadan: false },
  });

  it('returns true for opted-in keys', () => {
    expect(isPreferenceEnabled(prefs, 'christmas')).toBe(true);
  });

  it('returns false for opted-out keys', () => {
    expect(isPreferenceEnabled(prefs, 'ramadan')).toBe(false);
  });

  it('returns false for unknown keys (deny by default)', () => {
    expect(isPreferenceEnabled(prefs, 'diwali')).toBe(false);
  });

  it('returns true when preferenceKey is undefined (no opt-in required)', () => {
    expect(isPreferenceEnabled(prefs, undefined)).toBe(true);
  });
});

describe('pickLiveSeasonalEvent / pickLiveWeeklyEvent', () => {
  const now = Date.UTC(2026, 11, 15, 12, 0, 0);
  const prefs = normaliseExperiencePreferences({
    weeklyThemes: true,
    seasonalEvents: { christmas: true },
  });

  it('pickLiveSeasonalEvent honours window + preference + status', () => {
    const live = liveChristmas(now);
    const result = pickLiveSeasonalEvent([live], prefs, now);
    expect(result?.id).toBe(live.id);
  });

  it('pickLiveSeasonalEvent ignores weekly events', () => {
    const result = pickLiveSeasonalEvent([liveWeekly(now)], prefs, now);
    expect(result).toBeNull();
  });

  it('pickLiveWeeklyEvent honours weeklyThemes preference', () => {
    const result = pickLiveWeeklyEvent([liveWeekly(now)], prefs, now);
    expect(result?.id).toBe(NEON_WEEK_EVENT.id);
    const offPrefs = normaliseExperiencePreferences({ weeklyThemes: false, seasonalEvents: {} });
    const offResult = pickLiveWeeklyEvent([liveWeekly(now)], offPrefs, now);
    expect(offResult).toBeNull();
  });
});

describe('normaliseExperiencePreferences', () => {
  it('returns defaults for null input', () => {
    const out = normaliseExperiencePreferences(null);
    expect(out.weeklyThemes).toBe(true);
    expect(out.seasonalEvents).toEqual({});
  });

  it('preserves an explicit opt-out', () => {
    const out = normaliseExperiencePreferences({
      weeklyThemes: true,
      seasonalEvents: { ramadan: false },
    });
    expect(out.seasonalEvents.ramadan).toBe(false);
  });
});

describe('event catalog fixtures', () => {
  it('Christmas and Halloween are mutually exclusive in 2026 windows', () => {
    const dec = Date.UTC(2026, 11, 15, 12, 0, 0);
    const oct = Date.UTC(2026, 9, 28, 12, 0, 0);
    // In December, only Christmas is live.
    expect(pickLiveSeasonalEvent([CHRISTMAS_EVENT_2026, HALLOWEEN_EVENT_2026], PREFS_ALL_ON, dec)?.id).toBe(CHRISTMAS_EVENT_2026.id);
    // In October, only Halloween is live.
    expect(pickLiveSeasonalEvent([CHRISTMAS_EVENT_2026, HALLOWEEN_EVENT_2026], PREFS_ALL_ON, oct)?.id).toBe(HALLOWEEN_EVENT_2026.id);
  });

  it('Ramadan is gated by the ramadan preference key', () => {
    const now = RAMADAN_EVENT_2026.startsAt + 1000;
    const onPrefs = normaliseExperiencePreferences({
      weeklyThemes: true,
      seasonalEvents: { ramadan: true },
    });
    const offPrefs = normaliseExperiencePreferences({
      weeklyThemes: true,
      seasonalEvents: { ramadan: false },
    });
    expect(pickLiveSeasonalEvent([RAMADAN_EVENT_2026], onPrefs, now)?.id).toBe(RAMADAN_EVENT_2026.id);
    expect(pickLiveSeasonalEvent([RAMADAN_EVENT_2026], offPrefs, now)).toBeNull();
  });

  it('catalog exports include at least one weekly + four seasonal events', () => {
    const seasonal = EVENT_CATALOG.filter((e) => e.type === 'seasonal');
    const weekly = EVENT_CATALOG.filter((e) => e.type === 'weekly_theme');
    expect(weekly.length).toBeGreaterThanOrEqual(1);
    expect(seasonal.length).toBeGreaterThanOrEqual(4);
  });

  it('HalLOWEEN_THEME and CHRISTMAS_THEME are distinct catalog entries', () => {
    expect(HALLOWEEN_THEME.id).not.toBe(CHRISTMAS_THEME.id);
    expect(HALLOWEEN_THEME.category).toBe('seasonal');
  });
});

/**
 * Safety boundary: the resolver MUST NOT mint points, XP, or wallet value.
 * The module is pure (no Firestore / no zustand / no Date.now default) and
 * the tests audit its source to prove no currency side-effects.
 */
describe('safety: no gamification side-effects', () => {
  it('the resolver module never mentions point-minting helpers', async () => {
    const fs = await import('node:fs');
    const resolverSource = fs.readFileSync('src/domain/experience/resolver.ts', 'utf8');
    const typesSource = fs.readFileSync('src/domain/experience/types.ts', 'utf8');
    for (const src of [resolverSource, typesSource]) {
      expect(src).not.toMatch(/mintPoints|awardXp|debitWallet/);
    }
  });

  it('the hook module never imports firebase or zustand', async () => {
    const fs = await import('node:fs');
    const hookSource = fs.readFileSync('src/hooks/useExperienceTheme.ts', 'utf8');
    expect(hookSource).not.toMatch(/from ['"]firebase/);
    expect(hookSource).not.toMatch(/from ['"]\.\.\/store\/useStore/);
    expect(hookSource).not.toMatch(/from ['"]zustand/);
  });
});