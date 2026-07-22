import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore as getAdminFirestore, Timestamp } from 'firebase-admin/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { legacyBaselineEventId } from '../src/domain/gamification/xp'
import { migrateLegacyXp, planLegacyBaselineSummary, prepareGamificationMigration } from './migrate-legacy-xp'

const PROJECT_ID = 'familyquest-gamification-migration-test'
const FAMILY_A = 'family-a'
const FAMILY_B = 'family-b'
const CUTOVER_A = Timestamp.fromMillis(1_700_000_000_000)
const CUTOVER_B = Timestamp.fromMillis(1_700_100_000_000)
const FIRST_RUN = Timestamp.fromMillis(1_700_200_000_000)
const SECOND_RUN = Timestamp.fromMillis(1_700_300_000_000)

let testEnv: RulesTestEnvironment | undefined

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'

function adminDb() {
  const name = `migrate-legacy-xp-${PROJECT_ID}`
  const app = getApps().find(candidate => candidate.name === name)
    ?? initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID }, name)
  return getAdminFirestore(app)
}

function racingAdminDb() {
  const name = `migrate-legacy-xp-racer-${PROJECT_ID}`
  const app = getApps().find(candidate => candidate.name === name)
    ?? initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID }, name)
  return getAdminFirestore(app)
}

function cursor(effectiveAt: Timestamp, documentId: string, causalGroupId = documentId) {
  return { effectiveAt, causalGroupId, transitionRank: 0, documentId }
}

function baseline(familyId: string, childId: string, xpDelta: number, createdAt: Timestamp, effectiveAt = CUTOVER_A) {
  const id = legacyBaselineEventId(familyId, childId)
  return {
    schemaVersion: 1, familyId, childId, eventType: 'legacy_xp_baseline', xpDelta, sourceType: 'migration',
    sourceId: 'legacy_lifetime_xp', idempotencyKey: id, causalGroupId: id, effectiveAt, transitionRank: 0,
    configSchemaVersion: 1, createdBy: 'legacy-xp-migration-v1', createdAt, migratedAt: createdAt,
  }
}

async function familySnapshot() {
  const db = adminDb()
  const docs = async (path: string) => (await db.collection(path).get()).docs
    .map(document => ({ id: document.id, data: document.data() }))
    .sort((left, right) => left.id.localeCompare(right.id))
  return {
    familyA: (await db.doc(`families/${FAMILY_A}`).get()).data(),
    familyB: (await db.doc(`families/${FAMILY_B}`).get()).data(),
    users: await docs('users'),
    eventsA: await docs(`families/${FAMILY_A}/gamification_events`),
    summariesA: await docs(`families/${FAMILY_A}/gamification_summaries`),
    tasksA: await docs(`families/${FAMILY_A}/task_completions`),
  }
}

async function familyAScopeSnapshot() {
  const db = adminDb()
  const docs = async (path: string) => (await db.collection(path).get()).docs
    .map(document => ({ id: document.id, data: document.data() }))
    .sort((left, right) => left.id.localeCompare(right.id))
  return {
    family: (await db.doc(`families/${FAMILY_A}`).get()).data(),
    users: (await db.collection('users').where('familyId', '==', FAMILY_A).get()).docs
      .map(document => ({ id: document.id, data: document.data() }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    events: await docs(`families/${FAMILY_A}/gamification_events`),
    summaries: await docs(`families/${FAMILY_A}/gamification_summaries`),
  }
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  })
})

afterAll(async () => {
  await testEnv?.cleanup()
})

