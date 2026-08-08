import { GAMIFICATION_V3_SCHEMA_VERSION, type GamificationEventV3 } from './event'
import { STATE_V3_FIELDS, type GamificationStateV3 } from './state'
import { assertValidEventV3, assertValidStateV3, ValidationErrorV3 } from './validators'

/**
 * Shadow storage contract for Gamification V3.
 *
 * Phase 1 defines and tests the shapes only. There is no runtime writer: these
 * are pure serialisation utilities with no Firestore dependency.
 *
 *   families/{familyId}/gamification_events_v3/{eventId}
 *   families/{familyId}/gamification_state_v3/{memberId}
 *
 * Ownership : written only by the (future) Phase 2 shadow writer running in
 *             Cloud Functions; read-only for clients and tooling.
 * Retention : events are immutable and retained indefinitely; state documents
 *             are disposable and always rebuildable from the event stream.
 * Rebuild   : delete the state document and fold the member's events through
 *             `reduceGamificationEventsV3`.
 */

export const EVENTS_V3_COLLECTION_ID = 'gamification_events_v3'
export const STATE_V3_COLLECTION_ID = 'gamification_state_v3'

export function eventDocPath(familyId: string, eventId: string): string {
  return `families/${familyId}/${EVENTS_V3_COLLECTION_ID}/${eventId}`
}

export function stateDocPath(familyId: string, memberId: string): string {
  return `families/${familyId}/${STATE_V3_COLLECTION_ID}/${memberId}`
}

/** Fields that must never be persisted on a shadow event document. */
export const PROHIBITED_EVENT_FIELDS = ['lifetimeXP', 'points', 'totalPoints', 'weeklyTotal'] as const

/** Composite indexes required by the documented shadow read patterns. */
export const REQUIRED_EVENT_INDEXES = Object.freeze([
  Object.freeze({
    collectionGroup: EVENTS_V3_COLLECTION_ID,
    queryScope: 'COLLECTION',
    fields: Object.freeze([
      Object.freeze({ fieldPath: 'memberId', order: 'ASCENDING' }),
      Object.freeze({ fieldPath: 'effectiveAt', order: 'ASCENDING' }),
    ]),
  }),
])

export function serialiseEventV3(event: GamificationEventV3): Record<string, unknown> {
  assertValidEventV3(event)
  for (const prohibited of PROHIBITED_EVENT_FIELDS) {
    if (prohibited in (event as unknown as Record<string, unknown>)) {
      throw new ValidationErrorV3(`prohibited field ${prohibited} must not be persisted on a V3 event`)
    }
  }
  const serialised: Record<string, unknown> = {
    schemaVersion: GAMIFICATION_V3_SCHEMA_VERSION,
    eventId: event.eventId,
    eventType: event.eventType,
    familyId: event.familyId,
    memberId: event.memberId,
    sourceType: event.sourceType,
    sourceId: event.sourceId,
    effectiveAt: event.effectiveAt,
    createdAt: event.createdAt,
    rewardPointsDelta: event.rewardPointsDelta,
    xpDelta: event.xpDelta,
    weeklyPointsDelta: event.weeklyPointsDelta,
    idempotencyKey: event.idempotencyKey,
    metadata: { ...event.metadata },
  }
  if (event.eventType === 'REVERSAL') {
    serialised.reversalOfEventId = event.reversalOfEventId
  }
  return serialised
}

export function deserialiseEventV3(raw: unknown): GamificationEventV3 {
  assertValidEventV3(raw)
  return raw
}

export function serialiseStateV3(state: GamificationStateV3): Record<string, unknown> {
  assertValidStateV3(state)
  const serialised: Record<string, unknown> = {}
  for (const field of STATE_V3_FIELDS) {
    serialised[field] = state[field]
  }
  return serialised
}

export function deserialiseStateV3(raw: unknown): GamificationStateV3 {
  assertValidStateV3(raw)
  return raw
}
