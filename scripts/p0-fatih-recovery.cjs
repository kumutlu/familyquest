'use strict'
// ---------------------------------------------------------------------------
// P0 INCIDENT — SAFE FATIH RECOVERY (one-off ADMIN script)
// ---------------------------------------------------------------------------
// Root cause: unqualified taskQueue('processFamilyDeletion') resolved to
// us-central1 while the worker lives in europe-west1; enqueue failures were
// swallowed, leaving familyDeletionJobs/{familyId} queued forever while
// accountDeletionJobs/{uid} kept the pending owner-account-deletion intent.
//
// This script cancels ONLY the pending account-deletion intent by deleting
// accountDeletionJobs/{uid}. The existing family-deletion state machine then
// finishes normally via recoverFamilyDeletionJobs -> processFamilyDeletion.
//
// DRY-RUN BY DEFAULT. Execution requires --execute.
//
// Preconditions verified before ANY write (abort with zero writes otherwise):
//   users/{uid}            exists, familyId + role === owner match
//   families/{familyId}    exists, ownerId matches, lifecycleState deleting
//   familyDeletionJobs/fid exists, state queued/retry_wait, attemptCount 0
//   accountDeletionJobs/uid exists, reason owner_account_deletion, fid match
//   Firebase Auth user     exists, Google provider, enabled
//
// Usage:
//   node scripts/p0-fatih-recovery.cjs             # dry-run (no writes)
//   node scripts/p0-fatih-recovery.cjs --execute   # perform the single delete
// ---------------------------------------------------------------------------

const fs = require('fs')
const path = require('path')
const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { getAuth } = require('firebase-admin/auth')

const UID = 'Rm6gsjXK4hUE5RUluBs0myTflJi2'
const FAMILY_ID = 'QSLihVvfmbI7ooKq9Ilp'
const SERVICE_ACCOUNT = path.join(
  __dirname,
  '..',
  'familyquest-beta-402cb-firebase-adminsdk-fbsvc-a99bd8d895.json'
)

const EXECUTE = process.argv.includes('--execute')

function fail(msg) {
  console.error(`\n[ABORT — NO WRITES PERFORMED] ${msg}`)
  process.exit(1)
}

