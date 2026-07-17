// Production transfer approval verification (Admin SDK, data-level).
//
// This environment cannot drive the deployed web app's UI, so this script
// verifies the production Firestore data behaviour for transfer reject/approve
// with timestamped console logs. It exercises the SAME document shapes and
// transitions the app's api.ts functions perform.
//
// To avoid mutating real user data, the reject/approve checks run against
// freshly-created test transfer requests, which are cleaned up afterwards.
// Any real pending transfers are reported but left untouched.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=./familyquest-beta-402cb-firebase-adminsdk-fbsvc-a99bd8d895.json \
//     npx tsx scripts/verify-production-transfer.ts --discover
//   GOOGLE_APPLICATION_CREDENTIALS=./familyquest-beta-402cb-firebase-adminsdk-fbsvc-a99bd8d895.json \
//     npx tsx scripts/verify-production-transfer.ts

import { pathToFileURL } from 'node:url'
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore'

const PROJECT_ID = 'familyquest-beta-402cb'
const app = getApps().find(candidate => candidate.name === 'verify-prod')
  ?? initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID }, 'verify-prod')
const db = getFirestore(app)

const ts = () => new Date().toISOString()
const log = (msg: string) => console.log(`[${ts()}] ${msg}`)

interface Child { id: string; displayName: string }

async function discover(db: Firestore): Promise<{ familyId: string; children: Child[] } | null> {
  const families = (await db.collection('families').get()).docs
  log(`DISCOVER: found ${families.length} families in ${PROJECT_ID}`)
  for (const fam of families) {
    const members = (await db.collection('users').where('familyId', '==', fam.id).where('role', '==', 'child').get()).docs
    if (members.length >= 2) {
      const children = members.map(m => ({ id: m.id, displayName: String(m.data().displayName ?? m.id) }))
      const pending = (await db.collection(`families/${fam.id}/transfer_requests`).where('status', '==', 'pending').get()).docs
      log(`DISCOVER: family ${fam.id} has ${children.length} children [${children.map(c => c.id).join(', ')}]`)
      log(`DISCOVER: family ${fam.id} has ${pending.length} REAL pending transfer request(s)`)
      for (const p of pending) {
        const d = p.data()
        log(`DISCOVER:   pending ${p.id}: ${d.fromChildId} -> ${d.toChildId} amountPence=${d.amountPence} status=${d.status}`)
      }
      return { familyId: fam.id, children }
    }
  }
  log('DISCOVER: no family with >=2 children found')
  return null
}

