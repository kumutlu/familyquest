// ---------------------------------------------------------------------------
// R9 — Family deletion against the REAL Firestore and Auth emulators.
//
// The unit suites (familyDeletion.test.ts, familyDeletionWorker.test.ts) run
// against in-memory fakes. This suite proves the same worker behaves correctly
// against genuine Admin SDK semantics: real transactions, real composite
// queries, real listCollections()/recursiveDelete(), real custom claims and
// real Auth user deletion.
//
// Requires both emulators:
//   firebase emulators:exec --only firestore,auth 'npx vitest run <file>'
// Without them the suite is skipped rather than silently passing on mocks.
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';

import {
  deleteFamilyImpl,
  getFamilyDeletionStatusImpl,
  processFamilyDeletionImpl,
  purgeExpiredFamilyDeletionReceiptsImpl,
  RECEIPT_TTL_FIELD,
  type FamilyDeletionContext,
} from './familyDeletion';

const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
  && Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);
const describeWithEmulators = emulatorAvailable ? describe : describe.skip;

const FAMILY_ID = 'integration-family';
const OWNER_UID = 'integration-owner';
const PARENT_UID = 'integration-parent';
const CHILD_ID = 'integration-child';
const CHILD_AUTH_UID = 'integration-child-auth';

describeWithEmulators('family deletion — Firestore + Auth emulator integration', () => {
  let app: App;
  let db: Firestore;
  let auth: Auth;
  let ctx: FamilyDeletionContext & { enqueued: string[] };

  function makeCtx(): FamilyDeletionContext & { enqueued: string[] } {
    const enqueued: string[] = [];
    return {
      db,
      auth,
      enqueue: async (familyId: string) => { enqueued.push(familyId); },
      now: () => Date.now(),
      invocationId: 'integration-worker',
      enqueued,
    };
  }

  async function deleteAuthUserIfPresent(uid: string) {
    try {
      await auth.deleteUser(uid);
    } catch {
      /* absent is the desired state */
    }
  }

  beforeAll(async () => {
    app = initializeApp({ projectId: 'familyquest-beta-402cb' }, 'family-deletion-integration');
    db = getFirestore(app);
    auth = getAuth(app);

    // A clean slate: this suite owns these fixed ids.
    for (const path of [
      `families/${FAMILY_ID}`,
      `familyDeletionJobs/${FAMILY_ID}`,
      `familyDeletionReceipts/${FAMILY_ID}`,
      `users/${OWNER_UID}`,
      `users/${PARENT_UID}`,
      `users/${CHILD_ID}`,
    ]) {
      await db.doc(path).delete();
    }
    await deleteAuthUserIfPresent(OWNER_UID);
    await deleteAuthUserIfPresent(PARENT_UID);
    await deleteAuthUserIfPresent(CHILD_AUTH_UID);

    await db.doc(`families/${FAMILY_ID}`).set({
      name: 'Integration Family',
      inviteCode: 'INTEG1',
      currencyCode: 'GBP',
    });
    // Family subcollection content proving real recursive cleanup.
    await db.doc(`families/${FAMILY_ID}/tasks/task-1`).set({ title: 'Tidy up' });
    await db.doc(`families/${FAMILY_ID}/wallets/${CHILD_ID}`).set({ balancePence: 500 });
    await db.doc(`families/${FAMILY_ID}/childLogins/${CHILD_ID}`).set({
      authUid: CHILD_AUTH_UID,
      usernameLower: 'integ_child',
    });

    // Owner: self-registered adult with a real Auth user and family claims.
    await auth.createUser({ uid: OWNER_UID, email: 'owner@integration.test', password: 'Passw0rd!' });
    await auth.setCustomUserClaims(OWNER_UID, { familyId: FAMILY_ID, role: 'owner' });
    await db.doc(`users/${OWNER_UID}`).set({
      uid: OWNER_UID,
      displayName: 'Integration Owner',
      email: 'owner@integration.test',
      avatarId: 'fox',
      createdAt: Timestamp.now(),
      familyId: FAMILY_ID,
      role: 'owner',
      rewardPoints: 120,
      lifetimeXP: 900,
      currentStreak: 4,
      longestStreak: 9,
      lastActiveDate: '2026-07-30',
      walletBalance: 2500,
      lastGoalTxId: 'tx-1',
    });

    // Second self-registered adult.
    await auth.createUser({ uid: PARENT_UID, email: 'parent@integration.test', password: 'Passw0rd!' });
    await auth.setCustomUserClaims(PARENT_UID, { familyId: FAMILY_ID, role: 'parent' });
    await db.doc(`users/${PARENT_UID}`).set({
      uid: PARENT_UID,
      displayName: 'Integration Parent',
      email: 'parent@integration.test',
      familyId: FAMILY_ID,
      role: 'parent',
      rewardPoints: 10,
      walletBalance: 100,
    });

    // Managed child: profile + private login record + Auth user with claims.
    await auth.createUser({ uid: CHILD_AUTH_UID, email: 'integ_child@managed.test', password: 'Passw0rd!' });
    await auth.setCustomUserClaims(CHILD_AUTH_UID, {
      managedChild: true,
      childId: CHILD_ID,
      familyId: FAMILY_ID,
      role: 'child',
    });
    await db.doc(`users/${CHILD_ID}`).set({
      uid: CHILD_ID,
      displayName: 'Integration Child',
      familyId: FAMILY_ID,
      role: 'child',
      isManaged: true,
      hasLogin: true,
      authUid: CHILD_AUTH_UID,
    });

    // External reference outside the family document tree.
    await db.doc('familyMembershipIdempotency/integration-idem').set({ familyId: FAMILY_ID });

    ctx = makeCtx();
  });

  afterAll(async () => {
    if (app) await deleteApp(app);
  });

  it('deletes a real family end to end across every phase', async () => {
    const queued = await deleteFamilyImpl(ctx, OWNER_UID, {
      familyId: FAMILY_ID,
      familyNameConfirmation: 'Integration Family',
      clientReqId: 'integration-req-1',
    });
    expect(queued).toEqual({ familyId: FAMILY_ID, state: 'queued', phase: 'inventory_members' });

    // The freeze is durable and visible to security rules.
    const frozen = await db.doc(`families/${FAMILY_ID}`).get();
    expect(frozen.data()?.lifecycleState).toBe('deleting');

    const result = await processFamilyDeletionImpl(ctx, FAMILY_ID);
    expect(result).toEqual({ done: true, state: 'completed' });

    // Family document and all its subcollection content are gone.
    expect((await db.doc(`families/${FAMILY_ID}`).get()).exists).toBe(false);
    expect((await db.doc(`families/${FAMILY_ID}/tasks/task-1`).get()).exists).toBe(false);
    expect((await db.doc(`families/${FAMILY_ID}/childLogins/${CHILD_ID}`).get()).exists).toBe(false);

    // External references are gone.
    expect((await db.doc('familyMembershipIdempotency/integration-idem').get()).exists).toBe(false);

    // Managed identity: profile deleted and the real Auth user removed.
    expect((await db.doc(`users/${CHILD_ID}`).get()).exists).toBe(false);
    await expect(auth.getUser(CHILD_AUTH_UID)).rejects.toThrow();

    // Self-registered members keep their account identity and lose every
    // family-scoped field (R2).
    const owner = (await db.doc(`users/${OWNER_UID}`).get()).data()!;
    expect(owner.displayName).toBe('Integration Owner');
    expect(owner.email).toBe('owner@integration.test');
    expect(owner.avatarId).toBe('fox');
    for (const field of [
      'familyId', 'role', 'rewardPoints', 'lifetimeXP', 'currentStreak',
      'longestStreak', 'lastActiveDate', 'walletBalance', 'lastGoalTxId',
    ]) {
      expect(owner).not.toHaveProperty(field);
    }
    const parent = (await db.doc(`users/${PARENT_UID}`).get()).data()!;
    expect(parent.displayName).toBe('Integration Parent');
    expect(parent).not.toHaveProperty('familyId');

    // Real custom claims are stripped on both adults.
    for (const uid of [OWNER_UID, PARENT_UID]) {
      const claims = (await auth.getUser(uid)).customClaims ?? {};
      expect(claims).not.toHaveProperty('familyId');
      expect(claims).not.toHaveProperty('role');
    }

    // Durable receipt with the exact approved schema, and no job left behind.
    const receipt = (await db.doc(`familyDeletionReceipts/${FAMILY_ID}`).get()).data()!;
    expect(Object.keys(receipt).sort()).toEqual([
      'completedAt', 'expiresAt', 'familyId', 'outcome', 'requestedBy',
      'schemaVersion', 'startedAt',
    ]);
    expect(receipt.outcome).toBe('completed');
    expect(receipt.requestedBy).toBe(OWNER_UID);
    expect(receipt[RECEIPT_TTL_FIELD]).toBeInstanceOf(Timestamp);
    expect(receipt[RECEIPT_TTL_FIELD].toMillis()).toBeGreaterThan(Date.now());
    expect((await db.doc(`familyDeletionJobs/${FAMILY_ID}`).get()).exists).toBe(false);
  }, 60_000);

  it('reports completion from the durable receipt to the original requester', async () => {
    await expect(getFamilyDeletionStatusImpl(ctx, OWNER_UID, FAMILY_ID))
      .resolves.toEqual({ familyId: FAMILY_ID, state: 'completed' });
  }, 30_000);

  it('is idempotent: a duplicate task delivery after completion changes nothing', async () => {
    const before = (await db.doc(`familyDeletionReceipts/${FAMILY_ID}`).get()).data()!;
    // The job document is disposable and already gone, so a duplicate delivery
    // finds nothing to claim and performs no writes at all.
    const again = await processFamilyDeletionImpl(makeCtx(), FAMILY_ID);
    expect(again).toEqual({ done: false });
    expect((await db.doc(`familyDeletionJobs/${FAMILY_ID}`).get()).exists).toBe(false);
    const after = (await db.doc(`familyDeletionReceipts/${FAMILY_ID}`).get()).data()!;
    expect(after.completedAt.toMillis()).toBe(before.completedAt.toMillis());
    expect((await db.doc(`families/${FAMILY_ID}`).get()).exists).toBe(false);
  }, 30_000);

  it('purges only elapsed receipts with a real Firestore range query', async () => {
    const purgeCtx = makeCtx();
    await db.doc('familyDeletionReceipts/integration-expired').set({
      schemaVersion: 1,
      familyId: 'integration-expired',
      outcome: 'completed',
      [RECEIPT_TTL_FIELD]: Timestamp.fromMillis(Date.now() - 60_000),
    });

    const deleted = await purgeExpiredFamilyDeletionReceiptsImpl(purgeCtx);
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect((await db.doc('familyDeletionReceipts/integration-expired').get()).exists).toBe(false);
    // The fresh receipt from this run is 30 days out and must survive.
    expect((await db.doc(`familyDeletionReceipts/${FAMILY_ID}`).get()).exists).toBe(true);

    await db.doc(`familyDeletionReceipts/${FAMILY_ID}`).delete();
  }, 30_000);
});
