// Phase 6 — Emulator-backed test for the legacy `savings_goals` field migration.
//
// Seeds a legacy (pre-v1) goal doc and an already-migrated v1 doc into the
// Firestore emulator, runs `migrateGoalFields` (dry-run then execute), and
// asserts:
//   1. the legacy doc receives the v1 fields (targetAmountPence, currentAmountPence,
//      kind, status, currency, version:1) derived from its legacy major-unit fields;
//   2. the already-v1 doc is left untouched (idempotent skip);
//   3. re-running the migration is a no-op (no further writes, version stays 1).
//
// The migration script uses the firebase-admin SDK, so this test drives the
// emulator entirely through the admin SDK (which bypasses security rules, as the
// production migration would). The emulator is started by `firebase emulators:exec`
// (see the Phase 6 run command).

import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { readFileSync } from 'fs'
import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest'
import { getFirestore as getAdminFirestore, FieldValue } from 'firebase-admin/firestore'
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { migrateGoalFields } from './migrate-goal-fields'

const PROJECT_ID = 'familyquest-goal-migration-test'
const FAMILY = 'family1'
const EMULATOR_HOST = '127.0.0.1:8080'

let testEnv: RulesTestEnvironment

// Point the firebase-admin SDK at the same emulator the rules test env starts.
process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST

function getAdminDb() {
  const name = `migrate-goal-fields-${PROJECT_ID}`
  const app = getApps().find(candidate => candidate.name === name)
    ?? initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID }, name)
  return getAdminFirestore(app)
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  })
})

afterAll(async () => {
  await testEnv.cleanup()
})

beforeEach(async () => {
  const adminDb = getAdminDb()
  await testEnv.clearFirestore()
  // Seed via admin (bypasses rules, as production migration does).
  await adminDb.doc(`families/${FAMILY}`).set({ name: 'Family 1' })
  // Legacy (pre-v1) goal: major-unit fields, no version/kind/status/currency/pence.
  await adminDb.doc(`families/${FAMILY}/savings_goals/legacyGoal`).set({
    title: 'Legacy Bike',
    childId: 'child1',
    targetAmount: 20, // £20 -> 2000p
    currentAmount: 5, // £5  -> 500p
    status: 'active',
  })
  // Already-migrated v1 goal: must be skipped.
  await adminDb.doc(`families/${FAMILY}/savings_goals/v1Goal`).set({
    goalId: 'v1Goal',
    title: 'Holiday',
    kind: 'family',
    targetAmountPence: 5000,
    currentAmountPence: 0,
    currency: 'GBP',
    status: 'active',
    version: 1,
  })
})

describe('migrate-goal-fields (emulator)', () => {
  it('backfills legacy doc with v1 fields and skips already-migrated doc', async () => {
    const adminDb = getAdminDb()
    const results = await migrateGoalFields(adminDb, {
      projectId: PROJECT_ID, familyId: FAMILY, execute: true,
    })

    expect(results).toHaveLength(1)
    expect(results[0].scanned).toBe(2)
    expect(results[0].migrated).toBe(1)
    expect(results[0].skipped).toBe(1)

    const legacySnap = await adminDb.doc(`families/${FAMILY}/savings_goals/legacyGoal`).get()
    const legacy = legacySnap.data()!
    expect(legacy.targetAmountPence).toBe(2000)
    expect(legacy.currentAmountPence).toBe(500)
    expect(legacy.kind).toBe('child')
    expect(legacy.status).toBe('active')
    expect(legacy.currency).toBe('GBP')
    expect(legacy.version).toBe(1)
    // Legacy major-unit fields preserved (not deleted).
    expect(legacy.targetAmount).toBe(20)
    expect(legacy.currentAmount).toBe(5)

    const v1Snap = await adminDb.doc(`families/${FAMILY}/savings_goals/v1Goal`).get()
    expect(v1Snap.data()!.version).toBe(1)
    expect(v1Snap.data()!.targetAmountPence).toBe(5000)
  })

  it('re-run is a no-op (idempotent)', async () => {
    const adminDb = getAdminDb()
    await migrateGoalFields(adminDb, { projectId: PROJECT_ID, familyId: FAMILY, execute: true })

    // Capture state, re-run, confirm nothing changes.
    const before = (await adminDb.doc(`families/${FAMILY}/savings_goals/legacyGoal`).get()).data()!
    const results2 = await migrateGoalFields(adminDb, {
      projectId: PROJECT_ID, familyId: FAMILY, execute: true,
    })
    expect(results2[0].migrated).toBe(0)
    expect(results2[0].skipped).toBe(2)

    const after = (await adminDb.doc(`families/${FAMILY}/savings_goals/legacyGoal`).get()).data()!
    expect(after).toEqual(before)
  })

  it('dry-run reports but does not mutate', async () => {
    const adminDb = getAdminDb()
    const results = await migrateGoalFields(adminDb, {
      projectId: PROJECT_ID, familyId: FAMILY, execute: false,
    })
    expect(results[0].migrated).toBe(1)

    const legacySnap = await adminDb.doc(`families/${FAMILY}/savings_goals/legacyGoal`).get()
    expect(legacySnap.data()!.version).toBeUndefined()
    expect(legacySnap.data()!.targetAmountPence).toBeUndefined()
  })
})
