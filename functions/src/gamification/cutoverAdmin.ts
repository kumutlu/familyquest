/**
 * Gamification V4 — Phase 4 (B4): production-capable ACTIVATE / ROLLBACK.
 *
 * The operator half of the runtime cutover contract. Unlike `v4/cutoverConfig.ts`
 * (emulator-gated tooling) this module may run against production, but ONLY
 * through an explicit, identified operator call, and ONLY when the evidence is
 * green:
 *
 *   ACTIVATE requires, for the specific family AND writer:
 *     - Gate 1  — an owner-approved, hash-verified, fresh Gate 1 artifact in
 *                 which the family is classified;
 *     - Gate 2  — the `gamification_migration_marker` with walletHashOk and
 *                 BEFORE == AFTER, bound to that Gate 1 hash;
 *     - Stage 6 — a PASSING read-only verification report for the family.
 *   Anything missing => `CutoverActivationBlockedError`; nothing is written.
 *
 *   ROLLBACK is unconditional and immediate: it flips the family's config back
 *   to legacy in ONE document write. It requires no evidence (you must always
 *   be able to roll back), takes effect within one resolver TTL, needs NO
 *   redeploy, and NEVER deletes V4 ledger/state/marker data.
 *
 * Every activation and rollback appends an immutable audit record to
 * `families/{familyId}/gamification_cutover_audit/{id}`.
 *
 * The config and audit collections are denied to clients by Firestore rules.
 * No secret is involved anywhere, so nothing can leak into a client bundle.
 *
 * This module is located OUTSIDE `functions/src/gamification/v4/` on purpose:
 * it is production-capable and must NOT be forced emulator-only by the Stage 7
 * boundary guard (tools/architecture/v4-cutover-boundary.test.ts).
 */

import type { Firestore } from 'firebase-admin/firestore'

import {
  cutoverConfigDocPath,
  defaultCutoverConfig,
  activateCutover,
  rollbackCutover,
  type CutoverConfig,
} from './v4/cutoverConfig'
import {
  defaultFeatureFlags,
  withWriterEnabled,
  type FeatureFlagSet,
  type GamificationWriter,
} from '../../../src/domain/gamification/v4/featureFlags'

/** `families/{familyId}/gamification_cutover_audit/{id}` */
export const CUTOVER_AUDIT_COLLECTION = 'gamification_cutover_audit'
export function cutoverAuditDocPath(familyId: string, id: string): string {
  return `families/${familyId}/${CUTOVER_AUDIT_COLLECTION}/${id}`
}

/** Thrown when activation evidence is missing or failing. Nothing is written. */
export class CutoverActivationBlockedError extends Error {
  constructor(familyId: string, reason: string) {
    super(`[cutover] activation blocked for family ${familyId}: ${reason}`)
    this.name = 'CutoverActivationBlockedError'
  }
}

/** The three gates, as proven by the caller (Phases 1–3). */
export interface CutoverEvidence {
  readonly gate1: { readonly valid: boolean; readonly reason?: string; readonly reportHash: string }
  readonly gate2: { readonly markerPresent: boolean; readonly boundToGate1: boolean; readonly walletHashOk: boolean | null }
  readonly stage6: { readonly passed: boolean }
}

export interface CutoverAuditRecord {
  readonly schemaVersion: number
  readonly familyId: string
  readonly writer: GamificationWriter
  readonly action: 'activate' | 'rollback'
  readonly operator: string
  readonly at: string
  readonly previousStatus: string
  readonly newStatus: string
  readonly reason: string | null
  readonly gate1Hash: string | null
}

export interface ActivateWriterOptions {
  readonly db: Firestore
  readonly familyId: string
  readonly writer: GamificationWriter
  readonly operator: string
  readonly evidence: CutoverEvidence
  readonly at?: string
}

export interface RollbackWriterOptions {
  readonly db: Firestore
  readonly familyId: string
  readonly operator: string
  readonly reason: string
  readonly at?: string
}

