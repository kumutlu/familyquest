/**
 * RED tests for the Mystery Drop pure-domain resolver.
 *
 * The resolver is the SINGLE source of truth for whether a child is
 * eligible to unlock a Mystery Drop on a given approved completion.
 * Same module is imported by the client engagement resolver (UI) and
 * the authoritative server-side evaluator (writes). Tests therefore
 * pin every branch both sides rely on.
 */
import { describe, expect, it } from 'vitest'

import {
  evaluateMysteryDropEligibility,
  isSupportedReward,
} from './eligibility'
import {
  childInRollout,
  isInMysteryDropWindow,
  mysteryDropEventId,
  mysteryDropEvidenceId,
  stableHash,
  type MysteryDropDefinition,
  type MysteryDropEligibilityInput,
} from './types'

/* ----- fixtures ---------------------------------------------------------- */

const WIN_START = Date.UTC(2026, 5, 1, 12, 0, 0)
const WIN_END = Date.UTC(2026, 5, 1, 18, 0, 0)

const BASE_DROP: MysteryDropDefinition = {
  id: 'drop-spring-01',
  version: 1,
  startsAt: WIN_START,
  endsAt: WIN_END,
  eligibility: { oncePerChild: true },
  unlockCondition: { type: 'complete_any_quest', count: 1 },
  reward: { type: 'xp_bonus', amount: 20 },
  presentation: {
    rarity: 'rare',
    messageKey: 'mysteryDrop.available',
    revealMessageKey: 'mysteryDrop.reveal',
  },
}

const BASE_COMPLETION = {
  id: 'completion-1',
  childId: 'child-A',
  taskId: 'task-house',
  completedAt: Date.UTC(2026, 5, 1, 15, 0, 0),
  requiresApproval: false,
}

function input(overrides: Partial<MysteryDropEligibilityInput> = {}): MysteryDropEligibilityInput {
  return {
    drop: overrides.drop ?? BASE_DROP,
    completion: overrides.completion ?? BASE_COMPLETION,
    ...(overrides.alreadyClaimedDropIds !== undefined
      ? { alreadyClaimedDropIds: overrides.alreadyClaimedDropIds }
      : {}),
  }
}

/* ----- happy path -------------------------------------------------------- */

describe('evaluateMysteryDropEligibility — happy path', () => {
  it('returns eligible when the completion falls inside the window and the drop requires no approval', () => {
    const result = evaluateMysteryDropEligibility(input())
    expect(result.eligible).toBe(true)
    expect(result.reason).toBe('eligible')
    expect(result.idempotencyKey).toBe(mysteryDropEventId('drop-spring-01', 'child-A'))
    expect(result.reward).toEqual({ type: 'xp_bonus', amount: 20 })
  })

  it('honors complete_specific_task by requiring an exact task id match', () => {
    const drop = { ...BASE_DROP, unlockCondition: { type: 'complete_specific_task' as const, taskId: 'task-house' } }
    expect(evaluateMysteryDropEligibility(input({ drop })).eligible).toBe(true)
    const wrong = { ...BASE_DROP, unlockCondition: { type: 'complete_specific_task' as const, taskId: 'task-dishes' } }
    expect(evaluateMysteryDropEligibility(input({ drop: wrong })).reason).toBe('completion_mismatch')
  })

  it('honors cosmetic_unlock rewards verbatim in the result', () => {
    const drop = { ...BASE_DROP, reward: { type: 'cosmetic_unlock' as const, itemId: 'frame.glow' } }
    const result = evaluateMysteryDropEligibility(input({ drop }))
    expect(result.eligible).toBe(true)
    expect(result.reward).toEqual({ type: 'cosmetic_unlock', itemId: 'frame.glow' })
  })

  it('honors collection_item rewards verbatim in the result', () => {
    const drop = { ...BASE_DROP, reward: { type: 'collection_item' as const, itemId: 'shell.sparkly' } }
    const result = evaluateMysteryDropEligibility(input({ drop }))
    expect(result.eligible).toBe(true)
    expect(result.reward).toEqual({ type: 'collection_item', itemId: 'shell.sparkly' })
  })
})

/* ----- window semantics --------------------------------------------------- */

describe('evaluateMysteryDropEligibility — window', () => {
  it('rejects a completion exactly at endsAt (half-open)', () => {
    const completion = { ...BASE_COMPLETION, completedAt: WIN_END }
    expect(evaluateMysteryDropEligibility(input({ completion })).reason).toBe('outside_window')
  })

  it('accepts a completion exactly at startsAt (inclusive)', () => {
    const completion = { ...BASE_COMPLETION, completedAt: WIN_START }
    expect(evaluateMysteryDropEligibility(input({ completion })).eligible).toBe(true)
  })

  it('rejects a completion before startsAt', () => {
    const completion = { ...BASE_COMPLETION, completedAt: WIN_START - 1 }
    expect(evaluateMysteryDropEligibility(input({ completion })).reason).toBe('outside_window')
  })

  it('isInMysteryDropWindow is defensive against NaN / non-finite numbers', () => {
    expect(isInMysteryDropWindow(NaN, WIN_START, WIN_END)).toBe(false)
    expect(isInMysteryDropWindow(WIN_START + 1, Number.NaN, WIN_END)).toBe(false)
    expect(isInMysteryDropWindow(WIN_START + 1, WIN_START, Number.NaN)).toBe(false)
    expect(isInMysteryDropWindow(WIN_START + 1, WIN_END, WIN_START)).toBe(false)
  })
})

/* ----- approval semantics ------------------------------------------------- */

