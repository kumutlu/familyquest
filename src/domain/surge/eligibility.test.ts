/**
 * RED tests for the Surge eligibility resolver.
 *
 * These tests describe the contract the authoritative evaluator must satisfy.
 * Boundary semantics are pinned by these tests:
 *
 *   completedAt ∈ [startsAt, endsAt)   → eligible
 *   completedAt === endsAt              → not eligible
 *   completedAt <  startsAt             → not eligible
 *
 * Approval delay MUST NOT change the result (evaluation uses completedAt, not
 * approvedAt). The same completion/surge pair MUST NOT produce two bonuses.
 *
 * Sibling denial MUST hold even when Surge window is open and reward is
 * huge. Unassigned family tasks (task.assigneeId === null) MUST be eligible
 * for any active child.
 *
 * Family `surgeHours` opt-out disables future bonuses but MUST NOT
 * retroactively strip a bonus already recorded in immutable evidence.
 */
import { describe, expect, it } from 'vitest'

import { evaluateSurgeEligibility } from './eligibility'
import type {
  SurgeCompletionContext,
  SurgeEligibilityInput,
  SurgeTaskContext,
} from './types'

const TASK: SurgeTaskContext = {
  id: 'task-house-vacuum',
  title: 'House Vacuum',
  pointsReward: 15,
  assigneeId: 'child-A',
  requiresApproval: false,
}

const UNASSIGNED_TASK: SurgeTaskContext = {
  id: 'task-family-wash',
  title: 'Family Wash',
  pointsReward: 8,
  assigneeId: null,
  requiresApproval: true,
}

const SIBLING_TASK: SurgeTaskContext = {
  id: 'task-sibling',
  title: 'Read Book',
  pointsReward: 12,
  assigneeId: 'child-B',
  requiresApproval: false,
}

function surge(amount: number, eligibleTaskIds: string[]) {
  return {
    kind: 'task_bonus' as const,
    eligibleTaskIds,
    reward: { type: 'bonus_points' as const, amount },
  }
}

function baseInput(overrides: Partial<SurgeEligibilityInput> = {}): SurgeEligibilityInput {
  const start = Date.UTC(2026, 5, 1, 17, 0, 0)
  const end = Date.UTC(2026, 5, 1, 18, 0, 0)
  const completedAt = Date.UTC(2026, 5, 1, 17, 30, 0)
  const completion: SurgeCompletionContext = {
    id: 'completion-1',
    childId: 'child-A',
    taskId: TASK.id,
    completedAt,
    approvedAt: Date.UTC(2026, 5, 1, 19, 34, 0), // hours later
  }
  return {
    surgeId: 'surge-evening',
    surge: surge(10, [TASK.id]),
    surgeWindow: { startsAt: start, endsAt: end },
    task: TASK,
    completion,
    familyPreferences: { surgeHours: true },
    ...overrides,
  }
}

describe('evaluateSurgeEligibility — window boundary semantics', () => {
  it('rewards completion strictly inside the window', () => {
    const result = evaluateSurgeEligibility(
      baseInput({
        completion: {
          ...baseInput().completion,
          completedAt: Date.UTC(2026, 5, 1, 17, 30, 0),
        },
      }),
    )
    expect(result.eligible).toBe(true)
    expect(result.reason).toBe('in_window')
    expect(result.rewardSnapshot).toMatchObject({
      rewardType: 'bonus_points',
      rewardAmount: 10,
      surgeId: 'surge-evening',
      taskId: TASK.id,
      childId: 'child-A',
      completedWithinWindow: true,
      eventVersion: 1,
    })
  })

  it('rewards a completion one millisecond before endsAt', () => {
    const input = baseInput()
    const result = evaluateSurgeEligibility({
      ...input,
      completion: {
        ...input.completion,
        completedAt: input.surgeWindow.endsAt - 1,
      },
    })
    expect(result.eligible).toBe(true)
  })

  it('does NOT reward a completion exactly AT endsAt (window is half-open)', () => {
    const input = baseInput()
    const result = evaluateSurgeEligibility({
      ...input,
      completion: {
        ...input.completion,
        completedAt: input.surgeWindow.endsAt,
      },
    })
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe('outside_window')
  })

  it('rewards a completion exactly AT startsAt', () => {
    const input = baseInput()
    const result = evaluateSurgeEligibility({
      ...input,
      completion: {
        ...input.completion,
        completedAt: input.surgeWindow.startsAt,
      },
    })
    expect(result.eligible).toBe(true)
  })

  it('does NOT reward a completion one millisecond before startsAt', () => {
    const input = baseInput()
    const result = evaluateSurgeEligibility({
      ...input,
      completion: {
        ...input.completion,
        completedAt: input.surgeWindow.startsAt - 1,
      },
    })
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe('outside_window')
  })

  it('does NOT reward a completion one millisecond after endsAt', () => {
    const input = baseInput()
    const result = evaluateSurgeEligibility({
      ...input,
      completion: {
        ...input.completion,
        completedAt: input.surgeWindow.endsAt + 1,
      },
    })
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe('outside_window')
  })
})

