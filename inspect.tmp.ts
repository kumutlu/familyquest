import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

async function main() {
  const db = getFirestore(initializeApp({ credential: applicationDefault() }))
  const FAM = '5s4Npeu55wPphLCsGAMP'
  const famRef = db.doc(`families/${FAM}`)
  const subs = await famRef.listCollections()
  console.log('subcollections', subs.map(c => c.id).join(','))

  const users = await db.collection('users').where('familyId', '==', FAM).get()
  const children = users.docs.filter(d => d.data().role === 'child')
  const tasks = new Map<string, number>()
  for (const t of (await famRef.collection('tasks').get()).docs) {
    tasks.set(t.id, typeof t.data().pointsReward === 'number' ? t.data().pointsReward : Number.NaN)
  }
  const cutover = (await famRef.get()).data()!.gamificationMigration.cutoverAt.toMillis()

  for (const child of children) {
    const id = child.id
    const snap = await famRef.collection('task_completions')
      .where('assigneeId', '==', id).where('status', '==', 'approved').get()
    let awarded = 0, effect = 0, taskFallback = 0, none = 0, preCutover = 0, sumAwarded = 0, sumEffect = 0, sumTask = 0
    for (const d of snap.docs) {
      const x = d.data()
      const at = x.approvedAt?.toMillis?.() ?? x.reviewedAt?.toMillis?.()
      if (at === undefined || at >= cutover) continue
      preCutover++
      if (typeof x.awardedPoints === 'number') { awarded++; sumAwarded += x.awardedPoints }
      else if (typeof x.effectSnapshot?.pointsDelta === 'number') { effect++; sumEffect += x.effectSnapshot.pointsDelta }
      else if (tasks.has(x.taskId) && Number.isFinite(tasks.get(x.taskId))) { taskFallback++; sumTask += tasks.get(x.taskId)! }
      else none++
    }
    const beh = await famRef.collection('behaviour_events').where('userId', '==', id).get()
    let behPositive = 0
    for (const b of beh.docs) {
      const delta = b.data().pointsDelta
      if (typeof delta === 'number' && delta > 0) behPositive += delta
    }
    const summary = (await famRef.collection('gamification_summaries').doc(id).get()).data()
    console.log(JSON.stringify({
      name: child.data().displayName,
      id,
      lifetimeXP: child.data().lifetimeXP,
      rewardPoints: child.data().rewardPoints,
      summaryXp: summary?.xpTotal ?? null,
      summaryStatus: summary?.projectionStatus ?? null,
      currentStreak: summary?.currentStreak ?? null,
      bestStreak: summary?.bestStreak ?? null,
      legacyLongestStreak: child.data().longestStreak ?? null,
      preCutover,
      withAwardedPoints: awarded,
      sumAwarded,
      withEffectSnapshot: effect,
      sumEffect,
      onlyCurrentTaskReward: taskFallback,
      sumTask,
      unresolvable: none,
      behaviourPositiveXp: behPositive,
      totalIfAllSources: sumAwarded + sumEffect + sumTask + behPositive,
    }))
  }
}

main().catch(e => { console.error(e); process.exitCode = 1 })
