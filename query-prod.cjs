const admin = require('firebase-admin');
const svc = require('./firebase-key.json');

admin.initializeApp({ credential: admin.credential.cert(svc), projectId: 'familyquest-beta-402cb' });
const db = admin.firestore();

async function main() {
  const snap = await db.collectionGroup('profile_update_requests').get();
  console.log('Total profile_update_requests:', snap.size);
  snap.forEach(d => {
    const data = d.data();
    console.log(d.id, '| status=', data.status, '| child=', data.childName, '| requestedAvatarId=', JSON.stringify(data.requestedAvatarId));
  });
  process.exit(0);
}
main().catch(e => { console.error('ERR', e); process.exit(1); });
