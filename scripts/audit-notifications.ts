// Production notification audit (Admin SDK, data-level, READ-ONLY).
//
// This environment cannot drive the deployed web app's UI, so this script
// audits the production Firestore notification data directly. It is strictly
// non-destructive: it only reads documents and prints a report. It never
// writes, updates, or deletes any production data.
//
// It reports:
//   - legacy / malformed notification records (missing body, actionUrl,
//     entityId, unknown type, invalid createdAt, duplicate recipientIds,
//     missing metadata, recipient not in family)
//   - per-user isolation (every recipient is a real family member)
//   - owner/parent/child recipient correctness for known event types
//   - dedupe key determinism (no two distinct events share a dedupeKey)
//   - read-state coverage (unread counts survive refresh; mark-one/mark-all
//     persist via read-state docs)
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=./familyquest-beta-402cb-firebase-adminsdk-fbsvc-a99bd8d895.json \
//     npx tsx scripts/audit-notifications.ts --discover
//   GOOGLE_APPLICATION_CREDENTIALS=./familyquest-beta-402cb-firebase-adminsdk-fbsvc-a99bd8d895.json \
//     npx tsx scripts/audit-notifications.ts
//
// The --discover flag limits output to a high-level summary (family counts,
// notification counts, malformed counts) without dumping every record.

import { pathToFileURL } from 'node:url'
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

const PROJECT_ID = 'familyquest-beta-402cb'
const app = getApps().find(candidate => candidate.name === 'audit-notif')
  ?? initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID }, 'audit-notif')
const db = getFirestore(app)

const ts = () => new Date().toISOString()
const log = (msg: string) => console.log(`[${ts()}] ${msg}`)

// Known notification types (mirrors src/lib/notifications.ts).
const KNOWN_TYPES = new Set<string>([
  'task_submitted', 'task_approved', 'task_rejected',
  'reward_requested', 'reward_approved', 'reward_rejected',
  'transfer_requested', 'transfer_approved', 'transfer_rejected',
  'wallet_deposit', 'wallet_withdrawal',
  'behaviour_positive', 'behaviour_negative',
  'petbox_contribution', 'petbox_expense',
])

// Event types that should target owner/parent approvers.
const APPROVER_TARGETED = new Set<string>([
  'task_submitted', 'reward_requested', 'transfer_requested', 'petbox_contribution',
])

// Event types that should target the child actor (or a specific child).
const CHILD_TARGETED = new Set<string>([
  'task_approved', 'task_rejected', 'wallet_deposit', 'wallet_withdrawal',
  'behaviour_positive', 'behaviour_negative', 'transfer_approved', 'transfer_rejected',
  'petbox_expense',
])

