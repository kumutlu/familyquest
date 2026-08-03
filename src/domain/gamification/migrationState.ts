/**
 * Single source of truth for the gamification migration state machine.
 *
 * The state machine exists because gamification was retrofitted onto families
 * that already had legacy XP:
 *
 *   inactive -> prepared -> baseline_complete -> active
 *
 * `inactive` is the *absence* of gamification. The Cloud Function processor
 * refuses to award anything for an inactive family, which is correct for a
 * legacy family that has not yet had its baseline frozen, but is a bug for a
 * family created today: a brand-new family has no legacy XP to baseline, so it
 * must never sit in `inactive`.
 *
 * This module is shared by the client (family creation), the Cloud Functions
 * (processor + backstop trigger) and the operational scripts so that all three
 * agree on what "gamification ready" means.
 */

export const GAMIFICATION_MIGRATION_SCHEMA_VERSION = 1 as const

export type GamificationMigrationStatus =
  | 'inactive'
  | 'prepared'
  | 'baseline_complete'
  | 'active'

export const GAMIFICATION_MIGRATION_STATUSES: readonly GamificationMigrationStatus[] = [
  'inactive',
  'prepared',
  'baseline_complete',
  'active',
]

/**
 * Statuses for which the processor is allowed to award XP and reward points.
 * `inactive` is deliberately excluded.
 */
export const GAMIFICATION_READY_STATUSES: readonly GamificationMigrationStatus[] = [
  'prepared',
  'baseline_complete',
  'active',
]

/**
 * The status assigned to every newly created family.
 *
 * `active` rather than `prepared`: `prepared` means "a legacy XP baseline is
 * still pending", which is never true for a family created today. Going
 * straight to `active` keeps the legacy baseline tooling
 * (`prepareGamificationMigration`) correctly refusing families that have
 * nothing to migrate.
 */
export const NEW_FAMILY_MIGRATION_STATUS: GamificationMigrationStatus = 'active'

export function isGamificationMigrationStatus(value: unknown): value is GamificationMigrationStatus {
  return typeof value === 'string'
    && (GAMIFICATION_MIGRATION_STATUSES as readonly string[]).includes(value)
}

/** True when the processor is permitted to award XP / reward points. */
export function isGamificationReady(status: GamificationMigrationStatus): boolean {
  return GAMIFICATION_READY_STATUSES.includes(status)
}

export interface InitialGamificationMigration<TTimestamp> {
  readonly schemaVersion: typeof GAMIFICATION_MIGRATION_SCHEMA_VERSION
  readonly status: GamificationMigrationStatus
  readonly cutoverAt: TTimestamp
}

/**
 * Build the `gamificationMigration` field stamped onto a family at creation.
 *
 * `cutoverAt` is the family's creation instant: the processor ignores
 * completions approved before the cutover, and nothing can predate a family's
 * own creation, so every completion this family will ever produce is eligible.
 *
 * Generic over the timestamp representation so the client can pass a Firestore
 * `serverTimestamp()` sentinel while the Admin SDK passes a `Timestamp`.
 */
export function buildInitialGamificationMigration<TTimestamp>(
  cutoverAt: TTimestamp,
): InitialGamificationMigration<TTimestamp> {
  return {
    schemaVersion: GAMIFICATION_MIGRATION_SCHEMA_VERSION,
    status: NEW_FAMILY_MIGRATION_STATUS,
    cutoverAt,
  }
}
