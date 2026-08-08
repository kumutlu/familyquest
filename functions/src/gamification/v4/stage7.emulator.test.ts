/**
 * Gamification V4 — Stage 7 infrastructure emulator integration tests.
 *
 * Drives the REAL Firestore emulator (Admin SDK) end-to-end:
 *   - seeds a family via the Stage 5 ledger writer + Task 5.2 marker so
 *     `verifyPreCutover` (Stage 6) is green;
 *   - proves `assertStage7Allowed` PASSES when Gate 1 + Gate 2 + Stage 6 are
 *     green, and BLOCKS when Stage 6 is corrupted (the previously-advisory gate
 *     is now mandatory);
 *   - proves the runtime cutover config activates and the INSTANT rollback flips
 *     it back to all-legacy in a single write;
 *   - proves `purgeV4FamilyData` deletes the V4 ledger/state/marker.
 *
 * Skipped automatically when no emulator is running; executed for real under
 * `firebase emulators:exec`. Every writer here is emulator-gated, so it can
 * never touch production Firestore.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deleteApp, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

import { assertStage7Allowed, Stage7BlockedError } from './stage7Gate'
import {
  activateStage7,
  readCutoverConfig,
} from './cutoverConfig'
import { purgeV4FamilyData, rollbackStage7 } from './rollback'
import { isV4Active, withAllV4 } from '../../../../src/domain/gamification/v4/featureFlags'
import { writeMigrationLedger } from '../../../../scripts/migrate/write-v4-ledger'
import { migrationMarkerDocPath, type MigrationMarkerV4 } from '../../../../scripts/migrate/migration-marker'
import { verifyPreCutover, readMigrationMarker } from '../../../../scripts/verify/pre-cutover'
import type { ProductionReplayReport, ProductionFamilyReport } from '../../../../scripts/replay/production-report'

const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const describeEmulator = emulatorAvailable ? describe : describe.skip

const FAMILY = 'fam-stage7-int'
const MEMBER = 'mem-1'

function memberReport(rewardPoints: number, xpTotal: number): ProductionFamilyReport['members'][string] {
  return {
    memberId: MEMBER,
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

function approvedReport(rp: number, xp: number): ProductionReplayReport {
  const family: ProductionFamilyReport = {
    familyId: FAMILY,
    totalSources: 1,
    counts: { exact: 1, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 },
    eventsBuilt: 1,
    members: { [MEMBER]: memberReport(rp, xp) },
    displayedProvided: false,
  }
  return {
    generatedAt: '1970-01-01T00:00:00.000Z',
    schemaVersion: 4,
    gate: 'GATE_1_REACHED',
    totalFamilies: 1,
    totalSources: 1,
    totalEventsBuilt: 1,
    counts: { exact: 1, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 },
    families: [family],
    walletSnapshot: null,
  }
}

function goodMarker(): MigrationMarkerV4 {
  return {
    schemaVersion: 4,
    familyId: FAMILY,
    reportHash: 'deadbeef',
    status: 'MIGRATED',
    migratedAt: '1970-01-01T00:00:00.000Z',
    eventsWritten: 1,
    statesWritten: 1,
    walletHashBefore: 'abc',
    walletHashAfter: 'abc',
    walletHashOk: true,
    idempotent: true,
  }
}

describeEmulator('Stage 7 infrastructure — real Firestore emulator', () => {
  let app: App
  let db: Firestore

  beforeAll(async () => {
    app = initializeApp({ projectId: 'familyquest-beta-402cb' }, 'v4-stage7-integration')
    db = getFirestore(app)
  })
  afterAll(async () => {
    if (app) await deleteApp(app)
  })

  it('seeds a green family (ledger + marker) and the mandatory gate ALLOWS cutover', async () => {
    const report = approvedReport(521, 546)
    await writeMigrationLedger(report, db)
    await db.doc(migrationMarkerDocPath(FAMILY)).set(goodMarker())

    const readiness = await assertStage7Allowed({
      db,
      report,
      familyId: FAMILY,
      verifyPreCutoverFn: verifyPreCutover,
      readMigrationMarkerFn: readMigrationMarker,
    })
    expect(readiness.ready).toBe(true)
    expect(readiness.failedGates).toEqual([])
  })

  it('the mandatory gate BLOCKS when Stage 6 verifyPreCutover fails (corrupted state)', async () => {
    const report = approvedReport(521, 546)
    await writeMigrationLedger(report, db)
    await db.doc(migrationMarkerDocPath(FAMILY)).set(goodMarker())

    // Corrupt the stored projection so it diverges from the ledger rebuild.
    const stateRef = db.doc(`families/${FAMILY}/gamification_state/${MEMBER}`)
    const snap = await stateRef.get()
    const corrupted = { ...(snap.data() as Record<string, unknown>), rewardPoints: 999 }
    await stateRef.set(corrupted)

    await expect(
      assertStage7Allowed({
        db,
        report,
        familyId: FAMILY,
        verifyPreCutoverFn: verifyPreCutover,
        readMigrationMarkerFn: readMigrationMarker,
      }),
    ).rejects.toBeInstanceOf(Stage7BlockedError)
    // Repair for subsequent tests.
    await writeMigrationLedger(report, db)
  })

  it('runtime cutover config activates, then INSTANT rollback flips it to all-legacy', async () => {
    const activated = await activateStage7(db, FAMILY, { flags: withAllV4(), activatedBy: 'ops' })
    expect(activated.status).toBe('active')
    const cfg = await readCutoverConfig(db, FAMILY)
    expect(isV4Active(cfg.flags, 'behaviour', FAMILY)).toBe(true)

    const rolled = await rollbackStage7(db, FAMILY, 'integration test rollback', { by: 'ops' })
    expect(rolled.status).toBe('rolled_back')
    // Instant: every writer is legacy again, no redeploy.
    expect(isV4Active(rolled.flags, 'behaviour', FAMILY)).toBe(false)
    expect(isV4Active(rolled.flags, 'reward_redemption', FAMILY)).toBe(false)
  })

  it('data-level purge deletes the V4 ledger, state and marker', async () => {
    const report = approvedReport(521, 546)
    await writeMigrationLedger(report, db)
    await db.doc(migrationMarkerDocPath(FAMILY)).set(goodMarker())

    const result = await purgeV4FamilyData(db, FAMILY)
    expect(result.eventsDeleted).toBeGreaterThan(0)
    expect(result.statesDeleted).toBe(1)
    expect(result.markerDeleted).toBe(true)

    const stateSnap = await db.doc(`families/${FAMILY}/gamification_state/${MEMBER}`).get()
    expect(stateSnap.exists).toBe(false)
    const markerSnap = await db.doc(migrationMarkerDocPath(FAMILY)).get()
    expect(markerSnap.exists).toBe(false)
  })
})
