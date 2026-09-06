import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({}) as any,
  FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
}));
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({}) as any,
}));

import {
  createChildLoginImpl,
  signInChildImpl,
  generateSyntheticEmail,
  type ChildLoginContext,
} from './childLogin';

const GOOD_PW = 'GoodPassword123!';
const FAMILY_ID = 'F1';
const FAMILY_CODE = 'FAM123';
const PARENT_UID = 'parent-1';
const QR_CHILD_ID = 'child_qr_req1';
const QR_AUTH_UID = 'child_qr_req1';

function makeFakeDb() {
  const store = new Map<string, Record<string, unknown>>();

  const applyWrite = (
    path: string,
    data: Record<string, unknown>,
    op: 'set' | 'update' | 'delete',
    merge = false
  ) => {
    if (op === 'set') {
      if (merge) {
        const existing = store.get(path) ?? {};
        store.set(path, { ...existing, ...data });
      } else {
        store.set(path, { ...data });
      }
    } else if (op === 'update') {
      const existing = store.get(path) ?? {};
      store.set(path, { ...existing, ...data });
    } else if (op === 'delete') {
      store.delete(path);
    }
  };

  const makeRef = (path: string): any => ({
    path,
    id: path.split('/').pop() as string,
    get: async () => {
      const data = store.get(path);
      return {
        exists: data !== undefined,
        data: () => data,
        id: path.split('/').pop(),
        ref: makeRef(path),
      };
    },
    set: (data: Record<string, unknown>, opts?: { merge?: boolean }) =>
      applyWrite(path, data, 'set', opts?.merge),
    update: (data: Record<string, unknown>) => applyWrite(path, data, 'update'),
  });

  const db: any = {
    store,
    failTransactionCount: 0,
    doc: (path: string) => makeRef(path),
    collection: (path: string) => {
      const query = (field: string, value: unknown) => ({
        limit: (_limit: number) => query(field, value),
        get: async () => {
          const prefix = `${path}/`;
          const docs: any[] = [];
          for (const [k, v] of store.entries()) {
            if (k.startsWith(prefix) && v && (v as any)[field] === value) {
              docs.push({ id: k.split('/').pop() as string, data: () => v, ref: makeRef(k) });
            }
          }
          return { empty: docs.length === 0, docs };
        },
      });
      return {
        where: (field: string, _op: string, value: unknown) => query(field, value),
        add: async (data: Record<string, unknown>) => {
          const id = `doc-${Math.random().toString(36).slice(2)}`;
          store.set(`${path}/${id}`, { ...data });
          return makeRef(`${path}/${id}`);
        },
        doc: (id?: string) => makeRef(`${path}/${id || Math.random().toString(36).slice(2)}`),
      };
    },
    runTransaction: async (cb: any) => {
      if (db.failTransactionCount > 0) {
        db.failTransactionCount--;
        throw new Error('SIMULATED_TRANSACTION_FAILURE');
      }
      const writes: [string, Record<string, unknown>, 'set' | 'update' | 'delete', boolean][] = [];
      const tx: any = {
        get: async (ref: any) => ref.get(),
        set: (ref: any, data: any, opts?: { merge?: boolean }) => {
          writes.push([ref.path, data, 'set', Boolean(opts?.merge)]);
        },
        update: (ref: any, data: any) => {
          writes.push([ref.path, data, 'update', false]);
        },
        delete: (ref: any) => {
          writes.push([ref.path, {}, 'delete', false]);
        },
      };
      const result = await cb(tx);
      for (const [path, data, op, merge] of writes) applyWrite(path, data, op, merge);
      return result;
    },
  };
  return db;
}

function makeFakeAuth() {
  const users = new Map<string, Record<string, unknown>>();
  const claims = new Map<string, Record<string, unknown>>();
  let userCount = 0;

  const auth: any = {
    users,
    claims,
    getUserCount: () => users.size,
    createUser: async (opts: Record<string, unknown>) => {
      const uid = opts.uid ? (opts.uid as string) : `auth-${++userCount}`;
      users.set(uid, { ...opts, uid });
      return { uid };
    },
    updateUser: async (uid: string, opts: Record<string, unknown>) => {
      const existing = users.get(uid);
      if (!existing) throw new Error('user-not-found');
      users.set(uid, { ...existing, ...opts, uid });
      return { uid, ...existing, ...opts };
    },
    getUser: async (uid: string) => {
      const u = users.get(uid);
      if (!u) throw new Error('user-not-found');
      return { uid, disabled: u.disabled === true, email: u.email, displayName: u.displayName };
    },
    setCustomUserClaims: async (uid: string, c: Record<string, unknown>) => {
      claims.set(uid, c);
    },
    createCustomToken: async (uid: string) => `custom-token-for-${uid}`,
    deleteUser: async (uid: string) => {
      users.delete(uid);
      claims.delete(uid);
    },
  };
  return auth;
}

