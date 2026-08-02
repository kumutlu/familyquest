import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({}),
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}));
vi.mock('firebase-functions/v2/https', () => ({
  HttpsError: class HttpsError extends Error {
    constructor(public code: string, message: string) { super(message); }
  },
  onCall: (_options: unknown, handler: unknown) => handler,
}));

import {
  acceptInvitationImpl,
  createFamilyInvitationImpl,
  previewInvitationImpl,
  INVITATION_TTL_MS,
  type FamilyInvitationContext,
} from './familyInvitations';

const NOW = new Date('2026-08-01T10:00:00Z');

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
    documents,
    doc: ref,
    collectionGroup: (name: string) => ({
      where: (field: string, _op: string, value: string) => ({
        limit: () => ({
          get: async () => {
            const docs = [...documents]
              .filter(([key, data]) => key.includes(`/${name}/`) && data[field] === value)
              .map(([key, data]) => ({ id: key.split('/').at(-1), data: () => data }));
            return { empty: docs.length === 0, docs };
          },
        }),
      }),
    }),
    runTransaction: async (work: (transaction: any) => Promise<any>) => {
      const writes: Array<['set' | 'update', any, Record<string, any>]> = [];
      const transaction = {
        get: (target: any) => target.get(),
        set: (target: any, data: Record<string, any>) => writes.push(['set', target, data]),
        update: (target: any, data: Record<string, any>) => writes.push(['update', target, data]),
      };
      const result = await work(transaction);
      for (const [kind, target, data] of writes) {
        const current = documents.get(target.path) ?? {};
        documents.set(target.path, kind === 'set' ? data : { ...current, ...data });
      }
      return result;
    },
  };
  const context: FamilyInvitationContext = {
    db,
    now: () => NOW,
    generateCode: vi.fn(() => '7ZXWRZ'),
  };
  return { context, documents };
}

function seedInvitation(
  documents: Map<string, Record<string, any>>,
  overrides: Record<string, any> = {},
) {
  const record = {
    code: '7ZXWRZ',
    familyId: 'family-1',
    intendedRole: 'child',
    createdBy: 'owner-1',
    status: 'active',
    expiresAtMs: NOW.getTime() + INVITATION_TTL_MS,
    ...overrides,
  };
  documents.set(`families/${record.familyId}/invitations/${record.code}`, record);
  return record;
}

