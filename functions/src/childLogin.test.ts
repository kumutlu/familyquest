// ---------------------------------------------------------------------------
// FOCUSED FUNCTIONS TESTS — Parent-Created Child Login (Phase 1)
// ---------------------------------------------------------------------------
// These tests exercise the trusted backend logic (createChildLoginImpl /
// signInChildImpl) against an in-memory Firestore + Auth mock. They cover the
// allowed, denied, and integrity cases required by the Phase 1 spec. They do
// NOT require the Firebase emulators and do NOT touch production data.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock firebase-admin so FieldValue.serverTimestamp() returns a detectable
// sentinel and the module imports resolve without app initialization.
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
  normalizeUsername,
  validatePasswordStrength,
  generateSyntheticEmail,
  computePayloadHash,
  type ChildLoginContext,
} from './childLogin';

// ---------------------------------------------------------------------------
// In-memory Firestore mock
// ---------------------------------------------------------------------------

const SERVER_TS = { __serverTimestamp: true };

interface FakeRef {
  path: string;
  id: string;
}

function makeFakeDb() {
  const store = new Map<string, Record<string, unknown>>();
  let txnCount = 0;
  let failAt = 0;

  const applyWrite = (ref: FakeRef, data: Record<string, unknown>, op: 'set' | 'update') => {
    if (op === 'set') {
      store.set(ref.path, { ...data });
    } else {
      const existing = store.get(ref.path) ?? {};
      store.set(ref.path, { ...existing, ...data });
    }
  };

  const makeRef = (path: string): any => ({
    path,
    id: path.split('/').pop() as string,
    get: async () => {
      const data = store.get(path);
      return { exists: data !== undefined, data: () => data, id: path.split('/').pop() };
    },
  });

  const db: any = {
    store,
    setFailTransactionAtCall: (n: number) => {
      failAt = n;
    },
    doc: (path: string) => makeRef(path),
    collection: (path: string) => ({
      doc: (id?: string) => {
        const realId = id || Math.random().toString(36).slice(2);
        return makeRef(`${path}/${realId}`);
      },
      add: async (data: Record<string, unknown>) => {
        const ref = db.collection(path).doc();
        applyWrite(ref, data, 'set');
        return ref;
      },
    }),
    runTransaction: async (cb: (tx: any) => Promise<any>) => {
      txnCount += 1;
      if (failAt && txnCount === failAt) throw new Error('simulated transaction failure');
      const writes: Array<['set' | 'update', FakeRef, Record<string, unknown>]> = [];
      const tx = {
        get: async (ref: FakeRef) => {
          const data = store.get(ref.path);
          return { exists: data !== undefined, data: () => data, id: ref.id };
        },
        set: (ref: FakeRef, data: Record<string, unknown>) => writes.push(['set', ref, data]),
        update: (ref: FakeRef, data: Record<string, unknown>) => writes.push(['update', ref, data]),
      };
      const result = await cb(tx);
      for (const [op, ref, data] of writes) applyWrite(ref, data, op);
      return result;
    },
  };
  return db as any;
}

// ---------------------------------------------------------------------------
// In-memory Auth mock
// ---------------------------------------------------------------------------

function makeFakeAuth() {
  const users = new Map<string, Record<string, unknown>>();
  const claims = new Map<string, Record<string, unknown>>();
  const deleted: string[] = [];
  let counter = 0;

  const auth: any = {
    users,
    claims,
    deleted,
    createUser: async (opts: Record<string, unknown>) => {
      const uid = `auth-${(++counter).toString()}`;
      users.set(uid, opts);
      return { uid };
    },
    setCustomUserClaims: async (uid: string, c: Record<string, unknown>) => {
      claims.set(uid, c);
    },
    deleteUser: async (uid: string) => {
      users.delete(uid);
      claims.delete(uid);
      deleted.push(uid);
    },
    createCustomToken: async (uid: string) => `token-for-${uid}`,
  };
  return auth as any;
}

// ---------------------------------------------------------------------------
// World builder
// ---------------------------------------------------------------------------

function seedUser(
  db: any,
  uid: string,
  fields: Record<string, unknown>,
) {
  db.store.set(`users/${uid}`, fields);
}

function makeCtx(db: any, auth: any, overrides: Partial<ChildLoginContext> = {}) {
  return {
    db,
    auth,
    verifyPassword: async () => true,
    rateLimiter: () => true,
    ...overrides,
  } as ChildLoginContext;
}

const GOOD_PW = 'Str0ngPass!';

