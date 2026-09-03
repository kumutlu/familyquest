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
  generateChildQrTokenImpl,
  scanChildQrTokenImpl,
  submitChildQrJoinRequestImpl,
  getChildQrJoinStatusImpl,
  approveChildQrJoinRequestImpl,
  rejectChildQrJoinRequestImpl,
  exchangeApprovedChildQrRequestImpl,
  QR_SESSION_TTL_MS,
  type ChildQrOnboardingContext,
} from './childQrOnboarding';

const NOW = new Date('2026-09-03T12:00:00Z');

function fakeContext() {
  const documents = new Map<string, Record<string, any>>();
  let autoIdCounter = 1;

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
    collection: (collPath: string) => ({
      doc: (docId?: string) => {
        const id = docId || `auto-doc-${autoIdCounter++}`;
        return ref(`${collPath}/${id}`);
      },
      where: (field: string, op: string, value: any) => ({
        get: async () => {
          const docs = [...documents]
            .filter(([key, data]) => {
              if (!key.startsWith(`${collPath}/`)) return false;
              if (op === '==') return data[field] === value;
              return false;
            })
            .map(([key, data]) => ({ id: key.split('/').at(-1), ref: ref(key), data: () => data }));
          return { empty: docs.length === 0, docs };
        },
      }),
    }),
    runTransaction: async (work: (transaction: any) => Promise<any>) => {
      const writes: Array<['set' | 'update' | 'delete', any, Record<string, any>]> = [];
      const transaction = {
        get: (target: any) => target.get(),
        set: (target: any, data: Record<string, any>) => writes.push(['set', target, data]),
        update: (target: any, data: Record<string, any>) => writes.push(['update', target, data]),
        delete: (target: any) => writes.push(['delete', target, {}]),
      };
      const result = await work(transaction);
      for (const [kind, target, data] of writes) {
        if (kind === 'delete') {
          documents.delete(target.path);
        } else {
          const current = documents.get(target.path) ?? {};
          documents.set(target.path, kind === 'set' ? data : { ...current, ...data });
        }
      }
      return result;
    },
  };

  const createdTokens: Array<{ uid: string; claims: Record<string, any> }> = [];
  const auth: any = {
    createCustomToken: vi.fn(async (uid: string, claims: Record<string, any>) => {
      createdTokens.push({ uid, claims });
      return `custom-token-for-${uid}`;
    }),
  };

  let mockTime = NOW.getTime();
  const context: ChildQrOnboardingContext = {
    db,
    auth,
    nowMs: () => mockTime,
  };

  return { context, documents, createdTokens, setMockTime: (t: number) => { mockTime = t; } };
}

describe('Task 1: Backend QR Session & Token Lookup Primitive', () => {
  let fixture: ReturnType<typeof fakeContext>;

  beforeEach(() => {
    fixture = fakeContext();
    fixture.documents.set('users/parent-1', { familyId: 'family-1', role: 'parent' });
    fixture.documents.set('families/family-1', { name: 'The Smiths' });
  });

  const generate = (uid = 'parent-1') =>
    generateChildQrTokenImpl({ auth: { uid } } as any, fixture.context);

  const scan = (token: string) =>
    scanChildQrTokenImpl({ token }, fixture.context);

  it('Test 1: QR contains no familyId/childId/role/inviteCode', async () => {
    const { rawToken } = await generate();
    expect(rawToken).not.toContain('family-1');
    expect(rawToken).not.toContain('child');
    expect(rawToken).not.toContain('parent');
    expect(rawToken).not.toContain('owner');
    expect(rawToken).not.toContain('role');
    expect(rawToken).not.toContain('invite');
  });

  it('Test 2: QR has >=256-bit entropy', async () => {
    const { rawToken } = await generate();
    expect(rawToken.length).toBeGreaterThanOrEqual(43);
  });

  it('Test 3: stored QR token is hashed, raw token absent', async () => {
    const { rawToken } = await generate();
    let foundRawInDocs = false;
    for (const [path, doc] of fixture.documents.entries()) {
      if (path.includes('qr')) {
        const json = JSON.stringify(doc);
        if (json.includes(rawToken)) {
          foundRawInDocs = true;
        }
      }
    }
    expect(foundRawInDocs).toBe(false);
  });

  it('Test 4: preview grants zero authority', async () => {
    const { rawToken, expiresAtMs } = await generate();
    const preview = await scan(rawToken);
    expect(preview).toEqual({ valid: true, expiresAtMs });
    expect((preview as any).familyId).toBeUndefined();
    expect((preview as any).role).toBeUndefined();
    expect((preview as any).childId).toBeUndefined();
  });

  it('Test 5: preview does not consume QR', async () => {
    const { rawToken } = await generate();
    await scan(rawToken);
    await scan(rawToken);
    const result = await scan(rawToken);
    expect(result.valid).toBe(true);
  });

  it('Test 9: expired QR fails', async () => {
    const { rawToken } = await generate();
    fixture.setMockTime(NOW.getTime() + QR_SESSION_TTL_MS + 1000);
    await expect(scan(rawToken)).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'QR_EXPIRED',
    });
  });

  it('Test 10: revoked QR fails', async () => {
    const { rawToken } = await generate();
    for (const [path, doc] of fixture.documents.entries()) {
      if (path.includes('qr_sessions')) {
        fixture.documents.set(path, { ...doc, status: 'revoked' });
      }
    }
    await expect(scan(rawToken)).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'QR_REVOKED',
    });
  });

  it('Test 11: generating new QR revokes old QR', async () => {
    const first = await generate();
    const second = await generate();

    await expect(scan(first.rawToken)).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'QR_REVOKED',
    });

    const secondPreview = await scan(second.rawToken);
    expect(secondPreview.valid).toBe(true);
  });
});