async function main() {
  if (!EXECUTE) {
    console.log('MODE: DRY-RUN (pass --execute to perform the single delete)\n')
  } else {
    console.log('MODE: EXECUTE\n')
  }

  const app = initializeApp({ credential: cert(require(SERVICE_ACCOUNT)) })
  const db = getFirestore(app)
  const auth = getAuth(app)

  const failures = []
  const check = (label, ok, detail) => {
    console.log(`${ok ? '  OK  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
    if (!ok) failures.push(label)
  }

  // --- users/{uid} ---------------------------------------------------------
  const userSnap = await db.doc(`users/${UID}`).get()
  const user = userSnap.exists ? userSnap.data() : null
  check(`users/${UID} exists`, !!user)
  check('user.familyId matches', user && user.familyId === FAMILY_ID,
    user ? `got=${user.familyId}` : '')
  check('user.role === "owner"', user && user.role === 'owner',
    user ? `got=${user.role}` : '')

  // --- families/{familyId} -------------------------------------------------
  const famSnap = await db.doc(`families/${FAMILY_ID}`).get()
  const fam = famSnap.exists ? famSnap.data() : null
  check(`families/${FAMILY_ID} exists`, !!fam)
  check('family.ownerId matches UID', fam && fam.ownerId === UID,
    fam ? `got=${fam.ownerId}` : '')
  check('family.lifecycleState === "deleting"', fam && fam.lifecycleState === 'deleting',
    fam ? `got=${fam.lifecycleState}` : '')

  // --- familyDeletionJobs/{familyId} ---------------------------------------
  const jobSnap = await db.doc(`familyDeletionJobs/${FAMILY_ID}`).get()
  const job = jobSnap.exists ? jobSnap.data() : null
  check(`familyDeletionJobs/${FAMILY_ID} exists`, !!job)
  const queuedStates = ['queued', 'retry_wait']
  check('job.state is queued-equivalent', job && queuedStates.includes(job.state),
    job ? `got=${job.state}` : '')
  check('job.attemptCount === 0', job && (job.attemptCount ?? 0) === 0,
    job ? `got=${job.attemptCount ?? 0}` : '')
  check('job.familyId matches', job && job.familyId === FAMILY_ID,
    job ? `got=${job.familyId}` : '')

  // --- accountDeletionJobs/{uid} -------------------------------------------
  const acctSnap = await db.doc(`accountDeletionJobs/${UID}`).get()
  const acct = acctSnap.exists ? acctSnap.data() : null
  check(`accountDeletionJobs/${UID} exists`, !!acct)
  check('reason === "owner_account_deletion"',
    acct && acct.reason === 'owner_account_deletion', acct ? `got=${acct.reason}` : '')
  check('account job familyId matches', acct && acct.familyId === FAMILY_ID,
    acct ? `got=${acct.familyId}` : '')

  // --- Firebase Auth -------------------------------------------------------
  let authUser = null
  try { authUser = await auth.getUser(UID) } catch (_) { /* not found */ }
  check('Firebase Auth user exists', !!authUser)
  const hasGoogle = !!(authUser && authUser.providerData.some((p) => p.providerId === 'google.com'))
  check('provider includes google.com', hasGoogle,
    authUser ? authUser.providerData.map((p) => p.providerId).join(',') : '')
  check('Auth account enabled', !!authUser && !authUser.disabled)

  if (failures.length > 0) {
    fail(`${failures.length} precondition(s) failed: ${failures.join('; ')}`)
  }

  // -------------------------------------------------------------------------
  // All preconditions satisfied.
  // -------------------------------------------------------------------------
  console.log('\n=== ALL PRECONDITIONS SATISFIED ===\n')

  if (!EXECUTE) {
    console.log('DRY-RUN PLAN — documents that would be affected:')
    console.log(`  DELETE  accountDeletionJobs/${UID}          (the ONLY write)`)
    console.log('')
    console.log('Explicitly NOT touched:')
    console.log(`  - Firebase Auth user ${UID}: NOT modified, NOT deleted`)
    console.log(`  - users/${UID}: NOT manually modified`)
    console.log(`  - families/${FAMILY_ID}: NOT manually modified/deleted`)
    console.log(`  - familyDeletionJobs/${FAMILY_ID}: NOT manually modified`)
    console.log('    (the state machine advances it normally after the fix deploys)')
    console.log('\nDry-run complete. No writes performed.')
    return
  }

  // --- EXECUTION: exactly one write ----------------------------------------
  await db.doc(`accountDeletionJobs/${UID}`).delete()

  // Post-write verification
  const recheck = await db.doc(`accountDeletionJobs/${UID}`).get()
  if (recheck.exists) fail('accountDeletionJobs still exists after delete')

  const authAfter = await auth.getUser(UID)
  if (!authAfter || authAfter.disabled) fail('Auth user missing/disabled after delete')

  const jobAfter = await db.doc(`familyDeletionJobs/${FAMILY_ID}`).get()
  if (!jobAfter.exists) fail('familyDeletionJobs disappeared unexpectedly')

  const famAfter = await db.doc(`families/${FAMILY_ID}`).get()
  if (!famAfter.exists || famAfter.data().lifecycleState !== 'deleting') {
    fail('family no longer in deleting state unexpectedly')
  }

  console.log('=== AUDIT REPORT ===')
  console.log(`  DELETED : accountDeletionJobs/${UID}`)
  console.log(`  VERIFIED: document gone after re-read`)
  console.log(`  VERIFIED: Auth user still exists and enabled`)
  console.log(`  VERIFIED: familyDeletionJobs/${FAMILY_ID} still present (state=${jobAfter.data().state})`)
  console.log(`  VERIFIED: families/${FAMILY_ID} remains lifecycleState=deleting`)
  console.log('\nDone. Next: wait for recoverFamilyDeletionJobs to enqueue after its normal interval.')
}

main().catch((err) => {
  console.error('[ABORT]', err && err.message ? err.message : err)
  process.exit(1)
})
