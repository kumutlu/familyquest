/**
 * Gamification V4 — Task 7.6 avatar-unlock cutover tests.
 *
 * Route is driven by an injected resolver only; no flag is ever activated.
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'

import {
  applyAvatarUnlockV4,
  buildAvatarUnlockedEventV4,
  InsufficientPointsForAvatarError,
  AvatarUnlockInputError,
  type AvatarUnlockFactsV4,
} from './avatarUnlockWriter'
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

const FAMILY = 'fam-F'
const MEMBER = 'mem-1'

function facts(overrides: Partial<AvatarUnlockFactsV4> = {}): AvatarUnlockFactsV4 {
  return {
    familyId: FAMILY,
    memberId: MEMBER,
    avatarId: 'avatar-fox',
    cost: 20,
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

describe('Task 7.6 — avatar unlock routing is legacy XOR v4', () => {
  it('is legacy by default', async () => {
    expect(await resolveWriterRouteSafe('avatar_unlock', FAMILY)).toBe('legacy')
  })

  it('resolves v4 only for the flagged family', async () => {
    setRouteResolver(
      flagRouteResolver(withWriterEnabled(defaultFeatureFlags(), 'avatar_unlock', FAMILY)),
    )
    expect(await resolveWriterRouteSafe('avatar_unlock', FAMILY)).toBe('v4')
    expect(await resolveWriterRouteSafe('avatar_unlock', 'other')).toBe('legacy')
  })

  it('exactly one writer runs per route (no dual write)', async () => {
    const legacy = vi.fn(async () => undefined)
    const v4 = vi.fn(async () => undefined)
    const dispatch = async (route: WriterRoute) => (route === 'v4' ? v4() : legacy())

    setRouteResolver(resolverReturning('v4'))
    await dispatch(await resolveWriterRouteSafe('avatar_unlock', FAMILY))
    expect(v4).toHaveBeenCalledTimes(1)
    expect(legacy).not.toHaveBeenCalled()
  })

  it('rollback: clearing the resolver restores legacy', async () => {
    setRouteResolver(flagRouteResolver(withWriterEnabled(defaultFeatureFlags(), 'avatar_unlock')))
    expect(await resolveWriterRouteSafe('avatar_unlock', FAMILY)).toBe('v4')
    setRouteResolver(undefined)
    expect(await resolveWriterRouteSafe('avatar_unlock', FAMILY)).toBe('legacy')
  })
})

describe('Task 7.6 — canonical avatar unlock event', () => {
  it('charges points, never XP, and is anchored on the avatar id', () => {
    const event = buildAvatarUnlockedEventV4(facts())
    expect(event.eventId).toBe(eventIdFor(FAMILY, MEMBER, 'AVATAR_UNLOCKED', 'avatar-fox'))
    expect(event.rewardPointsDelta).toBe(-20)
    expect(event.xpDelta).toBe(0)
    expect(event.metadata.avatarId).toBe('avatar-fox')
    expect(buildAvatarUnlockedEventV4(facts())).toEqual(event)
  })

  it('fails closed on malformed facts', () => {
    expect(() => buildAvatarUnlockedEventV4(facts({ avatarId: '' }))).toThrow(WriterInputErrorV4)
    expect(() => buildAvatarUnlockedEventV4(facts({ cost: -1 }))).toThrow(WriterInputErrorV4)
    expect(() =>
      buildAvatarUnlockedEventV4(null as unknown as AvatarUnlockFactsV4),
    ).toThrow(AvatarUnlockInputError)
  })
})

describe('Task 7.6 — V4 avatar unlock write semantics', () => {
  it('writes one event, charges the cost and records the avatar', async () => {
    const { db } = mockDb()
    await fund(db, 50)
    const result = await applyAvatarUnlockV4(db, facts())

    expect(result.status).toBe('processed')
    const ledger = await readLedger(db, FAMILY)
    const stored = await readState(db, FAMILY, MEMBER)
    expect(stored).toEqual(
      rebuildStateFromLedger(ledger, { updatedAt: facts().createdAt, projectionVersion: 1 }),
    )
    expect(stored!.rewardPoints).toBe(30)
    expect(stored!.xpTotal).toBe(50)
    expect(stored!.unlockedAvatarIds).toEqual(['avatar-fox'])
  })

  it('re-unlocking the same avatar is a no-op and never charges twice', async () => {
    const { db } = mockDb()
    await fund(db, 50)
    await applyAvatarUnlockV4(db, facts())
    const again = await applyAvatarUnlockV4(db, facts())

    expect(again.status).toBe('duplicate')
    expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(30)
    expect((await readState(db, FAMILY, MEMBER))!.unlockedAvatarIds).toEqual(['avatar-fox'])
  })

  it('accumulates multiple avatars deterministically (sorted)', async () => {
    const { db } = mockDb()
    await fund(db, 100)
    await applyAvatarUnlockV4(db, facts({ avatarId: 'avatar-wolf', cost: 10 }))
    await applyAvatarUnlockV4(db, facts({ avatarId: 'avatar-bear', cost: 10 }))

    const stored = await readState(db, FAMILY, MEMBER)
    expect(stored!.unlockedAvatarIds).toEqual(['avatar-bear', 'avatar-wolf'])
    expect(stored!.rewardPoints).toBe(80)
  })

  it('rejects an unaffordable unlock and writes nothing', async () => {
    const { db } = mockDb()
    await fund(db, 5)
    await expect(applyAvatarUnlockV4(db, facts())).rejects.toBeInstanceOf(
      InsufficientPointsForAvatarError,
    )
    expect((await readLedger(db, FAMILY)).filter((e) => e.eventType === 'AVATAR_UNLOCKED')).toHaveLength(0)
    expect((await readState(db, FAMILY, MEMBER))!.unlockedAvatarIds).toEqual([])
  })

  it('allows a free avatar with no balance', async () => {
    const { db } = mockDb()
    const result = await applyAvatarUnlockV4(db, facts({ avatarId: 'avatar-free', cost: 0 }))
    expect(result.status).toBe('processed')
    expect((await readState(db, FAMILY, MEMBER))!.unlockedAvatarIds).toEqual(['avatar-free'])
  })

  it('writes no legacy or wallet document', async () => {
    const { db, store } = mockDb()
    await fund(db, 50)
    await applyAvatarUnlockV4(db, facts())
    for (const path of store.paths()) {
      expect(path).toMatch(/^families\/[^/]+\/(gamification_events|gamification_state)\//)
    }
  })
})
