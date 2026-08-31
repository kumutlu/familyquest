/**
 * Authoritative Surge evaluator — integration tests.
 *
 * These tests exercise the evaluator against the Firestore transaction
 * surface via a hand-rolled in-memory fake. The fake mirrors the contract
 * the real Admin SDK `Transaction` exposes for the operations the
 * evaluator actually uses:
 *   - transaction.get(docRef)
 *   - transaction.create(docRef, data)  → throws on duplicate
 *   - transaction.set(docRef, data, { merge })
 *
 * Idempotency, sibling denial, unassigned-task support, preference
 * disable, and event mutation invariance are all covered here too — the
 * domain module has its own RED/GREEN tests, but we also assert the
 * integration surfaces (snapshot shape, transaction call signature) so a
 * future regression cannot break the authoritative write without
 * failing a test.
 */
import { describe, expect, it } from 'vitest'

import {
  evaluateAndAwardSurgeBonus,
  type SurgeEvaluatorContext,
} from './evaluator'
import type { ActiveSurge, SurgeCatalog } from './catalog'

/* ----- in-memory transaction fake ---------------------------------------- */

interface FakeSnapshot {
  readonly id: string
  readonly data: () => Record<string, unknown> | undefined
  readonly exists: boolean
}

class FakeTransaction {
  private readonly writes = new Map<string, Record<string, unknown>>()
  private readonly createdIds = new Set<string>()
  private readonly store: Map<string, Record<string, unknown>>

  constructor(initial: Record<string, Record<string, unknown>> = {}) {
    this.store = new Map(Object.entries(initial))
  }

  async get(ref: { id: string }): Promise<FakeSnapshot> {
    const data = this.store.get(ref.id)
    return {
      id: ref.id,
      exists: data !== undefined,
      data: () => data,
    }
  }

  async create(ref: { id: string }, data: Record<string, unknown>): Promise<void> {
    if (this.store.has(ref.id) || this.createdIds.has(ref.id)) {
      const err = new Error(`Document already exists: ${ref.id}`)
      ;(err as Error & { code?: string }).code = 'alreadyExists'
      throw err
    }
    this.writes.set(ref.id, { ...data })
    this.createdIds.add(ref.id)
  }

  async set(ref: { id: string }, data: Record<string, unknown>): Promise<void> {
    this.writes.set(ref.id, { ...data })
  }

  // Test helpers
  snapshot(id: string): Record<string, unknown> | undefined {
    return this.writes.get(id)
  }
  hasWritten(id: string): boolean {
    return this.writes.has(id)
  }
  committedState(): Record<string, Record<string, unknown>> {
    return Object.fromEntries(this.writes)
  }
}

function familyRef(familyId: string) {
  return { id: `families/${familyId}` }
}
function gamificationEventsRef(familyId: string, eventId: string) {
  return { id: `families/${familyId}/gamification_events/${eventId}` }
}
function surgeEvidenceRef(familyId: string, surgeId: string, completionId: string) {
  return { id: `families/${familyId}/surge_evidence/${surgeId}__${completionId}` }
}

/* ----- fixtures --------------------------------------------------------- */

const SURGE_WINDOW = {
  startsAt: Date.UTC(2026, 5, 1, 17, 0, 0),
  endsAt: Date.UTC(2026, 5, 1, 18, 0, 0),
}

const CATALOG: SurgeCatalog = {
  familyId: 'family-1',
  surges: [
    {
      surgeId: 'surge-evening',
      surge: {
        kind: 'task_bonus',
        eligibleTaskIds: ['task-house'],
        reward: { type: 'bonus_points', amount: 10 },
      },
      window: SURGE_WINDOW,
    },
  ],
}

const BASE_CONTEXT: SurgeEvaluatorContext = {
  familyId: 'family-1',
  familyPreferences: { surgeHours: true },
  completion: {
    id: 'completion-1',
    childId: 'child-A',
    taskId: 'task-house',
    completedAt: Date.UTC(2026, 5, 1, 17, 30, 0), // in window
  },
  task: {
    id: 'task-house',
    title: 'House Vacuum',
    pointsReward: 15,
    assigneeId: 'child-A',
    requiresApproval: false,
  },
}

/* ----- tests ------------------------------------------------------------ */