beforeEach(async () => {
  const db = adminDb()
  await testEnv!.clearFirestore()
  await Promise.all([
    db.doc(`families/${FAMILY_A}`).set({ name: 'A' }),
    db.doc(`families/${FAMILY_B}`).set({ name: 'B' }),
    db.doc('users/positive').set({ familyId: FAMILY_A, role: 'child', lifetimeXP: 125, rewardPoints: 7 }),
    db.doc('users/fresh').set({ familyId: FAMILY_A, role: 'child', lifetimeXP: 75 }),
    db.doc('users/zero').set({ familyId: FAMILY_A, role: 'child', lifetimeXP: 0 }),
    db.doc('users/missing').set({ familyId: FAMILY_A, role: 'child' }),
    db.doc('users/negative').set({ familyId: FAMILY_A, role: 'child', lifetimeXP: -1 }),
    db.doc('users/fraction').set({ familyId: FAMILY_A, role: 'child', lifetimeXP: 1.5 }),
    db.doc('users/nan').set({ familyId: FAMILY_A, role: 'child', lifetimeXP: Number.NaN }),
    db.doc('users/infinity').set({ familyId: FAMILY_A, role: 'child', lifetimeXP: Infinity }),
    db.doc('users/negative-infinity').set({ familyId: FAMILY_A, role: 'child', lifetimeXP: -Infinity }),
    db.doc('users/unsafe').set({ familyId: FAMILY_A, role: 'child', lifetimeXP: Number.MAX_SAFE_INTEGER + 1 }),
    db.doc('users/other-role').set({ familyId: FAMILY_A, role: 'parent', lifetimeXP: 999 }),
    db.doc('users/existing').set({ familyId: FAMILY_A, role: 'child', lifetimeXP: 50 }),
    db.doc('users/clean-existing').set({ familyId: FAMILY_A, role: 'child', lifetimeXP: 60 }),
    db.doc('users/foreign').set({ familyId: FAMILY_B, role: 'child', lifetimeXP: 333 }),
  ])
  await Promise.all([
    db.doc(`families/${FAMILY_A}/gamification_events/${legacyBaselineEventId(FAMILY_A, 'existing')}`).set(
      baseline(FAMILY_A, 'existing', 50, Timestamp.fromMillis(1_700_150_000_000)),
    ),
    db.doc(`families/${FAMILY_A}/gamification_events/${legacyBaselineEventId(FAMILY_A, 'clean-existing')}`).set(
      baseline(FAMILY_A, 'clean-existing', 60, Timestamp.fromMillis(1_700_151_000_000)),
    ),
    db.doc(`families/${FAMILY_A}/gamification_summaries/positive`).set({
      schemaVersion: 1, familyId: FAMILY_A, childId: 'positive', xpTotal: 999, level: 1, currentStreak: 0, bestStreak: 0,
      perfectDayCount: 0, lastQualifiedDayKey: null, projectionRevision: 8, foldedThrough: null, rebuildRequired: false,
      earliestDirtyCursor: cursor(Timestamp.fromMillis(1_700_400_000_000), 'later-event'), projectionStatus: 'ready', updatedAt: FIRST_RUN,
    }),
    db.doc(`families/${FAMILY_A}/gamification_summaries/clean-existing`).set({
      schemaVersion: 1, familyId: FAMILY_A, childId: 'clean-existing', xpTotal: 60, level: 1, currentStreak: 0, bestStreak: 0,
      perfectDayCount: 0, lastQualifiedDayKey: null, projectionRevision: 2, foldedThrough: null, rebuildRequired: false,
      earliestDirtyCursor: null, projectionStatus: 'ready', updatedAt: FIRST_RUN,
    }),
    db.doc(`families/${FAMILY_A}/gamification_events/live-post-cutover`).set({
      schemaVersion: 1, familyId: FAMILY_A, childId: 'positive', eventType: 'xp_awarded', xpDelta: 10,
      sourceType: 'task_completion', sourceId: 'completion-1', idempotencyKey: 'task_xp:completion-1', causalGroupId: 'live-group',
      effectiveAt: Timestamp.fromMillis(CUTOVER_A.toMillis() + 1), transitionRank: 0, configSchemaVersion: 1,
      createdBy: 'gamification-engine-v1', createdAt: FIRST_RUN,
    }),
    db.doc(`families/${FAMILY_A}/task_completions/pending-task`).set({ childId: 'positive', status: 'approved', pointsReward: 99 }),
  ])
})

