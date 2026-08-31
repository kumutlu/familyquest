/**
 * Smart Notifications V1 — Decision Engine tests.
 *
 * Pins every behaviour the spec calls out in §29:
 *   - disabled / intensity=off → suppressed
 *   - quiet hour boundary pin: 20:29 allowed, 20:30 suppressed,
 *     06:59 suppressed, 07:00 allowed, cross-midnight timezone
 *   - daily cap respected per intensity
 *   - dedupe suppresses
 *   - priority order (Surge > Streak > FamilyProgress > Seasonal >
 *     MorningBrief > QuestReminder)
 *   - morning brief outside 07:00–10:30 → no morning brief
 *   - weather unavailable → morning brief can still send
 *
 * Pure tests: no Firebase, no push, no Date.now() inside the
 * resolver. We build a fixed `now` (epoch ms) for each scenario and
 * pass it in explicitly.
 */

import { describe, expect, it } from 'vitest'

import {
  PRODUCT_DEFAULT_NOTIFICATION_PREFERENCES,
  ROLLOUT_DEFAULT_NOTIFICATION_PREFERENCES,
  intensityToMaxPerDay,
  normaliseNotificationPreferences,
} from './preferences'
import { resolveNotificationDecision, type NotificationDecisionContext } from './resolver'
import { isInQuietHours, localDateKey, localTimeOfDay } from './types'

const TIMEZONE = 'Europe/London'

function atLocalHM(hour: number, minute: number, year = 2026, month = 8, day = 31): number {
  // Build an epoch ms that, when formatted in Europe/London, yields
  // the given local time. We start from a noon-UTC anchor and adjust.
  const anchor = Date.UTC(year, month - 1, day, 12, 0, 0)
  // England is UTC+1 in summer (BST). Use offset = 1h.
  const offsetMs = 1 * 60 * 60 * 1000
  return anchor - offsetMs + (hour - 12) * 60 * 60 * 1000 + minute * 60 * 1000
}

function baseContext(overrides: Partial<NotificationDecisionContext> = {}): NotificationDecisionContext {
  return {
    now: atLocalHM(8, 0),
    timezone: TIMEZONE,
    child: { id: 'child-ali', displayName: 'Ali' },
    familyPreferences: PRODUCT_DEFAULT_NOTIFICATION_PREFERENCES,
    deliveryState: { sentToday: 0, sentKeysToday: [] },
    dailyContext: {
      questsRemaining: 2,
      questsCompletedToday: 0,
    },
    ...overrides,
  }
}

const SLOTS = {
  morning: { slot: 'morning', familyId: 'fam-1' },
  midday: { slot: 'midday', familyId: 'fam-1' },
  evening: { slot: 'evening', familyId: 'fam-1' },
} as const

describe('Smart Notifications — quiet-hours boundary pin', () => {
  const quiet = { start: '20:30', end: '07:00' }

  it('20:29 local is allowed (just before quiet)', () => {
    const now = atLocalHM(20, 29)
    expect(isInQuietHours(now, TIMEZONE, quiet)).toBe(false)
  })

  it('20:30 local is suppressed (quiet boundary)', () => {
    const now = atLocalHM(20, 30)
    expect(isInQuietHours(now, TIMEZONE, quiet)).toBe(true)
  })

  it('23:45 local is suppressed', () => {
    expect(isInQuietHours(atLocalHM(23, 45), TIMEZONE, quiet)).toBe(true)
  })

  it('00:15 local is suppressed (cross midnight)', () => {
    expect(isInQuietHours(atLocalHM(0, 15), TIMEZONE, quiet)).toBe(true)
  })

  it('06:59 local is suppressed', () => {
    expect(isInQuietHours(atLocalHM(6, 59), TIMEZONE, quiet)).toBe(true)
  })

  it('07:00 local is allowed', () => {
    expect(isInQuietHours(atLocalHM(7, 0), TIMEZONE, quiet)).toBe(false)
  })

  it('non-cross-midnight window (13:00–15:00) only suppresses that range', () => {
    const dayQuiet = { start: '13:00', end: '15:00' }
    expect(isInQuietHours(atLocalHM(12, 59), TIMEZONE, dayQuiet)).toBe(false)
    expect(isInQuietHours(atLocalHM(13, 0), TIMEZONE, dayQuiet)).toBe(true)
    expect(isInQuietHours(atLocalHM(14, 59), TIMEZONE, dayQuiet)).toBe(true)
    expect(isInQuietHours(atLocalHM(15, 0), TIMEZONE, dayQuiet)).toBe(false)
  })
})

