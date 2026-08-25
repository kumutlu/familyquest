import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';

import {
  acceptAdultInvitationImpl,
  generateAdultInvitationToken,
  hashAdultInvitationToken,
  INVITATION_TTL_MS,
} from './adultInvitations';

const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const describeWithEmulator = emulatorAvailable ? describe : describe.skip;

describeWithEmulator('adult invitation Firestore transaction integration', () => {
  let app: App;
  let db: Firestore;
  const now = new Date('2026-08-25T12:00:00.000Z');

  beforeAll(async () => {
    app = initializeApp({ projectId: 'familyquest-beta-402cb' }, 'adult-invitation-integration');
    db = getFirestore(app);
  });

  afterAll(async () => {
    if (app) await deleteApp(app);
  });

  async function seedAcceptance(token: string, suffix: string, joiners: string[]) {
    const familyId = `adult-invite-family-${suffix}`;
    const invitationId = hashAdultInvitationToken(token);
    await Promise.all([
      db.doc(`families/${familyId}`).set({
        name: 'Integration Family',
        lifecycleState: 'active',
      }),
      db.doc(`familyInvitations/${invitationId}`).set({
        version: 2,
        familyId,
        intendedRole: 'parent',
        status: 'active',
        createdBy: `owner-${suffix}`,
        createdAt: Timestamp.fromDate(now),
        expiresAt: Timestamp.fromDate(new Date(now.getTime() + INVITATION_TTL_MS)),
        clientReqId: `seed-${suffix}`,
      }),
      ...joiners.map(uid => db.doc(`users/${uid}`).set({ uid, displayName: uid })),
    ]);
    return { familyId, invitationId };
  }

  const context = (eventId: string): any => ({
    db,
    now: () => now,
    eventId: () => eventId,
  });

  it('replays the same user idempotently after the transaction commits', async () => {
    const token = generateAdultInvitationToken(() => Buffer.alloc(32, 31));
    const uid = 'adult-invite-replay-user';
    const { familyId } = await seedAcceptance(token, 'replay', [uid]);
    const input = { token, clientReqId: 'emulator-replay-request' };
    const request = { auth: { uid } } as any;

    const first = await acceptAdultInvitationImpl(input, request, context('event-replay'));
    const second = await acceptAdultInvitationImpl(input, request, context('event-replay'));

    expect(first).toEqual({ result: 'joined', familyId, role: 'parent', destination: '/' });
    expect(second).toEqual(first);
    expect((await db.doc(`families/${familyId}/users/${uid}`).get()).data()).toMatchObject({
      uid, role: 'parent', lifecycle: 'active',
    });
  });

  it('gives concurrent different-user acceptance exactly one winner atomically', async () => {
    const token = generateAdultInvitationToken(() => Buffer.alloc(32, 32));
    const users = ['adult-invite-racer-a', 'adult-invite-racer-b'];
    const { familyId, invitationId } = await seedAcceptance(token, 'race', users);

    const outcomes = await Promise.allSettled(users.map((uid, index) =>
      acceptAdultInvitationImpl(
        { token, clientReqId: `emulator-race-request-${index}` },
        { auth: { uid } } as any,
        context(`event-race-${index}`),
      )));

    const fulfilled = outcomes.filter(outcome => outcome.status === 'fulfilled');
    const rejected = outcomes.filter(outcome => outcome.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      message: 'INVITATION_ALREADY_USED',
    });

    const invitation = (await db.doc(`familyInvitations/${invitationId}`).get()).data();
    const winner = String(invitation?.acceptedBy);
    const loser = users.find(uid => uid !== winner)!;
    expect(invitation).toMatchObject({ status: 'accepted', acceptedBy: winner });
    expect((await db.doc(`users/${winner}`).get()).data()).toMatchObject({
      familyId, role: 'parent', lifecycle: 'active',
    });
    expect((await db.doc(`families/${familyId}/users/${winner}`).get()).exists).toBe(true);
    expect((await db.doc(`users/${loser}`).get()).data()?.familyId).toBeUndefined();
    expect((await db.doc(`families/${familyId}/users/${loser}`).get()).exists).toBe(false);
  });
});
