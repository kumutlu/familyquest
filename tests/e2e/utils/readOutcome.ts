import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

/**
 * Standalone authoritative-outcome reader for the onboarding E2E contract.
 *
 * Runs as its own `npx tsx` process (invoked from the Playwright specs via
 * `execSync`) so the Admin SDK / `jwks-rsa` dependency graph never enters the
 * Playwright module loader (which cannot resolve `jwe/compact/decrypt.js`).
 * Mirrors the pattern already used by `seed.ts`.
 *
 * Reads the email from ONBOARDING_EMAIL and prints a single JSON line to
 * stdout: { familyId, familyCount, childCount, taskCount }.
 */

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

if (getApps().length === 0) {
  initializeApp({ projectId: 'familyquest-beta-402cb' });
}

const db = getFirestore();
const adminAuth = getAuth();

interface Outcome {
  familyId: string | null;
  familyCount: number;
  childCount: number;
  taskCount: number;
}

async function main(): Promise<void> {
  const email = process.env.ONBOARDING_EMAIL;
  if (!email) {
    process.stderr.write('ONBOARDING_EMAIL is required\n');
    process.exit(1);
    return;
  }

  let uid: string | undefined;
  for (let attempt = 0; attempt < 40 && !uid; attempt++) {
    try {
      const record = await adminAuth.getUserByEmail(email);
      uid = record.uid;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  const outcome: Outcome = { familyId: null, familyCount: 0, childCount: 0, taskCount: 0 };
  if (!uid) {
    process.stdout.write(JSON.stringify(outcome));
    return;
  }

  const userSnap = await db.doc(`users/${uid}`).get();
  const userData = userSnap.data() as { familyId?: string } | undefined;
  const familyId = userData?.familyId ?? null;
  outcome.familyId = familyId;

  if (familyId) {
    const famSnap = await db.doc(`families/${familyId}`).get();
    if (famSnap.exists) outcome.familyCount = 1;

    const children = await db
      .collection('users')
      .where('familyId', '==', familyId)
      .where('role', '==', 'child')
      .get();
    outcome.childCount = children.size;

    const tasks = await db
      .collection(`families/${familyId}/tasks`)
      .where('isActive', '==', true)
      .get();
    outcome.taskCount = tasks.size;
  }

  process.stdout.write(JSON.stringify(outcome));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    process.stderr.write(String(err));
    process.exit(1);
  });