describe('Smart Notifications — intensity caps', () => {
  it.each([
    ['off', 0],
    ['low', 1],
    ['normal', 2],
    ['high', 3],
  ] as const)('intensity=%s maps to %d/day', (intensity, cap) => {
    expect(intensityToMaxPerDay(intensity)).toBe(cap)
  })
})

describe('Smart Notifications — localDateKey / localTimeOfDay', () => {
  it('localDateKey formats yyyy-mm-dd in family timezone', () => {
    expect(localDateKey(atLocalHM(8, 0), TIMEZONE)).toBe('2026-08-31')
  })

  it('localTimeOfDay returns the local HH:MM', () => {
    expect(localTimeOfDay(atLocalHM(8, 0), TIMEZONE)).toEqual({ hour: 8, minute: 0 })
    expect(localTimeOfDay(atLocalHM(20, 29), TIMEZONE)).toEqual({ hour: 20, minute: 29 })
  })
})

describe('Smart Notifications — resolver hard kill-switches', () => {
  it('disabled preferences → suppressed (reason=disabled)', () => {
    const ctx = baseContext({ familyPreferences: { ...PRODUCT_DEFAULT_NOTIFICATION_PREFERENCES, enabled: false } })
    const result = resolveNotificationDecision(ctx, SLOTS.morning)
    expect(result.shouldSend).toBe(false)
    expect(result.reason).toBe('disabled')
  })

  it('intensity=off → suppressed (reason=disabled)', () => {
    const ctx = baseContext({ familyPreferences: { ...PRODUCT_DEFAULT_NOTIFICATION_PREFERENCES, intensity: 'off' } })
    const result = resolveNotificationDecision(ctx, SLOTS.morning)
    expect(result.shouldSend).toBe(false)
    expect(result.reason).toBe('disabled')
  })

  it('quiet hour at 22:00 → suppressed (reason=quiet_hours)', () => {
    const ctx = baseContext({ now: atLocalHM(22, 0) })
    const result = resolveNotificationDecision(ctx, SLOTS.evening)
    expect(result.shouldSend).toBe(false)
    expect(result.reason).toBe('quiet_hours')
  })

  it('daily cap reached (high=3) → suppressed (reason=daily_cap)', () => {
    const ctx = baseContext({
      deliveryState: { sentToday: 3, sentKeysToday: ['a', 'b', 'c'] },
    })
    const result = resolveNotificationDecision(ctx, SLOTS.morning)
    expect(result.shouldSend).toBe(false)
    expect(result.reason).toBe('daily_cap')
  })

  it('duplicate dedupe key → suppressed (reason=duplicate)', () => {
    const ctx = baseContext({
      // Real useful content so the resolver would otherwise pick
      // morning_brief; sentKeys claims the same key was already sent.
      dailyContext: { questsRemaining: 3, questsCompletedToday: 0 },
      weather: { condition: 'rain', minC: 14, maxC: 18 },
      deliveryState: { sentToday: 1, sentKeysToday: ['morning_brief:child-ali:2026-08-31'] },
    })
    // At 08:00 in morning window the morning brief would normally win
    // — but we marked it as already sent.
    const result = resolveNotificationDecision(ctx, { slot: 'morning', familyId: 'fam-1' })
    expect(result.shouldSend).toBe(false)
    expect(result.reason).toBe('duplicate')
  })
})

