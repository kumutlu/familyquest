/**
 * Authoritative Comeback evaluator — integration tests.
 */
import { describe, expect, it } from 'vitest'

import {
  comebackEventId,
  type ComebackTier,
} from '../../../src/domain/comeback/types'
import {
  comebackEvidenceDocId,
  evaluateAndAwardComeback,
  reverseComebackXp,
  type ComebackEvaluatorContext,
} from './evaluator'

/* ----- in-memory transaction fake --------------------------------------- */

class FakeTransaction {
  private readonly writes = new Map<string, Record<string, unknown>>()
  private readonly store: Map<string, Record<string, unknown>>

  constructor(initial: Record<string, Record<string, unknown>> = {}) {
    this.store = new Map(Object.entries(initial))
  }

  async get(ref: { id: string }): Promise<{ id: string; exists: boolean; data(): Record<string, unknown> | undefined }> {
    const data = this.writes.get(ref.id) ?? this.store.get(ref.id)
    return { id: ref.id, exists: data !== undefined, data: () => data }
  }

  async create(ref: { id: string }, data: Record<string, unknown>): Promise<void> {
    if (this.store.has(ref.id) || this.writes.has(ref.id)) {
      const err = new Error(`Document already exists: ${ref.id}`)
      ;(err as Error & { code?: string }).code = 'alreadyExists'
      throw err
    }
    this.writes.set(ref.id, { ...data })
  }

  async set(ref: { id: string }, data: Record<string, unknown>): Promise<void> {
    this.writes.set(ref.id, { ...data })
  }

  snapshot(id: string): Record<string, unknown> | undefined {
    return this.writes.get(id)
  }
  hasWritten(id: string): boolean {
    return this.writes.has(id)
  }
}

/* ----- fixtures --------------------------------------------------------- */

const TZ_LONDON = 'Europe/London'
const NOW_UTC = Date.UTC(2026, 5, 15, 12, 0, 0)
const LOCAL_TODAY = '2026-06-15'

function comebackEventRef(familyId: string, childId: string, localDate: string, tier: ComebackTier): { id: string } {
  return { id: `families/${familyId}/gamification_events/${comebackEventId(childId, localDate, tier)}` }
}
function comebackEvidenceRef(familyId: string, childId: string, localDate: string, tier: ComebackTier): { id: string } {
  return { id: `families/${familyId}/comeback_evidence/${comebackEvidenceDocId(childId, localDate, tier)}` }
}

function baseContext(overrides: Partial<ComebackEvaluatorContext> = {}): ComebackEvaluatorContext {
  const tenDaysAgoLocal = Date.UTC(2026, 5, 4, 1, 0, 0) // June 4 in London
  return {
    familyId: 'family-1',
    childId: 'child-A',
    timezone: TZ_LONDON,
    now: NOW_UTC,
    lastMeaningfulActivityAt: tenDaysAgoLocal,
    alreadyCompletedTiersForDate: [],
    comebackEventRef: (childId, localDate, tier) => comebackEventRef('family-1', childId, localDate, tier),
    comebackEvidenceRef: (childId, localDate, tier) => comebackEvidenceRef('family-1', childId, localDate, tier),
    completionId: 'completion-1',
    completionCompletedAt: NOW_UTC,
    ...overrides,
  }
}

/* ----- happy path ------------------------------------------------------ */

describe('evaluateAndAwardComeback — return_7d', () => {
  it('writes a COMEBACK_MISSION_XP_AWARDED event + evidence with xpDelta=50', async () => {
    const tx = new FakeTransaction()
    const result = await evaluateAndAwardComeback(tx as never, baseContext())
    expect(result.status).toBe('awarded')
    if (result.status !== 'awarded') throw new Error('unreachable')
    expect(result.tier).toBe('return_7d')
    expect(result.xpDelta).toBe(50)
    expect(result.localDate).toBe(LOCAL_TODAY)

    const eventId = comebackEventId('child-A', LOCAL_TODAY, 'return_7d')
    const eventDoc = tx.snapshot(`families/family-1/gamification_events/${eventId}`)
    expect(eventDoc).toMatchObject({
      schemaVersion: 1,
      eventType: 'COMEBACK_MISSION_XP_AWARDED',
      familyId: 'family-1',
      memberId: 'child-A',
      sourceType: 'task_completion',
      xpDelta: 50,
      rewardPointsDelta: 0,
      idempotencyKey: eventId,
    })
    const evidenceDoc = tx.snapshot(`families/family-1/comeback_evidence/child-A__2026-06-15__return_7d`)
    expect(evidenceDoc).toMatchObject({
      schemaVersion: 1,
      familyId: 'family-1',
      childId: 'child-A',
      tier: 'return_7d',
      rewardXp: 50,
    })
  })
})

