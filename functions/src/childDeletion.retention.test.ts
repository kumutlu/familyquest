// ---------------------------------------------------------------------------
// CHILD DELETION — WALLET REMOVAL & AUDIT RETENTION (P1 data-integrity)
// ---------------------------------------------------------------------------
// Covers the two confirmed defects:
//   1. families/{familyId}/wallets/{childId} was orphaned because it is
//      uid-keyed and carries no childId field.
//   2. Phase-4 cleanup deleted every childLoginAudit document with a
//      matching childId, erasing the child_deleted evidence it had just
//      written.
//
// Retention policy asserted here:
//   DELETED   : users/{childId}, childLogins/{childId},
//               childLoginIndex/{username}, wallets/{childId},
//               childId-tagged operational documents.
//   RETAINED  : ALL families/{familyId}/childLoginAudit documents,
//               including the final child_deleted record.
//   RETAINED  : families/{familyId}/childLoginIdempotency/{clientReqId}
//               receipts (replay safety / recovery evidence).
// ---------------------------------------------------------------------------

import { createHash } from 'crypto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({}),
  FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
}));
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({}),
}));

import { deleteChildImpl, type ChildDeletionContext } from './childDeletion';

const FAMILY_ID = 'F1';

// ---------------------------------------------------------------------------
// Query-capable in-memory Firestore mock
// ---------------------------------------------------------------------------

function makeQueryDb() {
  const store = new Map<string, Record<string, unknown>>();
  let autoId = 0;

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
      const existing = store.get(path);
      if (existing === undefined) throw new Error('NOT_FOUND');
      store.set(path, { ...existing, ...data });
    },
    delete: async () => {
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
      doc: (id?: string) => makeRef(`${path}/${id ?? `auto-${++autoId}`}`),
      where: (field: string, _op: string, value: unknown) => ({
        limit: (n: number) => ({
          get: async () => {
            const docs = queryDocs(path, field, value).slice(0, n);
            return { docs, empty: docs.length === 0, size: docs.length };
          },
        }),
        get: async () => {
          const docs = queryDocs(path, field, value);
          return { docs, empty: docs.length === 0, size: docs.length };
        },
      }),
    }),
    collectionGroup: (collectionId: string) => ({
      where: (field: string, _op: string, value: unknown) => ({
        limit: (n: number) => ({
          get: async () => {
            const docs = [...store.entries()]
              .filter(([path]) => path.split('/').at(-2) === collectionId)
              .map(([path, data]) => ({
                id: path.split('/').pop(),
                data: () => data,
                ref: makeRef(path),
              }))
              .filter(doc => doc.data()[field] === value)
              .slice(0, n);
            return { docs, empty: docs.length === 0, size: docs.length };
          },
        }),
      }),
    }),
    runTransaction: async (cb: (tx: any) => Promise<any>) => {
      const writes: Array<[string, any, Record<string, unknown>]> = [];
      const tx = {
        get: async (ref: any) => {
          const data = store.get(ref.path);
          return { exists: data !== undefined, data: () => data, id: ref.id };
        },
        set: (ref: any, data: Record<string, unknown>) => writes.push(['set', ref, data]),
        update: (ref: any, data: Record<string, unknown>) => writes.push(['update', ref, data]),
        delete: (ref: any) => writes.push(['delete', ref, {}]),
      };
      const result = await cb(tx);
      for (const [op, ref, data] of writes) {
        if (op === 'set') store.set(ref.path, { ...data });
        else if (op === 'update') store.set(ref.path, { ...(store.get(ref.path) ?? {}), ...data });
        else store.delete(ref.path);
      }
      return result;
    },
    batch: () => {
      const ops: any[] = [];
      return {
        delete: (ref: any) => ops.push(ref),
        commit: async () => {
          for (const ref of ops.splice(0)) store.delete(ref.path);
        },
      };
    },
  };
  return db;
}

