/**
 * Gamification V4 — runtime cutover configuration layer tests (TDD-first).
 *
 * Unit tests use an in-memory Firestore double (no emulator, no wallet access,
 * no production credentials). The emulator-only guard is proven by toggling
 * FIRESTORE_EMULATOR_HOST. Mirrors the mock in repository.test.ts.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'

import {
  activateCutover,
  activateStage7,
  cutoverConfigDocPath,
  defaultCutoverConfig,
  isCutoverActive,
  readCutoverConfig,
  rollbackCutover,
  setWriterFlag,
  writeCutoverConfig,
} from './cutoverConfig'
import { isV4Active } from '../../../../src/domain/gamification/v4/featureFlags'

// All logic tests run with a local emulator host so the guard passes.
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080'

const hoisted = vi.hoisted(() => ({ getFirestore: vi.fn() }))
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: hoisted.getFirestore,
  FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
}))

// --- in-memory Firestore mock ------------------------------------------------
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

const FAMILY = 'fam-cutover'

describe('cutover config — pure transitions', () => {
  it('default is not_started and all-legacy (fail closed)', () => {
    const c = defaultCutoverConfig(FAMILY)
    expect(c.status).toBe('not_started')
    expect(isCutoverActive(c)).toBe(false)
    expect(isV4Active(c.flags, 'behaviour', FAMILY)).toBe(false)
  })

  it('activateCutover arms every writer and records activation', () => {
    const c = activateCutover(defaultCutoverConfig(FAMILY), { activatedBy: 'ops', at: '2026-01-01T00:00:00.000Z' })
    expect(c.status).toBe('active')
    expect(isCutoverActive(c)).toBe(true)
    expect(isV4Active(c.flags, 'reward_redemption', FAMILY)).toBe(true)
    expect(c.activatedBy).toBe('ops')
    expect(c.activatedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('rollbackCutover disarms every writer and records the reason', () => {
    const active = activateCutover(defaultCutoverConfig(FAMILY))
    const rolled = rollbackCutover(active, { reason: 'divergent totals', by: 'ops', at: '2026-01-02T00:00:00.000Z' })
    expect(rolled.status).toBe('rolled_back')
    expect(isCutoverActive(rolled)).toBe(false)
    expect(isV4Active(rolled.flags, 'behaviour', FAMILY)).toBe(false)
    expect(rolled.rollbackReason).toBe('divergent totals')
    expect(rolled.rolledBackBy).toBe('ops')
  })
})

describe('cutover config — Firestore adapter (emulator only)', () => {
  it('readCutoverConfig returns fail-closed default when doc absent', async () => {
    const { db } = createMockFirestore()
    const c = await readCutoverConfig(db, FAMILY)
    expect(c.status).toBe('not_started')
    expect(isV4Active(c.flags, 'avatar_unlock', FAMILY)).toBe(false)
  })

  it('activateStage7 persists an active config that readCutoverConfig returns', async () => {
    const { db } = createMockFirestore()
    const activated = await activateStage7(db, FAMILY, { activatedBy: 'ops' })
    expect(activated.status).toBe('active')
    const reread = await readCutoverConfig(db, FAMILY)
    expect(reread.status).toBe('active')
    expect(isV4Active(reread.flags, 'task_approval', FAMILY)).toBe(true)
  })

  it('setWriterFlag flips a single writer at runtime (GATE 3 granularity)', async () => {
    const { db } = createMockFirestore()
    await activateStage7(db, FAMILY)
    const updated = await setWriterFlag(db, FAMILY, 'reward_redemption', false)
    expect(isV4Active(updated.flags, 'reward_redemption', FAMILY)).toBe(false)
    expect(isV4Active(updated.flags, 'behaviour', FAMILY)).toBe(true) // others stay v4
    const reread = await readCutoverConfig(db, FAMILY)
    expect(isV4Active(reread.flags, 'reward_redemption', FAMILY)).toBe(false)
  })

  it('writeCutoverConfig then readCutoverConfig round-trips the document path', async () => {
    const { db } = createMockFirestore()
    const cfg = activateCutover(defaultCutoverConfig(FAMILY), { activatedBy: 'ops' })
    await writeCutoverConfig(db, FAMILY, cfg)
    expect(cutoverConfigDocPath(FAMILY)).toBe(`families/${FAMILY}/gamification_cutover_config/config`)
    const reread = await readCutoverConfig(db, FAMILY)
    expect(reread.activatedBy).toBe('ops')
  })
})

describe('cutover config — emulator guard', () => {
  const saved = process.env.FIRESTORE_EMULATOR_HOST
  afterEach(() => {
    process.env.FIRESTORE_EMULATOR_HOST = saved
  })

  it('refuses to read/write outside a local emulator', async () => {
    delete process.env.FIRESTORE_EMULATOR_HOST
    const { db } = createMockFirestore()
    await expect(readCutoverConfig(db, FAMILY)).rejects.toThrow(/FIRESTORE_EMULATOR_HOST/)
    await expect(writeCutoverConfig(db, FAMILY, defaultCutoverConfig(FAMILY))).rejects.toThrow(/FIRESTORE_EMULATOR_HOST/)
    await expect(activateStage7(db, FAMILY)).rejects.toThrow(/FIRESTORE_EMULATOR_HOST/)
    await expect(setWriterFlag(db, FAMILY, 'behaviour', true)).rejects.toThrow(/FIRESTORE_EMULATOR_HOST/)
  })
})
