/**
 * Gamification V4 — Task 7.2 behaviour cutover tests.
 *
 * Proves the Task 7.2 acceptance criteria WITHOUT activating V4 in production:
 * the route is driven by an injected resolver, never by a real flag flip.
 * Firestore is the shared in-memory double (the real emulator is exercised by
 * `behaviour.emulator.test.ts`).
 */

import { describe, expect, it, vi, afterEach } from 'vitest'

import {
  applyBehaviourV4,
  buildBehaviourEventV4,
  BehaviourInputError,
  type BehaviourFactsV4,
} from './behaviourWriter'
import { WriterInputErrorV4 } from './writerCore'
import { readLedger, readState } from './repository'
import { mockDb } from './testSupport/mockFirestore'
import { setRouteResolver } from '../routingShim'
import { resolveWriterRouteSafe } from '../routingShim'
import {
  defaultFeatureFlags,
  flagRouteResolver,
  withWriterEnabled,
  type RouteResolver,
  type WriterRoute,
} from '../../../../src/domain/gamification/v4/featureFlags'
import { eventIdFor } from '../../../../src/domain/gamification/v4/ids'
import { rebuildStateFromLedger } from '../../../../src/domain/gamification/v4/rebuild'
import { businessFields } from '../../../../src/domain/gamification/v4/types'

process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080'

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => {
    throw new Error('getFirestore must never be called')
  }),
}))

const FAMILY = 'fam-B'
const MEMBER = 'mem-1'

function facts(overrides: Partial<BehaviourFactsV4> = {}): BehaviourFactsV4 {
  return {
    familyId: FAMILY,
    memberId: MEMBER,
    logId: 'log-1',
    behaviourId: 'beh-1',
    direction: 'positive',
    points: 10,
    effectiveAt: '2026-01-05T10:00:00.000Z',
    createdAt: '2026-01-05T10:00:00.000Z',
    ...overrides,
  }
}

function resolverReturning(route: WriterRoute): RouteResolver {
  return { resolve: async () => route }
}

afterEach(() => {
  setRouteResolver(undefined)
})

// --- 1. routing: legacy XOR v4, default legacy ------------------------------
describe('Task 7.2 — behaviour routing is legacy XOR v4', () => {
  it('is legacy by default (no resolver override)', async () => {
    expect(await resolveWriterRouteSafe('behaviour', FAMILY)).toBe('legacy')
  })

  it('resolves v4 only for the family the flag is enabled for', async () => {
    setRouteResolver(
      flagRouteResolver(withWriterEnabled(defaultFeatureFlags(), 'behaviour', FAMILY)),
    )
    expect(await resolveWriterRouteSafe('behaviour', FAMILY)).toBe('v4')
    expect(await resolveWriterRouteSafe('behaviour', 'other-family')).toBe('legacy')
  })

  it('exactly one writer runs per route (no dual write)', async () => {
    const legacy = vi.fn(async () => 'legacy-write')
    const v4 = vi.fn(async () => 'v4-write')
    const dispatch = async (route: WriterRoute) => (route === 'v4' ? v4() : legacy())

    setRouteResolver(resolverReturning('v4'))
    await dispatch(await resolveWriterRouteSafe('behaviour', FAMILY))
    expect(v4).toHaveBeenCalledTimes(1)
    expect(legacy).not.toHaveBeenCalled()

    setRouteResolver(resolverReturning('legacy'))
    await dispatch(await resolveWriterRouteSafe('behaviour', FAMILY))
    expect(legacy).toHaveBeenCalledTimes(1)
    expect(v4).toHaveBeenCalledTimes(1)
  })

  it('rollback: resetting the resolver restores legacy for every family', async () => {
    setRouteResolver(flagRouteResolver(withWriterEnabled(defaultFeatureFlags(), 'behaviour')))
    expect(await resolveWriterRouteSafe('behaviour', FAMILY)).toBe('v4')
    setRouteResolver(undefined)
    expect(await resolveWriterRouteSafe('behaviour', FAMILY)).toBe('legacy')
  })
})

