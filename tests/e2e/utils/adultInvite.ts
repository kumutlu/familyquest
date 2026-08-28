import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const PROJECT_ID = 'familyquest-beta-402cb';
const FUNCTIONS_REGION = 'europe-west1';
const AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const FUNCTIONS_EMULATOR_HOST = process.env.FIREBASE_FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001';
const FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const OWNER_EMAIL = 'owner@test.com';
const OWNER_PASSWORD = 'password123';

export type AdultInviteRole = 'parent' | 'adult';

export interface AdultInviteFixture {
  invitationId: string;
  token: string;
  intendedRole: AdultInviteRole;
  expiresAt: string;
}

export interface EmulatorUserFixture {
  email: string;
  password: string;
  uid: string;
  idToken: string;
}

/** Return the emulator's callable URL; no token or invitation data is embedded. */
export function adultInviteCallableEndpoint(name: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(name)) {
    throw new Error('INVALID_CALLABLE_NAME');
  }
  return `http://${FUNCTIONS_EMULATOR_HOST}/${PROJECT_ID}/${FUNCTIONS_REGION}/${name}`;
}

/** Read only the Firebase callable protocol's result envelope. */
export function readCallableResult<T>(body: unknown): T {
  if (
    body === null ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    !Object.prototype.hasOwnProperty.call(body, 'result') ||
    (body as { result?: unknown }).result === undefined
  ) {
    throw new Error('CALLABLE_RESPONSE_INVALID');
  }
  return (body as { result: T }).result;
}

interface EmulatorAuthResponse {
  idToken: string;
  localId: string;
}

async function readJson(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const reason = body && typeof body === 'object' && 'error' in body
      ? JSON.stringify((body as { error: unknown }).error)
      : `HTTP_${response.status}`;
    throw new Error(`EMULATOR_REQUEST_FAILED:${reason}`);
  }
  return body;
}

