import { describe, expect, it } from 'vitest'

import { eventIdFor } from '../../../../src/domain/gamification/v4/ids'
import { rebuildStateFromLedger } from '../../../../src/domain/gamification/v4/rebuild'
import { businessFields } from '../../../../src/domain/gamification/v4/types'
import type { GamificationEventV4 } from '../../../../src/domain/gamification/v4/event'
import {
  SmokeVerificationError,
  verifyTaskApprovalSmoke,
  type TaskApprovalSmokeSnapshot,
} from '../../../../scripts/cutover/task-approval-smoke'

const FAMILY = 'fam-A'
const MEMBER = 'member-A'
const TASK = 'task-A'
const COMPLETION = 'completion-A'
const EXPECTED_EVENT_ID = eventIdFor(FAMILY, MEMBER, 'TASK_APPROVED', COMPLETION)

const baseline: GamificationEventV4 = {
  schemaVersion: 4,
  eventId: eventIdFor(FAMILY, MEMBER, 'MIGRATION_BASELINE', 'BASELINE'),
  familyId: FAMILY,
  memberId: MEMBER,
  eventType: 'MIGRATION_BASELINE',
  sourceType: 'migration',
  sourceId: 'BASELINE',
  effectiveAt: '2026-08-01T00:00:00.000Z',
  createdAt: '2026-08-01T00:00:00.000Z',
  rewardPointsDelta: 100,
  xpDelta: 200,
  metadata: { reason: 'migration_baseline' },
  estimated: false,
}

const approval: GamificationEventV4 = {
  schemaVersion: 4,
  eventId: EXPECTED_EVENT_ID,
  familyId: FAMILY,
  memberId: MEMBER,
  eventType: 'TASK_APPROVED',
  sourceType: 'task_completion',
  sourceId: COMPLETION,
  effectiveAt: '2026-08-08T12:00:00.000Z',
  createdAt: '2026-08-08T12:00:01.000Z',
  rewardPointsDelta: 10,
  xpDelta: 10,
  metadata: { taskId: TASK, completionId: COMPLETION, awardedPoints: 10 },
  estimated: false,
}

const legacy = {
  userPath: `users/${MEMBER}`,
  userFields: { rewardPoints: 100, lifetimeXP: 200, lastTaskCompletionId: 'older-completion' },
  summaryPath: `families/${FAMILY}/gamification_summaries/${MEMBER}`,
  summaryFields: {
    schemaVersion: 1,
    familyId: FAMILY,
    childId: MEMBER,
    xpTotal: 200,
    level: 1,
    currentStreak: 2,
    bestStreak: 3,
    perfectDayCount: 1,
    lastQualifiedDayKey: '2026-08-07',
    projectionRevision: 9,
    foldedThrough: null,
    rebuildRequired: false,
    earliestDirtyCursor: null,
    projectionStatus: 'ready',
    updatedAt: '2026-08-07T12:00:00.000Z',
  },
  v1MemberEventCount: 9,
  v3StatePath: `families/${FAMILY}/gamification_state_v3/${MEMBER}`,
  v3StateFields: {
    rewardPoints: 100,
    xpTotal: 200,
    weeklyPoints: 25,
    weeklyWindowKey: '2026-W32',
    level: 1,
    xpProgressInLevel: 200,
    xpToNextLevel: 800,
    levelProgressPercentage: 20,
    currentStreak: 2,
    bestStreak: 3,
    lastQualifiedDayKey: '2026-08-07',
    unlockedAvatarIds: ['starter'],
  },
  v3MemberEventCount: 9,
} as const

