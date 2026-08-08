/**
 * Gamification V4 — route resolver REAL Firestore emulator integration test.
 *
 * Drives the real emulator (Admin SDK) end-to-end to prove the routing layer
 * resolves `legacy` / `v4` through the live cutover config + mandatory gate:
 *   - with the family cut over (all writers) the resolver returns `v4` for a
 *     writer AND only after `assertStage7Allowed` passes (gates green);
 *   - after `rollbackStage7` the same resolver returns `legacy` for every writer
 *     (instant rollback, no redeploy).
 *
 * Skipped automatically when no emulator is running; executed for real under
 * `firebase emulators:exec`. Emulator-gated, so it can never touch production.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deleteApp, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

import { resolveStage7WriterRoute } from './routeResolver'
import { activateStage7, readCutoverConfig } from './cutoverConfig'
import { rollbackStage7 } from './rollback'
import { isV4Active, withAllV4 } from '../../../../src/domain/gamification/v4/featureFlags'
import { writeMigrationLedger } from '../../../../scripts/migrate/write-v4-ledger'
import { verifyPreCutover, readMigrationMarker } from '../../../../scripts/verify/pre-cutover'
import type { ProductionReplayReport, ProductionFamilyReport } from '../../../../scripts/replay/production-report'

const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const describeEmulator = emulatorAvailable ? describe : describe.skip

const FAMILY = 'fam-route-int'
const MEMBER = 'mem-1'

function approvedReport(rp: number, xp: number): ProductionReplayReport {
  const family: ProductionFamilyReport = {
    familyId: FAMILY,
    totalSources: 1,
    counts: { exact: 1, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 },
    eventsBuilt: 1,
    members: {
      [MEMBER]: {
        memberId: MEMBER,
        replayed: {
          rewardPoints: rp, xpTotal: xp, level: 1, xpProgressInLevel: xp,
          xpToNextLevel: 1000, levelProgressPercentage: 0, currentStreak: 0,
          bestStreak: 0, lastQualifiedDayKey: null, unlockedAchievementIds: [],
          unlockedAvatarIds: [], projectionVersion: 1, foldedThroughEventId: null,
          updatedAt: '1970-01-01T00:00:00.000Z',
        },
      },
    },
    displayedProvided: false,
  }
  return {
    generatedAt: '1970-01-01T00:00:00.000Z', schemaVersion: 4, gate: 'GATE_1_REACHED',
    totalFamilies: 1, totalSources: 1, totalEventsBuilt: 1,
    counts: { exact: 1, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 },
    families: [family], walletSnapshot: null,
  }
}

describeEmulator('route resolver — real Firestore emulator', () => {
  let app: App
  let db: Firestore

  beforeAll(async () => {
    app = initializeApp({ projectId: 'familyquest-beta-402cb' }, 'v4-route-integration')
    db = getFirestore(app)
    await writeMigrationLedger(approvedReport(521, 546), db)
  })
  afterAll(async () => {
    if (app) await deleteApp(app)
  })

  it('resolves v4 for a cut-over family (gate mandatory) and legacy after rollback', async () => {
    const deps = {
      db,
      report: approvedReport(521, 546),
      familyId: FAMILY,
      verifyPreCutoverFn: verifyPreCutover,
      readMigrationMarkerFn: readMigrationMarker,
    }
    await activateStage7(db, FAMILY, { flags: withAllV4(), activatedBy: 'ops' })
    const cfg = await readCutoverConfig(db, FAMILY)
    expect(isV4Active(cfg.flags, 'behaviour', FAMILY)).toBe(true)

    // Route resolves to v4 only after the mandatory gate passes.
    expect(await resolveStage7WriterRoute(deps, 'behaviour', FAMILY)).toBe('v4')
    expect(await resolveStage7WriterRoute(deps, 'reward_redemption', FAMILY)).toBe('v4')

    // Instant rollback flips every route back to legacy (no redeploy).
    await rollbackStage7(db, FAMILY, 'integration test rollback', { by: 'ops' })
    for (const writer of ['task_approval', 'task_invalidation', 'day_finalization', 'behaviour', 'reward_redemption', 'challenge_claim', 'avatar_unlock'] as const) {
      expect(await resolveStage7WriterRoute(deps, writer, FAMILY)).toBe('legacy')
    }
  })
})
