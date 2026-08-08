import { describe, it, expect, beforeEach } from 'vitest'
import { type Firestore } from 'firebase-admin/firestore'
import { AdminV3EventRepository, type V3EventRepository } from './eventRepository'
import { AdminV3ProjectionRepository, type V3ProjectionRepository } from './projectionRepository'
import { rebuildMemberProjection } from './rebuild'
import {
  type GamificationEventV3,
  GAMIFICATION_V3_SCHEMA_VERSION,
} from '../../../src/domain/gamification/v3/event'
import { type GamificationStateV3 } from '../../../src/domain/gamification/v3/state'
import {
  DEFAULT_WEEKLY_CONTEXT,
} from '../../../src/domain/gamification/v3/weeklyWindow'
import { type ReducerContextV3 } from '../../../src/domain/gamification/v3/reducer'
import { reduceGamificationEventsV3 } from '../../../src/domain/gamification/v3/reducer'
import { serialiseEventV3, serialiseStateV3 } from '../../../src/domain/gamification/v3/storage'

const FAMILY = 'test-family'
const MEMBER = 'test-member'

function baselineEvent(): GamificationEventV3 {
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
    rewardPointsDelta: 380,
    xpDelta: 380,
    weeklyPointsDelta: 0,
    idempotencyKey: `legacy-baseline:${FAMILY}:${MEMBER}:v3`,
    metadata: {},
  }
}

function taskEvent(): GamificationEventV3 {
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
    rewardPointsDelta: 5,
    xpDelta: 5,
    weeklyPointsDelta: 5,
    idempotencyKey: `task-approved:${FAMILY}:${MEMBER}:task-1:2026-W02`,
    metadata: {},
  }
}

// ---------------------------------------------------------------------------
// Path-aware mock: events and state are stored separately so reads don't
// accidentally pick up the wrong collection's data.
// ---------------------------------------------------------------------------

function createMockDb(): { db: Firestore; events: Map<string, Record<string, unknown>>; state: Map<string, Record<string, unknown>> } {
  const eventsStore = new Map<string, Record<string, unknown>>()
  const stateStore = new Map<string, Record<string, unknown>>()

  function getStore(path: string): Map<string, Record<string, unknown>> {
    return path.includes('gamification_events_v3') ? eventsStore : stateStore
  }

  function getSnapshot(store: Map<string, Record<string, unknown>>) {
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
    get: async () => getSnapshot(eventsStore),
  }

  const mockCollection = {
    doc: (id: string) => ({
      get: async () => {
        const data = eventsStore.get(id)
        return { exists: data !== undefined, data: () => data ?? null }
      },
      set: async (data: Record<string, unknown>) => {
        eventsStore.set(id, data)
      },
      delete: async () => {
        eventsStore.delete(id)
      },
    }),
    where: () => mockQuery,
    orderBy: () => mockQuery,
    get: async () => getSnapshot(eventsStore),
  }

  const db = {
    doc: (path: string) => {
      const segments = path.split('/')
      const id = segments[segments.length - 1]
      const store = getStore(path)
      return {
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
      }
    },
    collection: () => mockCollection,
  } as unknown as Firestore

  return { db, events: eventsStore, state: stateStore }
}

describe('rebuildMemberProjection', () => {
  let eventRepo: V3EventRepository
  let projectionRepo: V3ProjectionRepository
  let stores: ReturnType<typeof createMockDb>
  const context: ReducerContextV3 = {
    weekly: DEFAULT_WEEKLY_CONTEXT,
    asOf: '2026-01-05T10:00:00.000Z',
    familyId: FAMILY,
    memberId: MEMBER,
  }

  beforeEach(() => {
    stores = createMockDb()
    eventRepo = new AdminV3EventRepository(stores.db)
    projectionRepo = new AdminV3ProjectionRepository(stores.db)
  })

  it('rebuilds projection from events and reports matchesStored=true when stored matches', async () => {
    const baseline = baselineEvent()
    await eventRepo.writeEvent(FAMILY, baseline)
    const task = taskEvent()
    await eventRepo.writeEvent(FAMILY, task)

    // Write a correct projection first
    const correct = reduceGamificationEventsV3([baseline, task], { ...context, familyId: FAMILY, memberId: MEMBER })
    await projectionRepo.writeProjection(FAMILY, correct)

    // Rebuild should match the stored projection
    const result = await rebuildMemberProjection(
      { eventRepo, projectionRepo },
      FAMILY,
      MEMBER,
      context,
    )

    expect(result.memberId).toBe(MEMBER)
    expect(result.eventsRead).toBe(2)
    expect(result.state.rewardPoints).toBe(385)
    expect(result.state.xpTotal).toBe(385)
    expect(result.matchesStored).toBe(true)
  })

  it('detects mismatch when stored projection differs from rebuilt', async () => {
    const baseline = baselineEvent()
    await eventRepo.writeEvent(FAMILY, baseline)

    // Write a deliberately wrong projection
    const correct = reduceGamificationEventsV3([baseline], { ...context, familyId: FAMILY, memberId: MEMBER })
    await projectionRepo.writeProjection(FAMILY, {
      ...correct,
      rewardPoints: 999,
    })

    const result = await rebuildMemberProjection(
      { eventRepo, projectionRepo },
      FAMILY,
      MEMBER,
      context,
    )

    expect(result.matchesStored).toBe(false)
    expect(result.state.rewardPoints).toBe(380) // Correct value from rebuild
  })
})