describe('createFamilyInvitationImpl', () => {
  let fixture: ReturnType<typeof fakeContext>;

  beforeEach(() => {
    fixture = fakeContext();
    fixture.documents.set('users/owner-1', { familyId: 'family-1', role: 'owner' });
    fixture.documents.set('families/family-1', { name: 'The Smiths' });
  });

  const call = (data: any, uid = 'owner-1') =>
    createFamilyInvitationImpl(data, { auth: { uid } } as any, fixture.context);

  it('creates a parent-intended invitation record', async () => {
    const result = await call({ intendedRole: 'parent', clientReqId: 'req-12345678' });

    expect(result.code).toBe('7ZXWRZ');
    expect(result.intendedRole).toBe('parent');
    expect(fixture.documents.get('families/family-1/invitations/7ZXWRZ')).toMatchObject({
      code: '7ZXWRZ',
      familyId: 'family-1',
      intendedRole: 'parent',
      createdBy: 'owner-1',
      status: 'active',
    });
  });

  it('creates a child-intended invitation record', async () => {
    await call({ intendedRole: 'child', clientReqId: 'req-12345678' });

    expect(fixture.documents.get('families/family-1/invitations/7ZXWRZ')).toMatchObject({
      intendedRole: 'child',
      status: 'active',
    });
  });

  it('records an expiry derived from the invitation TTL', async () => {
    const result = await call({ intendedRole: 'child', clientReqId: 'req-12345678' });
    expect(result.expiresAtMs).toBe(NOW.getTime() + INVITATION_TTL_MS);
  });

  it('never issues an owner invitation', async () => {
    await expect(call({ intendedRole: 'owner', clientReqId: 'req-12345678' })).rejects.toMatchObject({
      code: 'invalid-argument',
      message: 'INVALID_INTENDED_ROLE',
    });
    expect(fixture.documents.get('families/family-1/invitations/7ZXWRZ')).toBeUndefined();
  });

  it('rejects unknown roles', async () => {
    await expect(call({ intendedRole: 'admin', clientReqId: 'req-12345678' })).rejects.toMatchObject({
      message: 'INVALID_INTENDED_ROLE',
    });
  });

  it('rejects callers who are not a parent or owner of a family', async () => {
    fixture.documents.set('users/child-1', { familyId: 'family-1', role: 'child' });
    await expect(call({ intendedRole: 'child', clientReqId: 'req-12345678' }, 'child-1')).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('rejects unauthenticated callers', async () => {
    await expect(
      createFamilyInvitationImpl({ intendedRole: 'child', clientReqId: 'req-12345678' } as any, {} as any, fixture.context),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('is idempotent for a repeated client request id', async () => {
    const first = await call({ intendedRole: 'parent', clientReqId: 'req-12345678' });
    const second = await call({ intendedRole: 'parent', clientReqId: 'req-12345678' });
    expect(second).toEqual(first);
  });
});

describe('previewInvitationImpl', () => {
  let fixture: ReturnType<typeof fakeContext>;

  beforeEach(() => {
    fixture = fakeContext();
    fixture.documents.set('families/family-1', { name: 'The Smiths', inviteCode: 'ABC123' });
  });

  const preview = (code: string) =>
    previewInvitationImpl({ code }, {} as any, fixture.context);

  it('returns only the family name and intended role once validated', async () => {
    seedInvitation(fixture.documents, { intendedRole: 'parent' });

    await expect(preview('7zxwrz')).resolves.toEqual({
      familyName: 'The Smiths',
      intendedRole: 'parent',
    });
  });

  it('does not expose any other family information', async () => {
    seedInvitation(fixture.documents);
    const result = await preview('7ZXWRZ');
    expect(Object.keys(result).sort()).toEqual(['familyName', 'intendedRole']);
  });

  it('rejects an unknown code without disclosing anything', async () => {
    await expect(preview('AAAAAA')).rejects.toMatchObject({
      code: 'not-found',
      message: 'INVALID_INVITATION',
    });
  });

  it('rejects a malformed code', async () => {
    await expect(preview('nope')).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects an expired invitation', async () => {
    seedInvitation(fixture.documents, { expiresAtMs: NOW.getTime() - 1 });
    await expect(preview('7ZXWRZ')).rejects.toMatchObject({ message: 'INVITATION_EXPIRED' });
  });

  it('rejects an already-used invitation', async () => {
    seedInvitation(fixture.documents, { status: 'used' });
    await expect(preview('7ZXWRZ')).rejects.toMatchObject({ message: 'INVITATION_ALREADY_USED' });
  });

  it('rejects a revoked invitation', async () => {
    seedInvitation(fixture.documents, { status: 'revoked' });
    await expect(preview('7ZXWRZ')).rejects.toMatchObject({ message: 'INVITATION_REVOKED' });
  });
});

describe('acceptInvitationImpl', () => {
  let fixture: ReturnType<typeof fakeContext>;

  beforeEach(() => {
    fixture = fakeContext();
    fixture.documents.set('families/family-1', { name: 'The Smiths' });
    fixture.documents.set('users/joiner-1', { uid: 'joiner-1', displayName: 'Joiner' });
  });

  const accept = (data: any, uid = 'joiner-1') =>
    acceptInvitationImpl(data, { auth: { uid } } as any, fixture.context);

  it('derives the pending role from the invitation record', async () => {
    seedInvitation(fixture.documents, { intendedRole: 'parent' });

    const result = await accept({ code: '7ZXWRZ', clientReqId: 'req-12345678' });

    expect(result).toEqual({ familyId: 'family-1', status: 'pending', intendedRole: 'parent' });
    expect(fixture.documents.get('families/family-1/join_requests/joiner-1')).toMatchObject({
      uid: 'joiner-1',
      status: 'pending',
      intendedRole: 'parent',
      invitationCode: '7ZXWRZ',
    });
  });

  it('ignores any client-supplied role, so URL manipulation cannot escalate', async () => {
    seedInvitation(fixture.documents, { intendedRole: 'child' });

    const result = await accept({
      code: '7ZXWRZ',
      clientReqId: 'req-12345678',
      intendedRole: 'parent',
      role: 'owner',
      type: 'parent',
    });

    expect(result.intendedRole).toBe('child');
    expect(fixture.documents.get('families/family-1/join_requests/joiner-1')).toMatchObject({
      intendedRole: 'child',
    });
  });

  it('never produces an owner role', async () => {
    seedInvitation(fixture.documents, { intendedRole: 'owner' });

    await expect(accept({ code: '7ZXWRZ', clientReqId: 'req-12345678' })).rejects.toMatchObject({
      message: 'INVALID_INVITATION',
    });
  });

  it('marks the invitation as used', async () => {
    seedInvitation(fixture.documents);
    await accept({ code: '7ZXWRZ', clientReqId: 'req-12345678' });

    expect(fixture.documents.get('families/family-1/invitations/7ZXWRZ')).toMatchObject({
      status: 'used',
      usedBy: 'joiner-1',
    });
  });

  it('rejects an already-used invitation for a different user', async () => {
    seedInvitation(fixture.documents, { status: 'used', usedBy: 'someone-else' });

    await expect(accept({ code: '7ZXWRZ', clientReqId: 'req-12345678' })).rejects.toMatchObject({
      message: 'INVITATION_ALREADY_USED',
    });
  });

  it('rejects an expired invitation', async () => {
    seedInvitation(fixture.documents, { expiresAtMs: NOW.getTime() - 1 });
    await expect(accept({ code: '7ZXWRZ', clientReqId: 'req-12345678' })).rejects.toMatchObject({
      message: 'INVITATION_EXPIRED',
    });
  });

  it('rejects an invalid code', async () => {
    await expect(accept({ code: 'ZZZZZZ', clientReqId: 'req-12345678' })).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it('reports when the user already belongs to that family', async () => {
    seedInvitation(fixture.documents);
    fixture.documents.set('users/joiner-1', { displayName: 'Joiner', familyId: 'family-1' });

    await expect(accept({ code: '7ZXWRZ', clientReqId: 'req-12345678' })).rejects.toMatchObject({
      message: 'ALREADY_IN_THIS_FAMILY',
    });
  });

  it('reports when the user already belongs to another family', async () => {
    seedInvitation(fixture.documents);
    fixture.documents.set('users/joiner-1', { displayName: 'Joiner', familyId: 'family-2' });

    await expect(accept({ code: '7ZXWRZ', clientReqId: 'req-12345678' })).rejects.toMatchObject({
      message: 'ALREADY_IN_FAMILY',
    });
  });

  it('requires a completed profile', async () => {
    seedInvitation(fixture.documents);
    fixture.documents.set('users/joiner-1', { uid: 'joiner-1' });

    await expect(accept({ code: '7ZXWRZ', clientReqId: 'req-12345678' })).rejects.toMatchObject({
      message: 'PROFILE_REQUIRED',
    });
  });

  it('requires authentication', async () => {
    seedInvitation(fixture.documents);
    await expect(
      acceptInvitationImpl({ code: '7ZXWRZ', clientReqId: 'req-12345678' }, {} as any, fixture.context),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('is idempotent when the same request is replayed after a refresh', async () => {
    seedInvitation(fixture.documents);
    const first = await accept({ code: '7ZXWRZ', clientReqId: 'req-12345678' });
    const second = await accept({ code: '7ZXWRZ', clientReqId: 'req-12345678' });
    expect(second).toEqual(first);
  });
});
