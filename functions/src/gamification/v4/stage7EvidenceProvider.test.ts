/**
 * Task 7.1 — Stage 7 READ-ONLY evidence provider (TDD-first).
 *
 * The provider loads, for ONE family and ONE writer:
 *   Gate 1 — the exact owner-approved replay artifact (gate GATE_1_REACHED),
 *            hash-verified, family present and classified;
 *   Gate 2 — `families/{familyId}/gamification_migration_marker/marker`
 *            (status MIGRATED, walletHashOk, BEFORE == AFTER,
 *             reportHash == Gate 1 hash).
 * Stage 6 verification stays in the existing `verifyPreCutover()` and is NOT
 * duplicated here — the provider only supplies evidence to the verifier.
 *
 * Every invalid/missing artifact must THROW (fail closed) and the provider must
 * perform ZERO writes.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type { Firestore } from 'firebase-admin/firestore'

import {
  createStage7EvidenceProvider,
  hashGate1Report,
  Stage7EvidenceInvalidError,
  type Gate1Artifact,
  type Stage7EvidenceProviderDeps,
  type Stage7MarkerDoc,
} from './stage7EvidenceProvider'

process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080'

const hoisted = vi.hoisted(() => ({ getFirestore: vi.fn() }))
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: hoisted.getFirestore,
  FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
}))

// --- in-memory Firestore double (read/write instrumented) -------------------
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
  collection(name: string): MockCollection { return new MockCollection(this.store, [...this.segments, name]) }
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
  seed(path: string, value: unknown): void { this.data.set(path, value) }
  doc(path: string): MockDoc { return new MockDoc(this, path.split('/')) }
  collection(name: string): MockCollection { return new MockCollection(this, [name]) }
}
function createMockFirestore(): { db: Firestore; store: MockStore } {
  const store = new MockStore()
  return { db: store as unknown as Firestore, store }
}

const FAMILY = 'fam-evidence'
const NOW = Date.parse('2026-03-01T00:00:00.000Z')
const APPROVED_AT_ISO = '2026-02-28T00:00:00.000Z'

function report(over: Record<string, unknown> = {}): Gate1Artifact['report'] {
  return {
    gate: 'GATE_1_REACHED',
    schemaVersion: 4,
    families: [{ familyId: FAMILY, classification: 'exact' }],
    ...over,
  } as Gate1Artifact['report']
}

function artifact(over: Partial<Gate1Artifact> = {}): Gate1Artifact {
  const r = (over.report ?? report()) as Gate1Artifact['report']
  return {
    report: r,
    reportHash: hashGate1Report(r),
    approvedAt: APPROVED_AT_ISO,
    approvedBy: 'owner',
    ...over,
  }
}

function markerDoc(over: Partial<Stage7MarkerDoc> = {}): Stage7MarkerDoc {
  return {
    familyId: FAMILY,
    status: 'MIGRATED',
    walletHashOk: true,
    walletHashBefore: 'wallet-hash',
    walletHashAfter: 'wallet-hash',
    reportHash: hashGate1Report(report()),
    ...over,
  }
}

const markerPath = (familyId: string): string =>
  `families/${familyId}/gamification_migration_marker/marker`

function deps(
  db: Firestore,
  over: Partial<Stage7EvidenceProviderDeps> = {},
): Stage7EvidenceProviderDeps {
  return {
    db,
    writer: 'task_approval',
    loadGate1Artifact: async () => artifact(),
    now: () => NOW,
    ...over,
  }
}

let db: Firestore
let store: MockStore
beforeEach(() => {
  const made = createMockFirestore()
  db = made.db
  store = made.store
  store.seed(markerPath(FAMILY), markerDoc())
  store.writes.length = 0
})

describe('Stage 7 evidence provider — happy path', () => {
  it('1. valid Gate 1 + Gate 2 (Stage 6 delegated) yields verifier-ready evidence', async () => {
    const evidence = await createStage7EvidenceProvider(deps(db))(FAMILY)
    expect(evidence).toMatchObject({
      familyId: FAMILY,
      writer: 'task_approval',
      report: { gate: 'GATE_1_REACHED' },
      approvedAt: Date.parse(APPROVED_AT_ISO),
    })
    expect(evidence.marker).toMatchObject({ familyId: FAMILY, walletHashOk: true })
  })
})

describe('Stage 7 evidence provider — fail closed', () => {
  it('2. missing Gate 1 artifact => blocked', async () => {
    await expect(
      createStage7EvidenceProvider(deps(db, { loadGate1Artifact: async () => null }))(FAMILY),
    ).rejects.toBeInstanceOf(Stage7EvidenceInvalidError)
  })

  it('3. unapproved Gate 1 artifact (gate != GATE_1_REACHED) => blocked', async () => {
    const bad = artifact({ report: report({ gate: 'PENDING' }) })
    await expect(
      createStage7EvidenceProvider(deps(db, { loadGate1Artifact: async () => bad }))(FAMILY),
    ).rejects.toBeInstanceOf(Stage7EvidenceInvalidError)
  })

  it('4. Gate 1 report hash mismatch (tampered artifact) => blocked', async () => {
    const tampered = { ...artifact(), reportHash: 'not-the-hash' }
    await expect(
      createStage7EvidenceProvider(deps(db, { loadGate1Artifact: async () => tampered }))(FAMILY),
    ).rejects.toBeInstanceOf(Stage7EvidenceInvalidError)
  })

  it('5. family absent / unclassified in the Gate 1 report => blocked', async () => {
    const missingFamily = artifact({ report: report({ families: [{ familyId: 'other', classification: 'exact' }] }) })
    const unclassified = artifact({ report: report({ families: [{ familyId: FAMILY }] }) })
    for (const a of [missingFamily, unclassified]) {
      await expect(
        createStage7EvidenceProvider(deps(db, { loadGate1Artifact: async () => a }))(FAMILY),
      ).rejects.toBeInstanceOf(Stage7EvidenceInvalidError)
    }
  })

  it('6. missing Gate 2 marker => blocked', async () => {
    const { db: empty } = createMockFirestore()
    await expect(
      createStage7EvidenceProvider(deps(empty))(FAMILY),
    ).rejects.toBeInstanceOf(Stage7EvidenceInvalidError)
  })

  it('7. marker status not MIGRATED => blocked', async () => {
    store.seed(markerPath(FAMILY), markerDoc({ status: 'PENDING' }))
    await expect(createStage7EvidenceProvider(deps(db))(FAMILY)).rejects.toBeInstanceOf(Stage7EvidenceInvalidError)
  })

  it('8. wallet hash mismatch (BEFORE != AFTER / walletHashOk false) => blocked', async () => {
    store.seed(markerPath(FAMILY), markerDoc({ walletHashAfter: 'other' }))
    await expect(createStage7EvidenceProvider(deps(db))(FAMILY)).rejects.toBeInstanceOf(Stage7EvidenceInvalidError)

    store.seed(markerPath(FAMILY), markerDoc({ walletHashOk: false }))
    await expect(createStage7EvidenceProvider(deps(db))(FAMILY)).rejects.toBeInstanceOf(Stage7EvidenceInvalidError)
  })

  it('9. marker reportHash != Gate 1 hash => blocked', async () => {
    store.seed(markerPath(FAMILY), markerDoc({ reportHash: 'stale-report-hash' }))
    await expect(createStage7EvidenceProvider(deps(db))(FAMILY)).rejects.toBeInstanceOf(Stage7EvidenceInvalidError)
  })

  it('10. wrong family binding (marker familyId mismatch) => blocked', async () => {
    store.seed(markerPath(FAMILY), markerDoc({ familyId: 'someone-else' }))
    await expect(createStage7EvidenceProvider(deps(db))(FAMILY)).rejects.toBeInstanceOf(Stage7EvidenceInvalidError)
  })

  it('11. stale Gate 1 approval => blocked', async () => {
    const stale = artifact({ approvedAt: '2025-01-01T00:00:00.000Z' })
    await expect(
      createStage7EvidenceProvider(deps(db, { loadGate1Artifact: async () => stale }))(FAMILY),
    ).rejects.toBeInstanceOf(Stage7EvidenceInvalidError)
  })

  it('12. non-task_approval writer is refused (writer binding)', async () => {
    await expect(
      createStage7EvidenceProvider(deps(db, { writer: 'behaviour' }))(FAMILY),
    ).rejects.toBeInstanceOf(Stage7EvidenceInvalidError)
  })
})

describe('Stage 7 evidence provider — read-only proof', () => {
  it('13. performs ZERO writes on success', async () => {
    await createStage7EvidenceProvider(deps(db))(FAMILY)
    expect(store.writes).toEqual([])
    expect(store.reads).toContain(markerPath(FAMILY))
  })

  it('14. performs ZERO writes on every blocked path', async () => {
    store.seed(markerPath(FAMILY), markerDoc({ status: 'PENDING' }))
    await expect(createStage7EvidenceProvider(deps(db))(FAMILY)).rejects.toThrow()
    expect(store.writes).toEqual([])
  })
})

describe('Stage 7 evidence provider — hash helper', () => {
  it('15. hashGate1Report is a stable sha256 of the canonical report JSON', () => {
    const r = report()
    expect(hashGate1Report(r)).toBe(createHash('sha256').update(JSON.stringify(r), 'utf8').digest('hex'))
  })
})
