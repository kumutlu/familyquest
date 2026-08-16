// ---------------------------------------------------------------------------
// MEMBER LIFECYCLE — FOCUSED FUNCTIONS TESTS
// ---------------------------------------------------------------------------
// Exercises the server-authoritative lifecycle operations (archive, restore,
// removeFromFamily, changeMemberRole, transferOwnership) against an in-memory
// Firestore mock. Covers the authorization matrix and the historical-data
// integrity guarantees required by the family-member-lifecycle spec. No
// emulators, no production data.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({}),
  FieldValue: {
    serverTimestamp: () => ({ __serverTimestamp: true }),
    delete: () => ({ __delete: true }),
  },
}));
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({}),
}));

import {
  archiveMemberImpl,
  restoreMemberImpl,
  removeMemberFromFamilyImpl,
  changeMemberRoleImpl,
  transferOwnershipImpl,
  type MemberLifecycleContext,
} from './memberLifecycle';

// ---------------------------------------------------------------------------
// In-memory Firestore mock (mirrors childDeletion.test.ts harness)
// ---------------------------------------------------------------------------

const SERVER_TS = { __serverTimestamp: true };
const DELETE = { __delete: true };

interface FakeRef {
  path: string;
  id: string;
}

// Merge `data` into `base`, honouring FieldValue.delete() sentinels (which remove
// the key, mirroring real Firestore behaviour).
function mergeWithDeletes(base: Record<string, unknown>, data: Record<string, unknown>): Record<string, unknown> {
  const next = { ...base };
  for (const [key, value] of Object.entries(data)) {
    if (value && (value as any).__delete === true) delete next[key];
    else next[key] = value;
  }
  return next;
}

function makeFakeDb() {
  const store = new Map<string, Record<string, unknown>>();

  const makeRef = (path: string): any => ({
    path,
    id: path.split('/').pop() as string,
    get: async () => {
      const data = store.get(path);
      return { exists: data !== undefined, data: () => data, id: path.split('/').pop() };
    },
    set: (data: Record<string, unknown>) => {
      store.set(path, mergeWithDeletes({}, data));
    },
    update: (data: Record<string, unknown>) => {
      const existing = store.get(path) ?? {};
      store.set(path, mergeWithDeletes(existing, data));
    },
    delete: () => {
      store.delete(path);
    },
  });

  const db: any = {
    store,
    doc: makeRef,
    collection: (path: string) => ({
      doc: (id?: string) => {
        const realId = id || Math.random().toString(36).slice(2);
        return makeRef(`${path}/${realId}`);
      },
      where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [], size: 0 }) }) }),
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
        set: (ref: FakeRef, data: Record<string, unknown>) => writes.push(['set', ref, data]),
        update: (ref: FakeRef, data: Record<string, unknown>) => writes.push(['update', ref, data]),
        delete: (ref: FakeRef) => writes.push(['delete', ref, {} as Record<string, unknown>]),
      };
      const result = await cb(tx);
      for (const [op, ref, data] of writes) {
        if (op === 'set') store.set(ref.path, mergeWithDeletes({}, data));
        else if (op === 'update') {
          const existing = store.get(ref.path) ?? {};
          store.set(ref.path, mergeWithDeletes(existing, data));
        } else if (op === 'delete') store.delete(ref.path);
      }
      return result;
    },
    batch: () => ({ delete: () => {}, commit: async () => {} }),
  };
  return db as any;
}

function seedUser(db: any, uid: string, fields: Record<string, unknown>) {
  db.store.set(`users/${uid}`, fields);
}
function makeCtx(db: any): MemberLifecycleContext {
  return { db };
}

const FAMILY_ID = 'F1';

function seedStandardFamily(db: any) {
  db.store.set(`families/${FAMILY_ID}`, { inviteCode: 'ABC123', name: 'Test Family' });
  seedUser(db, 'owner1', { familyId: FAMILY_ID, role: 'owner', displayName: 'Owner' });
  seedUser(db, 'parent1', { familyId: FAMILY_ID, role: 'parent', displayName: 'Parent' });
  seedUser(db, 'adult1', { familyId: FAMILY_ID, role: 'adult', displayName: 'Adult' });
  seedUser(db, 'child1', {
    familyId: FAMILY_ID, role: 'child', isManaged: true, displayName: 'Managed Child',
  });
  seedUser(db, 'childSelf', {
    familyId: FAMILY_ID, role: 'child', isManaged: false, displayName: 'Self Child',
  });
  // Historical data that must survive every lifecycle operation.
  db.store.set(`families/${FAMILY_ID}/task_completions/tc1`, {
    id: 'tc1', taskId: 't1', assigneeId: 'child1', status: 'approved',
  });
  db.store.set(`families/${FAMILY_ID}/wallet_transactions/wt1`, {
    id: 'wt1', childId: 'child1', amountPence: 100,
  });
  db.store.set(`families/${FAMILY_ID}/gamification_events/ge1`, {
    id: 'ge1', actorId: 'child1', xp: 10,
  });
}

