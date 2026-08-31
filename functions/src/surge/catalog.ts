/**
 * Surge catalog — server-side loader.
 *
 * V1: the catalog is composed in-process from the family's stored
 * preferences + a curated, time-bounded Surge catalog. The catalog itself
 * is supplied by an operator (future work) or by the scheduler (future
 * work). For V1, the resolver is the source of truth and is invoked
 * from the authoritative gamification processor.
 *
 * Architectural law:
 *   Engagement Engine creates opportunities.
 *   Gamification Engine awards value.
 *
 * This module NEVER writes to authoritative XP / wallet / points
 * collections. It only returns a structured description of which Surges
 * are candidates for the given completion.
 */

import type {
  SurgeEligibilityDefinition,
  SurgeWindow,
} from '../../src/domain/surge/types'

/** A Surge exposed to the authoritative evaluator, identical in shape to
 *  the client-side `ActiveSurge` so server and client agree on every
 *  field. The window here is the authoritative `EventDefinition`
 *  window (startsAt/endsAt) for the Surge event. */
export interface ActiveSurge {
  readonly surgeId: string
  readonly surge: SurgeEligibilityDefinition
  readonly window: SurgeWindow
}

/** Result of composing the Surge catalog for a family at evaluation time.
 *  `null` when the family has Surges disabled (preference_disabled)
 *  — the evaluator returns not_eligible before inspecting the catalog. */
export interface SurgeCatalog {
  readonly familyId: string
  readonly surges: readonly ActiveSurge[]
  readonly familyPreferences: { surgeHours: boolean }
}

/**
 * Build a Surge catalog snapshot.
 *
 * Pure: same inputs ⇒ same outputs. No Firestore, no clock. The caller
 * is responsible for reading preferences + active events from Firestore
 * and supplying them.
 */
export function buildSurgeCatalog(input: {
  familyId: string
  familyPreferences: { surgeHours: boolean }
  activeSurgeEvents: readonly ActiveSurge[]
}): SurgeCatalog {
  return Object.freeze({
    familyId: input.familyId,
    surges: Object.freeze([...input.activeSurgeEvents]),
    familyPreferences: Object.freeze({ ...input.familyPreferences }),
  }) as SurgeCatalog
}