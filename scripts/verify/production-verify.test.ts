/**
 * Gamification V4 — Phase 3 (B3): read-only PRODUCTION Stage 6 verification.
 *
 * "Production" is simulated by removing FIRESTORE_EMULATOR_HOST, so the real
 * trusted-read guard is exercised. The db double records every write, letting
 * the tests PROVE the verification is side-effect free.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'

import { verifyPreCutoverProduction } from './production-verify'
import { runFamilyMigration } from '../migrate/production-migration'
import { buildGate1Artifact, type Gate1Artifact } from '../gate1/gate1-artifact'
import { migrationMarkerDocPath } from '../migrate/migration-marker'
import { UntrustedV4WriteError } from '../../functions/src/gamification/v4/trustedServerContext'
import type { ProductionReplayReport } from '../replay/production-report'

const FAMILY = 'FAM_V_A'
const OTHER = 'FAM_V_B'
const NOW = Date.parse('2026-08-08T12:00:00.000Z')

class MockFirestore {
  readonly data = new Map<string, unknown>()
  writes = 0
  collection(path: string): MockCollection { return new MockCollection(this, path) }
  doc(path: string): MockDoc { return new MockDoc(this, path) }
  async runTransaction<T>(fn: (tx: MockTx) => Promise<T>): Promise<T> {
    const tx = new MockTx(this)
    const r = await fn(tx)
    tx.commit()
    return r
  }
  _get(p: string): unknown { return this.data.get(p) }
  _set(p: string, v: unknown): void { this.writes++; this.data.set(p, v) }
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
  private readonly pending: Array<{ path: string; data: unknown }> = []
  constructor(private readonly fs: MockFirestore) {}
  async get(ref: MockDoc): Promise<{ exists: boolean; data: () => unknown }> {
    const v = this.fs._get(ref.path)
    return { exists: v !== undefined, data: () => v }
  }
  set(ref: MockDoc, data: unknown): void { this.pending.push({ path: ref.path, data }) }
  create(ref: MockDoc, data: unknown): void { this.pending.push({ path: ref.path, data }) }
  commit(): void { for (const w of this.pending) this.fs._set(w.path, w.data) }
}

function member(rewardPoints: number, xpTotal: number, memberId: string) {
  return {
    memberId,
    replayed: {
      rewardPoints, xpTotal, level: 1, xpProgressInLevel: xpTotal, xpToNextLevel: 1000,
      levelProgressPercentage: 0, currentStreak: 0, bestStreak: 0, lastQualifiedDayKey: null,
      unlockedAchievementIds: [], unlockedAvatarIds: [], projectionVersion: 1,
      foldedThroughEventId: null, updatedAt: '2026-08-01T00:00:00.000Z',
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
      { familyId: FAMILY, totalSources: 1, counts, eventsBuilt: 1, members: { m1: member(100, 200, 'm1') }, displayedProvided: true },
      { familyId: OTHER, totalSources: 1, counts, eventsBuilt: 1, members: { m2: member(5, 7, 'm2') }, displayedProvided: true },
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

/** Migrate FAMILY on the "emulator", then flip to production for verification. */
async function migratedDb(): Promise<{ db: Firestore; fs: MockFirestore }> {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
  const fs = new MockFirestore()
  fs._set('families/FAM_V_A', { name: 'A' })
  fs._set('families/FAM_V_B', { name: 'B' })
  const db = fs as unknown as Firestore
  await runFamilyMigration({
    db, report: report(), gate1: gate1(), familyId: FAMILY,
    execute: true, operator: 'ops@example.com', now: () => NOW,
    migratedAt: '2026-08-08T12:00:00.000Z',
  })
  delete process.env.FIRESTORE_EMULATOR_HOST
  fs.writes = 0
  return { db, fs }
}

afterEach(() => {
  if (ORIGINAL_HOST === undefined) delete process.env.FIRESTORE_EMULATOR_HOST
  else process.env.FIRESTORE_EMULATOR_HOST = ORIGINAL_HOST
  if (ORIGINAL_MODE === undefined) delete process.env.GAMIFICATION_MIGRATION_MODE
  else process.env.GAMIFICATION_MIGRATION_MODE = ORIGINAL_MODE
})

beforeEach(() => {
  delete process.env.GAMIFICATION_MIGRATION_MODE
})

