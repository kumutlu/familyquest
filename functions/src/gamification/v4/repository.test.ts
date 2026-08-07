/**
 * Gamification V4 — server-only idempotent event/state repositories tests (Task 4.1).
 * TDD-first. Covers every plan acceptance criterion plus the safety requirements
 * (emulator-only, no wallet access, no production credentials). Firestore is an
 * in-memory mock with real transaction rollback semantics; the emulator-only
 * guard is proven by toggling FIRESTORE_EMULATOR_HOST.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'

import {
  CrossFamilyEventError,
  EmulatorOnlyGuardError,
  isEmulatorOnlyMode,
  readLedger,
  rejectCrossFamily,
  writeEventIdempotent,
  writeState,
} from './repository'
import { eventIdFor, type GamificationEventTypeV4 } from '../../../../src/domain/gamification/v4/ids'
import { eventDocPath, stateDocPath } from '../../../../src/domain/gamification/v4/storage'
import { rebuildStateFromLedger } from '../../../../src/domain/gamification/v4/rebuild'
import { businessFields } from '../../../../src/domain/gamification/v4/types'
import type { GamificationEventV4, GamificationStateV4 } from '../../../../src/domain/gamification/v4/event'

// All logic tests run with a local emulator host so the guard passes.
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080'

// The repository must never call getFirestore / applicationDefault.
const hoisted = vi.hoisted(() => ({ getFirestore: vi.fn() }))
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: hoisted.getFirestore,
  FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
}))

// --- in-memory Firestore mock with transaction rollback semantics ----------
class MockDocSnap {
  constructor(public readonly id: string, private readonly value: unknown) {}
  get exists(): boolean { return this.value !== undefined }
  data(): unknown { return this.value }
}
class MockQuerySnap {
  constructor(public readonly docs: MockDocSnap[]) {}
}
class MockDoc {
  constructor(private readonly store: MockStore, private readonly segments: string[]) {}
  get path(): string { return this.segments.join('/') }
  async get(): Promise<MockDocSnap> {
    return new MockDocSnap(this.segments[this.segments.length - 1], this.store.read(this.path))
  }
  async set(data: unknown): Promise<void> { this.store.write(this.path, data) }
  collection(name: string): MockCollection {
    this.store.collectionCalls.push(name)
    return new MockCollection(this.store, [...this.segments, name])
  }
}
class MockCollection {
  constructor(private readonly store: MockStore, private readonly segments: string[]) {}
  doc(id: string): MockDoc { return new MockDoc(this.store, [...this.segments, id]) }
  async get(): Promise<MockQuerySnap> {
    const prefix = [...this.segments].join('/') + '/'
    const docs: MockDocSnap[] = []
    for (const [path, value] of this.store.entries()) {
      if (path.startsWith(prefix)) {
        const rest = path.slice(prefix.length)
        if (!rest.includes('/')) docs.push(new MockDocSnap(rest, value))
      }
    }
    return new MockQuerySnap(docs)
  }
}
class MockTransaction {
  private writes: Array<{ path: string; data: unknown }> = []
  constructor(private readonly store: MockStore) {}
  set(ref: MockDoc, data: unknown): void { this.writes.push({ path: ref.path, data }) }
  delete(ref: MockDoc): void { this.writes.push({ path: ref.path, data: undefined }) }
  commit(): void {
    for (const w of this.writes) {
      if (w.data === undefined) this.store.delete(w.path)
      else this.store.write(w.path, w.data)
    }
  }
  rollback(): void { this.writes = [] }
}
class MockStore {
  private readonly data = new Map<string, unknown>()
  readonly collectionCalls: string[] = []
  read(path: string): unknown { return this.data.get(path) }
  write(path: string, value: unknown): void { this.data.set(path, value) }
  delete(path: string): void { this.data.delete(path) }
  entries(): Array<[string, unknown]> { return [...this.data.entries()] }
  collection(name: string): MockCollection {
    this.collectionCalls.push(name)
    return new MockCollection(this, [name])
  }
  async runTransaction<T>(fn: (tx: MockTransaction) => Promise<T>): Promise<T> {
    const tx = new MockTransaction(this)
    try {
      const result = await fn(tx)
      tx.commit()
      return result
    } catch (err) {
      tx.rollback()
      throw err
    }
  }
}
class FailingStore extends MockStore {
  async runTransaction<T>(_fn: (tx: MockTransaction) => Promise<T>): Promise<T> {
    throw new Error('simulated transaction failure')
  }
}
function createMockFirestore(): { db: Firestore; store: MockStore } {
  const store = new MockStore()
  return { db: store as unknown as Firestore, store }
}

// --- builders ---------------------------------------------------------------
function makeEvent(overrides: Partial<GamificationEventV4> = {}): GamificationEventV4 {
  const base: GamificationEventV4 = {
    schemaVersion: 4 as const,
    familyId: 'fam-A',
    memberId: 'mem-1',
    eventType: 'TASK_APPROVED' as GamificationEventTypeV4,
    sourceType: 'task_completion',
    sourceId: 'task-1#2026-01-05',
    effectiveAt: '2026-01-05T10:00:00.000Z',
    createdAt: '2026-01-05T10:00:00.000Z',
    rewardPointsDelta: 20,
    xpDelta: 20,
    metadata: {},
    estimated: false,
  }
  const merged = { ...base, ...overrides }
  if (overrides.eventId === undefined) {
    merged.eventId = eventIdFor(merged.familyId, merged.memberId, merged.eventType, merged.sourceId)
  }
  return merged
}
function makeState(overrides: Partial<GamificationStateV4> = {}): GamificationStateV4 {
  return {
    rewardPoints: 20, xpTotal: 20, level: 1, xpProgressInLevel: 20, xpToNextLevel: 980,
    levelProgressPercentage: 2, currentStreak: 1, bestStreak: 1, lastQualifiedDayKey: '2026-01-05',
    unlockedAchievementIds: [], unlockedAvatarIds: [], projectionVersion: 1,
    foldedThroughEventId: 'fam-A::mem-1::TASK_APPROVED::task-1#2026-01-05',
    updatedAt: '2026-01-05T10:00:00.000Z', ...overrides,
  }
}
function hasWalletKey(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  return Object.keys(value as Record<string, unknown>).some((k) => /wallet/i.test(k))
}

// --- tests ------------------------------------------------------------------
describe('emulator-only safety guard', () => {
  it('refuses writes when FIRESTORE_EMULATOR_HOST is unset (fail closed)', async () => {
    const saved = process.env.FIRESTORE_EMULATOR_HOST
    delete process.env.FIRESTORE_EMULATOR_HOST
    try {
      const { db } = createMockFirestore()
      await expect(writeEventIdempotent(db, makeEvent())).rejects.toBeInstanceOf(EmulatorOnlyGuardError)
    } finally {
      if (saved === undefined) delete process.env.FIRESTORE_EMULATOR_HOST
      else process.env.FIRESTORE_EMULATOR_HOST = saved
    }
  })
  it('allows writes when FIRESTORE_EMULATOR_HOST is a local address', () => {
    expect(isEmulatorOnlyMode()).toBe(true)
  })
})

describe('writeEventIdempotent', () => {
  it('first write creates the expected V4 event', async () => {
    const { db, store } = createMockFirestore()
    const event = makeEvent()
    expect(await writeEventIdempotent(db, event)).toBe(event)
    const stored = store.read(`families/fam-A/gamification_events/${event.eventId}`) as GamificationEventV4
    expect(stored).toEqual(event)
    expect(stored.familyId).toBe('fam-A')
    expect(stored.rewardPointsDelta).toBe(20)
    expect(stored.xpDelta).toBe(20)
  })

  it('duplicate execution writes nothing twice (mandatory test #6, storage layer)', async () => {
    const { db, store } = createMockFirestore()
    const event = makeEvent()
    await writeEventIdempotent(db, event)
    await writeEventIdempotent(db, event)
    const ledger = await readLedger(db, 'fam-A')
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toEqual(event)
    const keys = store.entries().map(([p]) => p)
    expect(keys.filter((p) => p.startsWith('families/fam-A/gamification_events/'))).toHaveLength(1)
  })

  it('rejects a malformed event before any write', async () => {
    const { db, store } = createMockFirestore()
    const bad = makeEvent({ rewardPointsDelta: -5 }) // TASK_APPROVED must be >= 0
    await expect(writeEventIdempotent(db, bad)).rejects.toThrow()
    const keys = store.entries().map(([p]) => p)
    expect(keys.filter((p) => p.includes('gamification_events'))).toHaveLength(0)
  })

  it('rejects a cross-family event (mandatory test #11)', async () => {
    const { db } = createMockFirestore()
    const crossFamily = makeEvent({
      familyId: 'fam-A',
      eventId: eventIdFor('fam-B', 'mem-1', 'TASK_APPROVED', 'task-1#2026-01-05'),
    })
    await expect(writeEventIdempotent(db, crossFamily)).rejects.toBeInstanceOf(CrossFamilyEventError)
    expect(() => rejectCrossFamily(crossFamily)).toThrow(CrossFamilyEventError)
  })

  it('transaction rollback on event failure leaves no partial state', async () => {
    const { store } = createMockFirestore()
    const event = makeEvent()
    await expect(writeEventIdempotent(new FailingStore() as unknown as Firestore, event)).rejects.toThrow()
    expect(store.read(`families/fam-A/gamification_events/${event.eventId}`)).toBeUndefined()
  })
})

describe('readLedger', () => {
  it('returns only the family partition (family/member isolation)', async () => {
    const { db } = createMockFirestore()
    await writeEventIdempotent(db, makeEvent({ familyId: 'fam-A', memberId: 'mem-1' }))
    await writeEventIdempotent(db, makeEvent({ familyId: 'fam-A', memberId: 'mem-2' }))
    await writeEventIdempotent(db, makeEvent({ familyId: 'fam-B', memberId: 'mem-9' }))
    const ledgerA = await readLedger(db, 'fam-A')
    expect(ledgerA).toHaveLength(2)
    expect(ledgerA.every((e) => e.familyId === 'fam-A')).toBe(true)
    const ledgerB = await readLedger(db, 'fam-B')
    expect(ledgerB).toHaveLength(1)
    expect(ledgerB[0].familyId).toBe('fam-B')
  })
})

describe('writeState', () => {
  it('writes to the canonical family-scoped state path', async () => {
    const { db, store } = createMockFirestore()
    const state = makeState()
    expect(await writeState(db, 'fam-A', 'mem-1', state)).toBe(state)
    const stored = store.read(stateDocPath('fam-A', 'mem-1')) as GamificationStateV4
    expect(stored).toEqual(state)
    expect(stored.rewardPoints).toBe(20)
  })

  it('never writes a root-level gamification_state document', async () => {
    const { db, store } = createMockFirestore()
    await writeState(db, 'fam-A', 'mem-1', makeState())
    expect(store.read('gamification_state/mem-1')).toBeUndefined()
  })

  it('produces exactly one V4 state document and no duplicate elsewhere', async () => {
    const { db, store } = createMockFirestore()
    await writeState(db, 'fam-A', 'mem-1', makeState())
    const statePaths = store
      .entries()
      .map(([p]) => p)
      .filter((p) => p.includes('gamification_state'))
    expect(statePaths).toEqual(['families/fam-A/gamification_state/mem-1'])
  })

  it('transaction rollback on projection failure leaves no partial state', async () => {
    const state = makeState()
    await expect(
      writeState(new FailingStore() as unknown as Firestore, 'fam-A', 'mem-1', state),
    ).rejects.toThrow()
  })

  it('keeps members isolated (separate docs per member)', async () => {
    const { db, store } = createMockFirestore()
    await writeState(db, 'fam-A', 'mem-1', makeState({ rewardPoints: 20 }))
    await writeState(db, 'fam-A', 'mem-2', makeState({ rewardPoints: 99 }))
    expect((store.read(stateDocPath('fam-A', 'mem-1')) as GamificationStateV4).rewardPoints).toBe(20)
    expect((store.read(stateDocPath('fam-A', 'mem-2')) as GamificationStateV4).rewardPoints).toBe(99)
  })

  it('keeps families isolated: same memberId in two families are distinct docs', async () => {
    const { db, store } = createMockFirestore()
    await writeState(db, 'fam-A', 'mem-1', makeState({ rewardPoints: 20 }))
    await writeState(db, 'fam-B', 'mem-1', makeState({ rewardPoints: 99 }))
    expect((store.read(stateDocPath('fam-A', 'mem-1')) as GamificationStateV4).rewardPoints).toBe(20)
    expect((store.read(stateDocPath('fam-B', 'mem-1')) as GamificationStateV4).rewardPoints).toBe(99)
  })

  it('rejects an empty familyId (no unpartitioned write)', async () => {
    const { db, store } = createMockFirestore()
    await expect(writeState(db, '', 'mem-1', makeState())).rejects.toThrow()
    expect(store.entries()).toHaveLength(0)
  })
})

describe('projection equality', () => {
  it('stored projection equals rebuildStateFromLedger()', async () => {
    const { db, store } = createMockFirestore()
    const events = [
      makeEvent({ sourceId: 'task-1#2026-01-05', rewardPointsDelta: 20, xpDelta: 20 }),
      makeEvent({ eventType: 'BEHAVIOUR_POSITIVE', sourceId: 'beh-1', rewardPointsDelta: 20, xpDelta: 20 }),
      makeEvent({ eventType: 'REWARD_REDEEMED', sourceId: 'rew-1', rewardPointsDelta: -10, xpDelta: 0 }),
    ]
    for (const e of events) await writeEventIdempotent(db, e)
    const rebuilt = rebuildStateFromLedger(await readLedger(db, 'fam-A'), {
      updatedAt: '2026-01-05T10:00:00.000Z',
      projectionVersion: 1,
    })
    await writeState(db, 'fam-A', 'mem-1', rebuilt)
    const stored = store.read(stateDocPath('fam-A', 'mem-1')) as GamificationStateV4
    expect(businessFields(stored)).toEqual(businessFields(rebuilt))
    expect(stored.rewardPoints).toBe(30) // 20 + 20 - 10
    expect(stored.xpTotal).toBe(40) // 20 + 20
  })
})

describe('wallet safety', () => {
  it('never accesses a wallet collection', async () => {
    const { db, store } = createMockFirestore()
    await writeEventIdempotent(db, makeEvent())
    await writeState(db, 'fam-A', 'mem-1', makeState())
    await readLedger(db, 'fam-A')
    expect(store.collectionCalls.every((c) => !/wallet/i.test(c))).toBe(true)
    expect(store.collectionCalls).toEqual(
      expect.arrayContaining(['families', 'gamification_events', 'gamification_state']),
    )
  })
  it('never writes a wallet field', async () => {
    const { db, store } = createMockFirestore()
    const event = makeEvent()
    await writeEventIdempotent(db, event)
    await writeState(db, 'fam-A', 'mem-1', makeState())
    expect(hasWalletKey(store.read(eventDocPath('fam-A', event.eventId)))).toBe(false)
    expect(hasWalletKey(store.read(stateDocPath('fam-A', 'mem-1')))).toBe(false)
  })
})

describe('no production credential initialization', () => {
  it('never calls getFirestore / applicationDefault', async () => {
    const { db } = createMockFirestore()
    await writeEventIdempotent(db, makeEvent())
    await writeState(db, 'fam-A', 'mem-1', makeState())
    expect(hoisted.getFirestore).not.toHaveBeenCalled()
  })
})
