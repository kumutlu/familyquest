/**
 * Gamification V4 — canonical Firestore storage paths.
 *
 * This module is the SINGLE source of truth for where V4 data lives. Every
 * writer, reader, rebuild routine and test must derive its paths from here so
 * the repository, the Firestore rules and the read model can never drift
 * apart again.
 *
 * Canonical paths (docs/gamification-v4-design.md §2.1 and §2.4):
 *
 *   families/{familyId}/gamification_events/{eventId}   — authoritative ledger
 *   families/{familyId}/gamification_state/{memberId}   — authoritative projection
 *
 * Both collections are family-scoped. Family isolation is therefore
 * structural: a member id alone can never address another family's document,
 * and the Firestore rules can express membership with `isFamilyMember(familyId)`
 * because `familyId` is present in the path.
 *
 * Rules:
 *   - Exactly one canonical path per collection. No aliases.
 *   - No root-level `gamification_state` collection.
 *   - No V2/V3 compatibility paths (`*_v3` belongs to the V3 module).
 *   - Written ONLY by the trusted backend (Admin SDK); clients may read only.
 *
 * Pure string helpers: no Firestore dependency, safe to import from both the
 * client bundle and Cloud Functions.
 */

export const FAMILIES_COLLECTION_ID = 'families'
export const EVENTS_V4_COLLECTION_ID = 'gamification_events'
export const STATE_V4_COLLECTION_ID = 'gamification_state'

/** Thrown when a path segment is empty or would escape its partition. */
export class InvalidPathSegmentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidPathSegmentError'
  }
}

/**
 * Validate a single Firestore path segment.
 *
 * Rejects empty segments (which would silently collapse the path) and any
 * segment containing `/` (which would inject extra path components and could
 * cross a family partition boundary).
 */
function assertSegment(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new InvalidPathSegmentError(`${label} must be a non-empty string`)
  }
  if (value.includes('/')) {
    throw new InvalidPathSegmentError(`${label} must not contain "/" (got ${JSON.stringify(value)})`)
  }
  if (value === '.' || value === '..') {
    throw new InvalidPathSegmentError(`${label} must not be a relative path segment`)
  }
  return value
}

/** `families/{familyId}` */
export function familyDocPath(familyId: string): string {
  return `${FAMILIES_COLLECTION_ID}/${assertSegment(familyId, 'familyId')}`
}

/** `families/{familyId}/gamification_events` */
export function eventCollectionPath(familyId: string): string {
  return `${familyDocPath(familyId)}/${EVENTS_V4_COLLECTION_ID}`
}

/** `families/{familyId}/gamification_events/{eventId}` */
export function eventDocPath(familyId: string, eventId: string): string {
  return `${eventCollectionPath(familyId)}/${assertSegment(eventId, 'eventId')}`
}

/** `families/{familyId}/gamification_state` */
export function stateCollectionPath(familyId: string): string {
  return `${familyDocPath(familyId)}/${STATE_V4_COLLECTION_ID}`
}

/** `families/{familyId}/gamification_state/{memberId}` */
export function stateDocPath(familyId: string, memberId: string): string {
  return `${stateCollectionPath(familyId)}/${assertSegment(memberId, 'memberId')}`
}
