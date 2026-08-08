/**
 * Gamification V4 — Gap 3: PARTIAL MIGRATION FAILURE recovery proof.
 *
 * Proves the production migration ordering in `runFamilyMigration` is safe when
 * wallet AFTER verification fails AFTER V4 ledger/state have already been
 * written:
 *
 *   1. V4 events/state CAN exist before the marker is written (partial state).
 *   2. On verification failure the run throws and
 *      leaves the Gate 2 marker ABSENT — so Gate 2 stays closed and the family
 *      remains legacy. No `purgeV4FamilyData` (emulator-only) is required.
 *   3. A rerun with matching wallet hashes CONVERGES: deterministic event ids
 *      make the rewrite idempotent, so there is exactly one V4 event and one
 *      state document (no duplicate award/state), and the marker is then written.
 *
 * "Production mode" is simulated by REMOVING FIRESTORE_EMULATOR_HOST and setting
 * GAMIFICATION_MIGRATION_MODE=production-trusted, so the real trusted-context
 * guard is exercised — the production path is proven WITHOUT touching prod.
 *
 * Failure is injected into the REAL wallet snapshot read on its AFTER pass.
 * No wallet document is changed by the test, so byte equality can be proved.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'

import {
  runFamilyMigration,
  parseProductionMigrationCliArgs,
} from './production-migration'
import { migrationMarkerDocPath } from './migration-marker'
import { buildGate1Artifact, type Gate1Artifact } from '../gate1/gate1-artifact'

const FAMILY = 'FAM_PROD_A'
const NOW = Date.parse('2026-08-08T12:00:00.000Z')

// Failure injection for the second (AFTER) wallet capture. It throws without
// mutating wallet data, modelling a read/verification outage after V4 writes.
let failWalletAfter = false
let walletCaptureReads = 0

// --- in-memory Firestore double (mirrors production-migration.test.ts) -------
class MockFirestore {
  readonly data = new Map<string, unknown>()
  collection(path: string) { return new MockCollection(this, path) }
  doc(path: string) { return new MockDoc(this, path) }
  async runTransaction<T>(fn: (tx: MockTx) => Promise<T>): Promise<T> {
    const tx = new MockTx(this)
    const r = await fn(tx)
    tx.commit()
    return r
  }
  _get(p: string) { return this.data.get(p) }
  _set(p: string, v: unknown) { this.data.set(p, v) }
  _entries() { return [...this.data.entries()] }
}
class MockCollection {
  constructor(private readonly fs: MockFirestore, private readonly path: string) {}
  doc(id: string) { return new MockDoc(this.fs, `${this.path}/${id}`) }
  async get() {
    if (this.path === 'families') {
      walletCaptureReads += 1
      if (failWalletAfter && walletCaptureReads === 2) {
        throw new Error('injected wallet AFTER verification failure')
      }
    }
    const prefix = `${this.path}/`
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
  constructor(private readonly fs: MockFirestore, readonly path: string) {}
  collection(name: string) { return new MockCollection(this.fs, `${this.path}/${name}`) }
  async get() {
    const v = this.fs._get(this.path)
    return { exists: v !== undefined, id: this.path.split('/').pop() as string, data: () => v }
  }
  async set(data: unknown) { this.fs._set(this.path, data) }
}
class MockTx {
  private readonly writes: Array<{ path: string; data: unknown }> = []
  constructor(private readonly fs: MockFirestore) {}
  async get(ref: MockDoc) {
    const v = this.fs._get(ref.path)
    return { exists: v !== undefined, data: () => v }
  }
  set(ref: MockDoc, data: unknown) { this.writes.push({ path: ref.path, data }) }
  create(ref: MockDoc, data: unknown) { this.writes.push({ path: ref.path, data }) }
  commit() { for (const w of this.writes) this.fs._set(w.path, w.data) }
}
function createDb(): { db: Firestore; fs: MockFirestore } {
  const fs = new MockFirestore()
  fs._set('families/FAM_PROD_A', { name: 'A' })
  fs._set('users/u1', { walletBalance: 10 })
  return { db: fs as unknown as Firestore, fs }
}

// --- fixtures ----------------------------------------------------------------
function member(rewardPoints: number, xpTotal: number, memberId: string) {
  return {
    memberId,
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
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
  }
}
function report(): ProductionReplayReport {
  const counts = { exact: 1, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 }
  return {
    generatedAt: '2026-08-01T00:00:00.000Z',
    schemaVersion: 4,
    gate: 'GATE_1_REACHED',
    totalFamilies: 1,
    totalSources: 1,
    totalEventsBuilt: 1,
    counts: { exact: 1, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 },
    families: [
      {
        familyId: FAMILY,
        totalSources: 1,
        counts,
        eventsBuilt: 1,
        members: { m1: member(100, 200, 'm1') },
        displayedProvided: true,
      },
    ],
    walletSnapshot: null,
  } as unknown as ProductionReplayReport
}
function gate1(): Gate1Artifact {
  return buildGate1Artifact({
    source: report() as never,
    approval: { approvedBy: 'owner@example.com', approvedAt: '2026-08-08T11:00:00.000Z' },
    now: () => NOW,
  })
}

const migrateArgs = (fs: MockFirestore) => ({
  db: fs as unknown as Firestore,
  report: report(),
  gate1: gate1(),
  familyId: FAMILY,
  execute: true,
  operator: 'ops@example.com',
  now: () => NOW,
  migratedAt: '2026-08-08T12:00:00.000Z',
})

// --- environment: simulate PRODUCTION (no emulator host) ---------------------
beforeEach(() => {
  delete process.env.FIRESTORE_EMULATOR_HOST
  process.env.GAMIFICATION_MIGRATION_MODE = 'production-trusted'
  failWalletAfter = false
  walletCaptureReads = 0
})
afterEach(() => {
  delete process.env.FIRESTORE_EMULATOR_HOST
  delete process.env.GAMIFICATION_MIGRATION_MODE
})

describe('Gap 3 — partial migration failure after V4 writes', () => {
  it('provides a family-scoped execute-only recovery command contract', () => {
    expect(parseProductionMigrationCliArgs([
      '--project', 'project-A',
      '--family', FAMILY,
      '--report', 'report.json',
      '--gate1', 'gate1.json',
      '--execute',
      '--operator', 'ops@example.com',
    ])).toEqual({
      projectId: 'project-A',
      familyId: FAMILY,
      reportPath: 'report.json',
      gate1Path: 'gate1.json',
      execute: true,
      operator: 'ops@example.com',
    })
    expect(() => parseProductionMigrationCliArgs([
      '--project', 'project-A', '--family', FAMILY,
    ])).toThrow(/report.*gate1.*execute.*operator/i)
  })

  it('recovers without purge and converges byte-for-byte with a clean migration', async () => {
    const clean = createDb()
    const cleanWalletBefore = JSON.stringify(clean.fs._entries().filter(([path]) => path.startsWith('users/')).sort())
    await runFamilyMigration(migrateArgs(clean.fs))
    const cleanEvents = clean.fs._entries().filter(([path]) => path.includes('/gamification_events/')).sort()
    const cleanStates = clean.fs._entries().filter(([path]) => path.includes('/gamification_state/')).sort()
    expect(JSON.stringify(clean.fs._entries().filter(([path]) => path.startsWith('users/')).sort()))
      .toBe(cleanWalletBefore)

    walletCaptureReads = 0
    const recovered = createDb()
    const walletBefore = JSON.stringify(recovered.fs._entries().filter(([path]) => path.startsWith('users/')).sort())

    // Attempt 1 writes deterministic V4 data, then wallet AFTER verification fails.
    failWalletAfter = true
    await expect(runFamilyMigration(migrateArgs(recovered.fs)))
      .rejects.toThrow('injected wallet AFTER verification failure')
    const partialEvents = recovered.fs._entries().filter(([path]) => path.includes('/gamification_events/')).sort()
    const partialStates = recovered.fs._entries().filter(([path]) => path.includes('/gamification_state/')).sort()
    expect(partialEvents).toHaveLength(1)
    expect(partialStates).toHaveLength(1)
    expect(recovered.fs._get(migrationMarkerDocPath(FAMILY))).toBeUndefined()
    expect(JSON.stringify(recovered.fs._entries().filter(([path]) => path.startsWith('users/')).sort()))
      .toBe(walletBefore)

    // Attempt 2 uses the same family/report contract and does not purge V4.
    failWalletAfter = false
    walletCaptureReads = 0
    const result = await runFamilyMigration(migrateArgs(recovered.fs))
    expect(result.executed).toBe(true)
    expect(result.walletHashOk).toBe(true)
    expect(result.walletHashBefore).toBe(result.walletHashAfter)
    expect(result.marker?.status).toBe('MIGRATED')

    const recoveredEvents = recovered.fs._entries().filter(([path]) => path.includes('/gamification_events/')).sort()
    const recoveredStates = recovered.fs._entries().filter(([path]) => path.includes('/gamification_state/')).sort()
    expect(recoveredEvents).toEqual(cleanEvents)
    expect(recoveredStates).toEqual(cleanStates)
    expect(recoveredEvents.map(([path]) => path)).toEqual(partialEvents.map(([path]) => path))
    expect(recoveredStates.map(([path]) => path)).toEqual(partialStates.map(([path]) => path))
    expect(JSON.stringify(recovered.fs._entries().filter(([path]) => path.startsWith('users/')).sort()))
      .toBe(walletBefore)

    // Attempt 3 after recovery is the normal idempotent no-op.
    const recoveredAfterSuccess = JSON.stringify(recovered.fs._entries().sort())
    walletCaptureReads = 0
    const repeated = await runFamilyMigration(migrateArgs(recovered.fs))
    expect(repeated.rerunNoOp).toBe(true)
    expect(JSON.stringify(recovered.fs._entries().sort())).toBe(recoveredAfterSuccess)
  })
})
