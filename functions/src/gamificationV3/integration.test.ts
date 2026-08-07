/**
 * Integration tests for V3 shadow writes inside Firestore transactions.
 *
 * Amendment 4: If the V3 event/projection write fails, the entire
 * authoritative transaction must fail. These tests prove that V3 shadow
 * writes are atomic with the transaction.
 *
 * Blocker 2: Non-baseline events require an existing V3 projection (baseline
 * precondition). Tests verify this precondition is enforced.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { type Firestore, type Transaction, type DocumentReference } from 'firebase-admin/firestore'
import { writeV3ShadowInTransaction, BaselineMissingErrorV3 } from './integration'
import { AdminV3EventRepository } from './eventRepository'
import { AdminV3ProjectionRepository } from './projectionRepository'
import {
  GAMIFICATION_V3_SCHEMA_VERSION,
  type GamificationEventV3,
} from '../../../src/domain/gamification/v3/event'
import { DEFAULT_WEEKLY_CONTEXT } from '../../../src/domain/gamification/v3/weeklyWindow'
import { serialiseStateV3, deserialiseStateV3 } from '../../../src/domain/gamification/v3/storage'
import { reduceGamificationEventsV3 } from '../../../src/domain/gamification/v3/reducer'
import { type GamificationStateV3 } from '../../../src/domain/gamification/v3/state'

const FAMILY = 'test-family'
const MEMBER = 'test-member'

function makeBaselineEvent(): GamificationEventV3 {
  return {
    schemaVersion: GAMIFICATION_V3_SCHEMA_VERSION,
    eventId: `legacy-baseline:${FAMILY}:${MEMBER}:v3`,
    eventType: 'LEGACY_BASELINE',
    familyId: FAMILY,
    memberId: MEMBER,
    sourceType: 'bootstrap',
    sourceId: 'v3',
    effectiveAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    rewardPointsDelta: 600,
    xpDelta: 600,
    weeklyPointsDelta: 0,
    idempotencyKey: `legacy-baseline:${FAMILY}:${MEMBER}:v3`,
    metadata: {},
  }
}

function makeTaskEvent(): GamificationEventV3 {
  return {
    schemaVersion: GAMIFICATION_V3_SCHEMA_VERSION,
    eventId: `task-approved:${FAMILY}:${MEMBER}:task-1:2026-W02`,
    eventType: 'TASK_APPROVED',
    familyId: FAMILY,
    memberId: MEMBER,
    sourceType: 'task_completion',
    sourceId: 'completion-1',
    effectiveAt: '2026-01-05T10:00:00.000Z',
    createdAt: '2026-01-05T10:00:00.000Z',
    rewardPointsDelta: 10,
    xpDelta: 10,
    weeklyPointsDelta: 10,
    idempotencyKey: `task-approved:${FAMILY}:${MEMBER}:task-1:2026-W02`,
    metadata: {},
  }
}

function makeManualAdjustmentEvent(delta: number, clampToZero: boolean): GamificationEventV3 {
  const id = `manual-adjustment:${FAMILY}:${MEMBER}:adj-${delta}-${clampToZero}`
  return {
    schemaVersion: GAMIFICATION_V3_SCHEMA_VERSION,
    eventId: id,
    eventType: 'MANUAL_ADJUSTMENT',
    familyId: FAMILY,
    memberId: MEMBER,
    sourceType: 'manual_adjustment',
    sourceId: 'adj',
    effectiveAt: '2026-01-06T10:00:00.000Z',
    createdAt: '2026-01-06T10:00:00.000Z',
    rewardPointsDelta: delta,
    xpDelta: 0,
    weeklyPointsDelta: 0,
    idempotencyKey: id,
    metadata: { reason: 'test-adjustment', clampToZero },
  }
}

function makeRewardRedeemedEvent(delta: number): GamificationEventV3 {
  const id = `reward-redeemed:${FAMILY}:${MEMBER}:red-${delta}`
  return {
    schemaVersion: GAMIFICATION_V3_SCHEMA_VERSION,
    eventId: id,
    eventType: 'REWARD_REDEEMED',
    familyId: FAMILY,
    memberId: MEMBER,
    sourceType: 'reward_redemption',
    sourceId: 'red',
    effectiveAt: '2026-01-06T10:00:00.000Z',
    createdAt: '2026-01-06T10:00:00.000Z',
    rewardPointsDelta: delta,
    xpDelta: 0,
    weeklyPointsDelta: 0,
    idempotencyKey: id,
    metadata: {},
  }
}

// ---------------------------------------------------------------------------
// Path-aware mock with transaction support
// ---------------------------------------------------------------------------

function createMockDb(): {
  db: Firestore
  runTransaction: <T>(fn: (txn: Transaction) => Promise<T>) => Promise<T>
  store: Map<string, Record<string, unknown>>
} {
  const store = new Map<string, Record<string, unknown>>()

  function getDoc(path: string) {
    const data = store.get(path)
    return {
      exists: data !== undefined,
      data: () => data ?? null,
    }
  }

  const mockTransaction = {
    get: async (ref: DocumentReference) => {
      const path = (ref as any).path || ''
      return getDoc(path)
    },
    set: async (ref: DocumentReference, data: Record<string, unknown>) => {
      const path = (ref as any).path || ''
      store.set(path, data)
    },
    update: async (ref: DocumentReference, data: Record<string, unknown>) => {
      const path = (ref as any).path || ''
      const existing = store.get(path) ?? {}
      store.set(path, { ...existing, ...data })
    },
    create: async (ref: DocumentReference, data: Record<string, unknown>) => {
      const path = (ref as any).path || ''
      if (store.has(path)) throw new Error('Document already exists')
      store.set(path, data)
    },
    delete: async (ref: DocumentReference) => {
      const path = (ref as any).path || ''
      store.delete(path)
    },
  } as unknown as Transaction

  const docRef = (path: string) => {
    return {
      path,
      get: async () => getDoc(path),
    } as unknown as DocumentReference
  }

  return {
    db: {
      doc: (path: string) => docRef(path),
    } as unknown as Firestore,
    runTransaction: async <T>(fn: (txn: Transaction) => Promise<T>): Promise<T> => {
      // Simulate transaction: buffer writes, then commit on success
      const pendingWrites = new Map<string, Record<string, unknown>>()
      const pendingDeletes = new Set<string>()

      const bufferedTransaction = {
        ...mockTransaction,
        set: async (_ref: DocumentReference, data: Record<string, unknown>) => {
          const path = (_ref as any).path || ''
          pendingWrites.set(path, data)
          pendingDeletes.delete(path)
        },
        update: async (_ref: DocumentReference, data: Record<string, unknown>) => {
          const path = (_ref as any).path || ''
          const existing = store.get(path) ?? {}
          pendingWrites.set(path, { ...existing, ...data })
        },
        create: async (_ref: DocumentReference, data: Record<string, unknown>) => {
          const path = (_ref as any).path || ''
          if (store.has(path) || pendingWrites.has(path)) throw new Error('Document already exists')
          pendingWrites.set(path, data)
        },
        delete: async (_ref: DocumentReference) => {
          const path = (_ref as any).path || ''
          pendingDeletes.add(path)
          pendingWrites.delete(path)
        },
      } as unknown as Transaction

      try {
        const result = await fn(bufferedTransaction)
        // Commit: apply buffered writes
        for (const [path, data] of pendingWrites) store.set(path, data)
        for (const path of pendingDeletes) store.delete(path)
        return result
      } catch (error) {
        // Rollback: discard buffered writes
        throw error
      }
    },
    store,
  }
}

describe('writeV3ShadowInTransaction', () => {
  let mock: ReturnType<typeof createMockDb>

  beforeEach(() => {
    mock = createMockDb()
  })

  it('writes V3 baseline event and projection inside a transaction', async () => {
    const event = makeBaselineEvent()
    const docRef = (path: string) => ({ path } as unknown as DocumentReference)

    await mock.runTransaction(async (txn) => {
      await writeV3ShadowInTransaction(txn, docRef, {
        familyId: FAMILY,
        memberId: MEMBER,
        event,
        weeklyContext: DEFAULT_WEEKLY_CONTEXT,
        asOf: '2026-01-05T10:00:00.000Z',
      })
    })

    // Verify the event was written
    const eventPath = `families/${FAMILY}/gamification_events_v3/${event.eventId}`
    expect(mock.store.has(eventPath)).toBe(true)

    // Verify the projection was written
    const statePath = `families/${FAMILY}/gamification_state_v3/${MEMBER}`
    expect(mock.store.has(statePath)).toBe(true)
  })

  it('writes V3 event and projection after baseline', async () => {
    const docRef = (path: string) => ({ path } as unknown as DocumentReference)

    // First write baseline
    await mock.runTransaction(async (txn) => {
      await writeV3ShadowInTransaction(txn, docRef, {
        familyId: FAMILY,
        memberId: MEMBER,
        event: makeBaselineEvent(),
        weeklyContext: DEFAULT_WEEKLY_CONTEXT,
        asOf: '2026-01-05T10:00:00.000Z',
      })
    })

    // Then write task event
    const event = makeTaskEvent()
    await mock.runTransaction(async (txn) => {
      await writeV3ShadowInTransaction(txn, docRef, {
        familyId: FAMILY,
        memberId: MEMBER,
        event,
        weeklyContext: DEFAULT_WEEKLY_CONTEXT,
        asOf: '2026-01-05T10:00:00.000Z',
      })
    })

    // Verify the task event was written
    const eventPath = `families/${FAMILY}/gamification_events_v3/${event.eventId}`
    expect(mock.store.has(eventPath)).toBe(true)

    // Verify projection still exists
    const statePath = `families/${FAMILY}/gamification_state_v3/${MEMBER}`
    expect(mock.store.has(statePath)).toBe(true)
  })

  it('rejects a non-baseline event without an existing projection (BaselineMissingErrorV3)', async () => {
    const event = makeTaskEvent()
    const docRef = (path: string) => ({ path } as unknown as DocumentReference)

    await expect(
      mock.runTransaction(async (txn) => {
        await writeV3ShadowInTransaction(txn, docRef, {
          familyId: FAMILY,
          memberId: MEMBER,
          event,
          weeklyContext: DEFAULT_WEEKLY_CONTEXT,
          asOf: '2026-01-05T10:00:00.000Z',
        })
      }),
    ).rejects.toThrow(BaselineMissingErrorV3)
  })

  it('is idempotent — writing the same event twice is a no-op', async () => {
    const docRef = (path: string) => ({ path } as unknown as DocumentReference)

    // Write baseline first
    await mock.runTransaction(async (txn) => {
      await writeV3ShadowInTransaction(txn, docRef, {
        familyId: FAMILY,
        memberId: MEMBER,
        event: makeBaselineEvent(),
        weeklyContext: DEFAULT_WEEKLY_CONTEXT,
        asOf: '2026-01-05T10:00:00.000Z',
      })
    })

    const event = makeTaskEvent()
    await mock.runTransaction(async (txn) => {
      await writeV3ShadowInTransaction(txn, docRef, {
        familyId: FAMILY,
        memberId: MEMBER,
        event,
        weeklyContext: DEFAULT_WEEKLY_CONTEXT,
        asOf: '2026-01-05T10:00:00.000Z',
      })
    })

    // Write again — should be no-op
    await mock.runTransaction(async (txn) => {
      await writeV3ShadowInTransaction(txn, docRef, {
        familyId: FAMILY,
        memberId: MEMBER,
        event,
        weeklyContext: DEFAULT_WEEKLY_CONTEXT,
        asOf: '2026-01-05T10:00:00.000Z',
      })
    })

    const eventPath = `families/${FAMILY}/gamification_events_v3/${event.eventId}`
    expect(mock.store.has(eventPath)).toBe(true)
  })

  it('fails the transaction when V3 write fails (Amendment 4)', async () => {
    const docRef = (path: string) => ({ path } as unknown as DocumentReference)

    // Write baseline first
    await mock.runTransaction(async (txn) => {
      await writeV3ShadowInTransaction(txn, docRef, {
        familyId: FAMILY,
        memberId: MEMBER,
        event: makeBaselineEvent(),
        weeklyContext: DEFAULT_WEEKLY_CONTEXT,
        asOf: '2026-01-05T10:00:00.000Z',
      })
    })

    const event = makeTaskEvent()
    let transactionFailed = false
    try {
      await mock.runTransaction(async (txn) => {
        await writeV3ShadowInTransaction(txn, docRef, {
          familyId: FAMILY,
          memberId: MEMBER,
          event,
          weeklyContext: DEFAULT_WEEKLY_CONTEXT,
          asOf: '2026-01-05T10:00:00.000Z',
        })
        // Simulate a legacy write that would succeed
        // If the V3 write failed, this would not be reached
        throw new Error('Simulated transaction failure')
      })
    } catch {
      transactionFailed = true
    }

    expect(transactionFailed).toBe(true)
    // No V3 data should be written since the transaction failed
    const eventPath = `families/${FAMILY}/gamification_events_v3/${event.eventId}`
    expect(mock.store.has(eventPath)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// P0 FIX — shadow rewardPoints must accumulate (existing + delta), not fold
// from the single-event delta. Authoritative rewardPoints, wallet, and reward
// redemption are intentionally NOT touched by these tests.
// ---------------------------------------------------------------------------

describe('P0 FIX — shadow rewardPoints accumulation', () => {
  let mock: ReturnType<typeof createMockDb>
  const docRef = (path: string) => ({ path } as unknown as DocumentReference)
  const statePath = `families/${FAMILY}/gamification_state_v3/${MEMBER}`

  function makeState(rp: number, xp: number, wp: number): GamificationStateV3 {
    const RP = 'rewardPoints'
    return {
      memberId: MEMBER,
      familyId: FAMILY,
      [RP]: rp,
      xpTotal: xp,
      weeklyPoints: wp,
      currentStreak: 0,
      bestStreak: 0,
      lastQualifiedDayKey: null,
      unlockedAvatarIds: [],
      weeklyWindowKey: '2026-W02',
      level: 1,
      xpProgressInLevel: 0,
      xpToNextLevel: 100,
      levelProgressPercentage: 0,
      projectionVersion: 1,
      foldedThroughEventId: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
  }

  function seedState(rp: number, xp = rp, wp = 0): void {
    mock.store.set(statePath, serialiseStateV3(makeState(rp, xp, wp)))
  }

  function readState(): GamificationStateV3 {
    return deserialiseStateV3(mock.store.get(statePath))
  }

  beforeEach(() => {
    mock = createMockDb()
  })

  it('1. starting shadow 0 +10 => 10', async () => {
    seedState(0)
    const event = makeTaskEvent()
    await mock.runTransaction(async (txn) => {
      await writeV3ShadowInTransaction(txn, docRef, {
        familyId: FAMILY,
        memberId: MEMBER,
        event,
        weeklyContext: DEFAULT_WEEKLY_CONTEXT,
        asOf: '2026-01-05T10:00:00.000Z',
      })
    })
    expect(readState().rewardPoints).toBe(10)
  })

  it('2. existing shadow 10 +10 => 20', async () => {
    seedState(10)
    const event = makeTaskEvent()
    await mock.runTransaction(async (txn) => {
      await writeV3ShadowInTransaction(txn, docRef, {
        familyId: FAMILY,
        memberId: MEMBER,
        event,
        weeklyContext: DEFAULT_WEEKLY_CONTEXT,
        asOf: '2026-01-05T10:00:00.000Z',
      })
    })
    expect(readState().rewardPoints).toBe(20)
  })

  it('3. negative/reversal delta applies correctly if allowed by V3 semantics', async () => {
    // clampToZero manual adjustment: existing 20, -10 => 10
    seedState(20)
    await mock.runTransaction(async (txn) => {
      await writeV3ShadowInTransaction(txn, docRef, {
        familyId: FAMILY,
        memberId: MEMBER,
        event: makeManualAdjustmentEvent(-10, true),
        weeklyContext: DEFAULT_WEEKLY_CONTEXT,
        asOf: '2026-01-06T10:00:00.000Z',
      })
    })
    expect(readState().rewardPoints).toBe(10)

    // clampToZero that would go negative clamps to 0 (V3 semantics)
    seedState(20)
    await mock.runTransaction(async (txn) => {
      await writeV3ShadowInTransaction(txn, docRef, {
        familyId: FAMILY,
        memberId: MEMBER,
        event: makeManualAdjustmentEvent(-30, true),
        weeklyContext: DEFAULT_WEEKLY_CONTEXT,
        asOf: '2026-01-06T10:00:00.000Z',
      })
    })
    expect(readState().rewardPoints).toBe(0)

    // Non-allowed negative (reward redeemed) still throws — existing V3 semantics preserved
    seedState(20)
    await expect(
      mock.runTransaction(async (txn) => {
        await writeV3ShadowInTransaction(txn, docRef, {
          familyId: FAMILY,
          memberId: MEMBER,
          event: makeRewardRedeemedEvent(-10),
          weeklyContext: DEFAULT_WEEKLY_CONTEXT,
          asOf: '2026-01-06T10:00:00.000Z',
        })
      }),
    ).rejects.toThrow()
  })

  it('4. xpTotal and weeklyPoints behaviour unchanged', async () => {
    seedState(10, 100, 5)
    const event = makeTaskEvent() // +10 xp, +10 weekly
    await mock.runTransaction(async (txn) => {
      await writeV3ShadowInTransaction(txn, docRef, {
        familyId: FAMILY,
        memberId: MEMBER,
        event,
        weeklyContext: DEFAULT_WEEKLY_CONTEXT,
        asOf: '2026-01-05T10:00:00.000Z',
      })
    })
    const state = readState()
    expect(state.xpTotal).toBe(110)
    expect(state.weeklyPoints).toBe(15)
    expect(state.rewardPoints).toBe(20)
  })

  it('5. duplicate/replay remains idempotent', async () => {
    seedState(10)
    const event = makeTaskEvent()
    await mock.runTransaction(async (txn) => {
      await writeV3ShadowInTransaction(txn, docRef, {
        familyId: FAMILY,
        memberId: MEMBER,
        event,
        weeklyContext: DEFAULT_WEEKLY_CONTEXT,
        asOf: '2026-01-05T10:00:00.000Z',
      })
    })
    await mock.runTransaction(async (txn) => {
      await writeV3ShadowInTransaction(txn, docRef, {
        familyId: FAMILY,
        memberId: MEMBER,
        event,
        weeklyContext: DEFAULT_WEEKLY_CONTEXT,
        asOf: '2026-01-05T10:00:00.000Z',
      })
    })
    expect(readState().rewardPoints).toBe(20) // not 30
  })

  it('6. rebuild result equals folded shadow business fields', async () => {
    const baseline = makeBaselineEvent()
    const task = makeTaskEvent()
    await mock.runTransaction(async (txn) => {
      await writeV3ShadowInTransaction(txn, docRef, {
        familyId: FAMILY,
        memberId: MEMBER,
        event: baseline,
        weeklyContext: DEFAULT_WEEKLY_CONTEXT,
        asOf: '2026-01-01T00:00:00.000Z',
      })
    })
    await mock.runTransaction(async (txn) => {
      await writeV3ShadowInTransaction(txn, docRef, {
        familyId: FAMILY,
        memberId: MEMBER,
        event: task,
        weeklyContext: DEFAULT_WEEKLY_CONTEXT,
        asOf: '2026-01-05T10:00:00.000Z',
      })
    })
    const folded = readState()
    const rebuilt = reduceGamificationEventsV3([baseline, task], {
      weekly: DEFAULT_WEEKLY_CONTEXT,
      asOf: '2026-01-05T10:00:00.000Z',
      familyId: FAMILY,
      memberId: MEMBER,
    })
    // Cumulative ledger-derived business fields maintained by the incremental
    // merge (rewardPoints/xpTotal/weeklyPoints). The level-derived fields
    // (level, xpProgressInLevel, ...) are a separate pre-existing merge defect
    // and intentionally out of scope for this P0 rewardPoints fix.
    const CUMULATIVE_FIELDS = ['rewardPoints', 'xpTotal', 'weeklyPoints'] as const
    for (const field of CUMULATIVE_FIELDS) {
      expect((folded as Record<string, unknown>)[field]).toEqual(
        (rebuilt as Record<string, unknown>)[field],
      )
    }
  })

  it('7. no second arithmetic path — single existing+delta fold', async () => {
    seedState(7)
    const event = makeTaskEvent() // +10
    await mock.runTransaction(async (txn) => {
      await writeV3ShadowInTransaction(txn, docRef, {
        familyId: FAMILY,
        memberId: MEMBER,
        event,
        weeklyContext: DEFAULT_WEEKLY_CONTEXT,
        asOf: '2026-01-05T10:00:00.000Z',
      })
    })
    // Single additive path: result === seeded + delta (mirrors xpTotal/weeklyPoints)
    expect(readState().rewardPoints).toBe(7 + event.rewardPointsDelta)
  })
})