describe('evaluateMysteryDropEligibility — approval', () => {
  it('blocks approval-required completions that have not been approved', () => {
    const completion = { ...BASE_COMPLETION, requiresApproval: true }
    expect(evaluateMysteryDropEligibility(input({ completion })).reason).toBe('requires_approval_pending')
  })

  it('accepts approval-required completions once approvedAt is supplied', () => {
    const completion = {
      ...BASE_COMPLETION,
      requiresApproval: true,
      approvedAt: WIN_START + 60_000,
    }
    expect(evaluateMysteryDropEligibility(input({ completion })).eligible).toBe(true)
  })
})

/* ----- idempotency ------------------------------------------------------- */

describe('evaluateMysteryDropEligibility — idempotency', () => {
  it('returns duplicate when the drop is in alreadyClaimedDropIds', () => {
    const result = evaluateMysteryDropEligibility(input({ alreadyClaimedDropIds: ['drop-spring-01'] }))
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe('duplicate')
    expect(result.idempotencyKey).toBe(mysteryDropEventId('drop-spring-01', 'child-A'))
  })

  it('does NOT return duplicate for an unrelated drop id in alreadyClaimedDropIds', () => {
    const result = evaluateMysteryDropEligibility(input({ alreadyClaimedDropIds: ['drop-other'] }))
    expect(result.eligible).toBe(true)
  })

  it('idempotency key is deterministic across runs', () => {
    expect(mysteryDropEventId('drop-x', 'child-1')).toBe('mystery-drop:drop-x:child:child-1')
    expect(mysteryDropEventId('drop-x', 'child-1')).toBe(mysteryDropEventId('drop-x', 'child-1'))
  })

  it('rejects empty ids in idempotency keys', () => {
    expect(() => mysteryDropEventId('', 'child-1')).toThrow(/non-empty/)
    expect(() => mysteryDropEventId('drop-x', '')).toThrow(/non-empty/)
  })

  it('rejects ids containing / in idempotency keys', () => {
    expect(() => mysteryDropEventId('drop/x', 'child-1')).toThrow(/non-empty/)
  })

  it('evidence id is dropId__childId', () => {
    expect(mysteryDropEvidenceId('drop-x', 'child-1')).toBe('drop-x__child-1')
  })
})

/* ----- deterministic rollout --------------------------------------------- */

describe('stableHash + childInRollout', () => {
  it('stableHash is deterministic for the same input', () => {
    expect(stableHash('drop-1|child-A')).toBe(stableHash('drop-1|child-A'))
  })

  it('stableHash produces a non-negative 32-bit integer', () => {
    const h = stableHash('drop-1|child-A')
    expect(Number.isInteger(h)).toBe(true)
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThanOrEqual(0xffffffff)
  })

  it('childInRollout is short-circuit at 0% and 100%', () => {
    expect(childInRollout('d', 'c', 0)).toBe(false)
    expect(childInRollout('d', 'c', 100)).toBe(true)
  })

  it('childInRollout is deterministic for the same (drop, child) pair', () => {
    for (let i = 1; i <= 25; i += 1) {
      const a = childInRollout('drop-1', `child-${i}`, 50)
      const b = childInRollout('drop-1', `child-${i}`, 50)
      expect(a).toBe(b)
    }
  })

  it('childInRollout spreads at roughly the requested percentage', () => {
    let hits = 0
    const sampleSize = 1000
    for (let i = 0; i < sampleSize; i += 1) {
      if (childInRollout('drop-spread', `child-${i}`, 30)) hits += 1
    }
    expect(hits).toBeGreaterThan(240)
    expect(hits).toBeLessThan(360)
  })
})

/* ----- input hardening --------------------------------------------------- */

describe('evaluateMysteryDropEligibility — invalid input', () => {
  it('rejects an unsupported reward (negative XP)', () => {
    const drop = { ...BASE_DROP, reward: { type: 'xp_bonus' as const, amount: -10 } }
    expect(evaluateMysteryDropEligibility(input({ drop })).reason).toBe('unsupported_reward')
  })

  it('rejects an unsupported reward (empty itemId)', () => {
    const drop = { ...BASE_DROP, reward: { type: 'cosmetic_unlock' as const, itemId: '' } }
    expect(evaluateMysteryDropEligibility(input({ drop })).reason).toBe('unsupported_reward')
  })

  it('isSupportedReward rejects malformed reward shapes', () => {
    expect(isSupportedReward({ type: 'cosmetic_unlock', itemId: '' })).toBe(false)
    expect(isSupportedReward({ type: 'xp_bonus', amount: 0 })).toBe(false)
    expect(isSupportedReward({ type: 'xp_bonus', amount: -1 })).toBe(false)
    expect(isSupportedReward({ type: 'cosmetic_unlock', itemId: 'frame' })).toBe(true)
  })

  it('rejects malformed completion (NaN completedAt)', () => {
    const completion = { ...BASE_COMPLETION, completedAt: Number.NaN }
    expect(evaluateMysteryDropEligibility(input({ completion })).reason).toBe('invalid_definition')
  })

  it('rejects an empty completion id', () => {
    const completion = { ...BASE_COMPLETION, id: '' }
    expect(evaluateMysteryDropEligibility(input({ completion })).reason).toBe('invalid_definition')
  })

  it('rejects an empty child id', () => {
    const completion = { ...BASE_COMPLETION, childId: '' }
    expect(evaluateMysteryDropEligibility(input({ completion })).reason).toBe('invalid_definition')
  })

  it('rejects an empty drop id', () => {
    const drop = { ...BASE_DROP, id: '' }
    expect(evaluateMysteryDropEligibility(input({ drop })).reason).toBe('invalid_definition')
  })
})