/**
 * Gamification V4 — Phase 3 (blocker B3): PRODUCTION-CAPABLE Stage 6 verifier.
 *
 * `verifyPreCutover()` could only ever see the emulator, because every read it
 * performs goes through the emulator-gated repository. This module adds the
 * ONE read-only production path:
 *
 *   - a trusted operator READ context (`runWithTrustedRead`) authorises READS
 *     ONLY — any write attempted inside the scope is refused by the guard, so a
 *     production verification is provably side-effect free;
 *   - the run is FAMILY SCOPED (the read scope binds to a single familyId);
 *   - Gate 1 evidence (Phase 1 artifact) and Gate 2 (migration marker) are
 *     required, and the marker must be bound to the same Gate 1 hash;
 *   - check 6 uses the NON-MUTATING duplicate-migration proof, so unlike the
 *     emulator path nothing is ever re-executed against production;
 *   - the report is deterministic (fixed check order, marker-derived timestamp).
 *
 * No reducer / rebuild / classification logic is duplicated here: everything is
 * delegated to `verifyPreCutover()` and the Phase 1 validator.
 */

import type { Firestore } from 'firebase-admin/firestore'

import {
  runWithTrustedRead,
  type TrustedReadContext,
} from '../../functions/src/gamification/v4/trustedServerContext'
import { isEmulatorOnlyMode } from '../../functions/src/gamification/v4/repository'
import { verifyPreCutover, readMigrationMarker, type PreCutoverReport } from './pre-cutover'
import { validateGate1Artifact, type Gate1Artifact } from '../gate1/gate1-artifact'
import { GATE1_MAX_AGE_MS } from '../migrate/production-migration'
import type { ProductionReplayReport } from '../replay/production-report'

export interface ProductionVerifyOptions {
  readonly db: Firestore
  readonly familyId: string
  /** Approved Stage 3 replay report (baseline values). */
  readonly report: ProductionReplayReport
  /** Phase 1 Gate 1 evidence artifact. */
  readonly gate1: Gate1Artifact
  /** Identified operator running the verification. */
  readonly operator: string
  readonly now?: () => number
  readonly maxGate1AgeMs?: number
}

export interface ProductionVerifyResult {
  readonly familyId: string
  readonly passed: boolean
  readonly gate1: { readonly valid: boolean; readonly reason?: string; readonly classification?: string }
  readonly gate2: { readonly markerPresent: boolean; readonly boundToGate1: boolean; readonly walletHashOk: boolean | null }
  readonly stage6: PreCutoverReport | null
  /** Deterministic: derived from the marker, never the wall clock. */
  readonly generatedAt: string
  readonly readOnly: true
}

/**
 * READ-ONLY production Stage 6 verification for ONE family.
 * FAILS CLOSED: `passed` is true only when Gate 1, Gate 2 and all six Stage 6
 * checks are green. Never writes, in any mode.
 */
export async function verifyPreCutoverProduction(
  options: ProductionVerifyOptions,
): Promise<ProductionVerifyResult> {
  const { db, familyId, report, gate1 } = options
  const now = options.now ?? (() => Date.now())
  const operator = (options.operator ?? '').trim()

  if (!familyId) throw new Error('[stage6] no familyId supplied; verification is family-scoped')
  if (!operator) throw new Error('[stage6] an identified operator is required')

  const verdict = validateGate1Artifact(gate1, {
    familyId,
    now,
    maxAgeMs: options.maxGate1AgeMs ?? GATE1_MAX_AGE_MS,
  })

  const context: TrustedReadContext = {
    trustedServer: true,
    writer: 'verify',
    route: 'read-only',
    familyId,
    operator,
  }

  const run = async (): Promise<ProductionVerifyResult> => {
    const marker = await readMigrationMarker(db, familyId)
    const boundToGate1 = marker !== null && marker.reportHash === gate1.reportHash

    if (!verdict.valid || marker === null || !boundToGate1) {
      return {
        familyId,
        passed: false,
        gate1: verdict.valid
          ? { valid: true, classification: verdict.classification as string }
          : { valid: false, reason: verdict.reason as string },
        gate2: {
          markerPresent: marker !== null,
          boundToGate1,
          walletHashOk: marker ? marker.walletHashOk : null,
        },
        stage6: null,
        generatedAt: marker?.migratedAt ?? report.generatedAt,
        readOnly: true,
      }
    }

    const stage6 = await verifyPreCutover(familyId, { db, report, marker, readOnly: true })

    return {
      familyId,
      passed: stage6.passed && marker.walletHashOk === true,
      gate1: { valid: true, classification: verdict.classification as string },
      gate2: { markerPresent: true, boundToGate1: true, walletHashOk: marker.walletHashOk },
      stage6,
      generatedAt: stage6.generatedAt,
      readOnly: true,
    }
  }

  // Emulator keeps its historical (unauthenticated) path; production reads must
  // happen inside the explicit read-only trusted scope.
  return isEmulatorOnlyMode() ? run() : runWithTrustedRead(context, run)
}
