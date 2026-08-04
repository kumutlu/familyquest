import { describe, it, expect, beforeEach } from 'vitest'
import { type Firestore } from 'firebase-admin/firestore'
import { AdminV3EventRepository, type V3EventRepository } from './eventRepository'
import { GamificationEventV3, GAMIFICATION_V3_SCHEMA_VERSION } from '../../../src/domain/gamification/v3/event'
import { EVENTS_V3_COLLECTION_ID } from '../../../src/domain/gamification/v3/storage'

const FAMILY = 'test-family'
const MEMBER = 'test-member'

function baseEvent(): GamificationEventV3 {
  return {
    schemaVersion: GAMIFICATION_V3_SCHEMA_VERSION,
    eventId: 'task-approved:test-family:test-member:test-key',
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
    idempotencyKey: 'task-approved:test-family:test-member:test-key',
    metadata: {},
  }
}

// ---------------------------------------------------------------------------
// Unit tests with a mock Firestore — no emulator required for the initial
// TDD cycle. These tests verify the contract of V3EventRepository.
// ---------------------------------------------------------------------------

function createMockDb(): Firestore {
  // Minimal mock that supports the doc/collection/get/set pattern used by
  // AdminV3EventRepository. Replaced by the real Firestore emulator in the
  // golden integration test.
  const store = new Map<string, Record<string, unknown>>()

  function getSnapshot() {
    const all = Array.from(store.values())
    return {
      docs: all.map(data => ({ data: () => data })),
      forEach: (cb: (doc: { data: () => Record<string, unknown> }) => void) => {
        all.forEach(data => cb({ data: () => data }))
      },
    }
  }

  const mockQuery = {
    where: () => mockQuery,
    orderBy: () => mockQuery,
    get: async () => getSnapshot(),
  }

  const mockCollection = {
    doc: (id: string) => ({
      get: async () => {
        const data = store.get(id)
        return { exists: data !== undefined, data: () => data ?? null }
      },
      set: async (data: Record<string, unknown>) => {
        store.set(id, data)
      },
    }),
    where: () => mockQuery,
    orderBy: () => mockQuery,
    get: async () => getSnapshot(),
  }

  return {
    doc: (path: string) => {
      const segments = path.split('/')
      const id = segments[segments.length - 1]
      return mockCollection.doc(id)
    },
    collection: () => mockCollection,
  } as unknown as Firestore
}

describe('AdminV3EventRepository', () => {
  let repo: V3EventRepository
  let db: Firestore

  beforeEach(() => {
    db = createMockDb()
    repo = new AdminV3EventRepository(db)
  })

  it('writes and reads a V3 event document', async () => {
    const event = baseEvent()
    await repo.writeEvent(FAMILY, event)
    const read = await repo.readEvent(FAMILY, event.eventId)
    expect(read).toEqual(event)
  })

  it('returns null for a non-existent event', async () => {
    const read = await repo.readEvent(FAMILY, 'non-existent-event')
    expect(read).toBeNull()
  })

  it('is idempotent — writing the same event twice succeeds', async () => {
    const event = baseEvent()
    await repo.writeEvent(FAMILY, event)
    await repo.writeEvent(FAMILY, event) // Should not throw
    const read = await repo.readEvent(FAMILY, event.eventId)
    expect(read).toEqual(event)
  })

  it('reads member events ordered by effectiveAt', async () => {
    // This test is a contract check; with a mock it verifies the method
    // signature and that it returns an array. The ordering is verified
    // in the emulator golden test.
    const event = baseEvent()
    await repo.writeEvent(FAMILY, event)
    const events = await repo.readMemberEvents(FAMILY, MEMBER)
    expect(events).toHaveLength(1)
    expect(events[0].eventId).toBe(event.eventId)
  })
})