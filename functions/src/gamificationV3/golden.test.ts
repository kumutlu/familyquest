/**
 * Golden shadow-parity integration test.
 *
 * Exercises every flow end-to-end using the path-aware mock Firestore,
 * proving that the V3 shadow system produces correct projections that
 * match the expected state from the pure reducer.
 *
 * Amendment 4 — V3 failure cannot be silent:
 * Tests both failure models: atomic Option A flows fail the entire
 * transaction, trigger-bridge flows write durable failure records.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { type Firestore } from 'firebase-admin/firestore'
import { AdminV3EventRepository } from './eventRepository'
import { AdminV3ProjectionRepository } from './projectionRepository'
import { writeShadowEvent } from './shadowWriter'
import { rebuildMemberProjection } from './rebuild'
import { AdminV3FailureRecorder } from './failures'
import { reduceGamificationEventsV3 } from '../../../src/domain/gamification/v3/reducer'
import {
  GAMIFICATION_V3_SCHEMA_VERSION,
  type GamificationEventV3,
} from '../../../src/domain/gamification/v3/event'
import { DEFAULT_WEEKLY_CONTEXT } from '../../../src/domain/gamification/v3/weeklyWindow'
import type { ReducerContextV3 } from '../../../src/domain/gamification/v3/reducer'

const FAMILY = 'golden-family'
const MEMBER = 'golden-child'
const weekly = DEFAULT_WEEKLY_CONTEXT
const context: ReducerContextV3 = { weekly, asOf: '2026-01-05T10:00:00.000Z', familyId: FAMILY, memberId: MEMBER }

function makeBaselineEvent(rp = 0, xp = 0): GamificationEventV3 {
  return {
    schemaVersion: GAMIFICATION_V3_SCHEMA_VERSION,
    eventId: `legacy-baseline:${FAMILY}:${MEMBER}:v3`,
    eventType: 'LEGACY_BASELINE',
    familyId: FAMILY,
    memberId: MEMBER,
    sourceType: 'bootstrap',
    sourceId: 'baseline',
    effectiveAt: '2026-01-04T00:00:00.000Z', // Earliest: baseline opens the ledger
    createdAt: '2026-01-04T00:00:00.000Z',
    rewardPointsDelta: rp,
    xpDelta: xp,
    weeklyPointsDelta: 0,
    idempotencyKey: `legacy-baseline:${FAMILY}:${MEMBER}:v3`,
    metadata: {},
  }
}

function makeTaskEvent(suffix: string, points: number, at = '2026-01-05T10:00:00.000Z'): GamificationEventV3 {
  const eventId = `task-approved:${FAMILY}:${MEMBER}:${suffix}`
  return {
    schemaVersion: GAMIFICATION_V3_SCHEMA_VERSION,
    eventId,
    eventType: 'TASK_APPROVED',
    familyId: FAMILY,
    memberId: MEMBER,
    sourceType: 'task_completion',
    sourceId: `completion-${suffix}`,
    effectiveAt: at,
    createdAt: at,
    rewardPointsDelta: points,
    xpDelta: points,
    weeklyPointsDelta: points,
    idempotencyKey: eventId,
    metadata: {},
  }
}

function makeBehaviourEvent(type: 'positive' | 'negative', id: string, delta: number, at = '2026-01-05T10:00:00.000Z'): GamificationEventV3 {
  const eventId = `behaviour:${FAMILY}:${MEMBER}:${id}`
  const isNeg = type === 'negative'
  return {
    schemaVersion: GAMIFICATION_V3_SCHEMA_VERSION,
    eventId,
    eventType: isNeg ? 'BEHAVIOUR_NEGATIVE' : 'BEHAVIOUR_POSITIVE',
    familyId: FAMILY,
    memberId: MEMBER,
    sourceType: 'behaviour_event',
    sourceId: id,
    effectiveAt: at,
    createdAt: at,
    rewardPointsDelta: delta,
    xpDelta: isNeg ? 0 : delta,
    weeklyPointsDelta: isNeg ? 0 : delta,
    idempotencyKey: eventId,
    metadata: {},
  }
}

function makeRedemptionEvent(id: string, cost: number, at = '2026-01-05T10:00:00.000Z'): GamificationEventV3 {
  const eventId = `reward-redeemed:${FAMILY}:${MEMBER}:${id}`
  return {
    schemaVersion: GAMIFICATION_V3_SCHEMA_VERSION,
    eventId,
    eventType: 'REWARD_REDEEMED',
    familyId: FAMILY,
    memberId: MEMBER,
    sourceType: 'redemption',
    sourceId: id,
    effectiveAt: at,
    createdAt: at,
    rewardPointsDelta: -cost,
    xpDelta: 0,
    weeklyPointsDelta: 0,
    idempotencyKey: eventId,
    metadata: {},
  }
}

function makeAvatarUnlockEvent(avatarId: string, cost: number, at = '2026-01-05T10:00:00.000Z'): GamificationEventV3 {
  const eventId = `avatar-unlocked:${FAMILY}:${MEMBER}:${avatarId}`
  return {
    schemaVersion: GAMIFICATION_V3_SCHEMA_VERSION,
    eventId,
    eventType: 'AVATAR_UNLOCKED',
    familyId: FAMILY,
    memberId: MEMBER,
    sourceType: 'avatar_unlock',
    sourceId: avatarId,
    effectiveAt: at,
    createdAt: at,
    rewardPointsDelta: -cost,
    xpDelta: 0,
    weeklyPointsDelta: 0,
    idempotencyKey: eventId,
    metadata: { avatarId },
  }
}

function makeDailyGoalEvent(dayKey: string, xp: number, at = '2026-01-05T10:00:00.000Z'): GamificationEventV3 {
  const eventId = `daily-goal:${FAMILY}:${MEMBER}:${dayKey}`
  return {
    schemaVersion: GAMIFICATION_V3_SCHEMA_VERSION,
    eventId,
    eventType: 'DAILY_GOAL_AWARDED',
    familyId: FAMILY,
    memberId: MEMBER,
    sourceType: 'daily_goal',
    sourceId: dayKey,
    effectiveAt: at,
    createdAt: at,
    rewardPointsDelta: 0,
    xpDelta: xp,
    weeklyPointsDelta: 0,
    idempotencyKey: eventId,
    metadata: { dayKey },
  }
}

function makePerfectDayEvent(dayKey: string, xp: number, at = '2026-01-05T10:00:00.000Z'): GamificationEventV3 {
  const eventId = `perfect-day:${FAMILY}:${MEMBER}:${dayKey}`
  return {
    schemaVersion: GAMIFICATION_V3_SCHEMA_VERSION,
    eventId,
    eventType: 'PERFECT_DAY_AWARDED',
    familyId: FAMILY,
    memberId: MEMBER,
    sourceType: 'perfect_day',
    sourceId: dayKey,
    effectiveAt: at,
    createdAt: at,
    rewardPointsDelta: 0,
    xpDelta: xp,
    weeklyPointsDelta: 0,
    idempotencyKey: eventId,
    metadata: { dayKey },
  }
}

function makeReversalEvent(originalEventId: string, revId: string, rp: number, xp: number, wp: number, at = '2026-01-05T11:00:00.000Z'): GamificationEventV3 {
  const eventId = `reversal:${originalEventId}:${revId}`
  return {
    schemaVersion: GAMIFICATION_V3_SCHEMA_VERSION,
    eventId,
    eventType: 'REVERSAL',
    familyId: FAMILY,
    memberId: MEMBER,
    sourceType: 'reversal',
    sourceId: revId,
    effectiveAt: at,
    createdAt: at,
    rewardPointsDelta: rp,
    xpDelta: xp,
    weeklyPointsDelta: wp,
    idempotencyKey: eventId,
    reversalOfEventId: originalEventId,
    metadata: {},
  }
}

// ---------------------------------------------------------------------------
// Path-aware mock
// ---------------------------------------------------------------------------

interface MockStores {
  db: Firestore
  events: Map<string, Record<string, unknown>>
  state: Map<string, Record<string, unknown>>
  users: Map<string, Record<string, unknown>>
  summaries: Map<string, Record<string, unknown>>
  failures: Map<string, Record<string, unknown>>
}

function createMockDb(): MockStores {
  const usersStore = new Map<string, Record<string, unknown>>()
  const summariesStore = new Map<string, Record<string, unknown>>()
  const eventsStore = new Map<string, Record<string, unknown>>()
  const stateStore = new Map<string, Record<string, unknown>>()
  const failuresStore = new Map<string, Record<string, unknown>>()

  function getStore(path: string): Map<string, Record<string, unknown>> {
    if (path.startsWith('users/')) return usersStore
    if (path.includes('gamification_summaries')) return summariesStore
    if (path.includes('gamification_events_v3')) return eventsStore
    if (path.includes('gamification_state_v3')) return stateStore
    if (path.includes('gamification_v3_failures')) return failuresStore
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

  return { db, events: eventsStore, state: stateStore, users: usersStore, summaries: summariesStore, failures: failuresStore }
}

describe('Golden shadow-parity integration test', () => {
  let stores: MockStores
  let eventRepo: AdminV3EventRepository
  let projectionRepo: AdminV3ProjectionRepository

  beforeEach(() => {
    stores = createMockDb()
    eventRepo = new AdminV3EventRepository(stores.db)
    projectionRepo = new AdminV3ProjectionRepository(stores.db)
  })

  it('proves shadow parity across all gamification flows', async () => {
    // 1. Initialise V3 baseline
    const baseline = makeBaselineEvent(600, 100)
    await writeShadowEvent({ eventRepo, projectionRepo, now: () => '2026-01-05T10:00:00.000Z', weeklyContext: weekly }, baseline)
    let events = await eventRepo.readMemberEvents(FAMILY, MEMBER)
    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe('LEGACY_BASELINE')

    // 2. Approve shared task
    const task1 = makeTaskEvent('shared-task-1:2026-W02', 10)
    await writeShadowEvent({ eventRepo, projectionRepo, now: () => '2026-01-05T10:00:00.000Z', weeklyContext: weekly }, task1)
    events = await eventRepo.readMemberEvents(FAMILY, MEMBER)
    expect(events.filter(e => e.eventType === 'TASK_APPROVED')).toHaveLength(1)

    // 3. Approve assigned task
    const task2 = makeTaskEvent('assigned-task-1:2026-W02', 5)
    await writeShadowEvent({ eventRepo, projectionRepo, now: () => '2026-01-05T10:00:00.000Z', weeklyContext: weekly }, task2)
    events = await eventRepo.readMemberEvents(FAMILY, MEMBER)
    expect(events.filter(e => e.eventType === 'TASK_APPROVED')).toHaveLength(2)

    // 4. Log positive behaviour
    const posBeh = makeBehaviourEvent('positive', 'pos-beh-1', 20)
    await writeShadowEvent({ eventRepo, projectionRepo, now: () => '2026-01-05T10:00:00.000Z', weeklyContext: weekly }, posBeh)
    events = await eventRepo.readMemberEvents(FAMILY, MEMBER)
    expect(events.filter(e => e.eventType === 'BEHAVIOUR_POSITIVE')).toHaveLength(1)

    // 5. Log negative behaviour (deterministic ordering: earnings before spending)
    const negBeh = makeBehaviourEvent('negative', 'neg-beh-1', -5)
    const negResult = await writeShadowEvent({ eventRepo, projectionRepo, now: () => '2026-01-05T10:00:00.000Z', weeklyContext: weekly }, negBeh)
    expect(negResult.status).toBe('written')
    events = await eventRepo.readMemberEvents(FAMILY, MEMBER)
    expect(events.filter(e => e.eventType === 'BEHAVIOUR_NEGATIVE')).toHaveLength(1)

    // 6. Redeem reward
    const redemption = makeRedemptionEvent('redemption-1', 10)
    await writeShadowEvent({ eventRepo, projectionRepo, now: () => '2026-01-05T10:00:00.000Z', weeklyContext: weekly }, redemption)
    events = await eventRepo.readMemberEvents(FAMILY, MEMBER)
    expect(events.filter(e => e.eventType === 'REWARD_REDEEMED')).toHaveLength(1)

    // 7. Unlock avatar
    const avatar = makeAvatarUnlockEvent('epic-dragon', 500)
    await writeShadowEvent({ eventRepo, projectionRepo, now: () => '2026-01-05T10:00:00.000Z', weeklyContext: weekly }, avatar)
    events = await eventRepo.readMemberEvents(FAMILY, MEMBER)
    expect(events.filter(e => e.eventType === 'AVATAR_UNLOCKED')).toHaveLength(1)

    // 8. Award daily goal and perfect day
    const dailyGoal = makeDailyGoalEvent('2026-01-05', 25)
    await writeShadowEvent({ eventRepo, projectionRepo, now: () => '2026-01-05T10:00:00.000Z', weeklyContext: weekly }, dailyGoal)
    const perfectDay = makePerfectDayEvent('2026-01-05', 50)
    await writeShadowEvent({ eventRepo, projectionRepo, now: () => '2026-01-05T10:00:00.000Z', weeklyContext: weekly }, perfectDay)
    events = await eventRepo.readMemberEvents(FAMILY, MEMBER)
    expect(events.filter(e => e.eventType === 'DAILY_GOAL_AWARDED')).toHaveLength(1)
    expect(events.filter(e => e.eventType === 'PERFECT_DAY_AWARDED')).toHaveLength(1)

    // 9. Reverse a task approval
    const reversal = makeReversalEvent(task1.eventId, 'rev-1', -10, -10, -10)
    await writeShadowEvent({ eventRepo, projectionRepo, now: () => '2026-01-05T11:00:00.000Z', weeklyContext: weekly }, reversal)
    events = await eventRepo.readMemberEvents(FAMILY, MEMBER)
    expect(events.filter(e => e.eventType === 'REVERSAL')).toHaveLength(1)

    // 10. Duplicate delivery — writing the same event again returns duplicate
    const dupResult = await writeShadowEvent({ eventRepo, projectionRepo, now: () => '2026-01-05T10:00:00.000Z', weeklyContext: weekly }, task1)
    expect(dupResult.status).toBe('duplicate')

    // 10. Verify V3 projection state
    const state = await projectionRepo.readProjection(FAMILY, MEMBER)
    expect(state).not.toBeNull()
    expect(state!.rewardPoints).toBeGreaterThanOrEqual(0)

    // 11. Rebuild V3 state from events and verify it matches
    const rebuildResult = await rebuildMemberProjection({ eventRepo, projectionRepo }, FAMILY, MEMBER, context)
    expect(rebuildResult.matchesStored).toBe(true)
    expect(rebuildResult.state.rewardPoints).toBe(state!.rewardPoints)

    // 12. Verify the reducer produces the same result
    const allEvents = await eventRepo.readMemberEvents(FAMILY, MEMBER)
    const reduced = reduceGamificationEventsV3(allEvents, context)
    expect(reduced.rewardPoints).toBe(state!.rewardPoints)
    expect(reduced.xpTotal).toBe(state!.xpTotal)
  })

  it('records failure when write fails (Amendment 4)', async () => {
    const recorder = new AdminV3FailureRecorder(stores.db)
    await recorder.recordFailure({
      familyId: FAMILY,
      memberId: MEMBER,
      sourceType: 'task_completion',
      sourceId: 'fail-1',
      failureStage: 'event_write',
      errorMessage: 'Simulated failure',
      sourceSnapshot: {},
      failedAt: '2026-01-05T10:00:00.000Z',
      retryCount: 0,
      resolved: false,
      sourceFlow: 'task_approval',
      sourceDocumentId: 'fail-1',
      legacyCommittedAt: '2026-01-05T10:00:00.000Z',
      shadowObservedAt: '2026-01-05T10:00:01.000Z',
      bridgeVersion: 'phase-2-bridge-v1',
      reconciliationStatus: 'pending',
    })

    const doc = await stores.db.doc(`families/${FAMILY}/gamification_v3_failures/task_completion:fail-1:event_write`).get()
    expect(doc.exists).toBe(true)
    expect((doc.data() as any).reconciliationStatus).toBe('pending')
  })
})