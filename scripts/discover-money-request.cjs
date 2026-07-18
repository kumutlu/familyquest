const { applicationDefault, getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const PROJECT_ID = 'familyquest-beta-402cb';
const app = getApps().find(c => c.name === 'disc') ?? initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID }, 'disc');
const db = getFirestore(app);
(async () => {
  const famId = '5s4Npeu55wPphLCsGAMP';
  const kemal = 'bTEDZNNEQvZf67Y96bF2yxGNAry1';
  const mnalium = 'vc0iyHVfAcXnXQQbmFkr5HfJEkp2';
  for (const uid of [kemal, mnalium]) {
    const u = await db.collection('users').doc(uid).get();
    console.log('USER', uid, u.exists ? JSON.stringify(u.data()) : 'MISSING');
  }
  for (const uid of [kemal, mnalium]) {
    const w = await db.collection(`families/${famId}/wallets`).doc(uid).get();
    console.log('WALLET', uid, w.exists ? JSON.stringify(w.data()) : 'MISSING');
  }
  // any other pending money requests across families
  const all = await db.collectionGroup('money_requests').where('status','in',['pending','pending_acceptance']).get();
  console.log('TOTAL pending money requests:', all.size);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
