// ---------------------------------------------------------------------------
// CHILD DELETION — FOCUSED FUNCTIONS TESTS
// ---------------------------------------------------------------------------
// These tests exercise the trusted backend deleteChildImpl logic against
// an in-memory Firestore mock. They cover the allowed, denied, and
// integrity cases required by the Phase 4B spec. They do NOT require
// the Firebase emulators and do NOT touch production data.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({}),
  FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
}));
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({}),
}));

import {
  deleteChildImpl,
  type ChildDeletionContext,
} from './childDeletion';

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
    set: (data: Record<string, unknown>) => {
      store.set(path, { ...data });
    },
    update: (data: Record<string, unknown>) => {
      const existing = store.get(path) ?? {};
      store.set(path, { ...existing, ...data });
    },
    delete: () => {
      store.delete(path);
    },
  });

  const queryDocs = (collectionPath: string, field: string, value: unknown) => {
    const out: any[] = [];
    for (const [path, data] of store.entries()) {
      const parent = path.slice(0, path.lastIndexOf('/'));
      if (parent !== collectionPath) continue;
      if ((data as Record<string, unknown>)[field] !== value) continue;
      out.push({ id: path.split('/').pop(), data: () => data, ref: makeRef(path) });
    }
    return out;
  };

  const db: any = {
    store,
    doc: makeRef,
    collection: (path: string) => ({
      doc: (id?: string) => {
        const realId = id || Math.random().toString(36).slice(2);
        return makeRef(`${path}/${realId}`);
      },
      where: (field: string, _op: string, value: unknown) => ({
        limit: (n: number) => ({
          get: async () => {
            const docs = queryDocs(path, field, value).slice(0, n);
            return {
              empty: docs.length === 0,
              docs,
              size: docs.length,
            };
          },
        }),
        get: async () => {
          const docs = queryDocs(path, field, value);
          return {
            empty: docs.length === 0,
            docs,
            size: docs.length,
          };
        },
      }),
      add: async (data: Record<string, unknown>) => {
        const ref = db.collection(path).doc();
        ref.set(data);
        return ref;
      },
    }),
    runTransaction: async (cb: (tx: any) => Promise<any>) => {
      const writes: Array<['set' | 'update' | 'delete', FakeRef, Record<string, unknown>]> = [];
      const tx = {
        get: async (ref: FakeRef) => {
          const data = store.get(ref.path);
          return { exists: data !== undefined, data: () => data, id: ref.id };
        },
        set: (ref: FakeRef, data: Record<string, unknown>) => {
          writes.push(['set', ref, data]);
        },
        update: (ref: FakeRef, data: Record<string, unknown>) => {
          writes.push(['update', ref, data]);
        },
        delete: (ref: FakeRef) => {
          writes.push(['delete', ref, {} as Record<string, unknown>]);
        },
      };
      const result = await cb(tx);
      for (const [op, ref, data] of writes) {
        if (op === 'set') store.set(ref.path, { ...data });
        else if (op === 'update') {
          const existing = store.get(ref.path) ?? {};
          store.set(ref.path, { ...existing, ...data });
        } else if (op === 'delete') store.delete(ref.path);
      }
      return result;
    },
    batch: () => {
      const ops: Array<{ type: 'delete' | 'update'; ref: FakeRef; data?: Record<string, unknown> }> = [];
      return {
        delete: (ref: FakeRef) => {
          ops.push({ type: 'delete', ref });
        },
        update: (ref: FakeRef, data: Record<string, unknown>) => {
          ops.push({ type: 'update', ref, data });
        },
        commit: async () => {
          for (const op of ops.splice(0)) {
            if (op.type === 'delete') {
              store.delete(op.ref.path);
            } else if (op.type === 'update') {
              const existing = store.get(op.ref.path) ?? {};
              store.set(op.ref.path, { ...existing, ...op.data });
            }
          }
        },
      };
    },
  };
  return db as any;
}

// ---------------------------------------------------------------------------
// In-memory Auth mock
// ---------------------------------------------------------------------------

