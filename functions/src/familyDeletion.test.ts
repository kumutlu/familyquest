// ---------------------------------------------------------------------------
// FAMILY DELETION — deleteFamily freeze callable tests (commit 3 scope)
// ---------------------------------------------------------------------------
// Exercises deleteFamilyImpl / getFamilyDeletionStatusImpl against an
// in-memory Firestore mock (same pattern as childDeletion.test.ts).
// Covers: atomic freeze + job creation, exact case-sensitive name
// confirmation, authorization, duplicate/idempotent requests, clientReqId
// conflicts, failed-job requeue, receipt recognition, sanitized status.
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
vi.mock('firebase-admin/functions', () => ({
  getFunctions: () => ({
    taskQueue: () => ({ enqueue: async () => undefined }),
  }),
}));

import {
  deleteFamilyImpl,
  getFamilyDeletionStatusImpl,
  FAMILY_SUBCOLLECTION_REGISTRY,
  FAMILY_NESTED_SUBCOLLECTIONS,
  DELETION_PHASES,
  type FamilyDeletionContext,
  type FamilyDeletionJob,
} from './familyDeletion';

// ---------------------------------------------------------------------------
// In-memory Firestore mock
// ---------------------------------------------------------------------------

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

  const db: any = {
    store,
    doc: makeRef,
    collection: (path: string) => ({
      doc: (id?: string) => makeRef(`${path}/${id || Math.random().toString(36).slice(2)}`),
      where: () => ({
        limit: () => ({ get: async () => ({ empty: true, docs: [], size: 0 }) }),
      }),
      limit: () => ({ get: async () => ({ empty: true, docs: [], size: 0 }) }),
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
          writes.push(['delete', ref, {}]);
        },
      };
      const result = await cb(tx);
      for (const [op, ref, data] of writes) {
        if (op === 'set') store.set(ref.path, { ...data });
        else if (op === 'update') {
          const existing = store.get(ref.path) ?? {};
          store.set(ref.path, { ...existing, ...data });
        } else store.delete(ref.path);
      }
      return result;
    },
  };
  return db as any;
}

// ---------------------------------------------------------------------------
// Test world
// ---------------------------------------------------------------------------

const FAMILY_ID = 'fam-delete-1';
const FAMILY_NAME = 'The Smith Family';
const OWNER = 'owner-uid';
const REQ_ID = 'client-req-00000001';

function makeCtx(db: any): FamilyDeletionContext & { enqueued: string[] } {
  const enqueued: string[] = [];
  return {
    db,
    auth: {},
    enqueue: async (familyId: string) => { enqueued.push(familyId); },
    now: () => 1_000_000,
    invocationId: 'test-invocation',
    enqueued,
  };
}

function seedFamily(db: any) {
  db.store.set(`families/${FAMILY_ID}`, { name: FAMILY_NAME, inviteCode: 'ABC123' });
  db.store.set(`users/${OWNER}`, { familyId: FAMILY_ID, role: 'owner' });
  db.store.set('users/parent-uid', { familyId: FAMILY_ID, role: 'parent' });
  db.store.set('users/child-uid', { familyId: FAMILY_ID, role: 'child' });
  db.store.set('users/outsider-uid', { familyId: 'other-family', role: 'owner' });
}

function validInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    familyId: FAMILY_ID,
    familyNameConfirmation: FAMILY_NAME,
    clientReqId: REQ_ID,
    ...overrides,
  };
}

let db: any;
let ctx: ReturnType<typeof makeCtx>;

beforeEach(() => {
  db = makeFakeDb();
  ctx = makeCtx(db);
  seedFamily(db);
});

// ---------------------------------------------------------------------------
// Registry regression guard
// ---------------------------------------------------------------------------

describe('family deletion registry', () => {
  it('keeps the reviewed subcollection registry intact and duplicate-free', () => {
    expect(FAMILY_SUBCOLLECTION_REGISTRY.length).toBe(37);
    expect(new Set(FAMILY_SUBCOLLECTION_REGISTRY).size).toBe(37);
    expect(FAMILY_NESTED_SUBCOLLECTIONS.length).toBe(5);
    expect(DELETION_PHASES[0]).toBe('inventory_members');
    expect(DELETION_PHASES[DELETION_PHASES.length - 1]).toBe('finalize');
  });
});

// ---------------------------------------------------------------------------
// deleteFamily — freeze + job creation
// ---------------------------------------------------------------------------

