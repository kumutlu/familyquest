import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';

if (getApps().length === 0) {
  initializeApp({ projectId: 'familyquest-beta-402cb' });
}

const db = getFirestore();
const adminAuth = getAuth();

async function main() {
  const queryType = process.env.INSPECT_QUERY_TYPE;
  const targetId = process.env.INSPECT_TARGET_ID;
  const familyId = process.env.INSPECT_FAMILY_ID;

  if (queryType === 'check_child_provisioning') {
    // Check users/{childId}
    const userSnap = await db.doc(`users/${targetId}`).get();
    const userData = userSnap.data();

    // Check families/{familyId}/wallets/{childId}
    const canonicalWalletSnap = await db.doc(`families/${familyId}/wallets/${targetId}`).get();

    // Check root wallets/{childId}
    const rootWalletSnap = await db.doc(`wallets/${targetId}`).get();

    // Check childLogin
    const loginSnap = await db.doc(`families/${familyId}/childLogins/${targetId}`).get();

    // Check Auth user
    let authUserExists = false;
    if (userData?.authUid) {
      try {
        await adminAuth.getUser(userData.authUid);
        authUserExists = true;
      } catch {
        authUserExists = false;
      }
    }

    process.stdout.write(
      JSON.stringify({
        userExists: userSnap.exists,
        userData,
        canonicalWalletExists: canonicalWalletSnap.exists,
        canonicalWalletData: canonicalWalletSnap.data(),
        rootWalletExists: rootWalletSnap.exists,
        loginExists: loginSnap.exists,
        loginData: loginSnap.data(),
        authUserExists,
      }),
    );
    return;
  }

  if (queryType === 'check_child_deletion') {
    const userSnap = await db.doc(`users/${targetId}`).get();
    const canonicalWalletSnap = await db.doc(`families/${familyId}/wallets/${targetId}`).get();
    const loginSnap = await db.doc(`families/${familyId}/childLogins/${targetId}`).get();

    // Check tasks in family assigned to this child
    const tasksSnap = await db
      .collection(`families/${familyId}/tasks`)
      .where('assigneeId', '==', targetId)
      .get();

    let authUserExists = false;
    try {
      await adminAuth.getUser(targetId);
      authUserExists = true;
    } catch {
      authUserExists = false;
    }

    process.stdout.write(
      JSON.stringify({
        userExists: userSnap.exists,
        canonicalWalletExists: canonicalWalletSnap.exists,
        loginExists: loginSnap.exists,
        tasksWithAssigneeCount: tasksSnap.size,
        authUserExists,
      }),
    );
    return;
  }

  if (queryType === 'count_children_and_wallets') {
    const childrenSnap = await db
      .collection('users')
      .where('familyId', '==', familyId)
      .where('role', '==', 'child')
      .get();
    const walletsSnap = await db.collection(`families/${familyId}/wallets`).get();
    const tasksSnap = await db.collection(`families/${familyId}/tasks`).get();

    process.stdout.write(
      JSON.stringify({
        childCount: childrenSnap.size,
        walletCount: walletsSnap.size,
        taskCount: tasksSnap.size,
        children: childrenSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      }),
    );
    return;
  }

  if (queryType === 'seed_orphan_user') {
    const email = process.env.INSPECT_EMAIL!;
    const u = await adminAuth.createUser({
      email,
      password: 'password123',
      displayName: 'Orphan User',
      emailVerified: true,
    });
    await db.doc(`users/${u.uid}`).set({ id: u.uid, displayName: 'Orphan User' });
    process.stdout.write(JSON.stringify({ uid: u.uid }));
    return;
  }

  if (queryType === 'seed_zero_child_family') {
    const email = process.env.INSPECT_EMAIL!;
    const famId = process.env.INSPECT_FAMILY_ID || 'zero-fam';
    const u = await adminAuth.createUser({
      email,
      password: 'password123',
      displayName: 'Solo Parent',
      emailVerified: true,
    });
    await db.doc(`users/${u.uid}`).set({ id: u.uid, familyId: famId, role: 'owner', displayName: 'Solo Parent' });
    await db.doc(`families/${famId}`).set({ name: 'Zero Child Family', currency: '£', debtLimit: 0 });
    process.stdout.write(JSON.stringify({ uid: u.uid, familyId: famId }));
    return;
  }

  if (queryType === 'seed_legacy_qr_token') {
    const crypto = await import('crypto');
    const { FieldValue } = await import('firebase-admin/firestore');
    const rawToken = 'legacy-' + Date.now();
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const sessionId = 'legacy-session-' + Date.now();
    const expiresAtMs = Date.now() + 15 * 60 * 1000;

    await db.doc(`families/test-fam/child_qr_sessions/${sessionId}`).set({
      qrSessionId: sessionId,
      familyId: 'test-fam',
      tokenHash,
      createdBy: 'owner1',
      status: 'active',
      createdAtMs: Date.now(),
      expiresAtMs,
      consumedAtMs: null,
      consumedByRequestId: null,
      revokedAtMs: null,
      createdAt: FieldValue.serverTimestamp(),
    });

    await db.doc(`childQrTokenLookup/${tokenHash}`).set({
      qrSessionId: sessionId,
      familyId: 'test-fam',
      status: 'active',
      expiresAtMs,
      createdAt: FieldValue.serverTimestamp(),
    });

    process.stdout.write(JSON.stringify({ rawToken }));
    return;
  }

  if (queryType === 'verify_email') {
    const email = process.env.INSPECT_EMAIL;
    if (!email) throw new Error('INSPECT_EMAIL_REQUIRED');
    let user = null;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      try {
        user = await adminAuth.getUserByEmail(email);
        if (user) break;
      } catch {
        // user may still be propagating in emulator
        await new Promise((res) => setTimeout(res, 300));
      }
    }
    if (!user) {
      throw new Error(`User not found for email: ${email}`);
    }
    await adminAuth.updateUser(user.uid, { emailVerified: true });
    process.stdout.write(JSON.stringify({ success: true, uid: user.uid }));
    return;
  }

  process.stdout.write(JSON.stringify({ status: 'unknown_query' }));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    process.stderr.write(String(err));
    process.exit(1);
  });
