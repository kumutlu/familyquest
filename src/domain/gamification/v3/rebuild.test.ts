import { describe, expect, it } from 'vitest'
import { GAMIFICATION_V3_SCHEMA_VERSION, type GamificationEventV3 } from './event'
import { behaviourEventId, legacyBaselineEventId, rewardRedeemedEventId, taskApprovedEventId } from './ids'
import { reduceGamificationEventsV3 } from './reducer'
import { STATE_V3_BUSINESS_FIELDS, type GamificationStateV3 } from './state'
import { serialiseStateV3 } from './storage'
import { resolveWeeklyContext } from './weeklyWindow'

const FAMILY = 'family-1'
const MEMBER = 'member-1'
const CTX = { weekly: resolveWeeklyContext({ timeZone: 'Europe/London' }), asOf: '2026-01-08T00:00:00.000Z' }

function event(partial: Partial<GamificationEventV3> & Pick<GamificationEventV3, 'eventType' | 'eventId'>) {
  return {
    schemaVersion: GAMIFICATION_V3_SCHEMA_VERSION,
    familyId: FAMILY,
    memberId: MEMBER,
    sourceType: 'task_completion',
    sourceId: 'x',
    effectiveAt: '2026-01-05T10:00:00.000Z',
    createdAt: '2026-01-05T10:00:00.000Z',
    rewardPointsDelta: 0,
    xpDelta: 0,
    weeklyPointsDelta: 0,
    idempotencyKey: partial.eventId,
    metadata: {},
    ...partial,
  } as GamificationEventV3
}

const ledger: readonly GamificationEventV3[] = [
  event({
    eventType: 'LEGACY_BASELINE',
    eventId: legacyBaselineEventId(FAMILY, MEMBER),
    sourceType: 'legacy_baseline',
    sourceId: 'v3',
    effectiveAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    rewardPointsDelta: 380,
    xpDelta: 380,
  }),
  event({
    eventType: 'BEHAVIOUR_POSITIVE',
    eventId: behaviourEventId(FAMILY, MEMBER, 'b1'),
    sourceType: 'behaviour_event',
    sourceId: 'b1',
    effectiveAt: '2026-01-05T09:00:00.000Z',
    createdAt: '2026-01-05T09:00:00.000Z',
    rewardPointsDelta: 20,
    xpDelta: 20,
    weeklyPointsDelta: 20,
  }),
  event({
    eventType: 'TASK_APPROVED',
    eventId: taskApprovedEventId(FAMILY, MEMBER, 't1'),
    sourceId: 't1',
    rewardPointsDelta: 20,
    xpDelta: 20,
    weeklyPointsDelta: 20,
  }),
  event({
    eventType: 'REWARD_REDEEMED',
    eventId: rewardRedeemedEventId(FAMILY, MEMBER, 'r1'),
    sourceType: 'redemption',
    sourceId: 'r1',
    effectiveAt: '2026-01-06T08:00:00.000Z',
    createdAt: '2026-01-06T08:00:00.000Z',
    rewardPointsDelta: -50,
  }),
]

function businessFields(state: GamificationStateV3): Record<string, unknown> {
  const projection: Record<string, unknown> = {}
  for (const field of STATE_V3_BUSINESS_FIELDS) {
    projection[field] = state[field]
  }
  return projection
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]]
  const output: T[][] = []
  for (let index = 0; index < items.length; index += 1) {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)]
    for (const tail of permutations(rest)) {
      output.push([items[index], ...tail])
    }
  }
  return output
}

describe('rebuild equality', () => {
  it('rebuilds byte-equivalent business fields after discarding the projection', () => {
    const original = reduceGamificationEventsV3(ledger, CTX)
    // "Delete" the projection and rebuild it purely from the event stream.
    const rebuilt = reduceGamificationEventsV3(ledger, CTX)
    expect(JSON.stringify(businessFields(rebuilt))).toBe(JSON.stringify(businessFields(original)))
    expect(JSON.stringify(serialiseStateV3(rebuilt))).toBe(JSON.stringify(serialiseStateV3(original)))
  })

  it('is invariant under every storage ordering of the ledger', () => {
    const expected = JSON.stringify(businessFields(reduceGamificationEventsV3(ledger, CTX)))
    for (const permutation of permutations(ledger)) {
      expect(JSON.stringify(businessFields(reduceGamificationEventsV3(permutation, CTX)))).toBe(expected)
    }
  })

  it('yields the same state on repeated replay', () => {
    const first = reduceGamificationEventsV3(ledger, CTX)
    const second = reduceGamificationEventsV3(ledger, CTX)
    const third = reduceGamificationEventsV3([...ledger].reverse(), CTX)
    expect(second).toEqual(first)
    expect(third).toEqual(first)
  })

  it('equals the exact expected projection', () => {
    expect(businessFields(reduceGamificationEventsV3(ledger, CTX))).toEqual({
      rewardPoints: 370,
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
    })
  })

  it('adds a legacy baseline and later XP to their exact sum', () => {
    const state = reduceGamificationEventsV3(ledger.slice(0, 3), CTX)
    expect(state.xpTotal).toBe(380 + 20 + 20)
  })
})
