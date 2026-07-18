/**
 * Controlled migration for legacy Money Requests.
 *
 * Legacy requests created before the schema change that made child->parent
 * Money Requests go straight to `pending` may still be in `pending_acceptance`
 * with the parent as the requested-from person. The acceptance step is now
 * obsolete for parent targets, so such requests are stuck: a parent cannot
 * approve a `pending_acceptance` request (isValidMoneyRequestApproval requires
 * the payer ledger set up by acceptance) and there is no UI to accept it.
 *
 * This script flips `pending_acceptance` -> `pending` ONLY for requests whose
 * requestedFrom is a parent/owner. It is idempotent and reports (does not
 * mutate) any other pending_acceptance requests (e.g. sibling requests that
 * still require the requested sibling to accept).
 *
 * Usage (dry-run by default):
 *   GOOGLE_APPLICATION_CREDENTIALS=./familyquest-beta-402cb-firebase-adminsdk-fbsvc-a99bd8d895.json \
 *     node scripts/migrate-legacy-money-requests.cjs
 *   GOOGLE_APPLICATION_CREDENTIALS=./familyquest-beta-402cb-firebase-adminsdk-fbsvc-a99bd8d895.json \
 *     node scripts/migrate-legacy-money-requests.cjs --execute
 */
const { applicationDefault, getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const PROJECT_ID = 'familyquest-beta-402cb';
const app = getApps().find(c => c.name === 'mig') ?? initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID }, 'mig');
const db = getFirestore(app);
const execute = process.argv.includes('--execute');

const ts = () => new Date().toISOString();
const log = (m) => console.log(`[${ts()}] ${m}`);

(async () => {
  log(`Migration mode: ${execute ? 'EXECUTE' : 'DRY-RUN'}`);
  const fams = await db.collection('families').get();
  let migrated = 0;
  let skipped = 0;
  for (const fam of fams.docs) {
    const fid = fam.id;
    const snaps = await db.collection(`families/${fid}/money_requests`).where('status', '==', 'pending_acceptance').get();
    for (const s of snaps.docs) {
      const d = s.data();
      const requestedFromId = d.requestedFromId;
      if (!requestedFromId) { skipped++; log(`SKIP ${fid}/${s.id}: no requestedFromId`); continue; }
      const u = await db.collection('users').doc(requestedFromId).get();
      const role = u.exists ? u.data().role : null;
      if (role === 'parent' || role === 'owner') {
        log(`MIGRATE ${fid}/${s.id}: pending_acceptance -> pending (requestedFrom is ${role})`);
        if (execute) {
          await s.ref.update({ status: 'pending', migratedAt: FieldValue.serverTimestamp(), migratedFrom: 'pending_acceptance' });
        }
        migrated++;
      } else {
        log(`LEAVE ${fid}/${s.id}: pending_acceptance with requestedFrom role=${role} (requires acceptance by that user)`);
        skipped++;
      }
    }
  }
  log(`Done. migrated=${migrated} skipped=${skipped}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