describe('childLogin pure helpers', () => {
  it('normalizes deterministically (lowercase, trim, collapse spaces)', () => {
    expect(normalizeUsername('  Alex  ')).toBe('alex');
    expect(normalizeUsername('Alex Doe')).toBe('alex doe');
    expect(normalizeUsername('ALEX')).toBe('alex');
  });

  it('rejects invalid usernames', () => {
    expect(() => normalizeUsername('ab')).toThrow();
    expect(() => normalizeUsername('a'.repeat(33))).toThrow();
    expect(() => normalizeUsername('bad!name')).toThrow();
    expect(() => normalizeUsername(123 as any)).toThrow();
  });

  it('enforces password strength', () => {
    expect(validatePasswordStrength('short', 'alex').ok).toBe(false);
    expect(validatePasswordStrength('allletters', 'alex').ok).toBe(false);
    expect(validatePasswordStrength('12345678', 'alex').ok).toBe(false);
    expect(validatePasswordStrength('alex', 'alex').ok).toBe(false);
    expect(validatePasswordStrength(GOOD_PW, 'alex').ok).toBe(true);
  });

  it('generates a unique synthetic email from family + username', () => {
    const e1 = generateSyntheticEmail('F1', 'alex');
    const e2 = generateSyntheticEmail('F1', 'alex doe');
    const e3 = generateSyntheticEmail('F2', 'alex');
    expect(e1).toBe('child-f1-alex@managed.familyquest.app');
    expect(e2).toBe('child-f1-alex-doe@managed.familyquest.app');
    expect(e3).not.toBe(e1);
  });

  it('computes a stable payload hash', () => {
    expect(computePayloadHash('C1', 'alex')).toBe(computePayloadHash('C1', 'alex'));
    expect(computePayloadHash('C1', 'alex')).not.toBe(computePayloadHash('C2', 'alex'));
  });
});

describe('createChildLogin — ALLOWED', () => {
  let db: any;
  let auth: any;

  beforeEach(() => {
    db = makeFakeDb();
    auth = makeFakeAuth();
    seedUser(db, 'owner1', { familyId: 'F1', role: 'owner', displayName: 'Owner' });
    seedUser(db, 'parent1', { familyId: 'F1', role: 'parent', displayName: 'Parent' });
    seedUser(db, 'child1', {
      familyId: 'F1',
      role: 'child',
      isManaged: true,
      displayName: 'Alex',
    });
    seedUser(db, 'child2', {
      familyId: 'F1',
      role: 'child',
      isManaged: true,
      displayName: 'Bea',
    });
    seedUser(db, 'childF2', {
      familyId: 'F2',
      role: 'child',
      isManaged: true,
      displayName: 'Alex',
    });
    seedUser(db, 'parentF2', { familyId: 'F2', role: 'parent', displayName: 'P2' });
  });

  it('owner creates login for managed child in same family', async () => {
    const ctx = makeCtx(db, auth);
    const res = await createChildLoginImpl(ctx, 'owner1', {
      childId: 'child1',
      username: 'Alex',
      password: GOOD_PW,
      clientReqId: 'r1',
    });
    expect(res).toEqual({ childId: 'child1', username: 'Alex', loginEnabled: true });
    // authUid must NOT be in the response.
    expect((res as any).authUid).toBeUndefined();
    expect((res as any).syntheticEmail).toBeUndefined();
  });

  it('parent creates login if existing role model permits', async () => {
    const ctx = makeCtx(db, auth);
    const res = await createChildLoginImpl(ctx, 'parent1', {
      childId: 'child1',
      username: 'Alex',
      password: GOOD_PW,
      clientReqId: 'r1',
    });
    expect(res.loginEnabled).toBe(true);
  });

  it('idempotent retry returns same result and creates Auth user only once', async () => {
    const ctx = makeCtx(db, auth);
    const input = {
      childId: 'child1',
      username: 'Alex',
      password: GOOD_PW,
      clientReqId: 'r1',
    };
    const first = await createChildLoginImpl(ctx, 'owner1', input);
    const second = await createChildLoginImpl(ctx, 'owner1', input);
    expect(second).toEqual(first);
    expect(auth.users.size).toBe(1); // only one Auth user created
  });

  it('normalized username uniqueness is family-scoped', async () => {
    const ctx = makeCtx(db, auth);
    await createChildLoginImpl(ctx, 'owner1', {
      childId: 'child1',
      username: 'Alex',
      password: GOOD_PW,
      clientReqId: 'r1',
    });
    // child2 with the same normalized username "alex" in the same family.
    await expect(
      createChildLoginImpl(ctx, 'owner1', {
        childId: 'child2',
        username: 'alex',
        password: GOOD_PW,
        clientReqId: 'r2',
      }),
    ).rejects.toMatchObject({ code: 'already-exists' });
  });

  it('same username may exist in another family', async () => {
    const ctx = makeCtx(db, auth);
    await createChildLoginImpl(ctx, 'owner1', {
      childId: 'child1',
      username: 'Alex',
      password: GOOD_PW,
      clientReqId: 'r1',
    });
    const res = await createChildLoginImpl(ctx, 'parentF2', {
      childId: 'childF2',
      username: 'Alex',
      password: GOOD_PW,
      clientReqId: 'rF2',
    });
    expect(res.childId).toBe('childF2');
    expect(auth.users.size).toBe(2);
  });
});

