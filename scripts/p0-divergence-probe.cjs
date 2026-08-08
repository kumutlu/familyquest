// P0 READ-ONLY production probe (points divergence, extended).
// Performs ONLY .get() reads. No writes, no deploy.
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const svc = require('../firebase-key.json');
admin.initializeApp({ credential: admin.cert(svc), projectId: 'familyquest-beta-402cb' });
const db = getFirestore();

async function childDocs(fid, cid) {
  const out = { summary: null, v3: null, v4: null, completions: [] };
  const s = await db.doc(`families/${fid}/gamification_summaries/${cid}`).get();
  if (s.exists) out.summary = s.data();
  const v3 = await db.doc(`families/${fid}/gamification_state_v3/${cid}`).get();
  if (v3.exists) out.v3 = v3.data();
  const v4 = await db.doc(`families/${fid}/gamification_state/${cid}`).get();
  if (v4.exists) out.v4 = v4.data();
  const comps = await db.collection(`families/${fid}/task_completions`).where('assigneeId', '==', cid).get();
  for (const c of comps.docs) {
    const d = c.data();
    out.completions.push({
      id: c.id,
      status: d.status,
      awardedPoints: d.awardedPoints,
      assigneeId: d.assigneeId,
      taskId: d.taskId,
      effectSnapshot: d.effectSnapshot || null,
      gamificationEffectSnapshot: d.gamificationEffectSnapshot || null,
      approvedAt: d.approvedAt || null,
      createdAt: d.createdAt || null,
    });
  }
  return out;
}

async function main() {
  const usersSnap = await db.collection('users').get();
  const children = [];
  for (const d of usersSnap.docs) {
    const u = d.data();
    if (u.role !== 'child') continue;
    children.push({ id: d.id, familyId: u.familyId, rp: u.rewardPoints, lifetimeXP: u.lifetimeXP, weeklyPoints: u.weeklyPoints, role: u.role });
  }

  // For each child, pull docs + completions, flag divergence
  const report = [];
  for (const ch of children) {
    if (!ch.familyId) continue;
    const docs = await childDocs(ch.familyId, ch.id);
    const approved = docs.completions.filter(c => c.status === 'approved' || c.status === 'pending_approval' || c.status === 'rejected');
    const approvedCount = docs.completions.filter(c => c.status === 'approved').length;
    report.push({
      id: ch.id, familyId: ch.familyId,
      users_rp: ch.rp, users_lifetimeXP: ch.lifetimeXP, users_weekly: ch.weeklyPoints,
      sum_rp: docs.summary ? docs.summary.rewardPoints : '<no-summary>',
      sum_xp: docs.summary ? docs.summary.xpTotal : '<no-summary>',
      sum_weekly: docs.summary ? docs.summary.weeklyPoints : '<no-summary>',
      sum_status: docs.summary ? docs.summary.projectionStatus : '<no-summary>',
      v3_rp: docs.v3 ? docs.v3.rewardPoints : '<no-v3>',
      v3_weekly: docs.v3 ? docs.v3.weeklyPoints : '<no-v3>',
      v4_rp: docs.v4 ? docs.v4.rewardPoints : '<no-v4>',
      approvedCompletions: approvedCount,
      completionStatuses: docs.completions.map(c => ({ id: c.id, status: c.status, awardedPoints: c.awardedPoints, hasEffect: !!c.gamificationEffectSnapshot })),
    });
  }

  // Divergence: has approved completions but users.rewardPoints == 0 (or missing)
  const diverged = report.filter(r => r.approvedCompletions > 0 && (r.users_rp === 0 || r.users_rp === undefined || r.users_rp === null));
  console.log('=== DIVERGED (approved completions but users.rewardPoints==0) ===', diverged.length);
  for (const r of diverged) console.log(JSON.stringify(r, null, 2));

  // Also: any child with approved completions at all
  const withApproved = report.filter(r => r.approvedCompletions > 0);
  console.log('=== CHILDREN WITH >=1 APPROVED COMPLETION ===', withApproved.length);
  for (const r of withApproved) console.log(JSON.stringify({ id: r.id, familyId: r.familyId, users_rp: r.users_rp, sum_rp: r.sum_rp, sum_weekly: r.sum_weekly, sum_status: r.sum_status, approved: r.approvedCompletions }));

  // Alisya working
  const alisya = report.find(r => r.id === 'NuyIJDP9fDNP2LiKynlsEyzur5N2');
  console.log('=== ALISYA (working Kemal child) ===', JSON.stringify(alisya, null, 2));

  process.exit(0);
}
main().catch(e => { console.error('ERR', e); process.exit(1); });
