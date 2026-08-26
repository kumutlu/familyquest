import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

let testEnv: RulesTestEnvironment;

const projectId = 'familyquest-adult-invitations-rules';
const familyId = 'adult-invite-family';
const ownerId = 'adult-invite-owner';
const parentId = 'adult-invite-parent';
const adultId = 'adult-invite-adult';
const joinerId = 'adult-invite-joiner';
const invitationHash = 'a'.repeat(64);

const invitationPath = `familyInvitations/${invitationHash}`;
const eventPath = `families/${familyId}/adultInvitationEvents/accept-event-0001`;
const serverOnlyPaths = [
  'adultInvitationCreationIdempotency/owner_req-create-0001',
  'adultInvitationAcceptanceIdempotency/joiner_req-accept-0001',
  'adultInvitationRevocationIdempotency/owner_req-revoke-0001',
  'adultInvitationPreviewRateLimits/preview-identity-hash',
  // Retain the collection name reserved by the approved Task 3 contract.
  'adultInvitationRateLimits/preview-identity-hash',
] as const;

const forgedInvitation = {
  version: 2,
  familyId,
  intendedRole: 'owner',
  status: 'active',
  createdBy: joinerId,
  clientReqId: 'forged-request',
};

function contextFor(identity: 'owner' | 'parent' | 'joiner') {
  const uid = identity === 'owner' ? ownerId : identity === 'parent' ? parentId : joinerId;
  return testEnv.authenticatedContext(uid);
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'families', familyId), { name: 'Adult Invite Family' });
    await setDoc(doc(db, 'users', ownerId), { uid: ownerId, familyId, role: 'owner' });
    await setDoc(doc(db, 'users', parentId), { uid: parentId, familyId, role: 'parent' });
    await setDoc(doc(db, 'users', adultId), { uid: adultId, familyId, role: 'adult' });
    await setDoc(doc(db, 'users', joinerId), { uid: joinerId, role: 'parent' });
    await setDoc(doc(db, invitationPath), {
      ...forgedInvitation,
      intendedRole: 'parent',
      createdBy: ownerId,
    });
    for (const path of serverOnlyPaths) {
      await setDoc(doc(db, path), { status: 'completed', familyId });
    }
    await setDoc(doc(db, `families/${familyId}/users/${parentId}`), {
      uid: parentId,
      role: 'parent',
      lifecycle: 'active',
    });
    await setDoc(doc(db, eventPath), {
      type: 'invitation_accepted',
      memberUid: joinerId,
      intendedRole: 'parent',
    });
  });
});

describe('v2 invitation authority records are server-only', () => {
  it.each(['owner', 'parent', 'joiner'] as const)(
    'denies %s every direct read/write of v2 invitation records',
    async identity => {
      const db = contextFor(identity).firestore();
      await assertFails(getDoc(doc(db, invitationPath)));
      await assertFails(setDoc(doc(db, invitationPath), forgedInvitation));
      await assertFails(updateDoc(doc(db, invitationPath), { intendedRole: 'owner' }));
      await assertFails(deleteDoc(doc(db, invitationPath)));
    },
  );

  it.each(['owner', 'parent', 'joiner'] as const)(
    'denies %s every direct read/write of idempotency and rate-limit records',
    async identity => {
      const db = contextFor(identity).firestore();
      for (const path of serverOnlyPaths) {
        await assertFails(getDoc(doc(db, path)));
        await assertFails(setDoc(doc(db, path), { status: 'forged', familyId }));
        await assertFails(updateDoc(doc(db, path), { status: 'forged' }));
        await assertFails(deleteDoc(doc(db, path)));
      }
    },
  );
});

describe('membership authority remains server-owned', () => {
  it('denies a no-family user directly assigning familyId or owner role', async () => {
    const db = contextFor('joiner').firestore();
    await assertFails(updateDoc(doc(db, 'users', joinerId), { familyId, role: 'owner' }));
  });

  it.each(['owner', 'parent', 'joiner'] as const)(
    'denies %s every direct read/write of the canonical membership projection',
    async identity => {
      const db = contextFor(identity).firestore();
      const existingProjection = doc(db, `families/${familyId}/users/${parentId}`);
      await assertFails(getDoc(existingProjection));
      await assertFails(setDoc(doc(db, `families/${familyId}/users/${joinerId}`), {
        uid: joinerId,
        role: 'parent',
        lifecycle: 'active',
      }));
      await assertFails(updateDoc(existingProjection, { role: 'owner' }));
      await assertFails(deleteDoc(existingProjection));
    },
  );

  it.each([
    ['owner self-demotion to parent', ownerId, 'parent'],
    ['owner self-demotion to adult', ownerId, 'adult'],
    ['existing parent role change', parentId, 'adult'],
    ['existing adult role change', adultId, 'parent'],
    ['owner grant to an existing parent', parentId, 'owner'],
    ['child assignment to an existing adult', adultId, 'child'],
  ] as const)('denies %s', async (_caseName, targetId, nextRole) => {
    const db = contextFor('owner').firestore();
    await assertFails(updateDoc(doc(db, 'users', targetId), { role: nextRole }));
  });
});

describe('v2 adult invitation audit events are server-only', () => {
  it.each(['owner', 'parent', 'joiner'] as const)(
    'denies %s every direct read/write of adult invitation events',
    async identity => {
      const db = contextFor(identity).firestore();
      await assertFails(getDoc(doc(db, eventPath)));
      await assertFails(setDoc(doc(db, eventPath), {
        type: 'invitation_accepted',
        memberUid: identity,
        intendedRole: 'owner',
      }));
      await assertFails(updateDoc(doc(db, eventPath), { intendedRole: 'owner' }));
      await assertFails(deleteDoc(doc(db, eventPath)));
    },
  );
});
