import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const app = getApps().length === 0 
  ? initializeApp({ credential: cert(require('../firebase-key.json')), projectId: 'familyquest-beta-402cb' })
  : getApps()[0];

const db = getFirestore(app);

async function main() {
  const snapshot = await db.collection('users').where('role', '==', 'child').where('isManaged', '==', true).get();
  console.log(`Found ${snapshot.size} managed children:`);
  for (const doc of snapshot.docs) {
    const data = doc.data();
    console.log(`  UID: ${doc.id}, displayName: ${data.displayName}, familyId: ${data.familyId}, authUid: ${data.authUid}`);
  }
}

main().catch(console.error);
