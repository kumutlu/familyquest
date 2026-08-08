/**
 * Gamification V4 — Task 7.4 reward-redemption cutover tests.
 *
 * Route is driven by an injected resolver only; no flag is ever activated.
 */

import { describe, expect, it, vi, afterEach } from 'vitest'

import {
  applyRewardRedemptionV4,
  buildRewardRedeemedEventV4,
  InsufficientRewardPointsError,
  RewardRedemptionInputError,
  type RewardRedemptionFactsV4,
} from './rewardRedemptionWriter'
import { applyBehaviourV4 } from './behaviourWriter'
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
import type { Firestore } from 'firebase-admin/firestore'

process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080'

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => {
    throw new Error('getFirestore must never be called')
  }),
}))

const FAMILY = 'fam-D'
const MEMBER = 'mem-1'

function facts(overrides: Partial<RewardRedemptionFactsV4> = {}): RewardRedemptionFactsV4 {
  return {
    familyId: FAMILY,
    memberId: MEMBER,
    redemptionId: 'red-1',
    rewardId: 'reward-1',
    cost: 30,
    effectiveAt: '2026-01-06T10:00:00.000Z',
    createdAt: '2026-01-06T10:00:00.000Z',
    ...overrides,
  }
}

/** Fund the member through the canonical V4 ledger (no legacy balance exists). */
async function fund(db: Firestore, points: number, logId = 'fund-1'): Promise<void> {
  await applyBehaviourV4(db, {
    familyId: FAMILY,
    memberId: MEMBER,
    logId,
    behaviourId: 'beh-fund',
    direction: 'positive',
    points,
    effectiveAt: '2026-01-05T10:00:00.000Z',
    createdAt: '2026-01-05T10:00:00.000Z',
  })
}

function resolverReturning(route: WriterRoute): RouteResolver {
  return { resolve: async () => route }
}

afterEach(() => {
  setRouteResolver(undefined)
})

describe('Task 7.4 — reward redemption routing is legacy XOR v4', () => {
  it('is legacy by default', async () => {
    expect(await resolveWriterRouteSafe('reward_redemption', FAMILY)).toBe('legacy')
  })

  it('resolves v4 only for the flagged family', async () => {
    setRouteResolver(
      flagRouteResolver(withWriterEnabled(defaultFeatureFlags(), 'reward_redemption', FAMILY)),
    )
    expect(await resolveWriterRouteSafe('reward_redemption', FAMILY)).toBe('v4')
    expect(await resolveWriterRouteSafe('reward_redemption', 'other')).toBe('legacy')
  })

  it('exactly one writer runs per route (no dual write)', async () => {
    const legacy = vi.fn(async () => undefined)
    const v4 = vi.fn(async () => undefined)
    const dispatch = async (route: WriterRoute) => (route === 'v4' ? v4() : legacy())

    setRouteResolver(resolverReturning('v4'))
    await dispatch(await resolveWriterRouteSafe('reward_redemption', FAMILY))
    expect(v4).toHaveBeenCalledTimes(1)
    expect(legacy).not.toHaveBeenCalled()
  })

  it('rollback: clearing the resolver restores legacy', async () => {
    setRouteResolver(
      flagRouteResolver(withWriterEnabled(defaultFeatureFlags(), 'reward_redemption')),
    )
    expect(await resolveWriterRouteSafe('reward_redemption', FAMILY)).toBe('v4')
    setRouteResolver(undefined)
    expect(await resolveWriterRouteSafe('reward_redemption', FAMILY)).toBe('legacy')
  })
})

describe('Task 7.4 — canonical redemption event', () => {
  it('charges points, never XP, with a deterministic id', () => {
    const event = buildRewardRedeemedEventV4(facts())
    expect(event.eventId).toBe(eventIdFor(FAMILY, MEMBER, 'REWARD_REDEEMED', 'red-1'))
    expect(event.rewardPointsDelta).toBe(-30)
    expect(event.xpDelta).toBe(0)
    expect(buildRewardRedeemedEventV4(facts())).toEqual(event)
  })

  it('fails closed on malformed facts', () => {
    expect(() => buildRewardRedeemedEventV4(facts({ redemptionId: '' }))).toThrow(
      WriterInputErrorV4,
    )
    expect(() => buildRewardRedeemedEventV4(facts({ cost: -5 }))).toThrow(WriterInputErrorV4)
    expect(() =>
      buildRewardRedeemedEventV4(null as unknown as RewardRedemptionFactsV4),
    ).toThrow(RewardRedemptionInputError)
  })
})

describe('Task 7.4 — V4 redemption write semantics', () => {
  it('writes exactly one charge event and the rebuilt projection', async () => {
    const { db } = mockDb()
    await fund(db, 50)
    const result = await applyRewardRedemptionV4(db, facts())

    expect(result.status).toBe('processed')
    const ledger = await readLedger(db, FAMILY)
    expect(ledger.filter((e) => e.eventType === 'REWARD_REDEEMED')).toHaveLength(1)

    const stored = await readState(db, FAMILY, MEMBER)
    expect(stored).toEqual(
      rebuildStateFromLedger(ledger, {
        updatedAt: facts().createdAt,
        projectionVersion: 1,
      }),
    )
    expect(stored!.rewardPoints).toBe(20)
    // Spending never reduces lifetime progression.
    expect(stored!.xpTotal).toBe(50)
  })

  it('duplicate delivery never double-charges', async () => {
    const { db } = mockDb()
    await fund(db, 50)
    await applyRewardRedemptionV4(db, facts())
    const again = await applyRewardRedemptionV4(db, facts())

    expect(again.status).toBe('duplicate')
    expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(20)
    expect(await readLedger(db, FAMILY)).toHaveLength(2)
  })

  it('rejects an unaffordable redemption and writes nothing', async () => {
    const { db } = mockDb()
    await fund(db, 10)

    await expect(applyRewardRedemptionV4(db, facts())).rejects.toBeInstanceOf(
      InsufficientRewardPointsError,
    )
    expect((await readLedger(db, FAMILY)).filter((e) => e.eventType === 'REWARD_REDEEMED')).toHaveLength(0)
    expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(10)
  })

  it('rejects any redemption when no V4 state exists yet', async () => {
    const { db } = mockDb()
    await expect(applyRewardRedemptionV4(db, facts())).rejects.toBeInstanceOf(
      InsufficientRewardPointsError,
    )
    expect(await readLedger(db, FAMILY)).toHaveLength(0)
  })

  it('writes no legacy or wallet document', async () => {
    const { db, store } = mockDb()
    await fund(db, 50)
    await applyRewardRedemptionV4(db, facts())
    for (const path of store.paths()) {
      expect(path).toMatch(/^families\/[^/]+\/(gamification_events|gamification_state)\//)
    }
    expect(JSON.stringify(store.entries())).not.toMatch(/wallet/i)
  })
})
