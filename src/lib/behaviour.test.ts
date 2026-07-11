import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DEBT_LIMIT_PENCE,
  calculateBehaviourEffect,
  normalizeBehaviourEvent,
  sortNewestFirst,
  validateBehaviourInput,
} from './behaviour'
import type { BehaviourEventInput } from './behaviour'

describe('validateBehaviourInput', () => {
  const validInputs: BehaviourEventInput[] = [
    { type: 'positive', reason: 'Helped out', pointsDelta: 1, walletDelta: 0 },
    { type: 'negative', reason: 'Late home', pointsDelta: -1, walletDelta: 0 },
    { type: 'financial', reason: 'Broken item', pointsDelta: 0, walletDelta: -1 },
  ]

  it.each(validInputs)('accepts a valid event and trims its reason', (input) => {
    expect(validateBehaviourInput({ ...input, reason: `  ${input.reason}  ` })).toEqual(input)
  })

  const invalidInputs: BehaviourEventInput[] = [
    { type: 'positive', reason: 'Good', pointsDelta: 0, walletDelta: 0 },
    { type: 'positive', reason: 'Good', pointsDelta: -1, walletDelta: 0 },
    { type: 'positive', reason: 'Good', pointsDelta: 1, walletDelta: -1 },
    { type: 'negative', reason: 'Late', pointsDelta: 0, walletDelta: 0 },
    { type: 'negative', reason: 'Late', pointsDelta: 1, walletDelta: 0 },
    { type: 'negative', reason: 'Late', pointsDelta: -1, walletDelta: -1 },
    { type: 'financial', reason: 'Fine', pointsDelta: 1, walletDelta: -1 },
    { type: 'financial', reason: 'Fine', pointsDelta: 0, walletDelta: 0 },
    { type: 'financial', reason: 'Fine', pointsDelta: 0, walletDelta: 1 },
  ]

  it.each(invalidInputs)('rejects invalid sign and zero combinations: $type/$pointsDelta/$walletDelta', (input) => {
    expect(() => validateBehaviourInput(input)).toThrow()
  })

  it.each(['', '  ', ' a ', ' ab '])('rejects a trimmed reason shorter than three characters', (reason) => {
    expect(() => validateBehaviourInput({ type: 'positive', reason, pointsDelta: 1, walletDelta: 0 })).toThrow(
      'Reason must be at least 3 characters long.',
    )
  })

  it.each([NaN, Infinity, -Infinity, 1.5])('rejects non-finite or non-integer deltas: %s', (pointsDelta) => {
    expect(() => validateBehaviourInput({ type: 'positive', reason: 'Good', pointsDelta, walletDelta: 0 })).toThrow(
      'Deltas must be finite integers.',
    )
  })
})

describe('calculateBehaviourEffect', () => {
  const balances = { rewardPoints: 10, lifetimeXP: 100, walletBalance: 0 }

  it('adds a positive delta to reward points and lifetime XP only', () => {
    expect(calculateBehaviourEffect(
      { type: 'positive', reason: 'Helped out', pointsDelta: 25, walletDelta: 0 },
      balances,
      DEFAULT_DEBT_LIMIT_PENCE,
    )).toEqual({ rewardPoints: 35, lifetimeXP: 125, walletBalance: 0, pointsDelta: 25, walletDelta: 0 })
  })

  it('clamps negative reward points and returns only the applied delta', () => {
    expect(calculateBehaviourEffect(
      { type: 'negative', reason: 'Late home', pointsDelta: -25, walletDelta: 0 },
      balances,
      -5000,
    )).toEqual({ rewardPoints: 0, lifetimeXP: 100, walletBalance: 0, pointsDelta: -10, walletDelta: 0 })
  })

  it('changes only wallet balance for a financial penalty at the exact debt limit', () => {
    expect(calculateBehaviourEffect(
      { type: 'financial', reason: 'Broken item', pointsDelta: 0, walletDelta: -1500 },
      { ...balances, walletBalance: -3500 },
      -5000,
    )).toEqual({ rewardPoints: 10, lifetimeXP: 100, walletBalance: -5000, pointsDelta: 0, walletDelta: -1500 })
  })

  it('rejects a financial penalty below the debt limit', () => {
    expect(() => calculateBehaviourEffect(
      { type: 'financial', reason: 'Broken item', pointsDelta: 0, walletDelta: -1501 },
      { ...balances, walletBalance: -3500 },
      -5000,
    )).toThrow('This penalty would exceed the family debt limit.')
  })
})

describe('compatibility helpers', () => {
  it('normalizes V1 field names without mutating the raw event', () => {
    const timestamp = { toMillis: () => 123 }
    const raw = { id: 'event-1', userId: 'child-1', authorId: 'parent-1', title: 'Legacy title', timestamp }

    expect(normalizeBehaviourEvent(raw)).toEqual({
      ...raw,
      childId: 'child-1',
      createdBy: 'parent-1',
      reason: 'Legacy title',
      createdAt: timestamp,
    })
    expect(raw).not.toHaveProperty('childId')
  })

  it('sorts mixed Timestamp, Date, and numeric dates newest first without mutating the input', () => {
    const items = [
      { id: 'old', timestamp: new Date('2026-01-01T00:00:00Z') },
      { id: 'new', createdAt: { toMillis: () => Date.parse('2026-03-01T00:00:00Z') } },
      { id: 'middle', createdAt: Date.parse('2026-02-01T00:00:00Z') },
    ]

    expect(sortNewestFirst(items).map(({ id }) => id)).toEqual(['new', 'middle', 'old'])
    expect(items.map(({ id }) => id)).toEqual(['old', 'new', 'middle'])
  })
})
