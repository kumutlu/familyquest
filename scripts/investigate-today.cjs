/** READ-ONLY: today's completions, occurrences, task titles, full reconciliation. */
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const svc = require('./../firebase-key.json');
initializeApp({ credential: cert(svc), projectId: 'familyquest-beta-402cb' });
const db = getFirestore();
const FID = '5s4Npeu55wPphLCsGAMP';
const CID = 'vc0iyHVfAcXnXQQbmFkr5HfJEkp2';
const iso = (v) => (v && typeof v.toDate === 'function' ? v.toDate().toISOString() : (v && v._seconds ? new Date(v._seconds * 1000).toISOString() : null));
const S = (o) => JSON.stringify(o, (k, v) => (v && v._seconds ? new Date(v._seconds * 1000).toISOString() : v));
const TODAY_START = Date.parse('2026-08-02T23:00:00Z'); // Europe/London 2026-08-03 00:00

async function main() {
  const fam = await db.doc(`families/${FID}`).get();
  console.log('family timezone =', fam.data().timezone ?? fam.data().timeZone ?? '(unset)');
  console.log('gamificationMigration =', S(fam.data().gamificationMigration));

  const comps = await db.collection(`families/${FID}/task_completions`).where('assigneeId', '==', CID).get();
  const tasks = {};
  (await db.collection(`families/${FID}/tasks`).get()).docs.forEach(d => (tasks[d.id] = d.data()));

  const all = comps.docs.map(d => ({ id: d.id, ...d.data() }));
  const today = all.filter(c => {
    const t = Date.parse(iso(c.completedAt) || iso(c.approvedAt) || iso(c.reviewedAt) || 0);
    return t >= TODAY_START;
  }).sort((a, b) => Date.parse(iso(a.completedAt) || iso(a.approvedAt)) - Date.parse(iso(b.completedAt) || iso(b.approvedAt)));

  console.log('\n=== TODAY COMPLETIONS (Europe/London 2026-08-03) === count', today.length);
  let approvedPts = 0, pendingPts = 0;
  for (const c of today) {
    const t = tasks[c.taskId] || {};
    const pts = t.points ?? t.pointsReward ?? 0;
    if (c.status === 'approved') approvedPts += pts; else pendingPts += pts;
    console.log(JSON.stringify({
      completionId: c.id, taskId: c.taskId, title: t.title, taskPoints: pts,
      completedAt: iso(c.completedAt), status: c.status, approvedAt: iso(c.approvedAt),
      reviewedAt: iso(c.reviewedAt), reviewedBy: c.reviewedBy, reviewedByName: c.reviewedByName,
      autoApprove: t.autoApprove ?? t.requiresApproval ?? null,
      awardedPoints: c.awardedPoints ?? null,
      gamificationProcessedAt: iso(c.gamificationProcessedAt),
      effectSnapshot: c.effectSnapshot ?? null,
      postCutover: Date.parse(iso(c.approvedAt) || 0) > Date.parse('2026-08-03T16:46:25Z'),
    }));
  }
  console.log('TODAY approved points =', approvedPts, ' non-approved points =', pendingPts);

  console.log('\n=== ALL COMPLETIONS BY STATUS ===');
  const byStatus = {};
  all.forEach(c => (byStatus[c.status] = (byStatus[c.status] || 0) + 1));
  console.log(byStatus);

  console.log('\n=== TASK OCCURRENCES (child) today ===');
  const occ = await db.collection(`families/${FID}/task_occurrences`).get();
  occ.docs.filter(d => JSON.stringify(d.data()).includes(CID)).forEach(d => {
    const v = d.data();
    const t = Date.parse(iso(v.updatedAt) || iso(v.createdAt) || 0);
    if (t >= TODAY_START) console.log(d.id, S(v));
  });
  console.log('total occurrences in family:', occ.size);

  console.log('\n=== gamification_events (whole family) ===');
  const ev = await db.collection(`families/${FID}/gamification_events`).get();
  console.log('family event count:', ev.size);
  ev.docs.slice(0, 20).forEach(d => console.log(d.id, d.data().eventType, 'child=' + d.data().childId, 'xp=' + d.data().xpDelta));
  process.exit(0);
}
main().catch(e => { console.error('ERR', e); process.exit(1); });