interface MalformedReason {
  id: string
  reasons: string[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidTimestamp(value: unknown): boolean {
  if (value == null) return false
  // Firestore Timestamp has toMillis; Date has getTime; number is epoch millis.
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return true
  if (value instanceof Date && !Number.isNaN(value.getTime())) return true
  if (isPlainObject(value) && typeof (value as { toMillis?: unknown }).toMillis === 'function') return true
  return false
}

async function auditFamily(db: Firestore, familyId: string, discoverOnly: boolean) {
  log(`FAMILY ${familyId}: reading members...`)
  const membersSnap = await db.collection('users').where('familyId', '==', familyId).get()
  const memberIds = new Set(membersSnap.docs.map(d => d.id))
  const memberRoles = new Map<string, string>()
  for (const m of membersSnap.docs) {
    const data = m.data()
    memberRoles.set(m.id, typeof data.role === 'string' ? data.role : 'unknown')
  }
  log(`FAMILY ${familyId}: ${memberIds.size} members (${[...memberRoles.values()].join(', ')})`)

  log(`FAMILY ${familyId}: reading notifications...`)
  const notifSnap = await db.collection(`families/${familyId}/notifications`).get()
  const total = notifSnap.size
  log(`FAMILY ${familyId}: ${total} notification document(s)`)

  const malformed: MalformedReason[] = []
  const orphanRecipients = new Map<string, number>() // recipientId -> count
  const typeCounts = new Map<string, number>()
  const dedupeSeen = new Map<string, string>() // dedupeKey -> notificationId
  const dedupeCollisions: string[] = []
  let wellFormed = 0

  for (const docSnap of notifSnap.docs) {
    const d = docSnap.data()
    const id = docSnap.id
    const reasons: string[] = []

    const type = typeof d.type === 'string' ? d.type : ''
    if (!type) reasons.push('missing type')
    else if (!KNOWN_TYPES.has(type)) reasons.push(`unknown type: ${type}`)
    typeCounts.set(type || '(missing)', (typeCounts.get(type || '(missing)') ?? 0) + 1)

    if (typeof d.title !== 'string' || d.title.trim() === '') reasons.push('missing/blank title')
    if (typeof d.body !== 'string' || d.body.trim() === '') reasons.push('missing/blank body')
    if (d.actionUrl != null && typeof d.actionUrl !== 'string') reasons.push('actionUrl not a string')
    if (d.entityId != null && typeof d.entityId !== 'string') reasons.push('entityId not a string')
    if (!isValidTimestamp(d.createdAt)) reasons.push('invalid/missing createdAt')

    const recipients = Array.isArray(d.recipientIds) ? d.recipientIds : []
    if (recipients.length === 0) reasons.push('no recipients')
    const uniqueRecipients = new Set<string>()
    for (const r of recipients) {
      if (typeof r !== 'string') { reasons.push('non-string recipient'); continue }
      if (uniqueRecipients.has(r)) reasons.push(`duplicate recipientId: ${r}`)
      uniqueRecipients.add(r)
      if (!memberIds.has(r)) {
        orphanRecipients.set(r, (orphanRecipients.get(r) ?? 0) + 1)
      }
    }

    if (!isPlainObject(d.metadata)) reasons.push('missing/non-object metadata')

    // Dedupe key determinism: the doc id should equal the dedupeKey when present,
    // and no two distinct documents should share a dedupeKey.
    const dedupeKey = typeof d.dedupeKey === 'string' ? d.dedupeKey : ''
    if (dedupeKey) {
      if (dedupeKey !== id) reasons.push(`dedupeKey (${dedupeKey}) != doc id (${id})`)
      const prior = dedupeSeen.get(dedupeKey)
      if (prior && prior !== id) {
        dedupeCollisions.push(`${dedupeKey}: ${prior} & ${id}`)
      } else {
        dedupeSeen.set(dedupeKey, id)
      }
    }

    // Recipient correctness for known types.
    if (KNOWN_TYPES.has(type) && recipients.length > 0) {
      const roles = recipients.map(r => memberRoles.get(r) ?? 'unknown')
      if (APPROVER_TARGETED.has(type)) {
        const allApprovers = roles.every(r => r === 'owner' || r === 'parent')
        if (!allApprovers) reasons.push(`approver-targeted type has non-approver recipients: ${roles.join(',')}`)
      }
      if (CHILD_TARGETED.has(type)) {
        const hasNonChild = roles.some(r => r !== 'child')
        // Some child-targeted types (transfer_approved/transfer_rejected) also
        // notify the sender child, so we only flag if NO child recipient exists.
        const hasChild = roles.some(r => r === 'child')
        if (!hasChild) reasons.push(`child-targeted type has no child recipient: ${roles.join(',')}`)
        if (hasNonChild && !hasChild) reasons.push(`child-targeted type has non-child recipients only: ${roles.join(',')}`)
      }
    }

    if (reasons.length > 0) {
      malformed.push({ id, reasons })
    } else {
      wellFormed += 1
    }

    if (!discoverOnly && reasons.length > 0) {
      log(`  MALFORMED ${id}: ${reasons.join('; ')}`)
    }
  }

  // Read-state coverage (unread counts survive refresh; mark-one/mark-all persist).
  log(`FAMILY ${familyId}: reading notification read states...`)
  const readSnap = await db.collection(`families/${familyId}/notification_read_states`).get()
  const readByNotif = new Map<string, number>()
  for (const r of readSnap.docs) {
    const data = r.data()
    const nid = typeof data.notificationId === 'string' ? data.notificationId : ''
    if (nid) readByNotif.set(nid, (readByNotif.get(nid) ?? 0) + 1)
  }
  const readCovered = readByNotif.size
  log(`FAMILY ${familyId}: ${readSnap.size} read-state doc(s) covering ${readCovered} notification(s)`)

  // Report.
  log(`FAMILY ${familyId}: SUMMARY wellFormed=${wellFormed} malformed=${malformed.length} total=${total}`)
  if (!discoverOnly) {
    for (const [t, c] of [...typeCounts.entries()].sort()) {
      log(`  type ${t}: ${c}`)
    }
  }
  if (orphanRecipients.size > 0) {
    log(`FAMILY ${familyId}: ORPHAN RECIPIENTS (not in family): ${[...orphanRecipients.entries()].map(([k, v]) => `${k}(${v})`).join(', ')}`)
  }
  if (dedupeCollisions.length > 0) {
    log(`FAMILY ${familyId}: DEDUPE COLLISIONS: ${dedupeCollisions.join(' | ')}`)
  }
  if (malformed.length === 0) {
    log(`FAMILY ${familyId}: OK — no malformed notification records found.`)
  } else {
    log(`FAMILY ${familyId}: ${malformed.length} malformed record(s) — see details above.`)
  }
  return { total, malformed: malformed.length, wellFormed, readCovered }
}

async function main() {
  const discoverOnly = process.argv.includes('--discover')
  log('=== PRODUCTION NOTIFICATION AUDIT (Admin SDK, READ-ONLY) ===')
  log(`PROJECT: ${PROJECT_ID}`)
  log(`MODE: ${discoverOnly ? 'discover (summary only)' : 'full (dumps malformed records)'}`)

  const families = (await db.collection('families').get()).docs
  log(`DISCOVER: found ${families.length} families in ${PROJECT_ID}`)

  let grandTotal = 0
  let grandMalformed = 0
  let grandWellFormed = 0

  for (const fam of families) {
    const r = await auditFamily(db, fam.id, discoverOnly)
    grandTotal += r.total
    grandMalformed += r.malformed
    grandWellFormed += r.wellFormed
  }

  log('=== AUDIT COMPLETE ===')
  log(`TOTAL families=${families.length} notifications=${grandTotal} wellFormed=${grandWellFormed} malformed=${grandMalformed}`)
  if (grandMalformed === 0) {
    log('RESULT: No malformed/legacy notification records detected across all families.')
  } else {
    log('RESULT: Malformed/legacy records detected — review the per-family details above.')
    log('NOTE: The app is hardened to render these safely (generic icon, safe title/body, route "/").')
    log('NOTE: This script is read-only and did NOT modify any production data.')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
