import { describe, expect, it } from 'vitest'
import { GAMIFICATION_V3_SCHEMA_VERSION, type GamificationEventV3 } from './event'
import {
  behaviourEventId,
  legacyBaselineEventId,
  reversalEventId,
  rewardRedeemedEventId,
  taskApprovedEventId,
} from './ids'
import { reduceGamificationEventsV3, sortEventsV3 } from './reducer'
import { ValidationErrorV3 } from './validators'
import { resolveWeeklyContext } from './weeklyWindow'

const FAMILY = 'family-1'
const MEMBER = 'member-1'
const CTX = { weekly: resolveWeeklyContext({ timeZone: 'UTC' }), asOf: '2026-01-08T00:00:00.000Z' }

type EventDraft = Partial<GamificationEventV3> & { eventType: GamificationEventV3['eventType'] }

function makeEvent(draft: EventDraft): GamificationEventV3 {
  const eventId = draft.eventId ?? `${draft.eventType.toLowerCase()}:${FAMILY}:${MEMBER}:${draft.sourceId ?? 'x'}`
  return {
    schemaVersion: GAMIFICATION_V3_SCHEMA_VERSION,
    eventId,
    familyId: FAMILY,
    memberId: MEMBER,
    sourceType: 'task_completion',
    sourceId: 'x',
    effectiveAt: '2026-01-05T10:00:00.000Z',
    createdAt: '2026-01-05T10:00:00.000Z',
    rewardPointsDelta: 0,
    xpDelta: 0,
    weeklyPointsDelta: 0,
    idempotencyKey: eventId,
    metadata: {},
    ...draft,
  } as GamificationEventV3
}

function task(sourceId: string, points: number, effectiveAt = '2026-01-05T10:00:00.000Z') {
  return makeEvent({
    eventType: 'TASK_APPROVED',
    eventId: taskApprovedEventId(FAMILY, MEMBER, sourceId),
    sourceType: 'task_completion',
    sourceId,
    effectiveAt,
    createdAt: effectiveAt,
    rewardPointsDelta: points,
    xpDelta: points,
    weeklyPointsDelta: points,
  })
}

function positiveBehaviour(sourceId: string, points: number, effectiveAt = '2026-01-05T11:00:00.000Z') {
  return makeEvent({
    eventType: 'BEHAVIOUR_POSITIVE',
    eventId: behaviourEventId(FAMILY, MEMBER, sourceId),
    sourceType: 'behaviour_event',
    sourceId,
    effectiveAt,
    createdAt: effectiveAt,
    rewardPointsDelta: points,
    xpDelta: points,
    weeklyPointsDelta: points,
  })
}

function negativeBehaviour(sourceId: string, points: number, effectiveAt = '2026-01-05T12:00:00.000Z') {
  return makeEvent({
    eventType: 'BEHAVIOUR_NEGATIVE',
    eventId: behaviourEventId(FAMILY, MEMBER, sourceId),
    sourceType: 'behaviour_event',
    sourceId,
    effectiveAt,
    createdAt: effectiveAt,
    rewardPointsDelta: -Math.abs(points),
    xpDelta: 0,
    weeklyPointsDelta: 0,
  })
}

function redemption(sourceId: string, cost: number, effectiveAt = '2026-01-06T10:00:00.000Z') {
  return makeEvent({
    eventType: 'REWARD_REDEEMED',
    eventId: rewardRedeemedEventId(FAMILY, MEMBER, sourceId),
    sourceType: 'redemption',
    sourceId,
    effectiveAt,
    createdAt: effectiveAt,
    rewardPointsDelta: -Math.abs(cost),
    xpDelta: 0,
    weeklyPointsDelta: 0,
  })
}

function baseline(rewardPoints: number, xp: number) {
  return makeEvent({
    eventType: 'LEGACY_BASELINE',
    eventId: legacyBaselineEventId(FAMILY, MEMBER),
    sourceType: 'legacy_baseline',
    sourceId: 'v3',
    effectiveAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    rewardPointsDelta: rewardPoints,
    xpDelta: xp,
    weeklyPointsDelta: 0,
  })
}

