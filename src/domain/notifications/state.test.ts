/**
 * Smart Notifications V1 — delivery state and idempotency tests.
 *
 * Pins:
 *   - daily cap respected on reservation
 *   - duplicate dedupe key denied on reservation
 *   - date rollover resets the counter
 *   - toDecisionDeliveryState is defensive against missing fields
 */

import { describe, expect, it } from 'vitest'

import { shouldReserveNewDelivery, toDecisionDeliveryState } from './state'
import { intensityToMaxPerDay } from './preferences'

describe('Smart Notifications — shouldReserveNewDelivery', () => {
  it('allows first send of a fresh day', () => {
    const r = shouldReserveNewDelivery({
      state: { localDate: '1970-01-01', sentCount: 0, sentKeys: [] },
      localDate: '2026-08-31',
      maxPerDay: 3,
      dedupeKey: 'morning_brief:ali:2026-08-31',
    })
    expect(r).toEqual({ reserve: true })
  })

  it('denies when cap reached', () => {
    const r = shouldReserveNewDelivery({
      state: { localDate: '2026-08-31', sentCount: 3, sentKeys: ['a', 'b', 'c'] },
      localDate: '2026-08-31',
      maxPerDay: intensityToMaxPerDay('high'),
      dedupeKey: 'morning_brief:ali:2026-08-31',
    })
    expect(r).toEqual({ reserve: false, reason: 'daily_cap' })
  })

  it('denies duplicate dedupe key', () => {
    const r = shouldReserveNewDelivery({
      state: { localDate: '2026-08-31', sentCount: 1, sentKeys: ['morning_brief:ali:2026-08-31'] },
      localDate: '2026-08-31',
      maxPerDay: 3,
      dedupeKey: 'morning_brief:ali:2026-08-31',
    })
    expect(r).toEqual({ reserve: false, reason: 'duplicate' })
  })

  it('rolls over the counter on date change and denies only true duplicate', () => {
    const r = shouldReserveNewDelivery({
      state: { localDate: '2026-08-30', sentCount: 3, sentKeys: ['morning_brief:ali:2026-08-30'] },
      localDate: '2026-08-31',
      maxPerDay: 3,
      dedupeKey: 'morning_brief:ali:2026-08-31',
    })
    expect(r).toEqual({ reserve: true })
  })
})

describe('Smart Notifications — toDecisionDeliveryState', () => {
  it('returns zero state when input is null/undefined', () => {
    expect(toDecisionDeliveryState(null).sentToday).toBe(0)
    expect(toDecisionDeliveryState(undefined).sentToday).toBe(0)
  })

  it('coerces malformed fields defensively', () => {
    const s = toDecisionDeliveryState({
      localDate: '2026-08-31',
      sentCount: 'oops' as unknown as number,
      sentKeys: 'not-an-array' as unknown as string[],
    })
    expect(s.sentToday).toBe(0)
    expect(s.sentKeysToday).toEqual([])
  })
})