async function ownerIdToken(): Promise<string> {
  const response = await fetch(
    `http://${AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD, returnSecureToken: true }),
    },
  );
  const body = await readJson(response) as EmulatorAuthResponse;
  if (typeof body.idToken !== 'string' || body.idToken.length < 20) {
    throw new Error('EMULATOR_ID_TOKEN_INVALID');
  }
  return body.idToken;
}

async function invokeCallable<T>(idToken: string, name: string, data: unknown): Promise<T> {
  const response = await fetch(adultInviteCallableEndpoint(name), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${idToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ data }),
  });
  return readCallableResult<T>(await readJson(response));
}

async function invokeOwnerCallable<T>(name: string, data: unknown): Promise<T> {
  return invokeCallable<T>(await ownerIdToken(), name, data);
}

async function createEmulatorUser(email: string, password: string): Promise<EmulatorUserFixture> {
  const response = await fetch(
    `http://${AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const body = await readJson(response) as EmulatorAuthResponse;
  if (!body.idToken || !body.localId) throw new Error('EMULATOR_USER_INVALID');
  return { email, password, uid: body.localId, idToken: body.idToken };
}

function firestoreString(value: string) {
  return { stringValue: value };
}

function firestoreTimestamp(value: string) {
  return { timestampValue: value };
}

async function writeFirestoreDocument(path: string, fields: Record<string, unknown>): Promise<void> {
  const response = await fetch(
    `http://${FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fields }),
    },
  );
  await readJson(response);
}

function fixtureToken(): string {
  return randomBytes(32).toString('base64url');
}

function invitationIdForToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

async function createAdminInvitationFixture(overrides: {
  status?: 'active' | 'accepted' | 'revoked';
  expiresAt?: string;
} = {}): Promise<AdultInviteFixture> {
  const token = fixtureToken();
  const invitationId = invitationIdForToken(token);
  const expiresAt = overrides.expiresAt || new Date(Date.now() + 86_400_000).toISOString();
  await writeFirestoreDocument(`familyInvitations/${invitationId}`, {
    version: { integerValue: '2' },
    familyId: firestoreString('test-fam'),
    intendedRole: firestoreString('parent'),
    status: firestoreString(overrides.status || 'active'),
    createdBy: firestoreString('owner1'),
    createdAt: firestoreTimestamp(new Date().toISOString()),
    expiresAt: firestoreTimestamp(expiresAt),
    clientReqId: firestoreString(`e2e-admin-${crypto.randomUUID()}`),
  });
  return { invitationId, token, intendedRole: 'parent', expiresAt };
}

/** Reset the disposable family through the existing standalone seed process. */
export function seedAdultInviteE2E(): void {
  execFileSync('npx', ['tsx', fileURLToPath(new URL('./seed.ts', import.meta.url)), '--adult-invite'], {
    stdio: 'ignore',
  });
}

/** Count family documents through the emulator REST boundary, without Admin SDK imports. */
export async function countFamiliesForE2E(): Promise<number> {
  const response = await fetch(
    `http://${FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/families?pageSize=300`,
  );
  const body = await readJson(response) as { documents?: unknown };
  return Array.isArray(body.documents) ? body.documents.length : 0;
}

/** Create an invitation through the callable HTTP boundary used by production. */
export async function createAdultInvitationForE2E(
  intendedRole: AdultInviteRole = 'parent',
): Promise<AdultInviteFixture> {
  return invokeOwnerCallable<AdultInviteFixture>('createAdultInvitation', {
    intendedRole,
    clientReqId: `e2e-create-${crypto.randomUUID()}`,
  });
}

/** Revoke an invitation through the callable HTTP boundary (useful for cleanup). */
export async function revokeAdultInvitationForE2E(
  invitationId: string,
): Promise<{ success: true }> {
  return invokeOwnerCallable<{ success: true }>('revokeAdultInvitation', {
    invitationId,
    clientReqId: `e2e-revoke-${crypto.randomUUID()}`,
  });
}

/** Create an expired terminal fixture in Firestore (admin test-process boundary only). */
export async function createExpiredAdultInvitationForE2E(): Promise<AdultInviteFixture> {
  return createAdminInvitationFixture({ expiresAt: new Date(Date.now() - 86_400_000).toISOString() });
}

/** Create a revoked terminal fixture through the owner callable. */
export async function createRevokedAdultInvitationForE2E(): Promise<AdultInviteFixture> {
  const invitation = await createAdultInvitationForE2E();
  await revokeAdultInvitationForE2E(invitation.invitationId);
  return invitation;
}

/** Accept an invitation as a disposable recipient, then return its used token. */
export async function createUsedAdultInvitationForE2E(): Promise<AdultInviteFixture> {
  const invitation = await createAdultInvitationForE2E();
  const email = `adult-used-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`;
  const recipient = await createEmulatorUser(email, 'password123');
  await writeFirestoreDocument(`users/${recipient.uid}`, {
    uid: firestoreString(recipient.uid),
    role: firestoreString('parent'),
    displayName: firestoreString('Used Invite Recipient'),
  });
  await invokeCallable(recipient.idToken, 'acceptAdultInvitation', {
    token: invitation.token,
    clientReqId: `e2e-used-${crypto.randomUUID()}`,
  });
  return invitation;
}

/** Create a disposable authenticated profile without a family for routing tests. */
export async function createNoFamilyUserForE2E(): Promise<EmulatorUserFixture> {
  const email = `adult-no-family-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`;
  const user = await createEmulatorUser(email, 'password123');
  await writeFirestoreDocument(`users/${user.uid}`, {
    uid: firestoreString(user.uid),
    role: firestoreString('parent'),
    displayName: firestoreString('No Family User'),
  });
  return user;
}

/** Seed a same-family member and return an invitation for idempotence coverage. */
export async function createSameFamilyAdultInvitationForE2E(): Promise<AdultInviteFixture> {
  await writeFirestoreDocument('families/test-fam/users/parent1', {
    uid: firestoreString('parent1'),
    displayName: firestoreString('Parent Dad'),
    role: firestoreString('parent'),
    lifecycle: firestoreString('active'),
  });
  return createAdultInvitationForE2E();
}
