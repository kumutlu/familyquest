/**
 * Gamification V4 — instant rollback mechanism tests (TDD-first).
 *
 * Unit tests use an in-memory Firestore double. Proves the config flip is
 * instant + all-legacy, the audit event is recorded, and the data-level purge
 * deletes exactly the V4 ledger/state/marker. The emulator-only guard is proven
 * by toggling FIRESTORE_EMULATOR_HOST.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'

import {
  purgeV4FamilyData,
  recordRollbackEvent,
  rollbackAuditDocPath,
  rollbackStage7,
} from './rollback'
import { isV4Active, defaultFeatureFlags, withAllV4 } from '../../../../src/domain/gamification/v4/featureFlags'
import { activateStage7 } from './cutoverConfig'
import {
  EVENTS_V4_COLLECTION_ID,
  FAMILIES_COLLECTION_ID,
  STATE_V4_COLLECTION_ID,
} from '../../../../src/domain/gamification/v4/storage'
import { migrationMarkerDocPath } from '../../../../scripts/migrate/migration-marker'

process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080'

const hoisted = vi.hoisted(() => ({ getFirestore: vi.fn() }))
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: hoisted.getFirestore,
  FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
}))

// --- in-memory Firestore mock (supports snapshot .ref.delete()) -------------
class MockDocSnap {
  constructor(public readonly ref: MockDoc, private readonly value: unknown) {}
  get exists(): boolean { return this.value !== undefined }
  data(): unknown { return this.value }
  get id(): string { return this.ref.id }
}
class MockQuerySnap {
  constructor(public readonly docs: MockDocSnap[]) {}
}
class MockDoc {
  constructor(private readonly store: MockStore, private readonly segments: string[]) {}
  get id(): string { return this.segments[this.segments.length - 1] }
  get path(): string { return this.segments.join('/') }
  async get(): Promise<MockDocSnap> {
    return new MockDocSnap(this, this.store.read(this.path))
  }
  async set(data: unknown): Promise<void> { this.store.write(this.path, data) }
  async delete(): Promise<void> { this.store.delete(this.path) }
  collection(name: string): MockCollection {
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
        if (!rest.includes('/')) docs.push(new MockDocSnap(new MockDoc(this.store, path.split('/')), value))
      }
    }
    return new MockQuerySnap(docs)
  }
}
class MockStore {
  private readonly data = new Map<string, unknown>()
  read(path: string): unknown { return this.data.get(path) }
  write(path: string, value: unknown): void { this.data.set(path, value) }
  delete(path: string): void { this.data.delete(path) }
  entries(): Array<[string, unknown]> { return [...this.data.entries()] }
  doc(path: string): MockDoc { return new MockDoc(this, path.split('/')) }
  collection(name: string): MockCollection { return new MockCollection(this, [name]) }
}
function createMockFirestore(): { db: Firestore; store: MockStore } {
  const store = new MockStore()
  return { db: store as unknown as Firestore, store }
}

const FAMILY = 'fam-rollback'

describe('instant rollback — config flip', () => {
  it('rollbackStage7 flips the config to rolled_back and resets every writer to legacy', async () => {
    const { db } = createMockFirestore()
    await activateStage7(db, FAMILY, { flags: withAllV4(defaultFeatureFlags()), activatedBy: 'ops' })
    const rolled = await rollbackStage7(db, FAMILY, 'divergent totals', { by: 'ops' })
    expect(rolled.status).toBe('rolled_back')
    expect(rolled.rollbackReason).toBe('divergent totals')
    // Every writer is now legacy again — instant, no redeploy.
    expect(isV4Active(rolled.flags, 'behaviour', FAMILY)).toBe(false)
    expect(isV4Active(rolled.flags, 'reward_redemption', FAMILY)).toBe(false)
    expect(isV4Active(rolled.flags, 'avatar_unlock', FAMILY)).toBe(false)
  })

  it('records an immutable rollback audit event', async () => {
    const { db, store } = createMockFirestore()
    await activateStage7(db, FAMILY)
    await rollbackStage7(db, FAMILY, 'reason-x', { by: 'ops', at: '2026-02-02T00:00:00.000Z' })
    const auditPath = rollbackAuditDocPath(FAMILY, 'rb-2026-02-02T00-00-00-000Z')
    const rec = store.read(auditPath) as { reason: string; previousStatus: string; familyId: string }
    expect(rec).toBeDefined()
    expect(rec.reason).toBe('reason-x')
    expect(rec.previousStatus).toBe('active')
    expect(rec.familyId).toBe(FAMILY)
  })
})

describe('instant rollback — data-level purge', () => {
  it('deletes the V4 ledger, state and marker for the family', async () => {
    const { db, store } = createMockFirestore()
    const base = `${FAMILIES_COLLECTION_ID}/${FAMILY}`
    store.write(`${base}/${EVENTS_V4_COLLECTION_ID}/e1`, { x: 1 })
    store.write(`${base}/${EVENTS_V4_COLLECTION_ID}/e2`, { x: 2 })
    store.write(`${base}/${STATE_V4_COLLECTION_ID}/m1`, { y: 1 })
    store.write(migrationMarkerDocPath(FAMILY), { status: 'MIGRATED' })

    const result = await purgeV4FamilyData(db, FAMILY)
    expect(result.eventsDeleted).toBe(2)
    expect(result.statesDeleted).toBe(1)
    expect(result.markerDeleted).toBe(true)
    expect(store.read(`${base}/${EVENTS_V4_COLLECTION_ID}/e1`)).toBeUndefined()
    expect(store.read(`${base}/${STATE_V4_COLLECTION_ID}/m1`)).toBeUndefined()
    expect(store.read(migrationMarkerDocPath(FAMILY))).toBeUndefined()
  })

  it('recordRollbackEvent appends an audit record without touching config', async () => {
    const { db, store } = createMockFirestore()
    const ev = await recordRollbackEvent(db, FAMILY, { reason: 'r', by: null, at: '2026-03-03T00:00:00.000Z', previousStatus: 'active' })
    expect(ev.familyId).toBe(FAMILY)
    expect(store.read(rollbackAuditDocPath(FAMILY, 'rb-2026-03-03T00-00-00-000Z'))).toBeDefined()
  })
})

describe('instant rollback — emulator guard', () => {
  const saved = process.env.FIRESTORE_EMULATOR_HOST
  afterEach(() => { process.env.FIRESTORE_EMULATOR_HOST = saved })
  it('refuses to roll back outside a local emulator', async () => {
    delete process.env.FIRESTORE_EMULATOR_HOST
    const { db } = createMockFirestore()
    await expect(rollbackStage7(db, FAMILY, 'x')).rejects.toThrow(/FIRESTORE_EMULATOR_HOST/)
    await expect(purgeV4FamilyData(db, FAMILY)).rejects.toThrow(/FIRESTORE_EMULATOR_HOST/)
    await expect(recordRollbackEvent(db, FAMILY, { reason: 'r', by: null, at: '2026-03-03T00:00:00.000Z', previousStatus: 'active' })).rejects.toThrow(/FIRESTORE_EMULATOR_HOST/)
  })
})
