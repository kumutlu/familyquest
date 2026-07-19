import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const app = initializeApp({ credential: applicationDefault(), projectId: 'familyquest-beta-402cb' })
const db = getFirestore(app)

async function main() {
  const fam = db.collection('families').doc('smoke-test-family')
  const goals = await fam.collection('savings_goals').get()
  for (const g of goals.docs) {
    // Delete subcollections first.
    const subs = ['contributions', 'goal_ledger', 'match_proposals', 'goal_requests']
    for (const sub of subs) {
      const docs = await fam.collection('savings_goals').doc(g.id).collection(sub).get()
      for (const d of docs.docs) await d.ref.delete()
    }
    await g.ref.delete()
    console.log(`deleted goal ${g.id} (${g.data().title})`)
  }
  console.log(`cleaned ${goals.size} goal(s)`)

  // Also clear goal-create idempotency docs so a re-run with the same
  // title/target does not hit the idempotent-replay path (which performs
  // no new writes and would make the smoke test appear to "pass" while
  // creating nothing).
  const idem = await fam.collection('idempotency').where('operationType', '==', 'goal_create').get()
  for (const d of idem.docs) await d.ref.delete()
  console.log(`cleared ${idem.size} goal_create idempotency doc(s)`)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
