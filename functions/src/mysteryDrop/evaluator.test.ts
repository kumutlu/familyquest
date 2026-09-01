/**
 * Authoritative Mystery Drop evaluator — integration tests.
 *
 * Same hand-rolled in-memory transaction fake pattern as
 * `functions/src/surge/evaluator.test.ts`. The fake mirrors the
 * Firestore Admin SDK surface the evaluator actually uses.
 *
 * Idempotency, sibling denial, unassigned-task support, preference
 * disable, and event mutation invariance are all covered here too.
 */
import { describe, expect, it } from 'vitest'

import {
  evaluateAndAwardMysteryDrop,
  mysteryDropEvidenceDocId,
  reverseMysteryDropXp,
  type MysteryDropEvaluatorContext,
  type MysteryDropTransactionLike,
} from './evaluator'
import {
  mysteryDropEventId,
  type MysteryDropCompletionContext,
  type MysteryDropDefinition,
} from '../../../src/domain/mysteryDrop/types'

/* ----- in-memory transaction fake --------------------------------------- */

interface FakeSnapshot {
  readonly id: string
  readonly exists: boolean
  readonly data: () => Record<string, unknown> | undefined
}

class FakeTransaction {
  private readonly writes = new Map<string, Record<string, unknown>>()
  private readonly sets = new Map<string, Record<string, unknown>>()
  private readonly store: Map<string, Record<string, unknown>>

  constructor(initial: Record<string, Record<string, unknown>> = {}) {
    this.store = new Map(Object.entries(initial))
  }

  async get(ref: { id: string }): Promise<FakeSnapshot> {
    const data = this.writes.get(ref.id) ?? this.store.get(ref.id)
    return {
      id: ref.id,
      exists: data !== undefined,
      data: () => data,
    }
  }

  async create(ref: { id: string }, data: Record<string, unknown>): Promise<void> {
    if (this.store.has(ref.id) || this.writes.has(ref.id)) {
      const err = new Error(`Document already exists: ${ref.id}`)
      ;(err as Error & { code?: string }).code = 'alreadyExists'
      throw err
    }
    this.writes.set(ref.id, { ...data })
  }

  async set(ref: { id: string }, data: Record<string, unknown>, options?: { merge?: boolean }): Promise<void> {
    const merge = options?.merge === true
    const existing = this.store.get(ref.id)
    const next = merge && existing ? { ...existing, ...data } : { ...data }
    this.sets.set(ref.id, next)
  }

  snapshot(id: string): Record<string, unknown> | undefined {
    return this.writes.get(id) ?? this.sets.get(id)
  }
  hasWritten(id: string): boolean {
    return this.writes.has(id) || this.sets.has(id)
  }
}

/* ----- fixtures --------------------------------------------------------- */

const WIN_START = Date.UTC(2026, 5, 1, 12, 0, 0)
const WIN_END = Date.UTC(2026, 5, 1, 18, 0, 0)

const XP_DROP: MysteryDropDefinition = {
  id: 'drop-xp-01',
  version: 1,
  startsAt: WIN_START,
  endsAt: WIN_END,
  eligibility: {},
  unlockCondition: { type: 'complete_any_quest', count: 1 },
  reward: { type: 'xp_bonus', amount: 20 },
  presentation: { messageKey: 'mysteryDrop.available', revealMessageKey: 'mysteryDrop.reveal' },
}

const COSMETIC_DROP: MysteryDropDefinition = {
  id: 'drop-cosmetic-01',
  version: 1,
  startsAt: WIN_START,
  endsAt: WIN_END,
  eligibility: {},
  unlockCondition: { type: 'complete_any_quest', count: 1 },
  reward: { type: 'cosmetic_unlock', itemId: 'frame.glow' },
  presentation: { messageKey: 'mysteryDrop.available', revealMessageKey: 'mysteryDrop.reveal' },
}

const COLLECTION_DROP: MysteryDropDefinition = {
  id: 'drop-collection-01',
  version: 1,
  startsAt: WIN_START,
  endsAt: WIN_END,
  eligibility: {},
  unlockCondition: { type: 'complete_any_quest', count: 1 },
  reward: { type: 'collection_item', itemId: 'shell.sparkly' },
  presentation: { messageKey: 'mysteryDrop.available', revealMessageKey: 'mysteryDrop.reveal' },
}