/** Raw config read (no emulator gate; this module is production-capable). */
async function readConfigRaw(db: Firestore, familyId: string): Promise<CutoverConfig> {
  const snap = await db.doc(cutoverConfigDocPath(familyId)).get()
  if (!snap.exists) return defaultCutoverConfig(familyId)
  const data = snap.data() as Partial<CutoverConfig>
  const flags: FeatureFlagSet =
    data.flags !== null && typeof data.flags === 'object' ? data.flags : defaultFeatureFlags()
  return { ...defaultCutoverConfig(familyId), ...data, familyId, flags }
}

async function appendAudit(db: Firestore, record: CutoverAuditRecord): Promise<CutoverAuditRecord> {
  const id = `${record.action}-${record.at.replace(/[:.]/g, '-')}`
  await db.doc(cutoverAuditDocPath(record.familyId, id)).set({ ...record })
  return record
}

/**
 * Activate ONE writer for ONE family. Fail closed on any missing/failing gate.
 * Only the named writer is armed — activation is never global.
 */
export async function activateWriterCutover(
  options: ActivateWriterOptions,
): Promise<{ config: CutoverConfig; audit: CutoverAuditRecord }> {
  const { db, familyId, writer, evidence } = options
  const operator = (options.operator ?? '').trim()

  if (!familyId) throw new CutoverActivationBlockedError(String(familyId), 'no familyId supplied')
  if (!operator) throw new CutoverActivationBlockedError(familyId, 'an identified operator is required')

  if (!evidence?.gate1?.valid) {
    throw new CutoverActivationBlockedError(familyId, `Gate 1 not proven (${evidence?.gate1?.reason ?? 'absent'})`)
  }
  if (!evidence.gate2?.markerPresent) {
    throw new CutoverActivationBlockedError(familyId, 'Gate 2 migration marker absent')
  }
  if (!evidence.gate2.boundToGate1) {
    throw new CutoverActivationBlockedError(familyId, 'Gate 2 marker is not bound to the approved Gate 1 artifact')
  }
  if (evidence.gate2.walletHashOk !== true) {
    throw new CutoverActivationBlockedError(familyId, 'Gate 2 wallet hash equality not proven')
  }
  if (!evidence.stage6?.passed) {
    throw new CutoverActivationBlockedError(familyId, 'Stage 6 verification did not pass')
  }

  const at = options.at ?? new Date().toISOString()
  const current = await readConfigRaw(db, familyId)

  // Per-writer activation only: every other writer keeps its current route.
  const flags = withWriterEnabled(current.flags, writer, familyId)
  const next = activateCutover(current, { activatedBy: operator, at, flags })
  await db.doc(cutoverConfigDocPath(familyId)).set({ ...next })

  const audit = await appendAudit(db, {
    schemaVersion: 4,
    familyId,
    writer,
    action: 'activate',
    operator,
    at,
    previousStatus: current.status,
    newStatus: next.status,
    reason: null,
    gate1Hash: evidence.gate1.reportHash,
  })

  return { config: next, audit }
}

/**
 * INSTANT rollback: every writer back to legacy in ONE write, no redeploy, no
 * evidence required. V4 ledger/state/marker data is deliberately left intact so
 * the family can be re-activated (or investigated) without re-migrating.
 */
export async function rollbackWriterCutover(
  options: RollbackWriterOptions,
): Promise<{ config: CutoverConfig; audit: CutoverAuditRecord }> {
  const { db, familyId } = options
  const operator = (options.operator ?? '').trim() || 'unidentified-operator'
  const at = options.at ?? new Date().toISOString()

  const current = await readConfigRaw(db, familyId)
  const next = rollbackCutover(current, { reason: options.reason, by: operator, at })
  await db.doc(cutoverConfigDocPath(familyId)).set({ ...next })

  const audit = await appendAudit(db, {
    schemaVersion: 4,
    familyId,
    writer: 'task_approval',
    action: 'rollback',
    operator,
    at,
    previousStatus: current.status,
    newStatus: next.status,
    reason: options.reason,
    gate1Hash: null,
  })

  return { config: next, audit }
}
