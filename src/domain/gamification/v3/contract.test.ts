import { describe, expect, it } from 'vitest'
import {
  GAMIFICATION_V3_SCHEMA_VERSION,
  GAMIFICATION_V3_EVENT_TYPES,
  type GamificationEventV3,
} from './event'
import {
  behaviourEventId,
  legacyBaselineEventId,
  reversalEventId,
  rewardRedeemedEventId,
  taskApprovedEventId,
  weekRolloverEventId,
} from './ids'
import {
  assertValidEventV3,
  assertValidStateV3,
  assertUniqueEventIds,
  ValidationErrorV3,
} from './validators'
import {
  DEFAULT_WEEKLY_CONTEXT,
  weeklyWindowKeyFor,
  dayKeyFor,
  resolveWeeklyContext,
} from './weeklyWindow'
import { EVENTS_V3_COLLECTION_ID, STATE_V3_COLLECTION_ID, eventDocPath, stateDocPath } from './storage'

const FAMILY = 'family-1'
const MEMBER = 'member-1'

function baseEvent(overrides: Partial<GamificationEventV3> = {}): GamificationEventV3 {
  return {
    schemaVersion: GAMIFICATION_V3_SCHEMA_VERSION,
    eventId: taskApprovedEventId(FAMILY, MEMBER, 'task-1#2026-01-05'),
    eventType: 'TASK_APPROVED',
    familyId: FAMILY,
    memberId: MEMBER,
    sourceType: 'task_completion',
    sourceId: 'task-1#2026-01-05',
    effectiveAt: '2026-01-05T10:00:00.000Z',
    createdAt: '2026-01-05T10:00:00.000Z',
    rewardPointsDelta: 5,
    xpDelta: 5,
    weeklyPointsDelta: 5,
    idempotencyKey: taskApprovedEventId(FAMILY, MEMBER, 'task-1#2026-01-05'),
    metadata: {},
    ...overrides,
  } as GamificationEventV3
}