describe('createChildLogin — DENIED', () => {
  let db: any;
  let auth: any;

  beforeEach(() => {
    db = makeFakeDb();
    auth = makeFakeAuth();
    seedUser(db, 'owner1', { familyId: 'F1', role: 'owner', displayName: 'Owner' });
    seedUser(db, 'child1', {
      familyId: 'F1',
      role: 'child',
      isManaged: true,
      displayName: 'Alex',
    });
    seedUser(db, 'child2', {
      familyId: 'F1',
      role: 'child',
      isManaged: true,
      displayName: 'Bea',
    });
    seedUser(db, 'parentF2', { familyId: 'F2', role: 'parent', displayName: 'P2' });
    seedUser(db, 'childF2', { familyId: 'F2', role: 'child', isManaged: true, displayName: 'C2' });
  });

  it('unauthenticated / unknown caller is rejected', async () => {
    const ctx = makeCtx(db, auth);
    await expect(
      createChildLoginImpl(ctx, 'ghost', {
        childId: 'child1',
        username: 'Alex',
        password: GOOD_PW,
        clientReqId: 'r1',
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('child caller is rejected', async () => {
    seedUser(db, 'childcaller', { familyId: 'F1', role: 'child', isManaged: true });
    const ctx = makeCtx(db, auth);
    await expect(
      createChildLoginImpl(ctx, 'childcaller', {
        childId: 'child1',
        username: 'Alex',
        password: GOOD_PW,
        clientReqId: 'r1',
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('unrelated family parent is rejected', async () => {
    const ctx = makeCtx(db, auth);
    await expect(
      createChildLoginImpl(ctx, 'parentF2', {
        childId: 'child1',
        username: 'Alex',
        password: GOOD_PW,
        clientReqId: 'r1',
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('inactive / deleted child is rejected', async () => {
    const ctx = makeCtx(db, auth);
    // child with no familyId (deleted/left)
    seedUser(db, 'deletedChild', { role: 'child', isManaged: true });
    await expect(
      createChildLoginImpl(ctx, 'owner1', {
        childId: 'deletedChild',
        username: 'Alex',
        password: GOOD_PW,
        clientReqId: 'r1',
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('non-managed child is rejected', async () => {
    seedUser(db, 'realChild', { familyId: 'F1', role: 'child', isManaged: false });
    const ctx = makeCtx(db, auth);
    await expect(
      createChildLoginImpl(ctx, 'owner1', {
        childId: 'realChild',
        username: 'Alex',
        password: GOOD_PW,
        clientReqId: 'r1',
      }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('duplicate login for same child is rejected', async () => {
    const ctx = makeCtx(db, auth);
    await createChildLoginImpl(ctx, 'owner1', {
      childId: 'child1',
      username: 'Alex',
      password: GOOD_PW,
      clientReqId: 'r1',
    });
    await expect(
      createChildLoginImpl(ctx, 'owner1', {
        childId: 'child1',
        username: 'Alex2',
        password: GOOD_PW,
        clientReqId: 'r2',
      }),
    ).rejects.toMatchObject({ code: 'already-exists' });
  });

  it('duplicate normalized username in same family is rejected', async () => {
    seedUser(db, 'child2', { familyId: 'F1', role: 'child', isManaged: true, displayName: 'Bea' });
    const ctx = makeCtx(db, auth);
    await createChildLoginImpl(ctx, 'owner1', {
      childId: 'child1',
      username: 'Alex',
      password: GOOD_PW,
      clientReqId: 'r1',
    });
    await expect(
      createChildLoginImpl(ctx, 'owner1', {
        childId: 'child2',
        username: '  ALEX  ',
        password: GOOD_PW,
        clientReqId: 'r2',
      }),
    ).rejects.toMatchObject({ code: 'already-exists' });
  });

  it('weak password is rejected', async () => {
    const ctx = makeCtx(db, auth);
    await expect(
      createChildLoginImpl(ctx, 'owner1', {
        childId: 'child1',
        username: 'Alex',
        password: 'short',
        clientReqId: 'r1',
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('role-escalation fields supplied by client are rejected', async () => {
    const ctx = makeCtx(db, auth);
    await expect(
      createChildLoginImpl(ctx, 'owner1', {
        childId: 'child1',
        username: 'Alex',
        password: GOOD_PW,
        clientReqId: 'r1',
        role: 'owner',
      } as any),
    ).rejects.toMatchObject({ code: 'invalid-argument' });

    await expect(
      createChildLoginImpl(ctx, 'owner1', {
        childId: 'child1',
        username: 'Alex',
        password: GOOD_PW,
        clientReqId: 'r1',
        familyId: 'F2',
      } as any),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('replay with same clientReqId but different payload is rejected', async () => {
    const ctx = makeCtx(db, auth);
    await createChildLoginImpl(ctx, 'owner1', {
      childId: 'child1',
      username: 'Alex',
      password: GOOD_PW,
      clientReqId: 'r1',
    });
    // Same clientReqId, different childId + username (same family so the family
    // check passes and we reach the idempotency replay-mismatch guard).
    await expect(
      createChildLoginImpl(ctx, 'owner1', {
        childId: 'child2',
        username: 'Bea',
        password: GOOD_PW,
        clientReqId: 'r1',
      }),
    ).rejects.toMatchObject({ code: 'already-exists' });
  });
});

describe('createChildLogin — INTEGRITY', () => {
  let db: any;
  let auth: any;

  beforeEach(() => {
    db = makeFakeDb();
    auth = makeFakeAuth();
    seedUser(db, 'owner1', { familyId: 'F1', role: 'owner', displayName: 'Owner' });
    seedUser(db, 'child1', {
      familyId: 'F1',
      role: 'child',
      isManaged: true,
      displayName: 'Alex',
    });
  });

  it('existing child document ID remains unchanged and is linked', async () => {
    const ctx = makeCtx(db, auth);
    await createChildLoginImpl(ctx, 'owner1', {
      childId: 'child1',
      username: 'Alex',
      password: GOOD_PW,
      clientReqId: 'r1',
    });
    const child = db.store.get('users/child1');
    expect(child.childId === undefined).toBe(true); // id is the doc path, unchanged
    expect(child.hasLogin).toBe(true);
    expect(child.loginEnabled).toBe(true);
    expect(child.username).toBe('Alex');
    expect(typeof child.authUid).toBe('string');
    expect(child.authUid.startsWith('auth-')).toBe(true);
  });

  it('authUid is linked to the existing child and claims are exact', async () => {
    const ctx = makeCtx(db, auth);
    await createChildLoginImpl(ctx, 'owner1', {
      childId: 'child1',
      username: 'Alex',
      password: GOOD_PW,
      clientReqId: 'r1',
    });
    const authUid = db.store.get('users/child1').authUid as string;
    expect(auth.users.has(authUid)).toBe(true);
    expect(auth.claims.get(authUid)).toEqual({
      role: 'child',
      familyId: 'F1',
      childId: 'child1',
      managedChild: true,
    });
  });

  it('synthetic email is never returned and is stored only server-side', async () => {
    const ctx = makeCtx(db, auth);
    const res = await createChildLoginImpl(ctx, 'owner1', {
      childId: 'child1',
      username: 'Alex',
      password: GOOD_PW,
      clientReqId: 'r1',
    });
    expect(Object.keys(res).sort()).toEqual(['childId', 'loginEnabled', 'username']);
    const authUid = db.store.get('users/child1').authUid as string;
    const priv = db.store.get('families/F1/childLogins/child1');
    expect(priv.syntheticEmail).toBe('child-f1-alex@managed.familyquest.app');
    expect(priv.authUid).toBe(authUid);
  });

  it('immutable audit event is written (no password)', async () => {
    const ctx = makeCtx(db, auth);
    await createChildLoginImpl(ctx, 'owner1', {
      childId: 'child1',
      username: 'Alex',
      password: GOOD_PW,
      clientReqId: 'r1',
    });
    const audit = Array.from(db.store.values()).find(
      (v: any) => v.type === 'login_created',
    );
    expect(audit).toBeTruthy();
    expect(audit.success).toBe(true);
    expect(audit.childId).toBe('child1');
    expect(JSON.stringify(audit)).not.toContain(GOOD_PW);
  });

  it('compensation leaves no orphaned usable account when linking fails', async () => {
    const ctx = makeCtx(db, auth);
    // Make the SECOND transaction (the Firestore linking step) fail.
    db.setFailTransactionAtCall(2);
    await expect(
      createChildLoginImpl(ctx, 'owner1', {
        childId: 'child1',
        username: 'Alex',
        password: GOOD_PW,
        clientReqId: 'r1',
      }),
    ).rejects.toBeTruthy();
    // The Auth user that was created must have been deleted (compensated).
    expect(auth.deleted.length).toBe(1);
    expect(auth.users.size).toBe(0);
    // No private record / index should remain (transaction rolled back).
    expect(db.store.has('families/F1/childLogins/child1')).toBe(false);
    expect(db.store.has('families/F1/childLoginIndex/alex')).toBe(false);
    // Compensation audit event recorded.
    const comp = Array.from(db.store.values()).find((v: any) => v.type === 'login_compensation');
    expect(comp).toBeTruthy();
  });
});

describe('signInChild — design/backend', () => {
  let db: any;
  let auth: any;

  function seedLogin(familyId: string, childId: string, status = 'enabled') {
    const norm = normalizeUsername('Alex');
    const email = generateSyntheticEmail(familyId, norm);
    const authUid = `auth-seed-${childId}`;
    db.store.set(`${familyId ? `families/${familyId}` : 'families/F1'}/childLoginIndex/${norm}`, {
      childId,
      normalizedUsername: norm,
    });
    db.store.set(`families/${familyId}/childLogins/${childId}`, {
      childId,
      username: 'Alex',
      normalizedUsername: norm,
      syntheticEmail: email,
      authUid,
      familyId,
      status,
    });
    seedUser(db, childId, { familyId, role: 'child', isManaged: true, displayName: 'Alex' });
    return { email, authUid };
  }

  beforeEach(() => {
    db = makeFakeDb();
    auth = makeFakeAuth();
  });

  it('returns a custom token on valid credentials and never exposes email', async () => {
    const { authUid } = seedLogin('F1', 'child1');
    const ctx = makeCtx(db, auth, { verifyPassword: async () => true });
    const res = await signInChildImpl(ctx, {
      familyCode: 'F1',
      username: 'Alex',
      password: 'whatever',
    });
    expect(res.customToken).toBe(`token-for-${authUid}`);
    expect((res as any).syntheticEmail).toBeUndefined();
  });

  it('returns a generic failure for a wrong password', async () => {
    seedLogin('F1', 'child1');
    const ctx = makeCtx(db, auth, { verifyPassword: async () => false });
    await expect(
      signInChildImpl(ctx, { familyCode: 'F1', username: 'Alex', password: 'x' }),
    ).rejects.toMatchObject({ code: 'invalid-argument', message: 'INVALID_CREDENTIALS' });
  });

  it('returns a generic failure for a disabled login', async () => {
    seedLogin('F1', 'child1', 'disabled');
    const ctx = makeCtx(db, auth, { verifyPassword: async () => true });
    await expect(
      signInChildImpl(ctx, { familyCode: 'F1', username: 'Alex', password: 'x' }),
    ).rejects.toMatchObject({ code: 'invalid-argument', message: 'INVALID_CREDENTIALS' });
  });

  it('returns a generic failure for a deleted/ineligible child', async () => {
    const { authUid } = seedLogin('F1', 'child1');
    // Remove the child user doc to simulate deletion.
    db.store.delete('users/child1');
    const ctx = makeCtx(db, auth, { verifyPassword: async () => true });
    await expect(
      signInChildImpl(ctx, { familyCode: 'F1', username: 'Alex', password: 'x' }),
    ).rejects.toMatchObject({ code: 'invalid-argument', message: 'INVALID_CREDENTIALS' });
    expect(authUid).toBeTruthy();
  });

  it('rate limiting yields a generic failure', async () => {
    seedLogin('F1', 'child1');
    const ctx = makeCtx(db, auth, {
      verifyPassword: async () => true,
      rateLimiter: () => false,
    });
    await expect(
      signInChildImpl(ctx, { familyCode: 'F1', username: 'Alex', password: 'x' }),
    ).rejects.toMatchObject({ code: 'invalid-argument', message: 'INVALID_CREDENTIALS' });
  });
});
