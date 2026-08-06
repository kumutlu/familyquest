/**
 * Gamification V4 — pure projection reducer tests (Task 1.9).
 *
 * TDD-first: this file fails before reducer.ts exists. It encodes the
 * mandatory acceptance tests (#1, #2, #3, #4, #5, #12, #13) plus the
 * replay-determinism and immutability guarantees required by the plan.
 *
 * Pure domain only: no Firestore, no clock, no randomness.
 */

import { describe, expect, it } from 'vitest'

import { GAMIFICATION_V4_SCHEMA_VERSION, type GamificationStateV4 } from './types'
import { type GamificationEventV4 } from './event'
import { canonicalOrder } from './ordering'
import { levelForXp } from './level'
import { computeStreak } from './streak'
import { deriveAchievements, deriveUnlockedAvatars } from './achievements'
import { ValidationErrorV4 } from './validators'
import { eventIdFor } from './ids'
import { reduceGamificationEventsV4, foldEvent, type ReduceContextV4 } from './reducer'

const CTX: ReduceContextV4 = {
  updatedAt: '2026-01-05T10:00:00.000Z',
  projectionVersion: 1,
}

function makeEvent(init: Partial<GamificationEventV4> & { eventType: GamificationEventV4['eventType'] }): GamificationEventV4 {
  const sourceId = init.sourceId ?? 'src'
  return {
    schemaVersion: GAMIFICATION_V4_SCHEMA_VERSION,
    eventId: init.eventId ?? eventIdFor('fam', 'mem', init.eventType, sourceId),
    familyId: 'fam',
    memberId: 'mem',
    eventType: init.eventType,
    sourceType: init.sourceType ?? 'task_completion',
    sourceId,
    effectiveAt: init.effectiveAt ?? '2026-01-05T10:00:00.000Z',
    createdAt: init.createdAt ?? (init.effectiveAt ?? '2026-01-05T10:00:00.000Z'),
    rewardPointsDelta: init.rewardPointsDelta ?? 0,
    xpDelta: init.xpDelta ?? 0,
    metadata: init.metadata ?? {},
    estimated: init.estimated ?? false,
    reversalOfEventId: init.reversalOfEventId,
  }
}

describe('reduceGamificationEventsV4 — mandatory acceptance tests', () => {
  it('#1 task approval +20 -> RP+20 / XP+20', () => {
    const state = reduceGamificationEventsV4(
      [makeEvent({ eventType: 'TASK_APPROVED', rewardPointsDelta: 20, xpDelta: 20 })],
      CTX,
    )
    expect(state.rewardPoints).toBe(20)
    expect(state.xpTotal).toBe(20)
  })

  it('#2 positive behaviour +20 -> RP+20 / XP+20', () => {
    const state = reduceGamificationEventsV4(
      [makeEvent({ eventType: 'BEHAVIOUR_POSITIVE', rewardPointsDelta: 20, xpDelta: 20 })],
      CTX,
    )
    expect(state.rewardPoints).toBe(20)
    expect(state.xpTotal).toBe(20)
  })

  it('#3 negative behaviour -5 -> RP-5 (clamped) / XP unchanged', () => {
    const state = reduceGamificationEventsV4(
      [makeEvent({ eventType: 'BEHAVIOUR_NEGATIVE', rewardPointsDelta: -5, xpDelta: 0 })],
      CTX,
    )
    expect(state.rewardPoints).toBe(0)
    expect(state.xpTotal).toBe(0)
  })

  it('#4 redemption -10 -> RP-10 (clamped) / XP unchanged', () => {
    const state = reduceGamificationEventsV4(
      [makeEvent({ eventType: 'REWARD_REDEEMED', rewardPointsDelta: -10, xpDelta: 0 })],
      CTX,
    )
    expect(state.rewardPoints).toBe(0)
    expect(state.xpTotal).toBe(0)
  })

  it('#5 reversal cancels exactly one original', () => {
    const original = makeEvent({ eventType: 'TASK_APPROVED', sourceId: 'task-1', rewardPointsDelta: 20, xpDelta: 20 })
    const reversal = makeEvent({
      eventType: 'TASK_REVERSED',
      sourceId: 'task-1',
      rewardPointsDelta: -20,
      xpDelta: -20,
      reversalOfEventId: original.eventId,
    })
    const state = reduceGamificationEventsV4([original, reversal], CTX)
    expect(state.rewardPoints).toBe(0)
    expect(state.xpTotal).toBe(0)
  })

  it('#12 rewardPoints never below zero', () => {
    const state = reduceGamificationEventsV4(
      [makeEvent({ eventType: 'REWARD_REDEEMED', rewardPointsDelta: -10, xpDelta: 0 })],
      CTX,
    )
    expect(state.rewardPoints).toBeGreaterThanOrEqual(0)
    expect(state.rewardPoints).toBe(0)
  })

  it('#13 XP only decreases via reversal', () => {
    // A non-reversal event with negative xpDelta is rejected by the reducer.
    const bad = makeEvent({ eventType: 'MANUAL_ADJUSTMENT', rewardPointsDelta: 0, xpDelta: -5 })
    expect(() => reduceGamificationEventsV4([bad], CTX)).toThrow(ValidationErrorV4)

    // A reversal event with negative xpDelta is accepted and reduces XP.
    const original = makeEvent({ eventType: 'TASK_APPROVED', sourceId: 't', rewardPointsDelta: 10, xpDelta: 10 })
    const reversal = makeEvent({
      eventType: 'TASK_REVERSED',
      sourceId: 't',
      rewardPointsDelta: -10,
      xpDelta: -10,
      reversalOfEventId: original.eventId,
    })
    const state = reduceGamificationEventsV4([original, reversal], CTX)
    expect(state.xpTotal).toBe(0)
  })
})

