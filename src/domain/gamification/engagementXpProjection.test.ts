/**
 * V1 engagement XP projection — semantic closure.
 *
 * Pinned invariants (required by the closure pass):
 *   1. `normalizeXpLedger` accepts the new engagement XP-bearing event
 *      types: MYSTERY_DROP_XP_AWARDED / REVERSED, COMEBACK_MISSION_XP_AWARDED / REVERSED,
 *      SURGE_BONUS_AWARDED / REVERSED. Without this the rebuild path
 *      would fail-closed and the projection would never converge.
 *   2. `foldXpEvents` folds a sequence of authoritative engagement
 *      events deterministically; duplicate processing MUST NOT change
 *      the total.
 *
 * These are pure-domain tests that pin the canonical projection path.
 * The integration assertion (display XP converges through the
 * authoritative projection immediately) is exercised at the
 * `gamificationRepository` level via the tests for `processApprovedCompletion`.
 */
import { describe, expect, it } from 'vitest'
import { foldXpEvents, type XpEventDocumentV1 } from './xp'
import { normalizeXpLedger, UnknownXpEventError } from './rebuildNormalization'

const FAMILY = 'family-A'
const CHILD = 'child-X'

const baseEvent = (overrides: Partial<XpEventDocumentV1['event']> & { id?: string }): XpEventDocumentV1 => ({
  id: overrides.id ?? 'event-1',
  event: {
    schemaVersion: 1,
    eventType: 'MYSTERY_DROP_XP_AWARDED',
    familyId: FAMILY,
    childId: CHILD,
    xpDelta: 20,
    sourceType: 'task_completion',
    sourceId: 'completion-1',
    idempotencyKey: 'mystery-drop:drop-xp-01:child:child-X',
    causalGroupId: 'group:event-1',
    transitionRank: 0,
    effectiveAt: 1_800_000_000_000,
    createdAt: 1_800_000_000_001,
    configSchemaVersion: 1,
    createdBy: 'engagement-engine-v1',
    ...overrides,
  } as XpEventDocumentV1['event'],
})

describe('normalizeXpLedger — engagement XP-bearing event types', () => {
  it.each([
    ['MYSTERY_DROP_XP_AWARDED'],
    ['MYSTERY_DROP_XP_REVERSED'],
    ['COMEBACK_MISSION_XP_AWARDED'],
    ['COMEBACK_MISSION_XP_REVERSED'],
    ['SURGE_BONUS_AWARDED'],
    ['SURGE_BONUS_REVERSED'],
  ])('accepts %s as a canonical XP-bearing shape', (eventType) => {
    const documents = [{
      id: `${eventType.toLowerCase()}__1`,
      data: {
        schemaVersion: 1,
        eventType,
        familyId: FAMILY,
        childId: CHILD,
        xpDelta: eventType.endsWith('REVERSED') ? -10 : 10,
        sourceType: 'task_completion',
        sourceId: 'completion-1',
        idempotencyKey: `${eventType.toLowerCase()}__1`,
        causalGroupId: 'group:1',
        transitionRank: 0,
        effectiveAt: { toMillis: () => 1_800_000_000_000 },
        createdAt: { toMillis: () => 1_800_000_000_001 },
        configSchemaVersion: 1,
        createdBy: 'engagement-engine-v1',
      },
    }]
    expect(() => normalizeXpLedger({ familyId: FAMILY, documents })).not.toThrow()
  })

  it('still fails closed on truly unrecognized shapes', () => {
    expect(() => normalizeXpLedger({
      familyId: FAMILY,
      documents: [{ id: 'junk', data: { childId: CHILD, eventType: 'surprise', xpDelta: 9, createdAt: { toMillis: () => 123 } } }],
    })).toThrow(UnknownXpEventError)
  })
})

describe('foldXpEvents — engagement XP ledger', () => {
  it('mystery drop +20 produces a total of 20', () => {
    expect(foldXpEvents([baseEvent({ xpDelta: 20 })])).toBe(20)
  })

  it('comeback +25 produces a total of 25', () => {
    expect(foldXpEvents([baseEvent({
      eventType: 'COMEBACK_MISSION_XP_AWARDED',
      xpDelta: 25,
      idempotencyKey: 'comeback:child-X:2026-06-15:return_3d',
    })])).toBe(25)
  })

  it('mystery +20 then reversal -20 nets to 0', () => {
    expect(foldXpEvents([
      baseEvent({ id: 'm1', xpDelta: 20, idempotencyKey: 'mystery-drop:drop-xp-01:child:child-X' }),
      baseEvent({ id: 'm1:r', xpDelta: -20, eventType: 'MYSTERY_DROP_XP_REVERSED', idempotencyKey: 'mystery-drop:drop-xp-01:child:child-X:reversal', causalGroupId: 'group:m1:r' }),
    ])).toBe(0)
  })

  it('duplicate processing with the same idempotencyKey + snapshot does not double-count', () => {
    // Two reads of the SAME event doc (different doc ids but
    // identical canonical semantic snapshot) must NOT add another
    // +20 to the ledger. The fold collapses by idempotencyKey.
    const e1 = baseEvent({ id: 'e1', xpDelta: 20 })
    const e1Duplicate = { ...e1, id: 'e1-dup' }
    const total = foldXpEvents([e1, e1Duplicate])
    expect(total).toBe(20)
  })

  it('combined: starting100 + mystery20 + comeback25 = 145', () => {
    const baseline = baseEvent({ id: 'b', eventType: 'xp_awarded', xpDelta: 100, idempotencyKey: 'b' })
    const mystery = baseEvent({ id: 'm', eventType: 'MYSTERY_DROP_XP_AWARDED', xpDelta: 20 })
    const comeback = baseEvent({ id: 'c', eventType: 'COMEBACK_MISSION_XP_AWARDED', xpDelta: 25, idempotencyKey: 'comeback:child-X:2026-06-15:return_3d' })
    expect(foldXpEvents([baseline, mystery, comeback])).toBe(145)
  })
})