describe('evaluateAndAwardComeback — return_3d', () => {
  it('writes xpDelta=25', async () => {
    const tx = new FakeTransaction()
    // 3 days ago in London
    const threeDaysAgo = Date.UTC(2026, 5, 11, 1, 0, 0) // June 12
    const result = await evaluateAndAwardComeback(tx as never, baseContext({ lastMeaningfulActivityAt: threeDaysAgo }))
    expect(result.status).toBe('awarded')
    if (result.status !== 'awarded') throw new Error('unreachable')
    expect(result.tier).toBe('return_3d')
    expect(result.xpDelta).toBe(25)
  })
})

describe('evaluateAndAwardComeback — return_1d (zero reward)', () => {
  it('records evidence only, no gamification_events doc', async () => {
    const tx = new FakeTransaction()
    const yesterday = Date.UTC(2026, 5, 13, 1, 0, 0) // June 14
    const result = await evaluateAndAwardComeback(tx as never, baseContext({ lastMeaningfulActivityAt: yesterday }))
    expect(result.status).toBe('awarded')
    if (result.status !== 'awarded') throw new Error('unreachable')
    expect(result.tier).toBe('return_1d')
    expect(result.xpDelta).toBe(0)
    // No event doc because the reward is zero.
    const eventId = comebackEventId('child-A', LOCAL_TODAY, 'return_1d')
    expect(tx.hasWritten(`families/family-1/gamification_events/${eventId}`)).toBe(false)
    // Evidence doc is still written.
    expect(tx.hasWritten(`families/family-1/comeback_evidence/child-A__2026-06-15__return_1d`)).toBe(true)
  })
})

/* ----- no tier / duplicate --------------------------------------------- */

describe('evaluateAndAwardComeback — no tier', () => {
  it('returns no_tier for a child active today', async () => {
    const tx = new FakeTransaction()
    const result = await evaluateAndAwardComeback(tx as never, baseContext({ lastMeaningfulActivityAt: NOW_UTC - 60_000 }))
    expect(result.status).toBe('no_tier')
  })
})

describe('evaluateAndAwardComeback — idempotency', () => {
  it('returns duplicate when the evidence doc already exists', async () => {
    const evidenceId = `families/family-1/comeback_evidence/child-A__2026-06-15__return_7d`
    const tx = new FakeTransaction({ [evidenceId]: { schemaVersion: 1 } })
    const result = await evaluateAndAwardComeback(tx as never, baseContext())
    expect(result.status).toBe('duplicate')
  })

  it('returns duplicate when alreadyCompletedTiersForDate includes the active tier', async () => {
    const tx = new FakeTransaction()
    const result = await evaluateAndAwardComeback(tx as never, baseContext({ alreadyCompletedTiersForDate: ['return_7d'] }))
    expect(result.status).toBe('duplicate')
    expect((result as { tier: ComebackTier }).tier).toBe('return_7d')
  })

  it('a re-run with the same evidence doc is a no-op', async () => {
    const evidenceId = `families/family-1/comeback_evidence/child-A__2026-06-15__return_7d`
    const freshTx = new FakeTransaction()
    const result = await evaluateAndAwardComeback(freshTx as never, baseContext())
    const tx2 = new FakeTransaction({ [evidenceId]: { schemaVersion: 1 } })
    const result2 = await evaluateAndAwardComeback(tx2 as never, baseContext())
    expect(result.status).toBe('awarded')
    expect(result2.status).toBe('duplicate')
  })
})

/* ----- reversal ------------------------------------------------------- */