describe('Task 2: Backend Pending Join Request & Secret Status Primitive', () => {
  let fixture: ReturnType<typeof fakeContext>;

  beforeEach(() => {
    fixture = fakeContext();
    fixture.documents.set('users/parent-1', { familyId: 'family-1', role: 'parent' });
    fixture.documents.set('families/family-1', { name: 'The Smiths' });
    fixture.documents.set('users/device-child-uid', { uid: 'device-child-uid' });
  });

  const generate = (uid = 'parent-1') =>
    generateChildQrTokenImpl({ auth: { uid } } as any, fixture.context);

  const submit = (token: string, clientReqId = 'req-1', uid = 'device-child-uid') =>
    submitChildQrJoinRequestImpl({ token, clientReqId }, { auth: { uid } } as any, fixture.context);

  it('RED TEST: unauthenticated submitChildQrJoinRequest succeeds without auth context', async () => {
    const { rawToken } = await generate();
    const unauthRequest = {} as any;
    const res = await submitChildQrJoinRequestImpl({ token: rawToken, clientReqId: 'req-unauth-1' }, unauthRequest, fixture.context);
    expect(res.status).toBe('pending');
    expect(res.requestId).toBeDefined();
    expect(res.requestSecret).toBeDefined();
  });

  const getStatus = (requestId: string, requestSecret: string) =>
    getChildQrJoinStatusImpl({ requestId, requestSecret }, fixture.context);

  it('Test 6: first request consumes QR', async () => {
    const { rawToken } = await generate();
    const res = await submit(rawToken);

    expect(res.status).toBe('pending');
    expect(res.requestId).toBeDefined();
    expect(res.requestSecret).toBeDefined();

    await expect(scanChildQrTokenImpl({ token: rawToken }, fixture.context)).rejects.toMatchObject({
      message: 'QR_ALREADY_USED',
    });
  });

  it('Test 7: second request fails', async () => {
    const { rawToken } = await generate();
    await submit(rawToken, 'req-1');

    await expect(submit(rawToken, 'req-2')).rejects.toMatchObject({
      message: 'QR_ALREADY_USED',
    });
  });

  it('Test 12: pending request creates no child', async () => {
    const { rawToken } = await generate();
    const usersBefore = [...fixture.documents.keys()].filter((k) => k.startsWith('users/')).length;

    await submit(rawToken);

    const usersAfter = [...fixture.documents.keys()].filter((k) => k.startsWith('users/')).length;
    expect(usersAfter).toBe(usersBefore);
  });

  it('Test 13: pending request creates no wallet', async () => {
    const { rawToken } = await generate();
    const walletsBefore = [...fixture.documents.keys()].filter((k) => k.includes('/wallets/')).length;

    await submit(rawToken);

    const walletsAfter = [...fixture.documents.keys()].filter((k) => k.includes('/wallets/')).length;
    expect(walletsAfter).toBe(walletsBefore);
  });

  it('Test 14: pending request creates no membership', async () => {
    const { rawToken } = await generate();
    await submit(rawToken);

    const deviceProfile = fixture.documents.get('users/device-child-uid');
    expect(deviceProfile?.familyId).toBeUndefined();
  });

  it('Test 15: request secret is hashed server-side', async () => {
    const { rawToken } = await generate();
    const res = await submit(rawToken);

    let foundRawSecretInDocs = false;
    for (const [path, doc] of fixture.documents.entries()) {
      if (path.includes('childQrJoinSecrets')) {
        const json = JSON.stringify(doc);
        if (json.includes(res.requestSecret)) {
          foundRawSecretInDocs = true;
        }
      }
    }
    expect(foundRawSecretInDocs).toBe(false);
  });

  it('Test 31: wrong requestSecret cannot read request status', async () => {
    const { rawToken } = await generate();
    const res = await submit(rawToken);

    const validStatus = await getStatus(res.requestId, res.requestSecret);
    expect(validStatus.status).toBe('pending');

    await expect(getStatus(res.requestId, 'wrong-secret')).rejects.toMatchObject({
      message: 'JOIN_REQUEST_NOT_FOUND',
    });
  });
});

