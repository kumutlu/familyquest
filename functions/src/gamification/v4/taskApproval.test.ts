/**
 * Gamification V4 — Task 7.1 task-approval cutover tests.
 *
 * Proves the mandatory Task 7.1 acceptance criteria WITHOUT activating V4 in
 * production: the route is driven by an injected resolver, never by a real
 * flag flip. Firestore is an in-memory mock with transaction semantics (the
 * real emulator is exercised by `taskApproval.emulator.test.ts`).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'

import {
  applyTaskApprovalV4,
  buildTaskApprovedEventV4,
  TaskApprovalInputError,
  type TaskApprovalFactsV4,
} from './taskApprovalWriter'
import { readLedger, readState } from './repository'
import {
  processApprovedCompletion,
  type GamificationProcessorDependencies,
} from '../../gamificationProcessor'
import { setRouteResolver } from '../routingShim'
import {
  defaultFeatureFlags,
  resolveWriterRoute,
  withWriterEnabled,
  withAllLegacy,
  type GamificationWriter,
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

// --- in-memory Firestore mock ----------------------------------------------
class MockDocSnap {
  constructor(public readonly id: string, private readonly value: unknown) {}
  get exists(): boolean { return this.value !== undefined }
  data(): unknown { return this.value }
}
class MockDoc {
  constructor(private readonly store: MockStore, private readonly segments: string[]) {}
  get path(): string { return this.segments.join('/') }
  async get(): Promise<MockDocSnap> {
    return new MockDocSnap(this.segments[this.segments.length - 1]!, this.store.read(this.path))
  }
  collection(name: string): MockCollection {
    return new MockCollection(this.store, [...this.segments, name])
  }
}
class MockCollection {
  constructor(private readonly store: MockStore, private readonly segments: string[]) {}
  doc(id: string): MockDoc { return new MockDoc(this.store, [...this.segments, id]) }
  async get(): Promise<{ docs: MockDocSnap[] }> {
    const prefix = this.segments.join('/') + '/'
    const docs: MockDocSnap[] = []
    for (const [path, value] of this.store.entries()) {
      if (path.startsWith(prefix)) {
        const rest = path.slice(prefix.length)
        if (!rest.includes('/')) docs.push(new MockDocSnap(rest, value))
      }
    }
    return { docs }
  }
}
class MockTransaction {
  private writes: Array<{ path: string; data: unknown }> = []
  constructor(private readonly store: MockStore) {}
  set(ref: MockDoc, data: unknown): void { this.writes.push({ path: ref.path, data }) }
  commit(): void { for (const w of this.writes) this.store.write(w.path, w.data) }
  rollback(): void { this.writes = [] }
}
class MockStore {
  private readonly data = new Map<string, unknown>()
  read(path: string): unknown { return this.data.get(path) }
  write(path: string, value: unknown): void { this.data.set(path, value) }
  entries(): Array<[string, unknown]> { return [...this.data.entries()] }
  paths(): string[] { return [...this.data.keys()] }
  collection(name: string): MockCollection { return new MockCollection(this, [name]) }
  async runTransaction<T>(fn: (tx: MockTransaction) => Promise<T>): Promise<T> {
    const tx = new MockTransaction(this)
    try {
      const result = await fn(tx)
      tx.commit()
      return result
    } catch (err) {
      tx.rollback()
      throw err
    }
  }
}
function mockDb(): { db: Firestore; store: MockStore } {
  const store = new MockStore()
  return { db: store as unknown as Firestore, store }
}

// --- fixtures ---------------------------------------------------------------
const FAMILY = 'fam-A'
const MEMBER = 'mem-1'

function facts(overrides: Partial<TaskApprovalFactsV4> = {}): TaskApprovalFactsV4 {
  return {
    familyId: FAMILY,
    memberId: MEMBER,
    completionId: 'completion-1',
    taskId: 'task-1',
    rewardPointsDelta: 20,
    xpDelta: 20,
    effectiveAt: '2026-01-05T10:00:00.000Z',
    createdAt: '2026-01-05T10:00:00.000Z',
    ...overrides,
  }
}

/** Route resolver stub — the ONLY thing that decides legacy vs v4 in tests. */
function resolverReturning(route: WriterRoute): RouteResolver {
  return { resolve: async () => route }
}
function throwingResolver(error: Error): RouteResolver {
  return { resolve: async () => { throw error } }
}

