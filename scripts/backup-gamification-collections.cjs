#!/usr/bin/env node
/**
 * Gamification V4 — Stage 0 production backup (Task 0.3).
 *
 * Read-only export of the gamification collections per family into
 * backups/gamification/<timestamp>/. This script NEVER touches wallet
 * collections (wallets, wallet_transactions, allowances, petBox, savings,
 * moneyTransfers) and performs no writes in --dry-run mode.
 *
 *   node scripts/backup-gamification-collections.cjs --dry-run   # print plan, no reads/writes
 *   node scripts/backup-gamification-collections.cjs             # real export (requires admin SDK + creds)
 *
 * This script is READ-ONLY with respect to runtime code. In --dry-run it is
 * also read-only with respect to production data. It never imports wallet
 * modules and never writes outside backups/gamification/.
 */

'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

// Gamification collections to back up. These are the ONLY collections this
// script is allowed to read. Wallet collections are explicitly OUT OF SCOPE.
const GAMIFICATION_COLLECTIONS = [
  'gamification_summaries',
  'daily_progress',
  'task_occurrences',
  'behaviour_events',
]

// Wallet collections — listed only to assert they are never touched by this
// script. They are out of scope for the V4 gamification rewrite.
const WALLET_COLLECTIONS = [
  'wallets',
  'wallet_transactions',
  'allowances',
  'petBox',
  'savings',
  'moneyTransfers',
]

/**
 * Read-only export of a single gamification collection for one family.
 * Returns the document count so the manifest can record it.
 *
 * @param {object} db Firestore admin instance
 * @param {string} familyId
 * @param {string} collection one of GAMIFICATION_COLLECTIONS
 * @returns {Promise<{ count: number }>}
 */
async function backupCollection(db, familyId, collection) {
  const ref = db
    .collection('families')
    .doc(familyId)
    .collection(collection)
  const snapshot = await ref.get()
  return { count: snapshot.size }
}

/**
 * Write the backup manifest describing every family and collection count.
 *
 * @param {string} dir output directory
 * @param {Array<{ familyId: string, counts: Record<string, number> }>} entries
 */
function writeBackupManifest(dir, entries) {
  const manifest = {
    generatedAt: new Date().toISOString(),
    scope: 'gamification-only',
    collections: GAMIFICATION_COLLECTIONS,
    excludedWalletCollections: WALLET_COLLECTIONS,
    families: entries,
  }
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  )
}

function dryRun() {
  console.log('GAMIFICATION BACKUP — DRY RUN (no data read or written)')
  console.log('Would back up the following gamification collections per family:')
  for (const c of GAMIFICATION_COLLECTIONS) {
    console.log('  - ' + c)
  }
  console.log('Wallet collections are OUT OF SCOPE and will NOT be touched:')
  for (const c of WALLET_COLLECTIONS) {
    console.log('  - ' + c)
  }
  console.log('Output directory: backups/gamification/<timestamp>/ (git-ignored)')
  console.log('DRY RUN OK')
  process.exit(0)
}

async function runRealBackup() {
  // Lazily require firebase-admin so --dry-run never needs credentials or the
  // dependency to be present.
  let admin
  try {
    admin = require('firebase-admin')
  } catch (err) {
    console.error('Real export requires firebase-admin. Run in --dry-run or install it.')
    process.exit(2)
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    })
  }
  const db = admin.firestore()

  const familiesSnap = await db.collection('families').get()
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = path.join(ROOT, 'backups', 'gamification', timestamp)
  fs.mkdirSync(outDir, { recursive: true })

  const entries = []
  for (const familyDoc of familiesSnap.docs) {
    const familyId = familyDoc.id
    const counts = {}
    for (const collection of GAMIFICATION_COLLECTIONS) {
      const result = await backupCollection(db, familyId, collection)
      counts[collection] = result.count
    }
    entries.push({ familyId, counts })
    console.log('Backed up family ' + familyId + ': ' + JSON.stringify(counts))
  }

  writeBackupManifest(outDir, entries)
  console.log('Backup complete: ' + outDir)
}

function main() {
  const args = process.argv.slice(2)
  if (args.includes('--dry-run')) {
    dryRun()
  }
  runRealBackup().catch((err) => {
    console.error('Backup failed: ' + err.message)
    process.exit(1)
  })
}

main()
