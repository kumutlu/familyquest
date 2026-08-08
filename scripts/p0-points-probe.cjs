// P0 READ-ONLY production probe (points divergence). Performs ONLY .get() reads.
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const svc = require('../firebase-key.json');
admin.initializeApp({ credential: admin.cert(svc), projectId: 'familyquest-beta-402cb' });
const db = getFirestore();

async function main() {
  // 1) Find Blackiron family (live)
  const famSnap = await db.collection('families').get();
  const blackiron = [];
  for (const d of famSnap.docs) {
    const n = (d.data().name || '').toLowerCase();
    if (n.includes('blackiron')) blackiron.push({ id: d.id, name: d.data().name });
  }
  console.log('=== BLACKIRON FAMILIES (live) ===', JSON.stringify(blackiron));

  // 2) Scan all children: users + summaries + state_v3 + state(v4)
  const usersSnap = await db.collection('users').get();
  const rows = [];
  for (const d of usersSnap.docs) {
    const u = d.data();
    if (u.role !== 'child') continue;
    const fid = u.familyId;
    let summary = null, stateV3 = null, stateV4 = null;
    if (fid) {
      const s = await db.doc(`families/${fid}/gamification_summaries/${d.id}`).get();
      if (s.exists) summary = s.data();
      const v3 = await db.doc(`families/${fid}/gamification_state_v3/${d.id}`).get();
      if (v3.exists) stateV3 = v3.data();
      const v4 = await db.doc(`families/${fid}/gamification_state/${d.id}`).get();
      if (v4.exists) stateV4 = v4.data();
    }
    rows.push({
      id: d.id, familyId: fid, familyName: null,
      rp: u.rewardPoints, lifetimeXP: u.lifetimeXP,
      sum_weekly: summary ? summary.weeklyPoints : '<no-summary>',
      sum_rp: summary ? summary.rewardPoints : '<no-summary>',
      sum_xp: summary ? summary.xpTotal : '<no-summary>',
      sum_status: summary ? summary.projectionStatus : '<no-summary>',
      v3_rp: stateV3 ? stateV3.rewardPoints : '<no-v3>',
      v3_weekly: stateV3 ? stateV3.weeklyPoints : '<no-v3>',
      v4_rp: stateV4 ? stateV4.rewardPoints : '<no-v4>',
    });
  }

  // 3) Divergence signature: summary.weeklyPoints > 0 but users.rewardPoints == 0
  const diverged = rows.filter(r => typeof r.sum_weekly === 'number' && r.sum_weekly > 0 && (r.rp === 0 || r.rp === undefined || r.rp === null));
  console.log('=== DIVERGED (weekly>0 but rewardPoints==0) ===', diverged.length);
  for (const r of diverged) console.log(JSON.stringify(r));

  // 4) Also show any child with weeklyPoints>0 for context
  const withWeekly = rows.filter(r => typeof r.sum_weekly === 'number' && r.sum_weekly > 0);
  console.log('=== CHILDREN WITH weeklyPoints>0 ===', withWeekly.length);
  for (const r of withWeekly) console.log(JSON.stringify(r));

  // 5) Working Kemal child (Alisya) for comparison
  const alisya = rows.find(r => r.id === 'NuyIJDP9fDNP2LiKynlsEyzur5N2');
  console.log('=== ALISYA (working Kemal child) ===', JSON.stringify(alisya));

  process.exit(0);
}
main().catch(e => { console.error('ERR', e); process.exit(1); });
