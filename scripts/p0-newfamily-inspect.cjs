// P0 READ-ONLY: inspect new test family tasks, child, occurrences, eligibility.
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const svc = require('../firebase-key.json');
admin.initializeApp({ credential: admin.cert(svc), projectId: 'familyquest-beta-402cb' });
const db = getFirestore();

async function main() {
  const fid = 'UoajLo3d1onq4tXblk9U';
  const cid = 'NPGFIkRUHZHgZqH5nLQx';

  const f = await db.doc(`families/${fid}`).get();
  const fd = f.data();
  console.log('=== FAMILY ===');
  console.log('  gamification field present:', !!fd.gamification, JSON.stringify(fd.gamification));
  console.log('  timezone:', fd.timezone);

  console.log('=== CHILD ===');
  const c = await db.doc(`users/${cid}`).get();
  const cd = c.data();
  console.log('  exists:', c.exists, 'role:', cd.role, 'familyId:', cd.familyId, 'status:', cd.status, 'disabled:', cd.disabled, 'rewardPoints:', cd.rewardPoints);

  console.log('=== TASKS ===');
  for (const tid of ['WQokxFy7B4qc9m7y714m', 'sqLFfl7ZgZRWJdFk5T10']) {
    const t = await db.doc(`families/${fid}/tasks/${tid}`).get();
    const td = t.data();
    console.log(`  task ${tid}: exists=${t.exists} pointsReward=${td && td.pointsReward} type=${td && td.type} assigneeId=${td && td.assigneeId} requiresApproval=${td && td.requiresApproval}`);
  }

  console.log('=== OCCURRENCES / ELIGIBILITY / PROGRESS (dayKey 2026-08-07) ===');
  const occ = await db.collection(`families/${fid}/task_occurrences`).get();
  console.log('  task_occurrences count:', occ.size);
  for (const o of occ.docs) console.log('    occ:', o.id, JSON.stringify(o.data()).slice(0, 200));
  const elig = await db.doc(`families/${fid}/daily_eligibility/${cid}:2026-08-07`).get();
  console.log('  daily_eligibility exists:', elig.exists);
  const prog = await db.doc(`families/${fid}/daily_progress/${cid}:2026-08-07`).get();
  console.log('  daily_progress exists:', prog.exists);

  console.log('=== SUMMARY ===');
  const s = await db.doc(`families/${fid}/gamification_summaries/${cid}`).get();
  console.log('  summary exists:', s.exists, s.exists ? JSON.stringify(s.data()) : '');

  process.exit(0);
}
main().catch(e => { console.error('ERR', e); process.exit(1); });