describe('migrate-legacy-xp (emulator)', () => {
  it('permits absent or valid inactive metadata but fail-closes malformed and non-inactive metadata', async () => {
    const db = adminDb()
    await expect(prepareGamificationMigration(db, FAMILY_A, CUTOVER_A)).resolves.toMatchObject({ status: 'prepared', cutoverAt: CUTOVER_A })
    await expect(prepareGamificationMigration(db, FAMILY_A, CUTOVER_A)).rejects.toThrow(/inactive/)

    await db.doc(`families/${FAMILY_B}`).update({ gamificationMigration: { schemaVersion: 1, status: 'inactive' } })
    await expect(prepareGamificationMigration(db, FAMILY_B, CUTOVER_B)).resolves.toMatchObject({ status: 'prepared', cutoverAt: CUTOVER_B })
    await db.doc(`families/${FAMILY_B}`).update({ gamificationMigration: { schemaVersion: 999, status: 'inactive' } })
    const malformedBefore = (await db.doc(`families/${FAMILY_B}`).get()).data()!
    await expect(prepareGamificationMigration(db, FAMILY_B, CUTOVER_B)).rejects.toThrow(/malformed/)
    expect((await db.doc(`families/${FAMILY_B}`).get()).data()).toEqual(malformedBefore)
    await db.doc(`families/${FAMILY_B}`).update({ gamificationMigration: { schemaVersion: 1, status: 'baseline_complete', cutoverAt: CUTOVER_B } })
    await expect(prepareGamificationMigration(db, FAMILY_B, CUTOVER_B)).rejects.toThrow(/inactive/)
  })

  it('dry-runs comprehensively without writing any family, user, event, summary, or task document', async () => {
    const db = adminDb()
    await prepareGamificationMigration(db, FAMILY_A, CUTOVER_A)
    const before = await familySnapshot()
    const dryRun = await migrateLegacyXp(db, { familyId: FAMILY_A, execute: false, runAt: FIRST_RUN })
    expect(dryRun).toMatchObject({ families: 1, eligible: 4, created: 2, verified: 2, skipped: 8 })
    expect(await familySnapshot()).toEqual(before)
  })

  it('creates/recoveries per child, preserves operations timestamps, and uses one run timestamp for fresh children', async () => {
    const db = adminDb()
    await prepareGamificationMigration(db, FAMILY_A, CUTOVER_A)
    const existingId = legacyBaselineEventId(FAMILY_A, 'existing')
    const existingBefore = (await db.doc(`families/${FAMILY_A}/gamification_events/${existingId}`).get()).data()!
    const first = await migrateLegacyXp(db, { familyId: FAMILY_A, execute: true, runAt: FIRST_RUN })
    expect(first).toMatchObject({ families: 1, eligible: 4, created: 2, verified: 2, skipped: 8 })

    const positiveId = legacyBaselineEventId(FAMILY_A, 'positive')
    const freshId = legacyBaselineEventId(FAMILY_A, 'fresh')
    expect((await db.doc(`families/${FAMILY_A}/gamification_events/${positiveId}`).get()).data()).toEqual(baseline(FAMILY_A, 'positive', 125, FIRST_RUN))
    expect((await db.doc(`families/${FAMILY_A}/gamification_events/${freshId}`).get()).data()).toEqual(baseline(FAMILY_A, 'fresh', 75, FIRST_RUN))
    expect((await db.doc(`families/${FAMILY_A}/gamification_events/${existingId}`).get()).data()).toEqual(existingBefore)
    expect((await db.doc('users/positive').get()).data()).toMatchObject({ lifetimeXP: 125, rewardPoints: 7 })
    expect((await db.doc(`families/${FAMILY_A}/task_completions/pending-task`).get()).data()).toEqual({ childId: 'positive', status: 'approved', pointsReward: 99 })
    expect((await db.doc(`families/${FAMILY_A}/gamification_events/live-post-cutover`).get()).data()!.xpDelta).toBe(10)

    const positiveSummary = (await db.doc(`families/${FAMILY_A}/gamification_summaries/positive`).get()).data()!
    expect(positiveSummary).toMatchObject({ rebuildRequired: true, projectionStatus: 'rebuilding', earliestDirtyCursor: cursor(CUTOVER_A, positiveId) })
    const recoveredSummary = (await db.doc(`families/${FAMILY_A}/gamification_summaries/existing`).get()).data()!
    expect(recoveredSummary).toMatchObject({ rebuildRequired: true, projectionStatus: 'rebuilding', earliestDirtyCursor: cursor(CUTOVER_A, existingId) })
    const repairedCleanSummary = (await db.doc(`families/${FAMILY_A}/gamification_summaries/clean-existing`).get()).data()!
    expect(repairedCleanSummary).toMatchObject({ rebuildRequired: true, projectionStatus: 'rebuilding', earliestDirtyCursor: cursor(CUTOVER_A, legacyBaselineEventId(FAMILY_A, 'clean-existing')) })

    const rerun = await migrateLegacyXp(db, { familyId: FAMILY_A, execute: true, runAt: SECOND_RUN })
    expect(rerun).toMatchObject({ families: 1, eligible: 4, created: 0, verified: 4, skipped: 8 })
    expect((await db.doc(`families/${FAMILY_A}/gamification_events/${positiveId}`).get()).data()).toEqual(baseline(FAMILY_A, 'positive', 125, FIRST_RUN))
    expect((await db.doc(`families/${FAMILY_A}`).get()).data()!.gamificationMigration.status).toBe('prepared')
  })

  it.each([
    ['xpDelta', 51],
    ['effectiveAt', Timestamp.fromMillis(CUTOVER_A.toMillis() + 1)],
    ['sourceId', 'wrong-source'],
    ['sourceType', 'task_completion'],
    ['idempotencyKey', 'wrong-identity'],
    ['unexpected', 'field'],
  ])('rejects a conflicting deterministic baseline %s without overwriting it', async (field, value) => {
    const db = adminDb()
    await prepareGamificationMigration(db, FAMILY_A, CUTOVER_A)
    const eventRef = db.doc(`families/${FAMILY_A}/gamification_events/${legacyBaselineEventId(FAMILY_A, 'existing')}`)
    await eventRef.update({ [field]: value })
    const before = (await eventRef.get()).data()!
    await expect(migrateLegacyXp(db, { familyId: FAMILY_A, execute: true, runAt: SECOND_RUN })).rejects.toThrow(/conflicting immutable semantics/)
    expect((await eventRef.get()).data()).toEqual(before)
  })

  it('preserves a concurrent summary/live write under the emulator pessimistic lock', async () => {
    const db = adminDb()
    await prepareGamificationMigration(db, FAMILY_A, CUTOVER_A)
    let raced = false
    let readAttempts = 0
    let writerPromise: Promise<void> | undefined
    const raceCursor = cursor(Timestamp.fromMillis(CUTOVER_A.toMillis() - 1), 'concurrent-live-event', 'concurrent-group')
    await migrateLegacyXp(db, {
      familyId: FAMILY_A,
      execute: true,
      runAt: FIRST_RUN,
      afterChildTransactionRead: async ({ childId }) => {
        if (childId === 'positive') readAttempts += 1
        if (childId !== 'positive') return
        if (raced) {
          await writerPromise
          return
        }
        raced = true
        const writer = racingAdminDb()
        writerPromise = writer.runTransaction(async transaction => {
          const summary = await transaction.get(writer.doc(`families/${FAMILY_A}/gamification_summaries/positive`))
          expect(summary.exists).toBe(true)
          transaction.update(summary.ref, {
            rebuildRequired: true, projectionStatus: 'rebuilding', earliestDirtyCursor: raceCursor, updatedAt: FIRST_RUN,
          })
          transaction.create(writer.doc(`families/${FAMILY_A}/gamification_events/concurrent-live-event`), {
            schemaVersion: 1, familyId: FAMILY_A, childId: 'positive', eventType: 'xp_awarded', xpDelta: 1,
            sourceType: 'task_completion', sourceId: 'race-source', idempotencyKey: 'race-source', causalGroupId: 'concurrent-group',
            effectiveAt: raceCursor.effectiveAt, transitionRank: 0, configSchemaVersion: 1, createdBy: 'gamification-engine-v1', createdAt: FIRST_RUN,
          })
        })
      },
    })
    await writerPromise
    expect(raced).toBe(true)
    expect(readAttempts).toBe(1)
    expect((await db.doc(`families/${FAMILY_A}/gamification_summaries/positive`).get()).data()!.earliestDirtyCursor).toEqual(raceCursor)
    expect((await db.doc(`families/${FAMILY_A}/gamification_events/concurrent-live-event`).get()).data()).toMatchObject({ xpDelta: 1, sourceId: 'race-source' })
  })

  it('scopes writes to prepared families and refuses an unprepared/baseline-complete pass', async () => {
    const db = adminDb()
    await expect(migrateLegacyXp(db, { familyId: FAMILY_A, execute: true, runAt: FIRST_RUN })).rejects.toThrow(/prepared/)
    const familyABefore = await familyAScopeSnapshot()
    await prepareGamificationMigration(db, FAMILY_B, CUTOVER_B)
    const result = await migrateLegacyXp(db, { familyId: FAMILY_B, execute: true, runAt: FIRST_RUN })
    expect(result).toMatchObject({ families: 1, eligible: 1, created: 1, verified: 0 })
    expect((await db.doc(`families/${FAMILY_B}/gamification_events/${legacyBaselineEventId(FAMILY_B, 'foreign')}`).get()).data()).toMatchObject({ familyId: FAMILY_B, childId: 'foreign', xpDelta: 333, effectiveAt: CUTOVER_B })
    expect(await familyAScopeSnapshot()).toEqual(familyABefore)
    await db.doc(`families/${FAMILY_B}`).update({ gamificationMigration: { schemaVersion: 1, status: 'baseline_complete', cutoverAt: CUTOVER_B } })
    await expect(migrateLegacyXp(db, { familyId: FAMILY_B, execute: true, runAt: SECOND_RUN })).rejects.toThrow(/prepared/)
  })
})