function seedQrChildEnvironment(db: any, auth: any) {
  // Family
  db.store.set(`families/${FAMILY_ID}`, {
    name: 'The Incredibles',
    inviteCode: FAMILY_CODE,
    ownerId: PARENT_UID,
  });

  // Parent
  db.store.set(`users/${PARENT_UID}`, {
    displayName: 'Parent Bob',
    familyId: FAMILY_ID,
    role: 'parent',
    isManaged: false,
  });

  // Pre-existing QR Auth user
  auth.users.set(QR_AUTH_UID, {
    uid: QR_AUTH_UID,
    displayName: 'Alex',
  });
  auth.claims.set(QR_AUTH_UID, {
    role: 'child',
    familyId: FAMILY_ID,
    childId: QR_CHILD_ID,
    managedChild: true,
  });

  // Pre-existing QR Child profile
  db.store.set(`users/${QR_CHILD_ID}`, {
    uid: QR_CHILD_ID,
    id: QR_CHILD_ID,
    displayName: 'Alex',
    familyId: FAMILY_ID,
    role: 'child',
    isManaged: true,
    authUid: QR_AUTH_UID,
    hasLogin: false,
    loginEnabled: false,
  });

  // Pre-existing QR Child wallet
  db.store.set(`families/${FAMILY_ID}/wallets/${QR_CHILD_ID}`, {
    balance: 500,
  });

  // Pre-existing QR Child private record (device bound, no username/password)
  db.store.set(`families/${FAMILY_ID}/childLogins/${QR_CHILD_ID}`, {
    childId: QR_CHILD_ID,
    authUid: QR_AUTH_UID,
    familyId: FAMILY_ID,
    status: 'enabled',
  });
}

