/**
 * Smart Notifications V1 — delivery abstraction.
 *
 * The Decision Engine picks WHAT to send; the Delivery Provider is
 * responsible for HOW (push, in-app, noop). V1 ships:
 *
 *   - `NotificationDeliveryProvider` interface
 *   - `FakeDeliveryProvider` (deterministic, for tests)
 *   - `LoggingDeliveryProvider` (wraps a provider, logs without raw
 *     token leakage)
 *
 * Production FCM wiring is left for a focused future rollout PR per
 * the spec §20 ("do not bolt on a half-configured production push
 * path").
 */

import type { NotificationType } from './types'

export interface NotificationPayload {
  readonly familyId: string
  readonly childId: string
  readonly type: NotificationType
  readonly title: string
  readonly body: string
  readonly dedupeKey: string
  readonly locale: 'en' | 'tr'
  /** Reserved route the client should navigate to when the user opens
   *  the notification. Safe identifier only (no PII in the URL). */
  readonly deepLink: string
}

export type DeliveryFailureReason =
  | 'invalid_token'
  | 'transient'
  | 'unauthorized'
  | 'unknown'

export type DeliveryResult =
  | { readonly status: 'sent'; readonly providerMessageId?: string }
  | { readonly status: 'skipped'; readonly reason: string }
  | { readonly status: 'failed'; readonly reason: DeliveryFailureReason; readonly retryable: boolean }

export interface NotificationDeliveryProvider {
  send(payload: NotificationPayload): Promise<DeliveryResult>
}

/** Deterministic in-memory provider used by tests. */
export class FakeDeliveryProvider implements NotificationDeliveryProvider {
  readonly sent: NotificationPayload[] = []
  readonly failures = new Map<string, DeliveryFailureReason>()

  async send(payload: NotificationPayload): Promise<DeliveryResult> {
    const fail = this.failures.get(payload.dedupeKey)
    if (fail) {
      return { status: 'failed', reason: fail, retryable: true }
    }
    this.sent.push(payload)
    return { status: 'sent', providerMessageId: `fake-${payload.dedupeKey}` }
  }
}

/** A no-op delivery provider used when notifications are globally
 *  disabled by a feature flag. */
export class NoopDeliveryProvider implements NotificationDeliveryProvider {
  async send(_payload: NotificationPayload): Promise<DeliveryResult> {
    return { status: 'skipped', reason: 'noop' }
  }
}

/** Wraps another provider and emits structured logs. Never logs raw
 *  tokens or full bodies. */
export class LoggingDeliveryProvider implements NotificationDeliveryProvider {
  private readonly inner: NotificationDeliveryProvider
  private readonly log: (entry: Record<string, unknown>) => void
  constructor(
    inner: NotificationDeliveryProvider,
    log: (entry: Record<string, unknown>) => void,
  ) {
    this.inner = inner
    this.log = log
  }

  async send(payload: NotificationPayload): Promise<DeliveryResult> {
    const result = await this.inner.send(payload)
    this.log({
      event: 'notification_delivery',
      status: result.status,
      type: payload.type,
      locale: payload.locale,
      childId: payload.childId,
      familyId: payload.familyId,
      dedupeKey: payload.dedupeKey,
      // body length, not the body itself — protects PII.
      bodyLength: payload.body.length,
    })
    return result
  }
}

/** Map notification type → safe deep-link route. No query string
 *  state. */
export function deepLinkFor(type: NotificationType): string {
  switch (type) {
    case 'morning_brief': return '/'
    case 'surge': return '/tasks'
    case 'streak': return '/tasks'
    case 'family_progress': return '/family'
    case 'seasonal': return '/'
    case 'quest_reminder': return '/tasks'
    // Mystery Drop / Comeback notifications deep-link into the child home
    // where the adventure surface (reveal card / mission card) lives.
    case 'mystery_drop': return '/'
    case 'comeback': return '/'
    default: {
      // Exhaustive per the closed NotificationType union; the default arm
      // keeps the total function total if the union ever grows.
      const _exhaustive: never = type
      void _exhaustive
      return '/'
    }
  }
}