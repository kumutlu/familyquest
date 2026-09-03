import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateChildQrTokenImpl,
  scanChildQrTokenImpl,
  submitChildQrJoinRequestImpl,
  getChildQrJoinStatusImpl,
  approveChildQrJoinRequestImpl,
  rejectChildQrJoinRequestImpl,
  exchangeApprovedChildQrRequestImpl,
  type ChildQrOnboardingContext,
} from '../../functions/src/childQrOnboarding';

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

  let mockTime = new Date('2026-09-03T12:00:00Z').getTime();
  const context: ChildQrOnboardingContext = {
    db,
    auth,
    nowMs: () => mockTime,
  };

  return { context, documents, createdTokens, setMockTime: (t: number) => { mockTime = t; } };
}

describe('Task 10: End-to-End & Non-Regression Integration Verification', () => {
  let fixture: ReturnType<typeof fakeContext>;

  beforeEach(() => {
    fixture = fakeContext();
    // Setup Parent & Family
    fixture.documents.set('users/parent-1', { familyId: 'family-1', role: 'parent', displayName: 'Mom' });
    fixture.documents.set('families/family-1', { name: 'The Smiths', currencyCode: 'GBP' });

    // Setup Existing Managed Child Identity
    fixture.documents.set('users/child-1', {
      uid: 'child-1',
      familyId: 'family-1',
      role: 'child',
      isManaged: true,
      authUid: 'synth-auth-uid-child-1',
      displayName: 'Ali',
      rewardPoints: 450,
      lifetimeXP: 1200,
    });
    fixture.documents.set('families/family-1/wallets/child-1', { balance: 3500 });
    fixture.documents.set('families/family-1/childLogins/child-1', {
      childId: 'child-1',
      authUid: 'synth-auth-uid-child-1',
      familyId: 'family-1',
      status: 'enabled',
    });
  });

  it('runs complete P0 QR device onboarding flow end-to-end', async () => {
    // 1. Parent generates one-time QR token
    const parentReq = { auth: { uid: 'parent-1' } } as any;
    const qrResult = await generateChildQrTokenImpl(parentReq, fixture.context);
    expect(qrResult.rawToken).toBeDefined();

    // 2. Child device scans QR and previews status (unauthenticated preview)
    const preview = await scanChildQrTokenImpl({ token: qrResult.rawToken }, fixture.context);
    expect(preview.valid).toBe(true);

    // 3. Child device submits join request (unauthenticated)
    const childReq = { auth: { uid: 'child-device-uid-99' } } as any;
    const submitResult = await submitChildQrJoinRequestImpl({ token: qrResult.rawToken }, childReq, fixture.context);
    expect(submitResult.status).toBe('pending');
    expect(submitResult.requestId).toBeDefined();
    expect(submitResult.requestSecret).toBeDefined();

    // 4. Child device polls status -> pending
    const statusPending = await getChildQrJoinStatusImpl(
      { requestId: submitResult.requestId, requestSecret: submitResult.requestSecret },
      fixture.context
    );
    expect(statusPending.status).toBe('pending');

    // 5. Parent opens Approval Center, selects existing managed child ('child-1'), and approves
    const approveResult = await approveChildQrJoinRequestImpl(
      {
        familyId: 'family-1',
        requestId: submitResult.requestId,
        selectedManagedChildId: 'child-1',
        clientReqId: 'parent-approve-req-1',
      },
      parentReq,
      fixture.context
    );
    expect(approveResult.status).toBe('approved');
    expect(approveResult.selectedManagedChildId).toBe('child-1');

    // 6. Child device polls status -> approved
    const statusApproved = await getChildQrJoinStatusImpl(
      { requestId: submitResult.requestId, requestSecret: submitResult.requestSecret },
      fixture.context
    );
    expect(statusApproved.status).toBe('approved');

    // 7. Child device exchanges request for Firebase Custom Token
    const exchangeResult = await exchangeApprovedChildQrRequestImpl(
      { requestId: submitResult.requestId, requestSecret: submitResult.requestSecret },
      fixture.context
    );
    expect(exchangeResult.customToken).toBe('custom-token-for-synth-auth-uid-child-1');
    expect(exchangeResult.childId).toBe('child-1');

    // 8. Custom token target matches existing child authUid and custom claims
    expect(fixture.createdTokens[0]).toEqual({
      uid: 'synth-auth-uid-child-1',
      claims: {
        role: 'child',
        familyId: 'family-1',
        childId: 'child-1',
        managedChild: true,
      },
    });

    // 9. Non-negotiable identity invariants verification:
    const childProfile = fixture.documents.get('users/child-1');
    expect(childProfile?.rewardPoints).toBe(450);
    expect(childProfile?.lifetimeXP).toBe(1200);
    expect(childProfile?.authUid).toBe('synth-auth-uid-child-1');
    expect(childProfile?.isManaged).toBe(true);

    const childWallet = fixture.documents.get('families/family-1/wallets/child-1');
    expect(childWallet?.balance).toBe(3500);

    const childLogin = fixture.documents.get('families/family-1/childLogins/child-1');
    expect(childLogin?.authUid).toBe('synth-auth-uid-child-1');

    // No new user profile was created
    const totalUsers = [...fixture.documents.keys()].filter((k) => k.startsWith('users/')).length;
    expect(totalUsers).toBe(2); // parent-1 and child-1
  });

  it('runs complete rejection flow end-to-end', async () => {
    const parentReq = { auth: { uid: 'parent-1' } } as any;
    const childReq = { auth: { uid: 'child-device-uid-88' } } as any;

    const { rawToken } = await generateChildQrTokenImpl(parentReq, fixture.context);
    const sub = await submitChildQrJoinRequestImpl({ token: rawToken }, childReq, fixture.context);

    const rejectResult = await rejectChildQrJoinRequestImpl(
      { familyId: 'family-1', requestId: sub.requestId, rejectionReason: 'Unknown device' },
      parentReq,
      fixture.context
    );
    expect(rejectResult.status).toBe('rejected');

    const statusRejected = await getChildQrJoinStatusImpl(
      { requestId: sub.requestId, requestSecret: sub.requestSecret },
      fixture.context
    );
    expect(statusRejected.status).toBe('rejected');

    // Exchange attempt on rejected request fails closed
    await expect(
      exchangeApprovedChildQrRequestImpl(
        { requestId: sub.requestId, requestSecret: sub.requestSecret },
        fixture.context
      )
    ).rejects.toMatchObject({
      message: 'REQUEST_NOT_APPROVED',
    });
  });
});