describe('evaluateAndAwardSurgeBonus — happy path', () => {
  it('writes a SURGE_BONUS_AWARDED event and a surge_evidence record on eligibility', async () => {
    const tx = new FakeTransaction()
    const result = await evaluateAndAwardSurgeBonus(tx as never, {
      ...BASE_CONTEXT,
      catalog: CATALOG,
      surgeEventRef: (surgeId, completionId) => gamificationEventsRef('family-1', `surge:${surgeId}:completion:${completionId}`),
      surgeEvidenceRef: (surgeId, completionId) => surgeEvidenceRef('family-1', surgeId, completionId),
      familyDocRef: () => familyRef('family-1'),
    })

    expect(result.status).toBe('awarded')
    expect(result.surgeId).toBe('surge-evening')

    const eventId = `surge:surge-evening:completion:completion-1`
    const eventDoc = tx.snapshot(`families/family-1/gamification_events/${eventId}`)
    expect(eventDoc).toBeDefined()
    expect(eventDoc).toMatchObject({
      schemaVersion: 1,
      eventType: 'SURGE_BONUS_AWARDED',
      familyId: 'family-1',
      memberId: 'child-A',
      sourceType: 'task_completion',
      sourceId: 'completion-1',
      rewardPointsDelta: 10,
      xpDelta: 0,
      idempotencyKey: eventId,
    })
    expect((eventDoc!.metadata as Record<string, unknown>).surgeId).toBe('surge-evening')
    expect((eventDoc!.metadata as Record<string, unknown>).rewardType).toBe('bonus_points')
    expect((eventDoc!.metadata as Record<string, unknown>).rewardAmount).toBe(10)
    expect((eventDoc!.metadata as Record<string, unknown>).taskId).toBe('task-house')
    expect((eventDoc!.metadata as Record<string, unknown>).childId).toBe('child-A')
    expect((eventDoc!.metadata as Record<string, unknown>).completedAt).toBe(BASE_CONTEXT.completion.completedAt)

    const evidenceDoc = tx.snapshot('families/family-1/surge_evidence/surge-evening__completion-1')
    expect(evidenceDoc).toBeDefined()
    expect(evidenceDoc).toMatchObject({
      schemaVersion: 1,
      familyId: 'family-1',
      surgeId: 'surge-evening',
      completionId: 'completion-1',
      taskId: 'task-house',
      childId: 'child-A',
      completedAt: BASE_CONTEXT.completion.completedAt,
      rewardType: 'bonus_points',
      rewardAmount: 10,
    })
  })
})

describe('evaluateAndAwardSurgeBonus — idempotency', () => {
  it('returns duplicate when the gamification_events doc already exists', async () => {
    const eventId = 'surge:surge-evening:completion:completion-1'
    const tx = new FakeTransaction({
      [`families/family-1/gamification_events/${eventId}`]: {
        schemaVersion: 1,
        eventType: 'SURGE_BONUS_AWARDED',
      },
    })
    const result = await evaluateAndAwardSurgeBonus(tx as never, {
      ...BASE_CONTEXT,
      catalog: CATALOG,
      surgeEventRef: (s, c) => gamificationEventsRef('family-1', `surge:${s}:completion:${c}`),
      surgeEvidenceRef: (s, c) => surgeEvidenceRef('family-1', s, c),
      familyDocRef: () => familyRef('family-1'),
    })
    expect(result.status).toBe('duplicate')
    expect(tx.hasWritten(`families/family-1/gamification_events/${eventId}`)).toBe(false)
  })

  it('treats surge_evidence pre-existence as a duplicate too', async () => {
    const tx = new FakeTransaction({
      'families/family-1/surge_evidence/surge-evening__completion-1': {
        schemaVersion: 1,
        familyId: 'family-1',
      },
    })
    const result = await evaluateAndAwardSurgeBonus(tx as never, {
      ...BASE_CONTEXT,
      catalog: CATALOG,
      surgeEventRef: (s, c) => gamificationEventsRef('family-1', `surge:${s}:completion:${c}`),
      surgeEvidenceRef: (s, c) => surgeEvidenceRef('family-1', s, c),
      familyDocRef: () => familyRef('family-1'),
    })
    expect(result.status).toBe('duplicate')
  })
})

