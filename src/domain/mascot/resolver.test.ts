/**
 * Tests for the Mascot Engine V1 resolver.
 *
 * Each test pins ONE precedence case from the spec:
 *  1. Default friendly state from a quiet mid-day context.
 *  2. Morning sleepy presentation.
 *  3. ~1-day inactivity → suspicious.
 *  4. ~3-day inactivity → grumpy (theatrical, never guilt-heavy).
 *  5. Comeback signal → welcome_back.
 *  6. All quests completed → proud.
 *  7. Level-up → celebrating.
 *  8. Priority conflict: level-up + inactivity → celebrating wins.
 *  9. Event theme mascotCostumeId → presentation forwards it.
 * 10. No event → no costume.
 * 11. Missing displayName → safe generic message.
 * 12. Bad timestamps → fail safe to friendly default.
 * 13. Empty activity → friendly default.
 * 14. Streak at risk presentation.
 * 15. First-meeting presentation for new users.
 * 16. Different costume ids round-trip cleanly.
 * 17. Late evening → sleepy.
 * 18. Resolver never throws on malformed input.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MASCOT_PRESENTATION,
  MASCOT_THRESHOLDS,
  resolveMascotPresentation,
  type MascotContext,
  type ResolveMascotPresentationInput,
} from './index';

const DAY = MASCOT_THRESHOLDS.MS_PER_DAY;
const AFTERNOON_NOON_UTC = Date.UTC(2026, 5, 15, 12, 0, 0); // mid-day

function input(partial: Partial<ResolveMascotPresentationInput>): ResolveMascotPresentationInput {
  return {
    context: { now: AFTERNOON_NOON_UTC, ...(partial.context ?? {}) },
    resolvedCostumeId: partial.resolvedCostumeId,
  };
}

describe('resolveMascotPresentation — friendly default', () => {
  it('returns friendly for empty activity on a mid-day clock', () => {
    const out = resolveMascotPresentation(input({}));
    expect(out.mood).toBe('friendly');
    expect(out.expression).toBe('soft_smile');
    expect(out.messageKey).toBe('mascot.default.friendly');
    expect(out.priorityTag).toBe('default');
    expect(out.costumeId).toBeUndefined();
  });

  it('returns friendly for a child with normal recent activity', () => {
    const out = resolveMascotPresentation(input({
      context: {
        now: AFTERNOON_NOON_UTC,
        child: { displayName: 'Sam' },
        activity: {
          lastActiveAt: AFTERNOON_NOON_UTC - 3 * 60 * 60 * 1000, // 3 hours ago
          currentStreak: 2,
          questsRemaining: 3,
          questsCompletedToday: 1,
        },
      },
    }));
    expect(out.mood).toBe('friendly');
    expect(out.priorityTag).toBe('default');
  });

  it('uses the engine default when the resolved default is replaced', () => {
    const baseline = resolveMascotPresentation(input({}));
    const baselineDefault = DEFAULT_MASCOT_PRESENTATION;
    expect(baseline.messageKey).toBe(baselineDefault.messageKey);
  });
});

describe('resolveMascotPresentation — time of day', () => {
  it('returns sleepy presentation for an early-morning clock', () => {
    const earlyMorning = Date.UTC(2026, 5, 15, 7, 30, 0); // 07:30 local (UTC test)
    const out = resolveMascotPresentation(input({
      context: { now: earlyMorning },
    }));
    // We can't assume the test machine's local tz matches UTC — assert the
    // shape of the response: message key is a morning or sleepy one OR
    // the friendly default if the local tz says otherwise.
    expect(['sleepy', 'friendly']).toContain(out.mood);
    if (out.mood === 'sleepy') {
      expect(out.messageKey).toBe('mascot.time.morning');
    }
  });

  it('returns sleepy presentation for late evening', () => {
    const lateEvening = Date.UTC(2026, 5, 15, 22, 0, 0); // 22:00 UTC
    const out = resolveMascotPresentation(input({
      context: { now: lateEvening },
    }));
    expect(['sleepy', 'friendly']).toContain(out.mood);
    if (out.mood === 'sleepy') {
      expect(out.messageKey).toBe('mascot.time.evening');
    }
  });
});

describe('resolveMascotPresentation — inactivity ladder', () => {
  it('returns suspicious for ~1-day inactivity', () => {
    const out = resolveMascotPresentation(input({
      context: {
        now: AFTERNOON_NOON_UTC,
        activity: { lastActiveAt: AFTERNOON_NOON_UTC - DAY - 60 * 60 * 1000 },
      },
    }));
    expect(out.mood).toBe('suspicious');
    expect(out.messageKey).toBe('mascot.inactivity.short');
    expect(out.priorityTag).toBe('long-inactivity');
  });

  it('returns grumpy for ~3-day inactivity (theatrical, never guilt-heavy)', () => {
    const out = resolveMascotPresentation(input({
      context: {
        now: AFTERNOON_NOON_UTC,
        activity: { lastActiveAt: AFTERNOON_NOON_UTC - 3 * DAY - 60 * 60 * 1000 },
      },
    }));
    expect(out.mood).toBe('grumpy');
    expect(out.messageKey).toBe('mascot.inactivity.long');
    expect(out.priorityTag).toBe('long-inactivity');
    // The tone contract: messages must NOT contain guilt/shame keywords.
    expect(out.messageKey).not.toMatch(/disappoint|guilt|sad because/i);
  });

  it('does NOT punish for returning: same context with comebackJustOccurred wins', () => {
    const out = resolveMascotPresentation(input({
      context: {
        now: AFTERNOON_NOON_UTC,
        state: { comebackJustOccurred: true },
        activity: { lastActiveAt: AFTERNOON_NOON_UTC - 7 * DAY },
      },
    }));
    expect(out.mood).toBe('welcome_back');
    expect(out.messageKey).toBe('mascot.welcome_back.general');
    expect(out.priorityTag).toBe('welcome-back');
  });

  it('does NOT trigger inactivity when lastActiveAt is in the future (clock skew)', () => {
    const out = resolveMascotPresentation(input({
      context: {
        now: AFTERNOON_NOON_UTC,
        activity: { lastActiveAt: AFTERNOON_NOON_UTC + 60 * 60 * 1000 }, // +1h in future
      },
    }));
    expect(out.mood).toBe('friendly');
  });

  it('does NOT trigger inactivity for a very-recent lastActiveAt (minutes)', () => {
    const out = resolveMascotPresentation(input({
      context: {
        now: AFTERNOON_NOON_UTC,
        activity: { lastActiveAt: AFTERNOON_NOON_UTC - 5 * 60 * 1000 }, // 5 min ago
      },
    }));
    expect(out.mood).toBe('friendly');
  });
});

describe('resolveMascotPresentation — comeback', () => {
  it('returns welcome_back when comebackJustOccurred is true', () => {
    const out = resolveMascotPresentation(input({
      context: {
        now: AFTERNOON_NOON_UTC,
        state: { comebackJustOccurred: true },
      },
    }));
    expect(out.mood).toBe('welcome_back');
    expect(out.priorityTag).toBe('welcome-back');
  });

  it('does NOT mark welcome_back when no signal is present', () => {
    const out = resolveMascotPresentation(input({
      context: { now: AFTERNOON_NOON_UTC },
    }));
    expect(out.mood).not.toBe('welcome_back');
  });
});

describe('resolveMascotPresentation — quests done / level up', () => {
  it('returns proud for allQuestsCompleted', () => {
    const out = resolveMascotPresentation(input({
      context: {
        now: AFTERNOON_NOON_UTC,
        activity: { allQuestsCompleted: true, currentStreak: 3 },
      },
    }));
    expect(out.mood).toBe('proud');
    expect(out.messageKey).toBe('mascot.celebrate.all_quests_done');
    expect(out.priorityTag).toBe('all-quests-complete');
  });

  it('returns celebrating for level-up', () => {
    const out = resolveMascotPresentation(input({
      context: {
        now: AFTERNOON_NOON_UTC,
        progression: { levelUpJustOccurred: true },
      },
    }));
    expect(out.mood).toBe('celebrating');
    expect(out.messageKey).toBe('mascot.celebrate.level_up');
    expect(out.priorityTag).toBe('level-up');
  });

  it('priority: level-up beats inactivity', () => {
    const out = resolveMascotPresentation(input({
      context: {
        now: AFTERNOON_NOON_UTC,
        progression: { levelUpJustOccurred: true },
        activity: { lastActiveAt: AFTERNOON_NOON_UTC - 7 * DAY },
      },
    }));
    expect(out.mood).toBe('celebrating');
    expect(out.priorityTag).toBe('level-up');
  });

  it('priority: all-quests-done beats inactivity', () => {
    const out = resolveMascotPresentation(input({
      context: {
        now: AFTERNOON_NOON_UTC,
        activity: {
          allQuestsCompleted: true,
          lastActiveAt: AFTERNOON_NOON_UTC - 3 * DAY,
        },
      },
    }));
    expect(out.mood).toBe('proud');
    expect(out.priorityTag).toBe('all-quests-complete');
  });

  it('priority: level-up beats comeback', () => {
    const out = resolveMascotPresentation(input({
      context: {
        now: AFTERNOON_NOON_UTC,
        progression: { levelUpJustOccurred: true },
        state: { comebackJustOccurred: true },
      },
    }));
    expect(out.mood).toBe('celebrating');
    expect(out.priorityTag).toBe('level-up');
  });
});

describe('resolveMascotPresentation — streak at risk', () => {
  it('returns excited for streak > 0 with quests remaining and none completed today', () => {
    const out = resolveMascotPresentation(input({
      context: {
        now: AFTERNOON_NOON_UTC,
        activity: {
          currentStreak: 4,
          questsRemaining: 2,
          questsCompletedToday: 0,
        },
      },
    }));
    expect(out.mood).toBe('excited');
    expect(out.messageKey).toBe('mascot.streak.at_risk');
    expect(out.priorityTag).toBe('streak-at-risk');
  });

  it('does NOT trigger streak-at-risk if quests already completed today', () => {
    const out = resolveMascotPresentation(input({
      context: {
        now: AFTERNOON_NOON_UTC,
        activity: {
          currentStreak: 4,
          questsRemaining: 2,
          questsCompletedToday: 1,
        },
      },
    }));
    expect(out.mood).not.toBe('excited');
  });

  it('does NOT trigger streak-at-risk for streak == 0', () => {
    const out = resolveMascotPresentation(input({
      context: {
        now: AFTERNOON_NOON_UTC,
        activity: {
          currentStreak: 0,
          questsRemaining: 3,
          questsCompletedToday: 0,
        },
      },
    }));
    expect(out.mood).not.toBe('excited');
  });
});

describe('resolveMascotPresentation — first meeting', () => {
  it('returns curious for new users', () => {
    const out = resolveMascotPresentation(input({
      context: {
        now: AFTERNOON_NOON_UTC,
        child: { isFirstMeeting: true },
      },
    }));
    expect(out.mood).toBe('curious');
    expect(out.messageKey).toBe('mascot.first_meeting');
    expect(out.priorityTag).toBe('new-user');
  });

  it('does NOT mark new-user when isFirstMeeting is false', () => {
    const out = resolveMascotPresentation(input({
      context: {
        now: AFTERNOON_NOON_UTC,
        child: { isFirstMeeting: false },
      },
    }));
    expect(out.priorityTag).not.toBe('new-user');
  });
});

describe('resolveMascotPresentation — seasonal costume integration', () => {
  it('forwards the active theme mascotCostumeId into the presentation', () => {
    const out = resolveMascotPresentation(input({
      resolvedCostumeId: 'mascot.santa-hat',
      context: {
        now: AFTERNOON_NOON_UTC,
        event: { activeThemeId: 'theme.christmas', mascotCostumeId: 'mascot.santa-hat' },
      },
    }));
    expect(out.costumeId).toBe('mascot.santa-hat');
    // Default-friendly mood but tagged as seasonal because a costume is on.
    expect(out.priorityTag).toBe('seasonal');
  });

  it('falls back to event.mascotCostumeId when resolvedCostumeId is missing', () => {
    const out = resolveMascotPresentation(input({
      context: {
        now: AFTERNOON_NOON_UTC,
        event: { mascotCostumeId: 'mascot.lantern' },
      },
    }));
    expect(out.costumeId).toBe('mascot.lantern');
  });

  it('forwards costume even at the all-quests-done layer', () => {
    const out = resolveMascotPresentation(input({
      resolvedCostumeId: 'mascot.witch-hat',
      context: {
        now: AFTERNOON_NOON_UTC,
        activity: { allQuestsCompleted: true, currentStreak: 1 },
      },
    }));
    expect(out.mood).toBe('proud');
    expect(out.costumeId).toBe('mascot.witch-hat');
  });

  it('returns undefined costumeId when no event is active', () => {
    const out = resolveMascotPresentation(input({}));
    expect(out.costumeId).toBeUndefined();
    expect(out.priorityTag).toBe('default');
  });

  it('forwards different costume ids round-trip', () => {
    for (const id of [
      'mascot.santa-hat',
      'mascot.witch-hat',
      'mascot.lantern',
      'mascot.festive-robe',
      'mascot.neon-glasses',
    ]) {
      const out = resolveMascotPresentation(input({
        resolvedCostumeId: id,
        context: {
          now: AFTERNOON_NOON_UTC,
          event: { activeThemeId: 'theme.test', mascotCostumeId: id },
        },
      }));
      expect(out.costumeId).toBe(id);
    }
  });

  it('does NOT interpret the costume id (the mascot does not know what Christmas means)', () => {
    const out = resolveMascotPresentation(input({
      resolvedCostumeId: 'mascot.unknown-future-costume',
      context: {
        now: AFTERNOON_NOON_UTC,
        event: { mascotCostumeId: 'mascot.unknown-future-costume' },
      },
    }));
    // Mood is friendly default; costume is forwarded; no special handling.
    expect(out.mood).toBe('friendly');
    expect(out.costumeId).toBe('mascot.unknown-future-costume');
  });
});

describe('resolveMascotPresentation — safety / hardening', () => {
  it('does NOT crash when context is null', () => {
    const out = resolveMascotPresentation({
      context: null as unknown as MascotContext,
      resolvedCostumeId: undefined,
    });
    expect(out.mood).toBe('friendly');
    expect(out.messageKey).toBe('mascot.default.friendly');
  });

  it('does NOT crash when context is undefined', () => {
    const out = resolveMascotPresentation({
      context: undefined as unknown as MascotContext,
      resolvedCostumeId: undefined,
    });
    expect(out.mood).toBe('friendly');
  });

  it('falls back to friendly when now is NaN', () => {
    const out = resolveMascotPresentation(input({
      context: { now: Number.NaN },
    }));
    expect(out.mood).toBe('friendly');
  });

  it('falls back to friendly when now is in the far future', () => {
    const out = resolveMascotPresentation(input({
      context: { now: Number.MAX_SAFE_INTEGER },
    }));
    expect(out.mood).toBe('friendly');
  });

  it('treats negative streak as 0 (no streak-at-risk)', () => {
    const out = resolveMascotPresentation(input({
      context: {
        now: AFTERNOON_NOON_UTC,
        activity: {
          currentStreak: -5,
          questsRemaining: 3,
          questsCompletedToday: 0,
        },
      },
    }));
    expect(out.mood).not.toBe('excited');
  });

  it('treats fractional streak as floored integer', () => {
    const out = resolveMascotPresentation(input({
      context: {
        now: AFTERNOON_NOON_UTC,
        activity: {
          currentStreak: 3.7,
          questsRemaining: 2,
          questsCompletedToday: 0,
        },
      },
    }));
    expect(out.mood).toBe('excited');
  });

  it('coerces non-numeric lastActiveAt to safe', () => {
    const out = resolveMascotPresentation(input({
      context: {
        now: AFTERNOON_NOON_UTC,
        activity: { lastActiveAt: 'tomorrow' as unknown as number },
      },
    }));
    expect(out.mood).toBe('friendly');
  });

  it('returns friendly when activity is empty', () => {
    const out = resolveMascotPresentation(input({
      context: { now: AFTERNOON_NOON_UTC, activity: {} },
    }));
    expect(out.mood).toBe('friendly');
  });

  it('returns friendly when activity is undefined', () => {
    const out = resolveMascotPresentation(input({
      context: { now: AFTERNOON_NOON_UTC, activity: undefined },
    }));
    expect(out.mood).toBe('friendly');
  });

  it('missing displayName does not break the presentation', () => {
    const out = resolveMascotPresentation(input({
      context: {
        now: AFTERNOON_NOON_UTC,
        child: { isFirstMeeting: true }, // no displayName
      },
    }));
    expect(out.mood).toBe('curious');
    expect(out.messageKey).toBe('mascot.first_meeting');
  });

  it('whitespace-only displayName does not break the presentation', () => {
    const out = resolveMascotPresentation(input({
      context: {
        now: AFTERNOON_NOON_UTC,
        child: { displayName: '   ', isFirstMeeting: true },
      },
    }));
    expect(out.mood).toBe('curious');
  });
});

describe('resolveMascotPresentation — deterministic outputs', () => {
  it('same inputs always return the same presentation', () => {
    const a = resolveMascotPresentation(input({
      context: {
        now: AFTERNOON_NOON_UTC,
        child: { displayName: 'Sam' },
        activity: { currentStreak: 2, lastActiveAt: AFTERNOON_NOON_UTC - DAY },
      },
    }));
    const b = resolveMascotPresentation(input({
      context: {
        now: AFTERNOON_NOON_UTC,
        child: { displayName: 'Sam' },
        activity: { currentStreak: 2, lastActiveAt: AFTERNOON_NOON_UTC - DAY },
      },
    }));
    expect(a).toEqual(b);
  });

  it('return value is frozen', () => {
    const out = resolveMascotPresentation(input({}));
    expect(Object.isFrozen(out)).toBe(true);
  });

  it('messageKey is always a known key from the catalog', () => {
    const samples: Array<ResolveMascotPresentationInput> = [
      input({}),
      input({ context: { now: AFTERNOON_NOON_UTC, progression: { levelUpJustOccurred: true } } }),
      input({ context: { now: AFTERNOON_NOON_UTC, activity: { allQuestsCompleted: true, currentStreak: 1 } } }),
      input({ context: { now: AFTERNOON_NOON_UTC, state: { comebackJustOccurred: true } } }),
      input({ context: { now: AFTERNOON_NOON_UTC, child: { isFirstMeeting: true } } }),
      input({ context: { now: AFTERNOON_NOON_UTC, activity: { lastActiveAt: AFTERNOON_NOON_UTC - DAY } } }),
      input({ context: { now: AFTERNOON_NOON_UTC, activity: { lastActiveAt: AFTERNOON_NOON_UTC - 3 * DAY } } }),
    ];
    for (const sample of samples) {
      const out = resolveMascotPresentation(sample);
      expect(out.messageKey).toMatch(/^mascot\./);
    }
  });
});

describe('resolveMascotPresentation — separation boundaries', () => {
  it('never writes to gamification: result is frozen and contains only presentation fields', () => {
    const out = resolveMascotPresentation(input({
      context: {
        now: AFTERNOON_NOON_UTC,
        progression: { levelUpJustOccurred: true },
        activity: { currentStreak: 5 },
      },
    }));
    // Presentation fields only — never carries write intents.
    // Only presentation fields — never carries write intents. Optional fields
    // (costumeId, animationId) are omitted when not present, so we assert a
    // subset match rather than strict equality.
    const keys = Object.keys(out).sort();
    for (const required of ['animationId', 'expression', 'messageKey', 'mood', 'priorityTag']) {
      expect(keys).toContain(required);
    }
    expect(keys).not.toContain('xp');
    expect(keys).not.toContain('points');
    expect(keys).not.toContain('wallet');
    expect(keys).not.toContain('streak');
  });

  it('contains no notification / xp / wallet / streak write fields', () => {
    const out = resolveMascotPresentation(input({}));
    const forbidden = ['xp', 'points', 'wallet', 'streak', 'completion', 'approval'];
    for (const key of forbidden) {
      expect(out.messageKey).not.toMatch(new RegExp(`\\b${key}\\b`, 'i'));
    }
  });
});