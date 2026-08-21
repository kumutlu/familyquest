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

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';

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

  const expected = JSON.parse(process.env.ONBOARDING_EXPECTED_OUTCOME || '{}') as Partial<Outcome>;
  const empty = (): Outcome => ({ familyId: null, familyCount: 0, childCount: 0, taskCount: 0 });
  if (!uid) {
    process.stdout.write(JSON.stringify(empty()));
    return;
  }
  let outcome = empty();
  for (let attempt = 0; attempt < 40; attempt++) {
    outcome = empty();
    const userSnap = await db.doc(`users/${uid}`).get();
    const familyId = (userSnap.data() as { familyId?: string } | undefined)?.familyId ?? null;
    outcome.familyId = familyId;
    if (familyId) {
      if ((await db.doc(`families/${familyId}`).get()).exists) outcome.familyCount = 1;
      outcome.childCount = (await db.collection('users').where('familyId', '==', familyId).where('role', '==', 'child').get()).size;
      outcome.taskCount = (await db.collection(`families/${familyId}/tasks`).where('isActive', '==', true).get()).size;
    }
    const matched = Object.entries(expected).every(([key, value]) => outcome[key as keyof Outcome] === value);
    if (matched) break;
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  process.stdout.write(JSON.stringify(outcome));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    process.stderr.write(String(err));
    process.exit(1);
  });
