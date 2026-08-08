/**
 * Gamification V4 — Task 7.5 refund / reversal cutover tests.
 *
 * Route is driven by an injected resolver only; no flag is ever activated.
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'

import {
  applyReversalV4,
  NotReversibleError,
  OriginalEventNotFoundError,
  ReversalInputError,
  type ReversalFactsV4,
} from './reversalWriter'
import { applyTaskApprovalV4 } from './taskApprovalWriter'
import { applyBehaviourV4 } from './behaviourWriter'
import { applyRewardRedemptionV4 } from './rewardRedemptionWriter'
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

const FAMILY = 'fam-E'
const MEMBER = 'mem-1'
const APPROVAL_ID = eventIdFor(FAMILY, MEMBER, 'TASK_APPROVED', 'completion-1')

async function approve(db: Firestore, points = 40): Promise<void> {
  await applyTaskApprovalV4(db, {
    familyId: FAMILY,
    memberId: MEMBER,
    completionId: 'completion-1',
    taskId: 'task-1',
    rewardPointsDelta: points,
    xpDelta: points,
    effectiveAt: '2026-01-05T10:00:00.000Z',
    createdAt: '2026-01-05T10:00:00.000Z',
  })
}

function reversalFacts(overrides: Partial<ReversalFactsV4> = {}): ReversalFactsV4 {
  return {
    familyId: FAMILY,
    memberId: MEMBER,
    originalEventId: APPROVAL_ID,
    kind: 'REV',
    reason: 'task invalidated by a parent',
    ...overrides,
  }
}

function resolverReturning(route: WriterRoute): RouteResolver {
  return { resolve: async () => route }
}

afterEach(() => {
  setRouteResolver(undefined)
})

describe('Task 7.5 — reversal routing is legacy XOR v4', () => {
  it('is legacy by default for the reversing writers', async () => {
    expect(await resolveWriterRouteSafe('task_invalidation', FAMILY)).toBe('legacy')
    expect(await resolveWriterRouteSafe('reward_redemption', FAMILY)).toBe('legacy')
  })

  it('resolves v4 only for the flagged family', async () => {
    setRouteResolver(
      flagRouteResolver(withWriterEnabled(defaultFeatureFlags(), 'task_invalidation', FAMILY)),
    )
    expect(await resolveWriterRouteSafe('task_invalidation', FAMILY)).toBe('v4')
    expect(await resolveWriterRouteSafe('task_invalidation', 'other')).toBe('legacy')
  })

  it('exactly one writer runs per route (no dual write)', async () => {
    const legacy = vi.fn(async () => undefined)
    const v4 = vi.fn(async () => undefined)
    const dispatch = async (route: WriterRoute) => (route === 'v4' ? v4() : legacy())

    setRouteResolver(resolverReturning('v4'))
    await dispatch(await resolveWriterRouteSafe('task_invalidation', FAMILY))
    expect(v4).toHaveBeenCalledTimes(1)
    expect(legacy).not.toHaveBeenCalled()
  })

  it('rollback: clearing the resolver restores legacy', async () => {
    setRouteResolver(
      flagRouteResolver(withWriterEnabled(defaultFeatureFlags(), 'task_invalidation')),
    )
    expect(await resolveWriterRouteSafe('task_invalidation', FAMILY)).toBe('v4')
    setRouteResolver(undefined)
    expect(await resolveWriterRouteSafe('task_invalidation', FAMILY)).toBe('legacy')
  })
})

describe('Task 7.5 — V4 reversal write semantics', () => {
  it('appends a reversal that exactly negates the original', async () => {
    const { db } = mockDb()
    await approve(db)
    const result = await applyReversalV4(db, reversalFacts())

    expect(result.status).toBe('processed')
    expect(result.event.eventType).toBe('TASK_REVERSED')
    expect(result.event.reversalOfEventId).toBe(APPROVAL_ID)
    expect(result.event.rewardPointsDelta).toBe(-40)
    expect(result.event.xpDelta).toBe(-40)

    const stored = await readState(db, FAMILY, MEMBER)
    expect(stored!.rewardPoints).toBe(0)
    expect(stored!.xpTotal).toBe(0)
  })

  it('never deletes or edits the original event (append-only)', async () => {
    const { db } = mockDb()
    await approve(db)
    await applyReversalV4(db, reversalFacts())

    const ledger = await readLedger(db, FAMILY)
    expect(ledger).toHaveLength(2)
    const original = ledger.find((e) => e.eventId === APPROVAL_ID)!
    expect(original.rewardPointsDelta).toBe(40)
  })

  it('state equals a full rebuild of the ledger', async () => {
    const { db } = mockDb()
    await approve(db)
    const result = await applyReversalV4(db, reversalFacts())
    const ledger = await readLedger(db, FAMILY)
    expect(await readState(db, FAMILY, MEMBER)).toEqual(
      rebuildStateFromLedger(ledger, {
        updatedAt: result.event.createdAt,
        projectionVersion: 1,
      }),
    )
  })

  it('reversing twice is a no-op', async () => {
    const { db } = mockDb()
    await approve(db)
    await applyReversalV4(db, reversalFacts())
    const again = await applyReversalV4(db, reversalFacts())

    expect(again.status).toBe('duplicate')
    expect(await readLedger(db, FAMILY)).toHaveLength(2)
    expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(0)
  })

  it('refunds a redemption without returning XP', async () => {
    const { db } = mockDb()
    await applyBehaviourV4(db, {
      familyId: FAMILY,
      memberId: MEMBER,
      logId: 'fund-1',
      behaviourId: 'beh-fund',
      direction: 'positive',
      points: 50,
      effectiveAt: '2026-01-05T10:00:00.000Z',
      createdAt: '2026-01-05T10:00:00.000Z',
    })
    const redemption = await applyRewardRedemptionV4(db, {
      familyId: FAMILY,
      memberId: MEMBER,
      redemptionId: 'red-1',
      rewardId: 'reward-1',
      cost: 30,
      effectiveAt: '2026-01-06T10:00:00.000Z',
      createdAt: '2026-01-06T10:00:00.000Z',
    })

    const refund = await applyReversalV4(
      db,
      reversalFacts({ originalEventId: redemption.eventId, kind: 'REFUND' }),
    )

    expect(refund.event.eventType).toBe('REWARD_REFUNDED')
    expect(refund.event.rewardPointsDelta).toBe(30)
    expect(refund.event.xpDelta).toBe(0)
    const stored = await readState(db, FAMILY, MEMBER)
    expect(stored!.rewardPoints).toBe(50)
    expect(stored!.xpTotal).toBe(50)
  })

  it('fails closed when the original does not exist', async () => {
    const { db } = mockDb()
    await expect(applyReversalV4(db, reversalFacts())).rejects.toBeInstanceOf(
      OriginalEventNotFoundError,
    )
    expect(await readLedger(db, FAMILY)).toHaveLength(0)
  })

  it('refuses to reverse a reversal', async () => {
    const { db } = mockDb()
    await approve(db)
    const reversal = await applyReversalV4(db, reversalFacts())

    await expect(
      applyReversalV4(db, reversalFacts({ originalEventId: reversal.eventId })),
    ).rejects.toBeInstanceOf(NotReversibleError)
  })

  it('refuses a cross-member reversal', async () => {
    const { db } = mockDb()
    await approve(db)
    await expect(
      applyReversalV4(db, reversalFacts({ memberId: 'mem-2' })),
    ).rejects.toBeInstanceOf(ReversalInputError)
  })
})