describe('reduceGamificationEventsV4 — ledger shapes', () => {
  it('empty ledger yields zeroed baseline state', () => {
    const state = reduceGamificationEventsV4([], CTX)
    expect(state.rewardPoints).toBe(0)
    expect(state.xpTotal).toBe(0)
    expect(state.level).toBe(1)
    expect(state.currentStreak).toBe(0)
    expect(state.bestStreak).toBe(0)
    expect(state.unlockedAchievementIds).toEqual([])
    expect(state.unlockedAvatarIds).toEqual([])
    expect(state.foldedThroughEventId).toBeNull()
  })

  it('baseline only seeds rewardPoints and xpTotal', () => {
    const state = reduceGamificationEventsV4(
      [makeEvent({ eventType: 'MIGRATION_BASELINE', rewardPointsDelta: 50, xpDelta: 50 })],
      CTX,
    )
    expect(state.rewardPoints).toBe(50)
    expect(state.xpTotal).toBe(50)
  })

  it('shuffled input == canonical replay (deterministic order)', () => {
    const events = [
      makeEvent({ eventType: 'TASK_APPROVED', sourceId: 'a', rewardPointsDelta: 10, xpDelta: 10, effectiveAt: '2026-01-01T00:00:00.000Z' }),
      makeEvent({ eventType: 'BEHAVIOUR_POSITIVE', sourceId: 'b', rewardPointsDelta: 5, xpDelta: 5, effectiveAt: '2026-01-02T00:00:00.000Z' }),
      makeEvent({ eventType: 'REWARD_REDEEMED', sourceId: 'c', rewardPointsDelta: -3, xpDelta: 0, effectiveAt: '2026-01-03T00:00:00.000Z' }),
      makeEvent({ eventType: 'DAILY_GOAL_AWARDED', sourceId: 'd', rewardPointsDelta: 2, xpDelta: 2, effectiveAt: '2026-01-04T00:00:00.000Z' }),
    ]
    const canonical = reduceGamificationEventsV4(events, CTX)
    const shuffled = reduceGamificationEventsV4([...events].reverse(), CTX)
    expect(shuffled.rewardPoints).toBe(canonical.rewardPoints)
    expect(shuffled.xpTotal).toBe(canonical.xpTotal)
    expect(shuffled.currentStreak).toBe(canonical.currentStreak)
    expect(shuffled.unlockedAchievementIds).toEqual(canonical.unlockedAchievementIds)
  })

  it('repeated replay is deterministic', () => {
    const events = [
      makeEvent({ eventType: 'TASK_APPROVED', sourceId: 'a', rewardPointsDelta: 10, xpDelta: 10 }),
      makeEvent({ eventType: 'REWARD_REDEEMED', sourceId: 'b', rewardPointsDelta: -4, xpDelta: 0 }),
    ]
    const first = reduceGamificationEventsV4(events, CTX)
    const second = reduceGamificationEventsV4(events, CTX)
    expect(second).toEqual(first)
  })

  it('duplicate eventId is rejected (canonical order guard)', () => {
    const dup = makeEvent({ eventType: 'TASK_APPROVED', sourceId: 'a', rewardPointsDelta: 10, xpDelta: 10 })
    expect(() => reduceGamificationEventsV4([dup, { ...dup }], CTX)).toThrow(ValidationErrorV4)
  })

  it('reversal cancellation leaves non-reversed earnings intact', () => {
    const keep = makeEvent({ eventType: 'TASK_APPROVED', sourceId: 'keep', rewardPointsDelta: 30, xpDelta: 30 })
    const original = makeEvent({ eventType: 'TASK_APPROVED', sourceId: 'rev', rewardPointsDelta: 20, xpDelta: 20 })
    const reversal = makeEvent({
      eventType: 'TASK_REVERSED',
      sourceId: 'rev',
      rewardPointsDelta: -20,
      xpDelta: -20,
      reversalOfEventId: original.eventId,
    })
    const state = reduceGamificationEventsV4([keep, original, reversal], CTX)
    expect(state.rewardPoints).toBe(30)
    expect(state.xpTotal).toBe(30)
  })
})