function reversalOf(original: GamificationEventV3, reversalId: string, effectiveAt = '2026-01-07T10:00:00.000Z') {
  return makeEvent({
    eventType: 'REVERSAL',
    eventId: reversalEventId(original.eventId, reversalId),
    sourceType: 'reversal',
    sourceId: reversalId,
    effectiveAt,
    createdAt: effectiveAt,
    rewardPointsDelta: -original.rewardPointsDelta,
    xpDelta: -original.xpDelta,
    weeklyPointsDelta: -original.weeklyPointsDelta,
    reversalOfEventId: original.eventId,
  })
}

describe('reward points invariants', () => {
  it('increases the spendable balance for tasks and positive behaviour', () => {
    const state = reduceGamificationEventsV3([task('t1', 5), positiveBehaviour('b1', 20)], CTX)
    expect(state.rewardPoints).toBe(25)
  })

  it('decreases the spendable balance on redemption without touching XP', () => {
    const state = reduceGamificationEventsV3([task('t1', 50), redemption('r1', 30)], CTX)
    expect(state.rewardPoints).toBe(20)
    expect(state.xpTotal).toBe(50)
  })

  it('never produces a negative balance and fails loudly on an over-spend', () => {
    expect(() => reduceGamificationEventsV3([task('t1', 5), redemption('r1', 30)], CTX)).toThrow(
      ValidationErrorV3,
    )
  })

  it('clamps to zero only where the approved event semantics allow it', () => {
    const clamped = makeEvent({
      eventType: 'MANUAL_ADJUSTMENT',
      eventId: 'manual-adjustment:family-1:member-1:adj-1',
      sourceType: 'manual_adjustment',
      sourceId: 'adj-1',
      effectiveAt: '2026-01-06T10:00:00.000Z',
      createdAt: '2026-01-06T10:00:00.000Z',
      rewardPointsDelta: -500,
      metadata: { reason: 'reset', clampToZero: true },
    })
    const state = reduceGamificationEventsV3([task('t1', 5), clamped], CTX)
    expect(state.rewardPoints).toBe(0)
    expect(state.xpTotal).toBe(5)
  })

  it('does not double-apply an event on replay', () => {
    const events = [task('t1', 5), positiveBehaviour('b1', 20)]
    const once = reduceGamificationEventsV3(events, CTX)
    const twice = reduceGamificationEventsV3([...events], CTX)
    expect(twice).toEqual(once)
    expect(() => reduceGamificationEventsV3([...events, task('t1', 5)], CTX)).toThrow(/duplicate/i)
  })

  it('cancels exactly the referenced event effect on reversal', () => {
    const t = task('t1', 5)
    const state = reduceGamificationEventsV3([baseline(380, 380), t, reversalOf(t, 'rev-1')], CTX)
    expect(state.rewardPoints).toBe(380)
    expect(state.xpTotal).toBe(380)
    expect(state.weeklyPoints).toBe(0)
  })

  it('rejects a reversal that references an unknown or already reversed event', () => {
    const t = task('t1', 5)
    const orphan = reversalOf(t, 'rev-1')
    expect(() => reduceGamificationEventsV3([orphan], CTX)).toThrow(/reversalOfEventId/)
    expect(() =>
      reduceGamificationEventsV3([t, reversalOf(t, 'rev-1'), reversalOf(t, 'rev-2')], CTX),
    ).toThrow(/already reversed/i)
  })
})

describe('XP invariants', () => {
  it('increases XP for XP-bearing events and never decreases it otherwise', () => {
    const state = reduceGamificationEventsV3(
      [baseline(380, 380), positiveBehaviour('b1', 20), task('t1', 20), negativeBehaviour('b2', 10), redemption('r1', 10)],
      CTX,
    )
    expect(state.xpTotal).toBe(420)
  })

  it('produces the same state for permutations that preserve effective ordering', () => {
    const events = [baseline(380, 380), task('t1', 20), positiveBehaviour('b1', 20), redemption('r1', 10)]
    const shuffled = [events[2], events[0], events[3], events[1]]
    expect(reduceGamificationEventsV3(shuffled, CTX)).toEqual(reduceGamificationEventsV3(events, CTX))
  })

  it('sorts canonically by effectiveAt, then createdAt, then eventId', () => {
    const a = task('a', 1, '2026-01-05T10:00:00.000Z')
    const b = task('b', 1, '2026-01-05T09:00:00.000Z')
    expect(sortEventsV3([a, b]).map((e) => e.eventId)).toEqual([b.eventId, a.eventId])
  })
})

