import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({}),
  Timestamp: {
    fromDate: (date: Date) => ({
      toDate: () => new Date(date),
      toMillis: () => date.getTime(),
    }),
  },
}));
vi.mock('firebase-functions/v2/https', () => ({
  HttpsError: class HttpsError extends Error {
    constructor(public code: string, message: string, public details?: unknown) {
      super(message);
    }
  },
  onCall: (_options: unknown, handler: unknown) => handler,
}));

import {
  acceptAdultInvitationImpl,
  createAdultInvitationImpl,
  generateAdultInvitationToken,
  hashAdultInvitationToken,
  INVITATION_TTL_MS,
  previewAdultInvitationImpl,
  revokeAdultInvitationImpl,
  type AdultInvitationRecord,
  validateAdultRole,
} from './adultInvitations';

type ExpectedAdultInvitationRecord = {
  version: 2;
  familyId: string;
  intendedRole: 'parent' | 'adult';
  status: 'active' | 'accepted' | 'revoked';
  createdBy: string;
  createdAt: import('firebase-admin/firestore').Timestamp;
  expiresAt: import('firebase-admin/firestore').Timestamp;
  acceptedBy?: string;
  acceptedAt?: import('firebase-admin/firestore').Timestamp;
  revokedBy?: string;
  revokedAt?: import('firebase-admin/firestore').Timestamp;
  clientReqId: string;
};

