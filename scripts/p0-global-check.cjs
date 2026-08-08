// P0 READ-ONLY production probe (v4). Performs ONLY .get() reads. No writes.
// Closes secondary candidates: missing rewardPoints on children, missing/non-numeric
// reward.cost on rewards, across ALL families.
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const svc = require('../firebase-key.json');
admin.initializeApp({ credential: admin.cert(svc), projectId: 'familyquest-beta-402cb' });
const db = getFirestore();

async function main() {
  const usersSnap = await db.collection('users').get();
  let children = 0, missingFamilyId = 0, missingRewardPoints = 0, missingRole = 0;
  const famSet = new Set();
  for (const d of usersSnap.docs) {
    const data = d.data();
    if (data.role !== 'child') continue;
    children++;
    if (data.familyId === undefined || data.familyId === null) missingFamilyId++;
    if (typeof data.rewardPoints !== 'number') missingRewardPoints++;
    if (data.role === undefined) missingRole++;
    if (data.familyId) famSet.add(data.familyId);
  }

  let rewardsChecked = 0, rewardsMissingCost = 0, rewardsNonNumericCost = 0;
  for (const fid of famSet) {
    const rewSnap = await db.collection(`families/${fid}/rewards`).get();
    for (const d of rewSnap.docs) {
      rewardsChecked++;
      const c = d.data().cost;
      if (c === undefined || c === null) rewardsMissingCost++;
      else if (typeof c !== 'number') rewardsNonNumericCost++;
    }
  }

  console.log(JSON.stringify({
    children, missingFamilyId, missingRewardPoints, missingRole,
    families: famSet.size,
    rewardsChecked, rewardsMissingCost, rewardsNonNumericCost,
  }, null, 2));
  process.exit(0);
}
main().catch(e => { console.error('ERR', e); process.exit(1); });
