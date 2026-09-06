import { FieldValue } from 'firebase-admin/firestore';
import type { Auth, UserRecord } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { readChildCredentialStatus, type ChildCredentialStatus } from './childLogin';

/** Not a callable. A trusted operator must verify the historical creation write.
 * Equality with displayName, QR-shaped IDs, or legacy flags are NOT provenance.
 * Execute is intentionally emulator-only in this review phase.
 */
export function planLegacyQrRepair(
  profile: Record<string, unknown>, status: ChildCredentialStatus,
  auth: Pick<UserRecord, 'email' | 'providerData'>, creationWriteVerified: boolean,
) {
  const no = (reason: string) => ({ eligible: false, reason, after: {}, remove: [] as string[] });
  if (status.state !== 'available' || !status.identityConnected || status.credentialsExist) return no('not-qr-only');
  if (auth.email || auth.providerData.some(p => p.providerId === 'password')) return no('auth-credentials-present');
  const names = ['username', 'usernameLower'].filter(key => Object.hasOwn(profile, key));
  if (profile.hasLogin !== true && profile.loginEnabled !== true && !names.length) return no('already-normalized');
  if (names.length && !creationWriteVerified) return no('username-provenance-unproven');
  return { eligible: true, reason: 'eligible', after: { hasLogin: false, loginEnabled: false }, remove: names };
}

export async function repairLegacyQrProfile(
  db: Firestore, auth: Auth, familyId: string, childId: string,
  options: { dryRun?: boolean; creationWriteVerified?: boolean } = {},
) {
  if (options.dryRun === false && (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST || !String((db as unknown as { projectId?: string }).projectId).startsWith('demo-'))) {
    throw new Error('REPAIR_EXECUTION_EMULATOR_ONLY');
  }
  const ref = db.doc(`users/${childId}`);
  const snapshot = await ref.get();
  const profile = snapshot.data() ?? {};
  const status = await readChildCredentialStatus(db, familyId, childId);
  if (status.state !== 'available' || !status.identityConnected || status.credentialsExist) return { eligible: false, reason: 'not-qr-only' };
  const user = await auth.getUser(String(profile.authUid));
  const plan = planLegacyQrRepair(profile, status, user, options.creationWriteVerified === true);
  if (!plan.eligible || options.dryRun !== false) return { ...plan, dryRun: true };
  // Auth has no cross-service transaction. Production execution stays disabled.
  // Recheck all Firestore eligibility reads atomically against concurrent upgrades.
  await db.runTransaction(async tx => {
    const [live, privateDoc, indexes] = await Promise.all([
      tx.get(ref), tx.get(db.doc(`families/${familyId}/childLogins/${childId}`)),
      tx.get(db.collection(`families/${familyId}/childLoginIndex`).where('childId', '==', childId)),
    ]);
    const p = live.data(); const link = privateDoc.data();
    if (!p || p.familyId !== familyId || p.isManaged !== true || p.role !== 'child' || p.authUid !== profile.authUid || p.status === 'deleted' || p.disabled === true || !link || link.childId !== childId || link.familyId !== familyId || link.authUid !== p.authUid || link.normalizedUsername || link.syntheticEmail || link.username || !indexes.empty) throw new Error('REPAIR_STATE_CHANGED');
    for (const key of ['hasLogin', 'loginEnabled', 'username', 'usernameLower']) {
      if (p[key] !== profile[key]) throw new Error('REPAIR_STATE_CHANGED');
    }
    const update: Record<string, unknown> = { ...plan.after };
    for (const key of plan.remove) update[key] = FieldValue.delete();
    tx.update(ref, update);
  });
  return { ...plan, dryRun: false };
}