describe('Task 3: Backend Parent Approval & Rejection', () => {
  let fixture: ReturnType<typeof fakeContext>;

  beforeEach(() => {
    fixture = fakeContext();
    fixture.documents.set('users/parent-1', { familyId: 'family-1', role: 'parent' });
    fixture.documents.set('users/parent-2-other', { familyId: 'family-2', role: 'parent' });
    fixture.documents.set('families/family-1', { name: 'The Smiths' });
    fixture.documents.set('families/family-2', { name: 'The Other Smiths' });

    fixture.documents.set('users/child-1', {
      uid: 'child-1',
      familyId: 'family-1',
      role: 'child',
      isManaged: true,
      authUid: 'existing-synth-auth-uid-1',
      rewardPoints: 100,
      lifetimeXP: 500,
      displayName: 'Ali',
    });
    fixture.documents.set('families/family-1/wallets/child-1', { balance: 2500 });
    fixture.documents.set('families/family-1/childLogins/child-1', {
      childId: 'child-1',
      authUid: 'existing-synth-auth-uid-1',
      familyId: 'family-1',
      status: 'enabled',
    });

    fixture.documents.set('users/child-other-family', {
      uid: 'child-other-family',
      familyId: 'family-2',
      role: 'child',
      isManaged: true,
      authUid: 'existing-synth-auth-uid-2',
      rewardPoints: 50,
      lifetimeXP: 200,
    });
  });

  const setupPendingRequest = async () => {
    const { rawToken } = await generateChildQrTokenImpl({ auth: { uid: 'parent-1' } } as any, fixture.context);
    const subRes = await submitChildQrJoinRequestImpl({ token: rawToken, clientReqId: 'req-1' }, { auth: { uid: 'device-child-1' } } as any, fixture.context);
    return subRes;
  };

  const approve = (familyId: string, requestId: string, selectedManagedChildId: string, clientReqId = 'c-req-1', uid = 'parent-1') =>
    approveChildQrJoinRequestImpl({ familyId, requestId, selectedManagedChildId, clientReqId }, { auth: { uid } } as any, fixture.context);

  const reject = (familyId: string, requestId: string, rejectionReason?: string, clientReqId = 'c-req-1', uid = 'parent-1') =>
    rejectChildQrJoinRequestImpl({ familyId, requestId, rejectionReason, clientReqId }, { auth: { uid } } as any, fixture.context);

  it('Test 16: child cannot select managedChildId during request submission', async () => {
    const { rawToken } = await generateChildQrTokenImpl({ auth: { uid: 'parent-1' } } as any, fixture.context);
    const res = await submitChildQrJoinRequestImpl({ token: rawToken, clientReqId: 'req-1', selectedManagedChildId: 'child-1' } as any, { auth: { uid: 'device-child-1' } } as any, fixture.context);
    const reqDoc = fixture.documents.get(`families/family-1/child_qr_join_requests/${res.requestId}`);
    expect(reqDoc?.selectedManagedChildId).toBeNull();
  });

  it('Test 17: child cannot self-approve', async () => {
    const { requestId } = await setupPendingRequest();
    await expect(approve('family-1', requestId, 'child-1', 'c-1', 'device-child-1')).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('Test 18: unrelated family parent cannot approve', async () => {
    const { requestId } = await setupPendingRequest();
    await expect(approve('family-1', requestId, 'child-1', 'c-1', 'parent-2-other')).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('Test 19: parent must select existing managed child', async () => {
    const { requestId } = await setupPendingRequest();
    await expect(approve('family-1', requestId, 'non-existent-child', 'c-1', 'parent-1')).rejects.toMatchObject({
      message: 'CHILD_NOT_FOUND',
    });
  });

  it('Test 20: wrong-family child cannot be selected', async () => {
    const { requestId } = await setupPendingRequest();
    await expect(approve('family-1', requestId, 'child-other-family', 'c-1', 'parent-1')).rejects.toMatchObject({
      message: 'CHILD_NOT_IN_FAMILY',
    });
  });

  it('Test 21: inactive/non-managed child cannot be selected', async () => {
    const { requestId } = await setupPendingRequest();
    fixture.documents.set('users/adult-member', { familyId: 'family-1', role: 'parent' });
    await expect(approve('family-1', requestId, 'adult-member', 'c-1', 'parent-1')).rejects.toMatchObject({
      message: 'INVALID_TARGET_CHILD',
    });
  });

  it('Test 22: approval changes no points', async () => {
    const { requestId } = await setupPendingRequest();
    const pointsBefore = fixture.documents.get('users/child-1')?.rewardPoints;

    await approve('family-1', requestId, 'child-1');

    const pointsAfter = fixture.documents.get('users/child-1')?.rewardPoints;
    expect(pointsAfter).toBe(pointsBefore);
  });

  it('Test 23: approval changes no XP', async () => {
    const { requestId } = await setupPendingRequest();
    const xpBefore = fixture.documents.get('users/child-1')?.lifetimeXP;

    await approve('family-1', requestId, 'child-1');

    const xpAfter = fixture.documents.get('users/child-1')?.lifetimeXP;
    expect(xpAfter).toBe(xpBefore);
  });

  it('Test 24: approval changes no wallet balance', async () => {
    const { requestId } = await setupPendingRequest();
    const walletBefore = fixture.documents.get('families/family-1/wallets/child-1')?.balance;

    await approve('family-1', requestId, 'child-1');

    const walletAfter = fixture.documents.get('families/family-1/wallets/child-1')?.balance;
    expect(walletAfter).toBe(walletBefore);
  });

  it('Test 25: approval does not alter existing authUid', async () => {
    const { requestId } = await setupPendingRequest();
    const authUidBefore = fixture.documents.get('users/child-1')?.authUid;

    await approve('family-1', requestId, 'child-1');

    const authUidAfter = fixture.documents.get('users/child-1')?.authUid;
    expect(authUidAfter).toBe(authUidBefore);
  });

  it('Test 26: approval does not alter childLogin identity', async () => {
    const { requestId } = await setupPendingRequest();
    const loginRecordBefore = fixture.documents.get('families/family-1/childLogins/child-1');

    await approve('family-1', requestId, 'child-1');

    const loginRecordAfter = fixture.documents.get('families/family-1/childLogins/child-1');
    expect(loginRecordAfter).toEqual(loginRecordBefore);
  });

  it('Test 27: approval creates no new Firebase child identity', async () => {
    const { requestId } = await setupPendingRequest();
    const usersBefore = [...fixture.documents.keys()].filter((k) => k.startsWith('users/')).length;

    await approve('family-1', requestId, 'child-1');

    const usersAfter = [...fixture.documents.keys()].filter((k) => k.startsWith('users/')).length;
    expect(usersAfter).toBe(usersBefore);
  });

  it('Test 28: approve replay is idempotent', async () => {
    const { requestId } = await setupPendingRequest();
    const first = await approve('family-1', requestId, 'child-1', 'client-req-1');
    const second = await approve('family-1', requestId, 'child-1', 'client-req-1');

    expect(second).toEqual(first);
  });

  it('Test 29: approve/reject race has one terminal result', async () => {
    const { requestId } = await setupPendingRequest();
    await reject('family-1', requestId, 'Not allowed', 'reject-req-1');

    await expect(approve('family-1', requestId, 'child-1', 'approve-req-1')).rejects.toMatchObject({
      message: 'REQUEST_NOT_PENDING',
    });
  });

  it('Test 30: reject is terminal', async () => {
    const { requestId } = await setupPendingRequest();
    const res = await reject('family-1', requestId, 'Denied');
    expect(res.status).toBe('rejected');

    await expect(approve('family-1', requestId, 'child-1')).rejects.toMatchObject({
      message: 'REQUEST_NOT_PENDING',
    });
  });
});

describe('Task 4: Backend Custom Token Exchange Primitive', () => {
  let fixture: ReturnType<typeof fakeContext>;

  beforeEach(() => {
    fixture = fakeContext();
    fixture.documents.set('users/parent-1', { familyId: 'family-1', role: 'parent' });
    fixture.documents.set('families/family-1', { name: 'The Smiths' });

    fixture.documents.set('users/child-1', {
      uid: 'child-1',
      familyId: 'family-1',
      role: 'child',
      isManaged: true,
      authUid: 'existing-synth-auth-uid-1',
      displayName: 'Ali',
    });
    fixture.documents.set('families/family-1/childLogins/child-1', {
      childId: 'child-1',
      authUid: 'existing-synth-auth-uid-1',
      familyId: 'family-1',
      status: 'enabled',
    });
  });

  const setupApprovedRequest = async () => {
    const { rawToken } = await generateChildQrTokenImpl({ auth: { uid: 'parent-1' } } as any, fixture.context);
    const subRes = await submitChildQrJoinRequestImpl({ token: rawToken, clientReqId: 'req-1' }, { auth: { uid: 'device-child-1' } } as any, fixture.context);
    await approveChildQrJoinRequestImpl({ familyId: 'family-1', requestId: subRes.requestId, selectedManagedChildId: 'child-1', clientReqId: 'c-1' }, { auth: { uid: 'parent-1' } } as any, fixture.context);
    return subRes;
  };

  const exchange = (requestId: string, requestSecret: string) =>
    exchangeApprovedChildQrRequestImpl({ requestId, requestSecret }, fixture.context);

  it('Test 32: wrong requestSecret cannot exchange token', async () => {
    const { requestId } = await setupApprovedRequest();
    await expect(exchange(requestId, 'wrong-secret')).rejects.toMatchObject({
      message: 'JOIN_REQUEST_NOT_FOUND',
    });
  });

  it('Test 33: approved request exchanges to EXISTING child authUid', async () => {
    const { requestId, requestSecret } = await setupApprovedRequest();
    const res = await exchange(requestId, requestSecret);

    expect(res.customToken).toBe('custom-token-for-existing-synth-auth-uid-1');
    expect(res.childId).toBe('child-1');
  });

  it('Test 34: custom token claims match existing child identity', async () => {
    const { requestId, requestSecret } = await setupApprovedRequest();
    await exchange(requestId, requestSecret);

    expect(fixture.createdTokens[0]).toEqual({
      uid: 'existing-synth-auth-uid-1',
      claims: {
        role: 'child',
        familyId: 'family-1',
        childId: 'child-1',
        managedChild: true,
      },
    });
  });

  it('Test 35: exchange cannot switch selected child', async () => {
    const { requestId, requestSecret } = await setupApprovedRequest();
    const res = await exchangeApprovedChildQrRequestImpl({ requestId, requestSecret, selectedManagedChildId: 'hacked-child-id' } as any, fixture.context);

    expect(res.childId).toBe('child-1');
  });

  it('Test 36: exchange retry is recoverable/idempotent', async () => {
    const { requestId, requestSecret } = await setupApprovedRequest();
    const first = await exchange(requestId, requestSecret);
    const second = await exchange(requestId, requestSecret);

    expect(second).toEqual(first);
  });

  it('Test 37: target becoming invalid before exchange fails closed', async () => {
    const { requestId, requestSecret } = await setupApprovedRequest();

    // Soft delete child profile between approval and exchange
    fixture.documents.set('users/child-1', {
      uid: 'child-1',
      familyId: 'family-1',
      role: 'child',
      isManaged: true,
      authUid: 'existing-synth-auth-uid-1',
      status: 'deleted',
    });

    await expect(exchange(requestId, requestSecret)).rejects.toMatchObject({
      message: 'CHILD_INACTIVE',
    });
  });
});