describe('deleteFamilyImpl', () => {
  it('owner with exact name atomically freezes the family and creates a queued job', async () => {
    const result = await deleteFamilyImpl(ctx, OWNER, validInput());
    expect(result).toEqual({ familyId: FAMILY_ID, state: 'queued', phase: 'inventory_members' });

    const family = db.store.get(`families/${FAMILY_ID}`);
    expect(family.lifecycleState).toBe('deleting');
    expect(family.deletionJobId).toBe(FAMILY_ID);
    expect(family.deletionRequestedBy).toBe(OWNER);

    const job = db.store.get(`familyDeletionJobs/${FAMILY_ID}`) as FamilyDeletionJob;
    expect(job.state).toBe('queued');
    expect(job.phase).toBe('inventory_members');
    expect(job.requestedBy).toBe(OWNER);
    expect(job.clientReqId).toBe(REQ_ID);
    expect(job.schemaVersion).toBe(1);
    expect(ctx.enqueued).toEqual([FAMILY_ID]);
  });

  it('never stores the family name or invite code in the job', async () => {
    await deleteFamilyImpl(ctx, OWNER, validInput());
    const serialized = JSON.stringify(db.store.get(`familyDeletionJobs/${FAMILY_ID}`));
    expect(serialized).not.toContain(FAMILY_NAME);
    expect(serialized).not.toContain('ABC123');
  });

  it('rejects a wrong name confirmation without freezing anything', async () => {
    await expect(deleteFamilyImpl(ctx, OWNER, validInput({ familyNameConfirmation: 'Wrong Name' })))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    expect(db.store.get(`families/${FAMILY_ID}`).lifecycleState).toBeUndefined();
    expect(db.store.has(`familyDeletionJobs/${FAMILY_ID}`)).toBe(false);
    expect(ctx.enqueued).toEqual([]);
  });

  it('rejects a case-insensitive or whitespace-padded name match', async () => {
    await expect(deleteFamilyImpl(ctx, OWNER, validInput({ familyNameConfirmation: FAMILY_NAME.toLowerCase() })))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(deleteFamilyImpl(ctx, OWNER, validInput({ familyNameConfirmation: ` ${FAMILY_NAME} ` })))
      .rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it.each(['parent-uid', 'child-uid', 'outsider-uid', 'unknown-uid'])(
    'denies %s even with the exact family name',
    async uid => {
      await expect(deleteFamilyImpl(ctx, uid, validInput()))
        .rejects.toMatchObject({ code: 'permission-denied' });
      expect(db.store.has(`familyDeletionJobs/${FAMILY_ID}`)).toBe(false);
    },
  );

  it('never trusts the client familyId: owner of one family cannot delete another', async () => {
    db.store.set('families/other-family', { name: 'Other Family' });
    await expect(deleteFamilyImpl(ctx, OWNER, {
      familyId: 'other-family',
      familyNameConfirmation: 'Other Family',
      clientReqId: REQ_ID,
    })).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('returns not-found for a family that never existed', async () => {
    await expect(deleteFamilyImpl(ctx, OWNER, validInput({ familyId: 'ghost-family' })))
      .rejects.toMatchObject({ code: 'not-found' });
  });

  it.each([
    ['missing familyId', { familyId: '' }],
    ['missing confirmation', { familyNameConfirmation: '' }],
    ['short clientReqId', { clientReqId: 'abc' }],
    ['malformed clientReqId', { clientReqId: 'bad id with spaces!' }],
  ])('rejects invalid input: %s', async (_label, overrides) => {
    await expect(deleteFamilyImpl(ctx, OWNER, validInput(overrides)))
      .rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('is idempotent: a duplicate request returns the single existing job', async () => {
    await deleteFamilyImpl(ctx, OWNER, validInput());
    const jobBefore = { ...db.store.get(`familyDeletionJobs/${FAMILY_ID}`) };

    const again = await deleteFamilyImpl(ctx, OWNER, validInput());
    expect(again.state).toBe('queued');
    expect(db.store.get(`familyDeletionJobs/${FAMILY_ID}`)).toEqual(jobBefore);
  });

  it('rejects clientReqId reuse from a different requester with already-exists', async () => {
    db.store.set(`familyDeletionJobs/${FAMILY_ID}`, makeJob({ requestedBy: 'former-owner', clientReqId: REQ_ID }));
    await expect(deleteFamilyImpl(ctx, OWNER, validInput()))
      .rejects.toMatchObject({ code: 'already-exists' });
  });

  it('requeues a failed job on explicit retry with a fresh clientReqId', async () => {
    db.store.set(`familyDeletionJobs/${FAMILY_ID}`, makeJob({
      state: 'failed',
      phase: 'delete_managed_identities',
      lastErrorCode: 'TRANSIENT',
      attemptCount: 8,
    }));
    db.store.get(`families/${FAMILY_ID}`).lifecycleState = 'deleting';

    const result = await deleteFamilyImpl(ctx, OWNER, validInput({ clientReqId: 'retry-req-00000001' }));
    expect(result.state).toBe('queued');
    expect(result.phase).toBe('delete_managed_identities');

    const job = db.store.get(`familyDeletionJobs/${FAMILY_ID}`);
    expect(job.state).toBe('queued');
    expect(job.lastErrorCode).toBeNull();
    expect(job.attemptCount).toBe(0);
    expect(ctx.enqueued).toEqual([FAMILY_ID]);
  });

  it('allows the immutable requestedBy to poll after the owner profile is gone', async () => {
    db.store.delete(`users/${OWNER}`);
    db.store.set(`familyDeletionJobs/${FAMILY_ID}`, makeJob({ state: 'running', phase: 'finalize' }));
    const result = await deleteFamilyImpl(ctx, OWNER, validInput());
    expect(result.state).toBe('running');
  });

  it('recognises a completed deletion from the durable receipt', async () => {
    db.store.delete(`families/${FAMILY_ID}`);
    db.store.set(`familyDeletionReceipts/${FAMILY_ID}`, { schemaVersion: 1, familyId: FAMILY_ID });
    const result = await deleteFamilyImpl(ctx, OWNER, validInput());
    expect(result).toEqual({ familyId: FAMILY_ID, state: 'completed', phase: 'finalize' });
  });

  it('still creates a durable queued job when task dispatch fails', async () => {
    ctx.enqueue = async () => { throw new Error('queue unavailable'); };
    const result = await deleteFamilyImpl(ctx, OWNER, validInput());
    expect(result.state).toBe('queued');
    expect(db.store.get(`familyDeletionJobs/${FAMILY_ID}`).state).toBe('queued');
  });
});

// ---------------------------------------------------------------------------
// getFamilyDeletionStatus
// ---------------------------------------------------------------------------

describe('getFamilyDeletionStatusImpl', () => {
  it('returns none when no job or receipt exists', async () => {
    const status = await getFamilyDeletionStatusImpl(ctx, OWNER, FAMILY_ID);
    expect(status).toEqual({ familyId: FAMILY_ID, state: 'none' });
  });

  it('returns sanitized job status to the owner', async () => {
    db.store.set(`familyDeletionJobs/${FAMILY_ID}`, makeJob({ state: 'running', phase: 'verify_orphans', lastErrorCode: null }));
    const status = await getFamilyDeletionStatusImpl(ctx, OWNER, FAMILY_ID);
    expect(status.state).toBe('running');
    expect(status.phase).toBe('verify_orphans');
    expect(JSON.stringify(status)).not.toContain(FAMILY_NAME);
  });

  it('denies status to non-owner members and strangers', async () => {
    db.store.set(`familyDeletionJobs/${FAMILY_ID}`, makeJob({}));
    for (const uid of ['parent-uid', 'child-uid', 'outsider-uid']) {
      await expect(getFamilyDeletionStatusImpl(ctx, uid, FAMILY_ID))
        .rejects.toMatchObject({ code: 'permission-denied' });
    }
  });

  it('reports completed from the receipt after the job is gone', async () => {
    db.store.set(`familyDeletionReceipts/${FAMILY_ID}`, { schemaVersion: 1, familyId: FAMILY_ID });
    const status = await getFamilyDeletionStatusImpl(ctx, 'anyone', FAMILY_ID);
    expect(status).toEqual({ familyId: FAMILY_ID, state: 'completed' });
  });
});

// ---------------------------------------------------------------------------
// Job fixture helper
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<FamilyDeletionJob>): FamilyDeletionJob {
  return {
    schemaVersion: 1,
    familyId: FAMILY_ID,
    clientReqId: 'seed-req-00000001',
    requestedBy: OWNER,
    state: 'queued',
    phase: 'inventory_members',
    attemptCount: 0,
    phaseAttemptCount: 0,
    leaseOwner: null,
    leaseExpiresAt: null,
    nextAttemptAt: null,
    createdAt: { __serverTimestamp: true },
    startedAt: null,
    updatedAt: { __serverTimestamp: true },
    lastErrorCode: null,
    lastErrorAt: null,
    progress: {
      processedMembers: 0,
      deletedManagedIdentities: 0,
      clearedSelfRegisteredProfiles: 0,
      deletedExternalRecords: 0,
      deletedFamilyDocuments: 0,
    },
    ...overrides,
  };
}
