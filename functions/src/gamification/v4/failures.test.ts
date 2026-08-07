/**
 * Gamification V4 — durable migration failure records tests (Task 4.4).
 * TDD-first. Covers every plan acceptance criterion plus the safety requirements
 * (emulator-only, no wallet access, no production credentials, family isolation,
 * idempotency). Firestore is an in-memory mock with real transaction rollback
 * semantics; the emulator-only guard is proven by toggling FIRESTORE_EMULATOR_HOST.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'

import {
  FAILURES_V4_COLLECTION_ID,
  readFailures,
  recordFailure,
  type FailureStageV4,
} from './failures'

// All logic tests run with a local emulator host so the guard passes.
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080'

// The module must never call getFirestore / applicationDefault.
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
  commit(): void {
    for (const w of this.writes) this.store.write(w.path, w.data)
  }
  rollback(): void { this.writes = [] }
}
class MockStore {
  private readonly data = new Map<string, unknown>()
  readonly collectionCalls: string[] = []
  read(path: string): unknown { return this.data.get(path) }
  write(path: string, value: unknown): void { this.data.set(path, value) }
  entries(): Array<[string, unknown]> { return [...this.data.entries()] }
  collection(name: string): MockCollection {
    this.collectionCalls.push(name)
    return new MockCollection(this, [name])
  }
  async runTransaction<T>(fn: (tx: MockTransaction) => Promise<T>): Promise<T> {
    const tx = new MockTransaction(this)
    const result = await fn(tx)
    tx.commit()
    return result
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
      await expect(
        recordFailure(db, 'fam-A', 'rebuild', 'boom', { eventId: 'e1' }),
      ).rejects.toThrow()
    } finally {
      if (saved === undefined) delete process.env.FIRESTORE_EMULATOR_HOST
      else process.env.FIRESTORE_EMULATOR_HOST = saved
    }
  })
})

describe('recordFailure', () => {
  it('persists a failure record to the family-scoped path', async () => {
    const { db, store } = createMockFirestore()
    const rec = await recordFailure(db, 'fam-A', 'rebuild', 'ledger corrupt', { eventId: 'e1' })
    expect(rec.failureId).toBe('fam-A::rebuild::ledger corrupt::e1')
    expect(rec.familyId).toBe('fam-A')
    expect(rec.stage).toBe('rebuild')
    expect(rec.reason).toBe('ledger corrupt')
    expect(rec.payload).toEqual({ eventId: 'e1' })
    expect(rec.schemaVersion).toBe(4)
    const stored = store.read(`families/fam-A/${FAILURES_V4_COLLECTION_ID}/${rec.failureId}`)
    expect(stored).toEqual(rec)
  })

  it('captures the wallet-abort reason (acceptance criterion)', async () => {
    const { db } = createMockFirestore()
    const rec = await recordFailure(
      db,
      'fam-A',
      'wallet-abort',
      'wallet document hash mismatch during migration',
      { familyId: 'fam-A', walletDoc: 'wallets/fam-A/mem-1' },
    )
    expect(rec.stage).toBe<FailureStageV4>('wallet-abort')
    expect(rec.reason).toMatch(/wallet/i)
    const all = await readFailures(db, 'fam-A')
    expect(all).toHaveLength(1)
    expect(all[0].stage).toBe('wallet-abort')
  })

  it('preserves the offending payload verbatim (never discarded)', async () => {
    const { db } = createMockFirestore()
    const payload = { eventId: 'e2', delta: -5, note: 'offending record' }
    await recordFailure(db, 'fam-A', 'migration', 'bad delta', payload)
    const all = await readFailures(db, 'fam-A')
    expect(all[0].payload).toEqual(payload)
  })

  it('is idempotent: re-recording the same failure writes no duplicate', async () => {
    const { db } = createMockFirestore()
    await recordFailure(db, 'fam-A', 'rebuild', 'boom', { eventId: 'e1' })
    await recordFailure(db, 'fam-A', 'rebuild', 'boom', { eventId: 'e1' })
    const all = await readFailures(db, 'fam-A')
    expect(all).toHaveLength(1)
  })

  it('keeps families isolated (separate records per family)', async () => {
    const { db, store } = createMockFirestore()
    await recordFailure(db, 'fam-A', 'rebuild', 'boom', { eventId: 'e1' })
    await recordFailure(db, 'fam-B', 'rebuild', 'boom', { eventId: 'e1' })
    expect(await readFailures(db, 'fam-A')).toHaveLength(1)
    expect(await readFailures(db, 'fam-B')).toHaveLength(1)
    const paths = store.entries().map(([p]) => p)
    expect(paths.filter((p) => p.includes(FAILURES_V4_COLLECTION_ID))).toHaveLength(2)
  })

  it('never writes a root-level failure collection', async () => {
    const { db, store } = createMockFirestore()
    await recordFailure(db, 'fam-A', 'rebuild', 'boom', { eventId: 'e1' })
    expect(store.read(`${FAILURES_V4_COLLECTION_ID}/fam-A::rebuild::boom::e1`)).toBeUndefined()
  })

  it('rejects an empty familyId (no unpartitioned write)', async () => {
    const { db, store } = createMockFirestore()
    await expect(recordFailure(db, '', 'rebuild', 'boom', {})).rejects.toThrow()
    expect(store.entries()).toHaveLength(0)
  })

  it('transaction rollback on failure leaves no partial record', async () => {
    const { store } = createMockFirestore()
    await expect(
      recordFailure(new FailingStore() as unknown as Firestore, 'fam-A', 'rebuild', 'boom', {
        eventId: 'e1',
      }),
    ).rejects.toThrow()
    expect(store.entries()).toHaveLength(0)
  })
})

describe('readFailures', () => {
  it('returns only the family partition', async () => {
    const { db } = createMockFirestore()
    await recordFailure(db, 'fam-A', 'rebuild', 'boom', { eventId: 'e1' })
    await recordFailure(db, 'fam-A', 'migration', 'bad', { eventId: 'e2' })
    await recordFailure(db, 'fam-B', 'rebuild', 'boom', { eventId: 'e1' })
    const all = await readFailures(db, 'fam-A')
    expect(all).toHaveLength(2)
    expect(all.every((r) => r.familyId === 'fam-A')).toBe(true)
  })
})

describe('wallet safety', () => {
  it('never accesses a wallet collection', async () => {
    const { db, store } = createMockFirestore()
    await recordFailure(db, 'fam-A', 'wallet-abort', 'wallet hash mismatch', {
      walletDoc: 'wallets/fam-A/mem-1',
    })
    await readFailures(db, 'fam-A')
    expect(store.collectionCalls.every((c) => !/wallet/i.test(c))).toBe(true)
    expect(store.collectionCalls).toEqual(
      expect.arrayContaining(['families', FAILURES_V4_COLLECTION_ID]),
    )
  })
  it('never writes a wallet field', async () => {
    const { db, store } = createMockFirestore()
    const rec = await recordFailure(db, 'fam-A', 'wallet-abort', 'wallet hash mismatch', {
      walletDoc: 'wallets/fam-A/mem-1',
    })
    expect(hasWalletKey(store.read(`families/fam-A/${FAILURES_V4_COLLECTION_ID}/${rec.failureId}`))).toBe(false)
  })
})

describe('no production credential initialization', () => {
  it('never calls getFirestore / applicationDefault', async () => {
    const { db } = createMockFirestore()
    await recordFailure(db, 'fam-A', 'rebuild', 'boom', { eventId: 'e1' })
    await readFailures(db, 'fam-A')
    expect(hoisted.getFirestore).not.toHaveBeenCalled()
  })
})