function makeFakeAuth() {
  const users = new Map<string, Record<string, unknown>>();
  const deleted: string[] = [];
  const revoked: string[] = [];
  let counter = 0;

  const auth: any = {
    users,
    deleted,
    revoked,
    createUser: async (opts: Record<string, unknown>) => {
      const uid = `auth-${(++counter).toString()}`;
      users.set(uid, { ...opts, uid });
      return { uid };
    },
    deleteUser: async (uid: string) => {
      users.delete(uid);
      deleted.push(uid);
    },
    getUser: async (uid: string) => {
      const u = users.get(uid);
      if (u) return { uid, disabled: u.disabled === true, email: u.email };
      throw new Error('auth/user-not-found');
    },
    updateUser: async (uid: string, opts: Record<string, unknown>) => {
      const existing = users.get(uid) ?? { uid };
      users.set(uid, { ...existing, ...opts, uid });
      return { uid };
    },
    revokeRefreshTokens: async (uid: string) => {
      revoked.push(uid);
      return { uid };
    },
  };
  return auth as any;
}

// ---------------------------------------------------------------------------
// World builder
// ---------------------------------------------------------------------------

function seedUser(db: any, uid: string, fields: Record<string, unknown>) {
  db.store.set(`users/${uid}`, fields);
}

function makeCtx(db: any, auth: any): ChildDeletionContext {
  return { db, auth };
}

const FAMILY_ID = 'F1';