describe('weekly invariants', () => {
  const weekTwoCtx = { weekly: resolveWeeklyContext({ timeZone: 'UTC' }), asOf: '2026-01-08T00:00:00.000Z' }
  const weekThreeCtx = { weekly: resolveWeeklyContext({ timeZone: 'UTC' }), asOf: '2026-01-13T00:00:00.000Z' }

  it('counts only earning events inside the current window', () => {
    const state = reduceGamificationEventsV3([task('t1', 5), redemption('r1', 3)], weekTwoCtx)
    expect(state.weeklyWindowKey).toBe('2026-W02')
    expect(state.weeklyPoints).toBe(5)
    expect(state.rewardPoints).toBe(2)
  })

  it('keeps reward points and weekly points as distinct metrics', () => {
    const state = reduceGamificationEventsV3(
      [baseline(380, 380), positiveBehaviour('b1', 20), task('t1', 20)],
      weekTwoCtx,
    )
    expect(state.rewardPoints).toBe(420)
    expect(state.weeklyPoints).toBe(40)
    expect(state.xpTotal).toBe(420)
  })

  it('applies a reversal to the window of the original event', () => {
    const t = task('t1', 5, '2026-01-05T10:00:00.000Z')
    const rev = reversalOf(t, 'rev-1', '2026-01-13T10:00:00.000Z')
    const state = reduceGamificationEventsV3([baseline(10, 0), t, rev], weekThreeCtx)
    expect(state.weeklyWindowKey).toBe('2026-W03')
    expect(state.weeklyPoints).toBe(0)
    expect(state.rewardPoints).toBe(10)
  })

  it('rolls the weekly window over without touching lifetime values', () => {
    const state = reduceGamificationEventsV3([baseline(380, 380), task('t1', 20)], weekThreeCtx)
    expect(state.weeklyWindowKey).toBe('2026-W03')
    expect(state.weeklyPoints).toBe(0)
    expect(state.rewardPoints).toBe(400)
    expect(state.xpTotal).toBe(400)
  })
})

describe('derived level and streak fields', () => {
  it('derives level progress using the canonical helper', () => {
    const state = reduceGamificationEventsV3([baseline(0, 1500)], CTX)
    expect(state.level).toBe(2)
    expect(state.xpProgressInLevel).toBe(500)
    expect(state.xpToNextLevel).toBe(500)
    expect(state.levelProgressPercentage).toBe(50)
  })

  it('tracks streaks from qualified day awards', () => {
    const day = (dayKey: string) =>
      makeEvent({
        eventType: 'DAILY_GOAL_AWARDED',
        eventId: `daily-goal:${FAMILY}:${MEMBER}:${dayKey}`,
        sourceType: 'daily_goal',
        sourceId: dayKey,
        effectiveAt: `${dayKey}T18:00:00.000Z`,
        createdAt: `${dayKey}T18:00:00.000Z`,
        xpDelta: 25,
        metadata: { dayKey },
      })
    const state = reduceGamificationEventsV3([day('2026-01-05'), day('2026-01-06'), day('2026-01-08')], CTX)
    expect(state.currentStreak).toBe(1)
    expect(state.bestStreak).toBe(2)
    expect(state.lastQualifiedDayKey).toBe('2026-01-08')
  })
})

