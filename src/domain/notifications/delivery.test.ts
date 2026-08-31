/**
 * Smart Notifications V1 — delivery abstraction tests.
 */

import { describe, expect, it } from 'vitest'

import {
  FakeDeliveryProvider,
  LoggingDeliveryProvider,
  NoopDeliveryProvider,
  deepLinkFor,
} from './delivery'
import type { NotificationPayload } from './delivery'

const PAYLOAD: NotificationPayload = Object.freeze({
  familyId: 'fam-1',
  childId: 'child-ali',
  type: 'surge',
  title: 'SURGE — Vacuum',
  body: '+10 bonus for 42 minutes.',
  dedupeKey: 'surge:surg-1:child-ali',
  locale: 'en',
  deepLink: '/tasks',
})

describe('Smart Notifications — FakeDeliveryProvider', () => {
  it('records sent payloads and returns sent status', async () => {
    const p = new FakeDeliveryProvider()
    const r = await p.send(PAYLOAD)
    expect(r.status).toBe('sent')
    expect(p.sent).toHaveLength(1)
    expect(p.sent[0]?.dedupeKey).toBe(PAYLOAD.dedupeKey)
  })

  it('returns failed when a failure is preset', async () => {
    const p = new FakeDeliveryProvider()
    p.failures.set(PAYLOAD.dedupeKey, 'invalid_token')
    const r = await p.send(PAYLOAD)
    expect(r.status).toBe('failed')
  })
})

describe('Smart Notifications — NoopDeliveryProvider', () => {
  it('always returns skipped', async () => {
    const p = new NoopDeliveryProvider()
    const r = await p.send(PAYLOAD)
    expect(r.status).toBe('skipped')
  })
})

describe('Smart Notifications — LoggingDeliveryProvider', () => {
  it('logs length, not body, and delegates status', async () => {
    const inner = new FakeDeliveryProvider()
    const events: Array<Record<string, unknown>> = []
    const logger = new LoggingDeliveryProvider(inner, (e) => events.push(e))
    const r = await logger.send(PAYLOAD)
    expect(r.status).toBe('sent')
    expect(events).toHaveLength(1)
    const e = events[0]
    if (!e) throw new Error('expected log event')
    expect(e).not.toHaveProperty('body')
    expect(e).not.toHaveProperty('token')
    expect(e.bodyLength).toBe(PAYLOAD.body.length)
  })
})

describe('Smart Notifications — deepLinkFor', () => {
  it('surge → /tasks', () => {
    expect(deepLinkFor('surge')).toBe('/tasks')
  })
  it('family_progress → /family', () => {
    expect(deepLinkFor('family_progress')).toBe('/family')
  })
})