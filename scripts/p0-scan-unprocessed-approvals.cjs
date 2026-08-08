#!/usr/bin/env node
/**
 * P0 READ-ONLY production scan — identify approved task completions that were
 * never processed by the canonical gamification processor.
 *
 * Performs ONLY .get() reads. Creates/writes NOTHING. Touches NO wallet data.
 *
 * Condition (exactly as specified by the recovery brief):
 *   status == 'approved'
 *   AND gamificationProcessedAt is missing/null
 *
 * Eligibility is decided by the SINGLE shared classifier
 * (`functions/src/recoveryEligibility.ts :: classifyRecoveryCompletion`), which
 * is a faithful, side-effect-free mirror of `processApprovedCompletion`. This
 * guarantees the dry-run prediction EXACTLY matches what the canonical processor
 * would do — including the immutable daily-eligibility snapshot check that the
 * original scanner omitted (the P0 false-positive root cause).
 *
 * Usage: node scripts/p0-scan-unprocessed-approvals.cjs [--family=ID]
 */
const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const svc = require('./../firebase-key.json')

initializeApp({ credential: cert(svc), projectId: svc.project_id || 'familyquest-beta-402cb' })
const db = getFirestore()

const FAMILY_FILTER = (process.argv.find((a) => a.startsWith('--family=')) || '').split('=')[1] || null

const { classifyRecoveryCompletion } = require('./../functions/lib/functions/src/recoveryEligibility')
const { resolveGamificationConfig } = require('./../functions/lib/src/domain/gamification/config')
const { familyDayKey } = require('./../functions/lib/src/domain/gamification/dailyProgress')

const ms = (value) => {
  if (!value) return null
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  return null
}
const iso = (value) => (ms(value) === null ? null : new Date(ms(value)).toISOString())

const optionalMillis = (value) => (value === undefined || value === null ? undefined : ms(value))

/** Map a raw Firestore task document to the adapter's RepositoryScheduledTask shape. */
function toScheduledTask(doc) {
  const d = doc.data ? doc.data() : doc
  return {
    id: doc.id,
    assigneeId: typeof d.assigneeId === 'string' && d.assigneeId.length > 0 ? d.assigneeId : undefined,
    pointsReward: d.pointsReward,
    requiresApproval: typeof d.requiresApproval === 'boolean' ? d.requiresApproval : undefined,
    type: typeof d.type === 'string' ? d.type : undefined,
    isActive: d.isActive === true,
    status: typeof d.status === 'string' ? d.status : undefined,
    archived: d.archived === true,
    isArchived: d.isArchived === true,
    deleted: d.deleted === true,
    disabled: d.disabled === true,
    archivedAt: optionalMillis(d.archivedAt),
    deletedAt: optionalMillis(d.deletedAt),
    disabledAt: optionalMillis(d.disabledAt),
    createdAt: optionalMillis(d.createdAt),
    effectiveFrom: typeof d.effectiveFrom === 'string' ? d.effectiveFrom : undefined,
    effectiveTo: typeof d.effectiveTo === 'string' ? d.effectiveTo : undefined,
    effectiveFromAt: typeof d.effectiveFrom === 'string' ? undefined : optionalMillis(d.effectiveFrom),
    effectiveToAt: typeof d.effectiveTo === 'string' ? undefined : optionalMillis(d.effectiveTo),
    dueDate: typeof d.dueDate === 'string' ? d.dueDate : undefined,
    dueWeekday: Number.isInteger(d.dueWeekday) ? d.dueWeekday : undefined,
    customDays: Array.isArray(d.customDays) ? d.customDays : undefined,
  }
}

