// P0 READ-ONLY probe: family gamificationMigration status + children rewardPoints.
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const svc = require('../firebase-key.json');
admin.initializeApp({ credential: admin.cert(svc), projectId: 'familyquest-beta-402cb' });
const db = getFirestore();

const FAMILIES = ['UoajLo3d1onq4tXblk9U', '7spcPglRvDXG1UtaKE0M', 'OsIj1GEcVXHslvxzw9ET', 'iIpfFGqCd3HiHCLZ4ekf', 'uTnrixcB4uvrZ5Xf44NV', '5s4Npeu55wPphLCsGAMP'];

async function main() {
  for (const fid of FAMILIES) {
    const f = await db.doc(`families/${fid}`).get();
    if (!f.exists) { console.log(`FAMILY ${fid}: <missing>`); continue; }
    const d = f.data();
    const mig = d.gamificationMigration;
    console.log(`\n=== FAMILY ${fid} name="${(d.name||'')}" ===`);
    console.log('  gamificationMigration:', JSON.stringify(mig));
    // children
    const users = await db.collection('users').where('familyId', '==', fid).where('role', '==', 'child').get();
    for (const u of users.docs) {
      const ud = u.data();
      // approved completion count
      const comps = await db.collection(`families/${fid}/task_completions`).where('assigneeId', '==', u.id).where('status', '==', 'approved').get();
      console.log(`  child ${u.id}: rp=${ud.rewardPoints} lifetimeXP=${ud.lifetimeXP} approvedCompletions=${comps.size}`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error('ERR', e); process.exit(1); });