describe('reverseComebackXp', () => {
  it('writes a sibling COMEBACK_MISSION_XP_REVERSED event', async () => {
    const eventId = comebackEventId('child-A', LOCAL_TODAY, 'return_7d')
    const tx = new FakeTransaction({
      [`families/family-1/gamification_events/${eventId}`]: {
        schemaVersion: 1, eventType: 'COMEBACK_MISSION_XP_AWARDED',
      },
    })
    const result = await reverseComebackXp(tx as never, {
      familyId: 'family-1',
      childId: 'child-A',
      localDate: LOCAL_TODAY,
      tier: 'return_7d',
      amount: 50,
      now: NOW_UTC,
      completionId: 'completion-1',
      // No other qualifying completion remains after invalidation.
      qualifyingCompletionIds: [],
      comebackEventRef: (childId, localDate, tier) => comebackEventRef('family-1', childId, localDate, tier),
      comebackReversalEventRef: (childId, localDate, tier) => ({
        id: `families/family-1/gamification_events/${comebackEventId(childId, localDate, tier)}:reversal`,
      }),
    })
    expect(result.status).toBe('reversed')
    const reversalDoc = tx.snapshot(`families/family-1/gamification_events/${eventId}:reversal`)
    expect(reversalDoc).toMatchObject({
      schemaVersion: 1,
      eventType: 'COMEBACK_MISSION_XP_REVERSED',
      xpDelta: -50,
      reversalOfEventId: eventId,
    })
  })

  it('returns duplicate when reversal already exists', async () => {
    const eventId = comebackEventId('child-A', LOCAL_TODAY, 'return_7d')
    const tx = new FakeTransaction({
      [`families/family-1/gamification_events/${eventId}`]: { schemaVersion: 1 },
      [`families/family-1/gamification_events/${eventId}:reversal`]: { schemaVersion: 1 },
    })
    const result = await reverseComebackXp(tx as never, {
      familyId: 'family-1',
      childId: 'child-A',
      localDate: LOCAL_TODAY,
      tier: 'return_7d',
      amount: 50,
      now: NOW_UTC,
      comebackEventRef: (childId, localDate, tier) => comebackEventRef('family-1', childId, localDate, tier),
      comebackReversalEventRef: (childId, localDate, tier) => ({
        id: `families/family-1/gamification_events/${comebackEventId(childId, localDate, tier)}:reversal`,
      }),
    })
    expect(result.status).toBe('duplicate')
  })

  it('returns not_found when the original award is missing', async () => {
    const tx = new FakeTransaction()
    const result = await reverseComebackXp(tx as never, {
      familyId: 'family-1',
      childId: 'child-A',
      localDate: LOCAL_TODAY,
      tier: 'return_7d',
      amount: 50,
      now: NOW_UTC,
      completionId: 'completion-1',
      qualifyingCompletionIds: [],
      comebackEventRef: (childId, localDate, tier) => comebackEventRef('family-1', childId, localDate, tier),
      comebackReversalEventRef: (childId, localDate, tier) => ({
        id: `families/family-1/gamification_events/${comebackEventId(childId, localDate, tier)}:reversal`,
      }),
    })
    expect(result.status).toBe('not_found')
  })
})


/* ----- re-evaluation: alternate completion remains ----- */

