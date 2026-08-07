/**
 * Gamification V4 — Task 5.2 idempotent migration marker + wallet hash equality.
 *
 * TDD-first. The marker proves GATE 2:
 *   - one idempotent marker doc per family (rerun overwrites, never duplicates),
 *   - wallet document hashes are byte-identical BEFORE == AFTER the migration
 *     (fail closed on any diff; wallet VALUES never enter gamification),
 *   - a full migration rerun is a no-op (identical ledger + state).
 *
 * Unit tests use an in-memory Firestore double (no emulator, no credentials).
 * Integration tests drive the SAME functions against a REAL Firestore emulator
 * and are skipped automatically when FIRESTORE_EMULATOR_HOST is unset at module
 * load (so the unit-test guard can still be satisfied without a live emulator).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import { deleteApp, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createRequire } from 'node:module'

import { writeMigrationLedger } from './write-v4-ledger'
import {
  migrationMarkerDocPath,
  writeMigrationMarker,
  verifyWalletHashesBeforeAfter,
  rerunIsNoOp,
  hashReport,
  WalletHashMismatchError,
  type WalletSnapshotManifest,
} from './migration-marker'

const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const walletSnap: any = require('../wallet-snapshot.cjs')

// `emulatorAvailable` is evaluated once at module load. The unit tests set
// FIRESTORE_EMULATOR_HOST inside a beforeAll (below) so the repository's
// emulator-only guard passes WITHOUT a live emulator; the real-emulator block
// only runs when the variable is present in the SHELL (a genuine emulator).
const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const describeEmulator = emulatorAvailable ? describe : describe.skip

// --- in-memory Firestore mock (no emulator, no credentials) -----------------
class MockFirestore {
  private readonly data = new Map<string, unknown>()
  collection(path: string): MockCollection { return new MockCollection(this, path) }
  doc(path: string): MockDoc { return new MockDoc(this, path) }
  async runTransaction<T>(fn: (tx: MockTx) => Promise<T>): Promise<T> {
    const tx = new MockTx(this)
    const result = await fn(tx)
    tx.commit()
    return result
  }
  _get(path: string): unknown { return this.data.get(path) }
  _set(path: string, value: unknown): void { this.data.set(path, value) }
  _entries(): Array<[string, unknown]> { return [...this.data.entries()] }
}
class MockCollection {
  constructor(private readonly fs: MockFirestore, private readonly path: string) {}
  doc(id: string): MockDoc { return new MockDoc(this.fs, `${this.path}/${id}`) }
  async get(): Promise<{ docs: Array<{ id: string; exists: boolean; data: () => unknown }> }> {
    const prefix = this.path + '/'
    const docs: Array<{ id: string; exists: boolean; data: () => unknown }> = []
    for (const [p, v] of this.fs._entries()) {
      if (p.startsWith(prefix)) {
        const rest = p.slice(prefix.length)
        if (!rest.includes('/')) docs.push({ id: rest, exists: true, data: () => v })
      }
    }
    return { docs }
  }
}
class MockDoc {
  constructor(private readonly fs: MockFirestore, public readonly path: string) {}
  collection(name: string): MockCollection { return new MockCollection(this.fs, `${this.path}/${name}`) }
  async get(): Promise<{ exists: boolean; id: string; data: () => unknown }> {
    const v = this.fs._get(this.path)
    return { exists: v !== undefined, id: this.path.split('/').pop() as string, data: () => v }
  }
  async set(data: unknown): Promise<void> { this.fs._set(this.path, data) }
}
class MockTx {
  private readonly writes: Array<{ path: string; data: unknown }> = []
  constructor(private readonly fs: MockFirestore) {}
  set(ref: MockDoc, data: unknown): void { this.writes.push({ path: ref.path, data }) }
  commit(): void { for (const w of this.writes) this.fs._set(w.path, w.data) }
}
function createMockFirestore(): { db: Firestore; fs: MockFirestore } {
  const fs = new MockFirestore()
  return { db: fs as unknown as Firestore, fs }
}

// --- report builders (mirror Task 5.1) --------------------------------------
function memberReport(rewardPoints: number, xpTotal: number) {
  return {
    memberId: 'mem-1',
    replayed: {
      rewardPoints,
      xpTotal,
      level: 1,
      xpProgressInLevel: xpTotal,
      xpToNextLevel: 1000,
      levelProgressPercentage: 0,
      currentStreak: 0,
      bestStreak: 0,
      lastQualifiedDayKey: null,
      unlockedAchievementIds: [],
      unlockedAvatarIds: [],
      projectionVersion: 1,
      foldedThroughEventId: null,
      updatedAt: '1970-01-01T00:00:00.000Z',
    },
  }
}
function makeReport(families: Array<{ familyId: string; members: Record<string, ReturnType<typeof memberReport>> }>) {
  const counts = { exact: families.length, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 }
  return {
    generatedAt: '1970-01-01T00:00:00.000Z',
    schemaVersion: 4,
    gate: 'GATE_1_REACHED' as const,
    totalFamilies: families.length,
    totalSources: families.length,
    totalEventsBuilt: families.length,
    counts,
    families: families.map((f) => ({
      familyId: f.familyId,
      totalSources: 1,
      counts,
      eventsBuilt: 1,
      members: f.members,
      displayedProvided: false,
    })),
    walletSnapshot: null,
  }
}

const FAMILY_A = 'fam-A'
const FIXED_TS = '1970-01-01T00:00:00.000Z'

// Seed a family + a couple of protected wallet documents into the mock so the
// wallet-snapshot collector has something to hash.
function seedWalletDocs(fs: MockFirestore): void {
  fs._set('families/fam-A', { name: 'A' })
  fs._set('families/fam-A/wallets/w1', { balance: 100, currency: 'GBP' })
  fs._set('families/fam-A/wallet_transactions/t1', { amount: 50 })
  fs._set('users/u1', { walletBalance: 200, lastTransferTxId: 'x' })
}

// Build a Stage 0.4 baseline manifest from the CURRENT mock state.
async function buildBaseline(db: Firestore): Promise<WalletSnapshotManifest> {
  const ro = new walletSnap.ReadOnlyFirestore(db)
  const entries = await walletSnap.collectEntries(ro)
  return walletSnap.buildManifest(entries, { projectId: null })
}

describe('Task 5.2 — migration marker (in-memory Firestore)', () => {
  beforeAll(() => {
    // Satisfy the repository's emulator-only guard without a live emulator.
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080'
  })

  it('writes one idempotent marker doc per family (rerun overwrites)', async () => {
    const { db, fs } = createMockFirestore()
    seedWalletDocs(fs)
    const baseline = await buildBaseline(db)
    const report = makeReport([{ familyId: FAMILY_A, members: { 'mem-1': memberReport(521, 546) } }])
    await writeMigrationLedger(report, db)
    const reportHash = hashReport(report)

    const opts = {
      db,
      walletBaseline: baseline,
      eventsWritten: 1,
      statesWritten: 1,
      migratedAt: FIXED_TS,
    }
    const m1 = await writeMigrationMarker(FAMILY_A, reportHash, opts)
    const m2 = await writeMigrationMarker(FAMILY_A, reportHash, opts)

    // Fixed doc id => exactly one marker document, identical on rerun.
    expect(m1.familyId).toBe(FAMILY_A)
    expect(m1.status).toBe('MIGRATED')
    expect(m1.idempotent).toBe(true)
    expect(m1.walletHashOk).toBe(true)
    expect(m2).toEqual(m1)

    const snap = await db.doc(migrationMarkerDocPath(FAMILY_A)).get()
    expect(snap.exists).toBe(true)
  })

  it('verifyWalletHashesBeforeAfter returns ok when wallet unchanged', async () => {
    const { db, fs } = createMockFirestore()
    seedWalletDocs(fs)
    const baseline = await buildBaseline(db)

    const result = await verifyWalletHashesBeforeAfter(db, baseline)
    expect(result.ok).toBe(true)
    expect(result.globalSha256Before).toBe(baseline.globalSha256)
    expect(result.globalSha256After).toBe(baseline.globalSha256)
  })

  it('verifyWalletHashesBeforeAfter FAILS CLOSED on any wallet diff', async () => {
    const { db, fs } = createMockFirestore()
    seedWalletDocs(fs)
    const baseline = await buildBaseline(db)

    // Mutate a protected wallet document AFTER the baseline was captured.
    fs._set('families/fam-A/wallets/w1', { balance: 999, currency: 'GBP' })

    await expect(verifyWalletHashesBeforeAfter(db, baseline)).rejects.toBeInstanceOf(WalletHashMismatchError)
  })

  it('writeMigrationMarker FAILS CLOSED when wallet hashes diverge', async () => {
    const { db, fs } = createMockFirestore()
    seedWalletDocs(fs)
    const baseline = await buildBaseline(db)
    const report = makeReport([{ familyId: FAMILY_A, members: { 'mem-1': memberReport(521, 546) } }])
    await writeMigrationLedger(report, db)
    const reportHash = hashReport(report)

    // Diverge wallet data before writing the marker.
    fs._set('families/fam-A/wallet_transactions/t1', { amount: 12345 })

    await expect(
      writeMigrationMarker(FAMILY_A, reportHash, {
        db,
        walletBaseline: baseline,
        eventsWritten: 1,
        statesWritten: 1,
        migratedAt: FIXED_TS,
      }),
    ).rejects.toBeInstanceOf(WalletHashMismatchError)

    // No marker document must exist after a closed failure.
    const snap = await db.doc(migrationMarkerDocPath(FAMILY_A)).get()
    expect(snap.exists).toBe(false)
  })

  it('rerunIsNoOp proves a full migration rerun is identical (no-op)', async () => {
    const { db, fs } = createMockFirestore()
    seedWalletDocs(fs)
    const report = makeReport([{ familyId: FAMILY_A, members: { 'mem-1': memberReport(521, 546) } }])
    await writeMigrationLedger(report, db)

    const result = await rerunIsNoOp(report, db)
    expect(result.ok).toBe(true)
    expect(result.ledgerHashBefore).toBe(result.ledgerHashAfter)
  })

  it('marker embeds wallet BEFORE/AFTER hashes and ok flag', async () => {
    const { db, fs } = createMockFirestore()
    seedWalletDocs(fs)
    const baseline = await buildBaseline(db)
    const report = makeReport([{ familyId: FAMILY_A, members: { 'mem-1': memberReport(521, 546) } }])
    await writeMigrationLedger(report, db)
    const reportHash = hashReport(report)

    const marker = await writeMigrationMarker(FAMILY_A, reportHash, {
      db,
      walletBaseline: baseline,
      eventsWritten: 1,
      statesWritten: 1,
      migratedAt: FIXED_TS,
    })
    expect(marker.walletHashBefore).toBe(baseline.globalSha256)
    expect(marker.walletHashAfter).toBe(baseline.globalSha256)
    expect(marker.walletHashOk).toBe(true)
    expect(marker.reportHash).toBe(reportHash)
  })
})

describeEmulator('Task 5.2 — migration marker (real Firestore emulator)', () => {
  let app: App
  let db: Firestore

  beforeAll(async () => {
    app = initializeApp({ projectId: 'familyquest-beta-402cb' }, 'v4-migration-marker-integration')
    db = getFirestore(app)
  })
  afterAll(async () => {
    if (app) await deleteApp(app)
  })

  it('seeds wallet, migrates, verifies wallet equality, writes marker, rerun no-op', async () => {
    // Seed a protected wallet document (never touched by gamification).
    await db.doc('families/fam-A/wallets/w1').set({ balance: 100, currency: 'GBP' })
    await db.doc('users/u1').set({ walletBalance: 200, lastTransferTxId: 'x' })

    const baseline = await buildBaseline(db)
    const report = makeReport([{ familyId: FAMILY_A, members: { 'mem-1': memberReport(521, 546) } }])
    const ledgerResult = await writeMigrationLedger(report, db)
    const reportHash = hashReport(report)

    const verification = await verifyWalletHashesBeforeAfter(db, baseline)
    expect(verification.ok).toBe(true)

    const marker = await writeMigrationMarker(FAMILY_A, reportHash, {
      db,
      walletBaseline: baseline,
      eventsWritten: ledgerResult.eventsWritten,
      statesWritten: ledgerResult.statesWritten,
      migratedAt: FIXED_TS,
    })
    expect(marker.walletHashOk).toBe(true)

    const rerun = await rerunIsNoOp(report, db)
    expect(rerun.ok).toBe(true)

    const snap = await db.doc(migrationMarkerDocPath(FAMILY_A)).get()
    expect(snap.exists).toBe(true)
  }, 30000)
})
