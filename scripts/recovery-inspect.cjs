/**
 * READ-ONLY production inspection for The Blackirons recovery.
 * Performs NO writes. Prints a "before/after" snapshot of every record
 * relevant to:
 *   - pending join request for WBJwXtdOI2XSnxJD1bhi7b6u1792
 *   - managed child TZYbQ7sL6qnak9A69A0z ("Gulhan")
 *   - family uTnrixcB4uvrZ5Xf44NV
 */
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const svc = require('../firebase-key.json');

initializeApp({
  credential: cert(svc),
  projectId: 'familyquest-beta-402cb',
});

const db = getFirestore();
const auth = getAuth();

const FAMILY_ID = 'uTnrixcB4uvrZ5Xf44NV';
const GOOGLE_UID = 'WBJwXtdOI2XSnxJD1bhi7b6u1792';
const CHILD_ID = 'TZYbQ7sL6qnak9A69A0z';

function show(label, value) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(value, null, 2));
}

async function docOrNull(path) {
  const snap = await db.doc(path).get();
  return snap.exists ? { path, ...snap.data() } : { path, EXISTS: false };
}

async function authOrNull(uid) {
  try {
    const u = await auth.getUser(uid);
    return {
      uid: u.uid,
      email: u.email || null,
      providers: u.providerData.map((p) => p.providerId),
      disabled: u.disabled,
      customClaims: u.customClaims || null,
    };
  } catch (e) {
    return { uid, EXISTS: false, code: e.code };
  }
}

async function listCollection(path, limit = 50) {
  const snap = await db.collection(path).limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function main() {
  show('FAMILY DOC', await docOrNull(`families/${FAMILY_ID}`));

  // Members
  const members = await db
    .collection('users')
    .where('familyId', '==', FAMILY_ID)
    .get();
  show(
    'FAMILY MEMBERS (users where familyId == family)',
    members.docs.map((d) => ({
      id: d.id,
      role: d.get('role'),
      isManaged: d.get('isManaged') ?? false,
      displayName: d.get('displayName'),
      email: d.get('email') ?? null,
      status: d.get('status') ?? null,
      disabled: d.get('disabled') ?? false,
    })),
  );

  // Join requests (adult flow)
  show('families/{f}/join_requests', await listCollection(`families/${FAMILY_ID}/join_requests`));
  // Child join requests (may live elsewhere)
  try {
    show(
      'childJoinRequests (collectionGroup, this family)',
      (await db.collectionGroup('childJoinRequests').get()).docs
        .filter((d) => d.get('familyId') === FAMILY_ID || d.ref.path.includes(FAMILY_ID))
        .map((d) => ({ path: d.ref.path, ...d.data() })),
    );
  } catch (e) {
    console.log('childJoinRequests query failed:', e.message);
  }

  show('users/{GOOGLE_UID}', await docOrNull(`users/${GOOGLE_UID}`));
  show('AUTH google user', await authOrNull(GOOGLE_UID));

  show('users/{CHILD_ID}', await docOrNull(`users/${CHILD_ID}`));
  show('AUTH managed child', await authOrNull(CHILD_ID));

  show('childLogins', await listCollection(`families/${FAMILY_ID}/childLogins`));
  show('childLoginIndex', await listCollection(`families/${FAMILY_ID}/childLoginIndex`));

  // References to the child across family subcollections
  const subcollections = [
    'tasks',
    'rewards',
    'goals',
    'feed',
    'transactions',
    'wallets',
    'notifications',
    'approvals',
    'taskCompletions',
    'behaviourEvents',
    'profile_update_requests',
    'moneyRequests',
    'childLoginAudit',
    'auditLog',
  ];
  for (const sub of subcollections) {
    try {
      const snap = await db.collection(`families/${FAMILY_ID}/${sub}`).get();
      const hits = snap.docs.filter((d) =>
        JSON.stringify(d.data()).includes(CHILD_ID) || d.id === CHILD_ID,
      );
      console.log(
        `\n--- ${sub}: total=${snap.size} referencingChild=${hits.length}`,
      );
      hits.forEach((d) => console.log('   HIT', d.ref.path, JSON.stringify(d.data())));
    } catch (e) {
      console.log(`--- ${sub}: query failed ${e.message}`);
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
