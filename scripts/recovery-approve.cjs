/**
 * RECOVERY STEP 1 — approve the pending join request via the supported
 * approval flow (the exact client-SDK transaction implemented in
 * src/lib/api.ts -> approveJoinRequest), executed while authenticated as
 * the family owner. All writes therefore pass through production
 * Firestore security rules; nothing is written with admin privileges.
 */
const { initializeApp: initAdmin, cert } = require('firebase-admin/app');
const { getAuth: getAdminAuth } = require('firebase-admin/auth');
const svc = require('../firebase-key.json');

const { initializeApp } = require('firebase/app');
const { getAuth, signInWithCustomToken } = require('firebase/auth');
const {
  getFirestore,
  doc,
  runTransaction,
  serverTimestamp,
} = require('firebase/firestore');

const FAMILY_ID = 'uTnrixcB4uvrZ5Xf44NV';
const REQUEST_ID = 'WBJwXtdOI2XSnxJD1bhi7b6u1792';
const OWNER_UID = 'KRcaSOIJkydUn6vqcxNXX4d2q232';
const ROLE = 'parent';

initAdmin({ credential: cert(svc), projectId: 'familyquest-beta-402cb' });

const app = initializeApp({
  apiKey: 'AIzaSyBtV5vUHSGebsqs5Rvw_dftkNNeDhFuiLU',
  authDomain: 'queki.app',
  projectId: 'familyquest-beta-402cb',
  storageBucket: 'familyquest-beta-402cb.firebasestorage.app',
  messagingSenderId: '883349088062',
  appId: '1:883349088062:web:db417949c549c313e6ae6f',
});
const auth = getAuth(app);
const db = getFirestore(app);

function reviewerFields(uid, name, ts) {
  return { reviewedBy: uid, reviewedByName: name, reviewedAt: ts };
}

// Mirrors src/lib/api.ts :: approveJoinRequest exactly.
async function approveJoinRequest(familyId, requestId, role) {
  if (role !== 'child' && role !== 'parent') throw new Error('Unsupported approval role');
  const reviewerUid = auth.currentUser?.uid;
  if (!reviewerUid) throw new Error('Not authenticated');
  await runTransaction(db, async (transaction) => {
    const requestRef = doc(db, `families/${familyId}/join_requests`, requestId);
    const reviewerRef = doc(db, 'users', reviewerUid);
    const [requestDoc, reviewerDoc] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(reviewerRef),
    ]);
    if (!requestDoc.exists() || requestDoc.data().status !== 'pending') {
      throw new Error('Join request is not pending');
    }
    if (
      !reviewerDoc.exists() ||
      reviewerDoc.data().familyId !== familyId ||
      reviewerDoc.data().role !== 'owner'
    ) {
      throw new Error('Only the family owner can review join requests');
    }
    const uid = requestDoc.data().uid;
    const displayName = requestDoc.data().displayName;
    if (typeof uid !== 'string' || typeof displayName !== 'string' || !displayName.trim()) {
      throw new Error('Join request identity is invalid');
    }
    const intendedRole = requestDoc.data().intendedRole;
    if (intendedRole !== undefined && intendedRole !== 'parent' && intendedRole !== 'child') {
      throw new Error('Join request role is invalid');
    }
    const effectiveRole = intendedRole ?? role;
    if (effectiveRole !== 'parent') {
      throw new Error(`ABORT: effective role would be "${effectiveRole}", expected "parent"`);
    }
    const userRef = doc(db, 'users', uid);

    transaction.set(
      userRef,
      {
        uid,
        joinRequestId: requestId,
        familyId,
        role: effectiveRole,
        displayName,
        avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${displayName}`,
        rewardPoints: 0,
        lifetimeXP: 0,
        currentStreak: 0,
        longestStreak: 0,
        lastActiveDate: serverTimestamp(),
      },
      { merge: true },
    );

    transaction.update(requestRef, {
      status: 'approved',
      assignedRole: effectiveRole,
      ...reviewerFields(reviewerUid, reviewerDoc.data().displayName || 'Owner', serverTimestamp()),
    });

    transaction.set(doc(db, `families/${familyId}/feed`, `join_${requestId}`), {
      actorId: reviewerUid,
      type: 'custom',
      text: `${displayName} has joined the family as a ${effectiveRole}!`,
      timestamp: serverTimestamp(),
    });
  });
}

async function main() {
  const token = await getAdminAuth().createCustomToken(OWNER_UID);
  await signInWithCustomToken(auth, token);
  console.log('Signed in as owner:', auth.currentUser.uid);
  await approveJoinRequest(FAMILY_ID, REQUEST_ID, ROLE);
  console.log('Join request approved via supported flow.');
  process.exit(0);
}

main().catch((e) => {
  console.error('ERR', e.message || e);
  process.exit(1);
});
