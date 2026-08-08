#!/usr/bin/env node
/**
 * READ-ONLY inspection of the 3 remaining divergent completions for
 * family 5s4Npeu55wPphLCsGAMP / child NuyIJDP9fDNP2LiKynlsEyzur5N2.
 * Performs ONLY .get() reads. Writes NOTHING.
 */
const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const svc = require('./../firebase-key.json')

initializeApp({ credential: cert(svc), projectId: svc.project_id || 'familyquest-beta-402cb' })
const db = getFirestore()

const FAMILY = '5s4Npeu55wPphLCsGAMP'
const CHILD = 'NuyIJDP9fDNP2LiKynlsEyzur5N2'

const ms = (v) => {
  if (!v) return null
  if (typeof v.toMillis === 'function') return v.toMillis()
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'number') return v
  return null
}
const iso = (v) => (ms(v) === null ? null : new Date(ms(v)).toISOString())

async function main() {
  const familyDoc = await db.doc(`families/${FAMILY}`).get()
  const family = familyDoc.data()
  const migration = family.gamificationMigration || {}
  console.log('MIGRATION:', JSON.stringify({ status: migration.status, cutoverAt: iso(migration.cutoverAt), timezone: family.timezone }))

  // All approved completions for this child
  const compSnap = await db.collection(`families/${FAMILY}/task_completions`)
    .where('status', '==', 'approved').get()
  const childComps = compSnap.docs.filter(d => d.data().assigneeId === CHILD)
  console.log(`\nAPPROVED COMPLETIONS for child: ${childComps.length}`)
  for (const d of childComps) {
    const c = d.data()
    console.log(`\n--- completion ${d.id} ---`)
    console.log(JSON.stringify({
      status: c.status,
      taskId: c.taskId,
      assigneeId: c.assigneeId,
      completedAt: iso(c.completedAt),
      approvedAt: iso(c.approvedAt),
      gamificationProcessedAt: iso(c.gamificationProcessedAt),
      awardedPoints: c.awardedPoints,
      hasEffectSnapshot: c.gamificationEffectSnapshot !== undefined,
      gamificationDayKey: c.gamificationDayKey,
    }, null, 2))
  }

  // Tasks referenced
  const taskIds = [...new Set(childComps.map(d => d.data().taskId).filter(Boolean))]
  console.log(`\nTASKS referenced: ${taskIds.join(', ')}`)
  for (const tid of taskIds) {
    const t = await db.doc(`families/${FAMILY}/tasks/${tid}`).get()
    if (!t.exists) { console.log(`  task ${tid}: MISSING`); continue }
    const td = t.data()
    console.log(`  task ${tid}:`, JSON.stringify({
      assigneeId: td.assigneeId,
      pointsReward: td.pointsReward,
      type: td.type,
      isActive: td.isActive,
      status: td.status,
      archived: td.archived,
      deleted: td.deleted,
      createdAt: iso(td.createdAt),
      dueDate: td.dueDate,
    }))
  }

  // daily_eligibility snapshots for this child
  const eligSnap = await db.collection(`families/${FAMILY}/daily_eligibility`).where('childId', '==', CHILD).get()
  console.log(`\ndaily_eligibility docs for child: ${eligSnap.size}`)
  for (const d of eligSnap.docs) {
    const e = d.data()
    console.log(`  ${d.id}:`, JSON.stringify({
      dayKey: e.dayKey,
      eligibleTaskCount: e.eligibleTaskCount,
      eligiblePoints: e.eligiblePoints,
      taskWeights: e.taskWeights,
    }))
  }

  // task_occurrences for this child
  const occSnap = await db.collection(`families/${FAMILY}/task_occurrences`).where('childId', '==', CHILD).get()
  console.log(`\ntask_occurrences for child: ${occSnap.size}`)
  for (const d of occSnap.docs) {
    const o = d.data()
    console.log(`  ${d.id}:`, JSON.stringify({ taskId: o.taskId, completionId: o.completionId, dayKey: o.dayKey, logicalCompletionKey: o.logicalCompletionKey }))
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
