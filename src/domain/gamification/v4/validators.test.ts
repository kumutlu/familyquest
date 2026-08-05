import { describe, expect, it } from 'vitest'
import {
  ValidationErrorV4,
  assertNonNegativeRewardPoints,
  assertValidEventV4,
  assertValidStateV4,
  assertXpOnlyDecreasesViaReversal,
} from './validators'
import type { GamificationEventV4 } from './event'
import type { GamificationStateV4 } from './types'

function makeEvent(overrides: Partial<GamificationEventV4> = {}): GamificationEventV4 {
  return {
    schemaVersion: 4,
    eventId: 'fam::mem::TASK_APPROVED::src1',
    familyId: 'fam',
    memberId: 'mem',
    eventType: 'TASK_APPROVED',
    sourceType: 'task_completion',
    sourceId: 'src1',
    effectiveAt: '2026-01-05T10:00:00.000Z',
    createdAt: '2026-01-05T10:00:00.000Z',
    rewardPointsDelta: 10,
    xpDelta: 5,
    metadata: {},
    estimated: false,
    ...overrides,
  }
}

function makeState(overrides: Partial<GamificationStateV4> = {}): GamificationStateV4 {
  return {
    rewardPoints: 10,
    xpTotal: 120,
    level: 2,
    xpProgressInLevel: 20,
    xpToNextLevel: 80,
    levelProgressPercentage: 20,
    currentStreak: 3,
    bestStreak: 5,
    lastQualifiedDayKey: '2026-01-05',
    unlockedAchievementIds: [],
    unlockedAvatarIds: [],
    projectionVersion: 1,
    foldedThroughEventId: null,
    updatedAt: '2026-01-05T10:00:00.000Z',
    ...overrides,
  }
}

describe('V4 validators — events', () => {
  it('accepts a well-formed TASK_APPROVED event', () => {
    expect(() => assertValidEventV4(makeEvent())).not.toThrow()
  })

  it('rejects an illegal delta combo (negative xp on TASK_APPROVED)', () => {
    expect(() =>
      assertValidEventV4(makeEvent({ xpDelta: -5 })),
    ).toThrow(ValidationErrorV4)
  })

  it('rejects a negative rewardPointsDelta on an earning event', () => {
    expect(() =>
      assertValidEventV4(makeEvent({ rewardPointsDelta: -1 })),
    ).toThrow(ValidationErrorV4)
  })

  it('rejects a non-integer rewardPointsDelta', () => {
    expect(() =>
      assertValidEventV4(makeEvent({ rewardPointsDelta: 1.5 })),
    ).toThrow(ValidationErrorV4)
  })

  it('rejects an unknown event type', () => {
    expect(() =>
      assertValidEventV4(makeEvent({ eventType: 'BOGUS' as GamificationEventV4['eventType'] })),
    ).toThrow(ValidationErrorV4)
  })

  it('rejects a reversal event without reversalOfEventId', () => {
    expect(() =>
      assertValidEventV4(makeEvent({ eventType: 'TASK_REVERSED' })),
    ).toThrow(ValidationErrorV4)
  })

  it('accepts a reversal event that references its original', () => {
    expect(() =>
      assertValidEventV4(
        makeEvent({
          eventType: 'TASK_REVERSED',
          eventId: 'fam::mem::TASK_REVERSED::src1',
          rewardPointsDelta: -10,
          xpDelta: -5,
          reversalOfEventId: 'fam::mem::TASK_APPROVED::src1',
        }),
      ),
    ).not.toThrow()
  })

  it('rejects reversalOfEventId on a non-reversal event type', () => {
    expect(() =>
      assertValidEventV4(makeEvent({ reversalOfEventId: 'fam::mem::TASK_APPROVED::src1' })),
    ).toThrow(ValidationErrorV4)
  })
})

describe('V4 validators — xp decrease guard', () => {
  it('throws when xpDelta is negative without a reversal reference', () => {
    expect(() =>
      assertXpOnlyDecreasesViaReversal(makeEvent({ xpDelta: -5 })),
    ).toThrow(ValidationErrorV4)
  })

  it('passes when xpDelta is negative but a reversal is referenced', () => {
    expect(() =>
      assertXpOnlyDecreasesViaReversal(
        makeEvent({ xpDelta: -5, reversalOfEventId: 'fam::mem::TASK_APPROVED::src1' }),
      ),
    ).not.toThrow()
  })

  it('passes when xpDelta is non-negative regardless of reversal', () => {
    expect(() => assertXpOnlyDecreasesViaReversal(makeEvent({ xpDelta: 0 }))).not.toThrow()
    expect(() => assertXpOnlyDecreasesViaReversal(makeEvent({ xpDelta: 5 }))).not.toThrow()
  })
})

describe('V4 validators — non-negative reward points', () => {
  it('throws on a negative value', () => {
    expect(() => assertNonNegativeRewardPoints(-1, 'rewardPoints')).toThrow(ValidationErrorV4)
  })

  it('throws on a non-integer value', () => {
    expect(() => assertNonNegativeRewardPoints(1.5, 'rewardPoints')).toThrow(ValidationErrorV4)
  })

  it('passes on zero and positive integers', () => {
    expect(() => assertNonNegativeRewardPoints(0, 'rewardPoints')).not.toThrow()
    expect(() => assertNonNegativeRewardPoints(10, 'rewardPoints')).not.toThrow()
  })
})

describe('V4 validators — state', () => {
  it('accepts a well-formed state', () => {
    expect(() => assertValidStateV4(makeState())).not.toThrow()
  })

  it('rejects a negative rewardPoints state', () => {
    expect(() => assertValidStateV4(makeState({ rewardPoints: -1 }))).toThrow(ValidationErrorV4)
  })

  it('rejects a negative xpTotal state', () => {
    expect(() => assertValidStateV4(makeState({ xpTotal: -1 }))).toThrow(ValidationErrorV4)
  })

  it('rejects a level below 1', () => {
    expect(() => assertValidStateV4(makeState({ level: 0 }))).toThrow(ValidationErrorV4)
  })

  it('rejects a levelProgressPercentage above 100', () => {
    expect(() => assertValidStateV4(makeState({ levelProgressPercentage: 101 }))).toThrow(
      ValidationErrorV4,
    )
  })

  it('rejects a non-array unlockedAvatarIds', () => {
    expect(() =>
      assertValidStateV4(makeState({ unlockedAvatarIds: 'nope' as unknown as string[] })),
    ).toThrow(ValidationErrorV4)
  })
})
