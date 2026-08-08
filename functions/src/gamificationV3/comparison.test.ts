import { describe, it, expect, beforeEach } from 'vitest'
import { type Firestore } from 'firebase-admin/firestore'
import { AdminV3EventRepository, type V3EventRepository } from './eventRepository'
import { AdminV3ProjectionRepository, type V3ProjectionRepository } from './projectionRepository'
import { compareMember, type ComparisonDependencies } from './comparison'
import {
  type GamificationEventV3,
  GAMIFICATION_V3_SCHEMA_VERSION,
} from '../../../src/domain/gamification/v3/event'
import { DEFAULT_WEEKLY_CONTEXT } from '../../../src/domain/gamification/v3/weeklyWindow'
import { type ReducerContextV3 } from '../../../src/domain/gamification/v3/reducer'
import { serialiseStateV3 } from '../../../src/domain/gamification/v3/storage'

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
    rewardPointsDelta: 100,
    xpDelta: 100,
    weeklyPointsDelta: 0,
    idempotencyKey: `legacy-baseline:${FAMILY}:${MEMBER}:v3`,
    metadata: {},
  }
}

// ---------------------------------------------------------------------------
// Path-aware mock Firestore
// ---------------------------------------------------------------------------

function createMockDb(): { db: Firestore; users: Map<string, Record<string, unknown>>; summaries: Map<string, Record<string, unknown>>; events: Map<string, Record<string, unknown>>; state: Map<string, Record<string, unknown>> } {
  const usersStore = new Map<string, Record<string, unknown>>()
  const summariesStore = new Map<string, Record<string, unknown>>()
  const eventsStore = new Map<string, Record<string, unknown>>()
  const stateStore = new Map<string, Record<string, unknown>>()

  function getStore(path: string): Map<string, Record<string, unknown>> {
    if (path.startsWith('users/')) return usersStore
    if (path.includes('gamification_summaries')) return summariesStore
    if (path.includes('gamification_events_v3')) return eventsStore
    if (path.includes('gamification_state_v3')) return stateStore
    return new Map()
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
      set: async (data: Record<string, unknown>) => { eventsStore.set(id, data) },
      delete: async () => { eventsStore.delete(id) },
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
        set: async (data: Record<string, unknown>) => { store.set(id, data) },
        update: async (data: Record<string, unknown>) => {
          const existing = store.get(id) ?? {}
          store.set(id, { ...existing, ...data })
        },
        delete: async () => { store.delete(id) },
      }
    },
    collection: () => mockCollection,
  } as unknown as Firestore

  return { db, users: usersStore, summaries: summariesStore, events: eventsStore, state: stateStore }
}

describe('compareMember', () => {
  let eventRepo: V3EventRepository
  let projectionRepo: V3ProjectionRepository
  let deps: ComparisonDependencies
  let stores: ReturnType<typeof createMockDb>
  const context: ReducerContextV3 = {
    weekly: DEFAULT_WEEKLY_CONTEXT,
    asOf: '2026-01-05T10:00:00.000Z',
  }

  beforeEach(() => {
    stores = createMockDb()
    eventRepo = new AdminV3EventRepository(stores.db)
    projectionRepo = new AdminV3ProjectionRepository(stores.db)
    deps = { eventRepo, projectionRepo, db: stores.db }
  })

  it('returns exact_match when V3 projection matches legacy', async () => {
    // Set up legacy data
    stores.users.set(MEMBER, {
      familyId: FAMILY,
      role: 'child',
      rewardPoints: 100,
      lifetimeXP: 100,
    })
    stores.summaries.set(MEMBER, {
      familyId: FAMILY,
      xpTotal: 100,
      weeklyPoints: 0,
      currentStreak: 0,
    })

    // Write baseline event
    const baseline = baselineEvent()
    await eventRepo.writeEvent(FAMILY, baseline)

    // Write matching V3 projection
    const { reduceGamificationEventsV3 } = await import('../../../src/domain/gamification/v3/reducer')
    const state = reduceGamificationEventsV3([baseline], { ...context, familyId: FAMILY, memberId: MEMBER })
    await projectionRepo.writeProjection(FAMILY, state)

    const report = await compareMember(deps, FAMILY, MEMBER, context)
    expect(report.classification).toBe('exact_match')
    expect(report.ledgerComplete).toBe(true)
  })

  it('returns malformed_data when user document is missing', async () => {
    const report = await compareMember(deps, FAMILY, 'non-existent', context)
    expect(report.classification).toBe('malformed_data')
  })
})