describe('adult invitation token domain', () => {
  it('generates a token with 32 decoded random bytes and stores only its SHA-256 hash', () => {
    const token = generateAdultInvitationToken(() => Buffer.alloc(32, 7));

    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(token).toBe('BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc');
    expect(hashAdultInvitationToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashAdultInvitationToken(token)).not.toContain(token);
  });

  it.each(['owner', 'child', '', undefined])(
    'rejects non-adult invitation role %s',
    value => {
      expect(() => validateAdultRole(value)).toThrow('INVALID_INTENDED_ROLE');
    },
  );

  it('rejects padded, malformed, or incorrectly sized tokens before hashing', () => {
    expect(() => hashAdultInvitationToken(`${'A'.repeat(43)}=`)).toThrow('INVALID_INVITATION_TOKEN');
    expect(() => hashAdultInvitationToken('not a token')).toThrow('INVALID_INVITATION_TOKEN');
    expect(() => hashAdultInvitationToken('AQ')).toThrow('INVALID_INVITATION_TOKEN');
  });

  it('rejects a non-canonical 43-character token with altered unused final bits', () => {
    const canonical = generateAdultInvitationToken(() => Buffer.alloc(32, 7));
    const nonCanonical = `${canonical.slice(0, -1)}d`;

    expect(nonCanonical).not.toBe(canonical);
    expect(Buffer.from(nonCanonical, 'base64url')).toEqual(Buffer.alloc(32, 7));
    expect(() => hashAdultInvitationToken(nonCanonical)).toThrow('INVALID_INVITATION_TOKEN');
  });

  it('proves the seven-day authoritative record contract has no raw token field', () => {
    expect(INVITATION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expectTypeOf<AdultInvitationRecord>().toEqualTypeOf<ExpectedAdultInvitationRecord>();
    expectTypeOf<AdultInvitationRecord>().not.toHaveProperty('rawToken');
    expectTypeOf<AdultInvitationRecord>().not.toHaveProperty('token');
  });
});

const NOW = new Date('2026-08-25T12:00:00.000Z');
const TOKEN = generateAdultInvitationToken(() => Buffer.alloc(32, 11));
const VALID_CREATE_INPUT = {
  intendedRole: 'parent' as const,
  clientReqId: 'req-create-0001',
};

function fakeTimestamp(date: Date) {
  return {
    toDate: () => new Date(date),
    toMillis: () => date.getTime(),
  };
}

function fakeContext() {
  const documents = new Map<string, Record<string, any>>();
  const ref = (path: string): any => ({
    path,
    id: path.split('/').at(-1),
    get: async () => {
      const value = documents.get(path);
      return { exists: value !== undefined, data: () => value, id: path.split('/').at(-1) };
    },
  });
  const db: any = {
    doc: ref,
    runTransaction: async (work: (transaction: any) => Promise<any>) => {
      const writes: Array<{
        kind: 'set' | 'update';
        target: any;
        data: Record<string, any>;
        options?: { merge?: boolean };
      }> = [];
      const transaction = {
        get: (target: any) => target.get(),
        set: (
          target: any,
          data: Record<string, any>,
          options?: { merge?: boolean },
        ) => writes.push({ kind: 'set', target, data, options }),
        update: (target: any, data: Record<string, any>) =>
          writes.push({ kind: 'update', target, data }),
      };
      const result = await work(transaction);
      for (const write of writes) {
        const current = documents.get(write.target.path) ?? {};
        documents.set(
          write.target.path,
          write.kind === 'update' || write.options?.merge
            ? { ...current, ...write.data }
            : write.data,
        );
      }
      return result;
    },
  };
  const context: any = {
    db,
    now: () => NOW,
    randomBytes: () => Buffer.alloc(32, 11),
    timestamp: (date: Date) => fakeTimestamp(date),
    eventId: () => 'event-0001',
    previewIdentity: () => 'ip:192.0.2.10',
  };
  return { context, documents };
}

function auth(uid: string): any {
  return { auth: { uid }, rawRequest: { ip: '192.0.2.10' } };
}

function unauthenticated(): any {
  return { rawRequest: { ip: '192.0.2.10' } };
}

function seedBase(documents: Map<string, Record<string, any>>) {
  documents.set('users/owner-1', {
    uid: 'owner-1',
    familyId: 'family-1',
    role: 'owner',
    lifecycle: 'active',
    displayName: 'Owner',
  });
  documents.set('users/parent-1', {
    uid: 'parent-1', familyId: 'family-1', role: 'parent', lifecycle: 'active', displayName: 'Parent',
  });
  documents.set('users/adult-1', {
    uid: 'adult-1', familyId: 'family-1', role: 'adult', lifecycle: 'active', displayName: 'Adult',
  });
  documents.set('users/child-1', {
    uid: 'child-1', familyId: 'family-1', role: 'child', lifecycle: 'active', displayName: 'Child',
  });
  documents.set('users/joiner-1', {
    uid: 'joiner-1', displayName: 'Joiner', avatarUrl: '/joiner.png', lifecycle: 'active',
  });
  documents.set('families/family-1', {
    name: 'The Smiths',
    lifecycleState: 'active',
  });
}

function seedV2(
  documents: Map<string, Record<string, any>>,
  overrides: Record<string, any> = {},
) {
  const familyOverrides = overrides.lifecycleState
    ? { lifecycleState: overrides.lifecycleState }
    : {};
  const { lifecycleState: _ignored, ...invitationOverrides } = overrides;
  const invitationId = hashAdultInvitationToken(TOKEN);
  documents.set('families/family-1', {
    name: 'The Smiths',
    lifecycleState: 'active',
    ...familyOverrides,
  });
  documents.set(`familyInvitations/${invitationId}`, {
    version: 2,
    familyId: 'family-1',
    intendedRole: 'parent',
    status: 'active',
    createdBy: 'owner-1',
    createdAt: fakeTimestamp(NOW),
    expiresAt: fakeTimestamp(new Date(NOW.getTime() + INVITATION_TTL_MS)),
    clientReqId: 'seed-create-0001',
    ...invitationOverrides,
  });
  return invitationId;
}

describe('adult invitation v2 callables', () => {
  let fixture: ReturnType<typeof fakeContext>;

  beforeEach(() => {
    fixture = fakeContext();
    seedBase(fixture.documents);
  });

  const create = (input: any, uid = 'owner-1') =>
    createAdultInvitationImpl(input, auth(uid), fixture.context);
  const preview = (token: string, request = unauthenticated()) =>
    previewAdultInvitationImpl({ token }, request, fixture.context);
  const accept = (token: string, uid = 'joiner-1', clientReqId = 'req-accept-001') =>
    acceptAdultInvitationImpl({ token, clientReqId }, auth(uid), fixture.context);
  const revoke = (invitationId: string, uid = 'owner-1', clientReqId = 'req-revoke-001') =>
    revokeAdultInvitationImpl({ invitationId, clientReqId }, auth(uid), fixture.context);

  it('allows only an active family owner to create parent or adult invitations', async () => {
    const result = await create({ intendedRole: 'parent', clientReqId: 'req-create-0001' }, 'owner-1');

    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = fixture.documents.get(`familyInvitations/${result.invitationId}`);
    expect(stored).toMatchObject({
      version: 2,
      familyId: 'family-1',
      intendedRole: 'parent',
      status: 'active',
      createdBy: 'owner-1',
    });
    expect(JSON.stringify(stored)).not.toContain(result.token);
    expect(result.expiresAt).toBe('2026-09-01T12:00:00.000Z');
  });

  it.each(['parent-1', 'adult-1', 'child-1'])('denies non-owner creator %s', async uid => {
    await expect(create(VALID_CREATE_INPUT, uid)).rejects.toMatchObject({
      message: 'OWNER_REQUIRED',
    });
  });

  it('creates an adult-role invitation without permitting owner or child authority', async () => {
    const result = await create({ intendedRole: 'adult', clientReqId: 'req-create-adult' });
    expect(result.intendedRole).toBe('adult');
    expect(fixture.documents.get(`familyInvitations/${result.invitationId}`)?.intendedRole)
      .toBe('adult');
  });

  it('rejects inactive owners, deleting families, unauthenticated callers, and invalid roles', async () => {
    fixture.documents.set('users/owner-1', {
      ...fixture.documents.get('users/owner-1'),
      lifecycle: 'archived',
    });
    await expect(create(VALID_CREATE_INPUT)).rejects.toMatchObject({ message: 'OWNER_REQUIRED' });
    fixture.documents.set('users/owner-1', {
      ...fixture.documents.get('users/owner-1'),
      lifecycle: 'active',
    });
    fixture.documents.set('families/family-1', { name: 'The Smiths', lifecycleState: 'deleting' });
    await expect(create(VALID_CREATE_INPUT)).rejects.toMatchObject({ message: 'FAMILY_UNAVAILABLE' });
    await expect(createAdultInvitationImpl(VALID_CREATE_INPUT, unauthenticated(), fixture.context))
      .rejects.toMatchObject({ message: 'AUTH_REQUIRED' });
    await expect(create({ intendedRole: 'owner', clientReqId: 'req-create-0002' }))
      .rejects.toMatchObject({ message: 'INVALID_INTENDED_ROLE' });
  });

  it('fails closed for unknown owner and family lifecycle states', async () => {
    fixture.documents.set('users/owner-1', {
      ...fixture.documents.get('users/owner-1'),
      lifecycle: 'pending',
    });
    await expect(create(VALID_CREATE_INPUT)).rejects.toMatchObject({ message: 'OWNER_REQUIRED' });

    fixture.documents.set('users/owner-1', {
      ...fixture.documents.get('users/owner-1'),
      lifecycle: 'active',
    });
    fixture.documents.set('families/family-1', {
      name: 'The Smiths',
      lifecycleState: 'pending',
    });
    await expect(create(VALID_CREATE_INPUT)).rejects.toMatchObject({
      message: 'FAMILY_UNAVAILABLE',
    });
  });

  it('does not mint or disclose a second token for a replayed creation request', async () => {
    const first = await create(VALID_CREATE_INPUT);
    await expect(create(VALID_CREATE_INPUT)).rejects.toMatchObject({
      message: 'INVITATION_ALREADY_CREATED',
      details: {
        invitationId: first.invitationId,
        intendedRole: 'parent',
        expiresAt: first.expiresAt,
      },
    });
    expect([...fixture.documents.keys()].filter(path => path.startsWith('familyInvitations/')))
      .toHaveLength(1);
    expect(JSON.stringify([...fixture.documents.values()])).not.toContain(first.token);
  });

  it('returns only the minimal preview projection', async () => {
    seedV2(fixture.documents, { intendedRole: 'adult' });
    await expect(preview(TOKEN)).resolves.toEqual({
      familyDisplayName: 'The Smiths',
      intendedRole: 'adult',
      expiresAt: '2026-09-01T12:00:00.000Z',
      status: 'active',
    });
  });

  it('rejects preview and acceptance when the family is deleting', async () => {
    seedV2(fixture.documents, { lifecycleState: 'deleting' });
    await expect(preview(TOKEN)).rejects.toMatchObject({ message: 'FAMILY_UNAVAILABLE' });
    await expect(accept(TOKEN)).rejects.toMatchObject({ message: 'FAMILY_UNAVAILABLE' });
  });

  it('derives membership role from the invitation and ignores forged payload authority', async () => {
    seedV2(fixture.documents, { intendedRole: 'parent' });
    const result = await acceptAdultInvitationImpl(
      { token: TOKEN, clientReqId: 'req-accept-001', role: 'owner', familyId: 'attacker-family' } as any,
      auth('joiner-1'),
      fixture.context,
    );

    expect(result).toEqual({
      result: 'joined', familyId: 'family-1', role: 'parent', destination: '/',
    });
    expect(fixture.documents.get('users/joiner-1')).toMatchObject({
      familyId: 'family-1', role: 'parent', lifecycle: 'active',
    });
    expect(fixture.documents.get('families/family-1/users/joiner-1')).toMatchObject({
      role: 'parent', lifecycle: 'active',
    });
    const allStored = JSON.stringify([...fixture.documents.values()]);
    expect(allStored).not.toContain(TOKEN);
    expect(allStored).not.toContain('attacker-family');
    expect(fixture.documents.get('users/joiner-1')?.role).not.toBe('owner');
  });

  it('returns already_member for the same family and rejects a different family without consuming', async () => {
    const invitationId = seedV2(fixture.documents);
    fixture.documents.set('users/joiner-1', {
      uid: 'joiner-1', displayName: 'Joiner', familyId: 'family-1', role: 'adult', lifecycle: 'active',
    });
    fixture.documents.set('families/family-1/users/joiner-1', {
      uid: 'joiner-1', role: 'adult', lifecycle: 'active',
    });
    await expect(accept(TOKEN)).resolves.toEqual({
      result: 'already_member', familyId: 'family-1', role: 'parent', destination: '/',
    });
    expect(fixture.documents.get(`familyInvitations/${invitationId}`)).toMatchObject({
      status: 'accepted', acceptedBy: 'joiner-1',
    });
    expect(fixture.documents.get('users/joiner-1')?.role).toBe('adult');

    const otherToken = generateAdultInvitationToken(() => Buffer.alloc(32, 12));
    const otherId = hashAdultInvitationToken(otherToken);
    fixture.documents.set(`familyInvitations/${otherId}`, {
      ...fixture.documents.get(`familyInvitations/${invitationId}`),
      status: 'active',
      acceptedBy: undefined,
    });
    fixture.documents.set('users/joiner-1', {
      uid: 'joiner-1', displayName: 'Joiner', familyId: 'family-2', role: 'parent', lifecycle: 'active',
    });
    await expect(accept(otherToken, 'joiner-1', 'req-accept-other'))
      .rejects.toMatchObject({ message: 'ALREADY_IN_ANOTHER_FAMILY' });
    expect(fixture.documents.get(`familyInvitations/${otherId}`)?.status).toBe('active');
    expect(fixture.documents.get('users/joiner-1')?.familyId).toBe('family-2');
  });

  it.each([
    ['expired', { expiresAt: fakeTimestamp(new Date(NOW.getTime() - 1)) }, 'INVITATION_EXPIRED'],
    ['revoked', { status: 'revoked' }, 'INVITATION_REVOKED'],
    ['accepted-by-other', { status: 'accepted', acceptedBy: 'other-user' }, 'INVITATION_ALREADY_USED'],
    ['deleting-family', { lifecycleState: 'deleted' }, 'FAMILY_UNAVAILABLE'],
  ])('rejects %s tokens with stable codes', async (_case, overrides, message) => {
    seedV2(fixture.documents, overrides);
    await expect(preview(TOKEN)).rejects.toMatchObject({ message });
    await expect(accept(TOKEN)).rejects.toMatchObject({ message });
  });

  it('rejects malformed and unknown tokens with INVALID_INVITATION', async () => {
    await expect(preview('not-a-token')).rejects.toMatchObject({ message: 'INVALID_INVITATION' });
    await expect(accept(generateAdultInvitationToken(() => Buffer.alloc(32, 99))))
      .rejects.toMatchObject({ message: 'INVALID_INVITATION' });
  });

  it('requires a complete profile and authentication for acceptance', async () => {
    seedV2(fixture.documents);
    fixture.documents.set('users/joiner-1', { uid: 'joiner-1' });
    await expect(accept(TOKEN)).rejects.toMatchObject({ message: 'PROFILE_REQUIRED' });
    await expect(acceptAdultInvitationImpl(
      { token: TOKEN, clientReqId: 'req-accept-001' },
      unauthenticated(),
      fixture.context,
    )).rejects.toMatchObject({ message: 'AUTH_REQUIRED' });
  });

  it('same-user acceptance replay is idempotent', async () => {
    seedV2(fixture.documents);
    const first = await accept(TOKEN);
    const second = await accept(TOKEN);
    expect(second).toEqual(first);
    expect(first.result).toBe('joined');
  });

  it('revokes only an active invitation owned by the caller family owner', async () => {
    const invitationId = seedV2(fixture.documents);
    await expect(revoke(invitationId)).resolves.toEqual({ success: true });
    await expect(revoke(invitationId, 'owner-1', 'req-revoke-002'))
      .resolves.toEqual({ success: true });
    expect(fixture.documents.get(`familyInvitations/${invitationId}`)).toMatchObject({
      status: 'revoked', revokedBy: 'owner-1',
    });

    seedV2(fixture.documents, { status: 'accepted', acceptedBy: 'joiner-1' });
    await expect(revoke(invitationId, 'owner-1', 'req-revoke-003'))
      .rejects.toMatchObject({ message: 'INVITATION_ALREADY_ACCEPTED' });

    seedV2(fixture.documents);
    await expect(revoke(invitationId, 'parent-1', 'req-revoke-004'))
      .rejects.toMatchObject({ message: 'OWNER_REQUIRED' });
    expect(fixture.documents.get(`familyInvitations/${invitationId}`)?.status).toBe('active');
  });

  it('rejects revocation request-id reuse for a different invitation', async () => {
    const invitationId = seedV2(fixture.documents);
    fixture.documents.set('adultInvitationRevocationIdempotency/owner-1_req-revoke-001', {
      operation: 'revoke-adult-invitation',
      invitationId: 'a'.repeat(64),
      familyId: 'family-1',
      phase: 'complete',
    });

    await expect(revoke(invitationId)).rejects.toMatchObject({ message: 'REQUEST_ID_REUSED' });
    expect(fixture.documents.get(`familyInvitations/${invitationId}`)?.status).toBe('active');
  });

  it('rate-limits repeated unauthenticated preview failures without storing the raw token', async () => {
    const invalidToken = generateAdultInvitationToken(() => Buffer.alloc(32, 77));
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(preview(invalidToken)).rejects.toMatchObject({ message: 'INVALID_INVITATION' });
    }
    await expect(preview(invalidToken)).rejects.toMatchObject({ message: 'TOO_MANY_ATTEMPTS' });
    const storedRateLimit = [...fixture.documents]
      .filter(([path]) => path.startsWith('adultInvitationPreviewRateLimits/'));
    expect(storedRateLimit).toHaveLength(1);
    expect(JSON.stringify(storedRateLimit)).not.toContain(invalidToken);
  });
});
