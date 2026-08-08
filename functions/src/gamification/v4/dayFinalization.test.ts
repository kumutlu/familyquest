/**
 * Gamification V4 — Task 7.3 daily-goal / perfect-day cutover tests.
 *
 * Route is driven by an injected resolver only; no flag is ever activated.
 */

import { describe, expect, it, vi, afterEach } from 'vitest'

import {
  applyDayFinalizationV4,
  buildDailyGoalEventV4,
  buildPerfectDayEventV4,
  DayFinalizationInputError,
  type DayFinalizationFactsV4,
} from './dayFinalizationWriter'
import { WriterInputErrorV4 } from './writerCore'
import { readLedger, readState } from './repository'
import { mockDb } from './testSupport/mockFirestore'
import { setRouteResolver, resolveWriterRouteSafe } from '../routingShim'
import {
  defaultFeatureFlags,
  flagRouteResolver,
  withWriterEnabled,
  type RouteResolver,
  type WriterRoute,
} from '../../../../src/domain/gamification/v4/featureFlags'
import { eventIdFor } from '../../../../src/domain/gamification/v4/ids'
import { rebuildStateFromLedger } from '../../../../src/domain/gamification/v4/rebuild'

process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080'

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => {
    throw new Error('getFirestore must never be called')
  }),
}))

const FAMILY = 'fam-C'
const MEMBER = 'mem-1'
const DAY = '2026-01-05'

function facts(overrides: Partial<DayFinalizationFactsV4> = {}): DayFinalizationFactsV4 {
  return {
    familyId: FAMILY,
    memberId: MEMBER,
    dayKey: DAY,
    dailyGoal: { rewardPoints: 10, xp: 10 },
    effectiveAt: `${DAY}T23:59:00.000Z`,
    createdAt: `${DAY}T23:59:00.000Z`,
    ...overrides,
  }
}

function resolverReturning(route: WriterRoute): RouteResolver {
  return { resolve: async () => route }
}

afterEach(() => {
  setRouteResolver(undefined)
})

describe('Task 7.3 — day finalization routing is legacy XOR v4', () => {
  it('is legacy by default', async () => {
    expect(await resolveWriterRouteSafe('day_finalization', FAMILY)).toBe('legacy')
  })

  it('resolves v4 only for the flagged family', async () => {
    setRouteResolver(
      flagRouteResolver(withWriterEnabled(defaultFeatureFlags(), 'day_finalization', FAMILY)),
    )
    expect(await resolveWriterRouteSafe('day_finalization', FAMILY)).toBe('v4')
    expect(await resolveWriterRouteSafe('day_finalization', 'other')).toBe('legacy')
  })

  it('exactly one writer runs per route (no dual write)', async () => {
    const legacy = vi.fn(async () => undefined)
    const v4 = vi.fn(async () => undefined)
    const dispatch = async (route: WriterRoute) => (route === 'v4' ? v4() : legacy())

    setRouteResolver(resolverReturning('v4'))
    await dispatch(await resolveWriterRouteSafe('day_finalization', FAMILY))
    expect(v4).toHaveBeenCalledTimes(1)
    expect(legacy).not.toHaveBeenCalled()
  })

  it('rollback: clearing the resolver restores legacy', async () => {
    setRouteResolver(flagRouteResolver(withWriterEnabled(defaultFeatureFlags(), 'day_finalization')))
    expect(await resolveWriterRouteSafe('day_finalization', FAMILY)).toBe('v4')
    setRouteResolver(undefined)
    expect(await resolveWriterRouteSafe('day_finalization', FAMILY)).toBe('legacy')
  })
})

