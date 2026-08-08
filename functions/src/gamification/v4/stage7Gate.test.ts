/**
 * Gamification V4 — mandatory Stage 7 gate tests (TDD-first).
 *
 * Unit tests use an in-memory Firestore double. `verifyPreCutover` (Stage 6) and
 * the Task 5.2 marker reader are INJECTED (matching the production contract
 * where the caller supplies the real functions) so the gate's orchestration +
 * fail-closed throwing is exercised deterministically without pulling the
 * tsx-only scripts/ tree into the functions build. The emulator-only guard is
 * proven by toggling FIRESTORE_EMULATOR_HOST.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'

import {
  assertStage7Allowed,
  assertWriterCutoverAllowed,
  checkStage7Allowed,
  Stage7BlockedError,
  type Stage7GateDeps,
  type VerifyPreCutoverFn,
  type ReadMigrationMarkerFn,
  type Stage7MigrationMarker,
} from './stage7Gate'
import { activateStage7 } from './cutoverConfig'
import { defaultFeatureFlags, withWriterEnabled } from '../../../../src/domain/gamification/v4/featureFlags'

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

const FAMILY = 'fam-gate'

function approvedReport(): { gate: string } {
  return { gate: 'GATE_1_REACHED' }
}

function goodMarker(): Stage7MigrationMarker {
  return {
    familyId: FAMILY,
    walletHashBefore: 'h',
    walletHashAfter: 'h',
    walletHashOk: true,
  }
}

const fakeVerifyPreCutover = vi.fn() as unknown as VerifyPreCutoverFn
const fakeReadMarker = vi.fn() as unknown as ReadMigrationMarkerFn

function deps(over: Partial<Stage7GateDeps> = {}): Stage7GateDeps {
  return {
    db: createMockFirestore().db,
    report: approvedReport(),
    familyId: FAMILY,
    verifyPreCutoverFn: fakeVerifyPreCutover,
    readMigrationMarkerFn: fakeReadMarker,
    ...over,
  }
}

beforeEach(() => {
  vi.mocked(fakeVerifyPreCutover).mockReset()
  vi.mocked(fakeReadMarker).mockReset()
  vi.mocked(fakeVerifyPreCutover).mockResolvedValue({ passed: true, checks: [] })
  vi.mocked(fakeReadMarker).mockResolvedValue(goodMarker())
})

describe('Stage 7 gate — mandatory (not advisory)', () => {
  it('allows when Gate 1, Gate 2 and Stage 6 are all green', async () => {
    const r = await assertStage7Allowed(deps())
    expect(r.ready).toBe(true)
    expect(r.failedGates).toEqual([])
  })

  it('checkStage7Allowed returns a verdict without throwing on failure', async () => {
    vi.mocked(fakeVerifyPreCutover).mockResolvedValue({ passed: false, checks: [] })
    const r = await checkStage7Allowed(deps())
    expect(r.ready).toBe(false)
    expect(r.failedGates).toContain('stage6')
  })

  it('BLOCKS when Gate 1 replay report is not approved', async () => {
    const badReport = { gate: 'PENDING' }
    await expect(assertStage7Allowed(deps({ report: badReport }))).rejects.toBeInstanceOf(Stage7BlockedError)
    const r = await checkStage7Allowed(deps({ report: badReport }))
    expect(r.ready).toBe(false)
    expect(r.failedGates).toContain('gate1')
  })

  it('BLOCKS when Gate 2 migration marker / wallet hash fails', async () => {
    vi.mocked(fakeReadMarker).mockResolvedValue({ ...goodMarker(), walletHashOk: false })
    const r = await checkStage7Allowed(deps())
    expect(r.ready).toBe(false)
    expect(r.failedGates).toContain('gate2')
    await expect(assertStage7Allowed(deps())).rejects.toBeInstanceOf(Stage7BlockedError)
  })

  it('BLOCKS when Stage 6 verifyPreCutover fails (the previously-advisory gate)', async () => {
    vi.mocked(fakeVerifyPreCutover).mockResolvedValue({ passed: false, checks: [] })
    const r = await checkStage7Allowed(deps())
    expect(r.ready).toBe(false)
    expect(r.failedGates).toContain('stage6')
    await expect(assertStage7Allowed(deps())).rejects.toBeInstanceOf(Stage7BlockedError)
  })

  it('BLOCKS when the migration marker is entirely absent (Gate 2)', async () => {
    vi.mocked(fakeReadMarker).mockResolvedValue(null)
    const r = await checkStage7Allowed(deps())
    expect(r.failedGates).toContain('gate2')
  })
})

describe('Stage 7 gate — per-writer kill switch (GATE 3 granularity)', () => {
  it('allows a writer only when the family is active AND its flag is enabled', async () => {
    const { db } = createMockFirestore()
    await activateStage7(db, FAMILY, { flags: withWriterEnabled(defaultFeatureFlags(), 'behaviour') })
    const r = await assertWriterCutoverAllowed(deps({ db }), 'behaviour')
    expect(r.ready).toBe(true)
  })

  it('refuses a writer whose flag is disabled even when all gates are green', async () => {
    const { db } = createMockFirestore()
    await activateStage7(db, FAMILY, { flags: withWriterEnabled(defaultFeatureFlags(), 'behaviour') })
    await expect(assertWriterCutoverAllowed(deps({ db }), 'reward_redemption')).rejects.toBeInstanceOf(Stage7BlockedError)
  })

  it('refuses any writer when the family cutover is not active', async () => {
    const { db } = createMockFirestore() // no active config written
    await expect(assertWriterCutoverAllowed(deps({ db }), 'behaviour')).rejects.toBeInstanceOf(Stage7BlockedError)
  })
})

describe('Stage 7 gate — emulator guard', () => {
  const saved = process.env.FIRESTORE_EMULATOR_HOST
  afterEach(() => { process.env.FIRESTORE_EMULATOR_HOST = saved })
  it('refuses to evaluate outside a local emulator', async () => {
    delete process.env.FIRESTORE_EMULATOR_HOST
    await expect(assertStage7Allowed(deps())).rejects.toThrow(/FIRESTORE_EMULATOR_HOST/)
    await expect(checkStage7Allowed(deps())).rejects.toThrow(/FIRESTORE_EMULATOR_HOST/)
  })
})
