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
  requestFamilyJoinImpl,
  regenerateFamilyCodeImpl,
  type FamilyMembershipContext,
} from './familyMembership';

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
    collection: (path: string) => ({
      where: (_field: string, _op: string, value: string) => ({
        limit: () => ({
          get: async () => ({
            empty: ![...documents].some(([key, data]) => key.startsWith(`${path}/`) && data.inviteCode === value),
            docs: [...documents]
              .filter(([key, data]) => key.startsWith(`${path}/`) && data.inviteCode === value)
              .map(([key, data]) => ({ id: key.split('/').at(-1), data: () => data })),
          }),
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
  const context: FamilyMembershipContext = {
    db,
    now: () => new Date('2026-07-29T10:00:00Z'),
    generateCode: vi.fn(() => 'NEW456'),
  };
  return { context, documents };
}

describe('requestFamilyJoinImpl', () => {
  let fixture: ReturnType<typeof fakeContext>;

  beforeEach(() => {
    fixture = fakeContext();
    fixture.documents.set('users/joiner-1', { uid: 'joiner-1', displayName: 'Joiner' });
    fixture.documents.set('families/family-1', { name: 'Family', inviteCode: 'ABC123' });
  });

  it('creates a pending request without storing any requester role', async () => {
    const result = await requestFamilyJoinImpl(
      { familyCode: ' abc123 ', clientReqId: 'req-12345678', requestedRole: 'owner' } as any,
      { auth: { uid: 'joiner-1' } } as any,
      fixture.context,
    );

    expect(result).toEqual({ familyId: 'family-1', status: 'pending' });
    expect(fixture.documents.get('families/family-1/join_requests/joiner-1')).toEqual({
      uid: 'joiner-1',
      displayName: 'Joiner',
      status: 'pending',
      createdAt: 'SERVER_TIMESTAMP',
    });
    expect(fixture.documents.get('users/joiner-1')).not.toHaveProperty('familyId');
    expect(fixture.documents.get('families/family-1/join_requests/joiner-1')).not.toHaveProperty('intendedRole');
  });

  it('rejects an invalid code without exposing family data', async () => {
    await expect(requestFamilyJoinImpl(
      { familyCode: 'NOPE99', clientReqId: 'req-12345678' },
      { auth: { uid: 'joiner-1' } } as any,
      fixture.context,
    )).rejects.toMatchObject({ code: 'not-found' });
  });

  it('rejects callers who already belong to a family', async () => {
    fixture.documents.set('users/joiner-1', {
      uid: 'joiner-1', displayName: 'Joiner', familyId: 'family-2',
    });
    await expect(requestFamilyJoinImpl(
      { familyCode: 'ABC123', clientReqId: 'req-12345678' },
      { auth: { uid: 'joiner-1' } } as any,
      fixture.context,
    )).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('returns the existing pending request idempotently', async () => {
    fixture.documents.set('families/family-1/join_requests/joiner-1', {
      uid: 'joiner-1', displayName: 'Joiner', status: 'pending',
    });
    await expect(requestFamilyJoinImpl(
      { familyCode: 'ABC123', clientReqId: 'req-12345678' },
      { auth: { uid: 'joiner-1' } } as any,
      fixture.context,
    )).resolves.toEqual({ familyId: 'family-1', status: 'pending' });
  });

  it('rate-limits repeated family-code guesses', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(requestFamilyJoinImpl(
        { familyCode: 'NOPE99', clientReqId: `attempt-${attempt}-1234` },
        { auth: { uid: 'joiner-1' } } as any,
        fixture.context,
      )).rejects.toMatchObject({ code: 'not-found' });
    }
    await expect(requestFamilyJoinImpl(
      { familyCode: 'NOPE99', clientReqId: 'attempt-10-1234' },
      { auth: { uid: 'joiner-1' } } as any,
      fixture.context,
    )).rejects.toMatchObject({ code: 'resource-exhausted' });
  });
});

describe('regenerateFamilyCodeImpl', () => {
  it('requires the owner, updates only the code, and preserves pending requests', async () => {
    const { context, documents } = fakeContext();
    documents.set('users/owner-1', { uid: 'owner-1', familyId: 'family-1', role: 'owner' });
    documents.set('families/family-1', { name: 'Family', inviteCode: 'OLD123' });
    documents.set('families/family-1/join_requests/joiner-1', { uid: 'joiner-1', status: 'pending' });

    await expect(regenerateFamilyCodeImpl(
      { clientReqId: 'regen-12345678' },
      { auth: { uid: 'owner-1' } } as any,
      context,
    )).resolves.toEqual({ familyCode: 'NEW456' });
    expect(documents.get('families/family-1')).toMatchObject({ name: 'Family', inviteCode: 'NEW456' });
    expect(documents.get('families/family-1/join_requests/joiner-1')?.status).toBe('pending');
  });

  it('denies a parent and never changes the code', async () => {
    const { context, documents } = fakeContext();
    documents.set('users/parent-1', { uid: 'parent-1', familyId: 'family-1', role: 'parent' });
    documents.set('families/family-1', { inviteCode: 'OLD123' });
    await expect(regenerateFamilyCodeImpl(
      { clientReqId: 'regen-12345678' },
      { auth: { uid: 'parent-1' } } as any,
      context,
    )).rejects.toMatchObject({ code: 'permission-denied' });
    expect(documents.get('families/family-1')?.inviteCode).toBe('OLD123');
  });

  it('is idempotent and retries a colliding generated code', async () => {
    const { context, documents } = fakeContext();
    documents.set('users/owner-1', { uid: 'owner-1', familyId: 'family-1', role: 'owner' });
    documents.set('families/family-1', { inviteCode: 'OLD123' });
    documents.set('families/other-family', { inviteCode: 'TAKEN1' });
    context.generateCode = vi.fn()
      .mockReturnValueOnce('TAKEN1')
      .mockReturnValueOnce('NEW456');

    const request = { auth: { uid: 'owner-1' } } as any;
    const input = { clientReqId: 'regen-12345678' };
    await expect(regenerateFamilyCodeImpl(input, request, context))
      .resolves.toEqual({ familyCode: 'NEW456' });
    await expect(regenerateFamilyCodeImpl(input, request, context))
      .resolves.toEqual({ familyCode: 'NEW456' });
    expect(context.generateCode).toHaveBeenCalledTimes(2);
  });

  it('invalidates the old code for new requests while the new code works', async () => {
    const { context, documents } = fakeContext();
    documents.set('users/owner-1', { uid: 'owner-1', familyId: 'family-1', role: 'owner' });
    documents.set('users/joiner-1', { uid: 'joiner-1', displayName: 'Joiner' });
    documents.set('families/family-1', { inviteCode: 'OLD123' });
    await regenerateFamilyCodeImpl(
      { clientReqId: 'regen-12345678' },
      { auth: { uid: 'owner-1' } } as any,
      context,
    );

    await expect(requestFamilyJoinImpl(
      { familyCode: 'OLD123', clientReqId: 'join-old-1234' },
      { auth: { uid: 'joiner-1' } } as any,
      context,
    )).rejects.toMatchObject({ code: 'not-found' });
    await expect(requestFamilyJoinImpl(
      { familyCode: 'NEW456', clientReqId: 'join-new-1234' },
      { auth: { uid: 'joiner-1' } } as any,
      context,
    )).resolves.toEqual({ familyId: 'family-1', status: 'pending' });
  });
});
