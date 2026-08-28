import { execFileSync } from 'node:child_process';
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

interface EmulatorSignInResponse {
  idToken: string;
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
  const body = await readJson(response) as EmulatorSignInResponse;
  if (typeof body.idToken !== 'string' || body.idToken.length < 20) {
    throw new Error('EMULATOR_ID_TOKEN_INVALID');
  }
  return body.idToken;
}

async function invokeOwnerCallable<T>(name: string, data: unknown): Promise<T> {
  const idToken = await ownerIdToken();
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

/** Reset the disposable family through the existing standalone seed process. */
export function seedAdultInviteE2E(): void {
  execFileSync('npx', ['tsx', fileURLToPath(new URL('./seed.ts', import.meta.url))], {
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
