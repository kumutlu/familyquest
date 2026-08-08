import { type DocumentData, type Firestore } from 'firebase-admin/firestore'
import {
  buildInitialGamificationMigration,
  isGamificationMigrationStatus,
  GAMIFICATION_MIGRATION_SCHEMA_VERSION,
} from '../../src/domain/gamification/migrationState'

/**
 * Server-side backstop that guarantees every family document carries a usable
 * `gamificationMigration` state.
 *
 * The client stamps the state at creation time, which removes any race between
 * creating a family and completing the first task. This trigger exists because
 * `families` creation is not the only conceivable write path (support tooling,
 * imports, future server-side onboarding), and a family that silently stays
 * `inactive` is invisible: task completion appears to work while no points are
 * ever awarded.
 */

export type InitDecision =
  | { readonly action: 'initialize' }
  | { readonly action: 'skip'; readonly reason: 'already_ready' }
  | { readonly action: 'skip'; readonly reason: 'malformed' }

/**
 * Decide whether a family needs gamification initialization.
 *
 * Deliberately conservative: a malformed state is reported rather than
 * overwritten, so an automatic trigger can never destroy migration bookkeeping
 * it does not understand. The repair path handles those explicitly.
 */
export function decideGamificationInit(family: DocumentData | undefined): InitDecision {
  const value = family?.gamificationMigration
  if (value === undefined || value === null) return { action: 'initialize' }
  if (typeof value !== 'object') return { action: 'skip', reason: 'malformed' }
  const candidate = value as Record<string, unknown>
  if (candidate.schemaVersion !== GAMIFICATION_MIGRATION_SCHEMA_VERSION
    || !isGamificationMigrationStatus(candidate.status)) {
    return { action: 'skip', reason: 'malformed' }
  }
  return candidate.status === 'inactive'
    ? { action: 'initialize' }
    : { action: 'skip', reason: 'already_ready' }
}

export interface EnsureGamificationInitResult {
  readonly familyId: string
  readonly outcome: 'initialized' | 'already_ready' | 'malformed' | 'missing_family'
}

/**
 * Idempotent: re-running against an already-initialized family is a no-op.
 * The read and the write share a transaction so a concurrent initialization
 * cannot be clobbered (which would move `cutoverAt` forward and silently drop
 * completions approved in between).
 */
export async function ensureFamilyGamificationInitialized(
  db: Firestore,
  familyId: string,
  cutoverAt: Date,
): Promise<EnsureGamificationInitResult> {
  const familyRef = db.doc(`families/${familyId}`)
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(familyRef)
    if (!snapshot.exists) return { familyId, outcome: 'missing_family' as const }
    const decision = decideGamificationInit(snapshot.data())
    if (decision.action === 'skip') {
      return { familyId, outcome: decision.reason === 'malformed' ? ('malformed' as const) : ('already_ready' as const) }
    }
    // A plain Date is serialized by Firestore into a Timestamp. Passing a Date
    // rather than constructing a Timestamp here avoids the "types from a
    // different NPM package" failure when the caller's firebase-admin copy is
    // not the one this module resolves.
    transaction.update(familyRef, {
      gamificationMigration: buildInitialGamificationMigration(cutoverAt),
    })
    return { familyId, outcome: 'initialized' as const }
  })
}
