/**
 * Gamification V4 — Task 6.1 pre-cutover verification gate.
 *
 * TDD-first. `verifyPreCutover(familyId, deps)` FAILS CLOSED unless ALL six
 * checks pass. Unit tests use an in-memory Firestore double (no emulator, no
 * credentials). Integration tests drive the SAME functions against a REAL
 * Firestore emulator and are skipped automatically when FIRESTORE_EMULATOR_HOST
 * is unset (run via `firebase emulators:exec --only firestore`).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import { deleteApp, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

import {
  readLedger,
  readState,
  writeEventIdempotent,
  writeState,
} from '../../functions/src/gamification/v4/repository'
import { eventIdFor } from '../../src/domain/gamification/v4/ids'
import { businessFields } from '../../src/domain/gamification/v4/types'
import type { GamificationEventV4, GamificationStateV4 } from '../../src/domain/gamification/v4/event'
import type { ProductionReplayReport, ProductionFamilyReport } from '../replay/production-report'
import { writeMigrationLedger } from '../migrate/write-v4-ledger'
import {
  migrationMarkerDocPath,
  type MigrationMarkerV4,
} from '../migrate/migration-marker'
import { verifyPreCutover, readMigrationMarker, type PreCutoverReport } from './pre-cutover'

// --- emulator-only guard must pass for the repository -----------------------
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080'

// --- in-memory Firestore mock with transaction rollback semantics -----------
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
class MockTransaction {
  private writes: Array<{ path: string; data: unknown }> = []
  constructor(private readonly store: MockStore) {}
  set(ref: MockDoc, data: unknown): void { this.writes.push({ path: ref.path, data }) }
  commit(): void {
    for (const w of this.writes) this.store.write(w.path, w.data)
  }
  rollback(): void { this.writes = [] }
}
class MockStore {
  private readonly data = new Map<string, unknown>()
  read(path: string): unknown { return this.data.get(path) }
  write(path: string, value: unknown): void { this.data.set(path, value) }
  delete(path: string): void { this.data.delete(path) }
  entries(): Array<[string, unknown]> { return [...this.data.entries()] }
  collection(name: string): MockCollection {
    return new MockCollection(this, [name])
  }
  async runTransaction<T>(fn: (tx: MockTransaction) => Promise<T>): Promise<T> {
    const tx = new MockTransaction(this)
    try {
      const result = await fn(tx)
      tx.commit()
      return result
    } catch (err) {
      tx.rollback()
      throw err
    }
  }
}
function createMockFirestore(): { db: Firestore; store: MockStore } {
  const store = new MockStore()
  return { db: store as unknown as Firestore, store }
}

// --- report builders --------------------------------------------------------
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

function makeReport(
  families: ProductionFamilyReport[],
  overrides: Partial<ProductionReplayReport> = {},
): ProductionReplayReport {
  const totalSources = families.reduce((s, f) => s + f.totalSources, 0)
  const totalEventsBuilt = families.reduce((s, f) => s + f.eventsBuilt, 0)
  const counts = families.reduce(
    (acc, f) => ({
      exact: acc.exact + f.counts.exact,
      estimated: acc.estimated + f.counts.estimated,
      malformed: acc.malformed + f.counts.malformed,
      ambiguous: acc.ambiguous + f.counts.ambiguous,
      skipped: acc.skipped + f.counts.skipped,
    }),
    { exact: 0, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 },
  )
  return {
    generatedAt: '1970-01-01T00:00:00.000Z',
    schemaVersion: 4,
    gate: 'GATE_1_REACHED',
    totalFamilies: families.length,
    totalSources,
    totalEventsBuilt,
    counts,
    families,
    walletSnapshot: null,
    ...overrides,
  }
}

const FAMILY_A = 'fam-A'

function approvedReport(rp: number, xp: number): ProductionReplayReport {
  return makeReport([
    {
      familyId: FAMILY_A,
      totalSources: 1,
      counts: { exact: 1, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 },
      eventsBuilt: 1,
      members: { 'mem-1': memberReport(rp, xp) },
      displayedProvided: false,
    },
  ])
}

function goodMarker(overrides: Partial<MigrationMarkerV4> = {}): MigrationMarkerV4 {
  return {
    schemaVersion: 4,
    familyId: FAMILY_A,
    reportHash: 'deadbeef',
    status: 'MIGRATED',
    migratedAt: '1970-01-01T00:00:00.000Z',
    eventsWritten: 1,
    statesWritten: 1,
    walletHashBefore: 'abc',
    walletHashAfter: 'abc',
    walletHashOk: true,
    idempotent: true,
    ...overrides,
  }
}

function checkByName(report: PreCutoverReport, name: string) {
  const c = report.checks.find((x) => x.name === name)
  if (!c) throw new Error(`check ${name} not present`)
  return c
}

// --- unit tests (in-memory Firestore) ---------------------------------------
describe('Task 6.1 — verifyPreCutover (in-memory Firestore)', () => {
  it('all six green => PASS', async () => {
    const { db } = createMockFirestore()
    const report = approvedReport(521, 546)
    await writeMigrationLedger(report, db)

    const result = await verifyPreCutover(FAMILY_A, { db, report, marker: goodMarker() })
    expect(result.passed).toBe(true)
    expect(result.checks).toHaveLength(6)
    for (const c of result.checks) expect(c.passed).toBe(true)
  })

  it('ledger/state mismatch => FAIL (check 1)', async () => {
    const { db, store } = createMockFirestore()
    const report = approvedReport(521, 546)
    await writeMigrationLedger(report, db)

    // Corrupt the stored projection so it diverges from the ledger rebuild.
    const statePath = `families/${FAMILY_A}/gamification_state/mem-1`
    const corrupted = { ...(store.read(statePath) as GamificationStateV4) }
    corrupted.rewardPoints = 999
    store.write(statePath, corrupted)

    const result = await verifyPreCutover(FAMILY_A, { db, report, marker: goodMarker() })
    expect(result.passed).toBe(false)
    expect(checkByName(result, 'ledgerStateEquality').passed).toBe(false)
  })

  it('missing state => FAIL (checks 1 & 2)', async () => {
    const { db, store } = createMockFirestore()
    const report = approvedReport(521, 546)
    await writeMigrationLedger(report, db)

    store.delete(`families/${FAMILY_A}/gamification_state/mem-1`)

    const result = await verifyPreCutover(FAMILY_A, { db, report, marker: goodMarker() })
    expect(result.passed).toBe(false)
    expect(checkByName(result, 'ledgerStateEquality').passed).toBe(false)
    expect(checkByName(result, 'membersAccounted').passed).toBe(false)
  })

  it('malformed/ambiguous Gate 1 report => FAIL (check 3)', async () => {
    const { db } = createMockFirestore()
    const report = makeReport([
      {
        familyId: FAMILY_A,
        totalSources: 1,
        counts: { exact: 0, estimated: 0, malformed: 1, ambiguous: 0, skipped: 0 },
        eventsBuilt: 0,
        members: {},
        displayedProvided: false,
      },
    ])
    await writeMigrationLedger(approvedReport(521, 546), db)

    const result = await verifyPreCutover(FAMILY_A, { db, report, marker: goodMarker() })
    expect(result.passed).toBe(false)
    expect(checkByName(result, 'noMalformedAmbiguous').passed).toBe(false)
  })

  it('malformed ledger event => FAIL (check 3)', async () => {
    const { db, store } = createMockFirestore()
    const report = approvedReport(521, 546)
    await writeMigrationLedger(report, db)

    // Inject a malformed event directly (bypassing repository validation).
    const badEvent = {
      schemaVersion: 4,
      eventId: 'bad',
      familyId: FAMILY_A,
      memberId: 'mem-1',
      // missing eventType / sourceType / deltas -> invalid
    } as unknown as GamificationEventV4
    store.write(`families/${FAMILY_A}/gamification_events/bad`, badEvent)

    const result = await verifyPreCutover(FAMILY_A, { db, report, marker: goodMarker() })
    expect(result.passed).toBe(false)
    expect(checkByName(result, 'noMalformedAmbiguous').passed).toBe(false)
  })

  it('wallet hash mismatch => FAIL (check 4)', async () => {
    const { db } = createMockFirestore()
    const report = approvedReport(521, 546)
    await writeMigrationLedger(report, db)

    const result = await verifyPreCutover(FAMILY_A, {
      db,
      report,
      marker: goodMarker({ walletHashBefore: 'aaa', walletHashAfter: 'bbb', walletHashOk: false }),
    })
    expect(result.passed).toBe(false)
    expect(checkByName(result, 'walletHashEquality').passed).toBe(false)
  })

  it('missing migration marker => FAIL (checks 4 & 6)', async () => {
    const { db } = createMockFirestore()
    const report = approvedReport(521, 546)
    await writeMigrationLedger(report, db)

    const result = await verifyPreCutover(FAMILY_A, { db, report, marker: null })
    expect(result.passed).toBe(false)
    expect(checkByName(result, 'walletHashEquality').passed).toBe(false)
    expect(checkByName(result, 'duplicateMigrationNoOp').passed).toBe(false)
  })

  it('cross-family event => FAIL (check 5)', async () => {
    const { db, store } = createMockFirestore()
    const report = approvedReport(521, 546)
    await writeMigrationLedger(report, db)

    const crossEvent: GamificationEventV4 = {
      schemaVersion: 4,
      eventId: eventIdFor('OTHER', 'mem-1', 'MIGRATION_BASELINE', 'BASELINE'),
      familyId: 'OTHER',
      memberId: 'mem-1',
      eventType: 'MIGRATION_BASELINE',
      sourceType: 'migration',
      sourceId: 'BASELINE',
      effectiveAt: '1970-01-01T00:00:00.000Z',
      createdAt: '1970-01-01T00:00:00.000Z',
      rewardPointsDelta: 1,
      xpDelta: 1,
      metadata: {},
      estimated: false,
    }
    store.write(`families/${FAMILY_A}/gamification_events/cross`, crossEvent)

    const result = await verifyPreCutover(FAMILY_A, { db, report, marker: goodMarker() })
    expect(result.passed).toBe(false)
    expect(checkByName(result, 'noCrossFamily').passed).toBe(false)
  })

  it('extra cross-family state (member not in report) => FAIL (checks 2 & 5)', async () => {
    const { db } = createMockFirestore()
    const report = approvedReport(521, 546)
    await writeMigrationLedger(report, db)

    // Write a state for a member absent from the Gate 1 report.
    await writeState(db, FAMILY_A, 'ghost', {
      rewardPoints: 0,
      xpTotal: 0,
      level: 1,
      xpProgressInLevel: 0,
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
    })

    const result = await verifyPreCutover(FAMILY_A, { db, report, marker: goodMarker() })
    expect(result.passed).toBe(false)
    expect(checkByName(result, 'noCrossFamily').passed).toBe(false)
    expect(checkByName(result, 'membersAccounted').passed).toBe(false)
  })

  it('duplicate migration changes state => FAIL (check 6)', async () => {
    const { db } = createMockFirestore()
    // Stored ledger/state written from a DIFFERENT report than the one verified.
    const storedReport = approvedReport(521, 546)
    await writeMigrationLedger(storedReport, db)

    const divergentReport = approvedReport(999, 999)
    const result = await verifyPreCutover(FAMILY_A, { db, report: divergentReport, marker: goodMarker() })
    expect(result.passed).toBe(false)
    expect(checkByName(result, 'duplicateMigrationNoOp').passed).toBe(false)
  })

  it('report is deterministic', async () => {
    const { db } = createMockFirestore()
    const report = approvedReport(521, 546)
    await writeMigrationLedger(report, db)

    const a = await verifyPreCutover(FAMILY_A, { db, report, marker: goodMarker() })
    const b = await verifyPreCutover(FAMILY_A, { db, report, marker: goodMarker() })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

// --- REAL Firestore emulator integration ------------------------------------
const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const describeEmulator = emulatorAvailable ? describe : describe.skip

describeEmulator('Task 6.1 — verifyPreCutover (real Firestore emulator)', () => {
  let app: App
  let db: Firestore

  beforeAll(async () => {
    app = initializeApp({ projectId: 'familyquest-beta-402cb' }, 'v4-pre-cutover-integration')
    db = getFirestore(app)
  })
  afterAll(async () => {
    if (app) await deleteApp(app)
  })

  it('all six green via real emulator (ledger + marker written)', async () => {
    const report = approvedReport(521, 546)
    await writeMigrationLedger(report, db)
    // The gate consumes the Task 5.2 migration marker (wallet hashing is proven
    // by Task 5.2's own tests). Write the marker doc directly with walletHashOk.
    await db.doc(migrationMarkerDocPath(FAMILY_A)).set(goodMarker())

    const marker = await readMigrationMarker(db, FAMILY_A)
    expect(marker).not.toBeNull()

    const result = await verifyPreCutover(FAMILY_A, { db, report, marker: undefined })
    expect(result.passed).toBe(true)
    expect(result.checks).toHaveLength(6)
    for (const c of result.checks) expect(c.passed).toBe(true)

    // Sanity: stored state equals rebuild from the real ledger.
    const ledger = await readLedger(db, FAMILY_A)
    const state = await readState(db, FAMILY_A, 'mem-1')
    expect(businessFields(state as GamificationStateV4)).toEqual(
      businessFields(
        // rebuild uses the canonical helper (no second arithmetic path)
        (await import('../../src/domain/gamification/v4/rebuild')).rebuildStateFromLedger(ledger, {
          updatedAt: report.generatedAt,
          projectionVersion: 1,
        }),
      ),
    )
  })

  it('missing migration marker on real emulator => FAIL', async () => {
    const report = approvedReport(521, 546)
    await writeMigrationLedger(report, db)
    // Ensure no marker exists.
    await db.doc(migrationMarkerDocPath(FAMILY_A)).delete()

    const result = await verifyPreCutover(FAMILY_A, { db, report, marker: undefined })
    expect(result.passed).toBe(false)
    expect(checkByName(result, 'walletHashEquality').passed).toBe(false)
  })
})