describe('rebuild and replay equality', () => {
  const ledger = [
    baseline(380, 380),
    positiveBehaviour('b1', 20),
    task('t1', 20),
    redemption('r1', 100),
    negativeBehaviour('b2', 5),
  ]

  it('replaying twice yields the same state', () => {
    expect(reduceGamificationEventsV3(ledger, CTX)).toEqual(reduceGamificationEventsV3(ledger, CTX))
  })

  it('shuffled storage order yields the same result after canonical sorting', () => {
    const shuffled = [ledger[3], ledger[1], ledger[4], ledger[0], ledger[2]]
    expect(reduceGamificationEventsV3(shuffled, CTX)).toEqual(reduceGamificationEventsV3(ledger, CTX))
  })

  it('rebuilds the exact expected projection from the full ledger', () => {
    expect(reduceGamificationEventsV3(ledger, CTX)).toEqual({
      memberId: MEMBER,
      familyId: FAMILY,
      rewardPoints: 315,
      xpTotal: 420,
      weeklyPoints: 40,
      weeklyWindowKey: '2026-W02',
      level: 1,
      xpProgressInLevel: 420,
      xpToNextLevel: 580,
      levelProgressPercentage: 42,
      currentStreak: 0,
      bestStreak: 0,
      lastQualifiedDayKey: null,
      unlockedAvatarIds: [],
      projectionVersion: GAMIFICATION_V3_SCHEMA_VERSION,
      foldedThroughEventId: rewardRedeemedEventId(FAMILY, MEMBER, 'r1'),
      updatedAt: CTX.asOf,
    })
  })

  it('records the empty projection deterministically for a member with no events', () => {
    const empty = reduceGamificationEventsV3([], { ...CTX, familyId: FAMILY, memberId: MEMBER })
    expect(empty.rewardPoints).toBe(0)
    expect(empty.xpTotal).toBe(0)
    expect(empty.foldedThroughEventId).toBeNull()
  })
})

describe('historical regression scenarios', () => {
  it('reproduces legacy baseline 380 plus +20 behaviour plus +20 shared task', () => {
    const events = [baseline(380, 380), positiveBehaviour('b1', 20), task('t1', 20)]
    const state = reduceGamificationEventsV3(events, CTX)
    expect(state.xpTotal).toBe(420)
    expect(state.rewardPoints).toBe(420)
    expect(reduceGamificationEventsV3([...events], CTX)).toEqual(state)
  })

  it('shows a new child with one 5-point task as weekly 5, not 15', () => {
    const state = reduceGamificationEventsV3([task('t1', 5)], CTX)
    expect(state.weeklyPoints).toBe(5)
    expect(state.rewardPoints).toBe(5)
    expect(state.xpTotal).toBe(5)
    expect(state.weeklyPoints).not.toBe(15)
  })

  it('keeps the profile reward balance and the weekly leaderboard total independent', () => {
    const state = reduceGamificationEventsV3([baseline(380, 380), task('t1', 5)], CTX)
    expect(state.rewardPoints).toBe(385)
    expect(state.weeklyPoints).toBe(5)
  })
})

describe('reducer purity', () => {
  it('does not mutate the supplied events', () => {
    const events = [task('t1', 5)]
    const snapshot = JSON.parse(JSON.stringify(events))
    reduceGamificationEventsV3(events, CTX)
    expect(events).toEqual(snapshot)
  })

  it('rejects events from mixed members or families', () => {
    const foreign = { ...task('t1', 5), memberId: 'other' }
    expect(() => reduceGamificationEventsV3([task('t2', 5), foreign], CTX)).toThrow(/single member/i)
  })
})

