import { describe, it, expect, beforeEach } from 'vitest'
import { type Firestore } from 'firebase-admin/firestore'
import { AdminV3EventRepository, type V3EventRepository } from './eventRepository'
import { AdminV3ProjectionRepository, type V3ProjectionRepository } from './projectionRepository'
import { writeShadowEvent, type ShadowWriterDependencies, type ShadowWriteResult } from './shadowWriter'
import {
  type GamificationEventV3,
  GAMIFICATION_V3_SCHEMA_VERSION,
} from '../../../src/domain/gamification/v3/event'
import {
  DEFAULT_WEEKLY_CONTEXT,
  type WeeklyContextV3,
} from '../../../src/domain/gamification/v3/weeklyWindow'

const FAMILY = 'test-family'
const MEMBER = 'test-member'
const weekly: WeeklyContextV3 = DEFAULT_WEEKLY_CONTEXT

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

function taskEvent(points = 5, suffix = 'task-1:2026-W02'): GamificationEventV3 {
  const eventId = `task-approved:${FAMILY}:${MEMBER}:${suffix}`
  return {
    schemaVersion: GAMIFICATION_V3_SCHEMA_VERSION,
    eventId,
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
    idempotencyKey: eventId,
    metadata: {},
  }
}

// ---------------------------------------------------------------------------
// Path-aware mock Firestore
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

describe('writeShadowEvent', () => {
  let eventRepo: V3EventRepository
  let projectionRepo: V3ProjectionRepository
  let deps: ShadowWriterDependencies

  beforeEach(() => {
    const { db } = createMockDb()
    eventRepo = new AdminV3EventRepository(db)
    projectionRepo = new AdminV3ProjectionRepository(db)
    deps = {
      eventRepo,
      projectionRepo,
      now: () => '2026-01-05T10:00:00.000Z',
      weeklyContext: weekly,
    }
  })

  it('writes a new event and creates projection when none exists', async () => {
    const result = await writeShadowEvent(deps, baselineEvent())
    expect(result.status).toBe('written')
    expect(result.eventId).toBe(baselineEvent().eventId)

    const read = await eventRepo.readEvent(FAMILY, baselineEvent().eventId)
    expect(read).not.toBeNull()
    expect(read!.rewardPointsDelta).toBe(380)

    const state = await projectionRepo.readProjection(FAMILY, MEMBER)
    expect(state).not.toBeNull()
    expect(state!.rewardPoints).toBe(380)
  })

  it('returns duplicate when event already exists', async () => {
    const event = baselineEvent()
    await writeShadowEvent(deps, event)
    const result = await writeShadowEvent(deps, event)
    expect(result.status).toBe('duplicate')
  })

  it('incrementally folds a new event into existing projection', async () => {
    // Write baseline
    await writeShadowEvent(deps, baselineEvent())
    let state = await projectionRepo.readProjection(FAMILY, MEMBER)
    expect(state!.rewardPoints).toBe(380)

    // Write task approval
    const task = taskEvent(5)
    const result = await writeShadowEvent(deps, task)
    expect(result.status).toBe('written')

    state = await projectionRepo.readProjection(FAMILY, MEMBER)
    expect(state!.rewardPoints).toBe(385)
    expect(state!.xpTotal).toBe(385)
    expect(state!.foldedThroughEventId).toBe(task.eventId)
  })

  it('handles multiple incremental folds', async () => {
    await writeShadowEvent(deps, baselineEvent())
    await writeShadowEvent(deps, taskEvent(5, 'task-1:2026-W02'))
    await writeShadowEvent(deps, taskEvent(10, 'task-2:2026-W02'))

    const state = await projectionRepo.readProjection(FAMILY, MEMBER)
    expect(state!.rewardPoints).toBe(395)
    expect(state!.xpTotal).toBe(395)
  })
})