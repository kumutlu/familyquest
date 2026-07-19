import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const app = initializeApp({ credential: applicationDefault(), projectId: 'familyquest-beta-402cb' })
const db = getFirestore(app)

async function main() {
  const fam = await db.collection('families').doc('smoke-test-family').get()
  console.log('family exists:', fam.exists)
  if (fam.exists) console.log('family data:', JSON.stringify(fam.data()))

  const users = await db.collection('families').doc('smoke-test-family').collection('users').get()
  console.log('user docs:', users.docs.map(d => ({ id: d.id, role: d.data().role, familyId: d.data().familyId, smokeTest: d.data().smokeTest })))

  const wallets = await db.collection('families').doc('smoke-test-family').collection('wallets').get()
  console.log('wallet docs:', wallets.docs.map(d => ({ id: d.id, balance: d.data().balance })))

  const goals = await db.collection('families').doc('smoke-test-family').collection('savings_goals').get()
  console.log('goal docs:', goals.docs.map(d => ({ id: d.id, title: d.data().title })))
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