const REQ = 'req-1';

// ---------------------------------------------------------------------------
// ARCHIVE
// ---------------------------------------------------------------------------

describe('archiveMember — authorization', () => {
  let db: any;
  beforeEach(() => { db = makeFakeDb(); seedStandardFamily(db); });

  it('owner can archive a child', async () => {
    const r = await archiveMemberImpl(makeCtx(db), 'owner1', { targetUid: 'child1', clientReqId: REQ });
    expect(r.lifecycle).toBe('archived');
    expect(db.store.get('users/child1').lifecycle).toBe('archived');
    expect(db.store.get('users/child1').familyId).toBe(FAMILY_ID); // still in family
  });

  it('owner can archive a parent/adult', async () => {
    const r = await archiveMemberImpl(makeCtx(db), 'owner1', { targetUid: 'parent1', clientReqId: REQ });
    expect(r.lifecycle).toBe('archived');
  });

  it('parent can archive a child', async () => {
    const r = await archiveMemberImpl(makeCtx(db), 'parent1', { targetUid: 'child1', clientReqId: REQ });
    expect(r.lifecycle).toBe('archived');
  });

  it('parent CANNOT archive a parent/adult (NOT_AUTHORIZED)', async () => {
    await expect(
      archiveMemberImpl(makeCtx(db), 'parent1', { targetUid: 'adult1', clientReqId: REQ }),
    ).rejects.toThrowError(/NOT_AUTHORIZED/);
  });

  it('child caller is denied (NOT_AUTHORIZED)', async () => {
    await expect(
      archiveMemberImpl(makeCtx(db), 'child1', { targetUid: 'childSelf', clientReqId: REQ }),
    ).rejects.toThrowError(/NOT_AUTHORIZED/);
  });

  it('cannot archive self (CANNOT_ARCHIVE_SELF)', async () => {
    await expect(
      archiveMemberImpl(makeCtx(db), 'owner1', { targetUid: 'owner1', clientReqId: REQ }),
    ).rejects.toThrowError(/CANNOT_ARCHIVE_SELF/);
  });

  it('cannot archive the owner (CANNOT_ARCHIVE_OWNER)', async () => {
    seedUser(db, 'owner2', { familyId: FAMILY_ID, role: 'owner', displayName: 'O2' });
    await expect(
      archiveMemberImpl(makeCtx(db), 'owner1', { targetUid: 'owner2', clientReqId: REQ }),
    ).rejects.toThrowError(/CANNOT_ARCHIVE_OWNER/);
  });

  it('target not in family (TARGET_NOT_IN_FAMILY)', async () => {
    seedUser(db, 'other', { familyId: 'OTHER', role: 'adult', displayName: 'X' });
    await expect(
      archiveMemberImpl(makeCtx(db), 'owner1', { targetUid: 'other', clientReqId: REQ }),
    ).rejects.toThrowError(/TARGET_NOT_IN_FAMILY/);
  });

  it('idempotent: archiving an already-archived member is not an error', async () => {
    await archiveMemberImpl(makeCtx(db), 'owner1', { targetUid: 'child1', clientReqId: REQ });
    const r = await archiveMemberImpl(makeCtx(db), 'owner1', { targetUid: 'child1', clientReqId: REQ });
    expect(r.lifecycle).toBe('archived');
  });

  it('history is preserved (no deletion of task/wallet/gamification data)', async () => {
    await archiveMemberImpl(makeCtx(db), 'owner1', { targetUid: 'child1', clientReqId: REQ });
    expect(db.store.has(`families/${FAMILY_ID}/task_completions/tc1`)).toBe(true);
    expect(db.store.has(`families/${FAMILY_ID}/wallet_transactions/wt1`)).toBe(true);
    expect(db.store.has(`families/${FAMILY_ID}/gamification_events/ge1`)).toBe(true);
    expect(db.store.has('users/child1')).toBe(true); // account preserved
  });
});

// ---------------------------------------------------------------------------
// RESTORE
// ---------------------------------------------------------------------------

