/**
 * P0 emulator proof — V3 shadow reads must precede transaction writes.
 *
 * Runs the COMPILED AdminGamificationRepository against a REAL Firestore
 * emulator, recreating the confirmed "new test family" shape, and verifies the
 * authoritative reward balance actually commits.
 *
 * Run with:
 *   firebase emulators:exec --only firestore \
 *     "node scripts/p0-shadow-readafterwrite-emulator-proof.cjs"
 */
'use strict'

const { initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { AdminGamificationRepository } = require('../functions/lib/functions/src/gamificationRepository.js')

const FAMILY_ID = 'new-test-family'
const CHILD_ID = 'child-1'
const FAMILY_PATH = `families/${FAMILY_ID}`
const DAY_KEY = '2026-08-04'
const PROCESSING_AT = Date.parse('2026-08-04T12:00:00.000Z')
const V3_BASELINE_EVENT_ID = `legacy-baseline:${FAMILY_ID}:${CHILD_ID}:v3`
const BALANCE = 'rewardPoints'

const failures = []
function check(label, actual, expected) {
  const ok = actual === expected
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${expected}, got ${actual}`)
  if (!ok) failures.push(label)
}
function checkTruthy(label, actual) {
  const ok = Boolean(actual)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${ok ? 'present' : 'MISSING'}`)
  if (!ok) failures.push(label)
}

function completionId(taskId) {
  return `${CHILD_ID}__${taskId}__one-time:${DAY_KEY}`
}

async function seed(db) {
  const batch = db.batch()
  batch.set(db.doc(FAMILY_PATH), {
    name: 'New Test Family',
    timezone: 'Europe/London',
    gamificationMigration: {
      schemaVersion: 1, status: 'active', cutoverAt: new Date(PROCESSING_AT - 86400000),
    },
  })
  batch.set(db.doc(`users/${CHILD_ID}`), {
    familyId: FAMILY_ID, role: 'child', [BALANCE]: 0, lifetimeXP: 0,
    currentStreak: 0, longestStreak: 0,
  })
  batch.set(db.doc(`${FAMILY_PATH}/gamification_summaries/${CHILD_ID}`), {
    schemaVersion: 1, familyId: FAMILY_ID, childId: CHILD_ID, xpTotal: 0, level: 1,
    currentStreak: 0, bestStreak: 0, perfectDayCount: 0, lastQualifiedDayKey: null,
    projectionRevision: 1, foldedThrough: null, rebuildRequired: false,
    earliestDirtyCursor: null, projectionStatus: 'ready',
    updatedAt: new Date(PROCESSING_AT - 86400000),
  })

  // V3 shadow baseline (event + projection).
  batch.set(db.doc(`${FAMILY_PATH}/gamification_events_v3/${V3_BASELINE_EVENT_ID}`), {
    schemaVersion: 3, eventId: V3_BASELINE_EVENT_ID, eventType: 'LEGACY_BASELINE',
    familyId: FAMILY_ID, memberId: CHILD_ID, sourceType: 'bootstrap', sourceId: 'baseline',
    effectiveAt: '2026-08-03T00:00:00.000Z', createdAt: '2026-08-03T00:00:00.000Z',
    rewardPointsDelta: 0, xpDelta: 0, weeklyPointsDelta: 0,
    idempotencyKey: V3_BASELINE_EVENT_ID, metadata: {},
  })
  batch.set(db.doc(`${FAMILY_PATH}/gamification_state_v3/${CHILD_ID}`), {
    memberId: CHILD_ID, familyId: FAMILY_ID, [BALANCE]: 0, xpTotal: 0, weeklyPoints: 0,
    currentStreak: 0, bestStreak: 0, lastQualifiedDayKey: null, unlockedAvatarIds: [],
    weeklyWindowKey: '2026-W32', level: 1, xpProgressInLevel: 0, xpToNextLevel: 1000,
    levelProgressPercentage: 0, projectionVersion: 1,
    foldedThroughEventId: V3_BASELINE_EVENT_ID, updatedAt: '2026-08-03T00:00:00.000Z',
  })

  // Two +10 tasks plus a large unapproved task so the daily goal stays out of
  // reach and only the task rewards land.
  const tasks = { chores: 10, dishes: 10, homework: 100 }
  const taskWeights = {}
  let eligiblePoints = 0
  for (const [taskId, points] of Object.entries(tasks)) {
    batch.set(db.doc(`${FAMILY_PATH}/tasks/${taskId}`), {
      title: taskId, pointsReward: points, requiresApproval: true, isActive: true,
      type: 'one-time', createdAt: new Date(PROCESSING_AT - 86400000),
    })
    taskWeights[taskId] = points
    eligiblePoints += points
  }
  batch.set(db.doc(`${FAMILY_PATH}/daily_eligibility/${CHILD_ID}:${DAY_KEY}`), {
    schemaVersion: 1, familyId: FAMILY_ID, childId: CHILD_ID, dayKey: DAY_KEY,
    timezone: 'Europe/London', dailyGoalPercentage: 100, taskWeights,
    eligibleTaskCount: Object.keys(taskWeights).length, eligiblePoints,
    effectiveAt: new Date(PROCESSING_AT - 86400000), causalGroupId: 'causal-group-1',
    transitionRank: 0, createdAt: new Date(PROCESSING_AT - 86400000),
    createdBy: 'gamification-engine-v1',
  })

  for (const taskId of ['chores', 'dishes']) {
    batch.set(db.doc(`${FAMILY_PATH}/task_completions/${completionId(taskId)}`), {
      taskId, assigneeId: CHILD_ID, status: 'approved', periodKey: `one-time:${DAY_KEY}`,
      completedAt: new Date(PROCESSING_AT - 3600000), approvedAt: new Date(PROCESSING_AT),
      reviewedBy: 'parent-1', reviewedByName: 'Parent',
    })
  }
  await batch.commit()
}