describe('V3 event contract', () => {
  it('declares every required event category exactly once', () => {
    expect([...GAMIFICATION_V3_EVENT_TYPES].sort()).toEqual([
      'AVATAR_UNLOCKED',
      'BEHAVIOUR_NEGATIVE',
      'BEHAVIOUR_POSITIVE',
      'DAILY_GOAL_AWARDED',
      'LEGACY_BASELINE',
      'MANUAL_ADJUSTMENT',
      'PERFECT_DAY_AWARDED',
      'REVERSAL',
      'REWARD_REDEEMED',
      'TASK_APPROVED',
      'WEEK_ROLLOVER',
    ])
    expect(new Set(GAMIFICATION_V3_EVENT_TYPES).size).toBe(GAMIFICATION_V3_EVENT_TYPES.length)
  })

  it('accepts a well-formed event of every type', () => {
    const samples: GamificationEventV3[] = [
      baseEvent(),
      baseEvent({
        eventType: 'BEHAVIOUR_POSITIVE',
        eventId: behaviourEventId(FAMILY, MEMBER, 'b1'),
        sourceType: 'behaviour_event',
        sourceId: 'b1',
        rewardPointsDelta: 20,
        xpDelta: 20,
        weeklyPointsDelta: 20,
      }),
      baseEvent({
        eventType: 'BEHAVIOUR_NEGATIVE',
        eventId: behaviourEventId(FAMILY, MEMBER, 'b2'),
        sourceType: 'behaviour_event',
        sourceId: 'b2',
        rewardPointsDelta: -5,
        xpDelta: 0,
        weeklyPointsDelta: 0,
      }),
      baseEvent({
        eventType: 'REWARD_REDEEMED',
        eventId: rewardRedeemedEventId(FAMILY, MEMBER, 'r1'),
        sourceType: 'redemption',
        sourceId: 'r1',
        rewardPointsDelta: -10,
        xpDelta: 0,
        weeklyPointsDelta: 0,
      }),
      baseEvent({
        eventType: 'AVATAR_UNLOCKED',
        eventId: `avatar-unlocked:${FAMILY}:${MEMBER}:cat`,
        sourceType: 'avatar_unlock',
        sourceId: 'cat',
        rewardPointsDelta: -30,
        xpDelta: 0,
        weeklyPointsDelta: 0,
        metadata: { avatarId: 'cat' },
      }),
      baseEvent({
        eventType: 'MANUAL_ADJUSTMENT',
        eventId: `manual-adjustment:${FAMILY}:${MEMBER}:adj-1`,
        sourceType: 'manual_adjustment',
        sourceId: 'adj-1',
        rewardPointsDelta: -3,
        xpDelta: 0,
        weeklyPointsDelta: 0,
        metadata: { reason: 'parent correction' },
      }),
      baseEvent({
        eventType: 'DAILY_GOAL_AWARDED',
        eventId: `daily-goal:${FAMILY}:${MEMBER}:2026-01-05`,
        sourceType: 'daily_goal',
        sourceId: '2026-01-05',
        rewardPointsDelta: 0,
        xpDelta: 25,
        weeklyPointsDelta: 0,
        metadata: { dayKey: '2026-01-05' },
      }),
      baseEvent({
        eventType: 'PERFECT_DAY_AWARDED',
        eventId: `perfect-day:${FAMILY}:${MEMBER}:2026-01-05`,
        sourceType: 'perfect_day',
        sourceId: '2026-01-05',
        rewardPointsDelta: 0,
        xpDelta: 50,
        weeklyPointsDelta: 0,
        metadata: { dayKey: '2026-01-05' },
      }),
      baseEvent({
        eventType: 'LEGACY_BASELINE',
        eventId: legacyBaselineEventId(FAMILY, MEMBER),
        sourceType: 'legacy_baseline',
        sourceId: 'v3',
        rewardPointsDelta: 380,
        xpDelta: 380,
        weeklyPointsDelta: 0,
      }),
      baseEvent({
        eventType: 'WEEK_ROLLOVER',
        eventId: weekRolloverEventId(FAMILY, MEMBER, '2026-W02'),
        sourceType: 'week_rollover',
        sourceId: '2026-W02',
        rewardPointsDelta: 0,
        xpDelta: 0,
        weeklyPointsDelta: 0,
        metadata: { weeklyWindowKey: '2026-W02' },
      }),
      baseEvent({
        eventType: 'REVERSAL',
        eventId: reversalEventId(taskApprovedEventId(FAMILY, MEMBER, 'task-1#2026-01-05'), 'rev-1'),
        sourceType: 'reversal',
        sourceId: 'rev-1',
        rewardPointsDelta: -5,
        xpDelta: -5,
        weeklyPointsDelta: -5,
        reversalOfEventId: taskApprovedEventId(FAMILY, MEMBER, 'task-1#2026-01-05'),
      }),
    ]

    for (const event of samples) {
      expect(() => assertValidEventV3(event)).not.toThrow()
    }
    expect(samples).toHaveLength(GAMIFICATION_V3_EVENT_TYPES.length)
  })

  it('rejects illegal delta combinations per event type', () => {
    expect(() => assertValidEventV3(baseEvent({ rewardPointsDelta: -1 }))).toThrow(ValidationErrorV3)
    expect(() =>
      assertValidEventV3(
        baseEvent({
          eventType: 'REWARD_REDEEMED',
          eventId: rewardRedeemedEventId(FAMILY, MEMBER, 'r1'),
          sourceType: 'redemption',
          sourceId: 'r1',
          rewardPointsDelta: -10,
          xpDelta: -10,
          weeklyPointsDelta: 0,
        }),
      ),
    ).toThrow(/xpDelta/)
    expect(() =>
      assertValidEventV3(
        baseEvent({
          eventType: 'BEHAVIOUR_NEGATIVE',
          eventId: behaviourEventId(FAMILY, MEMBER, 'b2'),
          sourceType: 'behaviour_event',
          sourceId: 'b2',
          rewardPointsDelta: -5,
          xpDelta: -5,
          weeklyPointsDelta: 0,
        }),
      ),
    ).toThrow(/xpDelta/)
    expect(() =>
      assertValidEventV3(
        baseEvent({
          eventType: 'BEHAVIOUR_NEGATIVE',
          eventId: behaviourEventId(FAMILY, MEMBER, 'b3'),
          sourceType: 'behaviour_event',
          sourceId: 'b3',
          rewardPointsDelta: -5,
          xpDelta: 0,
          weeklyPointsDelta: -5,
        }),
      ),
    ).toThrow(/weeklyPointsDelta/)
  })

  it('requires a reversal reference on REVERSAL events and forbids it elsewhere', () => {
    expect(() =>
      assertValidEventV3(
        baseEvent({
          eventType: 'REVERSAL',
          eventId: 'reversal:x:y',
          sourceType: 'reversal',
          sourceId: 'rev-1',
          rewardPointsDelta: -5,
          xpDelta: -5,
          weeklyPointsDelta: -5,
        }),
      ),
    ).toThrow(/reversalOfEventId/)

    expect(() =>
      assertValidEventV3(baseEvent({ reversalOfEventId: 'some-event' } as Partial<GamificationEventV3>)),
    ).toThrow(/reversalOfEventId/)
  })

  it('rejects malformed identity, schema version and timestamps', () => {
    expect(() => assertValidEventV3(baseEvent({ familyId: '' }))).toThrow(/familyId/)
    expect(() => assertValidEventV3(baseEvent({ memberId: 'bad id/slash' }))).toThrow(/memberId/)
    expect(() => assertValidEventV3(baseEvent({ effectiveAt: 'not-a-date' }))).toThrow(/effectiveAt/)
    expect(() => assertValidEventV3(baseEvent({ createdAt: '2026-01-05' }))).toThrow(/createdAt/)
    expect(() => assertValidEventV3(baseEvent({ schemaVersion: 99 } as never))).toThrow(/schemaVersion/)
    expect(() => assertValidEventV3(baseEvent({ rewardPointsDelta: 1.5 }))).toThrow(/integer/)
    expect(() => assertValidEventV3(baseEvent({ eventId: '' }))).toThrow(/eventId/)
    expect(() => assertValidEventV3(baseEvent({ idempotencyKey: '' }))).toThrow(/idempotencyKey/)
    expect(() => assertValidEventV3(null as never)).toThrow(ValidationErrorV3)
  })

  it('rejects duplicate event identities', () => {
    const event = baseEvent()
    expect(() => assertUniqueEventIds([event, { ...event }])).toThrow(/duplicate/i)
    expect(() => assertUniqueEventIds([event])).not.toThrow()
  })

  it('generates stable deterministic identifiers from source identity', () => {
    expect(taskApprovedEventId(FAMILY, MEMBER, 'task-1#2026-01-05')).toBe(
      'task-approved:family-1:member-1:task-1#2026-01-05',
    )
    expect(behaviourEventId(FAMILY, MEMBER, 'b1')).toBe('behaviour:family-1:member-1:b1')
    expect(rewardRedeemedEventId(FAMILY, MEMBER, 'r1')).toBe('reward-redeemed:family-1:member-1:r1')
    expect(reversalEventId('task-approved:family-1:member-1:t', 'rev-1')).toBe(
      'reversal:task-approved:family-1:member-1:t:rev-1',
    )
    expect(legacyBaselineEventId(FAMILY, MEMBER)).toBe('legacy-baseline:family-1:member-1:v3')
    expect(taskApprovedEventId(FAMILY, MEMBER, 'x')).toBe(taskApprovedEventId(FAMILY, MEMBER, 'x'))
    expect(() => taskApprovedEventId(FAMILY, MEMBER, '')).toThrow(ValidationErrorV3)
  })
})

