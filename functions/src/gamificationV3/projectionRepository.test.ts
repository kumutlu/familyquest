import { describe, it, expect, beforeEach } from 'vitest'
import { type Firestore } from 'firebase-admin/firestore'
import { AdminV3ProjectionRepository, type V3ProjectionRepository } from './projectionRepository'
import {
  type GamificationEventV3,
  GAMIFICATION_V3_SCHEMA_VERSION,
} from '../../../src/domain/gamification/v3/event'
import { type GamificationStateV3 } from '../../../src/domain/gamification/v3/state'
import {
  DEFAULT_WEEKLY_CONTEXT,
  type WeeklyContextV3,
} from '../../../src/domain/gamification/v3/weeklyWindow'
import { type ReducerContextV3 } from '../../../src/domain/gamification/v3/reducer'

const FAMILY = 'test-family'
const MEMBER = 'test-member'

function baselineEvent(rewardPoints = 380): GamificationEventV3 {
  return {
    schemaVersion: GAMIFICATION_V3_SCHEMA_VERSION,
    eventId: `legacy-baseline:${FAMILY}:${MEMBER}:v3`,
    eventType: 'LEGACY_BASELINE',
    familyId: FAMILY,
    memberId: MEMBER,
    sourceType: 'bootstrap',
    sourceId: 'baseline',
    effectiveAt: '2026-01-05T10:00:00.000Z',
    createdAt: '2026-01-05T10:00:00.000Z',
    rewardPointsDelta: rewardPoints,
    xpDelta: rewardPoints,
    weeklyPointsDelta: 0,
    idempotencyKey: `legacy-baseline:${FAMILY}:${MEMBER}:v3`,
    metadata: {},
  }
}

function taskEvent(points = 5): GamificationEventV3 {
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
    rewardPointsDelta: points,
    xpDelta: points,
    weeklyPointsDelta: points,
    idempotencyKey: `task-approved:${FAMILY}:${MEMBER}:task-1:2026-W02`,
    metadata: {},
  }
}

import { reduceGamificationEventsV3 } from '../../../src/domain/gamification/v3/reducer'

function expectedState(events: readonly GamificationEventV3[], context: ReducerContextV3): GamificationStateV3 {
  return reduceGamificationEventsV3(events, {
    ...context,
    familyId: FAMILY,
    memberId: MEMBER,
  })
}

// ---------------------------------------------------------------------------
// Unit tests with a mock Firestore — no emulator required for the initial
// TDD cycle. These tests verify the contract of V3ProjectionRepository.
// ---------------------------------------------------------------------------

function createMockDb(): Firestore {
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
      delete: async () => {
        store.delete(id)
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

describe('AdminV3ProjectionRepository', () => {
  let repo: V3ProjectionRepository
  let db: Firestore
  const weekly: WeeklyContextV3 = DEFAULT_WEEKLY_CONTEXT
  const context: ReducerContextV3 = { weekly, asOf: '2026-01-05T10:00:00.000Z' }

  beforeEach(() => {
    db = createMockDb()
    repo = new AdminV3ProjectionRepository(db)
  })

  it('returns null for a member without a projection', async () => {
    const state = await repo.readProjection(FAMILY, MEMBER)
    expect(state).toBeNull()
  })

  it('writes and reads a projection document', async () => {
    const state = expectedState([baselineEvent()], context)
    await repo.writeProjection(FAMILY, state)
    const read = await repo.readProjection(FAMILY, MEMBER)
    expect(read).toEqual(state)
  })

  it('deletes a projection document', async () => {
    const state = expectedState([baselineEvent()], context)
    await repo.writeProjection(FAMILY, state)
    await repo.deleteProjection(FAMILY, MEMBER)
    const read = await repo.readProjection(FAMILY, MEMBER)
    expect(read).toBeNull()
  })

  it('rebuilds projection from events matching the reducer', async () => {
    const events = [baselineEvent(), taskEvent()]
    const rebuilt = repo.rebuildProjection(FAMILY, MEMBER, events, context)
    expect(rebuilt.rewardPoints).toBe(385)
    expect(rebuilt.xpTotal).toBe(385)
    expect(rebuilt.weeklyPoints).toBe(5)
    expect(rebuilt.foldedThroughEventId).toBe(events[events.length - 1].eventId)
  })
})