describe('restoreMember — authorization', () => {
  let db: any;
  beforeEach(() => { db = makeFakeDb(); seedStandardFamily(db); });

  it('owner can restore an archived child', async () => {
    await archiveMemberImpl(makeCtx(db), 'owner1', { targetUid: 'child1', clientReqId: REQ });
    const r = await restoreMemberImpl(makeCtx(db), 'owner1', { targetUid: 'child1', clientReqId: REQ });
    expect(r.lifecycle).toBe('active');
    expect(db.store.get('users/child1').lifecycle).toBe('active');
    expect(db.store.get('users/child1').archivedAt).toBeUndefined();
  });

  it('parent can restore an archived child', async () => {
    await archiveMemberImpl(makeCtx(db), 'owner1', { targetUid: 'child1', clientReqId: REQ });
    const r = await restoreMemberImpl(makeCtx(db), 'parent1', { targetUid: 'child1', clientReqId: REQ });
    expect(r.lifecycle).toBe('active');
  });

  it('parent CANNOT restore a non-child (NOT_AUTHORIZED)', async () => {
    await archiveMemberImpl(makeCtx(db), 'owner1', { targetUid: 'adult1', clientReqId: REQ });
    await expect(
      restoreMemberImpl(makeCtx(db), 'parent1', { targetUid: 'adult1', clientReqId: REQ }),
    ).rejects.toThrowError(/NOT_AUTHORIZED/);
  });

  it('cannot restore the owner', async () => {
    await expect(
      restoreMemberImpl(makeCtx(db), 'owner1', { targetUid: 'owner1', clientReqId: REQ }),
    ).rejects.toThrowError(/CANNOT_RESTORE_OWNER/);
  });
});

// ---------------------------------------------------------------------------
// REMOVE FROM FAMILY
// ---------------------------------------------------------------------------

describe('removeMemberFromFamily — authorization + integrity', () => {
  let db: any;
  beforeEach(() => { db = makeFakeDb(); seedStandardFamily(db); });

  it('owner can remove a parent/adult; account survives', async () => {
    const r = await removeMemberFromFamilyImpl(makeCtx(db), 'owner1', { targetUid: 'adult1', clientReqId: REQ });
    expect(r.lifecycle).toBe('removed');
    const doc = db.store.get('users/adult1');
    expect(doc).toBeDefined(); // account preserved
    expect(doc.familyId).toBeUndefined(); // membership terminated
    expect(doc.lifecycle).toBe('removed');
    expect(doc.displayName).toBe('Adult'); // identity preserved
  });

  it('owner cannot remove self (CANNOT_REMOVE_SELF)', async () => {
    await expect(
      removeMemberFromFamilyImpl(makeCtx(db), 'owner1', { targetUid: 'owner1', clientReqId: REQ }),
    ).rejects.toThrowError(/CANNOT_REMOVE_SELF/);
  });

  it('owner cannot remove the owner (CANNOT_REMOVE_OWNER)', async () => {
    seedUser(db, 'owner2', { familyId: FAMILY_ID, role: 'owner', displayName: 'O2' });
    await expect(
      removeMemberFromFamilyImpl(makeCtx(db), 'owner1', { targetUid: 'owner2', clientReqId: REQ }),
    ).rejects.toThrowError(/CANNOT_REMOVE_OWNER/);
  });

  it('non-owner is denied (NOT_AUTHORIZED)', async () => {
    await expect(
      removeMemberFromFamilyImpl(makeCtx(db), 'parent1', { targetUid: 'adult1', clientReqId: REQ }),
    ).rejects.toThrowError(/NOT_AUTHORIZED/);
  });

  it('owner cannot remove a managed child (CHILD_REMOVE_NOT_SUPPORTED)', async () => {
    await expect(
      removeMemberFromFamilyImpl(makeCtx(db), 'owner1', { targetUid: 'child1', clientReqId: REQ }),
    ).rejects.toThrowError(/CHILD_REMOVE_NOT_SUPPORTED/);
  });

  it('owner cannot remove a self-registered child (CHILD_REMOVE_NOT_SUPPORTED)', async () => {
    await expect(
      removeMemberFromFamilyImpl(makeCtx(db), 'owner1', { targetUid: 'childSelf', clientReqId: REQ }),
    ).rejects.toThrowError(/CHILD_REMOVE_NOT_SUPPORTED/);
  });

  it('parent cannot remove a child (remove is owner-only: NOT_AUTHORIZED)', async () => {
    await expect(
      removeMemberFromFamilyImpl(makeCtx(db), 'parent1', { targetUid: 'child1', clientReqId: REQ }),
    ).rejects.toThrowError(/NOT_AUTHORIZED/);
  });

  it('history is preserved and former-family identity projection retained', async () => {
    await removeMemberFromFamilyImpl(makeCtx(db), 'owner1', { targetUid: 'adult1', clientReqId: REQ });
    expect(db.store.has(`families/${FAMILY_ID}/task_completions/tc1`)).toBe(true);
    expect(db.store.has(`families/${FAMILY_ID}/wallet_transactions/wt1`)).toBe(true);
    const proj = db.store.get(`families/${FAMILY_ID}/users/adult1`);
    expect(proj).toBeDefined();
    expect(proj.lifecycle).toBe('removed');
    expect(proj.displayName).toBe('Adult');
  });
});