interface Spies {
  readonly legacy: ReturnType<typeof vi.fn>
  readonly v4: ReturnType<typeof vi.fn>
  readonly deps: GamificationProcessorDependencies
}

function spyDeps(): Spies {
  const legacy = vi.fn(async () => ({ status: 'processed' as const }))
  const v4 = vi.fn(async () => ({ status: 'processed' as const }))
  const deps: GamificationProcessorDependencies = {
    repository: {
      processApprovedCompletion: legacy,
      processTaskInvalidation: vi.fn(async () => ({ status: 'processed' as const })),
      recordProcessorFailure: vi.fn(async () => {}),
    },
    now: () => 1_700_000_000_000,
    v4TaskApproval: { processApprovedCompletion: v4 },
  }
  return { legacy, v4, deps }
}

afterEach(() => { setRouteResolver(undefined) })

// --- 1. legacy route unchanged ---------------------------------------------
describe('Task 7.1 — legacy route is unchanged', () => {
  it('routes an approval to the legacy repository when route = legacy', async () => {
    setRouteResolver(resolverReturning('legacy'))
    const { legacy, v4, deps } = spyDeps()

    const result = await processApprovedCompletion(deps, { familyId: FAMILY, completionId: 'c1' })

    expect(result).toEqual({ status: 'processed' })
    expect(legacy).toHaveBeenCalledTimes(1)
    expect(legacy).toHaveBeenCalledWith({
      familyId: FAMILY,
      completionId: 'c1',
      processingAt: 1_700_000_000_000,
    })
    expect(v4).not.toHaveBeenCalled()
  })

  it('is the DEFAULT: with no resolver override, the legacy writer runs', async () => {
    const { legacy, v4, deps } = spyDeps()
    await processApprovedCompletion(deps, { familyId: FAMILY, completionId: 'c1' })
    expect(legacy).toHaveBeenCalledTimes(1)
    expect(v4).not.toHaveBeenCalled()
  })
})

// --- 2/6/7. v4 route: single writer, no legacy write ------------------------
describe('Task 7.1 — v4 route replaces the legacy authoritative write', () => {
  it('routes an approval to the V4 engine only when route = v4', async () => {
    setRouteResolver(resolverReturning('v4'))
    const { legacy, v4, deps } = spyDeps()

    await processApprovedCompletion(deps, { familyId: FAMILY, completionId: 'c1' })

    expect(v4).toHaveBeenCalledTimes(1)
    expect(legacy).not.toHaveBeenCalled()
  })

  it('fails closed when the route is v4 but no V4 engine is wired', async () => {
    setRouteResolver(resolverReturning('v4'))
    const { legacy, deps } = spyDeps()
    const noEngine: GamificationProcessorDependencies = { repository: deps.repository, now: deps.now }

    await expect(
      processApprovedCompletion(noEngine, { familyId: FAMILY, completionId: 'c1' }),
    ).rejects.toThrow(/V4 task approval engine is not available/)
    expect(legacy).not.toHaveBeenCalled()
  })
})

// --- EXPLICIT mutual exclusion assertion ------------------------------------
describe('Task 7.1 — EXACTLY ONE writer runs per approval (never both)', () => {
  for (const route of ['legacy', 'v4'] as const) {
    it(`route=${route}: legacy XOR v4 executes, total authoritative writes === 1`, async () => {
      setRouteResolver(resolverReturning(route))
      const { legacy, v4, deps } = spyDeps()

      await processApprovedCompletion(deps, { familyId: FAMILY, completionId: 'c1' })

      const legacyRuns = legacy.mock.calls.length
      const v4Runs = v4.mock.calls.length
      // XOR: exactly one authoritative writer executed for this one approval.
      expect(legacyRuns + v4Runs).toBe(1)
      expect(legacyRuns === 1 && v4Runs === 1).toBe(false)
      expect(route === 'legacy' ? legacyRuns : v4Runs).toBe(1)
    })
  }
})

