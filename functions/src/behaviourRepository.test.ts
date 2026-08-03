import { describe, expect, it } from 'vitest'
import { AdminBehaviourRepository } from './behaviourRepository'

interface Store { [path: string]: Record<string, unknown> }

/** Minimal in-memory Admin Firestore double covering the transaction API used. */
function fakeDb(initial: Store) {
  const store: Store = { ...initial }
  const created: string[] = []
  const ref = (path: string) => ({
    path,
    collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
  })
  const snapshot = (path: string) => ({
    exists: Object.hasOwn(store, path),
    id: path.split('/').at(-1)!,
    data: () => store[path],
  })
  return {
    store,
    created,
    doc: (path: string) => ref(path),
    async runTransaction<T>(run: (transaction: {
      get: (r: { path: string }) => Promise<ReturnType<typeof snapshot>>
      set: (r: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }) => void
      update: (r: { path: string }, data: Record<string, unknown>) => void
      create: (r: { path: string }, data: Record<string, unknown>) => void
    }) => Promise<T>): Promise<T> {
      return run({
        get: async r => snapshot(r.path),
        set: (r, data, options) => { store[r.path] = options?.merge ? { ...store[r.path], ...data } : data },
        update: (r, data) => { store[r.path] = { ...store[r.path], ...data } },
        create: (r, data) => {
          if (Object.hasOwn(store, r.path)) throw new Error(`ALREADY_EXISTS: ${r.path}`)
          created.push(r.path)
          store[r.path] = data
        },
      })
    },
  }
}

function baseStore(overrides: Store = {}): Store {
  return {
    'families/family-1': { name: 'Test', gamificationMigration: { schemaVersion: 1, status: 'active' } },
    'users/child-1': { familyId: 'family-1', role: 'child', rewardPoints: 350, lifetimeXP: 380 },
    'families/family-1/gamification_summaries/child-1': {
      schemaVersion: 1, familyId: 'family-1', childId: 'child-1', xpTotal: 380, level: 1,
      currentStreak: 0, bestStreak: 0, perfectDayCount: 0, lastQualifiedDayKey: null,
      projectionRevision: 3, foldedThrough: null, rebuildRequired: false,
      earliestDirtyCursor: null, projectionStatus: 'ready', updatedAt: new Date(0),
    },
    'families/family-1/behaviour_events/behaviour-1': {
      childId: 'child-1', type: 'positive', reason: 'Helped out', pointsDelta: 20,
      createdAt: new Date(Date.parse('2026-08-03T10:00:00Z')),
    },
    ...overrides,
  }
}

const PROCESSING_AT = Date.parse('2026-08-03T10:00:05Z')

describe('AdminBehaviourRepository', () => {
  it('awards +20 rewardPoints and +20 xpTotal exactly once for a positive behaviour', async () => {
    const db = fakeDb(baseStore())
    const repository = new AdminBehaviourRepository(db as never)
    const result = await repository.processBehaviourEvent({
      familyId: 'family-1', behaviourEventId: 'behaviour-1', processingAt: PROCESSING_AT,
    })

    expect(result.status).toBe('processed')
    expect(db.store['users/child-1']).toMatchObject({ rewardPoints: 370, lifetimeXP: 400 })
    expect(db.store['families/family-1/gamification_summaries/child-1']).toMatchObject({ xpTotal: 400, level: 1 })
    expect(db.created.filter(path => path.includes('/gamification_events/'))).toHaveLength(1)
    const event = db.store[db.created.find(path => path.includes('/gamification_events/'))!]
    expect(event).toMatchObject({
      familyId: 'family-1', childId: 'child-1', sourceBehaviourEventId: 'behaviour-1',
      eventType: 'behaviour_positive', rewardPointsDelta: 20, xpDelta: 20,
    })
    expect(event.processorVersion).toBeTypeOf('string')
    expect(event.idempotencyKey).toBeTypeOf('string')
  })

  it('is a no-op when replayed', async () => {
    const db = fakeDb(baseStore())
    const repository = new AdminBehaviourRepository(db as never)
    await repository.processBehaviourEvent({ familyId: 'family-1', behaviourEventId: 'behaviour-1', processingAt: PROCESSING_AT })
    const second = await repository.processBehaviourEvent({ familyId: 'family-1', behaviourEventId: 'behaviour-1', processingAt: PROCESSING_AT + 1 })

    expect(second.status).toBe('duplicate')
    expect(db.store['users/child-1']).toMatchObject({ rewardPoints: 370, lifetimeXP: 400 })
    expect(db.store['families/family-1/gamification_summaries/child-1']).toMatchObject({ xpTotal: 400 })
    expect(db.created.filter(path => path.includes('/gamification_events/'))).toHaveLength(1)
  })

  it('reduces only spendable points for a negative behaviour', async () => {
    const db = fakeDb(baseStore({
      'families/family-1/behaviour_events/behaviour-1': {
        childId: 'child-1', type: 'negative', reason: 'Late home', pointsDelta: -20,
        createdAt: new Date(Date.parse('2026-08-03T10:00:00Z')),
      },
    }))
    const repository = new AdminBehaviourRepository(db as never)
    await repository.processBehaviourEvent({ familyId: 'family-1', behaviourEventId: 'behaviour-1', processingAt: PROCESSING_AT })

    expect(db.store['users/child-1']).toMatchObject({ rewardPoints: 330, lifetimeXP: 380 })
    expect(db.store['families/family-1/gamification_summaries/child-1']).toMatchObject({ xpTotal: 380 })
  })

  it('refuses a behaviour event for a child outside the family', async () => {
    const db = fakeDb(baseStore({ 'users/child-1': { familyId: 'family-2', role: 'child', rewardPoints: 10, lifetimeXP: 0 } }))
    const repository = new AdminBehaviourRepository(db as never)
    const result = await repository.processBehaviourEvent({
      familyId: 'family-1', behaviourEventId: 'behaviour-1', processingAt: PROCESSING_AT,
    })
    expect(result.status).toBe('ignored')
    expect(db.store['users/child-1']).toMatchObject({ rewardPoints: 10 })
  })
})
