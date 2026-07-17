// Phase 6 — Idempotent legacy `savings_goals` field migration.
//
// Backfills legacy goal documents (created before the v1 Goals schema) with the
// canonical pence + metadata fields required by the trusted goal transaction
// APIs (design §13):
//   - targetAmountPence   (derived from legacy major-unit `targetAmount`)
//   - currentAmountPence  (derived from legacy major-unit `currentAmount`)
//   - kind                 ('child' if childId present, else 'family')
//   - status               (default 'active')
//   - currency             ('GBP')
//   - version: 1
//
// Idempotency: any doc that already carries a numeric `version` is skipped, so
// re-running the script is a no-op for already-migrated docs. The legacy
// `targetAmount` / `currentAmount` fields are preserved (never deleted) so the
// conversion is reversible by inspection and the legacy `savings_goals` Firestore
// rule block keeps validating the doc.
//
// The conversion maths is delegated to `normalizeGoalDoc` (src/lib/goalContracts.ts)
// so the migration cannot drift from the canonical normalisation used by the app.
//
// Usage (emulator must be running, e.g. `firebase emulators:start --only firestore`):
//   tsx scripts/migrate-goal-fields.ts --project <projectId> --dry-run
//   tsx scripts/migrate-goal-fields.ts --project <projectId> --execute
//   tsx scripts/migrate-goal-fields.ts --project <projectId> --family-id <id> --execute

import { pathToFileURL } from 'node:url'
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore'
import { normalizeGoalDoc } from '../src/lib/goalContracts'

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
  const name = `migrate-goal-fields-${projectId}`
  return getApps().find(candidate => candidate.name === name)
    ?? initializeApp({ credential: applicationDefault(), projectId }, name)
}

export interface GoalMigrationResult {
  familyId: string
  scanned: number
  migrated: number
  skipped: number
  operations: Array<{ goalId: string; fields: Record<string, unknown> }>
}

/**
 * Compute the v1 backfill patch for a single raw goal document. Returns `null`
 * when the doc is already v1 (has a numeric `version`) — i.e. nothing to do.
 */
export function goalBackfillPatch(raw: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof raw.version === 'number') return null
  const normalized = normalizeGoalDoc(raw)
  return {
    targetAmountPence: normalized.targetAmountPence,
    currentAmountPence: normalized.currentAmountPence,
    kind: normalized.kind,
    status: normalized.status,
    currency: normalized.currency,
    version: 1,
  }
}

async function migrateFamily(db: Firestore, familyId: string, execute: boolean): Promise<GoalMigrationResult> {
  const snap = await db.collection(`families/${familyId}/savings_goals`).get()
  const operations: Array<{ goalId: string; fields: Record<string, unknown> }> = []
  let migrated = 0
  let skipped = 0

  for (const docSnap of snap.docs) {
    const raw = docSnap.data() as Record<string, unknown>
    const patch = goalBackfillPatch(raw)
    if (!patch) {
      skipped += 1
      continue
    }
    migrated += 1
    operations.push({ goalId: docSnap.id, fields: patch })
    if (execute) {
      await docSnap.ref.update({
        ...patch,
        migratedAt: FieldValue.serverTimestamp(),
        migratedFrom: 'legacy_savings_goals',
      })
    }
  }

  return { familyId, scanned: snap.size, migrated, skipped, operations }
}

export async function migrateGoalFields(db: Firestore, args: MigrateArgs): Promise<GoalMigrationResult[]> {
  const familyIds = args.familyId
    ? [args.familyId]
    : (await db.collection('families').get()).docs.map(doc => doc.id)

  const results: GoalMigrationResult[] = []
  for (const familyId of familyIds) {
    results.push(await migrateFamily(db, familyId, args.execute))
  }
  return results
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv)
  const db = getFirestore(getApp(args.projectId))

  const results = await migrateGoalFields(db, args)
  let totalMigrated = 0
  let totalSkipped = 0
  for (const result of results) {
    totalMigrated += result.migrated
    totalSkipped += result.skipped
    console.log(
      `Family ${result.familyId}: scanned=${result.scanned} migrated=${result.migrated} skipped=${result.skipped}`
        + ` ${args.execute ? '' : '(dry-run)'}`,
    )
    for (const op of result.operations) {
      console.log(`  - ${op.goalId}: ${JSON.stringify(op.fields)}`)
    }
  }

  console.log(`\nTotal: migrated=${totalMigrated} skipped=${totalSkipped}`)
  if (!args.execute) console.log('Re-run with --execute to apply.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
