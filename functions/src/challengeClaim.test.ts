// ---------------------------------------------------------------------------
// FOCUSED FUNCTIONS TESTS — Family Challenge claim (trusted server path)
// ---------------------------------------------------------------------------
// Exercises the authoritative claim logic (processChallengeClaimRequest) and the
// onCall wrapper (claimFamilyChallenge) against an in-memory Firestore double.
// Covers the TDD list:
//   - unauthorized user cannot claim
//   - wrong-family parent cannot claim
//   - incomplete challenge cannot claim
//   - valid parent claim succeeds
//   - each child receives the reward exactly once
//   - a retry is idempotent (no double award, challenge stays closed)
//   - the challenge is closed (completed/claimed state)
//   - celebration notifications are created
//   - the SERVER writes rewardPoints/lifetimeXP (client must NOT — see
//     src/lib/api.tasks.test.ts); Firestore rules are unchanged (regression).
// No Firebase emulators required.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Shared in-memory Firestore double. Hoisted so the vi.mock factories can
// reference the same instance the module-under-test will use via getFirestore().
const harness = vi.hoisted(() => {
  const store = new Map<string, Record<string, unknown>>()

  const applyWrite = (
    path: string,
    data: Record<string, unknown>,
    op: 'set' | 'update' | 'delete',
    options?: { merge?: boolean },
  ) => {
    if (op === 'set') store.set(path, options?.merge ? { ...(store.get(path) ?? {}), ...data } : { ...data })
    else if (op === 'update') store.set(path, { ...(store.get(path) ?? {}), ...data })
    else store.delete(path)
  }

  const snapOf = (path: string) => {
    const data = store.get(path)
    return { exists: data !== undefined, data: () => data, id: path.split('/').pop() as string, ref: makeRef(path) }
  }

  function makeRef(path: string): any {
    return {
      path,
      id: path.split('/').pop() as string,
      get: async () => snapOf(path),
      set: async (data: Record<string, unknown>) => applyWrite(path, data, 'set'),
      update: async (data: Record<string, unknown>) => applyWrite(path, data, 'update'),
      delete: async () => applyWrite(path, {}, 'delete'),
      collection: (name: string) => makeCollection(`${path}/${name}`),
    }
  }

  const runQuery = (
    matchPath: (key: string) => boolean,
    filters: Array<[string, string, unknown]>,
  ) => {
    const docs = Array.from(store.entries())
      .filter(([key]) => matchPath(key))
      .filter(([, data]) =>
        filters.every(([field, op, value]) => {
          const actual = (data as Record<string, unknown>)[field]
          if (op === '==') return actual === value
          if (op === '<=') return typeof actual === 'number' && actual <= (value as number)
          throw new Error(`Unsupported fake operator ${op}`)
        }),
      )
      .map(([key, data]) => ({ id: key.split('/').pop() as string, exists: true, data: () => data, ref: makeRef(key) }))
    return { empty: docs.length === 0, docs, size: docs.length }
  }

  const queryable = (matchPath: (key: string) => boolean) => {
    const build = (filters: Array<[string, string, unknown]>) => ({
      where: (field: string, op: string, value: unknown) => build([...filters, [field, op, value]]),
      get: async () => runQuery(matchPath, filters),
    })
    return build([])
  }

  function makeCollection(path: string) {
    const prefix = `${path}/`
    const base = queryable(key => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
    return {
      ...base,
      doc: (id?: string) => makeRef(`${path}/${id ?? `gen-${store.size}-${Math.random().toString(36).slice(2)}`}`),
    }
  }

  let idCounter = 0
  const db: any = {
    store,
    doc: (path: string) => makeRef(path),
    collection: (path: string) => makeCollection(path),
    // Optimistic-concurrency-free double: reads see committed state, writes are
    // applied after the callback returns (mirrors Firestore transaction semantics
    // closely enough for these unit tests).
    runTransaction: async (cb: (tx: any) => Promise<any>) => {
      const writes: Array<['set' | 'update' | 'delete', string, Record<string, unknown>, { merge?: boolean } | undefined]> = []
      const tx = {
        get: async (ref: { path: string }) => snapOf(ref.path),
        set: (ref: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }) =>
          writes.push(['set', ref.path, data, options]),
        update: (ref: { path: string }, data: Record<string, unknown>) => writes.push(['update', ref.path, data, undefined]),
        create: (ref: { path: string }, data: Record<string, unknown>) => {
          if (store.has(ref.path)) throw new Error(`ALREADY_EXISTS: ${ref.path}`)
          writes.push(['set', ref.path, data, undefined])
        },
        delete: (ref: { path: string }) => writes.push(['delete', ref.path, {}, undefined]),
      }
      const result = await cb(tx)
      for (const [op, path, data, options] of writes) applyWrite(path, data, op, options)
      return result
    },
  }

  return { store, db, _id: () => `gen-${++idCounter}` }
})

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => harness.db,
  FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
}))

