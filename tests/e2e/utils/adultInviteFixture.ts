import { createHash } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const PROJECT_ID = 'familyquest-beta-402cb';

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';

function assertLocalEmulator(): void {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? '';
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) {
    throw new Error('ADULT_INVITE_FIXTURES_REQUIRE_LOCAL_FIRESTORE_EMULATOR');
  }
}

if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID });

const db = getFirestore();

type FixtureCommand = 'count-families' | 'create-invitation' | 'create-profile' | 'create-membership';

function readPayload<T>(): T {
  const raw = process.argv[3];
  if (!raw) throw new Error('ADULT_INVITE_FIXTURE_PAYLOAD_REQUIRED');
  return JSON.parse(raw) as T;
}

async function main(): Promise<unknown> {
  assertLocalEmulator();
  const command = process.argv[2] as FixtureCommand | undefined;
  if (command === 'count-families') return (await db.collection('families').get()).size;

  if (command === 'create-profile') {
    const payload = readPayload<{ uid: string; displayName: string }>();
    await db.doc(`users/${payload.uid}`).set({
      uid: payload.uid,
      role: 'parent',
      displayName: payload.displayName,
    });
    return null;
  }

  if (command === 'create-membership') {
    const payload = readPayload<{ familyId: string; uid: string; displayName: string }>();
    await db.doc(`families/${payload.familyId}/users/${payload.uid}`).set({
      uid: payload.uid,
      displayName: payload.displayName,
      role: 'parent',
      lifecycle: 'active',
    });
    return null;
  }

  if (command === 'create-invitation') {
    const payload = readPayload<{
      token: string;
      familyId: string;
      intendedRole: 'parent' | 'adult';
      status: 'active' | 'accepted' | 'revoked';
      expiresAt: string;
      clientReqId: string;
    }>();
    const invitationId = createHash('sha256').update(payload.token, 'utf8').digest('hex');
    await db.doc(`familyInvitations/${invitationId}`).set({
      version: 2,
      familyId: payload.familyId,
      intendedRole: payload.intendedRole,
      status: payload.status,
      createdBy: 'owner1',
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromDate(new Date(payload.expiresAt)),
      clientReqId: payload.clientReqId,
    });
    return null;
  }

  throw new Error('ADULT_INVITE_FIXTURE_COMMAND_INVALID');
}

main()
  .then(result => process.stdout.write(JSON.stringify(result)))
  .catch(error => {
    process.stderr.write(String(error));
    process.exitCode = 1;
  });