describe('planLegacyBaselineSummary', () => {
  it('replans stale then concurrently dirtied summaries without losing the earlier cursor', () => {
    const baselineId = legacyBaselineEventId(FAMILY_A, 'positive')
    const baselineFact = { effectiveAt: CUTOVER_A, causalGroupId: baselineId, transitionRank: 0, idempotencyKey: baselineId }
    const staleSummary = {
      rebuildRequired: false,
      projectionStatus: 'ready',
      earliestDirtyCursor: cursor(Timestamp.fromMillis(CUTOVER_A.toMillis() + 1), 'later-event'),
    }
    const firstPlan = planLegacyBaselineSummary(staleSummary, FAMILY_A, 'positive', baselineFact, FIRST_RUN)
    expect(firstPlan.action).toBe('update')
    expect(firstPlan.dirtyCursor).toEqual(cursor(CUTOVER_A, baselineId))

    const concurrentSummary = {
      rebuildRequired: true,
      projectionStatus: 'rebuilding',
      earliestDirtyCursor: cursor(Timestamp.fromMillis(CUTOVER_A.toMillis() - 1), 'concurrent-event', 'concurrent-group'),
    }
    const secondPlan = planLegacyBaselineSummary(concurrentSummary, FAMILY_A, 'positive', baselineFact, FIRST_RUN)
    expect(secondPlan.action).toBe('none')
    expect(secondPlan.dirtyCursor).toEqual(concurrentSummary.earliestDirtyCursor)
  })
})
