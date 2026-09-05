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
  const authUsers = new Map<string, any>();
  const auth: any = {
    authUsers,
    getUser: vi.fn(async (uid: string) => {
      const u = authUsers.get(uid);
      if (!u) {
        const err: any = new Error('User not found');
        err.code = 'auth/user-not-found';
        throw err;
      }
      return u;
    }),
    createUser: vi.fn(async (data: any) => {
      if (authUsers.has(data.uid)) {
        const err: any = new Error('User already exists');
        err.code = 'auth/uid-already-exists';
        throw err;
      }
      const record = { uid: data.uid, ...data };
      authUsers.set(data.uid, record);
      return record;
    }),
    setCustomUserClaims: vi.fn(async (uid: string, claims: Record<string, any>) => {
      const u = authUsers.get(uid);
      if (u) u.customClaims = claims;
    }),
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

  return { context, documents, createdTokens, authUsers, setMockTime: (t: number) => { mockTime = t; } };
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

  const submit = (token: string, clientReqId = 'req-1', uid = 'device-child-uid', requesterDisplayName = 'Ali') =>
    submitChildQrJoinRequestImpl({ token, clientReqId, requesterDisplayName }, { auth: { uid } } as any, fixture.context);

  it('RED TEST: unauthenticated submitChildQrJoinRequest succeeds without auth context', async () => {
    const { rawToken } = await generate();
    const unauthRequest = {} as any;
    const res = await submitChildQrJoinRequestImpl({ token: rawToken, requesterDisplayName: 'Ali', clientReqId: 'req-unauth-1' }, unauthRequest, fixture.context);
    expect(res.status).toBe('pending');
    expect(res.requestId).toBeDefined();
    expect(res.requestSecret).toBeDefined();
  });

  it('RED TEST: missing requesterDisplayName is rejected with REQUESTER_NAME_REQUIRED', async () => {
    const { rawToken } = await generate();
    await expect(
      submitChildQrJoinRequestImpl({ token: rawToken, requesterDisplayName: '   ' }, {} as any, fixture.context),
    ).rejects.toMatchObject({ message: 'REQUESTER_NAME_REQUIRED' });
  });

  it('RED TEST: trimmed requesterDisplayName is accepted and stored', async () => {
    const { rawToken } = await generate();
    const res = await submitChildQrJoinRequestImpl(
      { token: rawToken, requesterDisplayName: '  Ali  ', requesterDeviceLabel: 'iPhone' },
      {} as any,
      fixture.context,
    );
    const doc = fixture.documents.get(`families/family-1/child_qr_join_requests/${res.requestId}`);
    expect(doc?.requesterDisplayName).toBe('Ali');
    expect(doc?.requesterDeviceLabel).toBe('iPhone');
  });

  it('RED TEST: overlong requesterDisplayName (>40 chars) is rejected with REQUESTER_NAME_TOO_LONG', async () => {
    const { rawToken } = await generate();
    const longName = 'A'.repeat(41);
    await expect(
      submitChildQrJoinRequestImpl({ token: rawToken, requesterDisplayName: longName }, {} as any, fixture.context),
    ).rejects.toMatchObject({ message: 'REQUESTER_NAME_TOO_LONG' });
  });

  it('RED TEST: HTML tags in requesterDisplayName are sanitized to plain text', async () => {
    const { rawToken } = await generate();
    const res = await submitChildQrJoinRequestImpl(
      { token: rawToken, requesterDisplayName: '<script>alert("xss")</script>Ali' },
      {} as any,
      fixture.context,
    );
    const doc = fixture.documents.get(`families/family-1/child_qr_join_requests/${res.requestId}`);
    expect(doc?.requesterDisplayName).toBe('alert("xss")Ali');
  });

  it('RED TEST: child cannot use display name to auto-select managedChildId', async () => {
    const { rawToken } = await generate();
    // child display name matches an existing child profile name in the family
    const res = await submitChildQrJoinRequestImpl(
      { token: rawToken, requesterDisplayName: 'Ali' },
      {} as any,
      fixture.context,
    );
    const doc = fixture.documents.get(`families/family-1/child_qr_join_requests/${res.requestId}`);
    expect(doc?.selectedManagedChildId).toBeNull();
  });

  it('RED TEST: submit creates deterministic in-app notification for parents and replay creates zero duplicates', async () => {
    const { rawToken } = await generate();
    const res = await submitChildQrJoinRequestImpl(
      { token: rawToken, requesterDisplayName: 'Ali', requesterDeviceLabel: 'iPhone' },
      {} as any,
      fixture.context,
    );
    const notifDoc = fixture.documents.get(`families/family-1/notifications/qr_join_${res.requestId}`);
    expect(notifDoc).toBeDefined();
    expect(notifDoc?.title).toBe('Ali wants to connect a device');
    expect(notifDoc?.type).toBe('child_qr_device_join');

    // Attempt replaying the token
    await expect(
      submitChildQrJoinRequestImpl({ token: rawToken, requesterDisplayName: 'Ali' }, {} as any, fixture.context),
    ).rejects.toMatchObject({ message: 'QR_ALREADY_USED' });

    // Ensure zero duplicate notification docs were created
    const notifKeys = Array.from(fixture.documents.keys()).filter((k: string) => k.includes('/notifications/'));
    expect(notifKeys.length).toBe(1);
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
    const subRes = await submitChildQrJoinRequestImpl({ token: rawToken, requesterDisplayName: 'Ali', clientReqId: 'req-1' }, { auth: { uid: 'device-child-1' } } as any, fixture.context);
    return subRes;
  };

  const approve = (familyId: string, requestId: string, selectedManagedChildId: string, clientReqId = 'c-req-1', uid = 'parent-1') =>
    approveChildQrJoinRequestImpl({ familyId, requestId, selectedManagedChildId, clientReqId }, { auth: { uid } } as any, fixture.context);

  const reject = (familyId: string, requestId: string, rejectionReason?: string, clientReqId = 'c-req-1', uid = 'parent-1') =>
    rejectChildQrJoinRequestImpl({ familyId, requestId, rejectionReason, clientReqId }, { auth: { uid } } as any, fixture.context);

  it('Test 16: child cannot select managedChildId during request submission', async () => {
    const { rawToken } = await generateChildQrTokenImpl({ auth: { uid: 'parent-1' } } as any, fixture.context);
    const res = await submitChildQrJoinRequestImpl({ token: rawToken, requesterDisplayName: 'Ali', clientReqId: 'req-1', selectedManagedChildId: 'child-1' } as any, { auth: { uid: 'device-child-1' } } as any, fixture.context);
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
    const subRes = await submitChildQrJoinRequestImpl({ token: rawToken, requesterDisplayName: 'Ali', clientReqId: 'req-1' }, { auth: { uid: 'device-child-1' } } as any, fixture.context);
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

  it('Test 37b: target child deleted completely before exchange fails closed', async () => {
    const { requestId, requestSecret } = await setupApprovedRequest();

    // Hard delete child user document between approval and exchange
    fixture.documents.delete('users/child-1');

    await expect(exchange(requestId, requestSecret)).rejects.toMatchObject({
      message: 'CHILD_INACTIVE',
    });
  });
});

describe('childQrOnboarding — Explicit Intent Architecture & New Child Creation', () => {
  let fixture: ReturnType<typeof fakeContext>;

  beforeEach(() => {
    fixture = fakeContext();
    fixture.documents.set('users/parent-1', {
      uid: 'parent-1',
      familyId: 'family-1',
      role: 'owner',
    });
    fixture.documents.set('users/child-1', {
      uid: 'child-1',
      familyId: 'family-1',
      role: 'child',
      isManaged: true,
      status: 'active',
    });
    fixture.documents.set('families/family-1/childLogins/child-1', {
      authUid: 'existing-synth-auth-uid-1',
    });
  });

  const parentReq = (data: any = {}) => ({ auth: { uid: 'parent-1' }, data } as any);

  it('Test 38: generateChildQrToken stores explicit intent new_child_join', async () => {
    const res = await generateChildQrTokenImpl(parentReq({ intent: 'new_child_join' }), fixture.context);
    expect(res.rawToken).toBeTruthy();

    const sessions = [...fixture.documents]
      .filter(([k]) => k.startsWith('families/family-1/child_qr_sessions/'))
      .map(([_, v]) => v);
    expect(sessions[0].intent).toBe('new_child_join');
    expect(sessions[0].targetChildId).toBeNull();
  });

  it('Test 39: generateChildQrToken stores explicit intent existing_child_device_bind with pinned targetChildId', async () => {
    const res = await generateChildQrTokenImpl(
      parentReq({ intent: 'existing_child_device_bind', targetChildId: 'child-1' }),
      fixture.context,
    );
    expect(res.rawToken).toBeTruthy();

    const sessions = [...fixture.documents]
      .filter(([k]) => k.startsWith('families/family-1/child_qr_sessions/'))
      .map(([_, v]) => v);
    expect(sessions[0].intent).toBe('existing_child_device_bind');
    expect(sessions[0].targetChildId).toBe('child-1');
  });

  it('Test 40: generateChildQrToken validates targetChildId requirements', async () => {
    // Missing targetChildId for existing_child_device_bind
    await expect(
      generateChildQrTokenImpl(parentReq({ intent: 'existing_child_device_bind' }), fixture.context),
    ).rejects.toMatchObject({ message: 'TARGET_CHILD_REQUIRED' });

    // Non-existent targetChildId
    await expect(
      generateChildQrTokenImpl(
        parentReq({ intent: 'existing_child_device_bind', targetChildId: 'non-existent' }),
        fixture.context,
      ),
    ).rejects.toMatchObject({ message: 'CHILD_NOT_FOUND' });

    // Target child provided for new_child_join
    await expect(
      generateChildQrTokenImpl(
        parentReq({ intent: 'new_child_join', targetChildId: 'child-1' }),
        fixture.context,
      ),
    ).rejects.toMatchObject({ message: 'TARGET_CHILD_NOT_ALLOWED' });
  });

  it('Test 41: submitChildQrJoinRequest creates tailored notifications based on intent', async () => {
    // 1. new_child_join
    const { rawToken: newChildToken } = await generateChildQrTokenImpl(
      parentReq({ intent: 'new_child_join' }),
      fixture.context,
    );
    const newChildReq = await submitChildQrJoinRequestImpl(
      { token: newChildToken, requesterDisplayName: 'Jamie', requesterDeviceLabel: 'iPad' },
      { auth: null } as any,
      fixture.context,
    );
    expect(newChildReq.requestId).toBeTruthy();

    const notifNew = fixture.documents.get(`families/family-1/notifications/qr_join_${newChildReq.requestId}`);
    expect(notifNew?.title).toBe('Jamie wants to join your family');

    // 2. existing_child_device_bind
    const { rawToken: bindToken } = await generateChildQrTokenImpl(
      parentReq({ intent: 'existing_child_device_bind', targetChildId: 'child-1' }),
      fixture.context,
    );
    const bindReq = await submitChildQrJoinRequestImpl(
      { token: bindToken, requesterDisplayName: 'Child Device', requesterDeviceLabel: 'iPhone' },
      { auth: null } as any,
      fixture.context,
    );

    const notifBind = fixture.documents.get(`families/family-1/notifications/qr_join_${bindReq.requestId}`);
    expect(notifBind?.title).toBe('Child Device wants to connect a device');
  });

  it('Test 42: approveChildQrJoinRequest atomically provisions new child and wallet for new_child_join', async () => {
    const { rawToken } = await generateChildQrTokenImpl(
      parentReq({ intent: 'new_child_join' }),
      fixture.context,
    );
    const subRes = await submitChildQrJoinRequestImpl(
      { token: rawToken, requesterDisplayName: 'Jamie' },
      { auth: null } as any,
      fixture.context,
    );

    const appRes = await approveChildQrJoinRequestImpl(
      { familyId: 'family-1', requestId: subRes.requestId },
      parentReq(),
      fixture.context,
    );

    expect(appRes.status).toBe('approved');
    expect(appRes.selectedManagedChildId).toBeTruthy();

    const childId = appRes.selectedManagedChildId;
    const userDoc = fixture.documents.get(`users/${childId}`);
    expect(userDoc).toBeDefined();
    expect(userDoc?.displayName).toBe('Jamie');
    expect(userDoc?.role).toBe('child');
    expect(userDoc?.isManaged).toBe(true);

    const walletDoc = fixture.documents.get(`families/family-1/wallets/${childId}`);
    expect(walletDoc).toBeDefined();
    expect(walletDoc?.balance).toBe(0);

    const loginDoc = fixture.documents.get(`families/family-1/childLogins/${childId}`);
    expect(loginDoc).toBeDefined();

    // Replay approval must be idempotent
    const replayRes = await approveChildQrJoinRequestImpl(
      { familyId: 'family-1', requestId: subRes.requestId },
      parentReq(),
      fixture.context,
    );
    expect(replayRes.selectedManagedChildId).toBe(childId);
  });

  it('Test 43: approveChildQrJoinRequest binds to existing child without creating new records for existing_child_device_bind', async () => {
    const { rawToken } = await generateChildQrTokenImpl(
      parentReq({ intent: 'existing_child_device_bind', targetChildId: 'child-1' }),
      fixture.context,
    );
    const subRes = await submitChildQrJoinRequestImpl(
      { token: rawToken, requesterDisplayName: 'Phone' },
      { auth: null } as any,
      fixture.context,
    );

    const usersBeforeCount = [...fixture.documents.keys()].filter(k => k.startsWith('users/')).length;
    const walletsBeforeCount = [...fixture.documents.keys()].filter(k => k.startsWith('wallets/')).length;

    const appRes = await approveChildQrJoinRequestImpl(
      { familyId: 'family-1', requestId: subRes.requestId },
      parentReq(),
      fixture.context,
    );

    expect(appRes.status).toBe('approved');
    expect(appRes.selectedManagedChildId).toBe('child-1');

    const usersAfterCount = [...fixture.documents.keys()].filter(k => k.startsWith('users/')).length;
    const walletsAfterCount = [...fixture.documents.keys()].filter(k => k.startsWith('wallets/')).length;

    expect(usersAfterCount).toBe(usersBeforeCount);
    expect(walletsAfterCount).toBe(walletsBeforeCount);
  });

  it('Test 44: approved new_child_join request exchanges to newly provisioned child custom token and claims', async () => {
    const { rawToken } = await generateChildQrTokenImpl(
      parentReq({ intent: 'new_child_join' }),
      fixture.context,
    );
    const subRes = await submitChildQrJoinRequestImpl(
      { token: rawToken, requesterDisplayName: 'Sam' },
      { auth: null } as any,
      fixture.context,
    );
    const appRes = await approveChildQrJoinRequestImpl(
      { familyId: 'family-1', requestId: subRes.requestId },
      parentReq(),
      fixture.context,
    );

    const exchangeRes = await exchangeApprovedChildQrRequestImpl(
      { requestId: subRes.requestId, requestSecret: subRes.requestSecret },
      fixture.context,
    );

    expect(exchangeRes.childId).toBe(appRes.selectedManagedChildId);
    expect(exchangeRes.customToken).toBe(`custom-token-for-${appRes.selectedManagedChildId}`);
    expect(fixture.createdTokens[0]).toEqual({
      uid: appRes.selectedManagedChildId,
      claims: {
        role: 'child',
        familyId: 'family-1',
        childId: appRes.selectedManagedChildId,
        managedChild: true,
      },
    });
  });

  it('Test 45 (RED): new_child_join writes wallet ONLY to canonical families/{familyId}/wallets/{childId} and NEVER root wallets/', async () => {
    const { rawToken } = await generateChildQrTokenImpl(
      parentReq({ intent: 'new_child_join' }),
      fixture.context,
    );
    const subRes = await submitChildQrJoinRequestImpl(
      { token: rawToken, requesterDisplayName: 'Robin' },
      { auth: null } as any,
      fixture.context,
    );
    const appRes = await approveChildQrJoinRequestImpl(
      { familyId: 'family-1', requestId: subRes.requestId },
      parentReq(),
      fixture.context,
    );

    const childId = appRes.selectedManagedChildId;
    // Canonical wallet path MUST exist
    const canonicalWallet = fixture.documents.get(`families/family-1/wallets/${childId}`);
    expect(canonicalWallet).toBeDefined();
    expect(canonicalWallet?.balance).toBe(0);

    // Root-level wallet MUST NOT exist
    const rootWallet = fixture.documents.get(`wallets/${childId}`);
    expect(rootWallet).toBeUndefined();
  });

  it('Test 46 (RED): deterministic identity — repeated or concurrent approval uses same childId and same authUid', async () => {
    const { rawToken } = await generateChildQrTokenImpl(
      parentReq({ intent: 'new_child_join' }),
      fixture.context,
    );
    const subRes = await submitChildQrJoinRequestImpl(
      { token: rawToken, requesterDisplayName: 'Sam' },
      { auth: null } as any,
      fixture.context,
    );

    const first = await approveChildQrJoinRequestImpl(
      { familyId: 'family-1', requestId: subRes.requestId },
      parentReq(),
      fixture.context,
    );
    const second = await approveChildQrJoinRequestImpl(
      { familyId: 'family-1', requestId: subRes.requestId },
      parentReq(),
      fixture.context,
    );

    expect(first.selectedManagedChildId).toBe(`child_qr_${subRes.requestId}`);
    expect(second.selectedManagedChildId).toBe(first.selectedManagedChildId);
    expect(fixture.authUsers.size).toBe(1);
    expect(fixture.authUsers.get(first.selectedManagedChildId)).toBeDefined();
  });

  it('Test 47 (RED): Auth create retry — resumes after Auth creation failure before Firestore finalization', async () => {
    const { rawToken } = await generateChildQrTokenImpl(
      parentReq({ intent: 'new_child_join' }),
      fixture.context,
    );
    const subRes = await submitChildQrJoinRequestImpl(
      { token: rawToken, requesterDisplayName: 'Alex' },
      { auth: null } as any,
      fixture.context,
    );

    // Pre-create Auth user to simulate partial crash after Auth creation
    const expectedChildId = `child_qr_${subRes.requestId}`;
    await fixture.context.auth?.createUser({
      uid: expectedChildId,
      displayName: 'Alex',
    });
    expect(fixture.authUsers.size).toBe(1);

    // Approval must not fail with auth/uid-already-exists; it must idempotently resume
    const appRes = await approveChildQrJoinRequestImpl(
      { familyId: 'family-1', requestId: subRes.requestId },
      parentReq(),
      fixture.context,
    );

    expect(appRes.status).toBe('approved');
    expect(appRes.selectedManagedChildId).toBe(expectedChildId);
    expect(fixture.authUsers.size).toBe(1); // exactly one Auth user
    expect(fixture.documents.get(`users/${expectedChildId}`)).toBeDefined();
    expect(fixture.documents.get(`families/family-1/wallets/${expectedChildId}`)).toBeDefined();
  });

  it('Test 48 (RED): Firestore-before-finalize retry — reconciles existing child and finalizes request', async () => {
    const { rawToken } = await generateChildQrTokenImpl(
      parentReq({ intent: 'new_child_join' }),
      fixture.context,
    );
    const subRes = await submitChildQrJoinRequestImpl(
      { token: rawToken, requesterDisplayName: 'Taylor' },
      { auth: null } as any,
      fixture.context,
    );

    const expectedChildId = `child_qr_${subRes.requestId}`;
    // Pre-seed profile and wallet as if earlier run wrote them but request update failed
    fixture.documents.set(`users/${expectedChildId}`, {
      uid: expectedChildId,
      id: expectedChildId,
      familyId: 'family-1',
      role: 'child',
      isManaged: true,
      displayName: 'Taylor',
    });
    fixture.documents.set(`families/family-1/wallets/${expectedChildId}`, {
      balance: 0,
    });

    const appRes = await approveChildQrJoinRequestImpl(
      { familyId: 'family-1', requestId: subRes.requestId },
      parentReq(),
      fixture.context,
    );

    expect(appRes.status).toBe('approved');
    expect(appRes.selectedManagedChildId).toBe(expectedChildId);
    const reqDoc = fixture.documents.get(`families/family-1/child_qr_join_requests/${subRes.requestId}`);
    expect(reqDoc?.status).toBe('approved');
    expect(reqDoc?.provisioningState).toBe('complete');
  });

  it('Test 49 (RED): request is NOT status=approved before Auth user exists and canonical state confirmed', async () => {
    const { rawToken } = await generateChildQrTokenImpl(
      parentReq({ intent: 'new_child_join' }),
      fixture.context,
    );
    const subRes = await submitChildQrJoinRequestImpl(
      { token: rawToken, requesterDisplayName: 'Casey' },
      { auth: null } as any,
      fixture.context,
    );

    // If Auth user creation throws an unexpected error, request must NOT become approved
    (fixture.context.auth?.createUser as any).mockRejectedValueOnce(new Error('Auth service temporarily down'));

    await expect(
      approveChildQrJoinRequestImpl(
        { familyId: 'family-1', requestId: subRes.requestId },
        parentReq(),
        fixture.context,
      ),
    ).rejects.toThrow('Auth service temporarily down');

    const reqDoc = fixture.documents.get(`families/family-1/child_qr_join_requests/${subRes.requestId}`);
    expect(reqDoc?.status).not.toBe('approved');
  });

  it('Test 50 (RED): canonical managed-child fields match existing direct Add Child flow', async () => {
    const { rawToken } = await generateChildQrTokenImpl(
      parentReq({ intent: 'new_child_join' }),
      fixture.context,
    );
    const subRes = await submitChildQrJoinRequestImpl(
      { token: rawToken, requesterDisplayName: 'Jordan' },
      { auth: null } as any,
      fixture.context,
    );
    const appRes = await approveChildQrJoinRequestImpl(
      { familyId: 'family-1', requestId: subRes.requestId },
      parentReq(),
      fixture.context,
    );

    const childId = appRes.selectedManagedChildId;
    const user = fixture.documents.get(`users/${childId}`);
    expect(user).toMatchObject({
      uid: childId,
      id: childId,
      familyId: 'family-1',
      role: 'child',
      isManaged: true,
      displayName: 'Jordan',
      rewardPoints: 0,
      lifetimeXP: 0,
      currentStreak: 0,
      longestStreak: 0,
      hasLogin: true,
      loginEnabled: true,
    });
    expect(user?.avatarUrl).toBeTruthy();

    const login = fixture.documents.get(`families/family-1/childLogins/${childId}`);
    expect(login).toMatchObject({
      childId,
      authUid: childId,
      familyId: 'family-1',
      status: 'enabled',
    });
  });

  it('Test 51 (RED): same display name on two distinct requestIds creates two distinct children', async () => {
    const gen1 = await generateChildQrTokenImpl(parentReq({ intent: 'new_child_join' }), fixture.context);
    const sub1 = await submitChildQrJoinRequestImpl({ token: gen1.rawToken, requesterDisplayName: 'Sam' }, {} as any, fixture.context);

    const gen2 = await generateChildQrTokenImpl(parentReq({ intent: 'new_child_join' }), fixture.context);
    const sub2 = await submitChildQrJoinRequestImpl({ token: gen2.rawToken, requesterDisplayName: 'Sam' }, {} as any, fixture.context);

    const app1 = await approveChildQrJoinRequestImpl({ familyId: 'family-1', requestId: sub1.requestId }, parentReq(), fixture.context);
    const app2 = await approveChildQrJoinRequestImpl({ familyId: 'family-1', requestId: sub2.requestId }, parentReq(), fixture.context);

    expect(app1.selectedManagedChildId).not.toBe(app2.selectedManagedChildId);
    expect(fixture.documents.get(`users/${app1.selectedManagedChildId}`)).toBeDefined();
    expect(fixture.documents.get(`users/${app2.selectedManagedChildId}`)).toBeDefined();
    expect(fixture.documents.get(`families/family-1/wallets/${app1.selectedManagedChildId}`)).toBeDefined();
    expect(fixture.documents.get(`families/family-1/wallets/${app2.selectedManagedChildId}`)).toBeDefined();
  });

  it('Test 52 (RED): legacy request (no intent) with NO selectedManagedChildId is rejected', async () => {
    const legacyRequestId = 'legacy-req-1';
    fixture.documents.set(`families/family-1/child_qr_join_requests/${legacyRequestId}`, {
      requestId: legacyRequestId,
      familyId: 'family-1',
      status: 'pending',
      requesterDisplayName: 'Old Request',
      // NO intent property
    });

    const usersBeforeCount = [...fixture.documents.keys()].filter(k => k.startsWith('users/')).length;
    const walletsBeforeCount = [...fixture.documents.keys()].filter(k => k.includes('/wallets/')).length;

    await expect(
      approveChildQrJoinRequestImpl(
        { familyId: 'family-1', requestId: legacyRequestId },
        parentReq(),
        fixture.context,
      ),
    ).rejects.toMatchObject({ message: 'INVALID_APPROVAL_PAYLOAD' });

    const usersAfterCount = [...fixture.documents.keys()].filter(k => k.startsWith('users/')).length;
    const walletsAfterCount = [...fixture.documents.keys()].filter(k => k.includes('/wallets/')).length;

    expect(usersAfterCount).toBe(usersBeforeCount);
    expect(walletsAfterCount).toBe(walletsBeforeCount);
  });

  it('Test 53 (RED): legacy request (no intent) with selectedManagedChildId binds ONLY to existing child', async () => {
    const legacyRequestId = 'legacy-req-2';
    fixture.documents.set(`families/family-1/child_qr_join_requests/${legacyRequestId}`, {
      requestId: legacyRequestId,
      familyId: 'family-1',
      status: 'pending',
      requesterDisplayName: 'Old Request',
      // NO intent property
    });

    const usersBeforeCount = [...fixture.documents.keys()].filter(k => k.startsWith('users/')).length;
    const walletsBeforeCount = [...fixture.documents.keys()].filter(k => k.includes('/wallets/')).length;

    const res = await approveChildQrJoinRequestImpl(
      { familyId: 'family-1', requestId: legacyRequestId, selectedManagedChildId: 'child-1' },
      parentReq(),
      fixture.context,
    );

    expect(res.status).toBe('approved');
    expect(res.selectedManagedChildId).toBe('child-1');

    const usersAfterCount = [...fixture.documents.keys()].filter(k => k.startsWith('users/')).length;
    const walletsAfterCount = [...fixture.documents.keys()].filter(k => k.includes('/wallets/')).length;

    expect(usersAfterCount).toBe(usersBeforeCount);
    expect(walletsAfterCount).toBe(walletsBeforeCount);

    const loginDoc = fixture.documents.get('families/family-1/childLogins/child-1');
    expect(loginDoc?.authUid).toBe('existing-synth-auth-uid-1');
  });

  it('Test 54 (RED): legacy request NEVER enters new_child_join provisioning even with requesterDisplayName', async () => {
    const legacyRequestId = 'legacy-req-3';
    fixture.documents.set(`families/family-1/child_qr_join_requests/${legacyRequestId}`, {
      requestId: legacyRequestId,
      familyId: 'family-1',
      status: 'pending',
      requesterDisplayName: 'Sneaky New Child',
      // NO intent property
    });

    // Calling approve without targetChildId must fail and NEVER create child_qr_legacy-req-3
    await expect(
      approveChildQrJoinRequestImpl(
        { familyId: 'family-1', requestId: legacyRequestId },
        parentReq(),
        fixture.context,
      ),
    ).rejects.toThrow();

    expect(fixture.documents.get(`users/child_qr_${legacyRequestId}`)).toBeUndefined();
    expect(fixture.documents.get(`families/family-1/wallets/child_qr_${legacyRequestId}`)).toBeUndefined();
  });
});