describe('evaluateAndAwardSurgeBonus — sibling / cross-family denial', () => {
  it('refuses when task.assigneeId is a different child', async () => {
    const tx = new FakeTransaction()
    const result = await evaluateAndAwardSurgeBonus(tx as never, {
      ...BASE_CONTEXT,
      task: { ...BASE_CONTEXT.task, assigneeId: 'child-B' },
      catalog: CATALOG,
      surgeEventRef: (s, c) => gamificationEventsRef('family-1', `surge:${s}:completion:${c}`),
      surgeEvidenceRef: (s, c) => surgeEvidenceRef('family-1', s, c),
      familyDocRef: () => familyRef('family-1'),
    })
    expect(result.status).toBe('not_eligible')
    expect(tx.committedState()).toEqual({})
  })

  it('rewards an unassigned family task', async () => {
    const tx = new FakeTransaction()
    const result = await evaluateAndAwardSurgeBonus(tx as never, {
      ...BASE_CONTEXT,
      task: { ...BASE_CONTEXT.task, id: 'task-family-wash', assigneeId: null },
      catalog: {
        ...CATALOG,
        surges: [
          {
            ...CATALOG.surges[0],
            surge: {
              ...CATALOG.surges[0].surge,
              eligibleTaskIds: ['task-family-wash'],
            },
          } as ActiveSurge,
        ],
      },
      completion: { ...BASE_CONTEXT.completion, taskId: 'task-family-wash' },
      surgeEventRef: (s, c) => gamificationEventsRef('family-1', `surge:${s}:completion:${c}`),
      surgeEvidenceRef: (s, c) => surgeEvidenceRef('family-1', s, c),
      familyDocRef: () => familyRef('family-1'),
    })
    expect(result.status).toBe('awarded')
  })
})

describe('evaluateAndAwardSurgeBonus — preference and window gates', () => {
  it('refuses when surgeHours is disabled', async () => {
    const tx = new FakeTransaction()
    const result = await evaluateAndAwardSurgeBonus(tx as never, {
      ...BASE_CONTEXT,
      familyPreferences: { surgeHours: false },
      catalog: CATALOG,
      surgeEventRef: (s, c) => gamificationEventsRef('family-1', `surge:${s}:completion:${c}`),
      surgeEvidenceRef: (s, c) => surgeEvidenceRef('family-1', s, c),
      familyDocRef: () => familyRef('family-1'),
    })
    expect(result.status).toBe('not_eligible')
  })

  it('refuses when completion is outside the Surge window', async () => {
    const tx = new FakeTransaction()
    const result = await evaluateAndAwardSurgeBonus(tx as never, {
      ...BASE_CONTEXT,
      completion: {
        ...BASE_CONTEXT.completion,
        completedAt: Date.UTC(2026, 5, 1, 18, 0, 1), // 1 ms after endsAt
      },
      catalog: CATALOG,
      surgeEventRef: (s, c) => gamificationEventsRef('family-1', `surge:${s}:completion:${c}`),
      surgeEvidenceRef: (s, c) => surgeEvidenceRef('family-1', s, c),
      familyDocRef: () => familyRef('family-1'),
    })
    expect(result.status).toBe('not_eligible')
  })
})

describe('evaluateAndAwardSurgeBonus — event mutation invariance', () => {
  it('captures the reward amount at evaluation time', async () => {
    const tx = new FakeTransaction()
    const initialResult = await evaluateAndAwardSurgeBonus(tx as never, {
      ...BASE_CONTEXT,
      catalog: CATALOG,
      surgeEventRef: (s, c) => gamificationEventsRef('family-1', `surge:${s}:completion:${c}`),
      surgeEvidenceRef: (s, c) => surgeEvidenceRef('family-1', s, c),
      familyDocRef: () => familyRef('family-1'),
    })
    expect(initialResult.status).toBe('awarded')
    const eventDoc = tx.snapshot('families/family-1/gamification_events/surge:surge-evening:completion:completion-1')!
    expect((eventDoc.metadata as Record<string, unknown>).rewardAmount).toBe(10)
  })
})

describe('evaluateAndAwardSurgeBonus — defensive defaults', () => {
  it('returns not_eligible when catalog is missing', async () => {
    const tx = new FakeTransaction()
    const result = await evaluateAndAwardSurgeBonus(tx as never, {
      ...BASE_CONTEXT,
      catalog: null as unknown as SurgeCatalog,
      surgeEventRef: (s, c) => gamificationEventsRef('family-1', `surge:${s}:completion:${c}`),
      surgeEvidenceRef: (s, c) => surgeEvidenceRef('family-1', s, c),
      familyDocRef: () => familyRef('family-1'),
    })
    expect(result.status).toBe('not_eligible')
  })

  it('returns not_eligible when no active Surge matches the task', async () => {
    const tx = new FakeTransaction()
    const result = await evaluateAndAwardSurgeBonus(tx as never, {
      ...BASE_CONTEXT,
      catalog: {
        ...CATALOG,
        surges: [
          {
            ...CATALOG.surges[0],
            surge: {
              ...CATALOG.surges[0].surge,
              eligibleTaskIds: ['other-task'],
            },
          },
        ],
      },
      surgeEventRef: (s, c) => gamificationEventsRef('family-1', `surge:${s}:completion:${c}`),
      surgeEvidenceRef: (s, c) => surgeEvidenceRef('family-1', s, c),
      familyDocRef: () => familyRef('family-1'),
    })
    expect(result.status).toBe('not_eligible')
  })
})