describe('deterministic event ordering', () => {
  const SAME_TS = '2026-01-05T10:00:00.000Z'

  function makeSameTsEvent(overrides: Partial<GamificationEventV3> & { eventType: GamificationEventV3['eventType'] }): GamificationEventV3 {
    return makeEvent({ effectiveAt: SAME_TS, createdAt: SAME_TS, ...overrides })
  }

  it('processes earning before spending at the same timestamp', () => {
    // Positive behaviour (+5) before negative behaviour (-5) = 0, not -5
    const events = [
      makeSameTsEvent({ eventType: 'BEHAVIOUR_NEGATIVE', eventId: 'behaviour:f:m:n', rewardPointsDelta: -5, xpDelta: 0, weeklyPointsDelta: 0 }),
      makeSameTsEvent({ eventType: 'BEHAVIOUR_POSITIVE', eventId: 'behaviour:f:m:p', rewardPointsDelta: 5, xpDelta: 5, weeklyPointsDelta: 5 }),
    ]
    const state = reduceGamificationEventsV3(events, CTX)
    expect(state.rewardPoints).toBe(0) // +5 then -5, never negative
  })

  it('processes baseline before all other events at the same timestamp', () => {
    const events = [
      makeSameTsEvent({ eventType: 'TASK_APPROVED', eventId: 'task-approved:f:m:t1', rewardPointsDelta: 5, xpDelta: 5, weeklyPointsDelta: 5 }),
      makeSameTsEvent({ eventType: 'LEGACY_BASELINE', eventId: 'legacy-baseline:f:m:v3', rewardPointsDelta: 100, xpDelta: 100, weeklyPointsDelta: 0 }),
    ]
    const state = reduceGamificationEventsV3(events, CTX)
    expect(state.rewardPoints).toBe(105) // baseline first, then task
  })

  it('processes original event before its reversal at the same timestamp', () => {
    const original = makeSameTsEvent({ eventType: 'TASK_APPROVED', eventId: 'task-approved:f:m:t1', rewardPointsDelta: 10, xpDelta: 10, weeklyPointsDelta: 10 })
    const reversal = makeSameTsEvent({ eventType: 'REVERSAL', eventId: 'reversal:task-approved:f:m:t1:r1', rewardPointsDelta: -10, xpDelta: -10, weeklyPointsDelta: -10, reversalOfEventId: 'task-approved:f:m:t1' })
    const events = [reversal, original] // reversed order in input
    const state = reduceGamificationEventsV3(events, CTX)
    expect(state.rewardPoints).toBe(0) // original processed first, then reversal
  })

  it('produces identical results for shuffled input permutations', () => {
    const events = [
      makeSameTsEvent({ eventType: 'BEHAVIOUR_POSITIVE', eventId: 'behaviour:f:m:a', rewardPointsDelta: 10, xpDelta: 10, weeklyPointsDelta: 10 }),
      makeSameTsEvent({ eventType: 'BEHAVIOUR_NEGATIVE', eventId: 'behaviour:f:m:b', rewardPointsDelta: -3, xpDelta: 0, weeklyPointsDelta: 0 }),
      makeSameTsEvent({ eventType: 'TASK_APPROVED', eventId: 'task-approved:f:m:c', rewardPointsDelta: 5, xpDelta: 5, weeklyPointsDelta: 5 }),
    ]
    const reference = reduceGamificationEventsV3(events, CTX)
    for (let i = 0; i < 10; i++) {
      const shuffled = [...events].sort(() => Math.random() - 0.5)
      const result = reduceGamificationEventsV3(shuffled, CTX)
      expect(result.rewardPoints).toBe(reference.rewardPoints)
      expect(result.xpTotal).toBe(reference.xpTotal)
    }
  })

  it('produces identical results on repeated rebuild', () => {
    const events = [
      makeSameTsEvent({ eventType: 'LEGACY_BASELINE', eventId: 'legacy-baseline:f:m:v3', rewardPointsDelta: 100, xpDelta: 100, weeklyPointsDelta: 0 }),
      makeSameTsEvent({ eventType: 'TASK_APPROVED', eventId: 'task-approved:f:m:t1', rewardPointsDelta: 5, xpDelta: 5, weeklyPointsDelta: 5 }),
      makeSameTsEvent({ eventType: 'BEHAVIOUR_POSITIVE', eventId: 'behaviour:f:m:p1', rewardPointsDelta: 20, xpDelta: 20, weeklyPointsDelta: 20 }),
      makeSameTsEvent({ eventType: 'BEHAVIOUR_NEGATIVE', eventId: 'behaviour:f:m:n1', rewardPointsDelta: -5, xpDelta: 0, weeklyPointsDelta: 0 }),
      makeSameTsEvent({ eventType: 'REWARD_REDEEMED', eventId: 'reward-redeemed:f:m:r1', rewardPointsDelta: -10, xpDelta: 0, weeklyPointsDelta: 0 }),
    ]
    const first = reduceGamificationEventsV3(events, CTX)
    for (let i = 0; i < 5; i++) {
      const result = reduceGamificationEventsV3(events, CTX)
      expect(result.rewardPoints).toBe(first.rewardPoints)
      expect(result.xpTotal).toBe(first.xpTotal)
      expect(result.weeklyPoints).toBe(first.weeklyPoints)
    }
  })
})