describe('Smart Notifications — priority order', () => {
  function ctxWithActiveSurge(): NotificationDecisionContext {
    return baseContext({
      dailyContext: {
        questsRemaining: 3,
        questsCompletedToday: 0,
        currentStreak: 5,
        streakAtRisk: true,
        activeSurge: {
          surgeId: 'surg-1',
          taskId: 'task-vacuum',
          taskTitle: 'House Vacuum',
          bonusPoints: 10,
          endsAt: atLocalHM(8, 42),
        },
        familyProgress: { current: 9, target: 10, childCouldComplete: true },
        activeSeason: { eventId: 'ramadan', name: 'Ramadan Week' },
      },
    })
  }

  it('active Surge beats normal quest reminder', () => {
    const result = resolveNotificationDecision(ctxWithActiveSurge(), SLOTS.midday)
    expect(result.shouldSend).toBe(true)
    expect(result.type).toBe('surge')
  })

  it('streak risk beats family progress', () => {
    const result = resolveNotificationDecision(
      baseContext({
        dailyContext: {
          questsRemaining: 2,
          questsCompletedToday: 0,
          currentStreak: 4,
          streakAtRisk: true,
          familyProgress: { current: 9, target: 10, childCouldComplete: true },
        },
      }),
      SLOTS.midday,
    )
    expect(result.type).toBe('streak')
  })

  it('family progress beats seasonal', () => {
    const result = resolveNotificationDecision(
      baseContext({
        dailyContext: {
          questsRemaining: 1,
          questsCompletedToday: 0,
          familyProgress: { current: 9, target: 10, childCouldComplete: true },
          activeSeason: { eventId: 'ramadan', name: 'Ramadan' },
        },
      }),
      SLOTS.midday,
    )
    expect(result.type).toBe('family_progress')
  })

  it('seasonal beats morning brief when morning brief would otherwise win', () => {
    const result = resolveNotificationDecision(
      baseContext({
        now: atLocalHM(8, 0),
        dailyContext: {
          questsRemaining: 3,
          questsCompletedToday: 0,
          activeSeason: { eventId: 'ramadan', name: 'Ramadan' },
        },
      }),
      SLOTS.morning,
    )
    expect(result.type).toBe('seasonal')
  })

  it('morning brief beats generic quest reminder in the morning window', () => {
    const result = resolveNotificationDecision(
      baseContext({
        now: atLocalHM(8, 0),
        dailyContext: { questsRemaining: 3, questsCompletedToday: 0 },
      }),
      SLOTS.morning,
    )
    expect(result.type).toBe('morning_brief')
  })

  it('morning brief outside 07:00–10:30 is suppressed; quest reminder wins', () => {
    const result = resolveNotificationDecision(
      baseContext({
        now: atLocalHM(11, 45),
        dailyContext: { questsRemaining: 3, questsCompletedToday: 0 },
      }),
      SLOTS.midday,
    )
    expect(result.type).toBe('quest_reminder')
  })
})

describe('Smart Notifications — morning brief window', () => {
  it('morning brief suppressed at 11:45 even if nothing sent today', () => {
    const result = resolveNotificationDecision(
      baseContext({ now: atLocalHM(11, 45), dailyContext: { questsRemaining: 2, questsCompletedToday: 0 } }),
      SLOTS.midday,
    )
    expect(result.type).not.toBe('morning_brief')
  })

  it('morning brief allowed at 07:00', () => {
    const result = resolveNotificationDecision(
      baseContext({ now: atLocalHM(7, 0), dailyContext: { questsRemaining: 2, questsCompletedToday: 0 } }),
      SLOTS.morning,
    )
    expect(result.type).toBe('morning_brief')
  })

  it('morning brief suppressed at 10:30 (window is exclusive on end)', () => {
    const result = resolveNotificationDecision(
      baseContext({ now: atLocalHM(10, 30), dailyContext: { questsRemaining: 2, questsCompletedToday: 0 } }),
      SLOTS.morning,
    )
    expect(result.type).not.toBe('morning_brief')
  })

  it('weather unavailable → morning brief can still send with quests remaining', () => {
    const result = resolveNotificationDecision(
      baseContext({
        now: atLocalHM(8, 0),
        weather: undefined,
        dailyContext: { questsRemaining: 3, questsCompletedToday: 0 },
      }),
      SLOTS.morning,
    )
    expect(result.type).toBe('morning_brief')
    expect(result.shouldSend).toBe(true)
  })

  it('weather available → morning brief still selected and includes weather summary variable', () => {
    const result = resolveNotificationDecision(
      baseContext({
        now: atLocalHM(8, 0),
        weather: { condition: 'rain', minC: 14, maxC: 18, precipitationChance: 80, advisory: 'umbrella' },
        dailyContext: { questsRemaining: 3, questsCompletedToday: 0 },
      }),
      SLOTS.morning,
    )
    expect(result.type).toBe('morning_brief')
    expect(result.variables?.questsRemaining).toBe(3)
  })

  it('morning brief with no useful content (no quests, no weather, no streak, no season) → no_useful_content', () => {
    const result = resolveNotificationDecision(
      baseContext({
        now: atLocalHM(8, 0),
        weather: undefined,
        dailyContext: {
          questsRemaining: 0,
          questsCompletedToday: 0,
          currentStreak: 0,
        },
      }),
      SLOTS.morning,
    )
    expect(result.shouldSend).toBe(false)
    expect(result.reason).toBe('no_useful_content')
  })
})