function snapshots(): { before: TaskApprovalSmokeSnapshot; after: TaskApprovalSmokeSnapshot } {
  const beforeState = rebuildStateFromLedger([baseline], {
    updatedAt: baseline.createdAt,
    projectionVersion: 1,
    timezone: 'Europe/London',
  })
  const afterLedger = [baseline, approval]
  const afterState = rebuildStateFromLedger(afterLedger, {
    updatedAt: approval.createdAt,
    projectionVersion: 1,
    timezone: 'Europe/London',
  })
  const common = {
    schemaVersion: 1 as const,
    familyId: FAMILY,
    memberId: MEMBER,
    taskId: TASK,
    completionId: COMPLETION,
    timezone: 'Europe/London',
    expectedRewardPointsDelta: 10,
    expectedXpDelta: 10,
    expectedEventId: EXPECTED_EVENT_ID,
    route: 'v4' as const,
  }
  return {
    before: {
      ...common,
      legacy: structuredClone(legacy),
      phase: 'before',
      capturedAt: '2026-08-08T11:59:59.000Z',
      v4: {
        memberEventCount: 1,
        memberLedger: [baseline],
        expectedEvent: null,
        stateBusiness: businessFields(beforeState),
      },
    },
    after: {
      ...common,
      legacy: structuredClone(legacy),
      phase: 'after',
      capturedAt: '2026-08-08T12:00:02.000Z',
      v4: {
        memberEventCount: 2,
        memberLedger: afterLedger,
        expectedEvent: approval,
        stateBusiness: businessFields(afterState),
      },
    },
  }
}

function expectRejected(mutator: (after: TaskApprovalSmokeSnapshot) => void, code: string): void {
  const { before, after } = snapshots()
  mutator(after)
  try {
    verifyTaskApprovalSmoke(before, after)
    throw new Error('verification unexpectedly passed')
  } catch (error) {
    expect(error).toBeInstanceOf(SmokeVerificationError)
    expect((error as SmokeVerificationError).code).toBe(code)
  }
}

describe('Task 7.1 no-dual-write production smoke verifier', () => {
  it('passes a clean V4-only approval with exactly one deterministic award', () => {
    const { before, after } = snapshots()
    expect(verifyTaskApprovalSmoke(before, after)).toMatchObject({
      ok: true,
      eventId: EXPECTED_EVENT_ID,
      rewardPointsDelta: 10,
      xpDelta: 10,
    })
  })

  it('detects an additional legacy users.rewardPoints award', () => {
    expectRejected((after) => {
      after.legacy.userFields.rewardPoints = 110
    }, 'LEGACY_USER_CHANGED')
  })

  it('detects an additional legacy users.lifetimeXP award', () => {
    expectRejected((after) => {
      after.legacy.userFields.lifetimeXP = 210
    }, 'LEGACY_USER_CHANGED')
  })

  it('detects a mutation to the legacy gamification summary projection', () => {
    expectRejected((after) => {
      after.legacy.summaryFields.xpTotal = 210
      after.legacy.summaryFields.projectionRevision = 10
    }, 'LEGACY_SUMMARY_CHANGED')
  })

  it('detects a mutation to the V3 shadow summary/event path', () => {
    expectRejected((after) => {
      after.legacy.v3StateFields.xpTotal = 210
      after.legacy.v3MemberEventCount += 1
    }, 'LEGACY_V3_CHANGED')
  })

  it('detects a duplicate V4 event/award', () => {
    expectRejected((after) => {
      after.v4.memberLedger.push({
        ...approval,
        eventId: `${approval.eventId}::duplicate`,
        sourceId: `${approval.sourceId}::duplicate`,
      })
      after.v4.memberEventCount += 1
    }, 'V4_EVENT_COUNT_INVALID')
  })

  it('refuses a smoke whose BEFORE authoritative state is already inconsistent with its ledger', () => {
    const { before, after } = snapshots()
    before.v4.stateBusiness = {
      ...before.v4.stateBusiness!,
      rewardPoints: before.v4.stateBusiness!.rewardPoints + 1,
    }
    expect(() => verifyTaskApprovalSmoke(before, after)).toThrowError(
      expect.objectContaining({ code: 'V4_BEFORE_STATE_MISMATCH' }),
    )
  })
})
