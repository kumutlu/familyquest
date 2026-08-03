/**
 * Repair families that are stuck in the `inactive` gamification state.
 *
 * Background: families created after the gamification migration work never
 * received a `gamificationMigration` field. The Cloud Function processor treats
 * a missing/`inactive` state as "gamification is off" and returns `ignored`, so
 * task completions succeed but award no points. This script upgrades any such
 * family into the `prepared` state using the existing migration mechanism
 * (`prepareGamificationMigration`) — it does not reimplement it.
 *
 * Properties:
 *  - Reusable: operates on every affected family, or one via --family-id.
 *              No family is special-cased.
 *  - Idempotent: families already in prepared/baseline_complete/active are
 *              skipped, so re-running changes nothing.
 *  - Safe: malformed metadata is reported and left untouched, never rewritten.
 *  - Dry-run by default semantics: --dry-run and --execute are both explicit.
 *
 * Usage:
 *   tsx scripts/repair-gamification-migration.ts --project <id> --dry-run
 *   tsx scripts/repair-gamification-migration.ts --project <id> --execute
 *   tsx scripts/repair-gamification-migration.ts --project <id> --family-id <id> --execute
 */
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore'
import {
  GAMIFICATION_MIGRATION_SCHEMA_VERSION,
  isGamificationMigrationStatus,
} from '../src/domain/gamification/migrationState'
import { prepareGamificationMigration } from './migrate-legacy-xp'

export type RepairOutcome = 'repaired' | 'would_repair' | 'already_ready' | 'malformed' | 'missing'

export interface FamilyRepairReport {
  readonly familyId: string
  readonly outcome: RepairOutcome
  readonly previousStatus: string
}

export interface RepairResult {
  readonly mode: 'dry-run' | 'execute'
  readonly scanned: number
  readonly repaired: number
  readonly alreadyReady: number
  readonly malformed: number
  readonly families: readonly FamilyRepairReport[]
}

type Classification =
  | { readonly kind: 'inactive'; readonly previousStatus: string }
  | { readonly kind: 'ready'; readonly previousStatus: string }
  | { readonly kind: 'malformed'; readonly previousStatus: string }

/**
 * Classify a family's stored migration metadata.
 *
 * A completely absent field is `inactive` (repairable) — that is exactly the
 * shape produced by the buggy family-creation path. A present-but-unreadable
 * field is `malformed` and is never rewritten automatically.
 */
export function classifyMigration(raw: unknown): Classification {
  if (raw === undefined || raw === null) return { kind: 'inactive', previousStatus: 'missing' }
  if (typeof raw !== 'object') return { kind: 'malformed', previousStatus: 'malformed' }
  const candidate = raw as Record<string, unknown>
  if (candidate.schemaVersion !== GAMIFICATION_MIGRATION_SCHEMA_VERSION
    || !isGamificationMigrationStatus(candidate.status)) {
    return { kind: 'malformed', previousStatus: 'malformed' }
  }
  return candidate.status === 'inactive'
    ? { kind: 'inactive', previousStatus: 'inactive' }
    : { kind: 'ready', previousStatus: candidate.status }
}

export interface RepairArgs {
  readonly familyId?: string
  readonly execute: boolean
  /** Cutover stamped on repaired families. Defaults to now. */
  readonly cutoverAt?: Timestamp
}

export async function repairGamificationMigrations(db: Firestore, args: RepairArgs): Promise<RepairResult> {
  const cutoverAt = args.cutoverAt ?? Timestamp.now()
  const families: FamilyRepairReport[] = []

  const documents = args.familyId !== undefined
    ? [await db.collection('families').doc(args.familyId).get()]
    : (await db.collection('families').get()).docs

  for (const document of documents) {
    if (!document.exists) {
      families.push({ familyId: document.id, outcome: 'missing', previousStatus: 'missing' })
      continue
    }
    const classification = classifyMigration(document.data()?.gamificationMigration)
    if (classification.kind === 'malformed') {
      families.push({ familyId: document.id, outcome: 'malformed', previousStatus: classification.previousStatus })
      continue
    }
    if (classification.kind === 'ready') {
      // Idempotency: nothing to do, and we must not move an existing cutoverAt
      // forward — that would retroactively orphan already-awarded completions.
      families.push({ familyId: document.id, outcome: 'already_ready', previousStatus: classification.previousStatus })
      continue
    }
    if (!args.execute) {
      families.push({ familyId: document.id, outcome: 'would_repair', previousStatus: classification.previousStatus })
      continue
    }
    // Reuse the canonical mechanism rather than writing the field directly, so
    // the repair cannot drift from the migration tooling's invariants.
    await prepareGamificationMigration(db, document.id, cutoverAt)
    families.push({ familyId: document.id, outcome: 'repaired', previousStatus: classification.previousStatus })
  }

  return {
    mode: args.execute ? 'execute' : 'dry-run',
    scanned: families.length,
    repaired: families.filter(f => f.outcome === 'repaired' || f.outcome === 'would_repair').length,
    alreadyReady: families.filter(f => f.outcome === 'already_ready').length,
    malformed: families.filter(f => f.outcome === 'malformed').length,
    families,
  }
}

interface CliArgs {
  readonly projectId: string
  readonly familyId?: string
  readonly execute: boolean
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
  let projectId: string | undefined
  let familyId: string | undefined
  let mode: 'dry-run' | 'execute' | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--project' || argument === '--family-id') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${argument} requires a value`)
      if (argument === '--project') {
        if (projectId !== undefined) throw new Error('--project may appear only once')
        projectId = value
      } else {
        if (familyId !== undefined) throw new Error('--family-id may appear only once')
        familyId = value
      }
      index += 1
    } else if (argument === '--dry-run' || argument === '--execute') {
      if (mode !== undefined) throw new Error('Choose exactly one of --dry-run or --execute')
      mode = argument.slice(2) as 'dry-run' | 'execute'
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }
  if (projectId === undefined || projectId.length === 0) throw new Error('--project is required')
  if (mode === undefined) throw new Error('Choose exactly one of --dry-run or --execute')
  return { projectId, familyId, execute: mode === 'execute' }
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2))
  const name = `repair-gamification-migration-${args.projectId}`
  const app = getApps().find(candidate => candidate.name === name)
    ?? initializeApp({ credential: applicationDefault(), projectId: args.projectId }, name)
  const result = await repairGamificationMigrations(getFirestore(app), {
    familyId: args.familyId,
    execute: args.execute,
  })
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1]?.endsWith('repair-gamification-migration.ts')) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
