/**
 * Task 7.1 production-ACTIVATION readiness tests.
 *
 * Proves, without deploying and without flipping any flag:
 *   1. the real trigger chain constructs and injects the V4 engine;
 *   2. a production-shaped route still resolves to legacy by default;
 *   3. V4 repository writes fail closed in production without trusted context;
 *   4. a valid trusted Stage 7 context permits the write;
 *   5. a wrong family / wrong writer context is denied;
 *   6. gate failure => ZERO writers;
 *   7. the emulator path is unchanged;
 *   8. no dual write on any route;
 *   9. rollback to legacy works;
 *  10. canonical event/state paths;
 *  11. stored state == rebuildStateFromLedger().
 */

import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  createV4TaskApprovalEngine,
  denyStage7ByDefault,
  Stage7EvidenceUnavailableError,
} from './taskApprovalAdapter'
import {
  assertV4WriteAllowed,
  runWithTrustedV4Write,
  UntrustedV4WriteError,
  type TrustedV4WriteContext,
} from './trustedServerContext'
import { readLedger, readState, EmulatorOnlyGuardError, writeEventIdempotent } from './repository'
import { createGamificationTriggers } from '../../gamificationTriggers'
import {
  processApprovedCompletion,
  type GamificationProcessorDependencies,
} from '../../gamificationProcessor'
import { setRouteResolver } from '../routingShim'
import { defaultRouteResolver, type RouteResolver, type WriterRoute } from '../../../../src/domain/gamification/v4/featureFlags'
import { eventIdFor } from '../../../../src/domain/gamification/v4/ids'
import { rebuildStateFromLedger } from '../../../../src/domain/gamification/v4/rebuild'
import { businessFields } from '../../../../src/domain/gamification/v4/types'
import { eventDocPath, stateDocPath } from '../../../../src/domain/gamification/v4/storage'

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: (_p: string, h: unknown) => h,
  onDocumentWritten: (_p: string, h: unknown) => h,
}))

const EMULATOR_HOST = 'localhost:8080'
process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST

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
  collection(name: string): MockCollection { return new MockCollection(this.store, [...this.segments, name]) }
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
  doc(path: string): MockDoc { return new MockDoc(this, path.split('/')) }
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

const FAMILY = 'fam-A'
const MEMBER = 'mem-1'
const COMPLETION = 'completion-1'
const TASK = 'task-1'
const PROCESSING_AT = Date.parse('2026-01-05T10:00:00.000Z')

function seededDb(): { db: Firestore; store: MockStore } {
  const store = new MockStore()
  store.write(`families/${FAMILY}`, { timezone: 'Europe/London' })
  store.write(`families/${FAMILY}/task_completions/${COMPLETION}`, {
    status: 'approved', assigneeId: MEMBER, taskId: TASK, approvedAt: PROCESSING_AT,
  })
  store.write(`families/${FAMILY}/tasks/${TASK}`, { pointsReward: 20 })
  return { db: store as unknown as Firestore, store }
}

function resolverReturning(route: WriterRoute): RouteResolver {
  return { resolve: async () => route }
}

const allowStage7 = vi.fn(async () => {})

function engine(db: Firestore, verifyStage7 = allowStage7) {
  return createV4TaskApprovalEngine({ db, verifyStage7, now: () => PROCESSING_AT })
}

function legacySpyDeps(db: Firestore, verifyStage7 = allowStage7) {
  const legacy = vi.fn(async () => ({ status: 'processed' as const }))
  const deps: GamificationProcessorDependencies = {
    repository: {
      processApprovedCompletion: legacy,
      processTaskInvalidation: vi.fn(async () => ({ status: 'processed' as const })),
      recordProcessorFailure: vi.fn(async () => {}),
    },
    now: () => PROCESSING_AT,
    v4TaskApproval: engine(db, verifyStage7),
  }
  return { legacy, deps }
}

afterEach(() => {
  setRouteResolver(undefined)
  process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST
  delete process.env.K_SERVICE
  vi.clearAllMocks()
})

