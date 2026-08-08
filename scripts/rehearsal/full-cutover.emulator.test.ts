/**
 * Gamification V4 — Phase 5: FULL PRE-CUTOVER REHEARSAL on the real emulator.
 *
 * This is the dress rehearsal for the real pilot. It runs the complete operator
 * sequence, end to end, against a live Firestore emulator, in ONE process, with
 * NO restart and NO redeploy between the steps:
 *
 *    1. build the Gate 1 evidence artifact (Phase 1)
 *    2. migration DRY RUN            — plan only, zero writes, no marker
 *    3. migration EXECUTE            — family-scoped V4 ledger + state
 *    4. wallet hash equality         — BEFORE == AFTER (hashes only)
 *    5. migration marker             — written, bound to the Gate 1 hash
 *    6. Stage 6 verification         — READ ONLY, passes
 *    7. activate `task_approval`     — for ONE family, on that evidence
 *    8. one approval routes to V4    — through the real routing shim
 *    9. duplicate delivery           — no-op, still exactly one event
 *   10. INSTANT rollback to legacy   — one write, no redeploy
 *   11. the next approval is LEGACY  — same process, no restart
 *   12. no dual write, ever          — legacy never ran while routed to V4 and
 *                                      V4 never ran again after the rollback;
 *                                      V4 data survives the rollback.
 *
 * Skipped automatically when no emulator is running.
 * It never touches production: the Admin SDK here can only reach the emulator.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deleteApp, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

import { buildGate1Artifact, type Gate1Artifact } from '../gate1/gate1-artifact'
import { runFamilyMigration } from '../migrate/production-migration'
import { migrationMarkerDocPath } from '../migrate/migration-marker'
import { verifyPreCutoverProduction } from '../verify/production-verify'
import type { ProductionReplayReport } from '../replay/production-report'

import {
  activateWriterCutover,
  rollbackWriterCutover,
  cutoverAuditDocPath,
} from '../../functions/src/gamification/cutoverAdmin'
import { createCutoverResolver } from '../../functions/src/gamification/runtimeCutoverConfig'
import { installRuntimeCutoverResolver } from '../../functions/src/gamification/runtimeCutoverWiring'
import { setRouteResolver } from '../../functions/src/gamification/routingShim'
import { cutoverConfigDocPath } from '../../functions/src/gamification/v4/cutoverConfig'
import { applyTaskApprovalV4 } from '../../functions/src/gamification/v4/taskApprovalWriter'
import { readLedger, readState } from '../../functions/src/gamification/v4/repository'
import {
  processApprovedCompletion,
  type GamificationProcessorDependencies,
  type GamificationProcessResult,
  type ProcessApprovedCompletionArgs,
} from '../../functions/src/gamificationProcessor'

const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const describeEmulator = emulatorAvailable ? describe : describe.skip

const FAMILY = 'fam-phase5-rehearsal'
const MEMBER = 'mem-phase5-1'
const OPERATOR = 'rehearsal-operator@local'
/** Short on purpose: the rehearsal asserts the rollback latency bound. */
const TTL_MS = 5

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

function replayReport(): ProductionReplayReport {
  const counts = { exact: 1, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 }
  return {
    generatedAt: '2026-08-01T00:00:00.000Z',
    schemaVersion: 4,
    gate: 'GATE_1_REACHED',
    totalFamilies: 1,
    totalSources: 1,
    totalEventsBuilt: 1,
    counts,
    families: [
      {
        familyId: FAMILY,
        totalSources: 1,
        counts,
        eventsBuilt: 1,
        members: { [MEMBER]: member(100, 200, MEMBER) },
        displayedProvided: true,
      },
    ],
    walletSnapshot: null,
  } as unknown as ProductionReplayReport
}

