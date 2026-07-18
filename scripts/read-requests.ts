import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

const svc = JSON.parse(readFileSync('firebase-key.json', 'utf8'));
if (getApps().length === 0) {
  initializeApp({ credential: cert(svc), projectId: 'familyquest-debug' });
}
const db = getFirestore();

async function main() {
  const snap = await db.collectionGroup('profile_update_requests').get();
  console.log('TOTAL profile_update_requests:', snap.size);
  snap.forEach(d => {
    const data = d.data();
    console.log(d.id, '| status=', data.status, '| child=', data.childName, '| requestedDisplayName=', data.requestedDisplayName, '| requestedAvatarId=', JSON.stringify(data.requestedAvatarId));
  });
}
main().then(() => process.exit(0)).catch(e => { console.error('ERR', e); process.exit(1); });
