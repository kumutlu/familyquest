/**
 * Gamification V4 — server-only idempotent event/state repositories (Task 4.1).
 *
 * Trusted backend only. The client never writes these collections (enforced by
 * Firestore rules in Task 4.2). Every write is gated behind an emulator-only
 * guard so the repository can never target production Firestore and never
 * initialises production credentials.
 *
 * Reuses the existing V4 domain engine (no second reducer, no duplicate event
 * semantics, no hidden compatibility fields):
 *   - `assertValidEventV4` (validators) rejects malformed events.
 *   - `eventIdFor` (ids) is the idempotency anchor; `rejectCrossFamily`
 *     verifies the event id matches its family partition.
 *   - `rebuildStateFromLedger` (rebuild) is the canonical projection used by
 *     callers; the stored projection must equal its output.
 *
 * No wallet collection is ever referenced. Wallet data is completely out of
 * scope for V4.
 */

import type { Firestore } from 'firebase-admin/firestore'
import type { GamificationEventV4 } from '../../../../src/domain/gamification/v4/event'
import type { GamificationStateV4 } from '../../../../src/domain/gamification/v4/types'
import { assertValidEventV4 } from '../../../../src/domain/gamification/v4/validators'
import { eventIdFor } from '../../../../src/domain/gamification/v4/ids'

const LOCAL_EMULATOR_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

/** Thrown when a write is attempted outside a local Firestore emulator. */
export class EmulatorOnlyGuardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmulatorOnlyGuardError'
  }
}

/** Thrown when an event does not belong to the family partition it claims. */
export class CrossFamilyEventError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CrossFamilyEventError'
  }
}

/** True iff FIRESTORE_EMULATOR_HOST points at a local address. */
export function isEmulatorOnlyMode(): boolean {
  const host = process.env.FIRESTORE_EMULATOR_HOST
  if (!host) return false
  const hostPart = host.split(':')[0] || ''
  return LOCAL_EMULATOR_HOSTS.has(hostPart)
}

/** Fail closed unless we are targeting a local Firestore emulator. */
export function assertEmulatorOnly(context: string): void {
  if (!isEmulatorOnlyMode()) {
    throw new EmulatorOnlyGuardError(
      `Refusing ${context}: FIRESTORE_EMULATOR_HOST must be set to a local ` +
        `address (localhost|127.0.0.1|::1). Production writes are forbidden.`,
    )
  }
}

/**
 * Abort if the event's deterministic id does not match its family partition.
 * This rejects cross-family events (mandatory test #11) and any event whose id
 * was not derived via `eventIdFor`.
 */
export function rejectCrossFamily(event: GamificationEventV4): void {
  const expectedId = eventIdFor(event.familyId, event.memberId, event.eventType, event.sourceId)
  if (event.eventId !== expectedId) {
    throw new CrossFamilyEventError(
      `eventId ${event.eventId} does not belong to family ${event.familyId} ` +
        `(expected ${expectedId})`,
    )
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CrossFamilyEventError(`${label} must be a non-empty string`)
  }
}

/**
 * Write a V4 event idempotently. The document id is the deterministic event id,
 * so a duplicate delivery overwrites the same document (no double award). The
 * write is atomic: if the transaction fails, no partial state is left behind.
 * Malformed events and cross-family events are rejected before any write.
 */
export async function writeEventIdempotent(
  db: Firestore,
  event: GamificationEventV4,
): Promise<GamificationEventV4> {
  assertEmulatorOnly('writeEventIdempotent')
  assertValidEventV4(event)
  rejectCrossFamily(event)

  const ref = db
    .collection('families')
    .doc(event.familyId)
    .collection('gamification_events')
    .doc(event.eventId)

  await db.runTransaction(async (tx) => {
    tx.set(ref, { ...event })
  })

  return event
}

/**
 * Read the full V4 event ledger for a family. Only events stored under the
 * family partition are returned (family/member isolation).
 */
export async function readLedger(db: Firestore, familyId: string): Promise<GamificationEventV4[]> {
  assertEmulatorOnly('readLedger')
  assertNonEmptyString(familyId, 'familyId')

  const snap = await db
    .collection('families')
    .doc(familyId)
    .collection('gamification_events')
    .get()

  return snap.docs.map((d) => d.data() as GamificationEventV4)
}

/**
 * Write a member's V4 projection state. The document id is the member id
 * (globally unique). The write is atomic; a transaction failure leaves no
 * partial state. No wallet field is ever written.
 */
export async function writeState(
  db: Firestore,
  memberId: string,
  state: GamificationStateV4,
): Promise<GamificationStateV4> {
  assertEmulatorOnly('writeState')
  assertNonEmptyString(memberId, 'memberId')

  const ref = db.collection('gamification_state').doc(memberId)
  await db.runTransaction(async (tx) => {
    tx.set(ref, { ...state })
  })
  return state
}
