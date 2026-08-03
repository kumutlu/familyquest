/** READ-ONLY deep dive: effect snapshots, behaviour events, redemptions, eligibility. */
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const svc = require('./../firebase-key.json');
initializeApp({ credential: cert(svc), projectId: 'familyquest-beta-402cb' });
const db = getFirestore();
const FID = '5s4Npeu55wPphLCsGAMP';
const CID = 'vc0iyHVfAcXnXQQbmFkr5HfJEkp2';
const ts = (v) => (v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v ?? null);

async function main() {
  console.log('CUTOVER 1785775585 =', new Date(1785775585 * 1000).toISOString());
  console.log('BASELINE 1785785277 =', new Date(1785785277 * 1000).toISOString());

  console.log('\n=== BASELINE EVENT FULL ===');
  const be = await db.doc(`families/${FID}/gamification_events/legacy_xp_baseline:${FID}:${CID}`).get();
  console.log(JSON.stringify(be.data(), (k, v) => (v && v._seconds ? new Date(v._seconds * 1000).toISOString() : v), 2));

  console.log('\n=== COMPLETION EFFECT SNAPSHOTS (chronological) ===');
  const comps = await db.collection(`families/${FID}/task_completions`).where('assigneeId', '==', CID).get();
  const rows = comps.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.approvedAt?._seconds ?? a.completedAt?._seconds ?? 0) - (b.approvedAt?._seconds ?? b.completedAt?._seconds ?? 0));
  let rp = 0, xp = 0;
  for (const c of rows) {
    const s = c.effectSnapshot || {};
    const pts = s.rewardPointsDelta ?? s.pointsDelta ?? c.awardedPoints ?? null;
    const xpd = s.xpAdjustment ?? s.xpDelta ?? null;
    rp += pts ?? 0; xp += xpd ?? 0;
    console.log([c.id.slice(-40), ts(c.approvedAt), 'status=' + c.status, 'rpDelta=' + pts, 'xp=' + xpd, 'runRP=' + rp, 'runXP=' + xp].join(' | '));
    if (c.effectSnapshot) console.log('     snap:', JSON.stringify(s));
  }
  console.log('TOTAL rp from completions =', rp, ' xp =', xp);

  console.log('\n=== BEHAVIOUR EVENTS for child ===');
  const bev = await db.collection(`families/${FID}/behaviour_events`).get();
  bev.docs.filter(d => d.data().childId === CID).forEach(d => {
    const v = d.data();
    console.log(d.id, ts(v.createdAt), v.type, 'points=' + (v.pointsDelta ?? v.rewardPointsDelta ?? 'n/a'), 'xp=' + (v.effectSnapshot?.xpAdjustment ?? 'n/a'), 'amount=' + v.amount);
  });

  console.log('\n=== ALL REDEMPTIONS (family) ===');
  const red = await db.collection(`families/${FID}/redemptions`).get();
  red.docs.forEach(d => console.log(d.id, JSON.stringify(d.data(), (k, v) => (v && v._seconds ? new Date(v._seconds * 1000).toISOString() : v))));

  console.log('\n=== REVERSALS / reversal_events for child ===');
  for (const c of ['reversals', 'reversal_events']) {
    const s = await db.collection(`families/${FID}/${c}`).get();
    s.docs.filter(d => d.data().childId === CID).forEach(d => console.log(c, d.id, JSON.stringify(d.data(), (k, v) => (v && v._seconds ? new Date(v._seconds * 1000).toISOString() : v))));
  }

  console.log('\n=== daily_eligibility for child ===');
  const de = await db.collection(`families/${FID}/daily_eligibility`).get();
  de.docs.filter(d => d.id.startsWith(CID)).forEach(d => console.log(d.id, JSON.stringify(d.data(), (k, v) => (v && v._seconds ? new Date(v._seconds * 1000).toISOString() : v))));

  console.log('\n=== daily_progress for child ===');
  const dp = await db.collection(`families/${FID}/daily_progress`).get();
  dp.docs.filter(d => d.id.includes(CID)).forEach(d => console.log(d.id, JSON.stringify(d.data(), (k, v) => (v && v._seconds ? new Date(v._seconds * 1000).toISOString() : v))));

  console.log('\n=== TASKS point values ===');
  const tasks = await db.collection(`families/${FID}/tasks`).get();
  tasks.docs.forEach(d => { const v = d.data(); console.log(d.id, '|', v.title, '| points=', v.points ?? v.pointsReward ?? v.rewardPoints, '| xp=', v.xp ?? v.xpReward ?? 'n/a', '| assignee=', v.assigneeId ?? v.childId); });
  process.exit(0);
}
main().catch(e => { console.error('ERR', e); process.exit(1); });
