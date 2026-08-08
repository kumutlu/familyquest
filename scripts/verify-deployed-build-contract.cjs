#!/usr/bin/env node
/**
 * Post-deploy contract check against a DISPOSABLE emulator family.
 *
 * This exercises the exact COMPILED artefact that was uploaded to Cloud
 * Functions (`functions/lib/**`), not the TypeScript sources, so it proves the
 * deployed build honours the shared-task and behaviour contracts.
 *
 * It never touches production: it requires FIRESTORE_EMULATOR_HOST and uses a
 * throwaway project id and family id.
 */
const assert = require('node:assert/strict')

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Refusing to run: FIRESTORE_EMULATOR_HOST must be set (disposable emulator only).')
  process.exit(1)
}

const { initializeApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const { AdminGamificationRepository } = require('../functions/lib/functions/src/gamificationRepository')
const { AdminBehaviourRepository } = require('../functions/lib/functions/src/behaviourRepository')
const { processApprovedCompletion } = require('../functions/lib/functions/src/gamificationProcessor')

const PROJECT_ID = `disposable-contract-${Date.now()}`
const FAMILY = 'disposable-family'
const CHILD_A = 'disposable-child-a'
const CHILD_B = 'disposable-child-b'
const COMPLETED_AT = Timestamp.fromMillis(Date.parse('2026-07-23T09:00:00Z'))
const APPROVED_AT = Timestamp.fromMillis(Date.parse('2026-07-23T10:00:00Z'))
const CUTOVER = Timestamp.fromMillis(APPROVED_AT.toMillis() - 1)

async function main() {
  const app = initializeApp({ projectId: PROJECT_ID }, PROJECT_ID)
  const db = getFirestore(app)

  await db.doc(`families/${FAMILY}`).set({
    name: 'Disposable', timezone: 'Europe/London',
    gamification: { schemaVersion: 1, dailyGoalPercentage: 80 },
    gamificationMigration: { schemaVersion: 1, status: 'prepared', cutoverAt: CUTOVER },
  })
  await db.doc(`users/${CHILD_A}`).set({ familyId: FAMILY, role: 'child', status: 'active', rewardPoints: 0, lifetimeXP: 0 })
  await db.doc(`users/${CHILD_B}`).set({ familyId: FAMILY, role: 'child', status: 'active', rewardPoints: 0, lifetimeXP: 0 })
  await db.doc(`families/${FAMILY}/tasks/shared`).set({
    title: 'Shared chore', pointsReward: 20, requiresApproval: true, type: 'daily', isActive: true,
    createdAt: Timestamp.fromMillis(Date.parse('2026-07-22T09:00:00Z')),
  })
  await db.doc(`families/${FAMILY}/task_completions/shared-completion`).set({
    taskId: 'shared', assigneeId: CHILD_A, status: 'approved', periodKey: 'client',
    completedAt: COMPLETED_AT, approvedAt: APPROVED_AT, reviewedBy: 'parent',
  })

  const repository = new AdminGamificationRepository(db)
  const first = await processApprovedCompletion({ repository, now: () => APPROVED_AT.toMillis() + 1 },
    { familyId: FAMILY, completionId: 'shared-completion' })
  const second = await processApprovedCompletion({ repository, now: () => APPROVED_AT.toMillis() + 2 },
    { familyId: FAMILY, completionId: 'shared-completion' })
  assert.equal(first.status, 'processed', 'deployed build must award an unassigned shared task')
  assert.equal(second.status, 'duplicate', 'deployed build must be idempotent')
  const childA = (await db.doc(`users/${CHILD_A}`).get()).data()
  assert.equal(childA.rewardPoints, 20)

  await db.doc(`families/${FAMILY}/behaviour_events/behaviour-1`).set({
    childId: CHILD_B, type: 'positive', pointsDelta: 20, reason: 'contract', createdAt: APPROVED_AT, createdBy: 'parent',
  })
  const behaviour = new AdminBehaviourRepository(db)
  const behaviourFirst = await behaviour.processBehaviourEvent({
    familyId: FAMILY, behaviourEventId: 'behaviour-1', processingAt: APPROVED_AT.toMillis() + 3,
  })
  const behaviourSecond = await behaviour.processBehaviourEvent({
    familyId: FAMILY, behaviourEventId: 'behaviour-1', processingAt: APPROVED_AT.toMillis() + 4,
  })
  assert.equal(behaviourFirst.status, 'processed')
  assert.equal(behaviourSecond.status, 'duplicate')
  const childB = (await db.doc(`users/${CHILD_B}`).get()).data()
  const summaryB = (await db.doc(`families/${FAMILY}/gamification_summaries/${CHILD_B}`).get()).data()
  assert.equal(childB.rewardPoints, 20)
  assert.equal(childB.lifetimeXP, 20)
  assert.equal(summaryB.xpTotal, 20, 'lifetimeXP and xpTotal must not diverge')

  console.log(JSON.stringify({
    contract: 'deployed-build',
    projectId: PROJECT_ID,
    sharedTaskAward: { status: first.status, retry: second.status, rewardPoints: childA.rewardPoints },
    behaviourAward: { status: behaviourFirst.status, retry: behaviourSecond.status, rewardPoints: childB.rewardPoints, lifetimeXP: childB.lifetimeXP, xpTotal: summaryB.xpTotal },
    result: 'PASS',
  }, null, 2))
}

main().catch(error => { console.error(error); process.exit(1) })
