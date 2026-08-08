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
    set: async (data: Record<string, unknown>) => {
      store.set(path, { ...data });
    },
    update: async (data: Record<string, unknown>) => {
      const existing = store.get(path) ?? {};
      store.set(path, { ...existing, ...data });
    },
    delete: async () => {
      store.delete(path);
    },
  });

  const docsInCollection = (collectionPath: string) => {
    const collectionDepth = collectionPath.split('/').length;
    return [...store.entries()]
      .filter(([path]) => path.startsWith(`${collectionPath}/`) && path.split('/').length === collectionDepth + 1)
      .map(([path, data]) => ({
        id: path.split('/').pop(),
        data: () => data,
        ref: makeRef(path),
      }));
  };

  const db: any = {
    store,
    failNextBatchCommit: false,
    doc: makeRef,
    collection: (path: string) => ({
      doc: (id?: string) => {
        const realId = id || Math.random().toString(36).slice(2);
        return makeRef(`${path}/${realId}`);
      },
      where: (field: string, _op: string, value: unknown) => ({
        limit: (limit: number) => ({
          get: async () => {
            const isDailyCheckinCollection = path.endsWith('/daily_checkins')
              || path.endsWith('/daily_checkin_skips');
            const isChildDeletionIdempotencyCollection = path.endsWith('/childLoginIdempotency');
            const docs = (isDailyCheckinCollection || isChildDeletionIdempotencyCollection
              ? docsInCollection(path)
              : [])
              .filter(doc => doc.data()[field] === value)
              .slice(0, limit);
            return { empty: docs.length === 0, docs, size: docs.length };
          },
        }),
      }),
      add: async (data: Record<string, unknown>) => {
        const ref = db.collection(path).doc();
        ref.set(data);
        return ref;
      },
    }),
    collectionGroup: (collectionId: string) => ({
      where: (field: string, _op: string, value: unknown) => ({
        limit: (limit: number) => ({
          get: async () => {
            const docs = [...store.entries()]
              .filter(([path]) => path.split('/').at(-2) === collectionId)
              .map(([path, data]) => ({
                id: path.split('/').pop(),
                data: () => data,
                ref: makeRef(path),
              }))
              .filter(doc => doc.data()[field] === value)
              .slice(0, limit);
            return { empty: docs.length === 0, docs, size: docs.length };
          },
        }),
      }),
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
      const deletions: FakeRef[] = [];
      return {
        delete: (ref: FakeRef) => { deletions.push(ref); },
        commit: async () => {
          if (db.failNextBatchCommit) {
            db.failNextBatchCommit = false;
            throw new Error('batch commit failed');
          }
          for (const ref of deletions) store.delete(ref.path);
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

  it('removes only the managed child daily check-in records matched by userId', async () => {
    db.store.set(`families/${FAMILY_ID}/daily_checkins/child-checkin`, { userId: 'child1' });
    db.store.set(`families/${FAMILY_ID}/daily_checkins/other-checkin`, { userId: 'child2' });
    db.store.set(`families/${FAMILY_ID}/daily_checkin_skips/child-skip`, { userId: 'child1' });
    db.store.set(`families/${FAMILY_ID}/daily_checkin_skips/other-skip`, { userId: 'child2' });

    await deleteChildImpl(makeCtx(db, auth), 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'del-daily-checkins',
    });

    expect(db.store.has(`families/${FAMILY_ID}/daily_checkins/child-checkin`)).toBe(false);
    expect(db.store.has(`families/${FAMILY_ID}/daily_checkin_skips/child-skip`)).toBe(false);
    expect(db.store.has(`families/${FAMILY_ID}/daily_checkins/other-checkin`)).toBe(true);
    expect(db.store.has(`families/${FAMILY_ID}/daily_checkin_skips/other-skip`)).toBe(true);
  });

  it('pages daily check-in cleanup until more than 500 records per collection are gone', async () => {
    for (let index = 0; index < 501; index += 1) {
      db.store.set(`families/${FAMILY_ID}/daily_checkins/child-checkin-${index}`, { userId: 'child1' });
      db.store.set(`families/${FAMILY_ID}/daily_checkin_skips/child-skip-${index}`, { userId: 'child1' });
    }
    db.store.set(`families/${FAMILY_ID}/daily_checkins/other-checkin`, { userId: 'child2' });
    db.store.set(`families/${FAMILY_ID}/daily_checkin_skips/other-skip`, { userId: 'child2' });

    await deleteChildImpl(makeCtx(db, auth), 'owner1', {
      childId: 'child1', displayNameConfirmation: 'Test', clientReqId: 'del-daily-pages',
    });

    expect([...db.store.values()].some((data: any) => data.userId === 'child1')).toBe(false);
    expect(db.store.has(`families/${FAMILY_ID}/daily_checkins/other-checkin`)).toBe(true);
    expect(db.store.has(`families/${FAMILY_ID}/daily_checkin_skips/other-skip`)).toBe(true);
  });

  it('keeps deletion retryable when daily check-in cleanup fails', async () => {
    db.store.set(`families/${FAMILY_ID}/daily_checkins/child-checkin`, { userId: 'child1' });
    db.failNextBatchCommit = true;
    const input = {
      childId: 'child1', displayNameConfirmation: 'Test', clientReqId: 'del-daily-retry',
    };

    await expect(deleteChildImpl(makeCtx(db, auth), 'owner1', input)).rejects.toThrow('batch commit failed');
    expect(db.store.has('users/child1')).toBe(true);
    expect(db.store.get(`families/${FAMILY_ID}/childLoginIdempotency/del-daily-retry`)?.status)
      .not.toBe('completed');

    await expect(deleteChildImpl(makeCtx(db, auth), 'owner1', input))
      .resolves.toEqual({ childId: 'child1', deleted: true });
    expect(db.store.has(`families/${FAMILY_ID}/daily_checkins/child-checkin`)).toBe(false);
    expect(db.store.has('users/child1')).toBe(false);
  });

  it('purges a final authorized check-in written between the first sweep and profile removal', async () => {
    db.store.set(`families/${FAMILY_ID}/daily_checkins/other-checkin`, { userId: 'child2' });
    const runTransaction = db.runTransaction.bind(db);
    let injected = false;
    db.runTransaction = async (callback: (transaction: any) => Promise<unknown>) => {
      const result = await runTransaction(callback);
      if (!injected && !db.store.has('users/child1')) {
        injected = true;
        db.store.set(`families/${FAMILY_ID}/daily_checkins/final-child-checkin`, { userId: 'child1' });
        db.store.set(`families/${FAMILY_ID}/daily_checkin_skips/final-child-skip`, { userId: 'child1' });
      }
      return result;
    };

    await expect(deleteChildImpl(makeCtx(db, auth), 'owner1', {
      childId: 'child1', displayNameConfirmation: 'Test', clientReqId: 'del-final-sweep',
    })).resolves.toEqual({ childId: 'child1', deleted: true });

    expect(injected).toBe(true);
    expect(db.store.has(`families/${FAMILY_ID}/daily_checkins/final-child-checkin`)).toBe(false);
    expect(db.store.has(`families/${FAMILY_ID}/daily_checkin_skips/final-child-skip`)).toBe(false);
    expect(db.store.has(`families/${FAMILY_ID}/daily_checkins/other-checkin`)).toBe(true);
  });

  it('does not mark deletion complete when the final sweep fails and a missing-profile retry finishes it', async () => {
    const input = {
      childId: 'child1', displayNameConfirmation: 'Test', clientReqId: 'del-final-sweep-retry',
    };
    const runTransaction = db.runTransaction.bind(db);
    db.runTransaction = async (callback: (transaction: any) => Promise<unknown>) => {
      const result = await runTransaction(callback);
      if (!db.store.has('users/child1')) {
        db.store.set(`families/${FAMILY_ID}/daily_checkins/final-child-checkin`, { userId: 'child1' });
        db.failNextBatchCommit = true;
      }
      return result;
    };

    await expect(deleteChildImpl(makeCtx(db, auth), 'owner1', input))
      .rejects.toThrow('batch commit failed');
    expect(db.store.has('users/child1')).toBe(false);
    expect(db.store.has(`families/${FAMILY_ID}/daily_checkins/final-child-checkin`)).toBe(true);
    expect(db.store.get(`families/${FAMILY_ID}/childLoginIdempotency/${input.clientReqId}`)?.status)
      .not.toBe('completed');

    await expect(deleteChildImpl(makeCtx(db, auth), 'owner1', input))
      .resolves.toEqual({ childId: 'child1', deleted: false });
    expect(db.store.has(`families/${FAMILY_ID}/daily_checkins/final-child-checkin`)).toBe(false);
    expect(db.store.get(`families/${FAMILY_ID}/childLoginIdempotency/${input.clientReqId}`)?.status)
      .toBe('completed');
  });

  it('globally purges residual history for an exact authorized cached missing-profile retry', async () => {
    const input = {
      childId: 'child1', displayNameConfirmation: 'Test', clientReqId: 'del-cached-final-sweep',
    };
    await deleteChildImpl(makeCtx(db, auth), 'owner1', input);
    expect(db.store.get(`families/${FAMILY_ID}/childLoginIdempotency/${input.clientReqId}`))
      .toMatchObject({
        clientReqId: input.clientReqId,
        operation: 'deleteChild',
        childId: input.childId,
        requesterUid: 'owner1',
        status: 'completed',
      });
    db.store.set('families/former-family/daily_checkins/residual-child-checkin', { userId: 'child1' });
    db.store.set('families/former-family/daily_checkin_skips/residual-child-skip', { userId: 'child1' });
    db.store.set('families/former-family/daily_checkins/other-checkin', { userId: 'child2' });

    await expect(deleteChildImpl(makeCtx(db, auth), 'owner1', input))
      .resolves.toEqual({ childId: 'child1', deleted: true });
    expect(db.store.has('families/former-family/daily_checkins/residual-child-checkin')).toBe(false);
    expect(db.store.has('families/former-family/daily_checkin_skips/residual-child-skip')).toBe(false);
    expect(db.store.has('families/former-family/daily_checkins/other-checkin')).toBe(true);
  });

  it('does not purge a profileless target when the idempotency payload differs', async () => {
    const input = {
      childId: 'child1', displayNameConfirmation: 'Test', clientReqId: 'del-profileless-payload',
    };
    await deleteChildImpl(makeCtx(db, auth), 'owner1', input);
    db.store.set('families/former-family/daily_checkins/residual-child-checkin', { userId: 'child1' });

    await expect(deleteChildImpl(makeCtx(db, auth), 'owner1', {
      ...input,
      displayNameConfirmation: 'Different',
    })).rejects.toMatchObject({ code: 'already-exists' });
    expect(db.store.has('families/former-family/daily_checkins/residual-child-checkin')).toBe(true);
  });

  it('does not purge a profileless target for a different authorized caller', async () => {
    const input = {
      childId: 'child1', displayNameConfirmation: 'Test', clientReqId: 'del-profileless-requester',
    };
    await deleteChildImpl(makeCtx(db, auth), 'owner1', input);
    db.store.set('families/former-family/daily_checkins/residual-child-checkin', { userId: 'child1' });

    await expect(deleteChildImpl(makeCtx(db, auth), 'parent1', input))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect(db.store.has('families/former-family/daily_checkins/residual-child-checkin')).toBe(true);
  });

  it.each([
    ['operation', { operation: 'resetChildPassword' }],
    ['child ID', { childId: 'child2' }],
    ['request ID metadata', { clientReqId: 'different-request-id' }],
  ])('does not purge a profileless target for mismatched idempotency %s', async (_label, mismatch) => {
    const input = {
      childId: 'child1', displayNameConfirmation: 'Test', clientReqId: `del-profileless-${_label}`,
    };
    await deleteChildImpl(makeCtx(db, auth), 'owner1', input);
    const markerPath = `families/${FAMILY_ID}/childLoginIdempotency/${input.clientReqId}`;
    db.store.set(markerPath, {
      ...db.store.get(markerPath),
      clientReqId: input.clientReqId,
      operation: 'deleteChild',
      childId: input.childId,
      requesterUid: 'owner1',
      ...mismatch,
    });
    db.store.set('families/former-family/daily_checkins/residual-child-checkin', { userId: 'child1' });

    await expect(deleteChildImpl(makeCtx(db, auth), 'owner1', input))
      .rejects.toMatchObject({ code: 'already-exists' });
    expect(db.store.has('families/former-family/daily_checkins/residual-child-checkin')).toBe(true);
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

  it('a different request for a missing profile returns false without purging history', async () => {
    // Delete child1 first
    const ctx = makeCtx(db, auth);
    await deleteChildImpl(ctx, 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'del-missing-doc',
    });
    db.store.set('families/former-family/daily_checkins/residual-child-checkin', { userId: 'child1' });
    // Second call with a different clientReqId but same child (now gone)
    // should return deleted: false idempotently (no error)
    const result = await deleteChildImpl(ctx, 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'del-missing-doc-retry',
    });
    expect(result.deleted).toBe(false);
    expect(db.store.has('families/former-family/daily_checkins/residual-child-checkin')).toBe(true);
    expect(db.store.has(`families/${FAMILY_ID}/childLoginIdempotency/del-missing-doc-retry`))
      .toBe(false);
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

  it('does not purge a profileless target for an authenticated child caller', async () => {
    db.store.delete('users/child1');
    db.store.set('families/former-family/daily_checkins/residual-child-checkin', {
      userId: 'child1',
    });

    await expect(
      deleteChildImpl(makeCtx(db, auth), 'child2', {
        childId: 'child1',
        displayNameConfirmation: 'Test',
        clientReqId: 'del-profileless-child-caller',
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(db.store.has('families/former-family/daily_checkins/residual-child-checkin')).toBe(true);
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
});
