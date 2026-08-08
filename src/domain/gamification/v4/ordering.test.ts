/**
 * Gamification V4 — canonical event ordering tests (Task 1.4).
 *
 * TDD-first: this file fails before `ordering.ts` exists. It proves the
 * canonical deterministic total order is stable under shuffling, never mutates
 * the caller's array, and rejects identical event identities.
 *
 * See docs/gamification-v4-design.md §2.1 and plan Task 1.4.
 */

import { describe, expect, it } from 'vitest'

import { GAMIFICATION_V4_SCHEMA_VERSION } from './types'
import { eventIdFor } from './ids'
import { canonicalOrder, EVENT_PRECEDENCE_V4 } from './ordering'
import type { GamificationEventV4 } from './event'

function makeEvent(overrides: Partial<GamificationEventV4> = {}): GamificationEventV4 {
  const eventType = overrides.eventType ?? 'TASK_APPROVED'
  const sourceId = overrides.sourceId ?? 'src-1'
  const base: GamificationEventV4 = {
    schemaVersion: GAMIFICATION_V4_SCHEMA_VERSION,
    eventId: overrides.eventId ?? eventIdFor('fam', 'mem', eventType, sourceId),
    familyId: 'fam',
    memberId: 'mem',
    eventType,
    sourceType: 'task_completion',
    sourceId,
    effectiveAt: overrides.effectiveAt ?? '2026-01-05T10:00:00.000Z',
    createdAt: overrides.createdAt ?? '2026-01-05T10:00:00.000Z',
    rewardPointsDelta: overrides.rewardPointsDelta ?? 10,
    xpDelta: overrides.xpDelta ?? 5,
    metadata: overrides.metadata ?? {},
    estimated: overrides.estimated ?? false,
  }
  if (overrides.reversalOfEventId !== undefined) {
    return { ...base, reversalOfEventId: overrides.reversalOfEventId }
  }
  return base
}

describe('EVENT_PRECEDENCE_V4', () => {
  it('orders baseline before earnings before spending before reversal', () => {
    expect(EVENT_PRECEDENCE_V4.MIGRATION_BASELINE).toBeLessThan(EVENT_PRECEDENCE_V4.TASK_APPROVED)
    expect(EVENT_PRECEDENCE_V4.TASK_APPROVED).toBeLessThan(EVENT_PRECEDENCE_V4.REWARD_REDEEMED)
    expect(EVENT_PRECEDENCE_V4.REWARD_REDEEMED).toBeLessThan(EVENT_PRECEDENCE_V4.TASK_REVERSED)
    expect(EVENT_PRECEDENCE_V4.TASK_REVERSED).toBeLessThan(EVENT_PRECEDENCE_V4.REWARD_REFUNDED)
  })

  it('assigns a unique rank to every known event type', () => {
    const ranks = Object.values(EVENT_PRECEDENCE_V4)
    expect(new Set(ranks).size).toBe(ranks.length)
  })
})

describe('canonicalOrder — effectiveAt ordering', () => {
  it('sorts ascending by effectiveAt regardless of input order', () => {
    const early = makeEvent({ effectiveAt: '2026-01-01T00:00:00.000Z' })
    const mid = makeEvent({ effectiveAt: '2026-01-02T00:00:00.000Z', sourceId: 'src-2' })
    const late = makeEvent({ effectiveAt: '2026-01-03T00:00:00.000Z', sourceId: 'src-3' })

    const ordered = canonicalOrder([late, early, mid])
    expect(ordered.map((e) => e.eventId)).toEqual([early.eventId, mid.eventId, late.eventId])
  })
})

describe('canonicalOrder — createdAt tie-breaker', () => {
  it('uses createdAt when effectiveAt is identical', () => {
    const a = makeEvent({ effectiveAt: '2026-01-05T10:00:00.000Z', createdAt: '2026-01-05T09:00:00.000Z' })
    const b = makeEvent({
      effectiveAt: '2026-01-05T10:00:00.000Z',
      createdAt: '2026-01-05T11:00:00.000Z',
      sourceId: 'src-2',
    })

    const ordered = canonicalOrder([b, a])
    expect(ordered.map((e) => e.eventId)).toEqual([a.eventId, b.eventId])
  })
})

describe('canonicalOrder — event-type precedence tie-breaker', () => {
  it('orders by EVENT_PRECEDENCE_V4 when timestamps match', () => {
    const baseline = makeEvent({ eventType: 'MIGRATION_BASELINE', sourceId: 'BASELINE' })
    const earning = makeEvent({ eventType: 'TASK_APPROVED', sourceId: 'src-2' })
    const spending = makeEvent({ eventType: 'REWARD_REDEEMED', sourceId: 'src-3' })
    const reversal = makeEvent({ eventType: 'TASK_REVERSED', sourceId: 'src-4', reversalOfEventId: 'x' })

    const ordered = canonicalOrder([reversal, spending, earning, baseline])
    expect(ordered.map((e) => e.eventType)).toEqual([
      'MIGRATION_BASELINE',
      'TASK_APPROVED',
      'REWARD_REDEEMED',
      'TASK_REVERSED',
    ])
  })
})