describe('Task 7.3 — canonical day events', () => {
  it('anchors both event ids on the day key', () => {
    const full = facts({ perfectDay: { rewardPoints: 25, xp: 25 } })
    expect(buildDailyGoalEventV4(full).eventId).toBe(
      eventIdFor(FAMILY, MEMBER, 'DAILY_GOAL_AWARDED', DAY),
    )
    expect(buildPerfectDayEventV4(full).eventId).toBe(
      eventIdFor(FAMILY, MEMBER, 'PERFECT_DAY_AWARDED', DAY),
    )
  })

  it('is deterministic', () => {
    expect(buildDailyGoalEventV4(facts())).toEqual(buildDailyGoalEventV4(facts()))
  })

  it('fails closed on a malformed day key or award', () => {
    expect(() => buildDailyGoalEventV4(facts({ dayKey: '05-01-2026' }))).toThrow(
      DayFinalizationInputError,
    )
    expect(() => buildDailyGoalEventV4(facts({ dailyGoal: { rewardPoints: -1, xp: 0 } }))).toThrow(
      WriterInputErrorV4,
    )
    expect(() => buildPerfectDayEventV4(facts())).toThrow(DayFinalizationInputError)
  })
})

describe('Task 7.3 — V4 day finalization write semantics', () => {
  it('writes only the awards that were earned', async () => {
    const { db } = mockDb()
    const result = await applyDayFinalizationV4(db, facts())

    expect(result.dailyGoal!.status).toBe('processed')
    expect(result.perfectDay).toBeNull()
    expect(await readLedger(db, FAMILY)).toHaveLength(1)
  })

  it('writes both awards as two independent events', async () => {
    const { db } = mockDb()
    const result = await applyDayFinalizationV4(
      db,
      facts({ perfectDay: { rewardPoints: 25, xp: 25 } }),
    )

    expect(result.dailyGoal!.status).toBe('processed')
    expect(result.perfectDay!.status).toBe('processed')
    const ledger = await readLedger(db, FAMILY)
    expect(ledger.map((e) => e.eventType).sort()).toEqual([
      'DAILY_GOAL_AWARDED',
      'PERFECT_DAY_AWARDED',
    ])
    const stored = await readState(db, FAMILY, MEMBER)
    expect(stored).toEqual(
      rebuildStateFromLedger(ledger, { updatedAt: facts().createdAt, projectionVersion: 1 }),
    )
    expect(stored!.rewardPoints).toBe(35)
    expect(stored!.xpTotal).toBe(35)
  })

  it('re-finalising the same day is a no-op (day key idempotency)', async () => {
    const { db } = mockDb()
    const full = facts({ perfectDay: { rewardPoints: 25, xp: 25 } })
    await applyDayFinalizationV4(db, full)
    const again = await applyDayFinalizationV4(db, full)

    expect(again.dailyGoal!.status).toBe('duplicate')
    expect(again.perfectDay!.status).toBe('duplicate')
    expect(await readLedger(db, FAMILY)).toHaveLength(2)
    expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(35)
  })

  it('adds a late perfect-day award without re-awarding the daily goal', async () => {
    const { db } = mockDb()
    await applyDayFinalizationV4(db, facts())
    const late = await applyDayFinalizationV4(
      db,
      facts({ perfectDay: { rewardPoints: 25, xp: 25 } }),
    )

    expect(late.dailyGoal!.status).toBe('duplicate')
    expect(late.perfectDay!.status).toBe('processed')
    expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(35)
  })

  it('state equals a full rebuild across consecutive days', async () => {
    const { db } = mockDb()
    await applyDayFinalizationV4(db, facts())
    const second = await applyDayFinalizationV4(
      db,
      facts({
        dayKey: '2026-01-06',
        effectiveAt: '2026-01-06T23:59:00.000Z',
        createdAt: '2026-01-06T23:59:00.000Z',
      }),
    )

    const ledger = await readLedger(db, FAMILY)
    const expected = rebuildStateFromLedger(ledger, {
      updatedAt: second.dailyGoal!.event.createdAt,
      projectionVersion: 1,
    })
    expect(await readState(db, FAMILY, MEMBER)).toEqual(expected)
  })

  it('writes no legacy or wallet document', async () => {
    const { db, store } = mockDb()
    await applyDayFinalizationV4(db, facts())
    for (const path of store.paths()) {
      expect(path).toMatch(/^families\/[^/]+\/(gamification_events|gamification_state)\//)
    }
  })
})