vi.mock('firebase-functions/v2/https', () => ({
  // onCall returns the handler so the test can invoke the wrapper directly.
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: class HttpsError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.name = 'HttpsError'
      this.code = code
    }
  },
}))

import { AdminBehaviourRepository } from './behaviourRepository'
import { processChallengeClaimRequest, claimFamilyChallenge } from './challengeClaim'

const FAMILY_ID = 'family-1'
const CHALLENGE_ID = 'challenge-1'
const OWNER_ID = 'owner-1'
const CHILD_1 = 'child-1'
const CHILD_2 = 'child-2'
const REWARD = 25

function seed(overrides: { targetXP?: number; child1XP?: number; child2XP?: number } = {}) {
  harness.store.clear()
  harness.store.set(`users/${OWNER_ID}`, { familyId: FAMILY_ID, role: 'owner', displayName: 'Owner' })
  harness.store.set(`users/parent-2`, { familyId: 'family-2', role: 'parent', displayName: 'Other Parent' })
  harness.store.set(`users/${CHILD_1}`, {
    familyId: FAMILY_ID, role: 'child', status: 'active',
    rewardPoints: 100, lifetimeXP: overrides.child1XP ?? 200,
  })
  harness.store.set(`users/${CHILD_2}`, {
    familyId: FAMILY_ID, role: 'child', status: 'active',
    rewardPoints: 50, lifetimeXP: overrides.child2XP ?? 150,
  })
  // A deleted child must NEVER be rewarded (server-side eligibility filter).
  harness.store.set(`users/child-deleted`, {
    familyId: FAMILY_ID, role: 'child', status: 'deleted', rewardPoints: 0, lifetimeXP: 0,
  })
  harness.store.set(`families/${FAMILY_ID}/challenges/${CHALLENGE_ID}`, {
    isActive: true,
    targetXP: overrides.targetXP ?? 300,
    startXP: 0,
    rewardPoints: REWARD,
    title: 'Weekly Warriors',
  })
}

function deps() {
  return { db: harness.db, behaviourRepository: new AdminBehaviourRepository(harness.db) }
}

function challengeDoc() {
  return harness.store.get(`families/${FAMILY_ID}/challenges/${CHALLENGE_ID}`)
}

beforeEach(() => seed())