// --- 3. deterministic event id ---------------------------------------------
describe('Task 7.1 — canonical TASK_APPROVED event', () => {
  it('derives a deterministic event id from the canonical helper', () => {
    const a = buildTaskApprovedEventV4(facts())
    const b = buildTaskApprovedEventV4(facts())
    expect(a).toEqual(b)
    expect(a.eventId).toBe(eventIdFor(FAMILY, MEMBER, 'TASK_APPROVED', 'completion-1'))
  })

  it('builds exactly one canonical event shape (no wallet field)', () => {
    const event = buildTaskApprovedEventV4(facts())
    expect(event.eventType).toBe('TASK_APPROVED')
    expect(event.sourceType).toBe('task_completion')
    expect(event.sourceId).toBe('completion-1')
    expect(event.schemaVersion).toBe(4)
    expect(Object.keys(event).some((k) => /wallet/i.test(k))).toBe(false)
  })
})

// --- 9. malformed input fails closed ----------------------------------------
describe('Task 7.1 — malformed input fails closed', () => {
  it.each([
    ['empty familyId', { familyId: '' }],
    ['empty memberId', { memberId: '' }],
    ['empty completionId', { completionId: '' }],
    ['path-injecting familyId', { familyId: 'fam/A' }],
  ])('%s is rejected', (_label, override) => {
    expect(() => buildTaskApprovedEventV4(facts(override as Partial<TaskApprovalFactsV4>))).toThrow(
      TaskApprovalInputError,
    )
  })

  it.each([
    ['negative rewardPointsDelta', { rewardPointsDelta: -5 }],
    ['negative xpDelta', { xpDelta: -5 }],
    ['non-integer reward', { rewardPointsDelta: 1.5 }],
    ['malformed effectiveAt', { effectiveAt: 'yesterday' }],
  ])('%s is rejected by the canonical validator', (_label, override) => {
    expect(() => buildTaskApprovedEventV4(facts(override as Partial<TaskApprovalFactsV4>))).toThrow()
  })

  it('writes nothing when the input is malformed', async () => {
    const { db, store } = mockDb()
    await expect(applyTaskApprovalV4(db, facts({ rewardPointsDelta: -1 }))).rejects.toThrow()
    expect(store.paths()).toEqual([])
  })
})

// --- 2/4/5. writer behaviour over the repository ----------------------------
describe('Task 7.1 — V4 writer persistence', () => {
  it('writes exactly ONE TASK_APPROVED event and one state document', async () => {
    const { db, store } = mockDb()
    const result = await applyTaskApprovalV4(db, facts())

    expect(result.status).toBe('processed')
    const ledger = await readLedger(db, FAMILY)
    expect(ledger).toHaveLength(1)
    expect(ledger[0]!.eventType).toBe('TASK_APPROVED')
    expect(store.paths().filter((p) => p.includes('gamification_state'))).toHaveLength(1)
  })

  it('stored state equals rebuildStateFromLedger() over the same ledger', async () => {
    const { db } = mockDb()
    await applyTaskApprovalV4(db, facts())

    const ledger = await readLedger(db, FAMILY)
    const expected = rebuildStateFromLedger(ledger, {
      updatedAt: facts().createdAt,
      projectionVersion: 1,
    })
    const stored = await readState(db, FAMILY, MEMBER)
    expect(stored).not.toBeNull()
    expect(businessFields(stored!)).toEqual(businessFields(expected))
    expect(stored).toEqual(expected)
  })

  it('duplicate approval delivery is a NO-OP (no duplicate event, no rewrite)', async () => {
    const { db, store } = mockDb()
    const first = await applyTaskApprovalV4(db, facts())
    const before = store.entries()

    const second = await applyTaskApprovalV4(db, facts())

    expect(first.status).toBe('processed')
    expect(second.status).toBe('duplicate')
    expect(second.eventId).toBe(first.eventId)
    expect(store.entries()).toEqual(before)
    expect(await readLedger(db, FAMILY)).toHaveLength(1)
  })

  it('never writes a legacy rewardPoints / lifetimeXP document', async () => {
    const { db, store } = mockDb()
    await applyTaskApprovalV4(db, facts())

    for (const path of store.paths()) {
      expect(path).not.toMatch(/gamification_v2|lifetimeXp|rewardPoints|wallet/i)
      expect(path.startsWith('families/')).toBe(true)
    }
    const written = store.entries().map(([, v]) => JSON.stringify(v)).join('|')
    expect(written).not.toMatch(/lifetimeXp/i)
    expect(written).not.toMatch(/wallet/i)
  })

  it('touches only the V4 event + state collections (no dual write)', async () => {
    const { db, store } = mockDb()
    await applyTaskApprovalV4(db, facts())

    const collections = new Set(store.paths().map((p) => p.split('/')[2]))
    expect([...collections].sort()).toEqual(['gamification_events', 'gamification_state'])
  })
})