describe('weekly window semantics', () => {
  it('defaults to Monday week start in the documented fallback timezone', () => {
    expect(DEFAULT_WEEKLY_CONTEXT.timeZone).toBe('UTC')
    expect(DEFAULT_WEEKLY_CONTEXT.weekStartsOn).toBe(1)
  })

  it('produces ISO-style window keys anchored on the local week start', () => {
    const ctx = resolveWeeklyContext({ timeZone: 'UTC' })
    // 2026-01-05 is a Monday.
    expect(weeklyWindowKeyFor('2026-01-05T00:00:00.000Z', ctx)).toBe('2026-W02')
    expect(weeklyWindowKeyFor('2026-01-11T23:59:59.000Z', ctx)).toBe('2026-W02')
    expect(weeklyWindowKeyFor('2026-01-12T00:00:00.000Z', ctx)).toBe('2026-W03')
  })

  it('honours the family timezone at day and week boundaries', () => {
    const auckland = resolveWeeklyContext({ timeZone: 'Pacific/Auckland' })
    const utc = resolveWeeklyContext({ timeZone: 'UTC' })
    const instant = '2026-01-11T12:00:00.000Z' // Sunday 12:00 UTC = Monday 01:00 NZDT
    expect(weeklyWindowKeyFor(instant, utc)).toBe('2026-W02')
    expect(weeklyWindowKeyFor(instant, auckland)).toBe('2026-W03')
    expect(dayKeyFor(instant, utc)).toBe('2026-01-11')
    expect(dayKeyFor(instant, auckland)).toBe('2026-01-12')
  })

  it('falls back to the documented default when the family timezone is unusable', () => {
    expect(resolveWeeklyContext({ timeZone: 'Not/AZone' }).timeZone).toBe('UTC')
    expect(resolveWeeklyContext(undefined).timeZone).toBe('UTC')
  })
})

describe('shadow storage contract', () => {
  it('pins the shadow collection identifiers and document paths', () => {
    expect(EVENTS_V3_COLLECTION_ID).toBe('gamification_events_v3')
    expect(STATE_V3_COLLECTION_ID).toBe('gamification_state_v3')
    expect(eventDocPath(FAMILY, 'evt-1')).toBe('families/family-1/gamification_events_v3/evt-1')
    expect(stateDocPath(FAMILY, MEMBER)).toBe('families/family-1/gamification_state_v3/member-1')
  })
})

describe('state validation', () => {
  it('rejects negative reward points and non-integer projections', () => {
    const state = {
      memberId: MEMBER,
      familyId: FAMILY,
      rewardPoints: -1,
      xpTotal: 0,
      weeklyPoints: 0,
      weeklyWindowKey: '2026-W02',
      level: 1,
      xpProgressInLevel: 0,
      xpToNextLevel: 1000,
      levelProgressPercentage: 0,
      currentStreak: 0,
      bestStreak: 0,
      lastQualifiedDayKey: null,
      unlockedAvatarIds: [],
      projectionVersion: 3,
      foldedThroughEventId: null,
      updatedAt: '2026-01-05T10:00:00.000Z',
    }
    expect(() => assertValidStateV3(state)).toThrow(/rewardPoints/)
    expect(() => assertValidStateV3({ ...state, rewardPoints: 0 })).not.toThrow()
  })
})
