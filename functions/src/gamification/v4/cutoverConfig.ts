/**
 * Gamification V4 — runtime cutover configuration layer (Stage 7, GATE 3).
 *
 * This is the persisted, per-family home of the feature-flag set
 * (docs/gamification-v4/08-stage7-infrastructure.md). It is the SINGLE runtime
 * source of truth for "is this family cut over to V4, and which writers?".
 *
 * Hard constraints (audit B3 / R1):
 *  - Emulator only: every Firestore-touching function calls `assertEmulatorOnly`
 *    (reused from the Stage 4 repository) so this layer can NEVER target
 *    production Firestore and can never be the thing that "deletes the safety
 *    net" — cutover is a config flip, not a guard removal.
 *  - Fail closed: `readCutoverConfig` returns the all-legacy default when the
 *    doc is absent, so an unconfigured family is never V4.
 *  - No legacy writer is modified and no V4 writer is activated by this module;
 *    it only reads/writes the dedicated `gamification_cutover_config` document.
 *  - Not referenced by `functions/src/index.ts` (pinned by the architecture
 *    boundary test), so it is test/tooling-only and never a deployed path.
 *
 * The instant rollback (audit R1) is `rollbackStage7` in `rollback.ts`, which
 * flips this config's `status` back to `rolled_back` and resets every writer
 * flag to legacy in a single document write.
 */

import type { Firestore } from 'firebase-admin/firestore'

import { assertEmulatorOnly } from './repository'
import {
  defaultFeatureFlags,
  withAllLegacy,
  withAllV4,
  withWriterDisabled,
  withWriterEnabled,
  type FeatureFlagSet,
  type GamificationWriter,
} from '../../../../src/domain/gamification/v4/featureFlags'

/** Schema version of the cutover config document. */
export const CUTOVER_CONFIG_SCHEMA_VERSION = 4

/** Collection + doc id for the per-family cutover config (family-scoped). */
export const CUTOVER_CONFIG_COLLECTION = 'gamification_cutover_config'
export const CUTOVER_CONFIG_DOC_ID = 'config'

/** `families/{familyId}/gamification_cutover_config/config` */
export function cutoverConfigDocPath(familyId: string): string {
  return `families/${familyId}/${CUTOVER_CONFIG_COLLECTION}/${CUTOVER_CONFIG_DOC_ID}`
}

/** Lifecycle of a family's V4 writer cutover. */
export type CutoverStatus = 'not_started' | 'active' | 'rolled_back'

/** Persisted, per-family cutover configuration. */
export interface CutoverConfig {
  readonly schemaVersion: number
  readonly familyId: string
  readonly status: CutoverStatus
  /** The live feature-flag set (per-writer, per-family routing). */
  readonly flags: FeatureFlagSet
  readonly activatedAt: string | null
  readonly activatedBy: string | null
  readonly rolledBackAt: string | null
  readonly rolledBackBy: string | null
  readonly rollbackReason: string | null
}

// ---------------------------------------------------------------------------
// Pure transitions (no Firestore; unit-testable)
// ---------------------------------------------------------------------------

/** Fail-closed default: not started, every writer on legacy. */
export function defaultCutoverConfig(familyId: string): CutoverConfig {
  return {
    schemaVersion: CUTOVER_CONFIG_SCHEMA_VERSION,
    familyId,
    status: 'not_started',
    flags: defaultFeatureFlags(),
    activatedAt: null,
    activatedBy: null,
    rolledBackAt: null,
    rolledBackBy: null,
    rollbackReason: null,
  }
}

/** True iff the family is currently cut over (V4 writers armed). */
export function isCutoverActive(config: CutoverConfig): boolean {
  return config.status === 'active'
}

/**
 * Transition to the `active` state: arms every writer for V4 (or the supplied
 * flag set) and records who/when. Pure — the Firestore adapter persists it.
 */
export function activateCutover(
  config: CutoverConfig,
  opts: { activatedBy?: string; at?: string; flags?: FeatureFlagSet } = {},
): CutoverConfig {
  return {
    ...config,
    status: 'active',
    flags: opts.flags ?? withAllV4(config.flags),
    activatedAt: opts.at ?? new Date().toISOString(),
    activatedBy: opts.activatedBy ?? null,
    // Clear any prior rollback bookkeeping on a fresh activation.
    rolledBackAt: null,
    rolledBackBy: null,
    rollbackReason: null,
  }
}

/**
 * Transition to the `rolled_back` state: disarms every writer (all legacy) and
 * records the rollback reason. Pure — the Firestore adapter persists it. This
 * is the instant, config-only rollback (audit R1): no hosting redeploy needed.
 */
export function rollbackCutover(
  config: CutoverConfig,
  opts: { reason?: string; by?: string; at?: string } = {},
): CutoverConfig {
  return {
    ...config,
    status: 'rolled_back',
    flags: withAllLegacy(config.flags),
    rolledBackAt: opts.at ?? new Date().toISOString(),
    rolledBackBy: opts.by ?? null,
    rollbackReason: opts.reason ?? null,
  }
}

// ---------------------------------------------------------------------------
// Firestore adapter (emulator only)
// ---------------------------------------------------------------------------

/** Read the cutover config; returns the fail-closed default when absent. */
export async function readCutoverConfig(db: Firestore, familyId: string): Promise<CutoverConfig> {
  assertEmulatorOnly('readCutoverConfig')
  const snap = await db.doc(cutoverConfigDocPath(familyId)).get()
  if (!snap.exists) return defaultCutoverConfig(familyId)
  const data = snap.data() as Partial<CutoverConfig>
  // Defensive: a malformed/absent flag set falls back to all-legacy.
  const flags: FeatureFlagSet = data.flags ?? defaultFeatureFlags()
  return {
    ...defaultCutoverConfig(familyId),
    ...data,
    familyId,
    flags,
  }
}

/** Persist a cutover config document. */
export async function writeCutoverConfig(
  db: Firestore,
  familyId: string,
  config: CutoverConfig,
): Promise<void> {
  assertEmulatorOnly('writeCutoverConfig')
  await db.doc(cutoverConfigDocPath(familyId)).set({ ...config })
}

/**
 * Activate Stage 7 for a family: read current config, transition to `active`,
 * persist. Returns the persisted config. Emulator only.
 */
export async function activateStage7(
  db: Firestore,
  familyId: string,
  opts: { activatedBy?: string; at?: string; flags?: FeatureFlagSet } = {},
): Promise<CutoverConfig> {
  assertEmulatorOnly('activateStage7')
  const current = await readCutoverConfig(db, familyId)
  const next = activateCutover(current, opts)
  await writeCutoverConfig(db, familyId, next)
  return next
}

/**
 * Per-writer runtime kill switch (GATE 3 granularity). Flip a single writer's
 * route for a family and persist. Emulator only.
 */
export async function setWriterFlag(
  db: Firestore,
  familyId: string,
  writer: GamificationWriter,
  enabled: boolean,
): Promise<CutoverConfig> {
  assertEmulatorOnly('setWriterFlag')
  const current = await readCutoverConfig(db, familyId)
  const flags = enabled
    ? withWriterEnabled(current.flags, writer, familyId)
    : withWriterDisabled(current.flags, writer, familyId)
  const next: CutoverConfig = { ...current, flags }
  await writeCutoverConfig(db, familyId, next)
  return next
}