// ---------------------------------------------------------------------------
// CHANGE ROLE
// ---------------------------------------------------------------------------

describe('changeMemberRole — authorization', () => {
  let db: any;
  beforeEach(() => { db = makeFakeDb(); seedStandardFamily(db); });

  it('owner can promote adult -> parent', async () => {
    const r = await changeMemberRoleImpl(makeCtx(db), 'owner1', { targetUid: 'adult1', newRole: 'parent', clientReqId: REQ });
    expect(r.role).toBe('parent');
    expect(db.store.get('users/adult1').role).toBe('parent');
  });

  it('owner can demote parent -> adult', async () => {
    const r = await changeMemberRoleImpl(makeCtx(db), 'owner1', { targetUid: 'parent1', newRole: 'adult', clientReqId: REQ });
    expect(r.role).toBe('adult');
  });

  it('owner cannot change own role (CANNOT_CHANGE_OWN_ROLE)', async () => {
    await expect(
      changeMemberRoleImpl(makeCtx(db), 'owner1', { targetUid: 'owner1', newRole: 'adult', clientReqId: REQ }),
    ).rejects.toThrowError(/CANNOT_CHANGE_OWN_ROLE/);
  });

  it('owner cannot change the owner (CANNOT_CHANGE_OWNER)', async () => {
    seedUser(db, 'owner2', { familyId: FAMILY_ID, role: 'owner', displayName: 'O2' });
    await expect(
      changeMemberRoleImpl(makeCtx(db), 'owner1', { targetUid: 'owner2', newRole: 'adult', clientReqId: REQ }),
    ).rejects.toThrowError(/CANNOT_CHANGE_OWNER/);
  });

  it('owner cannot change a child role (CANNOT_CHANGE_CHILD)', async () => {
    await expect(
      changeMemberRoleImpl(makeCtx(db), 'owner1', { targetUid: 'child1', newRole: 'adult', clientReqId: REQ }),
    ).rejects.toThrowError(/CANNOT_CHANGE_CHILD/);
  });

  it('invalid role rejected (INVALID_ROLE)', async () => {
    await expect(
      changeMemberRoleImpl(makeCtx(db), 'owner1', { targetUid: 'adult1', newRole: 'owner' as any, clientReqId: REQ }),
    ).rejects.toThrowError(/INVALID_ROLE/);
  });

  it('non-owner is denied (NOT_AUTHORIZED)', async () => {
    await expect(
      changeMemberRoleImpl(makeCtx(db), 'parent1', { targetUid: 'adult1', newRole: 'parent', clientReqId: REQ }),
    ).rejects.toThrowError(/NOT_AUTHORIZED/);
  });
});

// ---------------------------------------------------------------------------
// TRANSFER OWNERSHIP
// ---------------------------------------------------------------------------

describe('transferOwnership — authorization + no-ownerless', () => {
  let db: any;
  beforeEach(() => { db = makeFakeDb(); seedStandardFamily(db); });

  it('owner can transfer to an eligible parent', async () => {
    const r = await transferOwnershipImpl(makeCtx(db), 'owner1', { targetUid: 'parent1', clientReqId: REQ });
    expect(r.targetUid).toBe('parent1');
    expect(db.store.get('users/parent1').role).toBe('owner');
    expect(db.store.get('users/owner1').role).toBe('parent'); // old owner demoted, not ownerless
  });

  it('owner can transfer to an eligible adult', async () => {
    const r = await transferOwnershipImpl(makeCtx(db), 'owner1', { targetUid: 'adult1', clientReqId: REQ });
    expect(db.store.get('users/adult1').role).toBe('owner');
    expect(db.store.get('users/owner1').role).toBe('parent');
  });

  it('cannot transfer to a child (TARGET_NOT_ELIGIBLE)', async () => {
    await expect(
      transferOwnershipImpl(makeCtx(db), 'owner1', { targetUid: 'child1', clientReqId: REQ }),
    ).rejects.toThrowError(/TARGET_NOT_ELIGIBLE/);
  });

  it('cannot transfer to self (ALREADY_OWNER)', async () => {
    await expect(
      transferOwnershipImpl(makeCtx(db), 'owner1', { targetUid: 'owner1', clientReqId: REQ }),
    ).rejects.toThrowError(/ALREADY_OWNER/);
  });

  it('non-owner is denied (NOT_AUTHORIZED)', async () => {
    await expect(
      transferOwnershipImpl(makeCtx(db), 'parent1', { targetUid: 'adult1', clientReqId: REQ }),
    ).rejects.toThrowError(/NOT_AUTHORIZED/);
  });
});
