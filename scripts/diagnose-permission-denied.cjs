#!/usr/bin/env node
'use strict'
/**
 * P0 permission-denied investigation — READ-ONLY production snapshot.
 *
 * Captures exactly the documents and identity facts the deployed Firestore
 * rules evaluate for the five failing flows (behaviour positive/negative/
 * penalty, reward redemption, money request) so the failure can be replayed
 * against the emulator with production-identical inputs.
 *
 * This script NEVER writes to Firestore and NEVER changes auth state.
 *
 *   node scripts/diagnose-permission-denied.cjs --family <familyId> [--out <file>]
 *   node scripts/diagnose-permission-denied.cjs --list-families
 */

const fs = require('fs')
const path = require('path')
const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { getAuth } = require('firebase-admin/auth')

const ROOT = path.resolve(__dirname, '..')

class CliError extends Error {}

function printUsage(out) {
  ;(out || process.stdout).write(
    'diagnose-permission-denied — read-only capture of the rule inputs for the P0 flows\n' +
      '\n' +
      'Usage:\n' +
      '  node scripts/diagnose-permission-denied.cjs --family <familyId> [--out <file>]\n' +
      '  node scripts/diagnose-permission-denied.cjs --list-families\n' +
      '\n' +
      'Options:\n' +
      '  --family <id>     Family to capture\n' +
      '  --out <file>      Snapshot destination (default: tmp/p0-prod-snapshot.json)\n' +
      '  --list-families   List families (id + name) and exit\n' +
      '  --help, -h        Show this help and exit 0\n' +
      '\n' +
      'READ-ONLY: performs no Firestore writes and no auth mutations.\n',
  )
}

function parseArgs(argv) {
  const opts = { family: null, out: null, list: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') { opts.help = true; continue }
    if (a === '--list-families') { opts.list = true; continue }
    if (a === '--family' || a === '--out') {
      const v = argv[i + 1]
      if (v === undefined || v.charAt(0) === '-') {
        throw new CliError('Missing required value for ' + a)
      }
      if (a === '--family') opts.family = v
      else opts.out = v
      i++
      continue
    }
    throw new CliError('Unknown argument: ' + a)
  }
  if (!opts.help && !opts.list && !opts.family) {
    throw new CliError('Missing required --family <familyId> (or use --list-families).')
  }
  return opts
}

function credentials() {
  const keyPath = path.join(ROOT, 'firebase-key.json')
  if (!fs.existsSync(keyPath)) {
    throw new CliError('firebase-key.json not found; cannot read production read-only.')
  }
  return cert(require(keyPath))
}

function plain(value) {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) return value.map(plain)
  if (typeof value === 'object') {
    if (typeof value.toDate === 'function') return { __timestamp: value.toDate().toISOString() }
    const out = {}
    for (const k of Object.keys(value).sort()) out[k] = plain(value[k])
    return out
  }
  return value
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) { printUsage(); return }

  initializeApp({ credential: credentials(), projectId: 'familyquest-beta-402cb' })
  const db = getFirestore()
  const auth = getAuth()

  if (opts.list) {
    const snap = await db.collection('families').get()
    for (const d of snap.docs) console.log(d.id, '|', d.data().name)
    return
  }

  const familyId = opts.family
  const familyDoc = await db.doc(`families/${familyId}`).get()
  if (!familyDoc.exists) throw new CliError('Family not found: ' + familyId)

  const users = {}
  const identities = {}
  const usersSnap = await db.collection('users').where('familyId', '==', familyId).get()
  for (const u of usersSnap.docs) {
    users[u.id] = plain(u.data())
    try {
      const rec = await auth.getUser(u.id)
      identities[u.id] = {
        uid: rec.uid,
        email: rec.email ?? null,
        customClaims: rec.customClaims ?? {},
        disabled: rec.disabled,
        lastSignInTime: rec.metadata.lastSignInTime ?? null,
      }
    } catch (e) {
      identities[u.id] = { uid: u.id, missingAuthUser: true, code: e.code }
    }
  }

  const sub = {}
  for (const coll of ['rewards', 'wallets', 'tasks']) {
    const snap = await db.collection(`families/${familyId}/${coll}`).get()
    sub[coll] = {}
    for (const d of snap.docs) sub[coll][d.id] = plain(d.data())
  }

  const snapshot = {
    capturedAt: new Date().toISOString(),
    projectId: 'familyquest-beta-402cb',
    familyId,
    family: plain(familyDoc.data()),
    users,
    identities,
    subcollections: sub,
  }

  const outFile = opts.out || path.join(ROOT, 'tmp', 'p0-prod-snapshot.json')
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2) + '\n')
  console.log('Wrote read-only production snapshot: ' + outFile)
  console.log(
    'family=' + familyId +
      ' users=' + Object.keys(users).length +
      ' rewards=' + Object.keys(sub.rewards).length +
      ' wallets=' + Object.keys(sub.wallets).length,
  )
  for (const [uid, id] of Object.entries(identities)) {
    console.log(
      '  uid=' + uid +
        ' role=' + JSON.stringify(users[uid].role) +
        ' claims=' + JSON.stringify(id.customClaims || {}) +
        ' displayName=' + JSON.stringify(users[uid].displayName),
    )
  }
}

main().catch((err) => {
  if (err instanceof CliError) {
    console.error(err.message)
    printUsage(process.stderr)
    process.exit(2)
  }
  console.error('diagnose-permission-denied failed: ' + (err && err.message))
  process.exit(1)
})
