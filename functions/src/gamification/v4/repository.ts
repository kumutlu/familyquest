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
import {
  EVENTS_V4_COLLECTION_ID,
  FAMILIES_COLLECTION_ID,
  STATE_V4_COLLECTION_ID,
  eventDocPath,
  stateDocPath,
} from '../../../../src/domain/gamification/v4/storage'

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
 * Resolve the canonical `families/{familyId}/gamification_events` collection.
 * Path segments come from the canonical helper module so the repository, the
 * Firestore rules and the read model can never drift apart.
 */
function eventCollectionRef(db: Firestore, familyId: string) {
  return db
    .collection(FAMILIES_COLLECTION_ID)
    .doc(familyId)
    .collection(EVENTS_V4_COLLECTION_ID)
}

/** Resolve the canonical `families/{familyId}/gamification_state` collection. */
function stateCollectionRef(db: Firestore, familyId: string) {
  return db
    .collection(FAMILIES_COLLECTION_ID)
    .doc(familyId)
    .collection(STATE_V4_COLLECTION_ID)
}

/**
 * Write a V4 event idempotently to the canonical path
 * `families/{familyId}/gamification_events/{eventId}`.
 *
 * The document id is the deterministic event id, so a duplicate delivery
 * overwrites the same document (no double award). The write is atomic: if the
 * transaction fails, no partial state is left behind. Malformed events and
 * cross-family events are rejected before any write.
 */
export async function writeEventIdempotent(
  db: Firestore,
  event: GamificationEventV4,
): Promise<GamificationEventV4> {
  assertEmulatorOnly('writeEventIdempotent')
  assertValidEventV4(event)
  rejectCrossFamily(event)

  // Validates both segments and documents the canonical target path.
  eventDocPath(event.familyId, event.eventId)

  const ref = eventCollectionRef(db, event.familyId).doc(event.eventId)

  await db.runTransaction(async (tx) => {
    tx.set(ref, { ...event })
  })

  return event
}

/**
 * Read the full V4 event ledger for a family from the canonical path
 * `families/{familyId}/gamification_events`. Only events stored under the
 * family partition are returned (family/member isolation is structural).
 */
export async function readLedger(db: Firestore, familyId: string): Promise<GamificationEventV4[]> {
  assertEmulatorOnly('readLedger')
  assertNonEmptyString(familyId, 'familyId')

  const snap = await eventCollectionRef(db, familyId).get()

  return snap.docs.map((d) => d.data() as GamificationEventV4)
}

/**
 * Write a member's V4 projection state to the canonical path
 * `families/{familyId}/gamification_state/{memberId}`
 * (docs/gamification-v4-design.md §2.4).
 *
 * State is family-scoped: `familyId` is a required partition key, so the same
 * member id in two families addresses two distinct documents and no state can
 * ever leak across a family boundary. There is exactly one V4 state document
 * per member — no root-level copy, no alias, no V2/V3 compatibility write.
 *
 * The write is atomic; a transaction failure leaves no partial state. No
 * wallet field is ever written.
 */
export async function writeState(
  db: Firestore,
  familyId: string,
  memberId: string,
  state: GamificationStateV4,
): Promise<GamificationStateV4> {
  assertEmulatorOnly('writeState')
  assertNonEmptyString(familyId, 'familyId')
  assertNonEmptyString(memberId, 'memberId')

  // Validates both segments and documents the canonical target path.
  stateDocPath(familyId, memberId)

  const ref = stateCollectionRef(db, familyId).doc(memberId)
  await db.runTransaction(async (tx) => {
    tx.set(ref, { ...state })
  })
  return state
}

/**
 * Read a member's V4 projection state from the canonical path. Reads and
 * rebuild writes therefore use exactly the same path derivation.
 */
export async function readState(
  db: Firestore,
  familyId: string,
  memberId: string,
): Promise<GamificationStateV4 | null> {
  assertEmulatorOnly('readState')
  assertNonEmptyString(familyId, 'familyId')
  assertNonEmptyString(memberId, 'memberId')

  stateDocPath(familyId, memberId)

  const snap = await stateCollectionRef(db, familyId).doc(memberId).get()
  return snap.exists ? (snap.data() as GamificationStateV4) : null
}