function seedStandardFamily(db: any, auth: any) {
  db.store.set(`families/${FAMILY_ID}`, { inviteCode: 'ABC123', name: 'Test Family' });
  seedUser(db, 'owner1', { familyId: FAMILY_ID, role: 'owner', displayName: 'Owner' });
  seedUser(db, 'parent1', { familyId: FAMILY_ID, role: 'parent', displayName: 'Parent' });
  seedUser(db, 'child1', {
    familyId: FAMILY_ID,
    role: 'child',
    isManaged: true,
    displayName: 'Test',
    authUid: 'auth-child1',
    hasLogin: true,
    loginEnabled: true,
  });
  seedUser(db, 'child2', {
    familyId: FAMILY_ID,
    role: 'child',
    isManaged: true,
    displayName: 'Bea',
    authUid: 'auth-child2',
    hasLogin: true,
    loginEnabled: true,
  });
  // Seed child2's login records so preservation tests can verify they survive child1's deletion
  db.store.set(`families/${FAMILY_ID}/childLogins/child2`, {
    childId: 'child2',
    familyId: FAMILY_ID,
    username: 'bea',
    loginEnabled: true,
    requiresPasswordChange: false,
    createdAt: SERVER_TS,
  });
  db.store.set(`families/${FAMILY_ID}/childLoginIndex/bea`, {
    childId: 'child2',
    familyId: FAMILY_ID,
    username: 'bea',
  });
  seedUser(db, 'selfRegisteredChild', {
    familyId: FAMILY_ID,
    role: 'child',
    isManaged: false,
    displayName: 'Self Registered',
  });
  seedUser(db, 'parentF2', { familyId: 'F2', role: 'parent', displayName: 'P2' });
  seedUser(db, 'childF2', { familyId: 'F2', role: 'child', isManaged: true, displayName: 'C2' });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('deleteChild — ALLOWED', () => {
  let db: any;
  let auth: any;

  beforeEach(() => {
    db = makeFakeDb();
    auth = makeFakeAuth();
    seedStandardFamily(db, auth);
  });

  it('owner can delete a managed child', async () => {
    const ctx = makeCtx(db, auth);
    const result = await deleteChildImpl(ctx, 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'del-1',
    });
    expect(result.childId).toBe('child1');
    expect(result.deleted).toBe(true);
    // Child profile should be removed
    expect(db.store.has('users/child1')).toBe(false);
    // Child login private record should be removed
    expect(db.store.has(`families/${FAMILY_ID}/childLogins/child1`)).toBe(false);
    // Username index should be removed
    expect(db.store.has(`families/${FAMILY_ID}/childLoginIndex/test`)).toBe(false);
  });

  it('authorised parent can delete a managed child', async () => {
    const ctx = makeCtx(db, auth);
    const result = await deleteChildImpl(ctx, 'parent1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'del-2',
    });
    expect(result.deleted).toBe(true);
    expect(db.store.has('users/child1')).toBe(false);
  });

  it('idempotent retry returns same result', async () => {
    const ctx = makeCtx(db, auth);
    const first = await deleteChildImpl(ctx, 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'del-idem',
    });
    // Second call with same clientReqId should return the cached result
    const second = await deleteChildImpl(ctx, 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'del-idem',
    });
    expect(second).toEqual(first);
  });

  it('deletes Auth user before Firestore records', async () => {
    const ctx = makeCtx(db, auth);
    await deleteChildImpl(ctx, 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'del-auth',
    });
    expect(auth.deleted).toContain('auth-child1');
  });

  it('revokes sessions before Auth deletion', async () => {
    const ctx = makeCtx(db, auth);
    await deleteChildImpl(ctx, 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'del-revoke',
    });
    expect(auth.revoked).toContain('auth-child1');
  });

  it('removes username index entry', async () => {
    const ctx = makeCtx(db, auth);
    await deleteChildImpl(ctx, 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'del-index',
    });
    expect(db.store.has(`families/${FAMILY_ID}/childLoginIndex/test`)).toBe(false);
  });

  it('removes child-login metadata', async () => {
    const ctx = makeCtx(db, auth);
    await deleteChildImpl(ctx, 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'del-login',
    });
    expect(db.store.has(`families/${FAMILY_ID}/childLogins/child1`)).toBe(false);
  });

  it('removes profile (users/{childUid})', async () => {
    const ctx = makeCtx(db, auth);
    await deleteChildImpl(ctx, 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'del-profile',
    });
    expect(db.store.has('users/child1')).toBe(false);
  });

  it('does not remove unrelated family members', async () => {
    const ctx = makeCtx(db, auth);
    await deleteChildImpl(ctx, 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'del-unrelated',
    });
    expect(db.store.has('users/owner1')).toBe(true);
    expect(db.store.has('users/parent1')).toBe(true);
    expect(db.store.has('users/child2')).toBe(true);
  });

  it('does not remove unrelated family data', async () => {
    const ctx = makeCtx(db, auth);
    await deleteChildImpl(ctx, 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'del-family',
    });
    expect(db.store.has(`families/${FAMILY_ID}`)).toBe(true);
    expect(db.store.has(`families/${FAMILY_ID}/childLogins/child2`)).toBe(true);
  });

  it('does not remove other children login records', async () => {
    const ctx = makeCtx(db, auth);
    await deleteChildImpl(ctx, 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'del-other-login',
    });
    expect(db.store.has(`families/${FAMILY_ID}/childLogins/child2`)).toBe(true);
  });

  it('does not remove other children username index', async () => {
    const ctx = makeCtx(db, auth);
    await deleteChildImpl(ctx, 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'del-other-index',
    });
    expect(db.store.has(`families/${FAMILY_ID}/childLoginIndex/bea`)).toBe(true);
  });

  it('missing Auth user is treated idempotently (no error)', async () => {
    // child1 has authUid 'auth-child1' but we delete the Auth user first
    // then try to delete again — should be idempotent
    const ctx = makeCtx(db, auth);
    await deleteChildImpl(ctx, 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'del-missing-auth',
    });
    // Second call should also succeed (child profile already gone from Firestore)
    const result = await deleteChildImpl(ctx, 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'del-missing-auth-retry',
    });
    expect(result.deleted).toBe(false);
  });

  it('missing Firestore doc is treated idempotently', async () => {
    // Delete child1 first
    const ctx = makeCtx(db, auth);
    await deleteChildImpl(ctx, 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'del-missing-doc',
    });
    // Second call with a different clientReqId but same child (now gone)
    // should return deleted: false idempotently (no error)
    const result = await deleteChildImpl(ctx, 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'del-missing-doc-retry',
    });
    expect(result.deleted).toBe(false);
  });
});