describe('Phase 3 — verifyPreCutoverProduction (read-only production)', () => {
  it('PASSES for a correctly migrated family and writes NOTHING', async () => {
    const { db, fs } = await migratedDb()
    const result = await verifyPreCutoverProduction({
      db, familyId: FAMILY, report: report(), gate1: gate1(),
      operator: 'ops@example.com', now: () => NOW,
    })

    expect(result.passed).toBe(true)
    expect(result.readOnly).toBe(true)
    expect(result.gate1.valid).toBe(true)
    expect(result.gate2).toEqual({ markerPresent: true, boundToGate1: true, walletHashOk: true })
    expect(result.stage6?.checks.every((c) => c.passed)).toBe(true)
    expect(fs.writes).toBe(0)
  })

  it('proves the duplicate migration no-op WITHOUT re-running the writer', async () => {
    const { db, fs } = await migratedDb()
    const result = await verifyPreCutoverProduction({
      db, familyId: FAMILY, report: report(), gate1: gate1(),
      operator: 'ops@example.com', now: () => NOW,
    })
    const check = result.stage6?.checks.find((c) => c.name === 'duplicateMigrationNoOp')
    expect(check?.passed).toBe(true)
    expect(check?.detail).toMatch(/read-only/)
    expect(fs.writes).toBe(0)
  })

  it('is deterministic — two runs produce identical reports', async () => {
    const { db } = await migratedDb()
    const args = {
      db, familyId: FAMILY, report: report(), gate1: gate1(),
      operator: 'ops@example.com', now: () => NOW,
    }
    const a = await verifyPreCutoverProduction(args)
    const b = await verifyPreCutoverProduction(args)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('FAILS CLOSED when the Gate 2 marker is absent', async () => {
    const { db, fs } = await migratedDb()
    fs.data.delete(migrationMarkerDocPath(FAMILY))
    const result = await verifyPreCutoverProduction({
      db, familyId: FAMILY, report: report(), gate1: gate1(),
      operator: 'ops@example.com', now: () => NOW,
    })
    expect(result.passed).toBe(false)
    expect(result.gate2.markerPresent).toBe(false)
  })

  it('FAILS CLOSED when the marker is not bound to the approved Gate 1 hash', async () => {
    const { db, fs } = await migratedDb()
    const marker = fs._get(migrationMarkerDocPath(FAMILY)) as Record<string, unknown>
    fs.data.set(migrationMarkerDocPath(FAMILY), { ...marker, reportHash: 'deadbeef' })
    const result = await verifyPreCutoverProduction({
      db, familyId: FAMILY, report: report(), gate1: gate1(),
      operator: 'ops@example.com', now: () => NOW,
    })
    expect(result.passed).toBe(false)
    expect(result.gate2.boundToGate1).toBe(false)
  })

  it('FAILS CLOSED for an unmigrated family (no marker, no state)', async () => {
    const { db } = await migratedDb()
    const result = await verifyPreCutoverProduction({
      db, familyId: OTHER, report: report(), gate1: gate1(),
      operator: 'ops@example.com', now: () => NOW,
    })
    expect(result.passed).toBe(false)
  })

  it('FAILS CLOSED on a stale Gate 1 artifact', async () => {
    const { db } = await migratedDb()
    const result = await verifyPreCutoverProduction({
      db, familyId: FAMILY, report: report(), gate1: gate1(),
      operator: 'ops@example.com', now: () => NOW + 30 * 24 * 60 * 60 * 1000,
    })
    expect(result.passed).toBe(false)
    expect(result.gate1.valid).toBe(false)
  })

  it('requires an identified operator', async () => {
    const { db } = await migratedDb()
    await expect(
      verifyPreCutoverProduction({
        db, familyId: FAMILY, report: report(), gate1: gate1(), operator: '  ', now: () => NOW,
      }),
    ).rejects.toThrow(/operator/i)
  })

  it('the read scope refuses any write attempted inside it', async () => {
    const { db } = await migratedDb()
    const { runWithTrustedRead } = await import('../../functions/src/gamification/v4/trustedServerContext')
    const { writeState } = await import('../../functions/src/gamification/v4/repository')

    await expect(
      runWithTrustedRead(
        { trustedServer: true, writer: 'verify', route: 'read-only', familyId: FAMILY, operator: 'ops' },
        async () => {
          await writeState(db, FAMILY, 'm1', {} as never)
        },
      ),
    ).rejects.toThrow(/read-only verification scope may never write/)
  })

  it('the read scope is family-scoped (no cross-family reads)', async () => {
    const { db } = await migratedDb()
    const { runWithTrustedRead } = await import('../../functions/src/gamification/v4/trustedServerContext')
    const { readLedger } = await import('../../functions/src/gamification/v4/repository')

    await expect(
      runWithTrustedRead(
        { trustedServer: true, writer: 'verify', route: 'read-only', familyId: FAMILY, operator: 'ops' },
        async () => { await readLedger(db, OTHER) },
      ),
    ).rejects.toThrow(/authorises family/)
  })

  it('production reads without any trusted scope remain refused', async () => {
    const { db } = await migratedDb()
    const { readLedger } = await import('../../functions/src/gamification/v4/repository')
    await expect(readLedger(db, FAMILY)).rejects.toBeInstanceOf(Error)
  })
})

describe('Phase 3 — untrusted contexts', () => {
  it('a malformed read context cannot establish a scope', async () => {
    const { runWithTrustedRead } = await import('../../functions/src/gamification/v4/trustedServerContext')
    expect(() =>
      runWithTrustedRead(
        { trustedServer: true, writer: 'verify', route: 'read-only', familyId: '', operator: '' } as never,
        async () => undefined,
      ),
    ).toThrow(UntrustedV4WriteError)
  })
})