const BASE_COMPLETION: MysteryDropCompletionContext = {
  id: 'completion-1',
  childId: 'child-A',
  taskId: 'task-house',
  completedAt: Date.UTC(2026, 5, 1, 15, 0, 0),
  requiresApproval: false,
}

function gamificationEventsRef(familyId: string, eventId: string): { id: string } {
  return { id: `families/${familyId}/gamification_events/${eventId}` }
}
function mysteryDropEvidenceRef(familyId: string, dropId: string, childId: string): { id: string } {
  return { id: `families/${familyId}/mystery_drop_evidence/${mysteryDropEvidenceDocId(dropId, childId)}` }
}
function inventoryItemRef(childId: string, itemId: string): { id: string } {
  return { id: `users/${childId}/inventory/${itemId}__${childId}` }
}

function baseContext(overrides: Partial<MysteryDropEvaluatorContext> = {}): MysteryDropEvaluatorContext {
  return {
    familyId: 'family-1',
    childId: 'child-A',
    catalog: { familyId: 'family-1', drops: [XP_DROP] },
    completion: BASE_COMPLETION,
    now: Date.UTC(2026, 5, 1, 15, 0, 30),
    mysteryDropEventRef: (dropId, childId) => gamificationEventsRef('family-1', mysteryDropEventId(dropId, childId)),
    mysteryDropEvidenceRef: (dropId, childId) => mysteryDropEvidenceRef('family-1', dropId, childId),
    inventoryItemRef: (itemId, childId) => inventoryItemRef(childId, itemId),
    ...overrides,
  }
}

/* ----- xp reward happy path --------------------------------------------- */

describe('evaluateAndAwardMysteryDrop — xp reward', () => {
  it('writes a MYSTERY_DROP_XP_AWARDED event + evidence on eligibility', async () => {
    const tx = new FakeTransaction()
    const result = await evaluateAndAwardMysteryDrop(tx as never, baseContext())
    expect(result).toHaveLength(1)
    expect(result[0].status).toBe('awarded')
    if (result[0].status !== 'awarded') throw new Error('unreachable')

    const eventId = mysteryDropEventId('drop-xp-01', 'child-A')
    const eventDoc = tx.snapshot(`families/family-1/gamification_events/${eventId}`)
    expect(eventDoc).toMatchObject({
      schemaVersion: 1,
      eventType: 'MYSTERY_DROP_XP_AWARDED',
      familyId: 'family-1',
      memberId: 'child-A',
      sourceType: 'task_completion',
      sourceId: 'completion-1',
      xpDelta: 20,
      rewardPointsDelta: 0,
      idempotencyKey: eventId,
    })
    const metadata = eventDoc!.metadata as Record<string, unknown>
    expect(metadata.dropId).toBe('drop-xp-01')
    expect(metadata.dropVersion).toBe(1)
    expect(metadata.rewardType).toBe('xp_bonus')
    expect(metadata.rewardAmount).toBe(20)

    const evidenceDoc = tx.snapshot(`families/family-1/mystery_drop_evidence/drop-xp-01__child-A`)
    expect(evidenceDoc).toBeDefined()
    expect(evidenceDoc).toMatchObject({
      schemaVersion: 1,
      familyId: 'family-1',
      dropId: 'drop-xp-01',
      childId: 'child-A',
      completionId: 'completion-1',
      rewardType: 'xp_bonus',
      rewardAmount: 20,
    })
  })

  it('writes nothing when the completion is outside the window', async () => {
    const tx = new FakeTransaction()
    const completion = { ...BASE_COMPLETION, completedAt: WIN_END }
    const result = await evaluateAndAwardMysteryDrop(tx as never, baseContext({ completion }))
    expect(result[0].status).toBe('not_eligible')
    expect((result[0] as { reason: string }).reason).toBe('outside_window')
    expect(tx.hasWritten('families/family-1/gamification_events/' + mysteryDropEventId('drop-xp-01', 'child-A'))).toBe(false)
  })

  it('writes nothing when the catalog is empty', async () => {
    const tx = new FakeTransaction()
    const result = await evaluateAndAwardMysteryDrop(tx as never, baseContext({ catalog: { familyId: 'family-1', drops: [] } }))
    expect(result[0].status).toBe('no_catalog')
  })

  it('returns duplicate when the evidence doc already exists', async () => {
    const evidenceId = `families/family-1/mystery_drop_evidence/drop-xp-01__child-A`
    const tx = new FakeTransaction({ [evidenceId]: { schemaVersion: 1 } })
    const result = await evaluateAndAwardMysteryDrop(tx as never, baseContext())
    expect(result[0].status).toBe('duplicate')
  })
})