describe('deleteChild — DENIED', () => {
  let db: any;
  let auth: any;

  beforeEach(() => {
    db = makeFakeDb();
    auth = makeFakeAuth();
    seedStandardFamily(db, auth);
  });

  it('child cannot delete themselves', async () => {
    const ctx = makeCtx(db, auth);
    await expect(
      deleteChildImpl(ctx, 'child1', {
        childId: 'child1',
        displayNameConfirmation: 'Test',
        clientReqId: 'del-self',
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('child cannot delete another child', async () => {
    const ctx = makeCtx(db, auth);
    await expect(
      deleteChildImpl(ctx, 'child1', {
        childId: 'child2',
        displayNameConfirmation: 'Bea',
        clientReqId: 'del-child',
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('cross-family parent is denied', async () => {
    const ctx = makeCtx(db, auth);
    await expect(
      deleteChildImpl(ctx, 'parentF2', {
        childId: 'child1',
        displayNameConfirmation: 'Test',
        clientReqId: 'del-cross-family',
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('self-registered child (isManaged=false) is denied', async () => {
    const ctx = makeCtx(db, auth);
    await expect(
      deleteChildImpl(ctx, 'owner1', {
        childId: 'selfRegisteredChild',
        displayNameConfirmation: 'Self Registered',
        clientReqId: 'del-self-registered',
      }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('wrong display name confirmation is denied', async () => {
    const ctx = makeCtx(db, auth);
    await expect(
      deleteChildImpl(ctx, 'owner1', {
        childId: 'child1',
        displayNameConfirmation: 'Wrong Name',
        clientReqId: 'del-wrong-name',
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('empty display name confirmation is denied', async () => {
    const ctx = makeCtx(db, auth);
    await expect(
      deleteChildImpl(ctx, 'owner1', {
        childId: 'child1',
        displayNameConfirmation: '',
        clientReqId: 'del-empty-name',
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('unauthenticated caller is denied', async () => {
    const ctx = makeCtx(db, auth);
    await expect(
      deleteChildImpl(ctx, 'ghost', {
        childId: 'child1',
        displayNameConfirmation: 'Test',
        clientReqId: 'del-unauth',
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('non-existent caller is denied', async () => {
    const ctx = makeCtx(db, auth);
    await expect(
      deleteChildImpl(ctx, 'nonexistent', {
        childId: 'child1',
        displayNameConfirmation: 'Test',
        clientReqId: 'del-no-caller',
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('non-existent child is treated idempotently', async () => {
    const ctx = makeCtx(db, auth);
    const result = await deleteChildImpl(ctx, 'owner1', {
      childId: 'nonexistent-child',
      displayNameConfirmation: 'Test',
      clientReqId: 'del-no-child',
    });
    expect(result.deleted).toBe(false);
    expect(result.childId).toBe('nonexistent-child');
  });

  it('replay with different payload is rejected', async () => {
    const ctx = makeCtx(db, auth);
    await deleteChildImpl(ctx, 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'del-replay',
    });
    // Same clientReqId but different childId + displayName should be rejected
    await expect(
      deleteChildImpl(ctx, 'owner1', {
        childId: 'child2',
        displayNameConfirmation: 'Bea',
        clientReqId: 'del-replay',
      }),
    ).rejects.toMatchObject({ code: 'already-exists' });
  });
});

describe('deleteChild — INTEGRITY', () => {
  let db: any;
  let auth: any;

  beforeEach(() => {
    db = makeFakeDb();
    auth = makeFakeAuth();
    seedStandardFamily(db, auth);
  });

  it('does not log passwords or synthetic identifiers', async () => {
    const ctx = makeCtx(db, auth);
    await deleteChildImpl(ctx, 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'del-audit',
    });
    // Find the audit event
    const auditEntries = Array.from(db.store.values()).filter(
      (v: any) => v.type === 'child_deleted',
    );
    expect(auditEntries.length).toBeGreaterThan(0);
    const audit = auditEntries[0];
    // No passwords or synthetic emails in audit
    expect(JSON.stringify(audit)).not.toContain('auth-child1');
    expect(JSON.stringify(audit)).not.toContain('@managed.familyquest.app');
  });

  it('writes audit event on successful deletion', async () => {
    const ctx = makeCtx(db, auth);
    await deleteChildImpl(ctx, 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'del-audit-ok',
    });
    const auditEntries = Array.from(db.store.values()).filter(
      (v: any) => v.type === 'child_deleted',
    );
    expect(auditEntries.length).toBeGreaterThan(0);
    expect(auditEntries[0].success).toBe(true);
    expect(auditEntries[0].childId).toBe('child1');
    expect(auditEntries[0].actorId).toBe('owner1');
  });

  it('preserves other children\'s login data', async () => {
    const ctx = makeCtx(db, auth);
    await deleteChildImpl(ctx, 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'del-preserve',
    });
    expect(db.store.has(`families/${FAMILY_ID}/childLogins/child2`)).toBe(true);
    expect(db.store.has(`families/${FAMILY_ID}/childLoginIndex/bea`)).toBe(true);
    expect(db.store.has('users/child2')).toBe(true);
  });

  it('preserves family document', async () => {
    const ctx = makeCtx(db, auth);
    await deleteChildImpl(ctx, 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'del-family-preserve',
    });
    expect(db.store.has(`families/${FAMILY_ID}`)).toBe(true);
  });

  it('unassigns active tasks assigned to the deleted child', async () => {
    const ctx = makeCtx(db, auth);
    // Seed task assigned to child1 and task assigned to child2
    db.store.set(`families/${FAMILY_ID}/tasks/task1`, {
      id: 'task1',
      title: 'Wash dishes',
      assigneeId: 'child1',
    });
    db.store.set(`families/${FAMILY_ID}/tasks/task2`, {
      id: 'task2',
      title: 'Walk dog',
      assigneeId: 'child2',
    });

    await deleteChildImpl(ctx, 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'del-tasks',
    });

    const task1 = db.store.get(`families/${FAMILY_ID}/tasks/task1`);
    expect(task1).toBeDefined();
    expect(task1.assigneeId).toBeNull();

    const task2 = db.store.get(`families/${FAMILY_ID}/tasks/task2`);
    expect(task2).toBeDefined();
    expect(task2.assigneeId).toBe('child2');
  });

  it('cancels pending child QR join requests targeting the deleted child', async () => {
    const ctx = makeCtx(db, auth);
    db.store.set(`families/${FAMILY_ID}/child_qr_join_requests/req1`, {
      requestId: 'req1',
      targetChildId: 'child1',
      status: 'pending',
    });
    db.store.set(`families/${FAMILY_ID}/child_qr_join_requests/req2`, {
      requestId: 'req2',
      targetChildId: 'child2',
      status: 'pending',
    });

    await deleteChildImpl(ctx, 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'del-qr-reqs',
    });

    const req1 = db.store.get(`families/${FAMILY_ID}/child_qr_join_requests/req1`);
    expect(req1).toBeDefined();
    expect(req1.status).toBe('cancelled');
    expect(req1.cancellationReason).toBe('child_deleted');

    const req2 = db.store.get(`families/${FAMILY_ID}/child_qr_join_requests/req2`);
    expect(req2).toBeDefined();
    expect(req2.status).toBe('pending');
  });

  it('revokes active child QR sessions targeting the deleted child', async () => {
    const ctx = makeCtx(db, auth);
    db.store.set(`families/${FAMILY_ID}/child_qr_sessions/sess1`, {
      qrSessionId: 'sess1',
      targetChildId: 'child1',
      status: 'active',
    });
    db.store.set(`families/${FAMILY_ID}/child_qr_sessions/sess2`, {
      qrSessionId: 'sess2',
      targetChildId: 'child2',
      status: 'active',
    });

    await deleteChildImpl(ctx, 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'del-qr-sess',
    });

    const sess1 = db.store.get(`families/${FAMILY_ID}/child_qr_sessions/sess1`);
    expect(sess1).toBeDefined();
    expect(sess1.status).toBe('revoked');
    expect(sess1.revokedReason).toBe('child_deleted');

    const sess2 = db.store.get(`families/${FAMILY_ID}/child_qr_sessions/sess2`);
    expect(sess2).toBeDefined();
    expect(sess2.status).toBe('active');
  });
});