function makeFakeAuth() {
  const deleted: string[] = [];
  const revoked: string[] = [];
  return {
    deleted,
    revoked,
    deleteUser: async (uid: string) => {
      deleted.push(uid);
    },
    updateUser: async () => ({}),
    revokeRefreshTokens: async (uid: string) => {
      revoked.push(uid);
    },
  } as any;
}

function makeCtx(db: any, auth: any): ChildDeletionContext {
  return { db, auth };
}

function seedWorld(db: any, opts: { wallet?: number | null; history?: boolean } = {}) {
  const { wallet = 0, history = true } = opts;
  db.store.set(`families/${FAMILY_ID}`, { name: 'Test Family' });
  db.store.set('users/owner1', { familyId: FAMILY_ID, role: 'owner', displayName: 'Owner' });
  db.store.set('users/child1', {
    familyId: FAMILY_ID,
    role: 'child',
    isManaged: true,
    displayName: 'Test',
    authUid: 'auth-child1',
  });
  db.store.set('users/child2', {
    familyId: FAMILY_ID,
    role: 'child',
    isManaged: true,
    displayName: 'Bea',
    authUid: 'auth-child2',
  });
  db.store.set(`families/${FAMILY_ID}/childLogins/child1`, { childId: 'child1', username: 'test' });
  db.store.set(`families/${FAMILY_ID}/childLoginIndex/test`, { childId: 'child1' });
  db.store.set(`families/${FAMILY_ID}/childLogins/child2`, { childId: 'child2', username: 'bea' });
  db.store.set(`families/${FAMILY_ID}/childLoginIndex/bea`, { childId: 'child2' });
  // uid-keyed wallets, no childId field (this is the defect-1 shape)
  if (wallet !== null) {
    db.store.set(`families/${FAMILY_ID}/wallets/child1`, { balance: wallet, currency: 'GBP' });
  }
  db.store.set(`families/${FAMILY_ID}/wallets/child2`, { balance: 500, currency: 'GBP' });
  if (history) {
    db.store.set(`families/${FAMILY_ID}/childLoginAudit/a1`, {
      type: 'child_login_success',
      childId: 'child1',
    });
    db.store.set(`families/${FAMILY_ID}/childLoginAudit/a2`, {
      type: 'child_password_reset',
      childId: 'child1',
    });
  }
  // Operational doc that MUST be deleted (childId-tagged)
  db.store.set(`families/${FAMILY_ID}/wallet_transactions/t1`, { childId: 'child1', amount: 10 });
}

function auditDocs(db: any, childId?: string) {
  const out: Record<string, unknown>[] = [];
  for (const [path, data] of db.store.entries()) {
    if (!path.startsWith(`families/${FAMILY_ID}/childLoginAudit/`)) continue;
    if (childId && (data as any).childId !== childId) continue;
    out.push(data as Record<string, unknown>);
  }
  return out;
}

// ---------------------------------------------------------------------------

describe('deleteChild — wallet removal', () => {
  let db: any;
  let auth: any;
  beforeEach(() => {
    db = makeQueryDb();
    auth = makeFakeAuth();
  });

  it('deletes the uid-keyed zero-balance wallet', async () => {
    seedWorld(db, { wallet: 0 });
    await deleteChildImpl(makeCtx(db, auth), 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'w-zero',
    });
    expect(db.store.has(`families/${FAMILY_ID}/wallets/child1`)).toBe(false);
  });

  it('deletes a uid-keyed non-zero wallet and records the final balance in the audit', async () => {
    seedWorld(db, { wallet: 1234 });
    await deleteChildImpl(makeCtx(db, auth), 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'w-nonzero',
    });
    expect(db.store.has(`families/${FAMILY_ID}/wallets/child1`)).toBe(false);
    const deletionAudit = auditDocs(db).find((d) => d.type === 'child_deleted');
    expect(deletionAudit).toBeDefined();
    expect(deletionAudit?.walletBalanceAtDeletion).toBe(1234);
  });

  it('succeeds when the wallet document is missing', async () => {
    seedWorld(db, { wallet: null });
    const res = await deleteChildImpl(makeCtx(db, auth), 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'w-missing',
    });
    expect(res.deleted).toBe(true);
  });

  it("leaves the sibling's wallet, login and profile untouched", async () => {
    seedWorld(db, { wallet: 0 });
    await deleteChildImpl(makeCtx(db, auth), 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'w-sibling',
    });
    expect(db.store.has(`families/${FAMILY_ID}/wallets/child2`)).toBe(true);
    expect(db.store.has(`families/${FAMILY_ID}/childLogins/child2`)).toBe(true);
    expect(db.store.has(`families/${FAMILY_ID}/childLoginIndex/bea`)).toBe(true);
    expect(db.store.has('users/child2')).toBe(true);
  });
});