describe('canonicalOrder — eventId final tie-breaker', () => {
  it('orders by eventId when effectiveAt, createdAt and precedence match', () => {
    const a = makeEvent({ sourceId: 'aaa' })
    const b = makeEvent({ sourceId: 'bbb' })
    const c = makeEvent({ sourceId: 'ccc' })

    const ordered = canonicalOrder([c, a, b])
    expect(ordered.map((e) => e.sourceId)).toEqual(['aaa', 'bbb', 'ccc'])
  })
})

describe('canonicalOrder — baseline before ordinary events', () => {
  it('places MIGRATION_BASELINE first at the same timestamp', () => {
    const baseline = makeEvent({ eventType: 'MIGRATION_BASELINE', sourceId: 'BASELINE' })
    const approved = makeEvent({ eventType: 'TASK_APPROVED', sourceId: 'src-2' })
    const behaviour = makeEvent({ eventType: 'BEHAVIOUR_POSITIVE', sourceId: 'src-3' })

    const ordered = canonicalOrder([behaviour, approved, baseline])
    expect(ordered[0].eventType).toBe('MIGRATION_BASELINE')
  })
})

describe('canonicalOrder — original before its reversal', () => {
  it('orders TASK_APPROVED before TASK_REVERSED at the same timestamp', () => {
    const original = makeEvent({ eventType: 'TASK_APPROVED', sourceId: 'task-1' })
    const reversal = makeEvent({
      eventType: 'TASK_REVERSED',
      sourceId: 'task-1-rev',
      reversalOfEventId: original.eventId,
    })

    const ordered = canonicalOrder([reversal, original])
    expect(ordered.map((e) => e.eventType)).toEqual(['TASK_APPROVED', 'TASK_REVERSED'])
  })

  it('orders REWARD_REDEEMED before REWARD_REFUNDED at the same timestamp', () => {
    const redeemed = makeEvent({ eventType: 'REWARD_REDEEMED', sourceId: 'reward-1' })
    const refunded = makeEvent({
      eventType: 'REWARD_REFUNDED',
      sourceId: 'reward-1-refund',
      reversalOfEventId: redeemed.eventId,
    })

    const ordered = canonicalOrder([refunded, redeemed])
    expect(ordered.map((e) => e.eventType)).toEqual(['REWARD_REDEEMED', 'REWARD_REFUNDED'])
  })
})

describe('canonicalOrder — determinism under shuffling', () => {
  const reference = [
    makeEvent({ eventType: 'MIGRATION_BASELINE', sourceId: 'BASELINE', effectiveAt: '2026-01-01T00:00:00.000Z' }),
    makeEvent({ eventType: 'TASK_APPROVED', sourceId: 'a', effectiveAt: '2026-01-02T00:00:00.000Z' }),
    makeEvent({ eventType: 'BEHAVIOUR_POSITIVE', sourceId: 'b', effectiveAt: '2026-01-02T00:00:00.000Z', createdAt: '2026-01-02T00:00:01.000Z' }),
    makeEvent({ eventType: 'DAILY_GOAL_AWARDED', sourceId: 'c', effectiveAt: '2026-01-02T00:00:00.000Z', createdAt: '2026-01-02T00:00:02.000Z' }),
    makeEvent({ eventType: 'REWARD_REDEEMED', sourceId: 'd', effectiveAt: '2026-01-03T00:00:00.000Z' }),
    makeEvent({ eventType: 'TASK_REVERSED', sourceId: 'e', effectiveAt: '2026-01-03T00:00:00.000Z', reversalOfEventId: 'x' }),
    makeEvent({ eventType: 'REWARD_REFUNDED', sourceId: 'f', effectiveAt: '2026-01-04T00:00:00.000Z', reversalOfEventId: 'y' }),
  ]

  const expectedIds = canonicalOrder(reference).map((e) => e.eventId)

  const permutations = [
    [...reference].reverse(),
    [reference[6], reference[0], reference[3], reference[1], reference[5], reference[2], reference[4]],
    [reference[2], reference[4], reference[6], reference[1], reference[0], reference[3], reference[5]],
    [reference[5], reference[3], reference[1], reference[6], reference[4], reference[0], reference[2]],
  ]

  it.each(permutations.map((p, i) => [i, p] as const))(
    'produces identical order for permutation %i',
    (_i, permuted) => {
      const ordered = canonicalOrder(permuted)
      expect(ordered.map((e) => e.eventId)).toEqual(expectedIds)
    },
  )
})

describe('canonicalOrder — no mutation of caller array', () => {
  it('returns a new array and leaves the input untouched', () => {
    const input = [
      makeEvent({ sourceId: 'b', effectiveAt: '2026-01-02T00:00:00.000Z' }),
      makeEvent({ sourceId: 'a', effectiveAt: '2026-01-01T00:00:00.000Z' }),
    ]
    const snapshot = input.map((e) => e.eventId)

    const result = canonicalOrder(input)

    expect(result).not.toBe(input)
    expect(input.map((e) => e.eventId)).toEqual(snapshot)
  })
})

describe('canonicalOrder — identical event identities rejected', () => {
  it('throws when two events share the same eventId', () => {
    const sharedId = eventIdFor('fam', 'mem', 'TASK_APPROVED', 'dup')
    const first = makeEvent({ eventId: sharedId, sourceId: 'dup' })
    const second = makeEvent({ eventId: sharedId, sourceId: 'dup' })

    expect(() => canonicalOrder([first, second])).toThrow()
  })
})