/** A REAL (test) owner approval — never fabricated production evidence. */
function gate1Artifact(): Gate1Artifact {
  return buildGate1Artifact({
    source: replayReport() as never,
    approval: {
      approvedBy: 'rehearsal-owner@local',
      approvedAt: new Date().toISOString(),
      approvalRef: 'phase-5-emulator-rehearsal',
    },
    now: () => Date.now(),
  })
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describeEmulator('Phase 5 — full pre-cutover rehearsal on the real emulator', () => {
  let app: App
  let db: Firestore
  let gate1: Gate1Artifact
  const report = replayReport()

  /** Legacy writer double: records every legacy authoritative call. */
  const legacyCalls: ProcessApprovedCompletionArgs[] = []
  /** V4 engine double: delegates to the REAL V4 writer. */
  const v4Calls: ProcessApprovedCompletionArgs[] = []

  let dependencies: GamificationProcessorDependencies

  beforeAll(async () => {
    app = initializeApp({ projectId: 'familyquest-beta-402cb' }, 'phase5-rehearsal')
    db = getFirestore(app)
    // The rehearsal always starts from a clean, isolated rehearsal family so it
    // is repeatable. Emulator only — this path cannot reach production.
    await db.recursiveDelete(db.collection('families').doc(FAMILY))
    gate1 = gate1Artifact()

    dependencies = {
      now: () => Date.now(),
      repository: {
        async processApprovedCompletion(args): Promise<GamificationProcessResult> {
          legacyCalls.push(args)
          return { status: 'processed' }
        },
        async processTaskInvalidation(): Promise<GamificationProcessResult> {
          return { status: 'ignored' }
        },
        async recordProcessorFailure(): Promise<void> {},
      },
      v4TaskApproval: {
        async processApprovedCompletion(args): Promise<GamificationProcessResult> {
          v4Calls.push(args)
          const result = await applyTaskApprovalV4(db, {
            familyId: args.familyId,
            memberId: MEMBER,
            completionId: args.completionId,
            taskId: 'task-phase5',
            rewardPointsDelta: 10,
            xpDelta: 10,
            effectiveAt: '2026-08-08T12:00:00.000Z',
            createdAt: '2026-08-08T12:00:00.000Z',
          })
          return { status: result.status }
        },
      },
    }

    // The DEPLOYED wiring (Phase 4): the runtime resolver is what the trigger
    // consults. Installed once, never reinstalled — proving "no redeploy".
    installRuntimeCutoverResolver(db)
    // Re-point at an identical resolver with a short TTL so the rehearsal can
    // assert the rollback LATENCY BOUND (one TTL) inside a test timeout.
    const resolver = createCutoverResolver({ db, ttlMs: TTL_MS })
    setRouteResolver({ resolve: (writer, familyId) => resolver.resolveRoute(writer, familyId) })
  })

  afterAll(async () => {
    if (app) await deleteApp(app)
  })

  // --- 1 -------------------------------------------------------------------
  it('1. produces an owner-approved Gate 1 artifact that classifies the family', () => {
    expect(gate1.reportHash).toMatch(/^[0-9a-f]{64}$/)
    expect(gate1.approvedBy).toBe('rehearsal-owner@local')
    expect(gate1.approvalRef).toBe('phase-5-emulator-rehearsal')
    const family = gate1.report.families.find((f) => f.familyId === FAMILY)
    expect(family?.classification).toBe('exact')
  })

  // --- 2 -------------------------------------------------------------------
  it('2. DRY RUN plans the migration and writes absolutely nothing', async () => {
    const result = await runFamilyMigration({ db, report, gate1, familyId: FAMILY })

    expect(result.dryRun).toBe(true)
    expect(result.executed).toBe(false)
    expect(result.eventsWritten).toBe(0)
    expect(result.marker).toBeNull()
    expect(result.plan.memberIds).toEqual([MEMBER])

    const marker = await db.doc(migrationMarkerDocPath(FAMILY)).get()
    expect(marker.exists).toBe(false)
    expect(await readLedger(db, FAMILY)).toEqual([])
  })

  // --- 3, 4, 5 -------------------------------------------------------------
  it('3-5. EXECUTE migrates the family, proves wallet equality and writes the marker', async () => {
    const result = await runFamilyMigration({
      db,
      report,
      gate1,
      familyId: FAMILY,
      operator: OPERATOR,
      execute: true,
    })

    // 3 — V4 ledger + state exist for exactly the reported members
    expect(result.executed).toBe(true)
    expect(result.eventsWritten).toBe(1)
    expect(result.statesWritten).toBe(1)
    const state = await readState(db, FAMILY, MEMBER)
    expect(state?.rewardPoints).toBe(100)
    expect(state?.xpTotal).toBe(200)

    // 4 — wallet hashes: BEFORE == AFTER (hashes only, no wallet value touched)
    expect(result.walletHashBefore).toBe(result.walletHashAfter)
    expect(result.walletHashOk).toBe(true)

    // 5 — marker present and bound to the approved Gate 1 hash
    expect(result.marker?.reportHash).toBe(gate1.reportHash)
    const marker = await db.doc(migrationMarkerDocPath(FAMILY)).get()
    expect(marker.exists).toBe(true)
    expect((marker.data() as { reportHash: string }).reportHash).toBe(gate1.reportHash)
  })

  // --- 6 -------------------------------------------------------------------
  let verdict: Awaited<ReturnType<typeof verifyPreCutoverProduction>>

  it('6. Stage 6 verification passes and is read-only', async () => {
    const ledgerBefore = await readLedger(db, FAMILY)

    verdict = await verifyPreCutoverProduction({
      db,
      familyId: FAMILY,
      report,
      gate1,
      operator: OPERATOR,
    })

    expect(verdict.readOnly).toBe(true)
    expect(verdict.gate1.valid).toBe(true)
    expect(verdict.gate2).toMatchObject({ markerPresent: true, boundToGate1: true, walletHashOk: true })
    expect(verdict.stage6?.checks.every((c) => c.passed)).toBe(true)
    expect(verdict.passed).toBe(true)

    // proven side-effect free
    expect(await readLedger(db, FAMILY)).toEqual(ledgerBefore)
  })

  // --- 7 -------------------------------------------------------------------
  it('7. activates ONLY task_approval for ONLY this family, on that evidence', async () => {
    const { config, audit } = await activateWriterCutover({
      db,
      familyId: FAMILY,
      writer: 'task_approval',
      operator: OPERATOR,
      evidence: {
        gate1: { valid: verdict.gate1.valid, reportHash: gate1.reportHash },
        gate2: verdict.gate2,
        stage6: { passed: verdict.passed },
      },
    })

    expect(config.status).toBe('active')
    expect(audit.action).toBe('activate')
    expect(audit.gate1Hash).toBe(gate1.reportHash)

    const stored = await db.doc(cutoverConfigDocPath(FAMILY)).get()
    expect((stored.data() as { status: string }).status).toBe('active')
    const auditDoc = await db.doc(cutoverAuditDocPath(FAMILY, `activate-${audit.at.replace(/[:.]/g, '-')}`)).get()
    expect(auditDoc.exists).toBe(true)
  })

  // --- 8 -------------------------------------------------------------------
  it('8. the very next approval routes to V4 — no restart, no redeploy', async () => {
    await sleep(TTL_MS * 3)

    const result = await processApprovedCompletion(dependencies, {
      familyId: FAMILY,
      completionId: 'completion-phase5-1',
    })

    expect(result.status).toBe('processed')
    expect(v4Calls).toHaveLength(1)
    expect(legacyCalls).toHaveLength(0)

    const approvals = (await readLedger(db, FAMILY)).filter((e) => e.eventType === 'TASK_APPROVED')
    expect(approvals).toHaveLength(1)
    expect((await readState(db, FAMILY, MEMBER))?.rewardPoints).toBe(110)
  })

  // --- 9 -------------------------------------------------------------------
  it('9. duplicate delivery of the same approval is a no-op', async () => {
    const again = await processApprovedCompletion(dependencies, {
      familyId: FAMILY,
      completionId: 'completion-phase5-1',
    })

    expect(again.status).toBe('duplicate')
    const approvals = (await readLedger(db, FAMILY)).filter((e) => e.eventType === 'TASK_APPROVED')
    expect(approvals).toHaveLength(1)
    expect((await readState(db, FAMILY, MEMBER))?.rewardPoints).toBe(110)
    expect(legacyCalls).toHaveLength(0)
  })

  // --- 10, 11, 12 ----------------------------------------------------------
  it('10-12. instant rollback returns the family to legacy with V4 data intact', async () => {
    const v4CallsAtRollback = v4Calls.length

    const { config, audit } = await rollbackWriterCutover({
      db,
      familyId: FAMILY,
      operator: OPERATOR,
      reason: 'phase 5 rehearsal rollback drill',
    })

    // 10 — one write, immediate, no redeploy
    expect(config.status).toBe('rolled_back')
    expect(audit.action).toBe('rollback')
    expect(audit.reason).toBe('phase 5 rehearsal rollback drill')

    // the resolver picks it up within one TTL
    await sleep(TTL_MS * 3)

    // 11 — the next approval, in the SAME process, uses the legacy writer
    const result = await processApprovedCompletion(dependencies, {
      familyId: FAMILY,
      completionId: 'completion-phase5-2',
    })
    expect(result.status).toBe('processed')
    expect(legacyCalls.map((c) => c.completionId)).toEqual(['completion-phase5-2'])

    // 12 — no dual write: V4 did not run for the legacy approval, and the V4
    // data written before the rollback is still there (nothing is deleted).
    expect(v4Calls).toHaveLength(v4CallsAtRollback)
    const approvals = (await readLedger(db, FAMILY)).filter((e) => e.eventType === 'TASK_APPROVED')
    expect(approvals).toHaveLength(1)
    expect((await readState(db, FAMILY, MEMBER))?.rewardPoints).toBe(110)
    expect((await db.doc(migrationMarkerDocPath(FAMILY)).get()).exists).toBe(true)
  })
})