async function main() {
  const familyIds = FAMILY_FILTER ? [FAMILY_FILTER] : (await db.collection('families').get()).docs.map((d) => d.id)

  const completions = []
  const perMember = {} // `${familyId}/${childId}` -> { expected, raw, count }
  const families = {}

  for (const familyId of familyIds) {
    const familyDoc = await db.doc(`families/${familyId}`).get()
    if (!familyDoc.exists) continue
    const family = familyDoc.data()
    const migration = family.gamificationMigration || {}
    const status = migration.status || 'inactive'
    const cutoverAt = ms(migration.cutoverAt)
    const timezone = typeof family.timezone === 'string' && family.timezone.length ? family.timezone : 'Europe/London'
    const dailyGoalPercentage = (() => {
      try { return resolveGamificationConfig(family.gamification).dailyGoalPercentage } catch { return 80 }
    })()
    families[familyId] = { migrationStatus: status, cutoverAt: cutoverAt === null ? null : new Date(cutoverAt).toISOString(), timezone }

    // All family tasks (needed to build the expected snapshot when none is frozen yet).
    const allTasksSnap = await db.collection(`families/${familyId}/tasks`).get()
    const familyTasks = allTasksSnap.docs.map(toScheduledTask)

    // All daily_eligibility snapshots for the family, keyed by `${childId}:${dayKey}`.
    const eligSnap = await db.collection(`families/${familyId}/daily_eligibility`).get()
    const eligById = new Map()
    for (const d of eligSnap.docs) eligById.set(d.id, d.data())

    // Build a completionId -> occurrence map for exact idempotency detection.
    const occSnap = await db.collection(`families/${familyId}/task_occurrences`).get()
    const occByCompletion = new Map()
    for (const d of occSnap.docs) {
      const c = d.data().completionId
      if (typeof c === 'string') occByCompletion.set(c, d.id)
    }

    const compSnap = await db.collection(`families/${familyId}/task_completions`).where('status', '==', 'approved').get()

    for (const document of compSnap.docs) {
      const data = document.data()
      const processedAt = data.gamificationProcessedAt
      const isProcessed = processedAt !== undefined && processedAt !== null
      if (isProcessed) continue // only unprocessed

      const childId = data.assigneeId
      const taskId = data.taskId
      const approvedAt = ms(data.approvedAt)
      const completedAt = ms(data.completedAt)

      // Read task + child for the trusted reward plan and gating.
      const [taskDoc, childDoc] = await Promise.all([
        typeof taskId === 'string' ? db.doc(`families/${familyId}/tasks/${taskId}`).get() : { exists: false },
        typeof childId === 'string' ? db.doc(`users/${childId}`).get() : { exists: false },
      ])

      const task = taskDoc.exists ? taskDoc.data() : null
      const child = childDoc.exists ? childDoc.data() : null
      const currentRewardPoints = child && typeof child.rewardPoints === 'number' ? child.rewardPoints : null

      const taskScheduled = task ? toScheduledTask(taskDoc) : null
      const dayKey = completedAt === null ? null : familyDayKey(completedAt, timezone)
      const existingSnapshot = dayKey && childId ? (eligById.get(`${childId}:${dayKey}`) || null) : null

      // Single source of truth: the shared classifier mirrors processApprovedCompletion.
      const result = classifyRecoveryCompletion({
        familyId,
        childId: childId ?? '',
        taskId: taskId ?? '',
        taskPointsReward: task && typeof task.pointsReward === 'number' ? task.pointsReward : Number.NaN,
        migrationStatus: status,
        cutoverAt,
        approvedAt: approvedAt ?? Number.NaN,
        child: child ? {
          role: child.role, status: child.status, disabled: child.disabled, familyId: child.familyId,
        } : null,
        task: taskScheduled,
        existingSnapshot: existingSnapshot ? { taskWeights: existingSnapshot.taskWeights } : null,
        familyTasks,
        timezone,
        completedAt: completedAt ?? Number.NaN,
        processingAt: Date.now(),
        dailyGoalPercentage,
      })

      const wouldAward = result.eligible
      const gateReason = result.reason

      const expectedAward = wouldAward ? (task && typeof task.pointsReward === 'number' ? task.pointsReward : 0) : 0
      const hasOccurrence = occByCompletion.has(document.id)
      const key = `${familyId}/${childId ?? '<no-child>'}`
      if (!perMember[key]) perMember[key] = { familyId, childId: childId ?? null, expected: 0, raw: 0, count: 0, wouldAwardCount: 0 }
      perMember[key].raw += typeof task && typeof task.pointsReward === 'number' ? task.pointsReward : 0
      perMember[key].count += 1
      if (wouldAward) {
        perMember[key].expected += expectedAward
        perMember[key].wouldAwardCount += 1
      }

      completions.push({
        familyId,
        completionId: document.id,
        assigneeId: childId ?? null,
        taskId: taskId ?? null,
        approvedAt: iso(data.approvedAt),
        awardedPoints: data.awardedPoints ?? null,
        hasEffectSnapshot: data.gamificationEffectSnapshot !== undefined,
        currentRewardPoints,
        wouldAward,
        gateReason,
        expectedAward,
        idempotentEffectExists: hasOccurrence,
        occurrenceDocId: hasOccurrence ? occByCompletion.get(document.id) : null,
        taskPointsReward: task && typeof task.pointsReward === 'number' ? task.pointsReward : null,
      })
    }
  }

  const totalUnprocessed = completions.length
  const wouldAwardCount = completions.filter((c) => c.wouldAward).length
  const alreadyHaveEffect = completions.filter((c) => c.idempotentEffectExists).length
  const totalExpected = Object.values(perMember).reduce((s, m) => s + m.expected, 0)

  const report = {
    mode: 'READ_ONLY',
    generatedAt: new Date().toISOString(),
    condition: "status == 'approved' AND gamificationProcessedAt missing/null",
    totals: {
      familiesScanned: familyIds.length,
      unprocessedApprovals: totalUnprocessed,
      wouldBeAwardedByProcessor: wouldAwardCount,
      alreadyHaveIdempotentEffect: alreadyHaveEffect,
      totalExpectedMissingAwardPoints: totalExpected,
    },
    families,
    perMember: Object.values(perMember).sort((a, b) => b.expected - a.expected),
    completions,
  }

  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
