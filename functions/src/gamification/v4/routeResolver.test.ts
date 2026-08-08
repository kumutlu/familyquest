/**
 * Gamification V4 — cutover-aware route resolver tests (TDD-first).
 *
 * Proves the hard requirements for the routing layer:
 *   - default remains LEGACY (fail closed) when the family is not cut over;
 *   - `assertStage7Allowed()` is MANDATORY before any route resolves to V4;
 *   - the V4 route FAILS CLOSED (throws Stage7BlockedError) when Gate 1/2/6
 *     evidence is invalid;
 *   - rollback flips every route back to legacy;
 *   - the emulator-only guard holds.
 *
 * Uses the same in-memory Firestore double as the sibling V4 tests; the
 * emulator-only guard is satisfied by setting FIRESTORE_EMULATOR_HOST.
 */

process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080'

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'

import { resolveStage7WriterRoute } from './routeResolver'
import { activateStage7 } from './cutoverConfig'
import { rollbackStage7 } from './rollback'
import {
  assertStage7Allowed,
  Stage7BlockedError,
  type Stage7GateDeps,
  type VerifyPreCutoverFn,
  type ReadMigrationMarkerFn,
  type Stage7MigrationMarker,
} from './stage7Gate'
import {
  defaultFeatureFlags,
  withWriterEnabled,
  withAllV4,
} from '../../../../src/domain/gamification/v4/featureFlags'

// --- in-memory Firestore mock (mirrors stage7Gate.test.ts) ------------------
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

const FAMILY = 'fam-route'
const ALL_WRITERS = ['task_approval', 'task_invalidation', 'day_finalization', 'behaviour', 'reward_redemption', 'challenge_claim', 'avatar_unlock'] as const

function approvedReport(): { gate: string } {
  return { gate: 'GATE_1_REACHED' }
}
function goodMarker(): Stage7MigrationMarker {
  return { familyId: FAMILY, walletHashBefore: 'h', walletHashAfter: 'h', walletHashOk: true }
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

afterEach(() => {
  vi.mocked(fakeVerifyPreCutover).mockReset()
  vi.mocked(fakeReadMarker).mockReset()
  vi.mocked(fakeVerifyPreCutover).mockResolvedValue({ passed: true, checks: [] })
  vi.mocked(fakeReadMarker).mockResolvedValue(goodMarker())
  vi.restoreAllMocks()
})

describe('route resolver — default is legacy (fail closed)', () => {
  it('returns legacy for every writer when the family is not cut over', async () => {
    const d = deps()
    for (const writer of ALL_WRITERS) {
      expect(await resolveStage7WriterRoute(d, writer, FAMILY)).toBe('legacy')
    }
  })

  it('does NOT call assertStage7Allowed for a legacy route', async () => {
    const realSpy = vi.spyOn(await import('./stage7Gate'), 'assertStage7Allowed')
    await resolveStage7WriterRoute(deps(), 'behaviour', FAMILY)
    expect(realSpy).not.toHaveBeenCalled()
  })
})

describe('route resolver — mandatory gate before V4', () => {
  it('calls assertStage7Allowed and returns v4 when active + flag enabled + gates green', async () => {
    const { db } = createMockFirestore()
    await activateStage7(db, FAMILY, { flags: withWriterEnabled(defaultFeatureFlags(), 'behaviour') })
    const realSpy = vi.spyOn(await import('./stage7Gate'), 'assertStage7Allowed')
    const route = await resolveStage7WriterRoute(deps({ db }), 'behaviour', FAMILY)
    expect(route).toBe('v4')
    expect(realSpy).toHaveBeenCalledTimes(1)
  })

  it('FAILS CLOSED (throws Stage7BlockedError) when Stage 6 verifyPreCutover fails', async () => {
    const { db } = createMockFirestore()
    await activateStage7(db, FAMILY, { flags: withWriterEnabled(defaultFeatureFlags(), 'behaviour') })
    vi.mocked(fakeVerifyPreCutover).mockResolvedValue({ passed: false, checks: [{ name: 'six_check', passed: false }] })
    await expect(resolveStage7WriterRoute(deps({ db }), 'behaviour', FAMILY)).rejects.toBeInstanceOf(Stage7BlockedError)
  })

  it('FAILS CLOSED when Gate 2 marker is invalid', async () => {
    const { db } = createMockFirestore()
    await activateStage7(db, FAMILY, { flags: withWriterEnabled(defaultFeatureFlags(), 'behaviour') })
    vi.mocked(fakeReadMarker).mockResolvedValue({ ...goodMarker(), walletHashOk: false })
    await expect(resolveStage7WriterRoute(deps({ db }), 'behaviour', FAMILY)).rejects.toBeInstanceOf(Stage7BlockedError)
  })

  it('returns legacy for a writer whose flag is disabled even when gates are green', async () => {
    const { db } = createMockFirestore()
    await activateStage7(db, FAMILY, { flags: withWriterEnabled(defaultFeatureFlags(), 'behaviour') })
    expect(await resolveStage7WriterRoute(deps({ db }), 'reward_redemption', FAMILY)).toBe('legacy')
  })
})

describe('route resolver — rollback returns all routes to legacy', () => {
  it('after rollbackStage7 every writer resolves to legacy', async () => {
    const { db } = createMockFirestore()
    await activateStage7(db, FAMILY, { flags: withAllV4() })
    expect(await resolveStage7WriterRoute(deps({ db }), 'behaviour', FAMILY)).toBe('v4')
    await rollbackStage7(db, FAMILY, 'divergent totals', { by: 'ops' })
    for (const writer of ALL_WRITERS) {
      expect(await resolveStage7WriterRoute(deps({ db }), writer, FAMILY)).toBe('legacy')
    }
  })
})

describe('route resolver — emulator-only guard', () => {
  const saved = process.env.FIRESTORE_EMULATOR_HOST
  afterEach(() => { process.env.FIRESTORE_EMULATOR_HOST = saved })
  it('refuses to resolve outside a local emulator', async () => {
    delete process.env.FIRESTORE_EMULATOR_HOST
    await expect(resolveStage7WriterRoute(deps(), 'behaviour', FAMILY)).rejects.toThrow(/FIRESTORE_EMULATOR_HOST/)
  })
})
