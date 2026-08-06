/**
 * Gamification V4 — projection rebuild from ledger tests (Task 1.10).
 *
 * TDD-first: this file fails before rebuild.ts exists. It proves the rebuild
 * contract required by the plan:
 *
 *   - rebuildStateFromLedger(events, ctx) is byte-identical on business fields
 *     to reduceGamificationEventsV4(events, ctx) (the sole state-building
 *     algorithm — no second reducer).
 *   - rebuildAllMembers(ledger, ctx) groups the ledger per member and rebuilds
 *     each member independently.
 *   - Rebuild is deterministic, does not mutate the ledger, and rejects
 *     duplicate / malformed event identities through existing validators and
 *     the canonical-order helper.
 *
 * Pure domain only: no Firestore, no clock, no randomness.
 */

import { describe, expect, it } from 'vitest'

import { GAMIFICATION_V4_SCHEMA_VERSION, businessFields, type GamificationStateV4 } from './types'
import { type GamificationEventV4 } from './event'
import { eventIdFor } from './ids'
import { ValidationErrorV4 } from './validators'
import { reduceGamificationEventsV4, type ReduceContextV4 } from './reducer'
import { rebuildStateFromLedger, rebuildAllMembers } from './rebuild'

const CTX: ReduceContextV4 = {
  updatedAt: '2026-01-05T10:00:00.000Z',
  projectionVersion: 1,
}

