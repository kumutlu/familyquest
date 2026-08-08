// P0 READ-ONLY production probe (v2). Performs ONLY .get() reads. No writes.
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const svc = require('../firebase-key.json');

admin.initializeApp({ credential: admin.cert(svc), projectId: 'familyquest-beta-402cb' });
const db = getFirestore();

async function main() {
  // 1) All users, children only
  const usersSnap = await db.collection('users').get();
  const children = [];
  for (const d of usersSnap.docs) {
    const data = d.data();
    if (data.role !== 'child') continue;
    children.push({
      id: d.id,
      familyId: data.familyId === undefined ? '<MISSING>' : (data.familyId === null ? '<NULL>' : data.familyId),
      rewardPoints: data.rewardPoints,
      role: data.role,
      isActive: data.isActive === undefined ? '<absent>' : data.isActive,
      lastRedemptionId: data.lastRedemptionId === undefined ? '<absent>' : data.lastRedemptionId,
      hasFamilyId: data.familyId !== undefined && data.familyId !== null,
      allKeys: Object.keys(data).sort(),
    });
  }

  // 2) Group children by familyId (present)
  const byFamily = {};
  for (const c of children) {
    if (c.hasFamilyId) (byFamily[c.familyId] = byFamily[c.familyId] || []).push(c);
  }

  // 3) For each family: count redemptions + active rewards with cost
  const familyStats = {};
  for (const fid of Object.keys(byFamily)) {
    const redSnap = await db.collection(`families/${fid}/redemptions`).get();
    const rewSnap = await db.collection(`families/${fid}/rewards`).get();
    const activeRewards = rewSnap.docs
      .map(d => d.data())
      .filter(r => (r.isActive === undefined ? true : r.isActive !== false))
      .filter(r => typeof r.cost === 'number');
    familyStats[fid] = {
      childCount: byFamily[fid].length,
      redemptionCount: redSnap.size,
      activeRewardCount: activeRewards.length,
      minRewardCost: activeRewards.length ? Math.min(...activeRewards.map(r => r.cost)) : null,
      rewardsMissingCost: rewSnap.docs.filter(d => typeof d.data().cost !== 'number').length,
    };
  }

  // 4) Heuristic failing family: has children, has active reward(s) with cost,
  //    at least one child can afford the cheapest reward, but ZERO redemptions.
  const failingCandidates = [];
  for (const [fid, st] of Object.entries(familyStats)) {
    if (st.childCount === 0) continue;
    if (st.activeRewardCount === 0) continue;
    if (st.redemptionCount > 0) continue;
    const canAfford = byFamily[fid].some(c => typeof c.rewardPoints === 'number' && c.rewardPoints >= st.minRewardCost);
    if (canAfford) failingCandidates.push({ familyId: fid, stats: st });
  }

  // 5) Anomaly: child with lastRedemptionId but redemption doc missing under their family
  const orphanRedemptionChildren = [];
  for (const c of children) {
    if (c.hasFamilyId && c.lastRedemptionId && c.lastRedemptionId !== '<absent>') {
      const redSnap = await db.doc(`families/${c.familyId}/redemptions/${c.lastRedemptionId}`).get();
      if (!redSnap.exists) orphanRedemptionChildren.push({ childId: c.id, familyId: c.familyId, lastRedemptionId: c.lastRedemptionId });
    }
  }

  console.log('=== CHILD COUNT ===', children.length);
  console.log('=== FAMILIES WITH CHILDREN ===', Object.keys(byFamily).length);
  console.log('=== FAILING CANDIDATES (heuristic) ===', failingCandidates.length);
  console.log(JSON.stringify(failingCandidates, null, 2));
  console.log('=== CHILDREN w/ lastRedemptionId but MISSING redemption doc ===', orphanRedemptionChildren.length);
  console.log(JSON.stringify(orphanRedemptionChildren, null, 2));

  // 6) Dump full key sets for failing-candidate children (to spot missing fields)
  for (const fc of failingCandidates.slice(0, 3)) {
    console.log(`--- FAILING CANDIDATE FAMILY ${fc.familyId} children ---`);
    for (const c of byFamily[fc.familyId]) {
      console.log(JSON.stringify({ id: c.id, familyId: c.familyId, rewardPoints: c.rewardPoints, role: c.role, isActive: c.isActive, lastRedemptionId: c.lastRedemptionId, keys: c.allKeys }, null, 2));
    }
    // dump one reward
    const rewSnap = await db.collection(`families/${fc.familyId}/rewards`).get();
    console.log('  rewards sample:', JSON.stringify(rewSnap.docs.slice(0, 3).map(d => ({ id: d.id, cost: d.data().cost, inventory: d.data().inventory, isActive: d.data().isActive, status: d.data().status }))));
  }

  process.exit(0);
}
main().catch(e => { console.error('ERR', e); process.exit(1); });