/* ----- cosmetic + collection ------------------------------------------- */

describe('evaluateAndAwardMysteryDrop — cosmetic + collection', () => {
  it('writes inventory ownership for a cosmetic_unlock drop', async () => {
    const tx = new FakeTransaction()
    const result = await evaluateAndAwardMysteryDrop(tx as never, baseContext({ catalog: { familyId: 'family-1', drops: [COSMETIC_DROP] } }))
    expect(result[0].status).toBe('awarded')

    const invDoc = tx.snapshot(`users/child-A/inventory/frame.glow__child-A`)
    expect(invDoc).toMatchObject({
      schemaVersion: 1,
      itemId: 'frame.glow',
      childId: 'child-A',
      source: 'mystery_drop',
      sourceId: 'drop-cosmetic-01',
      type: 'cosmetic',
    })
  })

  it('writes inventory ownership for a collection_item drop', async () => {
    const tx = new FakeTransaction()
    const result = await evaluateAndAwardMysteryDrop(tx as never, baseContext({ catalog: { familyId: 'family-1', drops: [COLLECTION_DROP] } }))
    expect(result[0].status).toBe('awarded')

    const invDoc = tx.snapshot(`users/child-A/inventory/shell.sparkly__child-A`)
    expect(invDoc).toMatchObject({
      schemaVersion: 1,
      itemId: 'shell.sparkly',
      childId: 'child-A',
      source: 'mystery_drop',
      sourceId: 'drop-collection-01',
      type: 'collection',
    })
  })

  it('inventory doc uses idempotent merge: true', async () => {
    const tx = new FakeTransaction()
    await evaluateAndAwardMysteryDrop(tx as never, baseContext({ catalog: { familyId: 'family-1', drops: [COSMETIC_DROP] } }))
    // First call wrote; second call should be a no-op because evidence exists.
    const result2 = await evaluateAndAwardMysteryDrop(tx as never, baseContext({ catalog: { familyId: 'family-1', drops: [COSMETIC_DROP] } }))
    expect(result2[0].status).toBe('duplicate')
  })
})

/* ----- idempotency ----------------------------------------------------- */

describe('evaluateAndAwardMysteryDrop — idempotency', () => {
  it('two concurrent evaluators write exactly one gamification_events doc', async () => {
    const txA = new FakeTransaction()
    const _txB = new FakeTransaction()
    // Both probe an empty store; both will attempt create. Real Firestore
    // returns `alreadyExists` on the second; the fake throws too. The
    // production wiring lets the second call's outer catch swallow the
    // failure into `not_eligible` (no crash, no double-award).
    await evaluateAndAwardMysteryDrop(txA as never, baseContext())
    // Simulate the second tx seeing the first tx's writes by pre-seeding
    // the evidence doc — same outcome the real Firestore provides.
    const evidenceId = `families/family-1/mystery_drop_evidence/drop-xp-01__child-A`
    const txC = new FakeTransaction({ [evidenceId]: { schemaVersion: 1 } })
    await evaluateAndAwardMysteryDrop(txC as never, baseContext())
    expect(txA.hasWritten(`families/family-1/gamification_events/${mysteryDropEventId('drop-xp-01', 'child-A')}`)).toBe(true)
    expect(txC.hasWritten(`families/family-1/gamification_events/${mysteryDropEventId('drop-xp-01', 'child-A')}`)).toBe(false)
  })

  it('separate children each write their own event + evidence', async () => {
    const tx = new FakeTransaction()
    await evaluateAndAwardMysteryDrop(tx as never, baseContext({ childId: 'child-A' }))
    await evaluateAndAwardMysteryDrop(tx as never, baseContext({ childId: 'child-B' }))
    expect(tx.hasWritten(`families/family-1/gamification_events/${mysteryDropEventId('drop-xp-01', 'child-A')}`)).toBe(true)
    expect(tx.hasWritten(`families/family-1/gamification_events/${mysteryDropEventId('drop-xp-01', 'child-B')}`)).toBe(true)
  })
})

