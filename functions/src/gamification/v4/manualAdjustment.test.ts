/**
 * Gamification V4 — Task 7.7 manual-adjustment cutover tests.
 *
 * Route is driven by an injected resolver only; no flag is ever activated.
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'

import {
  applyManualAdjustmentV4,
  buildManualAdjustmentEventV4,
  ManualAdjustmentInputError,
  type ManualAdjustmentFactsV4,
} from './manualAdjustmentWriter'
import { WriterInputErrorV4 } from './writerCore'
import { applyBehaviourV4 } from './behaviourWriter'
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

const FAMILY = 'fam-G'
const MEMBER = 'mem-1'

function facts(overrides: Partial<ManualAdjustmentFactsV4> = {}): ManualAdjustmentFactsV4 {
  return {
    familyId: FAMILY,
    memberId: MEMBER,
    adjustmentId: 'adj-1',
    rewardPointsDelta: 25,
    reason: 'helped with the shopping',
    adjustedBy: 'parent-1',
    effectiveAt: '2026-01-06T10:00:00.000Z',
    createdAt: '2026-01-06T10:00:00.000Z',
    ...overrides,
  }
}

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

describe('Task 7.7 — manual adjustment routing is legacy XOR v4', () => {
  it('is legacy by default', async () => {
    expect(await resolveWriterRouteSafe('challenge_claim', FAMILY)).toBe('legacy')
  })

  it('resolves v4 only for the flagged family', async () => {
    setRouteResolver(
      flagRouteResolver(withWriterEnabled(defaultFeatureFlags(), 'challenge_claim', FAMILY)),
    )
    expect(await resolveWriterRouteSafe('challenge_claim', FAMILY)).toBe('v4')
    expect(await resolveWriterRouteSafe('challenge_claim', 'other')).toBe('legacy')
  })

  it('exactly one writer runs per route (no dual write)', async () => {
    const legacy = vi.fn(async () => undefined)
    const v4 = vi.fn(async () => undefined)
    const dispatch = async (route: WriterRoute) => (route === 'v4' ? v4() : legacy())

    setRouteResolver(resolverReturning('v4'))
    await dispatch(await resolveWriterRouteSafe('challenge_claim', FAMILY))
    expect(v4).toHaveBeenCalledTimes(1)
    expect(legacy).not.toHaveBeenCalled()
  })

  it('rollback: clearing the resolver restores legacy', async () => {
    setRouteResolver(flagRouteResolver(withWriterEnabled(defaultFeatureFlags(), 'challenge_claim')))
    expect(await resolveWriterRouteSafe('challenge_claim', FAMILY)).toBe('v4')
    setRouteResolver(undefined)
    expect(await resolveWriterRouteSafe('challenge_claim', FAMILY)).toBe('legacy')
  })
})

describe('Task 7.7 — canonical manual adjustment event', () => {
  it('is deterministic and anchored on the adjustment id', () => {
    const event = buildManualAdjustmentEventV4(facts())
    expect(event.eventId).toBe(eventIdFor(FAMILY, MEMBER, 'MANUAL_ADJUSTMENT', 'adj-1'))
    expect(buildManualAdjustmentEventV4(facts())).toEqual(event)
  })

  it('never touches XP in either direction', () => {
    expect(buildManualAdjustmentEventV4(facts()).xpDelta).toBe(0)
    expect(buildManualAdjustmentEventV4(facts({ rewardPointsDelta: -25 })).xpDelta).toBe(0)
  })

  it('requires an audit reason and a non-zero delta', () => {
    expect(() => buildManualAdjustmentEventV4(facts({ reason: '   ' }))).toThrow(
      ManualAdjustmentInputError,
    )
    expect(() => buildManualAdjustmentEventV4(facts({ rewardPointsDelta: 0 }))).toThrow(
      ManualAdjustmentInputError,
    )
    expect(() => buildManualAdjustmentEventV4(facts({ rewardPointsDelta: 1.5 }))).toThrow(
      WriterInputErrorV4,
    )
    expect(() => buildManualAdjustmentEventV4(facts({ adjustmentId: '' }))).toThrow(
      WriterInputErrorV4,
    )
  })
})

describe('Task 7.7 — V4 manual adjustment write semantics', () => {
  it('grants points without granting XP', async () => {
    const { db } = mockDb()
    await fund(db, 10)
    const result = await applyManualAdjustmentV4(db, facts())

    expect(result.status).toBe('processed')
    const ledger = await readLedger(db, FAMILY)
    const stored = await readState(db, FAMILY, MEMBER)
    expect(stored).toEqual(
      rebuildStateFromLedger(ledger, { updatedAt: facts().createdAt, projectionVersion: 1 }),
    )
    expect(stored!.rewardPoints).toBe(35)
    expect(stored!.xpTotal).toBe(10)
  })

  it('deducts points and clamps the balance at zero', async () => {
    const { db } = mockDb()
    await fund(db, 10)
    await applyManualAdjustmentV4(db, facts({ rewardPointsDelta: -40, reason: 'broke a window' }))

    const stored = await readState(db, FAMILY, MEMBER)
    expect(stored!.rewardPoints).toBe(0)
    expect(stored!.xpTotal).toBe(10)
  })

  it('duplicate delivery is a no-op (idempotent adjustment id)', async () => {
    const { db } = mockDb()
    await fund(db, 10)
    await applyManualAdjustmentV4(db, facts())
    const again = await applyManualAdjustmentV4(db, facts())

    expect(again.status).toBe('duplicate')
    expect(await readLedger(db, FAMILY)).toHaveLength(2)
    expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(35)
  })

  it('state equals a full rebuild after several adjustments', async () => {
    const { db } = mockDb()
    await fund(db, 10)
    await applyManualAdjustmentV4(db, facts())
    const last = await applyManualAdjustmentV4(
      db,
      facts({ adjustmentId: 'adj-2', rewardPointsDelta: -5, reason: 'late homework' }),
    )

    const ledger = await readLedger(db, FAMILY)
    expect(await readState(db, FAMILY, MEMBER)).toEqual(
      rebuildStateFromLedger(ledger, {
        updatedAt: last.event.createdAt,
        projectionVersion: 1,
      }),
    )
    expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(30)
  })

  it('writes no legacy or wallet document', async () => {
    const { db, store } = mockDb()
    await applyManualAdjustmentV4(db, facts())
    for (const path of store.paths()) {
      expect(path).toMatch(/^families\/[^/]+\/(gamification_events|gamification_state)\//)
    }
  })

  it('keeps families and members isolated', async () => {
    const { db } = mockDb()
    await applyManualAdjustmentV4(db, facts())
    await applyManualAdjustmentV4(db, facts({ familyId: 'fam-other', rewardPointsDelta: 5 }))
    await applyManualAdjustmentV4(db, facts({ memberId: 'mem-2', rewardPointsDelta: 7 }))

    expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(25)
    expect((await readState(db, FAMILY, 'mem-2'))!.rewardPoints).toBe(7)
    expect((await readState(db, 'fam-other', MEMBER))!.rewardPoints).toBe(5)
  })
})
