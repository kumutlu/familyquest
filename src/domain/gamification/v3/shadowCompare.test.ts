import { describe, expect, it } from 'vitest'
import { GAMIFICATION_V3_SCHEMA_VERSION, type GamificationEventV3 } from './event'
import { legacyBaselineEventId, taskApprovedEventId } from './ids'
import { compareMemberShadow } from './shadowCompare'
import { resolveWeeklyContext } from './weeklyWindow'

const FAMILY = 'family-1'
const MEMBER = 'member-1'
const CTX = { weekly: resolveWeeklyContext({ timeZone: 'UTC' }), asOf: '2026-01-08T00:00:00.000Z' }

function event(partial: Partial<GamificationEventV3> & Pick<GamificationEventV3, 'eventType'>): GamificationEventV3 {
  const eventId = partial.eventId ?? 'evt'
  return {
    schemaVersion: GAMIFICATION_V3_SCHEMA_VERSION,
    eventId,
    familyId: FAMILY,
    memberId: MEMBER,
    sourceType: 'task_completion',
    sourceId: 'x',
    effectiveAt: '2026-01-05T10:00:00.000Z',
    createdAt: '2026-01-05T10:00:00.000Z',
    rewardPointsDelta: 0,
    xpDelta: 0,
    weeklyPointsDelta: 0,
    idempotencyKey: eventId,
    metadata: {},
    ...partial,
  } as GamificationEventV3
}

const baseline = event({
  eventType: 'LEGACY_BASELINE',
  eventId: legacyBaselineEventId(FAMILY, MEMBER),
  sourceType: 'legacy_baseline',
  sourceId: 'v3',
  effectiveAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  rewardPointsDelta: 380,
  xpDelta: 380,
})

const taskEvent = event({
  eventType: 'TASK_APPROVED',
  eventId: taskApprovedEventId(FAMILY, MEMBER, 't1'),
  sourceId: 't1',
  rewardPointsDelta: 20,
  xpDelta: 20,
  weeklyPointsDelta: 20,
})

const legacy = {
  familyId: FAMILY,
  memberId: MEMBER,
  rewardPoints: 400,
  xpTotal: 400,
  weeklyPoints: 20,
  currentStreak: 0,
}

describe('read-only shadow comparison', () => {
  it('classifies an identical projection as exact_match', () => {
    const result = compareMemberShadow({ legacy, events: [baseline, taskEvent], ledgerComplete: true }, CTX)
    expect(result.classification).toBe('exact_match')
    expect(result.differences).toEqual([])
  })

  it('classifies reward point drift', () => {
    const result = compareMemberShadow(
      { legacy: { ...legacy, rewardPoints: 123 }, events: [baseline, taskEvent], ledgerComplete: true },
      CTX,
    )
    expect(result.classification).toBe('reward_points_mismatch')
  })

  it('classifies xp, weekly and streak drift', () => {
    expect(
      compareMemberShadow(
        { legacy: { ...legacy, xpTotal: 1 }, events: [baseline, taskEvent], ledgerComplete: true },
        CTX,
      ).classification,
    ).toBe('xp_mismatch')
    expect(
      compareMemberShadow(
        { legacy: { ...legacy, weeklyPoints: 1 }, events: [baseline, taskEvent], ledgerComplete: true },
        CTX,
      ).classification,
    ).toBe('weekly_points_mismatch')
    expect(
      compareMemberShadow(
        { legacy: { ...legacy, currentStreak: 7 }, events: [baseline, taskEvent], ledgerComplete: true },
        CTX,
      ).classification,
    ).toBe('streak_mismatch')
  })

  it('never claims a mismatch when the ledger history is incomplete', () => {
    const result = compareMemberShadow(
      { legacy: { ...legacy, rewardPoints: 999 }, events: [taskEvent], ledgerComplete: false },
      CTX,
    )
    expect(result.classification).toBe('insufficient_ledger_history')
    expect(result.differences).toEqual([])
  })

  it('classifies malformed data instead of throwing', () => {
    const result = compareMemberShadow(
      {
        legacy,
        events: [{ ...taskEvent, rewardPointsDelta: Number.NaN } as GamificationEventV3],
        ledgerComplete: true,
      },
      CTX,
    )
    expect(result.classification).toBe('malformed_data')
    expect(result.error).toBeTruthy()
  })

  it('is read-only and returns a plain serialisable report', () => {
    const result = compareMemberShadow({ legacy, events: [baseline, taskEvent], ledgerComplete: true }, CTX)
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
    expect(result.projected?.rewardPoints).toBe(400)
  })
})