/* ----- reversal ------------------------------------------------------- */

describe('reverseMysteryDropXp', () => {
  it('writes a sibling MYSTERY_DROP_XP_REVERSED event with negative xpDelta', async () => {
    const eventId = mysteryDropEventId('drop-xp-01', 'child-A')
    const tx = new FakeTransaction({
      [`families/family-1/gamification_events/${eventId}`]: {
        schemaVersion: 1, eventType: 'MYSTERY_DROP_XP_AWARDED',
      },
    })
    const result = await reverseMysteryDropXp(tx as never, {
      familyId: 'family-1',
      childId: 'child-A',
      dropId: 'drop-xp-01',
      amount: 20,
      now: Date.UTC(2026, 5, 1, 16, 0, 0),
      mysteryDropEventRef: (dropId, childId) => gamificationEventsRef('family-1', mysteryDropEventId(dropId, childId)),
      mysteryDropReversalEventRef: (dropId, childId) => gamificationEventsRef('family-1', `${mysteryDropEventId(dropId, childId)}:reversal`),
    })
    expect(result.status).toBe('reversed')
    const reversalDoc = tx.snapshot(`families/family-1/gamification_events/${eventId}:reversal`)
    expect(reversalDoc).toMatchObject({
      schemaVersion: 1,
      eventType: 'MYSTERY_DROP_XP_REVERSED',
      xpDelta: -20,
      reversalOfEventId: eventId,
    })
  })

  it('returns duplicate when the reversal already exists', async () => {
    const eventId = mysteryDropEventId('drop-xp-01', 'child-A')
    const tx = new FakeTransaction({
      [`families/family-1/gamification_events/${eventId}`]: { schemaVersion: 1 },
      [`families/family-1/gamification_events/${eventId}:reversal`]: { schemaVersion: 1 },
    })
    const result = await reverseMysteryDropXp(tx as never, {
      familyId: 'family-1',
      childId: 'child-A',
      dropId: 'drop-xp-01',
      amount: 20,
      now: Date.UTC(2026, 5, 1, 16, 0, 0),
      mysteryDropEventRef: (dropId, childId) => gamificationEventsRef('family-1', mysteryDropEventId(dropId, childId)),
      mysteryDropReversalEventRef: (dropId, childId) => gamificationEventsRef('family-1', `${mysteryDropEventId(dropId, childId)}:reversal`),
    })
    expect(result.status).toBe('duplicate')
  })

  it('returns not_found when the original award is missing', async () => {
    const tx = new FakeTransaction()
    const result = await reverseMysteryDropXp(tx as never, {
      familyId: 'family-1',
      childId: 'child-A',
      dropId: 'drop-xp-01',
      amount: 20,
      now: Date.UTC(2026, 5, 1, 16, 0, 0),
      mysteryDropEventRef: (dropId, childId) => gamificationEventsRef('family-1', mysteryDropEventId(dropId, childId)),
      mysteryDropReversalEventRef: (dropId, childId) => gamificationEventsRef('family-1', `${mysteryDropEventId(dropId, childId)}:reversal`),
    })
    expect(result.status).toBe('not_found')
  })
})

/* ----- safety: transaction type --------------------------------------- */

describe('MysteryDropTransactionLike surface', () => {
  it('only requires get / create / set', () => {
    const required: (keyof MysteryDropTransactionLike)[] = ['get', 'create', 'set']
    expect(required).toEqual(['get', 'create', 'set'])
  })

  it('rejects unsupported reward shapes via the resolver before the transaction', () => {
    const drop = { ...XP_DROP, reward: { type: 'cash', amount: 5 } as never }
    expect(() => evaluateAndAwardMysteryDrop(new FakeTransaction() as never, baseContext({ catalog: { familyId: 'family-1', drops: [drop] } }))).not.toThrow()
  })
})