// --- 2. canonical event ------------------------------------------------------
describe('Task 7.2 — canonical behaviour event', () => {
  it('derives a deterministic event id from the behaviour log id', () => {
    const event = buildBehaviourEventV4(facts())
    expect(event.eventId).toBe(eventIdFor(FAMILY, MEMBER, 'BEHAVIOUR_POSITIVE', 'log-1'))
    expect(buildBehaviourEventV4(facts())).toEqual(event)
  })

  it('debits points and never touches XP for negative behaviour', () => {
    const event = buildBehaviourEventV4(facts({ direction: 'negative', points: 5, logId: 'log-2' }))
    expect(event.eventType).toBe('BEHAVIOUR_NEGATIVE')
    expect(event.rewardPointsDelta).toBe(-5)
    expect(event.xpDelta).toBe(0)
    expect(event.eventId).toBe(eventIdFor(FAMILY, MEMBER, 'BEHAVIOUR_NEGATIVE', 'log-2'))
  })

  it('rejects an XP award on a negative behaviour', () => {
    expect(() => buildBehaviourEventV4(facts({ direction: 'negative', xpAward: 3 }))).toThrow(
      BehaviourInputError,
    )
  })

  it('fails closed on malformed facts', () => {
    expect(() => buildBehaviourEventV4(facts({ familyId: '' }))).toThrow(WriterInputErrorV4)
    expect(() => buildBehaviourEventV4(facts({ points: -1 }))).toThrow(WriterInputErrorV4)
    expect(() =>
      buildBehaviourEventV4(facts({ direction: 'sideways' as unknown as 'positive' })),
    ).toThrow(BehaviourInputError)
  })
})

// --- 3. write semantics ------------------------------------------------------
describe('Task 7.2 — V4 behaviour write semantics', () => {
  it('writes exactly one event and the rebuilt projection', async () => {
    const { db } = mockDb()
    const result = await applyBehaviourV4(db, facts())

    expect(result.status).toBe('processed')
    const ledger = await readLedger(db, FAMILY)
    expect(ledger).toHaveLength(1)

    const stored = await readState(db, FAMILY, MEMBER)
    const expected = rebuildStateFromLedger(ledger, {
      updatedAt: facts().createdAt,
      projectionVersion: 1,
    })
    expect(stored).toEqual(expected)
    expect(businessFields(stored!)).toEqual(businessFields(expected))
  })

  it('duplicate delivery is a no-op (idempotent event id)', async () => {
    const { db } = mockDb()
    await applyBehaviourV4(db, facts())
    const again = await applyBehaviourV4(db, facts())

    expect(again.status).toBe('duplicate')
    expect(again.state).toBeNull()
    expect(await readLedger(db, FAMILY)).toHaveLength(1)
    expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(10)
  })

  it('state equals a full rebuild after a positive and a negative behaviour', async () => {
    const { db } = mockDb()
    await applyBehaviourV4(db, facts({ points: 30 }))
    const last = await applyBehaviourV4(
      db,
      facts({ logId: 'log-2', direction: 'negative', points: 12 }),
    )

    const ledger = await readLedger(db, FAMILY)
    const expected = rebuildStateFromLedger(ledger, {
      updatedAt: last.event.createdAt,
      projectionVersion: 1,
    })
    const stored = await readState(db, FAMILY, MEMBER)
    expect(stored).toEqual(expected)
    expect(stored!.rewardPoints).toBe(18)
    expect(stored!.xpTotal).toBe(30)
  })

  it('never drives the balance negative and never reduces XP', async () => {
    const { db } = mockDb()
    await applyBehaviourV4(db, facts({ direction: 'negative', points: 40, logId: 'log-x' }))
    const stored = await readState(db, FAMILY, MEMBER)
    expect(stored!.rewardPoints).toBe(0)
    expect(stored!.xpTotal).toBe(0)
  })

  it('writes no legacy or wallet document', async () => {
    const { db, store } = mockDb()
    await applyBehaviourV4(db, facts())
    for (const path of store.paths()) {
      expect(path).toMatch(/^families\/[^/]+\/(gamification_events|gamification_state)\//)
    }
    expect(JSON.stringify(store.entries())).not.toMatch(/wallet|lifetimeXp/i)
  })

  it('keeps families and members isolated', async () => {
    const { db } = mockDb()
    await applyBehaviourV4(db, facts({ points: 10 }))
    await applyBehaviourV4(db, facts({ familyId: 'fam-other', points: 3 }))
    await applyBehaviourV4(db, facts({ memberId: 'mem-2', logId: 'log-2', points: 7 }))

    expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(10)
    expect((await readState(db, FAMILY, 'mem-2'))!.rewardPoints).toBe(7)
    expect((await readState(db, 'fam-other', MEMBER))!.rewardPoints).toBe(3)
  })
})
