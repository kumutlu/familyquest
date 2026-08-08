import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const app = initializeApp({ credential: applicationDefault(), projectId: 'familyquest-beta-402cb' }, 'check-ali')
const db = getFirestore(app)

async function main(): Promise<void> {
  const users = await db.collection('users').get()
  const alis = users.docs.filter(d => String(d.data().displayName ?? d.data().name ?? '').toLowerCase().includes('ali'))
  for (const u of alis) {
    const data = u.data()
    const fid = data.familyId as string | undefined
    if (fid === undefined) {
      console.log(JSON.stringify({ user: u.id, name: data.displayName ?? data.name, familyId: null }))
      continue
    }
    const fam = await db.collection('families').doc(fid).get()
    console.log(JSON.stringify({
      user: u.id,
      name: data.displayName ?? data.name,
      role: data.role,
      familyId: fid,
      migration: fam.data()?.gamificationMigration,
    }))
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
