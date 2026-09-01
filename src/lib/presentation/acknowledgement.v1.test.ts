/**
 * Presentation-only acknowledgement tests.
 *
 * Pins:
 *  - Acknowledgement is UI state only. Repeated OPEN of the same drop
 *    is acknowledged exactly once.
 *  - Refresh/remount within the same tab does not duplicate the
 *    acknowledgement.
 *  - Different drop ids are tracked independently.
 *  - Comeback completion keys are tracked independently per (date, tier).
 */

import { describe, expect, it, beforeEach } from 'vitest'
import {
  acknowledgeComebackCompletion,
  acknowledgeMysteryReveal,
  isComebackCompletionAcknowledged,
  isMysteryRevealAcknowledged,
  resetAcknowledgementForTests,
} from './acknowledgement.v1'

describe('presentation acknowledgement store (UI state only)', () => {
  beforeEach(() => {
    resetAcknowledgementForTests()
  })

  it('starts unacknowledged for every drop id', () => {
    expect(isMysteryRevealAcknowledged('drop-1')).toBe(false)
    expect(isComebackCompletionAcknowledged('2026-09-01|return_3d')).toBe(false)
  })

  it('acknowledges a Mystery reveal once and remembers it', () => {
    acknowledgeMysteryReveal('drop-1')
    expect(isMysteryRevealAcknowledged('drop-1')).toBe(true)
    // Repeated OPEN does not duplicate.
    acknowledgeMysteryReveal('drop-1')
    acknowledgeMysteryReveal('drop-1')
    expect(isMysteryRevealAcknowledged('drop-1')).toBe(true)
  })

  it('tracks different drop ids independently', () => {
    acknowledgeMysteryReveal('drop-a')
    expect(isMysteryRevealAcknowledged('drop-a')).toBe(true)
    expect(isMysteryRevealAcknowledged('drop-b')).toBe(false)
  })

  it('rejects empty ids without throwing', () => {
    expect(() => acknowledgeMysteryReveal('')).not.toThrow()
    expect(isMysteryRevealAcknowledged('')).toBe(false)
  })

  it('acknowledges a comeback completion once per key', () => {
    acknowledgeComebackCompletion('2026-09-01|return_3d')
    expect(isComebackCompletionAcknowledged('2026-09-01|return_3d')).toBe(true)
    expect(isComebackCompletionAcknowledged('2026-09-02|return_3d')).toBe(false)
    expect(isComebackCompletionAcknowledged('2026-09-01|return_7d')).toBe(false)
  })

  it('reset clears every acknowledgement', () => {
    acknowledgeMysteryReveal('drop-a')
    acknowledgeComebackCompletion('2026-09-01|return_3d')
    resetAcknowledgementForTests()
    expect(isMysteryRevealAcknowledged('drop-a')).toBe(false)
    expect(isComebackCompletionAcknowledged('2026-09-01|return_3d')).toBe(false)
  })
})