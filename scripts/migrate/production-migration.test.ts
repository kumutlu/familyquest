/**
 * Gamification V4 — Phase 2 (B2): production-safe Stage 5 migration mode.
 *
 * Unit tests drive an in-memory Firestore double. "Production mode" is
 * simulated by REMOVING FIRESTORE_EMULATOR_HOST so the real trusted-context
 * guard (`runWithTrustedMigration` / `assertV4WriteAllowed`) is exercised — the
 * production path is proven WITHOUT ever touching production Firestore.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'

import {
  runFamilyMigration,
  scopeReportToFamily,
  MigrationRefusedError,
  captureWalletManifest,
} from './production-migration'
import { migrationMarkerDocPath } from './migration-marker'
import { buildGate1Artifact, type Gate1Artifact } from '../gate1/gate1-artifact'
import { UntrustedV4WriteError } from '../../functions/src/gamification/v4/trustedServerContext'
import type { ProductionReplayReport } from '../replay/production-report'

const FAMILY = 'FAM_PROD_A'
const OTHER = 'FAM_PROD_B'
const NOW = Date.parse('2026-08-08T12:00:00.000Z')

// --- in-memory Firestore double ---------------------------------------------
class MockFirestore {
  readonly data = new Map<string, unknown>()
  collection(path: string): MockCollection { return new MockCollection(this, path) }
  doc(path: string): MockDoc { return new MockDoc(this, path) }
  async runTransaction<T>(fn: (tx: MockTx) => Promise<T>): Promise<T> {
    const tx = new MockTx(this)
    const r = await fn(tx)
    tx.commit()
    return r
  }
  _get(p: string): unknown { return this.data.get(p) }
  _set(p: string, v: unknown): void { this.data.set(p, v) }
  _entries(): Array<[string, unknown]> { return [...this.data.entries()] }
}
class MockCollection {
  constructor(private readonly fs: MockFirestore, private readonly path: string) {}
  doc(id: string): MockDoc { return new MockDoc(this.fs, `${this.path}/${id}`) }
  async get(): Promise<{ docs: Array<{ id: string; exists: boolean; data: () => unknown }> }> {
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
  async get(ref: MockDoc): Promise<{ exists: boolean; data: () => unknown }> {
    const v = this.fs._get(ref.path)
    return { exists: v !== undefined, data: () => v }
  }
  set(ref: MockDoc, data: unknown): void { this.writes.push({ path: ref.path, data }) }
  create(ref: MockDoc, data: unknown): void { this.writes.push({ path: ref.path, data }) }
  commit(): void { for (const w of this.writes) this.fs._set(w.path, w.data) }
}
function createDb(): { db: Firestore; fs: MockFirestore } {
  const fs = new MockFirestore()
  fs._set('families/FAM_PROD_A', { name: 'A' })
  fs._set('families/FAM_PROD_B', { name: 'B' })
  fs._set('users/u1', { balance: 10 })
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
    totalFamilies: 2,
    totalSources: 2,
    totalEventsBuilt: 2,
    counts: { exact: 2, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 },
    families: [
      {
        familyId: FAMILY,
        totalSources: 1,
        counts,
        eventsBuilt: 1,
        members: { m1: member(100, 200, 'm1') },
        displayedProvided: true,
      },
      {
        familyId: OTHER,
        totalSources: 1,
        counts,
        eventsBuilt: 1,
        members: { m2: member(5, 7, 'm2') },
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

const ORIGINAL_HOST = process.env.FIRESTORE_EMULATOR_HOST
const ORIGINAL_MODE = process.env.GAMIFICATION_MIGRATION_MODE

afterEach(() => {
  if (ORIGINAL_HOST === undefined) delete process.env.FIRESTORE_EMULATOR_HOST
  else process.env.FIRESTORE_EMULATOR_HOST = ORIGINAL_HOST
  if (ORIGINAL_MODE === undefined) delete process.env.GAMIFICATION_MIGRATION_MODE
  else process.env.GAMIFICATION_MIGRATION_MODE = ORIGINAL_MODE
})

describe('Phase 2 — scopeReportToFamily', () => {
  it('narrows the approved report to exactly one family', () => {
    const scoped = scopeReportToFamily(report(), FAMILY)
    expect(scoped.families).toHaveLength(1)
    expect(scoped.families[0].familyId).toBe(FAMILY)
    expect(scoped.totalFamilies).toBe(1)
  })

  it('refuses a family absent from the approved report', () => {
    expect(() => scopeReportToFamily(report(), 'NOPE')).toThrow(MigrationRefusedError)
  })
})

describe('Phase 2 — emulator mode (unchanged behaviour)', () => {
  beforeEach(() => {
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
    delete process.env.GAMIFICATION_MIGRATION_MODE
  })

  it('DRY RUN is the default: plan only, ZERO writes, no marker', async () => {
    const { db, fs } = createDb()
    const before = fs.data.size
    const result = await runFamilyMigration({ db, report: report(), gate1: gate1(), familyId: FAMILY, now: () => NOW })

    expect(result.dryRun).toBe(true)
    expect(result.executed).toBe(false)
    expect(result.plan.eventsToWrite).toBe(1)
    expect(result.plan.classification).toBe('exact')
    expect(result.marker).toBeNull()
    expect(fs.data.size).toBe(before)
    expect(fs._get(migrationMarkerDocPath(FAMILY))).toBeUndefined()
  })

  it('--execute writes V4 events + state, then the marker, family-scoped', async () => {
    const { db, fs } = createDb()
    const result = await runFamilyMigration({
      db,
      report: report(),
      gate1: gate1(),
      familyId: FAMILY,
      execute: true,
      operator: 'ops@example.com',
      now: () => NOW,
      migratedAt: '2026-08-08T12:00:00.000Z',
    })

    expect(result.executed).toBe(true)
    expect(result.eventsWritten).toBe(1)
    expect(result.statesWritten).toBe(1)
    expect(result.walletHashOk).toBe(true)
    expect(result.walletHashBefore).toBe(result.walletHashAfter)
    expect(result.marker?.status).toBe('MIGRATED')

    // marker written for THIS family only — no cross-family contamination
    expect(fs._get(migrationMarkerDocPath(FAMILY))).toBeTruthy()
    expect(fs._get(migrationMarkerDocPath(OTHER))).toBeUndefined()
    const otherWrites = fs._entries().filter(([p]) => p.includes(`/${OTHER}/`))
    expect(otherWrites).toHaveLength(0)
  })

  it('binds the marker to the approved Gate 1 hash', async () => {
    const { db } = createDb()
    const artifact = gate1()
    const result = await runFamilyMigration({
      db, report: report(), gate1: artifact, familyId: FAMILY,
      execute: true, operator: 'ops@example.com', now: () => NOW,
    })
    expect(result.marker?.reportHash).toBe(artifact.reportHash)
  })

  it('rerun is idempotent: identical ledger/state and one marker doc', async () => {
    const { db, fs } = createDb()
    const args = {
      db, report: report(), gate1: gate1(), familyId: FAMILY,
      execute: true, operator: 'ops@example.com', now: () => NOW,
      migratedAt: '2026-08-08T12:00:00.000Z',
    }
    await runFamilyMigration(args)
    const snapshot = JSON.stringify(fs._entries().sort())
    const second = await runFamilyMigration(args)

    expect(second.rerunNoOp).toBe(true)
    expect(JSON.stringify(fs._entries().sort())).toBe(snapshot)
  })

  it('never writes legacy or wallet documents', async () => {
    const { db, fs } = createDb()
    const walletBefore = await captureWalletManifest(db)
    await runFamilyMigration({
      db, report: report(), gate1: gate1(), familyId: FAMILY,
      execute: true, operator: 'ops@example.com', now: () => NOW,
    })
    const walletAfter = await captureWalletManifest(db)
    expect(walletAfter.globalSha256).toBe(walletBefore.globalSha256)

    const written = fs._entries().map(([p]) => p).filter((p) => p.startsWith('families/'))
    for (const p of written) {
      expect(p).not.toMatch(/rewardPoints|wallet|allowance|transactions/)
    }
  })

  it('refuses an execute run without an operator', async () => {
    const { db } = createDb()
    await expect(
      runFamilyMigration({ db, report: report(), gate1: gate1(), familyId: FAMILY, execute: true, now: () => NOW }),
    ).rejects.toThrow(/operator/i)
  })

  it('refuses when the Gate 1 artifact does not cover the family', async () => {
    const { db } = createDb()
    await expect(
      runFamilyMigration({
        db, report: report(), gate1: gate1(), familyId: 'FAM_UNKNOWN',
        execute: true, operator: 'ops@example.com', now: () => NOW,
      }),
    ).rejects.toThrow(/Gate 1 evidence rejected/)
  })

  it('refuses a STALE Gate 1 artifact', async () => {
    const { db } = createDb()
    await expect(
      runFamilyMigration({
        db, report: report(), gate1: gate1(), familyId: FAMILY,
        execute: true, operator: 'ops@example.com',
        now: () => NOW + 30 * 24 * 60 * 60 * 1000,
      }),
    ).rejects.toThrow(/stale/i)
  })
})

describe('Phase 2 — simulated PRODUCTION mode (no emulator host)', () => {
  beforeEach(() => {
    delete process.env.FIRESTORE_EMULATOR_HOST
    delete process.env.GAMIFICATION_MIGRATION_MODE
  })

  it('BLOCKS an execute run without the trusted migration mode', async () => {
    const { db, fs } = createDb()
    await expect(
      runFamilyMigration({
        db, report: report(), gate1: gate1(), familyId: FAMILY,
        execute: true, operator: 'ops@example.com', now: () => NOW,
      }),
    ).rejects.toBeInstanceOf(UntrustedV4WriteError)
    expect(fs._get(migrationMarkerDocPath(FAMILY))).toBeUndefined()
  })

  it('ALLOWS an execute run under the explicit trusted migration mode', async () => {
    process.env.GAMIFICATION_MIGRATION_MODE = 'production-trusted'
    const { db, fs } = createDb()
    const result = await runFamilyMigration({
      db, report: report(), gate1: gate1(), familyId: FAMILY,
      execute: true, operator: 'ops@example.com', now: () => NOW,
    })
    expect(result.executed).toBe(true)
    expect(result.walletHashOk).toBe(true)
    expect(fs._get(migrationMarkerDocPath(FAMILY))).toBeTruthy()
  })

  it('a production DRY RUN establishes no authority and writes nothing', async () => {
    const { db, fs } = createDb()
    const before = fs.data.size
    const result = await runFamilyMigration({
      db, report: report(), gate1: gate1(), familyId: FAMILY, now: () => NOW,
    })
    expect(result.dryRun).toBe(true)
    expect(fs.data.size).toBe(before)
  })

  it('the trusted scope is family-scoped: it cannot write another family', async () => {
    process.env.GAMIFICATION_MIGRATION_MODE = 'production-trusted'
    const { db, fs } = createDb()
    await runFamilyMigration({
      db, report: report(), gate1: gate1(), familyId: FAMILY,
      execute: true, operator: 'ops@example.com', now: () => NOW,
    })
    expect(fs._entries().some(([p]) => p.includes(`/${OTHER}/gamification_`))).toBe(false)
  })
})