describe('deleteChild — audit retention', () => {
  let db: any;
  let auth: any;
  beforeEach(() => {
    db = makeQueryDb();
    auth = makeFakeAuth();
  });

  it('preserves the final child_deleted audit record', async () => {
    seedWorld(db);
    await deleteChildImpl(makeCtx(db, auth), 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'a-final',
    });
    const deletions = auditDocs(db).filter((d) => d.type === 'child_deleted');
    expect(deletions).toHaveLength(1);
    expect(deletions[0].childId).toBe('child1');
  });

  it('retains historical security audit records for the deleted child', async () => {
    seedWorld(db);
    await deleteChildImpl(makeCtx(db, auth), 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'a-history',
    });
    const types = auditDocs(db, 'child1').map((d) => d.type).sort();
    expect(types).toEqual(['child_deleted', 'child_login_success', 'child_password_reset']);
  });

  it('still deletes childId-tagged operational data', async () => {
    seedWorld(db);
    await deleteChildImpl(makeCtx(db, auth), 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'a-ops',
    });
    expect(db.store.has(`families/${FAMILY_ID}/wallet_transactions/t1`)).toBe(false);
  });

  it('succeeds when no historical audit records exist', async () => {
    seedWorld(db, { history: false });
    const res = await deleteChildImpl(makeCtx(db, auth), 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'a-none',
    });
    expect(res.deleted).toBe(true);
    expect(auditDocs(db).filter((d) => d.type === 'child_deleted')).toHaveLength(1);
  });

  it('keeps the idempotency receipt after completion', async () => {
    seedWorld(db);
    await deleteChildImpl(makeCtx(db, auth), 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'a-receipt',
    });
    const receipt = db.store.get(`families/${FAMILY_ID}/childLoginIdempotency/a-receipt`);
    expect(receipt).toBeDefined();
    expect(receipt.status).toBe('completed');
  });

  it('repeated deleteChild is idempotent and does not duplicate or erase audit evidence', async () => {
    seedWorld(db);
    const first = await deleteChildImpl(makeCtx(db, auth), 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'a-idem',
    });
    const second = await deleteChildImpl(makeCtx(db, auth), 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'a-idem',
    });
    expect(second).toEqual(first);
    expect(auditDocs(db).filter((d) => d.type === 'child_deleted')).toHaveLength(1);
    expect(db.store.get(`families/${FAMILY_ID}/childLoginIdempotency/a-idem`)).toBeDefined();
  });

  it('retry after partial completion preserves a single deletion audit record', async () => {
    seedWorld(db);
    // Simulate a partially completed prior attempt: profile + wallet already
    // gone, idempotency marker left in "processing".
    db.store.delete(`families/${FAMILY_ID}/wallets/child1`);
    db.store.set(`families/${FAMILY_ID}/childLoginIdempotency/a-retry`, {
      clientReqId: 'a-retry',
      operation: 'deleteChild',
      childId: 'child1',
      status: 'processing',
      payloadHash: createHash('sha256').update('child1|Test').digest('hex'),
    });
    const res = await deleteChildImpl(makeCtx(db, auth), 'owner1', {
      childId: 'child1',
      displayNameConfirmation: 'Test',
      clientReqId: 'a-retry',
    });
    expect(res.deleted).toBe(true);
    expect(auditDocs(db).filter((d) => d.type === 'child_deleted')).toHaveLength(1);
    expect(auditDocs(db, 'child1').length).toBe(3);
  });
});
