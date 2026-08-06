/**
 * Gamification V4 — reversal event construction tests (Task 1.8).
 *
 * Pure domain module: no Firestore, no Cloud Functions, no clock access.
 * See docs/gamification-v4-design.md §2.1 and plan Task 1.8.
 */

import { describe, expect, it } from 'vitest'
import {
  GAMIFICATION_V4_SCHEMA_VERSION,
  SOURCE_TYPE,
} from './types'
import type { GamificationEventV4 } from './event'
import { assertValidEventV4 } from './validators'
import { buildReversalEvent, isReversalOf } from './reversal'

function makeOriginal(overrides: Partial<GamificationEventV4> = {}): GamificationEventV4 {
  return {
    schemaVersion: GAMIFICATION_V4_SCHEMA_VERSION,
    eventId: 'fam1::mem1::TASK_APPROVED::task-1#2026-01-05',
    familyId: 'fam1',
    memberId: 'mem1',
    eventType: 'TASK_APPROVED',
    sourceType: 'task_completion',
    sourceId: 'task-1#2026-01-05',
    effectiveAt: '2026-01-05T10:00:00.000Z',
    createdAt: '2026-01-05T10:00:01.000Z',
    rewardPointsDelta: 20,
    xpDelta: 20,
    metadata: { reason: 'approved' },
    estimated: false,
    ...overrides,
  }
}

describe('buildReversalEvent', () => {
  it('negates exactly the original deltas for a REV reversal', () => {
    const original = makeOriginal()
    const reversal = buildReversalEvent(original, 'REV')
    expect(reversal.rewardPointsDelta).toBe(-original.rewardPointsDelta)
    expect(reversal.xpDelta).toBe(-original.xpDelta)
  })

  it('maps REV to TASK_REVERSED and REFUND to REWARD_REFUNDED', () => {
    const original = makeOriginal()
    expect(buildReversalEvent(original, 'REV').eventType).toBe('TASK_REVERSED')
    expect(buildReversalEvent(original, 'REFUND').eventType).toBe('REWARD_REFUNDED')
  })

  it('references exactly one original via reversalOfEventId', () => {
    const original = makeOriginal()
    const reversal = buildReversalEvent(original, 'REV')
    expect(reversal.reversalOfEventId).toBe(original.eventId)
    expect(reversal.reversalOfEventId).not.toBe(reversal.eventId)
  })

  it('derives an idempotent id via reversalEventId', () => {
    const original = makeOriginal()
    const a = buildReversalEvent(original, 'REV')
    const b = buildReversalEvent(original, 'REV')
    expect(a.eventId).toBe(b.eventId)
    expect(a.eventId).toBe(`${original.eventId}::REV`)
  })

  it('preserves family and member from the original', () => {
    const original = makeOriginal()
    const reversal = buildReversalEvent(original, 'REV')
    expect(reversal.familyId).toBe(original.familyId)
    expect(reversal.memberId).toBe(original.memberId)
  })

  it('uses the reversal source type', () => {
    const original = makeOriginal()
    const reversal = buildReversalEvent(original, 'REV')
    expect(reversal.sourceType).toBe(SOURCE_TYPE.REVERSAL)
  })

  it('does not mutate the caller-provided original', () => {
    const original = makeOriginal()
    const snapshot = JSON.parse(JSON.stringify(original))
    buildReversalEvent(original, 'REV')
    expect(original).toEqual(snapshot)
  })

  it('produces an event that passes V4 validation', () => {
    const original = makeOriginal()
    const reversal = buildReversalEvent(original, 'REV')
    expect(() => assertValidEventV4(reversal)).not.toThrow()
  })

  it('is idempotent: same inputs yield equal reversal events', () => {
    const original = makeOriginal()
    expect(buildReversalEvent(original, 'REFUND')).toEqual(buildReversalEvent(original, 'REFUND'))
  })
})

describe('isReversalOf', () => {
  it('returns true when the event reverses the given original id', () => {
    const original = makeOriginal()
    const reversal = buildReversalEvent(original, 'REV')
    expect(isReversalOf(reversal, original.eventId)).toBe(true)
  })

  it('returns false for a non-reversal event', () => {
    const original = makeOriginal()
    expect(isReversalOf(original, original.eventId)).toBe(false)
  })

  it('returns false when the original id does not match', () => {
    const original = makeOriginal()
    const reversal = buildReversalEvent(original, 'REV')
    expect(isReversalOf(reversal, 'some-other-id')).toBe(false)
  })
})
