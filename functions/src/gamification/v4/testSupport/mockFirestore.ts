/**
 * Test-only in-memory Firestore double for the Stage 7 V4 writer unit tests.
 *
 * Extracted verbatim from `taskApproval.test.ts` (Task 7.1) so every remaining
 * Stage 7 writer test exercises the identical persistence semantics
 * (transactional set, collection scan, document read).
 *
 * Lives in a `testSupport/` subdirectory so it is NOT part of the V4 functions
 * module surface pinned by `tools/architecture/v4-cutover-boundary.test.ts`,
 * and it is never imported by production code.
 */

import type { Firestore } from 'firebase-admin/firestore'

export class MockDocSnap {
  constructor(
    public readonly id: string,
    private readonly value: unknown,
  ) {}
  get exists(): boolean {
    return this.value !== undefined
  }
  data(): unknown {
    return this.value
  }
}

export class MockDoc {
  constructor(
    private readonly store: MockStore,
    private readonly segments: string[],
  ) {}
  get path(): string {
    return this.segments.join('/')
  }
  async get(): Promise<MockDocSnap> {
    return new MockDocSnap(this.segments[this.segments.length - 1]!, this.store.read(this.path))
  }
  collection(name: string): MockCollection {
    return new MockCollection(this.store, [...this.segments, name])
  }
}

export class MockCollection {
  constructor(
    private readonly store: MockStore,
    private readonly segments: string[],
  ) {}
  doc(id: string): MockDoc {
    return new MockDoc(this.store, [...this.segments, id])
  }
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

export class MockTransaction {
  private writes: Array<{ path: string; data: unknown }> = []
  constructor(private readonly store: MockStore) {}
  set(ref: MockDoc, data: unknown): void {
    this.writes.push({ path: ref.path, data })
  }
  commit(): void {
    for (const w of this.writes) this.store.write(w.path, w.data)
  }
  rollback(): void {
    this.writes = []
  }
}

export class MockStore {
  private readonly data = new Map<string, unknown>()
  read(path: string): unknown {
    return this.data.get(path)
  }
  write(path: string, value: unknown): void {
    this.data.set(path, value)
  }
  entries(): Array<[string, unknown]> {
    return [...this.data.entries()]
  }
  paths(): string[] {
    return [...this.data.keys()]
  }
  collection(name: string): MockCollection {
    return new MockCollection(this, [name])
  }
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

export function mockDb(): { db: Firestore; store: MockStore } {
  const store = new MockStore()
  return { db: store as unknown as Firestore, store }
}