describe('reverseComebackXp — re-evaluation', () => {
  it('keeps the reward qualified when an alternate approved completion still exists', async () => {
    const eventId = comebackEventId('child-A', LOCAL_TODAY, 'return_7d')
    const tx = new FakeTransaction({
      [`families/family-1/gamification_events/${eventId}`]: {
        schemaVersion: 1, eventType: 'COMEBACK_MISSION_XP_AWARDED',
      },
    })
    const result = await reverseComebackXp(tx as never, {
      familyId: 'family-1',
      childId: 'child-A',
      localDate: LOCAL_TODAY,
      tier: 'return_7d',
      amount: 50,
      now: NOW_UTC,
      completionId: 'completion-A',
      qualifyingCompletionIds: ['completion-A', 'completion-B'],
      comebackEventRef: (childId, localDate, tier) => comebackEventRef('family-1', childId, localDate, tier),
      comebackReversalEventRef: (childId, localDate, tier) => ({
        id: `families/family-1/gamification_events/${comebackEventId(childId, localDate, tier)}:reversal`,
      }),
    })
    expect(result.status).toBe('kept_qualified')
    // No reversal event written when kept qualified.
    expect(tx.hasWritten(`families/family-1/gamification_events/${eventId}:reversal`)).toBe(false)
  })

  it('is idempotent under duplicate invalidation processing (same completion id)', async () => {
    const eventId = comebackEventId('child-A', LOCAL_TODAY, 'return_7d')
    const tx1 = new FakeTransaction({
      [`families/family-1/gamification_events/${eventId}`]: {
        schemaVersion: 1, eventType: 'COMEBACK_MISSION_XP_AWARDED',
      },
    })
    const result1 = await reverseComebackXp(tx1 as never, {
      familyId: 'family-1', childId: 'child-A', localDate: LOCAL_TODAY,
      tier: 'return_7d', amount: 50, now: NOW_UTC,
      completionId: 'completion-A', qualifyingCompletionIds: [],
      comebackEventRef: (childId, localDate, tier) => comebackEventRef('family-1', childId, localDate, tier),
      comebackReversalEventRef: (childId, localDate, tier) => ({
        id: `families/family-1/gamification_events/${comebackEventId(childId, localDate, tier)}:reversal`,
      }),
    })
    expect(result1.status).toBe('reversed')

    // A second call sees the reversal already exists ⇒ duplicate.
    const tx2 = new FakeTransaction({
      [`families/family-1/gamification_events/${eventId}`]: {
        schemaVersion: 1, eventType: 'COMEBACK_MISSION_XP_AWARDED',
      },
      [`families/family-1/gamification_events/${eventId}:reversal`]: {
        schemaVersion: 1, eventType: 'COMEBACK_MISSION_XP_REVERSED',
      },
    })
    const result2 = await reverseComebackXp(tx2 as never, {
      familyId: 'family-1', childId: 'child-A', localDate: LOCAL_TODAY,
      tier: 'return_7d', amount: 50, now: NOW_UTC,
      completionId: 'completion-A', qualifyingCompletionIds: [],
      comebackEventRef: (childId, localDate, tier) => comebackEventRef('family-1', childId, localDate, tier),
      comebackReversalEventRef: (childId, localDate, tier) => ({
        id: `families/family-1/gamification_events/${comebackEventId(childId, localDate, tier)}:reversal`,
      }),
    })
    expect(result2.status).toBe('duplicate')
  })

  it('a second invalidation after the alternate also reversed triggers exactly one more reversal event', async () => {
    // A and B both originally qualified for the comeback. After A is
    // reversed the reward must stay. After B is also eventually
    // reversed, exactly one (additional) reversal event MUST be
    // written. We assert this by running both reversals sequentially.
    const eventId = comebackEventId('child-A', LOCAL_TODAY, 'return_7d')
    const tx = new FakeTransaction({
      [`families/family-1/gamification_events/${eventId}`]: {
        schemaVersion: 1, eventType: 'COMEBACK_MISSION_XP_AWARDED',
      },
    })

    // Step 1: reverse A while B remains.
    const r1 = await reverseComebackXp(tx as never, {
      familyId: 'family-1', childId: 'child-A', localDate: LOCAL_TODAY,
      tier: 'return_7d', amount: 50, now: NOW_UTC,
      completionId: 'completion-A', qualifyingCompletionIds: ['completion-A', 'completion-B'],
      comebackEventRef: (childId, localDate, tier) => comebackEventRef('family-1', childId, localDate, tier),
      comebackReversalEventRef: (childId, localDate, tier) => ({
        id: `families/family-1/gamification_events/${comebackEventId(childId, localDate, tier)}:reversal`,
      }),
    })
    expect(r1.status).toBe('kept_qualified')
    expect(tx.hasWritten(`families/family-1/gamification_events/${eventId}:reversal`)).toBe(false)

    // Step 2: reverse B with no qualifying completions remaining.
    const r2 = await reverseComebackXp(tx as never, {
      familyId: 'family-1', childId: 'child-A', localDate: LOCAL_TODAY,
      tier: 'return_7d', amount: 50, now: NOW_UTC,
      completionId: 'completion-B', qualifyingCompletionIds: [],
      comebackEventRef: (childId, localDate, tier) => comebackEventRef('family-1', childId, localDate, tier),
      comebackReversalEventRef: (childId, localDate, tier) => ({
        id: `families/family-1/gamification_events/${comebackEventId(childId, localDate, tier)}:reversal`,
      }),
    })
    expect(r2.status).toBe('reversed')
    expect(tx.hasWritten(`families/family-1/gamification_events/${eventId}:reversal`)).toBe(true)
  })
})

/* ----- streak is untouched -------------------------------------------- */

describe('evaluateAndAwardComeback — streak neutrality', () => {
  it('writes no streak or currentStreak fields', async () => {
    const tx = new FakeTransaction()
    await evaluateAndAwardComeback(tx as never, baseContext())
    const eventId = comebackEventId('child-A', LOCAL_TODAY, 'return_7d')
    const eventDoc = tx.snapshot(`families/family-1/gamification_events/${eventId}`)!
    expect(eventDoc).not.toHaveProperty('currentStreak')
    expect(eventDoc).not.toHaveProperty('bestStreak')
    expect(eventDoc).not.toHaveProperty('lastQualifiedDayKey')
  })
})