/**
 * Smart Notifications V1 — server-owned delivery state shape.
 *
 * The authoritative Firestore document is
 *   families/{familyId}/notification_state/{childId}
 *
 * This module is the TYPE contract. The Rules mirror the closed key
 * set on read; clients may READ this doc to drive UI counters but may
 * never WRITE it. Writes happen in the trusted backend (Cloud
 * Functions).
 *
 * Designed for bounded growth: only today's `localDate`, the count, the
 * keys list (bounded by max-per-day ≤ 3), and the last-sent timestamp.
 */

import type { NotificationDeliveryState } from './types'

export interface ServerNotificationState {
  /** yyyy-mm-dd in family-local time. When it changes, the counter
   *  resets to 0 and sentKeys clears. */
  readonly localDate: string
  /** How many notifications have been delivered today. */
  readonly sentCount: number
  /** The dedupe keys already delivered today. Bounded by
   *  intensityToMaxPerDay. */
  readonly sentKeys: readonly string[]
  /** Epoch ms. Used by retry logic to compute age. */
  readonly lastSentAt?: number
  /** Last status transition. */
  readonly lastStatus?: 'reserved' | 'sent' | 'failed'
}

export const EMPTY_SERVER_STATE: ServerNotificationState = Object.freeze({
  localDate: '1970-01-01',
  sentCount: 0,
  sentKeys: Object.freeze([]) as readonly string[],
})

/** Coerce a Firestore read into our shape. Missing fields default
 *  defensively. Used by the resolver to build a
 *  `NotificationDeliveryState`. */
export function toDecisionDeliveryState(state: Partial<ServerNotificationState> | null | undefined): NotificationDeliveryState {
  if (!state) return { sentToday: 0, sentKeysToday: [] }
  return Object.freeze({
    sentToday: typeof state.sentCount === 'number' ? state.sentCount : 0,
    sentKeysToday: Array.isArray(state.sentKeys) ? state.sentKeys.slice() : [],
    lastSentAt: typeof state.lastSentAt === 'number' ? state.lastSentAt : undefined,
  }) as NotificationDeliveryState
}

/** Cap-check helper used by the reservation step before writing. */
export function shouldReserveNewDelivery(args: {
  state: ServerNotificationState
  localDate: string
  maxPerDay: number
  dedupeKey: string
}): { reserve: true } | { reserve: false; reason: 'daily_cap' | 'duplicate' | 'date_rollover' } {
  if (args.state.localDate !== args.localDate) {
    // Date rolled over — the count resets; this is the FIRST send of
    // the new day.
    if (args.state.sentKeys.includes(args.dedupeKey)) {
      return { reserve: false, reason: 'duplicate' }
    }
    return { reserve: true }
  }
  if (args.state.sentCount >= args.maxPerDay) {
    return { reserve: false, reason: 'daily_cap' }
  }
  if (args.state.sentKeys.includes(args.dedupeKey)) {
    return { reserve: false, reason: 'duplicate' }
  }
  return { reserve: true }
}