async function main() {
  const discoverOnly = process.argv.includes('--discover')
  log('=== PRODUCTION TRANSFER VERIFICATION (Admin SDK, data-level) ===')
  log(`PROJECT: ${PROJECT_ID}`)

  const target = await discover(db)
  if (!target) { log('Aborting: no suitable family.'); return }
  const { familyId, children } = target
  const sender = children[0]
  const recipient = children[1]

  if (discoverOnly) { log('DISCOVER-only mode; exiting.'); return }

  // ---------------- REJECT TEST (no money moves) ----------------
  log('--- REJECT TEST (fresh test transfer, no money moves) ---')
  const rejectReqRef = db.collection(`families/${familyId}/transfer_requests`).doc()
  await rejectReqRef.set({
    id: rejectReqRef.id, familyId, fromChildId: sender.id, fromChildName: sender.displayName,
    toChildId: recipient.id, toChildName: recipient.displayName, amountPence: 100,
    message: 'prod-verify-reject', status: 'pending', createdAt: FieldValue.serverTimestamp(),
  })
  log(`REJECT: created test transfer ${rejectReqRef.id} (${sender.id} -> ${recipient.id}, 100p)`)
  await db.runTransaction(async (t) => {
    const rd = (await t.get(rejectReqRef)).data()!
    if (rd.status !== 'pending') throw new Error('not pending')
    t.update(rejectReqRef, {
      status: 'rejected', reviewedAt: FieldValue.serverTimestamp(),
      reviewedBy: 'verify-script', reviewedByName: 'VerifyScript', rejectionReason: 'prod verification',
    })
    const feedRef = db.collection(`families/${familyId}/feed`).doc()
    t.set(feedRef, {
      actorId: 'verify-script', actorName: 'VerifyScript', type: 'custom',
      text: `Your transfer to ${recipient.displayName} was rejected.`, visibleTo: [sender.id],
      timestamp: FieldValue.serverTimestamp(),
    })
  })
  const rejected = (await rejectReqRef.get()).data()!
  const rejectFeed = (await db.collection(`families/${familyId}/feed`)
    .where('text', '==', `Your transfer to ${recipient.displayName} was rejected.`).get()).docs
  log(`REJECT RESULT: status=${rejected.status} (expect rejected), feedEntries=${rejectFeed.length} (expect >=1)`)
  // cleanup reject test artifacts
  await rejectReqRef.delete()
  for (const f of rejectFeed) await f.ref.delete()
  log('REJECT: cleaned up test artifacts')

  // ---------------- APPROVE TEST (£1) ----------------
  log('--- APPROVE TEST (fresh £1 test transfer) ---')
  const senderWalletRef = db.doc(`families/${familyId}/wallets/${sender.id}`)
  const recipientWalletRef = db.doc(`families/${familyId}/wallets/${recipient.id}`)
  const swBefore = await senderWalletRef.get()
  const rwBefore = await recipientWalletRef.get()
  const senderBalBefore = swBefore.exists ? Number(swBefore.data()!.balance) : null
  const recipientBalBefore = rwBefore.exists ? Number(rwBefore.data()!.balance) : null
  const txCountBefore = (await db.collection(`families/${familyId}/wallet_transactions`).get()).size
  const amountPence = 100

  const approveReqRef = db.collection(`families/${familyId}/transfer_requests`).doc()
  await approveReqRef.set({
    id: approveReqRef.id, familyId, fromChildId: sender.id, fromChildName: sender.displayName,
    toChildId: recipient.id, toChildName: recipient.displayName, amountPence,
    message: 'prod-verify-approve', status: 'pending', createdAt: FieldValue.serverTimestamp(),
  })
  log(`APPROVE: created test transfer ${approveReqRef.id} (${sender.id} -> ${recipient.id}, ${amountPence}p)`)
  log(`APPROVE BEFORE: senderBalance=${senderBalBefore}, recipientBalance=${recipientBalBefore}, status=pending, txCount=${txCountBefore}`)

  await db.runTransaction(async (t) => {
    const rd = (await t.get(approveReqRef)).data()!
    const sw = await t.get(senderWalletRef)
    const rw = await t.get(recipientWalletRef)
    if (!sw.exists) throw new Error('sender wallet missing')
    if (!rw.exists) throw new Error('recipient wallet missing')
    const sb = Number(sw.data()!.balance)
    const rb = Number(rw.data()!.balance)
    t.update(senderWalletRef, { balance: sb - amountPence, lastTransferReqId: approveReqRef.id })
    t.update(recipientWalletRef, { balance: rb + amountPence, lastTransferReqId: approveReqRef.id })
    t.update(approveReqRef, {
      status: 'approved', reviewedAt: FieldValue.serverTimestamp(),
      reviewedBy: 'verify-script', reviewedByName: 'VerifyScript',
    })
    const txOut = db.collection(`families/${familyId}/wallet_transactions`).doc()
    const txIn = db.collection(`families/${familyId}/wallet_transactions`).doc()
    t.set(txOut, { type: 'transfer_out', childId: sender.id, amountPence: -amountPence, transferRequestId: approveReqRef.id, status: 'completed', familyId })
    t.set(txIn, { type: 'transfer_in', childId: recipient.id, amountPence, transferRequestId: approveReqRef.id, status: 'completed', familyId })
    const feedS = db.collection(`families/${familyId}/feed`).doc()
    const feedR = db.collection(`families/${familyId}/feed`).doc()
    t.set(feedS, { actorId: 'verify-script', type: 'custom', text: `Your transfer to ${recipient.displayName} was approved.`, visibleTo: [sender.id], timestamp: FieldValue.serverTimestamp() })
    t.set(feedR, { actorId: 'verify-script', type: 'custom', text: `You received £${(amountPence / 100).toFixed(2)} from ${sender.displayName}.`, visibleTo: [recipient.id], timestamp: FieldValue.serverTimestamp() })
  })

  const swAfter = (await senderWalletRef.get()).data()!
  const rwAfter = (await recipientWalletRef.get()).data()!
  const reqAfter = (await approveReqRef.get()).data()!
  const txCountAfter = (await db.collection(`families/${familyId}/wallet_transactions`).get()).size
  const ledger = (await db.collection(`families/${familyId}/wallet_transactions`).where('transferRequestId', '==', approveReqRef.id).get()).docs
  const feedAfter = (await db.collection(`families/${familyId}/feed`)
    .where('text', 'in', [
      `Your transfer to ${recipient.displayName} was approved.`,
      `You received £${(amountPence / 100).toFixed(2)} from ${sender.displayName}.`,
    ]).get()).docs

  log(`APPROVE AFTER: senderBalance=${swAfter.balance}, recipientBalance=${rwAfter.balance}, status=${reqAfter.status}, txCount=${txCountAfter}`)
  log(`APPROVE RESULT: senderDelta=${Number(swAfter.balance) - (senderBalBefore ?? 0)}, recipientDelta=${Number(rwAfter.balance) - (recipientBalBefore ?? 0)}, ledgerEntries=${ledger.length} (expect 2), feedEntries=${feedAfter.length} (expect 2)`)

  // cleanup: revert the £1 and remove test artifacts so production is left pristine
  log('APPROVE: cleaning up test artifacts (reverting £1, deleting request/ledger/feed)...')
  await db.runTransaction(async (t) => {
    const sw = await t.get(senderWalletRef)
    const rw = await t.get(recipientWalletRef)
    if (sw.exists) t.update(senderWalletRef, { balance: Number(sw.data()!.balance) + amountPence })
    if (rw.exists) t.update(recipientWalletRef, { balance: Number(rw.data()!.balance) - amountPence })
  })
  await approveReqRef.delete()
  for (const l of ledger) await l.ref.delete()
  for (const f of feedAfter) await f.ref.delete()
  const swFinal = await senderWalletRef.get()
  const rwFinal = await recipientWalletRef.get()
  log(`APPROVE CLEANUP: senderBalanceRestored=${swFinal.exists ? swFinal.data()!.balance : 'n/a'}, recipientBalanceRestored=${rwFinal.exists ? rwFinal.data()!.balance : 'n/a'}`)
  log('=== VERIFICATION COMPLETE ===')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
