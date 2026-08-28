import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ID = 'familyquest-beta-402cb';
const FUNCTIONS_REGION = 'europe-west1';
const AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const FUNCTIONS_EMULATOR_HOST = process.env.FIREBASE_FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001';
const OWNER_EMAIL = 'owner@test.com';
const OWNER_PASSWORD = 'password123';
const FIXTURE_RUNNER_PATH = resolve(process.cwd(), 'tests/e2e/utils/adultInviteFixture.ts');

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

/**
 * Runs a separate emulator-only Admin SDK process.  Keeping firebase-admin out
 * of Playwright's module graph is deliberate; see readOutcome.ts and seed.ts.
 */
export function adultInviteFixtureRunnerArgs(command: string, payload?: unknown): string[] {
  return ['tsx', FIXTURE_RUNNER_PATH, command, ...(payload === undefined ? [] : [JSON.stringify(payload)])];
}

function runFixture<T>(command: string, payload?: unknown): T {
  const output = execFileSync(
    'npx',
    adultInviteFixtureRunnerArgs(command, payload),
    { encoding: 'utf8', stdio: 'pipe' },
  );
  return JSON.parse(output) as T;
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
  runFixture('create-invitation', {
    token,
    familyId: 'test-fam',
    intendedRole: 'parent',
    status: overrides.status || 'active',
    expiresAt,
    clientReqId: `e2e-admin-${crypto.randomUUID()}`,
  });
  return { invitationId, token, intendedRole: 'parent', expiresAt };
}

/** Reset the disposable family through the existing standalone seed process. */
export function seedAdultInviteE2E(): void {
  execFileSync('npx', ['tsx', fileURLToPath(new URL('./seed.ts', import.meta.url)), '--adult-invite'], {
    stdio: 'ignore',
  });
}

/** Count family documents through the isolated emulator Admin fixture boundary. */
export async function countFamiliesForE2E(): Promise<number> {
  return runFixture<number>('count-families');
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
  runFixture('create-profile', {
    uid: recipient.uid,
    displayName: 'Used Invite Recipient',
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
  runFixture('create-profile', {
    uid: user.uid,
    displayName: 'No Family User',
  });
  return user;
}

/** Seed a same-family member and return an invitation for idempotence coverage. */
export async function createSameFamilyAdultInvitationForE2E(): Promise<AdultInviteFixture> {
  runFixture('create-membership', {
    familyId: 'test-fam',
    uid: 'parent1',
    displayName: 'Parent Dad',
  });
  return createAdultInvitationForE2E();
}