function makeEvent(
  init: Partial<GamificationEventV4> & { eventType: GamificationEventV4['eventType'] },
): GamificationEventV4 {
  const sourceId = init.sourceId ?? 'src'
  return {
    schemaVersion: GAMIFICATION_V4_SCHEMA_VERSION,
    eventId: init.eventId ?? eventIdFor('fam', 'mem', init.eventType, sourceId),
    familyId: 'fam',
    memberId: init.memberId ?? 'mem',
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

/** Build a representative populated ledger for a single member. */
function populatedLedger(): GamificationEventV4[] {
  return [
    makeEvent({ eventType: 'MIGRATION_BASELINE', sourceId: 'BASELINE', rewardPointsDelta: 50, xpDelta: 50 }),
    makeEvent({ eventType: 'TASK_APPROVED', sourceId: 't1', rewardPointsDelta: 20, xpDelta: 20, effectiveAt: '2026-01-01T00:00:00.000Z' }),
    makeEvent({ eventType: 'BEHAVIOUR_POSITIVE', sourceId: 'b1', rewardPointsDelta: 5, xpDelta: 5, effectiveAt: '2026-01-02T00:00:00.000Z' }),
    makeEvent({ eventType: 'DAILY_GOAL_AWARDED', sourceId: 'd1', rewardPointsDelta: 2, xpDelta: 2, effectiveAt: '2026-01-03T00:00:00.000Z' }),
    makeEvent({ eventType: 'REWARD_REDEEMED', sourceId: 'r1', rewardPointsDelta: -10, xpDelta: 0, effectiveAt: '2026-01-04T00:00:00.000Z' }),
    makeEvent({ eventType: 'AVATAR_UNLOCKED', sourceId: 'a1', rewardPointsDelta: 0, xpDelta: 0, metadata: { avatarId: 'avatar-1' }, effectiveAt: '2026-01-05T00:00:00.000Z' }),
  ]
}

describe('rebuildStateFromLedger — rebuild equals reducer (byte-identical business fields)', () => {
  it('empty ledger rebuild matches reducer output', () => {
    const rebuilt = rebuildStateFromLedger([], CTX)
    const reduced = reduceGamificationEventsV4([], CTX)
    expect(businessFields(rebuilt)).toEqual(businessFields(reduced))
    expect(rebuilt.rewardPoints).toBe(0)
    expect(rebuilt.xpTotal).toBe(0)
    expect(rebuilt.foldedThroughEventId).toBeNull()
  })

  it('baseline-only rebuild matches reducer output', () => {
    const events = [makeEvent({ eventType: 'MIGRATION_BASELINE', sourceId: 'BASELINE', rewardPointsDelta: 50, xpDelta: 50 })]
    const rebuilt = rebuildStateFromLedger(events, CTX)
    const reduced = reduceGamificationEventsV4(events, CTX)
    expect(businessFields(rebuilt)).toEqual(businessFields(reduced))
    expect(rebuilt.rewardPoints).toBe(50)
    expect(rebuilt.xpTotal).toBe(50)
  })

  it('populated ledger rebuild matches reducer output on every business field', () => {
    const events = populatedLedger()
    const rebuilt = rebuildStateFromLedger(events, CTX)
    const reduced = reduceGamificationEventsV4(events, CTX)
    expect(businessFields(rebuilt)).toEqual(businessFields(reduced))
    // Spot-check the authoritative fields are exactly as the reducer produced.
    expect(rebuilt.rewardPoints).toBe(reduced.rewardPoints)
    expect(rebuilt.xpTotal).toBe(reduced.xpTotal)
    expect(rebuilt.level).toBe(reduced.level)
    expect(rebuilt.currentStreak).toBe(reduced.currentStreak)
    expect(rebuilt.bestStreak).toBe(reduced.bestStreak)
    expect(rebuilt.unlockedAchievementIds).toEqual(reduced.unlockedAchievementIds)
    expect(rebuilt.unlockedAvatarIds).toEqual(reduced.unlockedAvatarIds)
  })

  it('all authoritative business fields match exactly (deep equality)', () => {
    const events = populatedLedger()
    const rebuilt = rebuildStateFromLedger(events, CTX)
    const reduced = reduceGamificationEventsV4(events, CTX)
    expect(JSON.stringify(businessFields(rebuilt))).toBe(JSON.stringify(businessFields(reduced)))
  })
})

describe('rebuildStateFromLedger — mandatory test #8 (projection deletion + rebuild)', () => {
  it('deleting the projection and rebuilding from the ledger yields identical state', () => {
    const ledger = populatedLedger()
    // First "materialised" projection (as if stored).
    const materialised: GamificationStateV4 = reduceGamificationEventsV4(ledger, CTX)
    // Projection is deleted (dropped from storage) — only the ledger remains.
    const deleted: GamificationStateV4 | null = null
    expect(deleted).toBeNull()
    // Rebuild purely from the ledger.
    const rebuilt = rebuildStateFromLedger(ledger, CTX)
    expect(businessFields(rebuilt)).toEqual(businessFields(materialised))
  })
})

describe('rebuildStateFromLedger — determinism and immutability', () => {
  it('repeated rebuild yields identical state', () => {
    const ledger = populatedLedger()
    const first = rebuildStateFromLedger(ledger, CTX)
    const second = rebuildStateFromLedger(ledger, CTX)
    expect(businessFields(second)).toEqual(businessFields(first))
    expect(second).toEqual(first)
  })

  it('shuffled ledger yields identical state', () => {
    const ledger = populatedLedger()
    const canonical = rebuildStateFromLedger(ledger, CTX)
    const shuffled = rebuildStateFromLedger([...ledger].reverse(), CTX)
    expect(businessFields(shuffled)).toEqual(businessFields(canonical))
  })

  it('original ledger array remains unchanged', () => {
    const original = makeEvent({ eventType: 'TASK_APPROVED', sourceId: 't1', rewardPointsDelta: 10, xpDelta: 10 })
    const ledger: GamificationEventV4[] = [original]
    rebuildStateFromLedger(ledger, CTX)
    expect(ledger.length).toBe(1)
    expect(ledger[0]).toBe(original)
    expect(ledger[0].rewardPointsDelta).toBe(10)
  })

  it('no hidden input outside ledger + explicit context (business fields independent of ctx timestamp)', () => {
    const ledger = populatedLedger()
    const ctxA: ReduceContextV4 = { ...CTX, updatedAt: '2026-01-05T10:00:00.000Z' }
    const ctxB: ReduceContextV4 = { ...CTX, updatedAt: '2026-06-30T23:59:59.000Z' }
    const rebuiltA = rebuildStateFromLedger(ledger, ctxA)
    const rebuiltB = rebuildStateFromLedger(ledger, ctxB)
    // Business state depends only on the ledger, never on the projection timestamp.
    expect(businessFields(rebuiltB)).toEqual(businessFields(rebuiltA))
    // Only metadata may differ, and it must come solely from ctx.
    expect(rebuiltA.updatedAt).toBe(ctxA.updatedAt)
    expect(rebuiltB.updatedAt).toBe(ctxB.updatedAt)
    expect(rebuiltA.projectionVersion).toBe(ctxA.projectionVersion)
  })
})

describe('rebuildStateFromLedger — rejection of bad identities', () => {
  it('duplicate eventId is rejected', () => {
    const dup = makeEvent({ eventType: 'TASK_APPROVED', sourceId: 't1', rewardPointsDelta: 10, xpDelta: 10 })
    expect(() => rebuildStateFromLedger([dup, { ...dup }], CTX)).toThrow(ValidationErrorV4)
  })

  it('malformed event is rejected', () => {
    const malformed = { ...makeEvent({ eventType: 'TASK_APPROVED', sourceId: 't1', rewardPointsDelta: 10, xpDelta: 10 }), schemaVersion: 3 } as unknown as GamificationEventV4
    expect(() => rebuildStateFromLedger([malformed], CTX)).toThrow(ValidationErrorV4)
  })
})

describe('rebuildStateFromLedger — reversal reproduces corrected state', () => {
  it('rebuild after reversal reproduces the same corrected state as the reducer', () => {
    const keep = makeEvent({ eventType: 'TASK_APPROVED', sourceId: 'keep', rewardPointsDelta: 30, xpDelta: 30 })
    const original = makeEvent({ eventType: 'TASK_APPROVED', sourceId: 'rev', rewardPointsDelta: 20, xpDelta: 20 })
    const reversal = makeEvent({
      eventType: 'TASK_REVERSED',
      sourceId: 'rev',
      rewardPointsDelta: -20,
      xpDelta: -20,
      reversalOfEventId: original.eventId,
    })
    const ledger = [keep, original, reversal]
    const rebuilt = rebuildStateFromLedger(ledger, CTX)
    const reduced = reduceGamificationEventsV4(ledger, CTX)
    expect(businessFields(rebuilt)).toEqual(businessFields(reduced))
    expect(rebuilt.rewardPoints).toBe(30)
    expect(rebuilt.xpTotal).toBe(30)
  })
})

describe('rebuildAllMembers — per-member rebuild', () => {
  it('groups the ledger by member and rebuilds each independently', () => {
    const ledger: GamificationEventV4[] = [
      makeEvent({ memberId: 'mem1', eventType: 'TASK_APPROVED', sourceId: 't1', rewardPointsDelta: 10, xpDelta: 10 }),
      makeEvent({ memberId: 'mem1', eventType: 'REWARD_REDEEMED', sourceId: 'r1', rewardPointsDelta: -4, xpDelta: 0 }),
      makeEvent({ memberId: 'mem2', eventType: 'BEHAVIOUR_POSITIVE', sourceId: 'b1', rewardPointsDelta: 7, xpDelta: 7 }),
    ]
    const all = rebuildAllMembers(ledger, CTX)
    expect(Object.keys(all).sort()).toEqual(['mem1', 'mem2'])
    expect(businessFields(all.mem1)).toEqual(
      businessFields(rebuildStateFromLedger(ledger.filter((e) => e.memberId === 'mem1'), CTX)),
    )
    expect(businessFields(all.mem2)).toEqual(
      businessFields(rebuildStateFromLedger(ledger.filter((e) => e.memberId === 'mem2'), CTX)),
    )
    expect(all.mem1.rewardPoints).toBe(6)
    expect(all.mem2.rewardPoints).toBe(7)
  })

  it('does not mutate the input ledger', () => {
    const ledger: GamificationEventV4[] = [
      makeEvent({ memberId: 'mem1', eventType: 'TASK_APPROVED', sourceId: 't1', rewardPointsDelta: 10, xpDelta: 10 }),
    ]
    const snapshot = ledger.length
    rebuildAllMembers(ledger, CTX)
    expect(ledger.length).toBe(snapshot)
  })
})
