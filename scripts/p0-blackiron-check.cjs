// P0 READ-ONLY: confirm Blackiron failing child completion states (shared root cause).
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const svc = require('../firebase-key.json');
admin.initializeApp({ credential: admin.cert(svc), projectId: 'familyquest-beta-402cb' });
const db = getFirestore();

function ts(d) { return d && typeof d === 'object' && '_seconds' in d ? new Date(d._seconds * 1000).toISOString() : d; }

async function main() {
  const fid = 'uTnrixcB4uvrZ5Xf44NV'; // The Blackirons
  const cid = 'nfeRa675XkdqoReRmU4c';
  console.log(`=== BLACKIRON CHILD ${cid} (family ${fid}) ===`);
  const c = await db.doc(`users/${cid}`).get();
  console.log('  users.rewardPoints:', c.data().rewardPoints, 'lifetimeXP:', c.data().lifetimeXP);
  const comps = await db.collection(`families/${fid}/task_completions`).where('assigneeId', '==', cid).where('status', '==', 'approved').get();
  let processed = 0, unprocessed = 0;
  for (const doc of comps.docs) {
    const d = doc.data();
    const p = !!d.gamificationProcessedAt;
    if (p) processed++; else unprocessed++;
    if (!p) console.log(`  UNPROCESSED: ${doc.id} approvedAt=${ts(d.approvedAt)} awardedPoints=${d.awardedPoints}`);
  }
  console.log(`  TOTAL approved=${comps.size} processed=${processed} unprocessed=${unprocessed}`);
  process.exit(0);
}
main().catch(e => { console.error('ERR', e); process.exit(1); });
