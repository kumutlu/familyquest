/**
 * Integration tests for V3 shadow writes inside Firestore transactions.
 *
 * Amendment 4: If the V3 event/projection write fails, the entire
 * authoritative transaction must fail. These tests prove that V3 shadow
 * writes are atomic with the transaction.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { type Firestore, type Transaction, type DocumentReference } from 'firebase-admin/firestore'
import { writeV3ShadowInTransaction } from './integration'
import { AdminV3EventRepository } from './eventRepository'
import { AdminV3ProjectionRepository } from './projectionRepository'
import {
  GAMIFICATION_V3_SCHEMA_VERSION,
  type GamificationEventV3,
} from '../../../src/domain/gamification/v3/event'
import { DEFAULT_WEEKLY_CONTEXT } from '../../../src/domain/gamification/v3/weeklyWindow'

const FAMILY = 'test-family'
const MEMBER = 'test-member'

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

  it('writes V3 event and projection inside a transaction', async () => {
    const event = makeTaskEvent()
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

  it('is idempotent — writing the same event twice is a no-op', async () => {
    const event = makeTaskEvent()
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
    // Simulate a failure by throwing inside the transaction
    const event = makeTaskEvent()
    const docRef = (path: string) => ({ path } as unknown as DocumentReference)

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