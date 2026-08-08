#!/usr/bin/env node
'use strict'
// Wallet snapshot — Task 0.4 (gamification V4 rewrite). Read-only SHA-256 of
// every protected wallet document so the later rewrite can prove it never
// altered wallet data. Never writes; never reads gamification collections;
// for user docs it projects ONLY money fields. Discovered protected wallet
// paths (exact) are documented in docs/gamification-v4/00-freeze-inventory.md
// and the task return summary; the provisional list (allowances, petBox,
// savings, moneyTransfers) is WRONG — those names do not exist.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')
const ROOT = path.resolve(__dirname, '..')
const PROTECTED_FAMILY_COLLECTIONS = [
  'wallets',
  'wallet_transactions',
  'savings_goals',
  'funds',
  'fund_transactions',
  'petbox_requests',
  'transfer_requests',
  'money_requests',
  'redemptions',
  'goal_requests',
  'reversals',
  'reversal_events',
]
const SAVINGS_GOAL_SUBCOLLECTIONS = [
  'contributions',
  'goal_ledger',
  'match_proposals',
  'goal_requests',
]
// Money fields projected from users/{uid} (gamification fields excluded).
const USER_WALLET_FIELDS = [
  'walletBalance',
  'lastGoalTxId',
  'lastManualTxId',
  'lastTransferTxId',
  'lastTransferReqId',
  'lastPenaltyTxId',
  'lastFundTxId',
]
function readOnlyError(method) {
  return new Error('WALLET-SNAPSHOT SAFETY: write method "' + method + '" is forbidden; this tool is read-only.')
}
function normalizeValue(v) {
  if (v === null || v === undefined) return null
  if (v && typeof v === 'object') {
    if (typeof v._seconds === 'number' && typeof v._nanoseconds === 'number') {
      return { __ts: { seconds: v._seconds, nanoseconds: v._nanoseconds } }
    }
    if (typeof v.latitude === 'number' && typeof v.longitude === 'number') {
      return { __geo: { latitude: v.latitude, longitude: v.longitude } }
    }
    if (typeof v.path === 'string' && typeof v.collection === 'function') return { __ref: v.path }
    if (typeof v.toBase64 === 'function') return { __bytes: v.toBase64() }
    if (Array.isArray(v)) return v.map(normalizeValue)
    const out = {}
    for (const k of Object.keys(v).sort()) out[k] = normalizeValue(v[k])
    return out
  }
  return v
}
function canonicalize(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'num:NaN'
    if (value === 0 && 1 / value === -Infinity) return 'num:-0'
    return Number.isInteger(value) ? 'i:' + value : 'f:' + value
  }
  if (typeof value === 'string') return 's:' + value
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']'
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}'
  }
  return 'u:' + String(value)
}
function sha256Hex(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex')
}
function hashData(data) {
  return sha256Hex(canonicalize(normalizeValue(data)))
}
function projectUserWalletFields(data) {
  const out = {}
  for (const f of USER_WALLET_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, f)) out[f] = data[f]
  }
  return out
}
function buildManifest(entries, opts) {
  const byColl = new Map()
  for (const e of entries) {
    if (!byColl.has(e.collectionPath)) byColl.set(e.collectionPath, [])
    byColl.get(e.collectionPath).push(e)
  }
  const collections = {}
  const collOrder = [...byColl.keys()].sort()
  const globalParts = []
  let totalCount = 0
  for (const coll of collOrder) {
    const docs = byColl.get(coll).slice().sort((a, b) => (a.docPath < b.docPath ? -1 : a.docPath > b.docPath ? 1 : 0))
    const docHashes = {}
    const collParts = []
    for (const d of docs) {
      const h = hashData(d.data)
      docHashes[d.docPath] = h
      collParts.push(d.docPath + ' ' + h)
    }
    const collHash = sha256Hex(collParts.join(' '))
    collections[coll] = { count: docs.length, sha256: collHash, docs: docHashes }
    totalCount += docs.length
    globalParts.push(coll + ' ' + collHash)
  }
  const globalSha256 = sha256Hex(globalParts.join(' '))
  return {
    tool: 'wallet-snapshot',
    generatedAt: (opts && opts.generatedAt) || new Date().toISOString(),
    projectId: (opts && opts.projectId) || null,
    totalCount,
    globalSha256,
    collections,
  }
}
function verifyManifest(manifest, entries) {
  const current = buildManifest(entries, { projectId: manifest.projectId, generatedAt: manifest.generatedAt })
  const mismatches = []
  const curCols = current.collections
  const manCols = manifest.collections
  const allCols = new Set([...Object.keys(curCols), ...Object.keys(manCols)])
  for (const coll of allCols) {
    const m = manCols[coll]
    const c = curCols[coll]
    if (!m) {
      for (const p of Object.keys(c.docs)) mismatches.push({ type: 'added', path: p })
      continue
    }
    if (!c) {
      for (const p of Object.keys(m.docs)) mismatches.push({ type: 'deleted', path: p })
      continue
    }
    const allDocs = new Set([...Object.keys(c.docs), ...Object.keys(m.docs)])
    for (const p of allDocs) {
      if (!m.docs[p]) mismatches.push({ type: 'added', path: p })
      else if (!c.docs[p]) mismatches.push({ type: 'deleted', path: p })
      else if (m.docs[p] !== c.docs[p]) mismatches.push({ type: 'modified', path: p })
    }
  }
  return { ok: mismatches.length === 0, mismatches }
}
function formatReport(mismatches) {
  const lines = []
  for (const m of mismatches) lines.push(m.type.toUpperCase() + ' ' + m.path)
  return lines.join('\n')
}
class ReadOnlyDoc {
  constructor(ref) { this._ref = ref; this.id = ref.id; this.path = ref.path }
  get() { return this._ref.get() }
  listCollections() { return this._ref.listCollections() }
  collection(s) { return new ReadOnlyCollection(this._ref.collection(s)) }
  set() { throw readOnlyError('doc.set') }
  update() { throw readOnlyError('doc.update') }
  delete() { throw readOnlyError('doc.delete') }
  create() { throw readOnlyError('doc.create') }
}
class ReadOnlyCollection {
  constructor(ref) { this._ref = ref }
  doc(id) { return new ReadOnlyDoc(id == null ? this._ref.doc() : this._ref.doc(id)) }
  get() { return this._ref.get() }
  where(...a) { this._ref.where(...a); return this }
  orderBy(...a) { this._ref.orderBy(...a); return this }
  limit(...a) { this._ref.limit(...a); return this }
  add() { throw readOnlyError('collection.add') }
}
class ReadOnlyFirestore {
  constructor(db) { this._db = db }
  collection(p) { return new ReadOnlyCollection(this._db.collection(p)) }
  collectionGroup(p) { return new ReadOnlyCollection(this._db.collectionGroup(p)) }
  doc(p) { return new ReadOnlyDoc(this._db.doc(p)) }
  listCollections() { return this._db.listCollections() }
  set() { throw readOnlyError('firestore.set') }
  update() { throw readOnlyError('firestore.update') }
  delete() { throw readOnlyError('firestore.delete') }
  add() { throw readOnlyError('firestore.add') }
  batch() { throw readOnlyError('firestore.batch') }
  runTransaction() { throw readOnlyError('firestore.runTransaction') }
  bulkWriter() { throw readOnlyError('firestore.bulkWriter') }
  recursiveDelete() { throw readOnlyError('firestore.recursiveDelete') }
}
function assertNoGamificationImport() {
  for (const key of Object.keys(require.cache || {})) {
    if (key.indexOf('gamification') !== -1 && key.indexOf('wallet-snapshot') === -1) {
      throw new Error('WALLET-SNAPSHOT SAFETY: gamification module imported: ' + key)
    }
  }
}
async function collectEntries(ro) {
  const entries = []
  const famSnap = await ro.collection('families').get()
  for (const fam of famSnap.docs) {
    const fid = fam.id
    for (const coll of PROTECTED_FAMILY_COLLECTIONS) {
      const snap = await ro.collection('families').doc(fid).collection(coll).get()
      for (const d of snap.docs) {
        entries.push({ collectionPath: `families/${fid}/${coll}`, docPath: `families/${fid}/${coll}/${d.id}`, data: d.data() })
      }
      if (coll === 'savings_goals') {
        for (const goal of snap.docs) {
          for (const sub of SAVINGS_GOAL_SUBCOLLECTIONS) {
            const subSnap = await ro.collection('families').doc(fid).collection('savings_goals').doc(goal.id).collection(sub).get()
            for (const sd of subSnap.docs) {
              entries.push({ collectionPath: `families/${fid}/savings_goals/${goal.id}/${sub}`, docPath: `families/${fid}/savings_goals/${goal.id}/${sub}/${sd.id}`, data: sd.data() })
            }
          }
        }
      }
    }
  }
  const uSnap = await ro.collection('users').get()
  for (const u of uSnap.docs) entries.push({ collectionPath: 'users', docPath: `users/${u.id}`, data: projectUserWalletFields(u.data()) })
  return entries
}
function dryRunPlan() {
  console.log('WALLET SNAPSHOT — DRY RUN (no data read or written)')
  console.log('Would hash the following protected wallet paths:')
  console.log('  Family collections (families/{familyId}/...):')
  for (const c of PROTECTED_FAMILY_COLLECTIONS) console.log('    - ' + c)
  console.log('  savings_goals subcollections:')
  for (const s of SAVINGS_GOAL_SUBCOLLECTIONS) console.log('    - ' + s)
  console.log('  User money fields (users/{uid}):')
  for (const f of USER_WALLET_FIELDS) console.log('    - ' + f)
  console.log('Output directory: backups/wallet-snapshots/<timestamp>/ (git-ignored)')
  console.log('DRY RUN OK')
}
function writeManifest(dir, manifest) {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'wallet_snapshots.json')
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n')
  return file
}
async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--check')) {
    try {
      execFileSync(process.execPath, [path.join(__dirname, 'wallet-snapshot.test.cjs')], { stdio: 'inherit' })
    } catch (e) {
      process.exit(1)
    }
    return
  }
  assertNoGamificationImport()
  if (args.includes('--dry-run')) {
    dryRunPlan()
    return
  }
  const admin = require('firebase-admin')
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() })
  const ro = new ReadOnlyFirestore(admin.firestore())
  if (args.includes('--verify')) {
    const m = JSON.parse(fs.readFileSync(args[args.indexOf('--verify') + 1], 'utf8'))
    const r = verifyManifest(m, await collectEntries(ro))
    if (!r.ok) {
      console.error('WALLET VERIFY FAILED:\n' + formatReport(r.mismatches))
      process.exit(1)
    }
    console.log('WALLET VERIFY OK — global ' + m.globalSha256)
    return
  }
  const entries = await collectEntries(ro)
  const projectId = (admin.apps[0] && admin.apps[0].options && admin.apps[0].options.projectId) || null
  const manifest = buildManifest(entries, { projectId })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const i = args.indexOf('--output')
  const outDir = i !== -1 ? args[i + 1] : path.join(ROOT, 'backups', 'wallet-snapshots', ts)
  console.log('Wrote wallet snapshot: ' + writeManifest(outDir, manifest))
  console.log('Global SHA-256: ' + manifest.globalSha256 + '  Docs: ' + manifest.totalCount)
}
if (require.main === module) {
  main().catch((err) => {
    console.error('wallet-snapshot failed: ' + err.message)
    process.exit(1)
  })
}
module.exports = {
  normalizeValue,
  canonicalize,
  hashData,
  projectUserWalletFields,
  buildManifest,
  verifyManifest,
  formatReport,
  ReadOnlyFirestore,
  PROTECTED_FAMILY_COLLECTIONS,
  SAVINGS_GOAL_SUBCOLLECTIONS,
  USER_WALLET_FIELDS,
  collectEntries,
}
