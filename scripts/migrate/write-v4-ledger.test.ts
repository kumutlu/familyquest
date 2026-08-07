/**
 * Gamification V4 — Task 5.1 write approved replay result to V4 ledger+state.
 *
 * TDD-first. Consumes ONLY the approved Gate 1 replay report
 * (`docs/gamification-v4/03-production-replay-report.json`, gate GATE_1_REACHED)
 * and writes, via the Stage 4 server repository, one deterministic
 * MIGRATION_BASELINE event per member plus one rebuilt projection state per
 * member. Rerun is idempotent (deterministic event ids => no duplicate award).
 *
 * Unit tests use an in-memory Firestore double (no emulator, no credentials).
 * Integration tests drive the SAME functions against a REAL Firestore emulator
 * and are skipped automatically when FIRESTORE_EMULATOR_HOST is unset.
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
import { eventDocPath, stateDocPath, STATE_V4_COLLECTION_ID } from '../../src/domain/gamification/v4/storage'
import { rebuildStateFromLedger } from '../../src/domain/gamification/v4/rebuild'
import { businessFields } from '../../src/domain/gamification/v4/types'
import type { GamificationEventV4, GamificationStateV4 } from '../../src/domain/gamification/v4/event'
import type { ProductionReplayReport, ProductionFamilyReport } from '../replay/production-report'
import { writeMigrationLedger, assertApprovedGate1 } from './write-v4-ledger'

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
    this.store.collectionCalls.push(name)
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
  readonly collectionCalls: string[] = []
  read(path: string): unknown { return this.data.get(path) }
  write(path: string, value: unknown): void { this.data.set(path, value) }
  entries(): Array<[string, unknown]> { return [...this.data.entries()] }
  collection(name: string): MockCollection {
    this.collectionCalls.push(name)
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

function makeReport(families: ProductionFamilyReport[]): ProductionReplayReport {
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
  }
}

const FAMILY_A = 'fam-A'
const FAMILY_B = 'fam-B'

describe('Task 5.1 — writeMigrationLedger (in-memory Firestore)', () => {
  it('writes one deterministic MIGRATION_BASELINE event per member', async () => {
    const { db } = createMockFirestore()
    const report = makeReport([
      {
        familyId: FAMILY_A,
        totalSources: 1,
        counts: { exact: 1, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 },
        eventsBuilt: 1,
        members: { 'mem-1': memberReport(521, 546) },
        displayedProvided: false,
      },
    ])

    const result = await writeMigrationLedger(report, db)
    expect(result.members).toBe(1)
    expect(result.eventsWritten).toBe(1)
    expect(result.statesWritten).toBe(1)

    const ledger = await readLedger(db, FAMILY_A)
    expect(ledger).toHaveLength(1)
    const event = ledger[0]
    expect(event.eventType).toBe('MIGRATION_BASELINE')
    expect(event.eventId).toBe(eventIdFor(FAMILY_A, 'mem-1', 'MIGRATION_BASELINE', 'BASELINE'))
    expect(event.rewardPointsDelta).toBe(521)
    expect(event.xpDelta).toBe(546)
  })

  it('writes exactly one state per member and equals rebuildStateFromLedger()', async () => {
    const { db } = createMockFirestore()
    const report = makeReport([
      {
        familyId: FAMILY_A,
        totalSources: 1,
        counts: { exact: 1, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 },
        eventsBuilt: 1,
        members: { 'mem-1': memberReport(521, 546) },
        displayedProvided: false,
      },
    ])

    await writeMigrationLedger(report, db)

    const state = await readState(db, FAMILY_A, 'mem-1')
    expect(state).not.toBeNull()
    const ledger = await readLedger(db, FAMILY_A)
    const rebuilt = rebuildStateFromLedger(ledger, { updatedAt: '1970-01-01T00:00:00.000Z', projectionVersion: 1 })
    expect(businessFields(state as GamificationStateV4)).toEqual(businessFields(rebuilt))
  })

  it('rerun is idempotent: no duplicate events, no double award', async () => {
    const { db, store } = createMockFirestore()
    const report = makeReport([
      {
        familyId: FAMILY_A,
        totalSources: 1,
        counts: { exact: 1, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 },
        eventsBuilt: 1,
        members: { 'mem-1': memberReport(521, 546) },
        displayedProvided: false,
      },
    ])

    await writeMigrationLedger(report, db)
    const firstState = await readState(db, FAMILY_A, 'mem-1')
    await writeMigrationLedger(report, db) // rerun

    const ledger = await readLedger(db, FAMILY_A)
    expect(ledger).toHaveLength(1) // no duplicate event ids
    const eventKeys = store.entries().map(([p]) => p).filter((p) => p.includes('/gamification_events/'))
    expect(eventKeys).toHaveLength(1)
    const secondState = await readState(db, FAMILY_A, 'mem-1')
    expect(businessFields(secondState as GamificationStateV4)).toEqual(businessFields(firstState as GamificationStateV4))
  })

  it('creates NO root-level gamification_state document', async () => {
    const { db, store } = createMockFirestore()
    const report = makeReport([
      {
        familyId: FAMILY_A,
        totalSources: 1,
        counts: { exact: 1, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 },
        eventsBuilt: 1,
        members: { 'mem-1': memberReport(521, 546) },
        displayedProvided: false,
      },
    ])
    await writeMigrationLedger(report, db)
    const rootKeys = store.entries().map(([p]) => p).filter((p) => p === `${STATE_V4_COLLECTION_ID}/mem-1`)
    expect(rootKeys).toHaveLength(0)
    expect(store.read(stateDocPath(FAMILY_A, 'mem-1'))).toBeDefined()
  })

  it('keeps members isolated across families', async () => {
    const { db } = createMockFirestore()
    const report = makeReport([
      {
        familyId: FAMILY_A,
        totalSources: 1,
        counts: { exact: 1, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 },
        eventsBuilt: 1,
        members: { 'mem-1': memberReport(521, 546) },
        displayedProvided: false,
      },
      {
        familyId: FAMILY_B,
        totalSources: 1,
        counts: { exact: 1, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 },
        eventsBuilt: 1,
        members: { 'mem-2': memberReport(10, 20) },
        displayedProvided: false,
      },
    ])
    await writeMigrationLedger(report, db)
    expect(await readState(db, FAMILY_A, 'mem-1')).not.toBeNull()
    expect(await readState(db, FAMILY_A, 'mem-2')).toBeNull()
    expect(await readState(db, FAMILY_B, 'mem-2')).not.toBeNull()
  })

  it('fails closed on unapproved / malformed / ambiguous Gate 1 input', async () => {
    const { db } = createMockFirestore()

    const unapproved = { ...makeReport([]), gate: 'PENDING' as unknown as ProductionReplayReport['gate'] }
    await expect(writeMigrationLedger(unapproved, db)).rejects.toThrow(/GATE_1_REACHED/)

    const malformed = makeReport([
      {
        familyId: FAMILY_A,
        totalSources: 1,
        counts: { exact: 0, estimated: 0, malformed: 1, ambiguous: 0, skipped: 0 },
        eventsBuilt: 0,
        members: {},
        displayedProvided: false,
      },
    ])
    await expect(writeMigrationLedger(malformed, db)).rejects.toThrow(/malformed/i)

    const ambiguous = makeReport([
      {
        familyId: FAMILY_A,
        totalSources: 1,
        counts: { exact: 0, estimated: 0, malformed: 0, ambiguous: 1, skipped: 0 },
        eventsBuilt: 0,
        members: {},
        displayedProvided: false,
      },
    ])
    await expect(writeMigrationLedger(ambiguous, db)).rejects.toThrow(/ambiguous/i)

    const familyError = makeReport([
      {
        familyId: FAMILY_A,
        totalSources: 1,
        counts: { exact: 1, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 },
        eventsBuilt: 1,
        members: {},
        displayedProvided: false,
        error: 'reader malformed source',
      },
    ])
    await expect(writeMigrationLedger(familyError, db)).rejects.toThrow(/unapproved/i)

    // No partial writes must remain after a closed failure.
    expect((await readLedger(db, FAMILY_A))).toHaveLength(0)
  })

  it('assertApprovedGate1 rejects a report with zero sources', () => {
    const empty = makeReport([])
    expect(() => assertApprovedGate1(empty)).toThrow(/Gate 1/)
  })
})

// --- REAL Firestore emulator integration ------------------------------------
const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const describeEmulator = emulatorAvailable ? describe : describe.skip

describeEmulator('Task 5.1 — writeMigrationLedger (real Firestore emulator)', () => {
  let app: App
  let db: Firestore

  beforeAll(async () => {
    app = initializeApp({ projectId: 'familyquest-beta-402cb' }, 'v4-write-ledger-integration')
    db = getFirestore(app)
  })
  afterAll(async () => {
    if (app) await deleteApp(app)
  })

  it('first run writes deterministic events and exactly one state per member', async () => {
    const report = makeReport([
      {
        familyId: FAMILY_A,
        totalSources: 1,
        counts: { exact: 1, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 },
        eventsBuilt: 1,
        members: { 'mem-1': memberReport(521, 546) },
        displayedProvided: false,
      },
    ])
    const result = await writeMigrationLedger(report, db)
    expect(result.eventsWritten).toBe(1)
    expect(result.statesWritten).toBe(1)

    const ledger = await readLedger(db, FAMILY_A)
    expect(ledger).toHaveLength(1)
    expect(ledger[0].eventId).toBe(eventIdFor(FAMILY_A, 'mem-1', 'MIGRATION_BASELINE', 'BASELINE'))

    const state = await readState(db, FAMILY_A, 'mem-1')
    expect(state).not.toBeNull()
    const rebuilt = rebuildStateFromLedger(ledger, { updatedAt: '1970-01-01T00:00:00.000Z', projectionVersion: 1 })
    expect(businessFields(state as GamificationStateV4)).toEqual(businessFields(rebuilt))

    // No root-level gamification_state document.
    const legacy = await db.doc(`${STATE_V4_COLLECTION_ID}/mem-1`).get()
    expect(legacy.exists).toBe(false)
  })

  it('second run is idempotent: no duplicate event ids, identical state', async () => {
    const report = makeReport([
      {
        familyId: FAMILY_A,
        totalSources: 1,
        counts: { exact: 1, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 },
        eventsBuilt: 1,
        members: { 'mem-1': memberReport(521, 546) },
        displayedProvided: false,
      },
    ])
    await writeMigrationLedger(report, db)
    const firstState = await readState(db, FAMILY_A, 'mem-1')
    await writeMigrationLedger(report, db)

    const ledger = await readLedger(db, FAMILY_A)
    expect(ledger).toHaveLength(1)
    const ids = new Set(ledger.map((e: GamificationEventV4) => e.eventId))
    expect(ids.size).toBe(ledger.length)
    const secondState = await readState(db, FAMILY_A, 'mem-1')
    expect(businessFields(secondState as GamificationStateV4)).toEqual(businessFields(firstState as GamificationStateV4))
  })
})
