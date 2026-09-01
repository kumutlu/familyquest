/**
 * Engagement wiring — orchestration tests.
 */
import { describe, expect, it, vi } from 'vitest'

import { runEngagementBonuses, type EngagementWireContext } from './wire'

interface FakeSnapshot {
  readonly id: string
  readonly exists: boolean
  readonly data: () => Record<string, unknown> | undefined
}

class FakeFirestore {
  private readonly byPath = new Map<string, Record<string, unknown>>()
  set(path: string, data: Record<string, unknown>): void { this.byPath.set(path, data) }
  has(path: string): boolean { return this.byPath.has(path) }
  get(path: string): Record<string, unknown> | undefined { return this.byPath.get(path) }
  docsUnder(parent: string): Array<{ id: string; data: () => Record<string, unknown> | undefined }> {
    const out: Array<{ id: string; data: () => Record<string, unknown> | undefined }> = []
    for (const [fullPath, data] of this.byPath.entries()) {
      if (fullPath.startsWith(`${parent}/`)) {
        out.push({ id: fullPath, data: () => data })
      }
    }
    return out
  }
  collection(path: string): { id: string; where: () => FakeQueryRef } {
    const self = this
    return {
      id: path,
      where: (): FakeQueryRef => makeQueryRef(self, path),
    }
  }
  doc(path: string) {
    const self = this
    return {
      id: path,
      async get(): Promise<FakeSnapshot> {
        const data = self.byPath.get(path)
        return { id: path, exists: data !== undefined, data: () => data }
      },
    }
  }
}

function makeQueryRef(firestore: FakeFirestore, parent: string): FakeQueryRef {
  return {
    __kind: 'query',
    get: async () => ({ docs: firestore.docsUnder(parent) }),
    where: () => makeQueryRef(firestore, parent),
  }
}

interface FakeQueryRef {
  readonly __kind: 'query'
  get(): Promise<{ docs: FakeSnapshot[] }>
  where(field: string, op: string, value: unknown): FakeQueryRef
}

class FakeTransaction {
  private readonly writes = new Map<string, Record<string, unknown>>()
  constructor(private readonly firestore: FakeFirestore) {}
  async get(refOrQuery: { id?: string } & Record<string, unknown> | FakeQueryRef): Promise<unknown> {
    const r = refOrQuery as { id?: string; __kind?: string; get?: () => Promise<unknown> }
    if (r.__kind === 'query' && typeof r.get === 'function') {
      return r.get()
    }
    if (r.id !== undefined) {
      const obj = refOrQuery as { where?: unknown }
      if (typeof obj.where === 'function') {
        return { docs: this.firestore.docsUnder(r.id) }
      }
      const pending = this.writes.get(r.id)
      if (pending) return { id: r.id, exists: true, data: () => pending }
      const data = this.firestore.get(r.id)
      return { id: r.id, exists: data !== undefined, data: () => data }
    }
    return undefined
  }
  async create(ref: { id: string }, data: Record<string, unknown>): Promise<void> {
    if (this.firestore.has(ref.id) || this.writes.has(ref.id)) {
      throw new Error(`alreadyExists: ${ref.id}`)
    }
    this.writes.set(ref.id, { ...data })
  }
  async set(ref: { id: string }, data: Record<string, unknown>): Promise<void> {
    this.writes.set(ref.id, { ...data })
  }
}

const WIN_START = Date.UTC(2026, 5, 1, 12, 0, 0)

function baseContext(overrides: Partial<EngagementWireContext> = {}): EngagementWireContext {
  return {
    familyId: 'family-1',
    childId: 'child-A',
    taskId: 'task-house',
    completionId: 'completion-1',
    completedAt: WIN_START + 60_000,
    requiresApproval: false,
    timezone: 'Europe/London',
    now: WIN_START + 60_000,
    alreadyInvalid: false,
    ...overrides,
  }
}

describe('runEngagementBonuses — orchestration contract', () => {
  it('returns 0 / 0 when no events exist and no comeback is needed', async () => {
    const db = new FakeFirestore()
    const tx = new FakeTransaction(db)
    const result = await runEngagementBonuses(db as never, tx as never, baseContext({ alreadyInvalid: true }))
    expect(result).toEqual({ mysteryDropXpAwarded: 0, comebackXpAwarded: 0 })
  })

  it('absorbs any thrown error and still resolves with 0s', async () => {
    const db = new FakeFirestore()
    const tx = new FakeTransaction(db)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    tx.create = async () => { throw new Error('boom') }
    const result = await runEngagementBonuses(db as never, tx as never, baseContext())
    expect(result.mysteryDropXpAwarded).toBe(0)
    expect(result.comebackXpAwarded).toBe(0)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})