describe('claimFamilyChallenge — authorization', () => {
  it('rejects an unauthenticated caller before any read', async () => {
    const handler = claimFamilyChallenge as unknown as (req: any) => Promise<unknown>
    await expect(handler({ auth: undefined, data: { familyId: FAMILY_ID, challengeId: CHALLENGE_ID } }))
      .rejects.toMatchObject({ code: 'unauthenticated' })
  })

  it('rejects a caller who is not a known user', async () => {
    const handler = claimFamilyChallenge as unknown as (req: any) => Promise<unknown>
    await expect(handler({ auth: { uid: 'stranger' }, data: { familyId: FAMILY_ID, challengeId: CHALLENGE_ID } }))
      .rejects.toMatchObject({ code: 'permission-denied' })
    // No reward was distributed.
    expect(harness.store.get(`users/${CHILD_1}`)?.rewardPoints).toBe(100)
  })

  it('rejects a child caller (only parent/owner may claim)', async () => {
    // A same-family child must be rejected by the role check (not just family
    // ownership), so it is seeded here rather than in the shared world.
    harness.store.set(`users/child-caller`, { familyId: FAMILY_ID, role: 'child', displayName: 'Kid' })
    const handler = claimFamilyChallenge as unknown as (req: any) => Promise<unknown>
    await expect(handler({ auth: { uid: 'child-caller' }, data: { familyId: FAMILY_ID, challengeId: CHALLENGE_ID } }))
      .rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('rejects a parent from a DIFFERENT family (family ownership enforced)', async () => {
    const handler = claimFamilyChallenge as unknown as (req: any) => Promise<unknown>
    await expect(handler({ auth: { uid: 'parent-2' }, data: { familyId: FAMILY_ID, challengeId: CHALLENGE_ID } }))
      .rejects.toMatchObject({ code: 'permission-denied' })
    // The challenge in family-1 is untouched.
    expect(challengeDoc()?.isActive).toBe(true)
  })
})

describe('claimFamilyChallenge — preconditions', () => {
  it('refuses to claim when the target has not been reached', async () => {
    seed({ targetXP: 1000 }) // children only have 350 XP total
    await expect(
      processChallengeClaimRequest(deps(), OWNER_ID, { familyId: FAMILY_ID, challengeId: CHALLENGE_ID }),
    ).rejects.toMatchObject({ code: 'failed-precondition' })
    // No reward, challenge stays open.
    expect(harness.store.get(`users/${CHILD_1}`)?.rewardPoints).toBe(100)
    expect(challengeDoc()?.isActive).toBe(true)
  })

  it('returns a no-op (claimed:false) when the challenge is already closed', async () => {
    harness.store.set(`families/${FAMILY_ID}/challenges/${CHALLENGE_ID}`, {
      isActive: false, targetXP: 300, startXP: 0, rewardPoints: REWARD, title: 'Done',
    })
    const result = await processChallengeClaimRequest(deps(), OWNER_ID, { familyId: FAMILY_ID, challengeId: CHALLENGE_ID })
    expect(result).toEqual({ claimed: false, rewardedChildren: [] })
  })
})

describe('claimFamilyChallenge — successful claim', () => {
  it('awards every eligible child exactly once and closes the challenge', async () => {
    const result = await processChallengeClaimRequest(deps(), OWNER_ID, { familyId: FAMILY_ID, challengeId: CHALLENGE_ID })

    expect(result.claimed).toBe(true)
    expect(result.rewardedChildren.sort()).toEqual([CHILD_1, CHILD_2])

    // Each eligible child received +REWARD (server-authoritative write).
    expect(harness.store.get(`users/${CHILD_1}`)?.rewardPoints).toBe(125)
    expect(harness.store.get(`users/${CHILD_1}`)?.lifetimeXP).toBe(225)
    expect(harness.store.get(`users/${CHILD_2}`)?.rewardPoints).toBe(75)
    expect(harness.store.get(`users/${CHILD_2}`)?.lifetimeXP).toBe(175)

    // The deleted child was excluded.
    expect(harness.store.get(`users/child-deleted`)?.rewardPoints).toBe(0)

    // The challenge is now closed with claim metadata.
    const challenge = challengeDoc()
    expect(challenge?.isActive).toBe(false)
    expect(challenge?.claimedBy).toBe(OWNER_ID)
    expect(challenge?.claimedAt).toBeDefined()
  })

  it('creates exactly one deterministic celebration notification for the rewarded children', async () => {
    await processChallengeClaimRequest(deps(), OWNER_ID, { familyId: FAMILY_ID, challengeId: CHALLENGE_ID })

    const notifId = `challenge_completed_${CHALLENGE_ID}`
    const notif = harness.store.get(`families/${FAMILY_ID}/notifications/${notifId}`)
    expect(notif).toBeDefined()
    expect(notif).toMatchObject({
      type: 'challenge_completed',
      recipientIds: [CHILD_1, CHILD_2],
      title: 'Challenge complete!',
      body: `You earned +${REWARD} points`,
      entityType: 'challenge',
      entityId: CHALLENGE_ID,
      dedupeKey: notifId,
    })
  })

  it('writes an immutable gamification event per child (idempotency anchor)', async () => {
    await processChallengeClaimRequest(deps(), OWNER_ID, { familyId: FAMILY_ID, challengeId: CHALLENGE_ID })

    const events = Array.from(harness.store.keys()).filter(k => k.includes('/gamification_events/'))
    // One event per rewarded child, none for the deleted child.
    expect(events).toHaveLength(2)
    for (const path of events) {
      const event = harness.store.get(path)!
      expect(event).toMatchObject({ familyId: FAMILY_ID, rewardPointsDelta: REWARD, xpDelta: REWARD })
    }
  })
})

describe('claimFamilyChallenge — idempotency', () => {
  it('a retried claim is a no-op: no double award, challenge stays closed', async () => {
    const first = await processChallengeClaimRequest(deps(), OWNER_ID, { familyId: FAMILY_ID, challengeId: CHALLENGE_ID })
    expect(first.claimed).toBe(true)

    const second = await processChallengeClaimRequest(deps(), OWNER_ID, { familyId: FAMILY_ID, challengeId: CHALLENGE_ID })
    expect(second).toEqual({ claimed: false, rewardedChildren: [] })

    // Reward applied exactly once despite the retry.
    expect(harness.store.get(`users/${CHILD_1}`)?.rewardPoints).toBe(125)
    expect(harness.store.get(`users/${CHILD_2}`)?.rewardPoints).toBe(75)

    // Still only one gamification event per child.
    const events = Array.from(harness.store.keys()).filter(k => k.includes('/gamification_events/'))
    expect(events).toHaveLength(2)

    // Still exactly one celebration notification.
    const notifs = Array.from(harness.store.keys()).filter(k => k.includes('/notifications/challenge_completed_'))
    expect(notifs).toHaveLength(1)
  })
})

describe('claimFamilyChallenge — complete reward confirmation', () => {
  it('keeps the challenge active and suppresses success side effects when an initially eligible child is ignored', async () => {
    const repository = {
      processChallengeClaim: vi.fn(async ({ childId }: { childId: string }) => childId === CHILD_2
        ? { status: 'ignored' as const, reason: 'child_missing' }
        : { status: 'processed' as const }),
    }

    await expect(processChallengeClaimRequest(
      { db: harness.db, behaviourRepository: repository as never },
      OWNER_ID,
      { familyId: FAMILY_ID, challengeId: CHALLENGE_ID },
    )).rejects.toMatchObject({ code: 'failed-precondition' })

    expect(repository.processChallengeClaim).toHaveBeenCalledTimes(2)
    expect(challengeDoc()?.isActive).toBe(true)
    expect(Array.from(harness.store.keys()).filter(key => key.includes('/notifications/challenge_completed_'))).toHaveLength(0)
    expect(Array.from(harness.store.keys()).filter(key => key.includes('/feed/'))).toHaveLength(0)
  })

  it('does not close when an existing child reward event is not a verified challenge award', async () => {
    const syntheticId = `challenge_reward__${CHALLENGE_ID}__${CHILD_2}`
    harness.store.set(`families/${FAMILY_ID}/gamification_events/behaviour_xp:${syntheticId}`, {
      schemaVersion: 1,
      familyId: FAMILY_ID,
      childId: CHILD_2,
      sourceBehaviourEventId: syntheticId,
      eventType: 'behaviour_positive',
      rewardPointsDelta: 1,
      xpDelta: 1,
      idempotencyKey: `wrong:${syntheticId}`,
    })

    await expect(processChallengeClaimRequest(
      deps(), OWNER_ID, { familyId: FAMILY_ID, challengeId: CHALLENGE_ID },
    )).rejects.toMatchObject({ code: 'failed-precondition' })

    expect(challengeDoc()?.isActive).toBe(true)
    expect(Array.from(harness.store.keys()).filter(key => key.includes('/notifications/challenge_completed_'))).toHaveLength(0)
  })
})

describe('Firestore rules regression — client reward writes remain blocked', () => {
  const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8')

  it('still denies client rewardPoints/lifetimeXP writes on users/{uid}', () => {
    expect(rules).toContain("'rewardPoints', 'lifetimeXP'")
  })

  it('still hard-blocks client task-approval point mutations (isValidTaskApprovalMutation returns false)', () => {
    expect(rules).toContain('function isValidTaskApprovalMutation(uid) {')
    expect(rules).toContain('return false;')
  })
})
