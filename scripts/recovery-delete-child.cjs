/**
 * RECOVERY STEP 3 — delete the incorrect managed child through the
 * supported deleteChild callable (functions/src/childDeletion.ts),
 * authenticated as the family owner. No direct Firestore or Auth writes.
 */
const { initializeApp: initAdmin, cert } = require('firebase-admin/app');
const { getAuth: getAdminAuth } = require('firebase-admin/auth');
const svc = require('../firebase-key.json');

const { initializeApp } = require('firebase/app');
const { getAuth, signInWithCustomToken } = require('firebase/auth');
const { getFunctions, httpsCallable } = require('firebase/functions');

const OWNER_UID = 'KRcaSOIJkydUn6vqcxNXX4d2q232';
const CHILD_ID = 'TZYbQ7sL6qnak9A69A0z';
const DISPLAY_NAME = 'Gulhan';

initAdmin({ credential: cert(svc), projectId: 'familyquest-beta-402cb' });

const app = initializeApp({
  apiKey: 'AIzaSyBtV5vUHSGebsqs5Rvw_dftkNNeDhFuiLU',
  authDomain: 'queki.app',
  projectId: 'familyquest-beta-402cb',
  storageBucket: 'familyquest-beta-402cb.firebasestorage.app',
  messagingSenderId: '883349088062',
  appId: '1:883349088062:web:db417949c549c313e6ae6f',
});

async function main() {
  const auth = getAuth(app);
  const token = await getAdminAuth().createCustomToken(OWNER_UID);
  await signInWithCustomToken(auth, token);
  console.log('Signed in as owner:', auth.currentUser.uid);

  const functions = getFunctions(app, 'europe-west1');
  const deleteChild = httpsCallable(functions, 'deleteChild');
  const res = await deleteChild({
    childId: CHILD_ID,
    displayNameConfirmation: DISPLAY_NAME,
    clientReqId: `recovery-${CHILD_ID}-1`,
  });
  console.log('deleteChild result:', JSON.stringify(res.data));
  process.exit(0);
}

main().catch((e) => {
  console.error('ERR', e.code || '', e.message || e);
  process.exit(1);
});