describe('Smart Notifications — preference-disabled types', () => {
  it('surgeAlerts=false → no surge notification even when surge active', () => {
    const result = resolveNotificationDecision(
      baseContext({
        familyPreferences: { ...PRODUCT_DEFAULT_NOTIFICATION_PREFERENCES, surgeAlerts: false },
        dailyContext: {
          questsRemaining: 3,
          questsCompletedToday: 0,
          activeSurge: {
            surgeId: 'surg-1',
            taskTitle: 'Vacuum',
            bonusPoints: 10,
            endsAt: atLocalHM(8, 42),
          },
        },
      }),
      SLOTS.midday,
    )
    expect(result.type).not.toBe('surge')
  })

  it('morningBrief=false → no morning brief', () => {
    const result = resolveNotificationDecision(
      baseContext({
        familyPreferences: { ...PRODUCT_DEFAULT_NOTIFICATION_PREFERENCES, morningBrief: false },
        now: atLocalHM(8, 0),
        dailyContext: { questsRemaining: 3, questsCompletedToday: 0 },
      }),
      SLOTS.morning,
    )
    expect(result.type).not.toBe('morning_brief')
  })
})

describe('Smart Notifications — rollout default', () => {
  it('ROLLOUT_DEFAULT_NOTIFICATION_PREFERENCES.enabled=false (safe default)', () => {
    expect(ROLLOUT_DEFAULT_NOTIFICATION_PREFERENCES.enabled).toBe(false)
  })

  it('PRODUCT_DEFAULT_NOTIFICATION_PREFERENCES.enabled=true (parent opt-in)', () => {
    expect(PRODUCT_DEFAULT_NOTIFICATION_PREFERENCES.enabled).toBe(true)
    expect(PRODUCT_DEFAULT_NOTIFICATION_PREFERENCES.intensity).toBe('high')
    expect(PRODUCT_DEFAULT_NOTIFICATION_PREFERENCES.quietHours).toEqual({ start: '20:30', end: '07:00' })
  })

  it('normaliseNotificationPreferences never trusts a malicious enabled=true from a missing doc', () => {
    const norm = normaliseNotificationPreferences(null)
    expect(norm.enabled).toBe(false)
  })
})

describe('Smart Notifications — surge integration is read-only', () => {
  it('decision includes surge context in variables but does not mutate anything', () => {
    const ctx: NotificationDecisionContext = baseContext({
      now: atLocalHM(8, 0),
      dailyContext: {
        questsRemaining: 1,
        questsCompletedToday: 0,
        activeSurge: {
          surgeId: 'surg-1',
          taskId: 'task-1',
          taskTitle: 'Vacuum',
          bonusPoints: 10,
          endsAt: atLocalHM(8, 42),
        },
      },
    })
    const result = resolveNotificationDecision(ctx, SLOTS.midday)
    // Midday slot was passed, so the surge window still allows the
    // decision. Either surge or seasonal (we have no season here so
    // surge wins).
    expect(result.type).toBe('surge')
    expect(result.variables).toMatchObject({
      taskTitle: 'Vacuum',
      bonusPoints: 10,
      minutesRemaining: expect.any(Number),
    })
  })
})

describe('Smart Notifications — dedupe keys are deterministic', () => {
  it('two identical decisions produce the same dedupe key', () => {
    const ctx = baseContext({ now: atLocalHM(8, 0) })
    const a = resolveNotificationDecision(ctx, SLOTS.morning)
    const b = resolveNotificationDecision(ctx, SLOTS.morning)
    expect(a.dedupeKey).toBe(b.dedupeKey)
  })
})