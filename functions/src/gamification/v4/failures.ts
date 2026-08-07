/**
 * Gamification V4 — durable migration failure records (Task 4.4).
 *
 * Append-only failure log. A failure record is never overwritten or deleted by
 * the migration; it preserves the offending payload verbatim so the migration
 * can be audited and retried. The wallet-abort path records its reason
 * explicitly (acceptance criterion: wallet-abort reason captured).
 *
 * Storage: `families/{familyId}/gamification_failures/{failureId}`
 * Family-scoped (no root-level collection), so family isolation is structural
 * and the Firestore rules can express membership with `isFamilyMember(familyId)`.
 *
 * Safety:
 *   - `assertEmulatorOnly` (Task 4.1) fails closed unless FIRESTORE_EMULATOR_HOST
 *     is a local address. No applicationDefault / production credentials.
 *   - No wallet collection is ever read or written.
 *   - No legacy V2/V3 collection is ever touched.
 *
 * See docs/gamification-v4-design.md §2.4 and plan Task 4.4.
 */

import type { Firestore } from 'firebase-admin/firestore'
import { assertEmulatorOnly } from './repository'

/** Canonical collection id for durable V4 failure records (family-scoped). */
export const FAILURES_V4_COLLECTION_ID = 'gamification_failures'

/** Stage at which a migration failure was observed. */
export type FailureStageV4 =
  | 'replay'
  | 'migration'
  | 'rebuild'
  | 'wallet-abort'
  | 'unknown'

/** A durable, append-only record of a migration failure. */
export interface GamificationFailureV4 {
  failureId: string
  familyId: string
  stage: FailureStageV4
  reason: string
  payload: unknown
  recordedAt: string
  schemaVersion: 4
}

function failureCollectionRef(db: Firestore, familyId: string) {
  return db.collection('families').doc(familyId).collection(FAILURES_V4_COLLECTION_ID)
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
}

/**
 * Derive a stable, deterministic signature for a failure payload so that
 * re-recording the exact same failure is idempotent (no duplicate record) while
 * distinct failures get distinct ids. Prefers a stable key (eventId/sourceId)
 * when present, otherwise falls back to a JSON serialization.
 */
function payloadSignature(payload: unknown): string {
  if (payload === null || payload === undefined) return 'null'
  if (typeof payload === 'object') {
    const obj = payload as Record<string, unknown>
    const key = obj.eventId ?? obj.sourceId ?? obj.failureId
    if (typeof key === 'string' && key.length > 0) return key
  }
  return JSON.stringify(payload)
}

/**
 * Append a durable failure record. The record is never overwritten: a unique,
 * deterministic `failureId` is derived from the inputs so a retry of the exact
 * same failure is idempotent (overwrites the identical record) but a different
 * failure always creates a new record. The offending payload is preserved
 * verbatim — it is never discarded.
 */
export async function recordFailure(
  db: Firestore,
  familyId: string,
  stage: FailureStageV4,
  reason: string,
  payload: unknown,
): Promise<GamificationFailureV4> {
  assertEmulatorOnly('recordFailure')
  assertNonEmptyString(familyId, 'familyId')
  assertNonEmptyString(stage, 'stage')
  assertNonEmptyString(reason, 'reason')

  // Sanitize '/' so the id is a valid, single-segment Firestore document id
  // (payloads such as wallet paths may contain '/'). Idempotency is preserved
  // because the same inputs always produce the same sanitized id.
  const failureId = `${familyId}::${stage}::${reason}::${payloadSignature(payload)}`.replace(
    /\//g,
    '_',
  )
  const record: GamificationFailureV4 = {
    failureId,
    familyId,
    stage,
    reason,
    payload,
    recordedAt: new Date().toISOString(),
    schemaVersion: 4 as const,
  }

  const ref = failureCollectionRef(db, familyId).doc(failureId)
  await db.runTransaction(async (tx) => {
    tx.set(ref, { ...record })
  })
  return record
}

/**
 * Read every durable failure record for a family from the canonical
 * family-scoped path. Only records stored under the family partition are
 * returned (family isolation is structural).
 */
export async function readFailures(
  db: Firestore,
  familyId: string,
): Promise<GamificationFailureV4[]> {
  assertEmulatorOnly('readFailures')
  assertNonEmptyString(familyId, 'familyId')

  const snap = await failureCollectionRef(db, familyId).get()
  return snap.docs.map((d) => d.data() as GamificationFailureV4)
}
