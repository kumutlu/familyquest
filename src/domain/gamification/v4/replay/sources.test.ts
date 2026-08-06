/**
 * Gamification V4 — Task 2.1 source-reader tests (TDD-first).
 *
 * Pins the read-only legacy source readers. Each reader must return typed
 * records carrying `sourceId`, `effectiveAt`, `createdAt` and a raw reward
 * snapshot, never import wallet modules, never write anything, and never
 * re-implement the reducer (reused by the later replay pipeline).
 *
 * Classification (exact/estimated/malformed/ambiguous/skipped) is Task 2.2 and
 * is intentionally NOT covered here.
 */

import { describe, it, expect } from 'vitest'
import {
  readTaskCompletions,
  readBehaviours,
  readDailyPerfectDay,
  readRedemptions,
  readRefundsReversals,
  readAvatarUnlocks,
  readManualAdjustments,
  MalformedSourceError,
  type LegacyFamily,
} from './sources'

// Static source-inspection guarantees (no wallet / firebase / reducer imports)
// live in tools/architecture/v4-replay-import-hygiene.test.ts because they
// require Node APIs unavailable under the browser-oriented src tsconfig.

const base: LegacyFamily = {
  familyId: 'family-1',
  taskCompletions: [],
  behaviours: [],
  dailyProgress: [],
  redemptions: [],
  reversals: [],
  avatarUnlocks: [],
  manualAdjustments: [],
}

const fam = (o: Partial<LegacyFamily>): LegacyFamily => ({ ...base, ...o })

describe('readers produce typed records', () => {
  it('task completions carry sourceId/effectiveAt/createdAt/rawRewardSnapshot', () => {
    const r = readTaskCompletions(
      fam({
        taskCompletions: [
          {
            id: 'tc-1',
            taskId: 't1',
            childId: 'c1',
            awardedPoints: 20,
            approvedAt: '2026-01-05T10:00:00.000Z',
            createdAt: '2026-01-05T09:00:00.000Z',
          },
        ],
      }),
    )[0]
    expect(r).toMatchObject({
      sourceType: 'task_completion',
      sourceId: 'tc-1',
      effectiveAt: '2026-01-05T10:00:00.000Z',
      createdAt: '2026-01-05T09:00:00.000Z',
      rawRewardSnapshot: 20,
    })
  })

  it('behaviours capture the signed pointsDelta', () => {
    const r = readBehaviours(
      fam({
        behaviours: [
          { id: 'b-1', childId: 'c1', behaviourType: 'negative', pointsDelta: -5, createdAt: '2026-01-06T08:00:00.000Z' },
        ],
      }),
    )[0]
    expect(r.sourceType).toBe('behaviour')
    expect(r.rawRewardSnapshot).toBe(-5)
    expect(r.effectiveAt).toBe('2026-01-06T08:00:00.000Z')
  })

  it('daily perfect day emits only perfect-day records', () => {
    const recs = readDailyPerfectDay(
      fam({
        dailyProgress: [
          { id: 'd-1', childId: 'c1', dayKey: '2026-01-05', perfectDay: true, rewardPointsAward: 5, createdAt: '2026-01-06T00:00:00.000Z' },
          { id: 'd-2', childId: 'c1', dayKey: '2026-01-04', perfectDay: false, createdAt: '2026-01-05T00:00:00.000Z' },
        ],
      }),
    )
    expect(recs).toHaveLength(1)
    expect(recs[0].sourceType).toBe('perfect_day')
    expect(recs[0].rawRewardSnapshot).toBe(5)
  })

  it('redemptions capture the negative cost', () => {
    const r = readRedemptions(
      fam({ redemptions: [{ id: 'r-1', childId: 'c1', rewardId: 'rw1', cost: 10, createdAt: '2026-01-07T08:00:00.000Z' }] }),
    )[0]
    expect(r.sourceType).toBe('reward_redemption')
    expect(r.rawRewardSnapshot).toBe(-10)
  })

  it('reversals map the raw reward delta', () => {
    const r = readRefundsReversals(
      fam({
        reversals: [
          { id: 'rev-1', childId: 'c1', kind: 'REV', originalSourceId: 'tc-1', rewardPointsDelta: -20, createdAt: '2026-01-08T08:00:00.000Z' },
        ],
      }),
    )[0]
    expect(r.sourceType).toBe('reversal')
    expect(r.rawRewardSnapshot).toBe(-20)
  })

  it('avatar unlocks capture the negative cost', () => {
    const r = readAvatarUnlocks(
      fam({ avatarUnlocks: [{ id: 'a-1', childId: 'c1', avatarId: 'neon', costPoints: 50, createdAt: '2026-01-09T08:00:00.000Z' }] }),
    )[0]
    expect(r.sourceType).toBe('avatar')
    expect(r.rawRewardSnapshot).toBe(-50)
  })

  it('manual adjustments capture the rpDelta', () => {
    const r = readManualAdjustments(
      fam({ manualAdjustments: [{ id: 'm-1', childId: 'c1', rpDelta: 15, createdAt: '2026-01-10T08:00:00.000Z' }] }),
    )[0]
    expect(r.sourceType).toBe('manual')
    expect(r.rawRewardSnapshot).toBe(15)
  })
})

describe('malformed source rejection', () => {
  it('throws when a required field is missing (never guesses)', () => {
    expect(() =>
      readTaskCompletions(fam({ taskCompletions: [{ id: 'tc-x', childId: 'c1' } as never] })),
    ).toThrow(MalformedSourceError)
  })

  it('throws when the effective timestamp is missing', () => {
    expect(() =>
      readBehaviours(fam({ behaviours: [{ id: 'b-x', childId: 'c1', behaviourType: 'positive' } as never] })),
    ).toThrow(MalformedSourceError)
  })
})

describe('determinism', () => {
  it('produces byte-identical output for repeated reads', () => {
    const f = fam({
      taskCompletions: [
        { id: 'tc-1', taskId: 't1', childId: 'c1', awardedPoints: 20, approvedAt: '2026-01-05T10:00:00.000Z', createdAt: '2026-01-05T09:00:00.000Z' },
      ],
    })
    expect(readTaskCompletions(f)).toEqual(readTaskCompletions(f))
  })

  it('shuffled source order yields the same record multiset', () => {
    const docs = [
      { id: 'tc-1', taskId: 't1', childId: 'c1', awardedPoints: 10, approvedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'tc-2', taskId: 't2', childId: 'c1', awardedPoints: 20, approvedAt: '2026-01-02T00:00:00.000Z', createdAt: '2026-01-02T00:00:00.000Z' },
    ]
    const forward = readTaskCompletions(fam({ taskCompletions: docs }))
      .map((r) => r.sourceId)
      .sort()
    const shuffled = readTaskCompletions(fam({ taskCompletions: [docs[1], docs[0]] }))
      .map((r) => r.sourceId)
      .sort()
    expect(shuffled).toEqual(forward)
  })
})

describe('read-only guarantee', () => {
  it('does not mutate the input family', () => {
    const doc = { id: 'tc-1', taskId: 't1', childId: 'c1', awardedPoints: 10, approvedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' }
    const f = fam({ taskCompletions: [doc] })
    readTaskCompletions(f)
    expect(f.taskCompletions[0]).toBe(doc)
  })
})
