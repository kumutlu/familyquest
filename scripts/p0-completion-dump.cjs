// P0 READ-ONLY: dump full completion docs for new test child + Alisya, compare approvedAt vs cutoverAt.
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const svc = require('../firebase-key.json');
admin.initializeApp({ credential: admin.cert(svc), projectId: 'familyquest-beta-402cb' });
const db = getFirestore();

function ts(d) { return d && typeof d === 'object' && '_seconds' in d ? new Date(d._seconds * 1000).toISOString() : d; }

async function dumpChild(fid, cid, label) {
  console.log(`\n=== ${label}: family=${fid} child=${cid} ===`);
  const f = await db.doc(`families/${fid}`).get();
  const mig = f.data().gamificationMigration;
  console.log('  cutoverAt:', ts(mig.cutoverAt), 'status:', mig.status);
  const comps = await db.collection(`families/${fid}/task_completions`).where('assigneeId', '==', cid).where('status', '==', 'approved').get();
  for (const c of comps.docs) {
    const d = c.data();
    console.log(`  --- completion ${c.id}`);
    console.log('    status:', d.status);
    console.log('    approvedAt:', ts(d.approvedAt));
    console.log('    completedAt:', ts(d.completedAt));
    console.log('    createdAt:', ts(d.createdAt));
    console.log('    awardedPoints:', d.awardedPoints);
    console.log('    has gamificationEffectSnapshot:', !!d.gamificationEffectSnapshot);
    console.log('    has gamificationProcessedAt:', !!d.gamificationProcessedAt);
    console.log('    has effectSnapshot:', !!d.effectSnapshot);
    console.log('    reviewedBy:', d.reviewedBy);
    console.log('    taskId:', d.taskId);
  }
}

async function main() {
  await dumpChild('UoajLo3d1onq4tXblk9U', 'NPGFIkRUHZHgZqH5nLQx', 'NEW TEST CHILD');
  await dumpChild('5s4Npeu55wPphLCsGAMP', 'NuyIJDP9fDNP2LiKynlsEyzur5N2', 'ALISYA (working)');
  process.exit(0);
}
main().catch(e => { console.error('ERR', e); process.exit(1); });
