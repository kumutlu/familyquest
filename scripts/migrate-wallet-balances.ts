// One-off migration: seed canonical wallet documents from the legacy
// users.walletBalance profile field for any child that does not yet have a
// families/{familyId}/wallets/{childId} document.
//
// This logic used to live in api.ts `ensureWalletDocument` as a runtime fallback.
// It has been removed from the app so that transfers never read the legacy
// profile balance. Run this script once per environment (emulator + production)
// after deploying the single-source-of-truth wallet changes.
//
// Usage:
//   tsx scripts/migrate-wallet-balances.ts --project familyquest-beta-402cb --dry-run
//   tsx scripts/migrate-wallet-balances.ts --project familyquest-beta-402cb --execute
//   tsx scripts/migrate-wallet-balances.ts --project familyquest-beta-402cb --family-id <id> --execute

import { pathToFileURL } from 'node:url'
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore'

interface MigrateArgs {
  projectId: string
  familyId?: string
  execute: boolean
}

function parseArgs(argv: string[]): MigrateArgs {
  let projectId: string | undefined
  let familyId: string | undefined
  let execute = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--project') {
      projectId = argv[index + 1]
      index += 1
    } else if (arg === '--family-id') {
      familyId = argv[index + 1]
      index += 1
    } else if (arg === '--execute') {
      execute = true
    } else if (arg === '--dry-run') {
      execute = false
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (!projectId) throw new Error('--project is required')
  return { projectId, familyId, execute }
}

function getApp(projectId: string) {
  const name = `migrate-wallet-${projectId}`
  return getApps().find(candidate => candidate.name === name)
    ?? initializeApp({ credential: applicationDefault(), projectId }, name)
}

interface FamilyResult {
  familyId: string
  created: number
  operations: Array<{ childId: string; balance: number }>
}

async function migrateFamily(db: Firestore, familyId: string, execute: boolean): Promise<FamilyResult> {
  const membersSnap = await db
    .collection('users')
    .where('familyId', '==', familyId)
    .where('role', '==', 'child')
    .get()

  const operations: Array<{ childId: string; balance: number }> = []
  for (const member of membersSnap.docs) {
    const data = member.data() as Record<string, unknown>
    const walletRef = db.doc(`families/${familyId}/wallets/${member.id}`)
    const walletSnap = await walletRef.get()
    if (walletSnap.exists) continue

    const legacyBalance = Number.isInteger(data.walletBalance) ? (data.walletBalance as number) : 0
    operations.push({ childId: member.id, balance: legacyBalance })
    if (execute) {
      await walletRef.set({
        balance: legacyBalance,
        createdAt: FieldValue.serverTimestamp(),
        migratedFromLegacy: true,
      })
    }
  }

  return { familyId, created: operations.length, operations }
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv)
  const db = getFirestore(getApp(args.projectId))

  const familyIds = args.familyId
    ? [args.familyId]
    : (await db.collection('families').get()).docs.map(doc => doc.id)

  let total = 0
  for (const familyId of familyIds) {
    const result = await migrateFamily(db, familyId, args.execute)
    total += result.created
    console.log(
      `Family ${familyId}: ${result.created} wallet document(s) ${args.execute ? 'created' : 'would be created (dry-run)'}`,
    )
    for (const op of result.operations) {
      console.log(`  - ${op.childId}: legacy balance ${op.balance}`)
    }
  }

  console.log(`\nTotal: ${total} wallet document(s) ${args.execute ? 'created' : 'would be created (dry-run)'}`)
  if (!args.execute) console.log('Re-run with --execute to apply.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