// --- 1. the real trigger constructs/injects the V4 engine --------------------
describe('1. real trigger chain injects the V4 engine', () => {
  it('functions/src/index.ts constructs the engine and passes it to createGamificationTriggers', () => {
    const indexPath = process.cwd().endsWith('/functions')
      ? resolve(process.cwd(), 'src/index.ts')
      : resolve(process.cwd(), 'functions/src/index.ts')
    const index = readFileSync(indexPath, 'utf8')
    expect(index).toContain("from './gamification/v4/taskApprovalAdapter'")
    expect(index).toMatch(/createGamificationTriggers\({[\s\S]*v4TaskApproval:\s*createV4TaskApprovalEngine\(/)
  })

  it('the trigger factory forwards the injected engine to the v4 route', async () => {
    const { db } = seededDb()
    const { legacy, deps } = legacySpyDeps(db)
    setRouteResolver(resolverReturning('v4'))
    const triggers = createGamificationTriggers(deps)
    expect(triggers.onTaskCompletionWritten).toBeTypeOf('function')

    await processApprovedCompletion(deps, { familyId: FAMILY, completionId: COMPLETION })
    expect(legacy).not.toHaveBeenCalled()
    expect(allowStage7).toHaveBeenCalledWith(FAMILY)
  })
})

// --- 2. default production-shaped route remains legacy ----------------------
describe('2. default route is legacy', () => {
  it('the default resolver returns legacy for task_approval', async () => {
    expect(await defaultRouteResolver().resolve('task_approval', FAMILY)).toBe('legacy')
  })

  it('with no resolver override, the legacy writer runs and V4 does not', async () => {
    const { db, store } = seededDb()
    const { legacy, deps } = legacySpyDeps(db)
    const before = store.paths().length

    const result = await processApprovedCompletion(deps, { familyId: FAMILY, completionId: COMPLETION })

    expect(result.status).toBe('processed')
    expect(legacy).toHaveBeenCalledTimes(1)
    expect(allowStage7).not.toHaveBeenCalled()
    expect(store.paths().length).toBe(before)
  })
})

// --- 3/4/5/7. trusted-server contract ---------------------------------------
describe('3-7. trusted-server environment contract', () => {
  beforeEach(() => { delete process.env.FIRESTORE_EMULATOR_HOST })

  const trusted: TrustedV4WriteContext = {
    trustedServer: true, writer: 'task_approval', route: 'v4', familyId: FAMILY,
    gate: { passed: true, verifiedAt: PROCESSING_AT },
  }

  it('3. production V4 repository write fails closed without trusted context', async () => {
    const { db, store } = seededDb()
    await expect(engine(db).processApprovedCompletion({
      familyId: FAMILY, completionId: COMPLETION, processingAt: PROCESSING_AT,
    })).rejects.toBeInstanceOf(EmulatorOnlyGuardError)
    expect(store.paths().some((p) => p.includes('gamification_events'))).toBe(false)
  })

  it('3b. a client-shaped process (no server runtime markers) is denied', async () => {
    // Scope creation is allowed, but the write assertion inside denies because
    // this process is not a trusted first-party server runtime.
    await expect(runWithTrustedV4Write(trusted, async () => {
      assertV4WriteAllowed('writeEventIdempotent', { familyId: FAMILY, now: () => PROCESSING_AT })
    })).rejects.toBeInstanceOf(UntrustedV4WriteError)
  })

  it('4. a valid trusted Stage 7 context permits the production V4 write', async () => {
    process.env.K_SERVICE = 'gamification-triggers'
    const { db, store } = seededDb()
    const live = createV4TaskApprovalEngine({ db, verifyStage7: allowStage7 })

    const result = await live.processApprovedCompletion({
      familyId: FAMILY, completionId: COMPLETION, processingAt: PROCESSING_AT,
    })

    expect(result.status).toBe('processed')
    const eventId = eventIdFor(FAMILY, MEMBER, 'TASK_APPROVED', COMPLETION)
    expect(store.read(eventDocPath(FAMILY, eventId))).toBeDefined()
  })

  it('5a. a context for a different family is denied', async () => {
    process.env.K_SERVICE = 'gamification-triggers'
    await expect(runWithTrustedV4Write(trusted, async () => {
      assertV4WriteAllowed('writeEventIdempotent', { familyId: 'fam-OTHER', now: () => PROCESSING_AT })
    })).rejects.toBeInstanceOf(UntrustedV4WriteError)
  })

  it('5b. a malformed / wrong-writer context is refused at scope creation', () => {
    process.env.K_SERVICE = 'gamification-triggers'
    const wrongWriter = { ...trusted, writer: 'behaviour' } as unknown as TrustedV4WriteContext
    expect(() => runWithTrustedV4Write(wrongWriter, async () => undefined)).toThrow(UntrustedV4WriteError)
    const legacyRoute = { ...trusted, route: 'legacy' } as unknown as TrustedV4WriteContext
    expect(() => runWithTrustedV4Write(legacyRoute, async () => undefined)).toThrow(UntrustedV4WriteError)
  })

  it('5c. stale gate evidence is denied', async () => {
    process.env.K_SERVICE = 'gamification-triggers'
    await expect(runWithTrustedV4Write(trusted, async () => {
      assertV4WriteAllowed('writeEventIdempotent', { familyId: FAMILY, now: () => PROCESSING_AT + 3_600_000 })
    })).rejects.toBeInstanceOf(UntrustedV4WriteError)
  })

  it('6. gate failure denies the write and runs ZERO writers', async () => {
    process.env.K_SERVICE = 'gamification-triggers'
    const { db, store } = seededDb()
    setRouteResolver(resolverReturning('v4'))
    const { legacy, deps } = legacySpyDeps(db, denyStage7ByDefault)

    await expect(processApprovedCompletion(deps, { familyId: FAMILY, completionId: COMPLETION }))
      .rejects.toBeInstanceOf(Stage7EvidenceUnavailableError)

    expect(legacy).not.toHaveBeenCalled()
    expect(store.paths().some((p) => p.includes('gamification_events'))).toBe(false)
  })
})

describe('7. emulator remains supported', () => {
  it('an emulator process writes with no trusted context at all', async () => {
    const { db, store } = seededDb()
    const result = await engine(db).processApprovedCompletion({
      familyId: FAMILY, completionId: COMPLETION, processingAt: PROCESSING_AT,
    })
    expect(result.status).toBe('processed')
    expect(store.paths().some((p) => p.includes('gamification_events'))).toBe(true)
  })

  it('writeEventIdempotent still guards on a non-local host', async () => {
    process.env.FIRESTORE_EMULATOR_HOST = 'firestore.example.com:8080'
    const { db } = seededDb()
    await expect(writeEventIdempotent(db, {} as never)).rejects.toBeInstanceOf(EmulatorOnlyGuardError)
  })
})

// --- 8/9/10/11. single writer, rollback, canonical paths --------------------
describe('8-11. single-writer, rollback and canonical persistence', () => {
  it('8. route=v4 writes V4 only; the legacy repository is never called', async () => {
    const { db, store } = seededDb()
    setRouteResolver(resolverReturning('v4'))
    const { legacy, deps } = legacySpyDeps(db)

    await processApprovedCompletion(deps, { familyId: FAMILY, completionId: COMPLETION })

    expect(legacy).not.toHaveBeenCalled()
    const v4Writes = store.paths().filter((p) => /gamification_(events|state)/.test(p))
    expect(v4Writes.length).toBe(2)
  })

  it('8b. duplicate delivery is a no-op (one event only)', async () => {
    const { db, store } = seededDb()
    setRouteResolver(resolverReturning('v4'))
    const { deps } = legacySpyDeps(db)

    await processApprovedCompletion(deps, { familyId: FAMILY, completionId: COMPLETION })
    const second = await processApprovedCompletion(deps, { familyId: FAMILY, completionId: COMPLETION })

    expect(second.status).toBe('duplicate')
    expect(store.paths().filter((p) => p.includes('gamification_events')).length).toBe(1)
  })

  it('9. rollback to legacy restores the legacy-only writer', async () => {
    const { db, store } = seededDb()
    setRouteResolver(resolverReturning('v4'))
    const { legacy, deps } = legacySpyDeps(db)
    await processApprovedCompletion(deps, { familyId: FAMILY, completionId: COMPLETION })
    const afterV4 = store.paths().length

    setRouteResolver(resolverReturning('legacy'))
    await processApprovedCompletion(deps, { familyId: FAMILY, completionId: 'completion-2' })

    expect(legacy).toHaveBeenCalledTimes(1)
    expect(store.paths().length).toBe(afterV4)
  })

  it('10. writes land on the canonical event and state paths', async () => {
    const { db, store } = seededDb()
    await engine(db).processApprovedCompletion({
      familyId: FAMILY, completionId: COMPLETION, processingAt: PROCESSING_AT,
    })
    const eventId = eventIdFor(FAMILY, MEMBER, 'TASK_APPROVED', COMPLETION)
    expect(store.read(eventDocPath(FAMILY, eventId))).toBeDefined()
    expect(store.read(stateDocPath(FAMILY, MEMBER))).toBeDefined()
  })

  it('11. stored state equals rebuildStateFromLedger() over the same ledger', async () => {
    const { db } = seededDb()
    await engine(db).processApprovedCompletion({
      familyId: FAMILY, completionId: COMPLETION, processingAt: PROCESSING_AT,
    })
    const ledger = (await readLedger(db, FAMILY)).filter((e) => e.memberId === MEMBER)
    const stored = await readState(db, FAMILY, MEMBER)
    const rebuilt = rebuildStateFromLedger(ledger, {
      updatedAt: new Date(PROCESSING_AT).toISOString(),
      projectionVersion: 1,
      timezone: 'Europe/London',
    })
    expect(businessFields(stored!)).toEqual(businessFields(rebuilt))
  })
})
