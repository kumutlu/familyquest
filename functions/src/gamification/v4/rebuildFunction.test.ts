/**
 * Gamification V4 — deterministic projection rebuild server function tests (Task 4.3).
 *
 * TDD-first. Covers every plan acceptance criterion plus the safety requirements
 * (emulator-only, no wallet access, no production credentials, no legacy V2/V3
 * mutation, canonical path, idempotency, malformed/cross-family rejection,
 * transaction atomicity, member isolation).
 *
 * Two layers:
 *  - Fast in-memory mock Firestore (real transaction rollback semantics) for the
 *    logic/atomicity/safety proofs that do not require a live emulator.
 *  - REAL Firestore emulator integration (gated on FIRESTORE_EMULATOR_HOST) for
 *    the end-to-end canonical-path / no-root-doc / no-wallet proofs.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import { initializeApp, deleteApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore as RealFirestore } from 'firebase-admin/firestore'

import { rebuildProjection } from './rebuildFunction'
import {
  CrossFamilyEventError,
  EmulatorOnlyGuardError,
  isEmulatorOnlyMode,
  writeEventIdempotent,
} from './repository'
import { eventIdFor } from '../../../../src/domain/gamification/v4/ids'
import {
  STATE_V4_COLLECTION_ID,
  eventCollectionPath,
  eventDocPath,
  familyDocPath,
  stateCollectionPath,
  stateDocPath,
} from '../../../../src/domain/gamification/v4/storage'
import { rebuildStateFromLedger } from '../../../../src/domain/gamification/v4/rebuild'
import { businessFields } from '../../../../src/domain/gamification/v4/types'
import type { GamificationEventV4, GamificationStateV4 } from '../../../../src/domain/gamification/v4/event'

// The mock-layer tests need the emulator-only guard to pass, but the REAL
// emulator integration block below is gated on a genuinely running emulator
// (set by `firebase emulators:exec` or a standalone local emulator). We set the
// host for the mock layer only and restore it afterwards, so the gating
// decision (made at module load) stays false unless a real emulator is present.
beforeAll(() => {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
})
afterAll(() => {
  delete process.env.FIRESTORE_EMULATOR_HOST
})

// --- in-memory Firestore mock with real transaction rollback semantics ------
class MockDocSnap {
  constructor(public readonly id: string, private readonly value: unknown) {}
  get exists(): boolean {
    return this.value !== undefined
  }
  data(): unknown {
    return this.value
  }
}
class MockQuerySnap {
  constructor(public readonly docs: MockDocSnap[]) {}
}
class MockDoc {
  constructor(private readonly store: MockStore, public readonly segments: string[]) {}
  get path(): string {
    return this.segments.join('/')
  }
  async get(): Promise<MockDocSnap> {
    return new MockDocSnap(this.segments[this.segments.length - 1], this.store.read(this.path))
  }
  async set(data: unknown): Promise<void> {
    this.store.write(this.path, data)
  }
  collection(name: string): MockCollection {
    this.store.collectionCalls.push(name)
    return new MockCollection(this.store, [...this.segments, name])
  }
}
class MockCollection {
  constructor(private readonly store: MockStore, private readonly segments: string[]) {}
  doc(id: string): MockDoc {
    return new MockDoc(this.store, [...this.segments, id])
  }
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
  set(ref: MockDoc, data: unknown): void {
    this.writes.push({ path: ref.path, data })
  }
  commit(): void {
    for (const w of this.writes) this.store.write(w.path, w.data)
  }
  rollback(): void {
    this.writes = []
  }
}
class MockStore {
  private readonly data = new Map<string, unknown>()
  readonly collectionCalls: string[] = []
  read(path: string): unknown {
    return this.data.get(path)
  }
  write(path: string, value: unknown): void {
    this.data.set(path, value)
  }
  delete(path: string): void {
    this.data.delete(path)
  }
  entries(): Array<[string, unknown]> {
    return [...this.data.entries()]
  }
  collection(name: string): MockCollection {
    this.collectionCalls.push(name)
    return new MockCollection(this, [name])
  }
  doc(path: string): MockDoc {
    return new MockDoc(this, path.split('/'))
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
const FAMILY = 'fam-rebuild'
const CTX = { updatedAt: '2026-01-05T10:00:00.000Z', projectionVersion: 1 }

function makeEvent(overrides: Partial<GamificationEventV4> = {}): GamificationEventV4 {
  const base: GamificationEventV4 = {
    schemaVersion: 4 as const,
    familyId: FAMILY,
    memberId: 'mem-1',
    eventType: 'TASK_APPROVED',
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
function seedEvent(store: MockStore, event: GamificationEventV4): void {
  store.write(eventDocPath(event.familyId, event.eventId), { ...event })
}
function hasWalletKey(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  return Object.keys(value as Record<string, unknown>).some((k) => /wallet/i.test(k))
}

// --- tests ------------------------------------------------------------------
describe('emulator-only safety guard', () => {
  it('refuses rebuild when FIRESTORE_EMULATOR_HOST is unset (fail closed)', async () => {
    const saved = process.env.FIRESTORE_EMULATOR_HOST
    delete process.env.FIRESTORE_EMULATOR_HOST
    try {
      const { db } = createMockFirestore()
      await expect(rebuildProjection(db, FAMILY, CTX)).rejects.toBeInstanceOf(EmulatorOnlyGuardError)
    } finally {
      if (saved === undefined) delete process.env.FIRESTORE_EMULATOR_HOST
      else process.env.FIRESTORE_EMULATOR_HOST = saved
    }
  })
  it('allows rebuild when FIRESTORE_EMULATOR_HOST is a local address', () => {
    expect(isEmulatorOnlyMode()).toBe(true)
  })
})

describe('rebuildProjection — happy path', () => {
  it('first execution reads ledger, reduces, and writes one state per member', async () => {
    const { db, store } = createMockFirestore()
    seedEvent(store, makeEvent({ memberId: 'mem-1', sourceId: 'task-1#2026-01-05', rewardPointsDelta: 20, xpDelta: 20 }))
    seedEvent(store, makeEvent({ memberId: 'mem-1', eventType: 'BEHAVIOUR_POSITIVE', sourceId: 'beh-1', rewardPointsDelta: 20, xpDelta: 20 }))
    seedEvent(store, makeEvent({ memberId: 'mem-1', eventType: 'REWARD_REDEEMED', sourceId: 'rew-1', rewardPointsDelta: -10, xpDelta: 0 }))
    seedEvent(store, makeEvent({ memberId: 'mem-2', sourceId: 'task-2#2026-01-05', rewardPointsDelta: 5, xpDelta: 5 }))

    const result = await rebuildProjection(db, FAMILY, CTX)

    // mem-1: 20 + 20 - 10 = 30 RP, 20 + 20 = 40 XP
    expect(result['mem-1'].rewardPoints).toBe(30)
    expect(result['mem-1'].xpTotal).toBe(40)
    // mem-2: 5 RP, 5 XP
    expect(result['mem-2'].rewardPoints).toBe(5)
    expect(result['mem-2'].xpTotal).toBe(5)

    const stored1 = store.read(stateDocPath(FAMILY, 'mem-1')) as GamificationStateV4
    const stored2 = store.read(stateDocPath(FAMILY, 'mem-2')) as GamificationStateV4
    expect(stored1.rewardPoints).toBe(30)
    expect(stored2.rewardPoints).toBe(5)
  })

  it('stored projection equals rebuildStateFromLedger() (byte-identical business fields)', async () => {
    const { db, store } = createMockFirestore()
    const events = [
      makeEvent({ memberId: 'mem-1', sourceId: 'task-1#2026-01-05', rewardPointsDelta: 20, xpDelta: 20 }),
      makeEvent({ memberId: 'mem-1', eventType: 'BEHAVIOUR_POSITIVE', sourceId: 'beh-1', rewardPointsDelta: 20, xpDelta: 20 }),
      makeEvent({ memberId: 'mem-1', eventType: 'REWARD_REDEEMED', sourceId: 'rew-1', rewardPointsDelta: -10, xpDelta: 0 }),
    ]
    for (const e of events) seedEvent(store, e)

    await rebuildProjection(db, FAMILY, CTX)

    const stored = store.read(stateDocPath(FAMILY, 'mem-1')) as GamificationStateV4
    const rebuilt = rebuildStateFromLedger(events, CTX)
    expect(businessFields(stored)).toEqual(businessFields(rebuilt))
  })
})

describe('rebuildProjection — idempotency', () => {
  it('duplicate invocation is a no-op (same state, exactly one doc per member)', async () => {
    const { db, store } = createMockFirestore()
    seedEvent(store, makeEvent({ memberId: 'mem-1', sourceId: 'task-1#2026-01-05', rewardPointsDelta: 20, xpDelta: 20 }))

    const first = await rebuildProjection(db, FAMILY, CTX)
    const second = await rebuildProjection(db, FAMILY, CTX)

    expect(businessFields(second['mem-1'])).toEqual(businessFields(first['mem-1']))
    const statePaths = store
      .entries()
      .map(([p]) => p)
      .filter((p) => p.includes('gamification_state'))
    expect(statePaths).toEqual([stateDocPath(FAMILY, 'mem-1')])
  })
})

describe('rebuildProjection — malformed / cross-family rejection (zero writes)', () => {
  it('malformed ledger event produces zero state writes', async () => {
    const { db, store } = createMockFirestore()
    // A malformed event physically present in the ledger (bad schemaVersion).
    const bad = makeEvent({ schemaVersion: 3 as unknown as 4, eventId: eventIdFor(FAMILY, 'mem-1', 'TASK_APPROVED', 'bad') })
    seedEvent(store, bad)

    await expect(rebuildProjection(db, FAMILY, CTX)).rejects.toThrow()
    const stateKeys = store.entries().map(([p]) => p).filter((p) => p.includes('gamification_state'))
    expect(stateKeys).toHaveLength(0)
  })

  it('cross-family ledger event produces zero state writes', async () => {
    const { db, store } = createMockFirestore()
    // Event claims fam-B but is physically stored under fam-rebuild's collection.
    const cross = makeEvent({ familyId: 'fam-B', memberId: 'mem-9', sourceId: 'x' })
    store.write(eventDocPath(FAMILY, cross.eventId), { ...cross })

    await expect(rebuildProjection(db, FAMILY, CTX)).rejects.toBeInstanceOf(CrossFamilyEventError)
    const stateKeys = store.entries().map(([p]) => p).filter((p) => p.includes('gamification_state'))
    expect(stateKeys).toHaveLength(0)
  })
})

describe('rebuildProjection — transaction atomicity', () => {
  it('transaction failure leaves no partial state', async () => {
    const { store } = createMockFirestore()
    const db = new FailingStore() as unknown as Firestore
    seedEvent(store, makeEvent({ memberId: 'mem-1', sourceId: 'task-1#2026-01-05', rewardPointsDelta: 20, xpDelta: 20 }))

    await expect(rebuildProjection(db, FAMILY, CTX)).rejects.toThrow()
    expect(store.read(stateDocPath(FAMILY, 'mem-1'))).toBeUndefined()
  })
})

describe('rebuildProjection — canonical path & isolation', () => {
  it('writes only to the canonical family-scoped state path (no root doc)', async () => {
    const { db, store } = createMockFirestore()
    seedEvent(store, makeEvent({ memberId: 'mem-1', sourceId: 'task-1#2026-01-05', rewardPointsDelta: 20, xpDelta: 20 }))

    await rebuildProjection(db, FAMILY, CTX)

    expect(store.read(stateDocPath(FAMILY, 'mem-1'))).toBeDefined()
    expect(store.read(`gamification_state/mem-1`)).toBeUndefined()
  })

  it('keeps members isolated (separate docs per member)', async () => {
    const { db, store } = createMockFirestore()
    seedEvent(store, makeEvent({ memberId: 'mem-1', sourceId: 't1', rewardPointsDelta: 20, xpDelta: 20 }))
    seedEvent(store, makeEvent({ memberId: 'mem-2', sourceId: 't2', rewardPointsDelta: 99, xpDelta: 0 }))

    await rebuildProjection(db, FAMILY, CTX)

    expect((store.read(stateDocPath(FAMILY, 'mem-1')) as GamificationStateV4).rewardPoints).toBe(20)
    expect((store.read(stateDocPath(FAMILY, 'mem-2')) as GamificationStateV4).rewardPoints).toBe(99)
  })
})

describe('rebuildProjection — wallet & legacy safety', () => {
  it('never accesses a wallet collection', async () => {
    const { db, store } = createMockFirestore()
    seedEvent(store, makeEvent({ memberId: 'mem-1', sourceId: 't1', rewardPointsDelta: 20, xpDelta: 20 }))
    await rebuildProjection(db, FAMILY, CTX)
    expect(store.collectionCalls.every((c) => !/wallet/i.test(c))).toBe(true)
    expect(store.collectionCalls).toEqual(expect.arrayContaining(['families', 'gamification_events']))
  })
  it('never writes a wallet field and never mutates legacy V2/V3 collections', async () => {
    const { db, store } = createMockFirestore()
    seedEvent(store, makeEvent({ memberId: 'mem-1', sourceId: 't1', rewardPointsDelta: 20, xpDelta: 20 }))
    await rebuildProjection(db, FAMILY, CTX)
    const stored = store.read(stateDocPath(FAMILY, 'mem-1')) as GamificationStateV4
    expect(hasWalletKey(stored)).toBe(false)
    const legacyKeys = store
      .entries()
      .map(([p]) => p)
      .filter((p) => /gamification_summaries|daily_progress|task_occurrences|behaviour_events/.test(p))
    expect(legacyKeys).toHaveLength(0)
  })
})

// --- REAL Firestore emulator integration (gated) -----------------------------
const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const describeWithEmulator = emulatorAvailable ? describe : describe.skip

describeWithEmulator('rebuildProjection — real Firestore emulator', () => {
  const EMU_FAMILY = 'fam-rebuild-emu'
  let app: App
  let db: RealFirestore

  beforeAll(async () => {
    app = initializeApp({ projectId: 'familyquest-beta-402cb' }, 'v4-rebuild-integration')
    db = getFirestore(app)
  })
  afterAll(async () => {
    if (app) await deleteApp(app)
  })

  // The emulator is persistent, so isolate each test by clearing the family's
  // V4 collections before every test.
  beforeEach(async () => {
    const ev = await db.collection(eventCollectionPath(EMU_FAMILY)).get()
    await Promise.all(ev.docs.map((d) => d.ref.delete()))
    const st = await db.collection(stateCollectionPath(EMU_FAMILY)).get()
    await Promise.all(st.docs.map((d) => d.ref.delete()))
  })

  async function seedReal(event: GamificationEventV4): Promise<void> {
    await writeEventIdempotent(db, event)
  }

  it('writes the rebuilt projection to the canonical family-scoped path', async () => {
    await seedReal(makeEvent({ familyId: EMU_FAMILY, memberId: 'mem-1', sourceId: 'task-1#2026-01-05', rewardPointsDelta: 20, xpDelta: 20 }))
    await seedReal(makeEvent({ familyId: EMU_FAMILY, memberId: 'mem-1', eventType: 'BEHAVIOUR_POSITIVE', sourceId: 'beh-1', rewardPointsDelta: 20, xpDelta: 20 }))
    await seedReal(makeEvent({ familyId: EMU_FAMILY, memberId: 'mem-1', eventType: 'REWARD_REDEEMED', sourceId: 'rew-1', rewardPointsDelta: -10, xpDelta: 0 }))

    const result = await rebuildProjection(db, EMU_FAMILY, CTX)

    const snap = await db.doc(stateDocPath(EMU_FAMILY, 'mem-1')).get()
    expect(snap.exists).toBe(true)
    expect(snap.ref.path).toBe(`families/${EMU_FAMILY}/${STATE_V4_COLLECTION_ID}/mem-1`)
    expect(snap.get('rewardPoints')).toBe(30)
    expect(snap.get('xpTotal')).toBe(40)
    expect(result['mem-1'].rewardPoints).toBe(30)
  })

  it('creates NO document at the root-level gamification_state path', async () => {
    await seedReal(makeEvent({ familyId: EMU_FAMILY, memberId: 'mem-1', sourceId: 't-x', rewardPointsDelta: 1, xpDelta: 1 }))
    await rebuildProjection(db, EMU_FAMILY, CTX)
    const legacy = await db.doc(`${STATE_V4_COLLECTION_ID}/mem-1`).get()
    expect(legacy.exists).toBe(false)
  })

  it('leaves exactly one V4 state document per member (collection-group scan)', async () => {
    await seedReal(makeEvent({ familyId: EMU_FAMILY, memberId: 'mem-1', sourceId: 't-cg', rewardPointsDelta: 1, xpDelta: 1 }))
    await seedReal(makeEvent({ familyId: EMU_FAMILY, memberId: 'mem-2', sourceId: 't-cg2', rewardPointsDelta: 2, xpDelta: 2 }))
    await rebuildProjection(db, EMU_FAMILY, CTX)

    const group = await db.collectionGroup(STATE_V4_COLLECTION_ID).get()
    const paths = group.docs.map((d) => d.ref.path).filter((p) => p.endsWith('/mem-1') || p.endsWith('/mem-2'))
    expect(paths.sort()).toEqual(
      [
        `families/${EMU_FAMILY}/${STATE_V4_COLLECTION_ID}/mem-1`,
        `families/${EMU_FAMILY}/${STATE_V4_COLLECTION_ID}/mem-2`,
      ].sort(),
    )
  })

  it('stored projection equals rebuildStateFromLedger() on the real emulator', async () => {
    const events = [
      makeEvent({ familyId: EMU_FAMILY, memberId: 'mem-1', sourceId: 'task-1#2026-01-05', rewardPointsDelta: 20, xpDelta: 20 }),
      makeEvent({ familyId: EMU_FAMILY, memberId: 'mem-1', eventType: 'BEHAVIOUR_POSITIVE', sourceId: 'beh-1', rewardPointsDelta: 20, xpDelta: 20 }),
      makeEvent({ familyId: EMU_FAMILY, memberId: 'mem-1', eventType: 'REWARD_REDEEMED', sourceId: 'rew-1', rewardPointsDelta: -10, xpDelta: 0 }),
    ]
    for (const e of events) await seedReal(e)

    await rebuildProjection(db, EMU_FAMILY, CTX)

    const stored = (await db.doc(stateDocPath(EMU_FAMILY, 'mem-1')).get()).data() as GamificationStateV4
    const rebuilt = rebuildStateFromLedger(events, CTX)
    expect(businessFields(stored)).toEqual(businessFields(rebuilt))
  })

  it('rebuild is idempotent on the real emulator (no duplicate docs)', async () => {
    await seedReal(makeEvent({ familyId: EMU_FAMILY, memberId: 'mem-1', sourceId: 't-idem', rewardPointsDelta: 7, xpDelta: 7 }))
    await rebuildProjection(db, EMU_FAMILY, CTX)
    await rebuildProjection(db, EMU_FAMILY, CTX)

    const group = await db.collectionGroup(STATE_V4_COLLECTION_ID).get()
    const mem1 = group.docs.filter((d) => d.ref.path === `families/${EMU_FAMILY}/${STATE_V4_COLLECTION_ID}/mem-1`)
    expect(mem1).toHaveLength(1)
    expect(mem1[0].get('rewardPoints')).toBe(7)
  })

  it('never writes a wallet collection under the family (real emulator)', async () => {
    await seedReal(makeEvent({ familyId: EMU_FAMILY, memberId: 'mem-1', sourceId: 't-wallet', rewardPointsDelta: 1, xpDelta: 1 }))
    await rebuildProjection(db, EMU_FAMILY, CTX)

    const cols = await db.doc(familyDocPath(EMU_FAMILY)).listCollections()
    const names = cols.map((c) => c.id)
    expect(names).toContain('gamification_state')
    expect(names).toContain('gamification_events')
    const WALLET = ['wallet', 'wallet_balances', 'wallet_transactions', 'allowances', 'savings', 'funds', 'pet_box', 'petbox', 'money_requests', 'transfers']
    expect(names.some((n) => WALLET.includes(n.toLowerCase()))).toBe(false)
  })
})