// --- 8. family / member isolation -------------------------------------------
describe('Task 7.1 — family and member isolation', () => {
  it('the same completion id in two families writes two isolated partitions', async () => {
    const { db, store } = mockDb()
    await applyTaskApprovalV4(db, facts({ familyId: 'fam-A' }))
    await applyTaskApprovalV4(db, facts({ familyId: 'fam-B' }))

    expect(await readLedger(db, 'fam-A')).toHaveLength(1)
    expect(await readLedger(db, 'fam-B')).toHaveLength(1)
    expect(store.paths().every((p) => p.startsWith('families/fam-A/') || p.startsWith('families/fam-B/'))).toBe(true)
  })

  it('a second member in the same family gets its own state, unaffected by the first', async () => {
    const { db } = mockDb()
    await applyTaskApprovalV4(db, facts({ memberId: 'mem-1', rewardPointsDelta: 20, xpDelta: 20 }))
    await applyTaskApprovalV4(db, facts({ memberId: 'mem-2', completionId: 'completion-2', rewardPointsDelta: 5, xpDelta: 5 }))

    const one = await readState(db, FAMILY, 'mem-1')
    const two = await readState(db, FAMILY, 'mem-2')
    expect(one!.rewardPoints).toBe(20)
    expect(two!.rewardPoints).toBe(5)
  })
})

// --- 10/11. routing contract: gates and rollback -----------------------------
describe('Task 7.1 — routing contract (gate failure and rollback)', () => {
  it('a blocked Gate 1 / Gate 2 / Stage 6 evidence blocks the approval entirely', async () => {
    const blocked = new Error('Stage7BlockedError: Gate 2 evidence invalid')
    blocked.name = 'Stage7BlockedError'
    setRouteResolver(throwingResolver(blocked))
    const { legacy, v4, deps } = spyDeps()

    await expect(
      processApprovedCompletion(deps, { familyId: FAMILY, completionId: 'c1' }),
    ).rejects.toThrow(/Stage7BlockedError/)
    // Fail closed: neither authoritative writer ran.
    expect(legacy).not.toHaveBeenCalled()
    expect(v4).not.toHaveBeenCalled()
  })

  it('rollback returns the task_approval route to legacy', async () => {
    const cutover = withWriterEnabled(defaultFeatureFlags(), 'task_approval')
    expect(resolveWriterRoute(cutover, 'task_approval', FAMILY)).toBe('v4')

    const rolledBack = withAllLegacy(cutover)
    expect(resolveWriterRoute(rolledBack, 'task_approval', FAMILY)).toBe('legacy')

    const writer: GamificationWriter = 'task_approval'
    setRouteResolver({ resolve: async (w) => resolveWriterRoute(rolledBack, w, FAMILY) })
    const { legacy, v4, deps } = spyDeps()
    await processApprovedCompletion(deps, { familyId: FAMILY, completionId: 'c1' })

    expect(writer).toBe('task_approval')
    expect(legacy).toHaveBeenCalledTimes(1)
    expect(v4).not.toHaveBeenCalled()
  })
})

beforeEach(() => { setRouteResolver(undefined) })
