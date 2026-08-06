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

// Shared, safe Firebase Admin initializer (modular app API). Replaces the
// legacy namespace access that is not exposed by the installed module shape.
const { initFirestore: initAdminFirestore } = require('./firebase-admin-init.cjs')

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

/**
 * Resolve the Firestore handle. In --emulator mode no application default
 * credentials are used, so production can never be reached. Delegates to the
 * shared modular initializer.
 */
function initFirestore(opts) {
  return initAdminFirestore(opts)
}

async function runRealBackup(opts) {
  const db = initFirestore(opts)

  const familiesSnap = await db.collection('families').get()
  if (!familiesSnap || !Array.isArray(familiesSnap.docs)) {
    throw new CliError('Unexpected empty snapshot for collection "families".')
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = opts.output
    ? path.resolve(opts.output)
    : path.join(ROOT, 'backups', 'gamification', timestamp)
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

// Controlled CLI error — never a raw TypeError. Carries a clear message and is
// rendered together with usage by the top-level handler.
class CliError extends Error {
  constructor(message) {
    super(message)
    this.name = 'CliError'
  }
}

function printUsage(out) {
  const w = out || process.stdout
  w.write(
    'backup-gamification-collections — read-only backup of gamification collections\n' +
    '\n' +
    'Usage:\n' +
    '  node scripts/backup-gamification-collections.cjs [options]\n' +
    '\n' +
    'Options:\n' +
    '  --help, -h     Show this help and exit 0 (no Firebase, no writes)\n' +
    '  --dry-run      Print the backup plan and exit 0 (no reads/writes)\n' +
    '  --output <dir> Write the backup into <dir> instead of\n' +
    '                 backups/gamification/<timestamp>/\n' +
    '  --emulator     Read from the local Firestore emulator only\n' +
    '                 (requires FIRESTORE_EMULATOR_HOST; never uses prod creds)\n' +
    '\n' +
    'With no options, performs a real read-only backup (requires firebase-admin\n' +
    'and application default credentials). This tool NEVER touches wallet\n' +
    'collections and performs no writes in --dry-run mode.\n'
  )
}

// Parse CLI arguments. Performs NO Firebase/Admin SDK initialization and NO
// filesystem writes. Throws CliError for unknown flags.
function parseArgs(args) {
  const opts = { help: false, dryRun: false, output: null, emulator: false }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--help' || a === '-h') {
      opts.help = true
      continue
    }
    if (a === '--dry-run') {
      opts.dryRun = true
      continue
    }
    if (a === '--emulator') {
      opts.emulator = true
      continue
    }
    if (a === '--output') {
      const val = args[i + 1]
      if (val === undefined || val.charAt(0) === '-') {
        throw new CliError('Missing required value for --output.\nExpected: --output <directory>')
      }
      opts.output = val
      i++
      continue
    }
    throw new CliError('Unknown argument: ' + a + '\nRun with --help for usage.')
  }
  return opts
}

function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (err) {
    if (err instanceof CliError) {
      console.error(err.message)
      printUsage(process.stderr)
      process.exit(2)
    }
    throw err
  }
  if (opts.help) {
    printUsage()
    return
  }
  if (opts.dryRun) {
    dryRun()
    return
  }
  runRealBackup(opts).catch((err) => {
    console.error('Backup failed: ' + err.message)
    process.exit(1)
  })
}

main()
