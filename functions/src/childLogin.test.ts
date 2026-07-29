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
  resetChildPasswordImpl,
  disableChildLoginImpl,
  enableChildLoginImpl,
  revokeChildSessionsImpl,
  changeChildUsernameImpl,
  completeChildPasswordChangeImpl,
  normalizeUsername,
  validatePasswordStrength,
  generateSyntheticEmail,
  computePayloadHash,
  computeLifecyclePayloadHash,
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

function makeFakeDb(enforceReadBeforeWrite = false) {
  const store = new Map<string, Record<string, unknown>>();
  let txnCount = 0;
  let failAt = 0;

  const applyWrite = (
    ref: FakeRef,
    data: Record<string, unknown>,
    op: 'set' | 'update' | 'delete',
  ) => {
    if (op === 'set') {
      store.set(ref.path, { ...data });
    } else if (op === 'update') {
      const existing = store.get(ref.path) ?? {};
      store.set(ref.path, { ...existing, ...data });
    } else if (op === 'delete') {
      store.delete(ref.path);
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
    set: (data: Record<string, unknown>) => applyWrite({ path } as FakeRef, data, 'set'),
    update: (data: Record<string, unknown>) => applyWrite({ path } as FakeRef, data, 'update'),
  });

  const db: any = {
    store,
    setFailTransactionAtCall: (n: number) => {
      failAt = n;
    },
    doc: (path: string) => makeRef(path),
    collection: (path: string) => {
      const query = (
        field: string,
        value: unknown,
        maxResults = Number.POSITIVE_INFINITY,
      ) => ({
        limit: (limit: number) => query(field, value, limit),
        get: async () => {
          const prefix = `${path}/`;
          const docs = Array.from(store.entries())
            .filter(([key, data]) =>
              key.startsWith(prefix) &&
              !key.slice(prefix.length).includes('/') &&
              data[field] === value)
            .slice(0, maxResults)
            .map(([key, data]) => ({
              id: key.slice(prefix.length),
              exists: true,
              data: () => data,
              ref: makeRef(key),
            }));
          return { empty: docs.length === 0, docs, size: docs.length };
        },
      });
      return {
        doc: (id?: string) => {
          const realId = id || Math.random().toString(36).slice(2);
          return makeRef(`${path}/${realId}`);
        },
        add: async (data: Record<string, unknown>) => {
          const ref = db.collection(path).doc();
          applyWrite(ref, data, 'set');
          return ref;
        },
        where: (field: string, op: string, value: unknown) => {
          if (op !== '==') throw new Error(`Unsupported fake query operator: ${op}`);
          return query(field, value);
        },
      };
    },
    runTransaction: async (cb: (tx: any) => Promise<any>) => {
      txnCount += 1;
      if (failAt && txnCount === failAt) throw new Error('simulated transaction failure');
      const writes: Array<['set' | 'update', FakeRef, Record<string, unknown>]> = [];
      let hasWritten = false;
      const tx = {
        get: async (ref: FakeRef) => {
          if (enforceReadBeforeWrite && hasWritten) {
            throw new Error('Firestore transactions require all reads to be executed before all writes.');
          }
          const data = store.get(ref.path);
          return { exists: data !== undefined, data: () => data, id: ref.id };
        },
        set: (ref: FakeRef, data: Record<string, unknown>) => {
          hasWritten = true;
          writes.push(['set', ref, data]);
        },
        update: (ref: FakeRef, data: Record<string, unknown>) => {
          hasWritten = true;
          writes.push(['update', ref, data]);
        },
        delete: (ref: FakeRef) => {
          hasWritten = true;
          writes.push(['delete', ref, {} as Record<string, unknown>]);
        },
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
  const revoked: string[] = [];
  let counter = 0;

  const auth: any = {
    users,
    claims,
    deleted,
    revoked,
    failRevocation: false,
    failPasswordUpdate: false,
    createUser: async (opts: Record<string, unknown>) => {
      const uid = `auth-${(++counter).toString()}`;
      users.set(uid, { ...opts, uid });
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
    // Returns a non-disabled stub for unknown uids so existing signInChild tests
    // (which seed the private record without createUser) keep working; for known
    // uids it reflects disabled/email from createUser/updateUser.
    getUser: async (uid: string) => {
      const u = users.get(uid);
      if (u) return { uid, disabled: u.disabled === true, email: u.email };
      return { uid, disabled: false, email: undefined };
    },
    updateUser: async (uid: string, opts: Record<string, unknown>) => {
      if (auth.failPasswordUpdate && typeof opts.password === 'string') {
        throw new Error('simulated password update failure');
      }
      const existing = users.get(uid) ?? { uid };
      users.set(uid, { ...existing, ...opts, uid });
      return { uid };
    },
    revokeRefreshTokens: async (uid: string) => {
      if (auth.failRevocation) throw new Error('simulated revocation failure');
      revoked.push(uid);
      return { uid };
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

  it('provisions an existing profile-only managed child using production transaction ordering', async () => {
    const orderedDb = makeFakeDb(true);
    const orderedAuth = makeFakeAuth();
    seedUser(orderedDb, 'owner1', { familyId: 'F1', role: 'owner', displayName: 'Owner' });
    seedUser(orderedDb, 'profile-only-child', {
      familyId: 'F1',
      role: 'child',
      isManaged: true,
      displayName: 'Profile Only',
    });

    await expect(createChildLoginImpl(makeCtx(orderedDb, orderedAuth), 'owner1', {
      childId: 'profile-only-child',
      username: 'profile_only',
      password: GOOD_PW,
      clientReqId: 'profile-only-request',
    })).resolves.toEqual({
      childId: 'profile-only-child',
      username: 'profile_only',
      loginEnabled: true,
    });
    expect(orderedAuth.users.size).toBe(1);
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
    db.store.set(`families/${familyId}`, { inviteCode: 'ABC123' });
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
      familyCode: 'ABC123',
      username: 'Alex',
      password: 'whatever',
    });
    expect(res.customToken).toBe(`token-for-${authUid}`);
    expect((res as any).syntheticEmail).toBeUndefined();
  });

  it('records the successful sign-in time on the managed-child profile', async () => {
    seedLogin('F1', 'child1');
    const ctx = makeCtx(db, auth, { verifyPassword: async () => true });

    await signInChildImpl(ctx, {
      familyCode: 'ABC123',
      username: 'Alex',
      password: 'whatever',
    });

    expect(db.store.get('users/child1')?.lastLogin).toEqual(SERVER_TS);
  });

  it('resolves a family invite code before reading the family-scoped username index', async () => {
    const familyId = 'firestore-family-id';
    const familyCode = 'ABC123';
    db.store.set(`families/${familyId}`, { inviteCode: familyCode });
    const { authUid } = seedLogin(familyId, 'child1');
    const ctx = makeCtx(db, auth, { verifyPassword: async () => true });

    const res = await signInChildImpl(ctx, {
      familyCode: ` ${familyCode.toLowerCase()} `,
      username: ' Alex ',
      password: 'whatever',
    });

    expect(res.customToken).toBe(`token-for-${authUid}`);
    expect(db.store.has(`families/${familyId}/childLoginIndex/alex`)).toBe(true);
    expect(db.store.has(`families/${familyCode}/childLoginIndex/alex`)).toBe(false);
  });

  it('returns a generic failure for a wrong password', async () => {
    seedLogin('F1', 'child1');
    const ctx = makeCtx(db, auth, { verifyPassword: async () => false });
    await expect(
      signInChildImpl(ctx, { familyCode: 'ABC123', username: 'Alex', password: 'x' }),
    ).rejects.toMatchObject({ code: 'invalid-argument', message: 'INVALID_CREDENTIALS' });
  });

  it('does not expose a password-verifier configuration or transport failure', async () => {
    seedLogin('F1', 'child1');
    const ctx = makeCtx(db, auth, {
      verifyPassword: async () => {
        throw new Error('MANAGED_CHILD_WEB_API_KEY_MISSING');
      },
    });

    await expect(
      signInChildImpl(ctx, {
        familyCode: 'ABC123',
        username: 'Alex',
        password: 'x',
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument', message: 'INVALID_CREDENTIALS' });
  });

  it('returns a generic failure for a disabled login', async () => {
    seedLogin('F1', 'child1', 'disabled');
    const ctx = makeCtx(db, auth, { verifyPassword: async () => true });
    await expect(
      signInChildImpl(ctx, { familyCode: 'ABC123', username: 'Alex', password: 'x' }),
    ).rejects.toMatchObject({ code: 'invalid-argument', message: 'INVALID_CREDENTIALS' });
  });

  it('returns a generic failure for a deleted/ineligible child', async () => {
    const { authUid } = seedLogin('F1', 'child1');
    // Remove the child user doc to simulate deletion.
    db.store.delete('users/child1');
    const ctx = makeCtx(db, auth, { verifyPassword: async () => true });
    await expect(
      signInChildImpl(ctx, { familyCode: 'ABC123', username: 'Alex', password: 'x' }),
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
      signInChildImpl(ctx, { familyCode: 'ABC123', username: 'Alex', password: 'x' }),
    ).rejects.toMatchObject({ code: 'invalid-argument', message: 'INVALID_CREDENTIALS' });
  });

  it('rejects when the Firebase Auth user is disabled but login status is enabled', async () => {
    const { authUid } = seedLogin('F1', 'child1');
    // Disable the Auth user directly (status on the private record stays enabled).
    await auth.updateUser(authUid, { disabled: true });
    const ctx = makeCtx(db, auth, { verifyPassword: async () => true });
    await expect(
      signInChildImpl(ctx, { familyCode: 'ABC123', username: 'Alex', password: 'x' }),
    ).rejects.toMatchObject({ code: 'invalid-argument', message: 'INVALID_CREDENTIALS' });
  });
});

// ---------------------------------------------------------------------------
// Phase 4A — Managed child login lifecycle (focused Functions tests)
// ---------------------------------------------------------------------------

const NEW_PW = 'N3wStr0ng!';

function seedStandardFamily(db: any, auth: any) {
  db.store.set('families/F1', { inviteCode: 'ABC123' });
  db.store.set('families/F2', { inviteCode: 'DEF456' });
  seedUser(db, 'owner1', { familyId: 'F1', role: 'owner', displayName: 'Owner' });
  seedUser(db, 'parent1', { familyId: 'F1', role: 'parent', displayName: 'Parent' });
  seedUser(db, 'child1', { familyId: 'F1', role: 'child', isManaged: true, displayName: 'Alex' });
  seedUser(db, 'child2', { familyId: 'F1', role: 'child', isManaged: true, displayName: 'Bea' });
  seedUser(db, 'parentF2', { familyId: 'F2', role: 'parent', displayName: 'P2' });
  seedUser(db, 'childF2', { familyId: 'F2', role: 'child', isManaged: true, displayName: 'C2' });
}

async function seedLoginViaCreate(
  db: any,
  auth: any,
  opts: {
    childId: string;
    username: string;
    password?: string;
    requirePasswordChange?: boolean;
    callerUid?: string;
  },
) {
  const ctx = makeCtx(db, auth);
  const result = await createChildLoginImpl(ctx, opts.callerUid ?? 'owner1', {
    childId: opts.childId,
    username: opts.username,
    password: opts.password ?? GOOD_PW,
    clientReqId: `create-${opts.childId}`,
    ...(opts.requirePasswordChange !== undefined
      ? { requirePasswordChange: opts.requirePasswordChange }
      : {}),
  });
  // authUid is intentionally omitted from CreateChildLoginResult (security), so
  // read it back from the server-owned private record for test assertions.
  const childDoc = db.store.get(`users/${opts.childId}`) as Record<string, unknown> | undefined;
  const familyId = (childDoc?.familyId as string) ?? 'F1';
  const priv = db.store.get(`families/${familyId}/childLogins/${opts.childId}`) as
    | Record<string, unknown>
    | undefined;
  const authUid = (priv?.authUid as string) ?? undefined;
  return { ...result, authUid };
}

describe('resetChildPassword', () => {
  let db: any;
  let auth: any;

  beforeEach(() => {
    db = makeFakeDb();
    auth = makeFakeAuth();
    seedStandardFamily(db, auth);
  });

  it('same-family parent can reset the password', async () => {
    const { authUid } = await seedLoginViaCreate(db, auth, {
      childId: 'child1',
      username: 'Alex',
    });
    const ctx = makeCtx(db, auth);
    const res = await resetChildPasswordImpl(ctx, 'parent1', {
      childId: 'child1',
      newPassword: NEW_PW,
      clientReqId: 'r1',
    });
    expect(res.childId).toBe('child1');
    expect(res.loginEnabled).toBe(true);
    expect(res.requiresPasswordChange).toBe(true);
    expect((res as any).authUid).toBeUndefined();
    expect((res as any).syntheticEmail).toBeUndefined();
    expect(db.store.get('families/F1/childLogins/child1').authUid).toBe(authUid);
    expect(auth.users.get(authUid).password).toBe(NEW_PW);
    expect(auth.users.size).toBe(1);
  });

  it('unrelated-family parent is denied', async () => {
    await seedLoginViaCreate(db, auth, { childId: 'child1', username: 'Alex' });
    const ctx = makeCtx(db, auth);
    await expect(
      resetChildPasswordImpl(ctx, 'parentF2', {
        childId: 'child1',
        newPassword: NEW_PW,
        clientReqId: 'r1',
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('child caller is denied', async () => {
    await seedLoginViaCreate(db, auth, { childId: 'child1', username: 'Alex' });
    seedUser(db, 'childcaller', { familyId: 'F1', role: 'child', isManaged: true });
    const ctx = makeCtx(db, auth);
    await expect(
      resetChildPasswordImpl(ctx, 'childcaller', {
        childId: 'child1',
        newPassword: NEW_PW,
        clientReqId: 'r1',
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('weak password is denied', async () => {
    await seedLoginViaCreate(db, auth, { childId: 'child1', username: 'Alex' });
    const ctx = makeCtx(db, auth);
    await expect(
      resetChildPasswordImpl(ctx, 'owner1', {
        childId: 'child1',
        newPassword: 'short',
        clientReqId: 'r1',
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('revokes refresh tokens', async () => {
    const { authUid } = await seedLoginViaCreate(db, auth, { childId: 'child1', username: 'Alex' });
    const ctx = makeCtx(db, auth);
    await resetChildPasswordImpl(ctx, 'owner1', {
      childId: 'child1',
      newPassword: NEW_PW,
      clientReqId: 'r1',
    });
    expect(auth.revoked).toContain(authUid);
  });

  it('always persists requiresPasswordChange even if an obsolete caller sends false', async () => {
    await seedLoginViaCreate(db, auth, { childId: 'child1', username: 'Alex' });
    const ctx = makeCtx(db, auth);
    await resetChildPasswordImpl(ctx, 'owner1', {
      childId: 'child1',
      newPassword: NEW_PW,
      requirePasswordChange: false,
      clientReqId: 'r1',
    });
    expect(db.store.get('families/F1/childLogins/child1').requiresPasswordChange).toBe(true);
    expect(db.store.get('users/child1').requiresPasswordChange).toBe(true);
  });

  it('is idempotent on retry with the same clientReqId', async () => {
    await seedLoginViaCreate(db, auth, { childId: 'child1', username: 'Alex' });
    const ctx = makeCtx(db, auth);
    const input = {
      childId: 'child1',
      newPassword: NEW_PW,
      requirePasswordChange: true,
      clientReqId: 'r1',
    };
    const first = await resetChildPasswordImpl(ctx, 'owner1', input);
    const second = await resetChildPasswordImpl(ctx, 'owner1', input);
    expect(second).toEqual(first);
    const idem = db.store.get('families/F1/childLoginIdempotency/r1');
    expect(idem.status).toBe('completed');
  });

  it('uses only non-secret metadata for idempotency and rejects incompatible metadata', async () => {
    await seedLoginViaCreate(db, auth, { childId: 'child1', username: 'Alex' });
    const ctx = makeCtx(db, auth);
    await resetChildPasswordImpl(ctx, 'owner1', {
      childId: 'child1',
      newPassword: NEW_PW,
      clientReqId: 'r1',
    });
    const idem = db.store.get('families/F1/childLoginIdempotency/r1');
    expect(idem.operation).toBe('resetChildPassword');
    expect(idem.childId).toBe('child1');
    expect(idem.requesterUid).toBe('owner1');
    expect(JSON.stringify(idem)).not.toContain(NEW_PW);

    await seedLoginViaCreate(db, auth, { childId: 'child2', username: 'Bea' });
    await expect(
      resetChildPasswordImpl(ctx, 'owner1', {
        childId: 'child2',
        newPassword: 'An0therStrong!',
        clientReqId: 'r1',
      }),
    ).rejects.toMatchObject({ code: 'already-exists' });
  });

  it('keeps the child restricted when refresh-token revocation fails', async () => {
    await seedLoginViaCreate(db, auth, { childId: 'child1', username: 'Alex' });
    auth.failRevocation = true;
    const ctx = makeCtx(db, auth);
    await expect(
      resetChildPasswordImpl(ctx, 'owner1', {
        childId: 'child1',
        newPassword: NEW_PW,
        clientReqId: 'r1',
      }),
    ).rejects.toMatchObject({ code: 'internal', message: 'SESSION_REVOCATION_FAILED' });
    expect(db.store.get('families/F1/childLogins/child1').requiresPasswordChange).toBe(true);
    expect(db.store.get('users/child1').requiresPasswordChange).toBe(true);
  });

  it('records a restricted recovery state and revokes sessions when the Auth update fails', async () => {
    const { authUid } = await seedLoginViaCreate(db, auth, { childId: 'child1', username: 'Alex' });
    auth.failPasswordUpdate = true;
    const ctx = makeCtx(db, auth);
    await expect(
      resetChildPasswordImpl(ctx, 'owner1', {
        childId: 'child1',
        newPassword: NEW_PW,
        clientReqId: 'r1',
      }),
    ).rejects.toMatchObject({ code: 'internal', message: 'AUTH_UPDATE_FAILED' });
    expect(auth.revoked).toContain(authUid);
    expect(db.store.get('families/F1/childLogins/child1').recoveryState).toBe('auth_update_failed');
    expect(db.store.get('users/child1').requiresPasswordChange).toBe(true);
  });
});

describe('disable / enable child login', () => {
  let db: any;
  let auth: any;

  beforeEach(() => {
    db = makeFakeDb();
    auth = makeFakeAuth();
    seedStandardFamily(db, auth);
  });

  it('disable blocks signInChild', async () => {
    const { authUid } = await seedLoginViaCreate(db, auth, { childId: 'child1', username: 'Alex' });
    const ctx = makeCtx(db, auth, { verifyPassword: async () => true });
    await disableChildLoginImpl(ctx, 'owner1', { childId: 'child1', clientReqId: 'd1' });
    await expect(
      signInChildImpl(ctx, { familyCode: 'ABC123', username: 'Alex', password: 'x' }),
    ).rejects.toMatchObject({ code: 'invalid-argument', message: 'INVALID_CREDENTIALS' });
    expect(authUid).toBeTruthy();
  });

  it('enable restores access', async () => {
    await seedLoginViaCreate(db, auth, { childId: 'child1', username: 'Alex' });
    const ctx = makeCtx(db, auth, { verifyPassword: async () => true });
    await disableChildLoginImpl(ctx, 'owner1', { childId: 'child1', clientReqId: 'd1' });
    await enableChildLoginImpl(ctx, 'owner1', { childId: 'child1', clientReqId: 'e1' });
    const res = await signInChildImpl(ctx, { familyCode: 'ABC123', username: 'Alex', password: 'x' });
    expect(res.customToken).toBeTruthy();
  });

  it('Auth disabled state and Firestore state stay consistent', async () => {
    const { authUid } = await seedLoginViaCreate(db, auth, { childId: 'child1', username: 'Alex' });
    const ctx = makeCtx(db, auth);
    await disableChildLoginImpl(ctx, 'owner1', { childId: 'child1', clientReqId: 'd1' });
    expect(auth.users.get(authUid).disabled).toBe(true);
    expect(db.store.get('families/F1/childLogins/child1').status).toBe('disabled');
    expect(db.store.get('families/F1/childLogins/child1').loginEnabled).toBe(false);
    expect(db.store.get('users/child1').loginEnabled).toBe(false);

    await enableChildLoginImpl(ctx, 'owner1', { childId: 'child1', clientReqId: 'e1' });
    expect(auth.users.get(authUid).disabled).toBe(false);
    expect(db.store.get('families/F1/childLogins/child1').status).toBe('enabled');
    expect(db.store.get('families/F1/childLogins/child1').loginEnabled).toBe(true);
    expect(db.store.get('users/child1').loginEnabled).toBe(true);
  });

  it('repeated calls remain idempotent', async () => {
    await seedLoginViaCreate(db, auth, { childId: 'child1', username: 'Alex' });
    const ctx = makeCtx(db, auth);
    const first = await disableChildLoginImpl(ctx, 'owner1', { childId: 'child1', clientReqId: 'd1' });
    const second = await disableChildLoginImpl(ctx, 'owner1', { childId: 'child1', clientReqId: 'd1' });
    expect(second).toEqual(first);
    const firstE = await enableChildLoginImpl(ctx, 'owner1', { childId: 'child1', clientReqId: 'e1' });
    const secondE = await enableChildLoginImpl(ctx, 'owner1', { childId: 'child1', clientReqId: 'e1' });
    expect(secondE).toEqual(firstE);
  });
});

describe('revokeChildSessions', () => {
  let db: any;
  let auth: any;

  beforeEach(() => {
    db = makeFakeDb();
    auth = makeFakeAuth();
    seedStandardFamily(db, auth);
  });

  it('revokes tokens without disabling the account', async () => {
    const { authUid } = await seedLoginViaCreate(db, auth, { childId: 'child1', username: 'Alex' });
    const ctx = makeCtx(db, auth);
    const res = await revokeChildSessionsImpl(ctx, 'owner1', { childId: 'child1', clientReqId: 'rv1' });
    expect(res.success).toBe(true);
    expect(auth.revoked).toContain(authUid);
    expect(db.store.get('families/F1/childLogins/child1').status).toBe('enabled');
    expect(db.store.get('users/child1').loginEnabled).toBe(true);
    expect(auth.users.get(authUid).disabled).toBe(false);
  });
});

describe('changeChildUsername', () => {
  let db: any;
  let auth: any;

  beforeEach(() => {
    db = makeFakeDb();
    auth = makeFakeAuth();
    seedStandardFamily(db, auth);
  });

  it('removes the old index and creates the new index', async () => {
    await seedLoginViaCreate(db, auth, { childId: 'child1', username: 'Alex' });
    const ctx = makeCtx(db, auth);
    await changeChildUsernameImpl(ctx, 'owner1', {
      childId: 'child1',
      newUsername: 'Bea',
      clientReqId: 'u1',
    });
    expect(db.store.has('families/F1/childLoginIndex/bea')).toBe(true);
    expect(db.store.has('families/F1/childLoginIndex/alex')).toBe(false);
  });

  it('rejects a same-family normalized collision', async () => {
    await seedLoginViaCreate(db, auth, { childId: 'child1', username: 'Alex' });
    await seedLoginViaCreate(db, auth, { childId: 'child2', username: 'Bea', callerUid: 'owner1' });
    const ctx = makeCtx(db, auth);
    await expect(
      changeChildUsernameImpl(ctx, 'owner1', {
        childId: 'child1',
        newUsername: '  BEA  ',
        clientReqId: 'u1',
      }),
    ).rejects.toMatchObject({ code: 'already-exists' });
    // old index must remain
    expect(db.store.has('families/F1/childLoginIndex/alex')).toBe(true);
  });

  it('allows a cross-family duplicate username', async () => {
    await seedLoginViaCreate(db, auth, { childId: 'child1', username: 'Alex' });
    await seedLoginViaCreate(db, auth, {
      childId: 'childF2',
      username: 'Bea',
      callerUid: 'parentF2',
    });
    const ctx = makeCtx(db, auth);
    const res = await changeChildUsernameImpl(ctx, 'owner1', {
      childId: 'child1',
      newUsername: 'Bea',
      clientReqId: 'u1',
    });
    expect(res.username).toBe('Bea');
    expect(db.store.has('families/F1/childLoginIndex/bea')).toBe(true);
  });

  it('keeps profile, private record, and Auth data consistent', async () => {
    const { authUid } = await seedLoginViaCreate(db, auth, { childId: 'child1', username: 'Alex' });
    const ctx = makeCtx(db, auth);
    await changeChildUsernameImpl(ctx, 'owner1', {
      childId: 'child1',
      newUsername: 'Bea',
      clientReqId: 'u1',
    });
    expect(db.store.get('users/child1').username).toBe('Bea');
    const priv = db.store.get('families/F1/childLogins/child1');
    expect(priv.username).toBe('Bea');
    expect(priv.normalizedUsername).toBe('bea');
    expect(priv.syntheticEmail).toBe('child-f1-bea@managed.familyquest.app');
    expect(auth.users.get(authUid).email).toBe('child-f1-bea@managed.familyquest.app');
  });

  it('rejects a retry with a changed payload (same clientReqId)', async () => {
    await seedLoginViaCreate(db, auth, { childId: 'child1', username: 'Alex' });
    const ctx = makeCtx(db, auth);
    await changeChildUsernameImpl(ctx, 'owner1', {
      childId: 'child1',
      newUsername: 'Bea',
      clientReqId: 'u1',
    });
    await expect(
      changeChildUsernameImpl(ctx, 'owner1', {
        childId: 'child1',
        newUsername: 'Cara',
        clientReqId: 'u1',
      }),
    ).rejects.toMatchObject({ code: 'already-exists' });
  });
});

describe('completeChildPasswordChange', () => {
  let db: any;
  let auth: any;

  function childClaims(childId = 'child1', familyId = 'F1') {
    return {
      role: 'child',
      managedChild: true,
      childId,
      familyId,
      auth_time: Math.floor(Date.now() / 1000),
    };
  }

  beforeEach(() => {
    db = makeFakeDb();
    auth = makeFakeAuth();
    seedStandardFamily(db, auth);
  });

  it('is managed-child only', async () => {
    await seedLoginViaCreate(db, auth, {
      childId: 'child1',
      username: 'Alex',
      requirePasswordChange: true,
    });
    const ctx = makeCtx(db, auth);
    await expect(
      completeChildPasswordChangeImpl(ctx, 'auth-1', { role: 'parent', familyId: 'F1' }, {
        newPassword: NEW_PW,
        clientReqId: 'c1',
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('requires requiresPasswordChange to be true', async () => {
    await seedLoginViaCreate(db, auth, {
      childId: 'child1',
      username: 'Alex',
      requirePasswordChange: false,
    });
    const ctx = makeCtx(db, auth);
    await expect(
      completeChildPasswordChangeImpl(ctx, 'auth-1', childClaims(), {
        newPassword: NEW_PW,
        clientReqId: 'c1',
      }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects a caller whose Auth UID does not match the private linkage', async () => {
    await seedLoginViaCreate(db, auth, {
      childId: 'child1',
      username: 'Alex',
      requirePasswordChange: true,
    });
    const ctx = makeCtx(db, auth);
    await expect(
      completeChildPasswordChangeImpl(ctx, 'wrong-auth-uid', childClaims(), {
        newPassword: NEW_PW,
        clientReqId: 'c1',
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('applies the new password, clears the flag, and revokes sessions', async () => {
    const { authUid } = await seedLoginViaCreate(db, auth, {
      childId: 'child1',
      username: 'Alex',
      requirePasswordChange: true,
    });
    const ctx = makeCtx(db, auth, { verifyPassword: async () => true });
    const res = await completeChildPasswordChangeImpl(ctx, authUid, childClaims(), {
      newPassword: NEW_PW,
      clientReqId: 'c1',
    });
    expect(res.success).toBe(true);
    expect(auth.users.get(authUid).password).toBe(NEW_PW);
    expect(db.store.get('families/F1/childLogins/child1').requiresPasswordChange).toBe(false);
    expect(db.store.get('users/child1').requiresPasswordChange).toBe(false);
    expect(auth.revoked).toContain(authUid);
  });

  it('never exposes password values in audit, result, or log', async () => {
    await seedLoginViaCreate(db, auth, {
      childId: 'child1',
      username: 'Alex',
      requirePasswordChange: true,
    });
    const ctx = makeCtx(db, auth, { verifyPassword: async () => true });
    const priv = db.store.get('families/F1/childLogins/child1');
    const res = await completeChildPasswordChangeImpl(ctx, priv.authUid, childClaims(), {
      newPassword: NEW_PW,
      clientReqId: 'c1',
    });
    expect(JSON.stringify(res)).not.toContain(GOOD_PW);
    expect(JSON.stringify(res)).not.toContain(NEW_PW);
    const audit = Array.from(db.store.values()).find(
      (v: any) => v.type === 'password_change_completed',
    );
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit)).not.toContain(GOOD_PW);
    expect(JSON.stringify(audit)).not.toContain(NEW_PW);
  });

  it('is idempotent on retry', async () => {
    await seedLoginViaCreate(db, auth, {
      childId: 'child1',
      username: 'Alex',
      requirePasswordChange: true,
    });
    const ctx = makeCtx(db, auth, { verifyPassword: async () => true });
    const input = {
      newPassword: NEW_PW,
      clientReqId: 'c1',
    };
    const authUid = db.store.get('families/F1/childLogins/child1').authUid;
    const first = await completeChildPasswordChangeImpl(ctx, authUid, childClaims(), input);
    const second = await completeChildPasswordChangeImpl(ctx, authUid, childClaims(), input);
    expect(second).toEqual(first);
  });

  it('does not clear the restriction if refresh-token revocation fails', async () => {
    const { authUid } = await seedLoginViaCreate(db, auth, {
      childId: 'child1',
      username: 'Alex',
      requirePasswordChange: true,
    });
    auth.failRevocation = true;
    const ctx = makeCtx(db, auth);
    await expect(
      completeChildPasswordChangeImpl(ctx, authUid, childClaims(), {
        newPassword: NEW_PW,
        clientReqId: 'c1',
      }),
    ).rejects.toMatchObject({ code: 'internal', message: 'SESSION_REVOCATION_FAILED' });
    expect(db.store.get('families/F1/childLogins/child1').requiresPasswordChange).toBe(true);
    expect(db.store.get('users/child1').requiresPasswordChange).toBe(true);
  });
});

describe('createChildLogin — requirePasswordChange contract (Phase 4A regression)', () => {
  let db: any;
  let auth: any;

  beforeEach(() => {
    db = makeFakeDb();
    auth = makeFakeAuth();
    seedStandardFamily(db, auth);
  });

  it('persists requirePasswordChange=true', async () => {
    await seedLoginViaCreate(db, auth, {
      childId: 'child1',
      username: 'Alex',
      requirePasswordChange: true,
    });
    expect(db.store.get('families/F1/childLogins/child1').requiresPasswordChange).toBe(true);
    expect(db.store.get('users/child1').requiresPasswordChange).toBe(true);
  });

  it('persists requirePasswordChange=false', async () => {
    await seedLoginViaCreate(db, auth, {
      childId: 'child1',
      username: 'Alex',
      requirePasswordChange: false,
    });
    expect(db.store.get('families/F1/childLogins/child1').requiresPasswordChange).toBe(false);
    expect(db.store.get('users/child1').requiresPasswordChange).toBe(false);
  });

  it('idempotency hash includes the flag', async () => {
    expect(computePayloadHash('C1', 'alex', 'true')).not.toBe(
      computePayloadHash('C1', 'alex', 'false'),
    );
    // A replay with the same clientReqId but a flipped flag must be rejected.
    await seedLoginViaCreate(db, auth, {
      childId: 'child1',
      username: 'Alex',
      requirePasswordChange: true,
    });
    const ctx = makeCtx(db, auth);
    await expect(
      createChildLoginImpl(ctx, 'owner1', {
        childId: 'child1',
        username: 'Alex',
        password: GOOD_PW,
        clientReqId: 'create-child1',
        requirePasswordChange: false,
      }),
    ).rejects.toMatchObject({ code: 'already-exists' });
  });
});