describe('QR Child Login Upgrade & Re-Login Contract', () => {
  let db: any;
  let auth: any;
  let ctx: ChildLoginContext;

  beforeEach(() => {
    db = makeFakeDb();
    auth = makeFakeAuth();
    ctx = {
      db,
      auth,
      verifyPassword: async () => true,
      rateLimiter: () => true,
    };
    seedQrChildEnvironment(db, auth);
  });

  it('upgrades QR-created child with username/password without rejecting and without creating a 2nd Auth user', async () => {
    const authCountBefore = auth.getUserCount();
    const childDocsBefore = [...db.store.keys()].filter(k => k.startsWith('users/')).length;
    const walletDocsBefore = [...db.store.keys()].filter(k => k.includes('/wallets/')).length;

    const result = await createChildLoginImpl(ctx, PARENT_UID, {
      childId: QR_CHILD_ID,
      username: 'alex_quest',
      password: GOOD_PW,
      clientReqId: 'req-upgrade-1',
    });

    expect(result).toMatchObject({
      childId: QR_CHILD_ID,
      username: 'alex_quest',
      loginEnabled: true,
    });

    // 1. Auth user must be REUSED, zero new Auth users created
    expect(auth.getUserCount()).toBe(authCountBefore);
    const authUser = await auth.getUser(QR_AUTH_UID);
    expect(authUser.uid).toBe(QR_AUTH_UID);
    expect(authUser.email).toBe(generateSyntheticEmail(FAMILY_ID, 'alex_quest'));

    // 2. Exact child profile preserved
    const childDoc = db.store.get(`users/${QR_CHILD_ID}`);
    expect(childDoc.authUid).toBe(QR_AUTH_UID);
    expect(childDoc.hasLogin).toBe(true);
    expect(childDoc.username).toBe('alex_quest');
    expect(childDoc.loginEnabled).toBe(true);

    // 3. Child count & Wallet count deltas = 0
    const childDocsAfter = [...db.store.keys()].filter(k => k.startsWith('users/')).length;
    const walletDocsAfter = [...db.store.keys()].filter(k => k.includes('/wallets/')).length;
    expect(childDocsAfter - childDocsBefore).toBe(0);
    expect(walletDocsAfter - walletDocsBefore).toBe(0);

    // 4. Wallet balance untouched
    expect(db.store.get(`families/${FAMILY_ID}/wallets/${QR_CHILD_ID}`).balance).toBe(500);

    // 5. Normal childLogin & index records created
    const loginDoc = db.store.get(`families/${FAMILY_ID}/childLogins/${QR_CHILD_ID}`);
    expect(loginDoc).toMatchObject({
      childId: QR_CHILD_ID,
      authUid: QR_AUTH_UID,
      username: 'alex_quest',
      normalizedUsername: 'alex_quest',
      status: 'enabled',
    });
    const indexDoc = db.store.get(`families/${FAMILY_ID}/childLoginIndex/alex_quest`);
    expect(indexDoc).toMatchObject({
      childId: QR_CHILD_ID,
      normalizedUsername: 'alex_quest',
    });
  });

  it('child can sign in via Child Login screen after explicit logout and receives the EXACT SAME Auth UID', async () => {
    // 1. Upgrade login
    await createChildLoginImpl(ctx, PARENT_UID, {
      childId: QR_CHILD_ID,
      username: 'alex_quest',
      password: GOOD_PW,
      clientReqId: 'req-upgrade-1',
    });

    // 2. Child uses normal Child Login screen
    const signInResult = await signInChildImpl(ctx, {
      familyCode: FAMILY_CODE,
      username: 'alex_quest',
      password: GOOD_PW,
    });

    expect(signInResult.customToken).toBe(`custom-token-for-${QR_AUTH_UID}`);
  });

  it('rejects already-credentialed child with LOGIN_ALREADY_EXISTS', async () => {
    // First upgrade succeeds
    await createChildLoginImpl(ctx, PARENT_UID, {
      childId: QR_CHILD_ID,
      username: 'alex_first',
      password: GOOD_PW,
      clientReqId: 'req-first',
    });

    // Second call for the same child with different username/clientReqId must reject as LOGIN_ALREADY_EXISTS
    await expect(
      createChildLoginImpl(ctx, PARENT_UID, {
        childId: QR_CHILD_ID,
        username: 'alex_second',
        password: GOOD_PW,
        clientReqId: 'req-second',
      })
    ).rejects.toMatchObject({ code: 'already-exists' });
  });

  it('duplicate-click / idempotent replay returns cached result with same Auth UID', async () => {
    const res1 = await createChildLoginImpl(ctx, PARENT_UID, {
      childId: QR_CHILD_ID,
      username: 'alex_quest',
      password: GOOD_PW,
      clientReqId: 'req-double-click',
    });

    const res2 = await createChildLoginImpl(ctx, PARENT_UID, {
      childId: QR_CHILD_ID,
      username: 'alex_quest',
      password: GOOD_PW,
      clientReqId: 'req-double-click',
    });

    expect(res2).toEqual(res1);
    expect(auth.getUserCount()).toBe(1);
  });

  it('retrying after Auth update and partial Firestore failure reconciles without creating second Auth user', async () => {
    // Configure db to fail the linking transaction on the first attempt
    db.failTransactionCount = 1;

    await expect(
      createChildLoginImpl(ctx, PARENT_UID, {
        childId: QR_CHILD_ID,
        username: 'alex_quest',
        password: GOOD_PW,
        clientReqId: 'req-retry-1',
      })
    ).rejects.toThrow();

    // The Auth user must NOT have been deleted
    expect(auth.users.has(QR_AUTH_UID)).toBe(true);

    // Retry with the same clientReqId must succeed and reconcile
    const retryResult = await createChildLoginImpl(ctx, PARENT_UID, {
      childId: QR_CHILD_ID,
      username: 'alex_quest',
      password: GOOD_PW,
      clientReqId: 'req-retry-1',
    });

    expect(retryResult).toMatchObject({
      childId: QR_CHILD_ID,
      username: 'alex_quest',
      loginEnabled: true,
    });
    expect(auth.getUserCount()).toBe(1);
    expect(db.store.get(`users/${QR_CHILD_ID}`).hasLogin).toBe(true);
  });

  it('duplicate username within family is rejected', async () => {
    // Seed another managed child in family
    db.store.set(`users/child-2`, {
      uid: 'child-2',
      id: 'child-2',
      displayName: 'Sibling',
      familyId: FAMILY_ID,
      role: 'child',
      isManaged: true,
    });

    await createChildLoginImpl(ctx, PARENT_UID, {
      childId: QR_CHILD_ID,
      username: 'alex_quest',
      password: GOOD_PW,
      clientReqId: 'req-c1',
    });

    await expect(
      createChildLoginImpl(ctx, PARENT_UID, {
        childId: 'child-2',
        username: 'alex_quest',
        password: GOOD_PW,
        clientReqId: 'req-c2',
      })
    ).rejects.toMatchObject({ code: 'already-exists' });
  });

  it('wrong-family parent caller is denied', async () => {
    db.store.set(`users/parent-foreign`, {
      displayName: 'Foreign Parent',
      familyId: 'OTHER_FAMILY',
      role: 'parent',
      isManaged: false,
    });

    await expect(
      createChildLoginImpl(ctx, 'parent-foreign', {
        childId: QR_CHILD_ID,
        username: 'alex_quest',
        password: GOOD_PW,
        clientReqId: 'req-foreign',
      })
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('child caller is denied', async () => {
    await expect(
      createChildLoginImpl(ctx, QR_AUTH_UID, {
        childId: QR_CHILD_ID,
        username: 'alex_quest',
        password: GOOD_PW,
        clientReqId: 'req-child',
      })
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