async function main() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    console.error('Refusing to run: FIRESTORE_EMULATOR_HOST is not set.')
    process.exit(1)
  }
  console.log(`Firestore emulator: ${process.env.FIRESTORE_EMULATOR_HOST}`)
  initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'familyquest-beta-402cb' })
  const db = getFirestore()

  await seed(db)
  const repository = new AdminGamificationRepository(db)

  // ---- Approval 1: +10 ----
  const first = await repository.processApprovedCompletion({
    familyId: FAMILY_ID, completionId: completionId('chores'), processingAt: PROCESSING_AT,
  })
  check('approval 1 status', first.status, 'processed')
  let child = (await db.doc(`users/${CHILD_ID}`).get()).data()
  check('users balance after +10', child[BALANCE], 10)

  // ---- Approval 2: +10 ----
  const second = await repository.processApprovedCompletion({
    familyId: FAMILY_ID, completionId: completionId('dishes'), processingAt: PROCESSING_AT + 1000,
  })
  check('approval 2 status', second.status, 'processed')
  child = (await db.doc(`users/${CHILD_ID}`).get()).data()
  check('users balance after second +10', child[BALANCE], 20)

  // ---- Completion markers ----
  const completion = (await db.doc(`${FAMILY_PATH}/task_completions/${completionId('chores')}`).get()).data()
  checkTruthy('gamificationProcessedAt exists', completion.gamificationProcessedAt)
  checkTruthy('gamificationEffectSnapshot exists', completion.gamificationEffectSnapshot)
  check('awardedPoints', completion.awardedPoints, 10)

  // ---- Summary + shadow ----
  const summary = (await db.doc(`${FAMILY_PATH}/gamification_summaries/${CHILD_ID}`).get()).data()
  check('summary xpTotal', summary.xpTotal, 20)
  check('lifetimeXP mirrors xpTotal', child.lifetimeXP, summary.xpTotal)

  const shadow = (await db.doc(`${FAMILY_PATH}/gamification_state_v3/${CHILD_ID}`).get()).data()
  check('shadow xpTotal folded both events', shadow.xpTotal, 20)
  check('shadow projectionVersion advanced', shadow.projectionVersion, 3)

  const shadowEvents = await db.collection(`${FAMILY_PATH}/gamification_events_v3`).get()
  check('shadow events (baseline + 2 approvals)', shadowEvents.size, 3)

  // ---- Reward balance gate: child can spend at least 1 point ----
  check('child passes 1-point reward balance gate', child[BALANCE] >= 1, true)

  // ---- Idempotency: replay must not double-award ----
  const replay = await repository.processApprovedCompletion({
    familyId: FAMILY_ID, completionId: completionId('chores'), processingAt: PROCESSING_AT + 5000,
  })
  check('replay status', replay.status, 'duplicate')
  child = (await db.doc(`users/${CHILD_ID}`).get()).data()
  check('balance unchanged after replay', child[BALANCE], 20)

  console.log('')
  if (failures.length > 0) {
    console.error(`EMULATOR PROOF FAILED (${failures.length}): ${failures.join(', ')}`)
    process.exit(1)
  }
  console.log('EMULATOR PROOF PASSED — no "reads after writes" error; balance committed.')
  process.exit(0)
}

main().catch((error) => {
  console.error('EMULATOR PROOF ERRORED:', error)
  process.exit(1)
})