describe('evaluateSurgeEligibility — approval delay MUST NOT change result', () => {
  it('rewards completion at 17:30 even when approval arrives at 19:34', () => {
    const input = baseInput({
      completion: {
        id: 'completion-x',
        childId: 'child-A',
        taskId: TASK.id,
        completedAt: Date.UTC(2026, 5, 1, 17, 30, 0),
        approvedAt: Date.UTC(2026, 5, 1, 19, 34, 0),
      },
    })
    const result = evaluateSurgeEligibility(input)
    expect(result.eligible).toBe(true)
  })

  it('does NOT reward completion at 18:00:01 even when approval is at 18:05', () => {
    const input = baseInput({
      completion: {
        id: 'completion-y',
        childId: 'child-A',
        taskId: TASK.id,
        completedAt: Date.UTC(2026, 5, 1, 18, 0, 1),
        approvedAt: Date.UTC(2026, 5, 1, 18, 5, 0),
      },
    })
    const result = evaluateSurgeEligibility(input)
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe('outside_window')
  })
})

describe('evaluateSurgeEligibility — task assignment semantics', () => {
  it('rewards when task.assigneeId === completion.childId', () => {
    const result = evaluateSurgeEligibility(baseInput())
    expect(result.eligible).toBe(true)
  })

  it('rewards when task.assigneeId === null (unassigned family task)', () => {
    const input = baseInput({
      task: UNASSIGNED_TASK,
      surge: surge(5, [UNASSIGNED_TASK.id]),
      completion: {
        ...baseInput().completion,
        taskId: UNASSIGNED_TASK.id,
      },
    })
    const result = evaluateSurgeEligibility(input)
    expect(result.eligible).toBe(true)
  })

  it('does NOT reward a sibling-assigned task (child-A completing child-B task)', () => {
    const input = baseInput({
      task: SIBLING_TASK,
      surge: surge(50, [SIBLING_TASK.id]),
      completion: {
        ...baseInput().completion,
        taskId: SIBLING_TASK.id,
      },
    })
    const result = evaluateSurgeEligibility(input)
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe('sibling_assigned')
  })

  it('does NOT reward a completion whose taskId is not in eligibleTaskIds', () => {
    const result = evaluateSurgeEligibility(
      baseInput({ surge: surge(10, ['other-task-id']) }),
    )
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe('task_not_eligible')
  })
})

describe('evaluateSurgeEligibility — completion integrity', () => {
  it('rejects when taskId mismatches between task and completion', () => {
    const input = baseInput({
      completion: { ...baseInput().completion, taskId: 'mismatch' },
    })
    const result = evaluateSurgeEligibility(input)
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe('invalid_completion')
  })

  it("denies when the completion childId is not the task assignee", () => {
    const input = baseInput({
      completion: { ...baseInput().completion, childId: 'child-X' },
    })
    const result = evaluateSurgeEligibility(input)
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe('sibling_assigned')
  })
})

