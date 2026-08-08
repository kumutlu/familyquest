// P0 READ-ONLY production probe (v3). Performs ONLY .get() reads. No writes.
// Focus: managed children (isManaged==true) requiring password change — the
// axis that makes authProfileId() return '__restricted_managed_child__' and
// therefore fails conjunct #1 of isValidRedemptionDeduction.
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const svc = require('../firebase-key.json');

admin.initializeApp({ credential: admin.cert(svc), projectId: 'familyquest-beta-402cb' });
const db = getFirestore();

async function main() {
  const usersSnap = await db.collection('users').get();
  const managed = [];
  for (const d of usersSnap.docs) {
    const data = d.data();
    if (data.role !== 'child') continue;
    const isManaged = data.isManaged === true;
    const reqPw = data.requiresPasswordChange === true;
    if (!isManaged && !reqPw) continue;
    let redemptionExists = '<no lastRedemptionId>';
    if (data.lastRedemptionId && data.familyId) {
      const red = await db.doc(`families/${data.familyId}/redemptions/${data.lastRedemptionId}`).get();
      redemptionExists = red.exists;
    }
    managed.push({
      id: d.id,
      familyId: data.familyId,
      rewardPoints: data.rewardPoints,
      isManaged,
      requiresPasswordChange: reqPw,
      hasLogin: data.hasLogin,
      loginEnabled: data.loginEnabled,
      lastRedemptionId: data.lastRedemptionId || '<absent>',
      redemptionExists,
    });
  }
  console.log('=== MANAGED / password-change children ===', managed.length);
  console.log(JSON.stringify(managed, null, 2));
  process.exit(0);
}
main().catch(e => { console.error('ERR', e); process.exit(1); });
