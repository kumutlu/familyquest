/**
 * Task 7.1 — real Stage 7 verifier tests (TDD-first).
 *
 * The verifier is the production replacement for `denyStage7ByDefault`. It is
 * READ-ONLY: it only gathers evidence and delegates the decision to the existing
 * `assertWriterCutoverAllowed()` chain (Gate 1 replay evidence + Task 5.2
 * migration marker/wallet-hash equality + Stage 6 `verifyPreCutover`).
 *
 * Every failing path must THROW, so the calling adapter runs ZERO writers.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'

import {
  createStage7WriterVerifier,
  Stage7EvidenceUnavailableError,
  Stage7EvidenceRefusedError,
  type Stage7ApprovedEvidence,
  type Stage7WriterVerifierDeps,
} from './stage7Verifier'
import {
  Stage7BlockedError,
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

// --- in-memory Firestore mock (mirrors stage7Gate.test.ts) ------------------
class MockDocSnap {
  constructor(public readonly id: string, private readonly value: unknown) {}
  get exists(): boolean { return this.value !== undefined }
  data(): unknown { return this.value }
}
class MockDoc {
  constructor(private readonly store: MockStore, private readonly segments: string[]) {}
  get path(): string { return this.segments.join('/') }
  async get(): Promise<MockDocSnap> {
    this.store.reads.push(this.path)
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
}
class MockStore {
  private readonly data = new Map<string, unknown>()
  readonly reads: string[] = []
  readonly writes: string[] = []
  read(path: string): unknown { return this.data.get(path) }
  write(path: string, value: unknown): void { this.writes.push(path); this.data.set(path, value) }
  entries(): Array<[string, unknown]> { return [...this.data.entries()] }
  doc(path: string): MockDoc { return new MockDoc(this, path.split('/')) }
  collection(name: string): MockCollection { return new MockCollection(this, [name]) }
}
function createMockFirestore(): { db: Firestore; store: MockStore } {
  const store = new MockStore()
  return { db: store as unknown as Firestore, store }
}

const FAMILY = 'fam-verifier'
const NOW = Date.parse('2026-03-01T00:00:00.000Z')

function goodMarker(): Stage7MigrationMarker {
  return { familyId: FAMILY, walletHashBefore: 'h', walletHashAfter: 'h', walletHashOk: true }
}

function evidence(over: Partial<Stage7ApprovedEvidence> = {}): Stage7ApprovedEvidence {
  return {
    familyId: FAMILY,
    writer: 'task_approval',
    report: { gate: 'GATE_1_REACHED' },
    approvedAt: NOW - 60_000,
    ...over,
  }
}

const fakeVerifyPreCutover = vi.fn() as unknown as VerifyPreCutoverFn
const fakeReadMarker = vi.fn() as unknown as ReadMigrationMarkerFn

async function cutoverDb(): Promise<{ db: Firestore; store: MockStore }> {
  const { db, store } = createMockFirestore()
  await activateStage7(db, FAMILY, { flags: withWriterEnabled(defaultFeatureFlags(), 'task_approval') })
  store.writes.length = 0
  store.reads.length = 0
  return { db, store }
}

function deps(db: Firestore, over: Partial<Stage7WriterVerifierDeps> = {}): Stage7WriterVerifierDeps {
  return {
    db,
    writer: 'task_approval',
    evidence: evidence(),
    verifyPreCutoverFn: fakeVerifyPreCutover,
    readMigrationMarkerFn: fakeReadMarker,
    now: () => NOW,
    ...over,
  }
}

beforeEach(() => {
  vi.mocked(fakeVerifyPreCutover).mockReset()
  vi.mocked(fakeReadMarker).mockReset()
  vi.mocked(fakeVerifyPreCutover).mockResolvedValue({ passed: true, checks: [] })
  vi.mocked(fakeReadMarker).mockResolvedValue(goodMarker())
})

describe('Stage 7 verifier — all gates green', () => {
  it('1. allows the task_approval V4 route when Gate 1 + Gate 2 + Stage 6 are green', async () => {
    const { db } = await cutoverDb()
    await expect(createStage7WriterVerifier(deps(db))(FAMILY)).resolves.toBeUndefined()
  })
})

describe('Stage 7 verifier — fail closed on every gate', () => {
  it('2. Gate 1 evidence missing/not approved => blocked', async () => {
    const { db } = await cutoverDb()
    await expect(
      createStage7WriterVerifier(deps(db, { evidence: evidence({ report: { gate: 'PENDING' } }) }))(FAMILY),
    ).rejects.toBeInstanceOf(Stage7BlockedError)

    await expect(
      createStage7WriterVerifier(deps(db, { evidence: null }))(FAMILY),
    ).rejects.toBeInstanceOf(Stage7EvidenceUnavailableError)
  })

  it('3. Gate 2 migration marker missing/invalid => blocked', async () => {
    const { db } = await cutoverDb()
    vi.mocked(fakeReadMarker).mockResolvedValue(null)
    await expect(createStage7WriterVerifier(deps(db))(FAMILY)).rejects.toBeInstanceOf(Stage7BlockedError)
  })

  it('4. wallet hash mismatch => blocked', async () => {
    const { db } = await cutoverDb()
    vi.mocked(fakeReadMarker).mockResolvedValue({ ...goodMarker(), walletHashAfter: 'x', walletHashOk: false })
    await expect(createStage7WriterVerifier(deps(db))(FAMILY)).rejects.toBeInstanceOf(Stage7BlockedError)
  })

  it('5. Stage 6 verifyPreCutover failure => blocked', async () => {
    const { db } = await cutoverDb()
    vi.mocked(fakeVerifyPreCutover).mockResolvedValue({
      passed: false,
      checks: [{ name: 'ledger_totals', passed: false, detail: 'divergent' }],
    })
    await expect(createStage7WriterVerifier(deps(db))(FAMILY)).rejects.toBeInstanceOf(Stage7BlockedError)
  })

  it('5b. Stage 6 verification not provisioned => blocked', async () => {
    const { db } = await cutoverDb()
    const d = deps(db)
    const without: Stage7WriterVerifierDeps = {
      db: d.db, writer: d.writer, evidence: d.evidence,
      readMigrationMarkerFn: d.readMigrationMarkerFn, now: d.now,
    }
    await expect(createStage7WriterVerifier(without)(FAMILY)).rejects.toBeInstanceOf(Stage7BlockedError)
  })

  it('6. stale gate evidence => blocked', async () => {
    const { db } = await cutoverDb()
    const stale = evidence({ approvedAt: NOW - 40 * 24 * 60 * 60 * 1000 })
    await expect(
      createStage7WriterVerifier(deps(db, { evidence: stale }))(FAMILY),
    ).rejects.toBeInstanceOf(Stage7EvidenceRefusedError)
  })

  it('7a. wrong family evidence => blocked', async () => {
    const { db } = await cutoverDb()
    await expect(
      createStage7WriterVerifier(deps(db))('some-other-family'),
    ).rejects.toBeInstanceOf(Stage7EvidenceRefusedError)
  })

  it('7b. wrong writer evidence => blocked', async () => {
    const { db } = await cutoverDb()
    await expect(
      createStage7WriterVerifier(deps(db, { evidence: evidence({ writer: 'behaviour' }) }))(FAMILY),
    ).rejects.toBeInstanceOf(Stage7EvidenceRefusedError)
  })

  it('8. default (no cutover config written) remains legacy => blocked', async () => {
    const { db } = createMockFirestore()
    await expect(createStage7WriterVerifier(deps(db))(FAMILY)).rejects.toBeInstanceOf(Stage7BlockedError)
  })

  it('10. after rollback the writer flag is off => blocked (legacy restored)', async () => {
    const { db } = await cutoverDb()
    const { rollbackStage7 } = await import('./rollback')
    await rollbackStage7(db, FAMILY, 'divergent totals', { by: 'ops' })
    await expect(createStage7WriterVerifier(deps(db))(FAMILY)).rejects.toBeInstanceOf(Stage7BlockedError)
  })
})

describe('Stage 7 verifier — read-only', () => {
  it('9. performs reads only: no Firestore write occurs during verification', async () => {
    const { db, store } = await cutoverDb()
    await createStage7WriterVerifier(deps(db))(FAMILY)
    expect(store.writes).toEqual([])
    expect(store.reads.length).toBeGreaterThan(0)
  })

  it('9b. no write occurs on a blocked verification either', async () => {
    const { db, store } = await cutoverDb()
    vi.mocked(fakeVerifyPreCutover).mockResolvedValue({ passed: false, checks: [] })
    await expect(createStage7WriterVerifier(deps(db))(FAMILY)).rejects.toBeInstanceOf(Stage7BlockedError)
    expect(store.writes).toEqual([])
  })
})

describe('Stage 7 verifier — evidence provider wiring (Task 7.1)', () => {
  it('11. uses the injected READ-ONLY provider when no static evidence is supplied', async () => {
    const { db, store } = await cutoverDb()
    const loadEvidence = vi.fn(async () => evidence())
    await expect(
      createStage7WriterVerifier(deps(db, { evidence: null, loadEvidence }))(FAMILY),
    ).resolves.toBeUndefined()
    expect(loadEvidence).toHaveBeenCalledWith(FAMILY)
    expect(store.writes).toEqual([])
  })

  it('12. a provider that yields no evidence fails closed', async () => {
    const { db } = await cutoverDb()
    await expect(
      createStage7WriterVerifier(deps(db, { evidence: null, loadEvidence: async () => null }))(FAMILY),
    ).rejects.toBeInstanceOf(Stage7EvidenceUnavailableError)
  })

  it('13. a provider that throws (invalid artifact) propagates => zero writers', async () => {
    const { db, store } = await cutoverDb()
    const loadEvidence = async (): Promise<Stage7ApprovedEvidence> => {
      throw new Error('Stage 7 evidence invalid: marker reportHash mismatch')
    }
    await expect(
      createStage7WriterVerifier(deps(db, { evidence: null, loadEvidence }))(FAMILY),
    ).rejects.toThrow(/evidence invalid/i)
    expect(store.writes).toEqual([])
  })
})