describe('evaluateSurgeEligibility — family preference gate', () => {
  it('does NOT reward when family surgeHours preference is false', () => {
    const input = baseInput({ familyPreferences: { surgeHours: false } })
    const result = evaluateSurgeEligibility(input)
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe('preference_disabled')
  })
})

describe('evaluateSurgeEligibility — duplicate detection', () => {
  it('flags duplicate when the same completionId is replayed (idempotent)', () => {
    const input = baseInput({
      alreadyAwardedForCompletionIds: ['completion-1'],
    })
    const result = evaluateSurgeEligibility(input)
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe('duplicate')
  })

  it('does NOT treat an unrelated completionId as a duplicate', () => {
    const input = baseInput({
      alreadyAwardedForCompletionIds: ['other-completion'],
    })
    const result = evaluateSurgeEligibility(input)
    expect(result.eligible).toBe(true)
  })
})

describe('evaluateSurgeEligibility — event mutation invariance', () => {
  it('returns the snapshot amount captured at evaluation time (no late binding)', () => {
    const initialInput = baseInput({ surge: surge(10, [TASK.id]) })
    const first = evaluateSurgeEligibility(initialInput)
    expect(first.eligible).toBe(true)
    expect(first.rewardSnapshot?.rewardAmount).toBe(10)

    const mutatedInput: SurgeEligibilityInput = {
      ...initialInput,
      surge: surge(20, [TASK.id]), // event was edited later
    }
    const second = evaluateSurgeEligibility(mutatedInput)
    expect(second.eligible).toBe(true)
    expect(second.rewardSnapshot?.rewardAmount).toBe(20) // new evaluation sees new snapshot
    // The two evaluations are independent — each captures its own snapshot.
  })

  it('keeps the legacy reward captured in the audit trail regardless of later event deletion', () => {
    const result = evaluateSurgeEligibility(baseInput({ surge: surge(10, [TASK.id]) }))
    expect(result.eligible).toBe(true)
    expect(result.rewardSnapshot?.rewardAmount).toBe(10)

    // Simulating "event was deleted later": no Surge matches. The previously
    // recorded bonus is preserved by the immutable ledger, not by this
    // resolver. The resolver simply returns not_eligible for any future call.
    const emptyResult = evaluateSurgeEligibility(
      baseInput({
        surge: surge(10, []),
        alreadyAwardedForCompletionIds: ['completion-1'],
      }),
    )
    expect(emptyResult.eligible).toBe(false)
    expect(emptyResult.reason).toBe('duplicate')
  })
})

describe('evaluateSurgeEligibility — xp_multiplier is modelled but disabled', () => {
  it('rejects xp_multiplier rewards in V1 (no XP destabilisation)', () => {
    const input = baseInput({
      surge: {
        kind: 'task_bonus',
        eligibleTaskIds: [TASK.id],
        reward: { type: 'xp_multiplier', multiplier: 2 },
      },
    })
    const result = evaluateSurgeEligibility(input)
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe('invalid_completion')
  })
})

describe('evaluateSurgeEligibility — defensive defaults', () => {
  it('returns not eligible for malformed completion (NaN timestamp)', () => {
    const input = baseInput({
      completion: { ...baseInput().completion, completedAt: Number.NaN },
    })
    const result = evaluateSurgeEligibility(input)
    expect(result.eligible).toBe(false)
  })

  it('returns not eligible for malformed window (endsAt <= startsAt)', () => {
    const input = baseInput({
      surgeWindow: {
        startsAt: Date.UTC(2026, 5, 1, 18, 0, 0),
        endsAt: Date.UTC(2026, 5, 1, 17, 0, 0),
      },
    })
    const result = evaluateSurgeEligibility(input)
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe('outside_window')
  })

  it('returns not eligible for empty eligibleTaskIds', () => {
    const result = evaluateSurgeEligibility(baseInput({ surge: surge(10, []) }))
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe('task_not_eligible')
  })
})