describe('reduceGamificationEventsV4 — derived fields come only from helpers', () => {
  it('level comes only from levelForXp()', () => {
    const state = reduceGamificationEventsV4(
      [makeEvent({ eventType: 'TASK_APPROVED', rewardPointsDelta: 2500, xpDelta: 2500 })],
      CTX,
    )
    const expected = levelForXp(state.xpTotal)
    expect(state.level).toBe(expected.level)
    expect(state.xpProgressInLevel).toBe(expected.xpProgressInLevel)
    expect(state.xpToNextLevel).toBe(expected.xpToNextLevel)
    expect(state.levelProgressPercentage).toBe(expected.levelProgressPercentage)
  })

  it('streak comes only from computeStreak()', () => {
    const asOfDayKey = '2026-01-05'
    const ctx: ReduceContextV4 = { ...CTX, asOfDayKey }
    const events = [
      makeEvent({ eventType: 'DAILY_GOAL_AWARDED', sourceId: 'd1', rewardPointsDelta: 1, xpDelta: 1, effectiveAt: '2026-01-03T00:00:00.000Z' }),
      makeEvent({ eventType: 'DAILY_GOAL_AWARDED', sourceId: 'd2', rewardPointsDelta: 1, xpDelta: 1, effectiveAt: '2026-01-04T00:00:00.000Z' }),
      makeEvent({ eventType: 'DAILY_GOAL_AWARDED', sourceId: 'd3', rewardPointsDelta: 1, xpDelta: 1, effectiveAt: '2026-01-05T00:00:00.000Z' }),
    ]
    const state = reduceGamificationEventsV4(events, ctx)
    const expected = computeStreak(canonicalOrder(events), asOfDayKey, ctx.timezone)
    expect(state.currentStreak).toBe(expected.currentStreak)
    expect(state.bestStreak).toBe(expected.bestStreak)
    expect(state.lastQualifiedDayKey).toBe(expected.lastQualifiedDayKey)
  })

  it('achievements derived only via helper', () => {
    const state = reduceGamificationEventsV4(
      [makeEvent({ eventType: 'TASK_APPROVED', rewardPointsDelta: 50, xpDelta: 50 })],
      CTX,
    )
    expect(state.unlockedAchievementIds).toEqual(deriveAchievements(state))
  })

  it('avatars derived only via helper', () => {
    const events = [
      makeEvent({ eventType: 'AVATAR_UNLOCKED', sourceId: 'av1', rewardPointsDelta: 0, xpDelta: 0, metadata: { avatarId: 'avatar-1' } }),
    ]
    const state = reduceGamificationEventsV4(events, CTX)
    expect(state.unlockedAvatarIds).toEqual(deriveUnlockedAvatars(state))
    expect(state.unlockedAvatarIds).toContain('avatar-1')
  })
})

describe('immutability guarantees', () => {
  it('input event array is not mutated', () => {
    const original = makeEvent({ eventType: 'TASK_APPROVED', rewardPointsDelta: 10, xpDelta: 10 })
    const events: GamificationEventV4[] = [original]
    reduceGamificationEventsV4(events, CTX)
    expect(events.length).toBe(1)
    expect(events[0]).toBe(original)
    expect(events[0].rewardPointsDelta).toBe(10)
  })

  it('input state object is not mutated by foldEvent', () => {
    const state: GamificationStateV4 = {
      rewardPoints: 5,
      xpTotal: 5,
      level: 1,
      xpProgressInLevel: 5,
      xpToNextLevel: 995,
      levelProgressPercentage: 0,
      currentStreak: 0,
      bestStreak: 0,
      lastQualifiedDayKey: null,
      unlockedAchievementIds: [],
      unlockedAvatarIds: [],
      projectionVersion: 0,
      foldedThroughEventId: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const snapshot = { ...state }
    foldEvent(state, makeEvent({ eventType: 'TASK_APPROVED', rewardPointsDelta: 10, xpDelta: 10 }))
    expect(state.rewardPoints).toBe(snapshot.rewardPoints)
    expect(state.xpTotal).toBe(snapshot.xpTotal)
  })

  it('returned state is a new immutable object', () => {
    const state = reduceGamificationEventsV4(
      [makeEvent({ eventType: 'TASK_APPROVED', rewardPointsDelta: 10, xpDelta: 10 })],
      CTX,
    )
    expect(state.rewardPoints).toBe(10)
    // metadata from ctx is applied, not the baseline placeholder
    expect(state.updatedAt).toBe(CTX.updatedAt)
    expect(state.projectionVersion).toBe(CTX.projectionVersion)
  })
})
