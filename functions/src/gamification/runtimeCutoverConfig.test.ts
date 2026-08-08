/**
 * Gamification V4 — Phase 4 (B4): runtime cutover config + instant rollback.
 *
 * Proves the deployed runtime can change route WITHOUT a redeploy, that the
 * default is always legacy, and that rollback takes effect immediately.
 *
 * This test lives OUTSIDE `functions/src/gamification/v4/` (next to the
 * production-capable source it exercises) so it is not subject to the Stage 7
 * boundary guard that forces every `v4/` module to be emulator-only.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'

import {
  createCutoverResolver,
  DEFAULT_CUTOVER_CACHE_TTL_MS,
  MAX_CUTOVER_CACHE_TTL_MS,
} from './runtimeCutoverConfig'
import {
  activateWriterCutover,
  rollbackWriterCutover,
  cutoverAuditDocPath,
  CutoverActivationBlockedError,
  type CutoverEvidence,
} from './cutoverAdmin'
import { cutoverConfigDocPath } from './v4/cutoverConfig'

const FAMILY = 'FAM_RT_A'
const OTHER = 'FAM_RT_B'
const WRITER = 'task_approval' as const

class MockFirestore {
  readonly data = new Map<string, unknown>()
  failReads = false
  reads = 0
  doc(path: string): MockDoc { return new MockDoc(this, path) }
  collection(path: string): { doc: (id: string) => MockDoc } {
    return { doc: (id: string) => new MockDoc(this, `${path}/${id}`) }
  }
  _get(p: string): unknown { return this.data.get(p) }
  _set(p: string, v: unknown): void { this.data.set(p, v) }
}
class MockDoc {
  constructor(private readonly fs: MockFirestore, readonly path: string) {}
  async get(): Promise<{ exists: boolean; data: () => unknown }> {
    if (this.fs.failReads) throw new Error('firestore unavailable')
    this.fs.reads++
    const v = this.fs._get(this.path)
    return { exists: v !== undefined, data: () => v }
  }
  async set(data: unknown): Promise<void> { this.fs._set(this.path, data) }
}
function createDb(): { db: Firestore; fs: MockFirestore } {
  const fs = new MockFirestore()
  return { db: fs as unknown as Firestore, fs }
}

const goodEvidence: CutoverEvidence = {
  gate1: { valid: true, reportHash: 'hash-1' },
  gate2: { markerPresent: true, boundToGate1: true, walletHashOk: true },
  stage6: { passed: true },
}

describe('Phase 4 — resolver defaults to LEGACY', () => {
  it('no config document => legacy', async () => {
    const { db } = createDb()
    const r = createCutoverResolver({ db })
    const res = await r.resolve(WRITER, FAMILY)
    expect(res.route).toBe('legacy')
    expect(res.reason).toMatch(/not_started/)
  })

  it('unreadable config => legacy (and is not cached)', async () => {
    const { db, fs } = createDb()
    fs.failReads = true
    const onError = vi.fn()
    const r = createCutoverResolver({ db, onError })
    expect((await r.resolve(WRITER, FAMILY)).route).toBe('legacy')
    expect((await r.resolve(WRITER, FAMILY)).route).toBe('legacy')
    expect(onError).toHaveBeenCalledTimes(2)
  })

  it('malformed flags => legacy', async () => {
    const { db, fs } = createDb()
    fs._set(cutoverConfigDocPath(FAMILY), { status: 'active', flags: 'not-an-object' })
    const r = createCutoverResolver({ db })
    expect((await r.resolve(WRITER, FAMILY)).route).toBe('legacy')
  })

  it('invalid familyId => legacy without any read', async () => {
    const { db, fs } = createDb()
    const r = createCutoverResolver({ db })
    expect((await r.resolve(WRITER, '')).route).toBe('legacy')
    expect((await r.resolve(WRITER, 'a/b')).route).toBe('legacy')
    expect(fs.reads).toBe(0)
  })

  it('status not active => legacy even if flags say v4', async () => {
    const { db, fs } = createDb()
    await activateWriterCutover({ db, familyId: FAMILY, writer: WRITER, operator: 'ops', evidence: goodEvidence, at: '2026-08-08T12:00:00.000Z' })
    const cfg = fs._get(cutoverConfigDocPath(FAMILY)) as Record<string, unknown>
    fs._set(cutoverConfigDocPath(FAMILY), { ...cfg, status: 'not_started' })
    const r = createCutoverResolver({ db })
    expect((await r.resolve(WRITER, FAMILY)).route).toBe('legacy')
  })
})

describe('Phase 4 — activation requires Gate 1 + Gate 2 + Stage 6', () => {
  const cases: Array<[string, CutoverEvidence]> = [
    ['Gate 1 invalid', { ...goodEvidence, gate1: { valid: false, reason: 'stale', reportHash: 'h' } }],
    ['Gate 2 marker absent', { ...goodEvidence, gate2: { markerPresent: false, boundToGate1: false, walletHashOk: null } }],
    ['Gate 2 unbound', { ...goodEvidence, gate2: { markerPresent: true, boundToGate1: false, walletHashOk: true } }],
    ['wallet hash not ok', { ...goodEvidence, gate2: { markerPresent: true, boundToGate1: true, walletHashOk: false } }],
    ['Stage 6 failing', { ...goodEvidence, stage6: { passed: false } }],
  ]

  for (const [name, evidence] of cases) {
    it(`BLOCKS and writes nothing when ${name}`, async () => {
      const { db, fs } = createDb()
      await expect(
        activateWriterCutover({ db, familyId: FAMILY, writer: WRITER, operator: 'ops', evidence }),
      ).rejects.toBeInstanceOf(CutoverActivationBlockedError)
      expect(fs._get(cutoverConfigDocPath(FAMILY))).toBeUndefined()
    })
  }

  it('BLOCKS without an identified operator', async () => {
    const { db } = createDb()
    await expect(
      activateWriterCutover({ db, familyId: FAMILY, writer: WRITER, operator: ' ', evidence: goodEvidence }),
    ).rejects.toThrow(/operator/i)
  })
})

describe('Phase 4 — activation, dynamic routing and INSTANT rollback', () => {
  it('activates one writer for one family and routes v4 with no redeploy', async () => {
    const { db } = createDb()
    const r = createCutoverResolver({ db, ttlMs: 0 })

    expect((await r.resolve(WRITER, FAMILY)).route).toBe('legacy')

    await activateWriterCutover({ db, familyId: FAMILY, writer: WRITER, operator: 'ops', evidence: goodEvidence, at: '2026-08-08T12:00:00.000Z' })
    r.invalidate(FAMILY)

    expect((await r.resolve(WRITER, FAMILY)).route).toBe('v4')
    // other family untouched
    expect((await r.resolve(WRITER, OTHER)).route).toBe('legacy')
  })

  it('rollback returns the family to legacy immediately and keeps V4 data', async () => {
    const { db, fs } = createDb()
    fs._set(`families/${FAMILY}/gamification_events/e1`, { eventId: 'e1' })
    fs._set(`families/${FAMILY}/gamification_state/m1`, { memberId: 'm1' })
    fs._set(`families/${FAMILY}/gamification_migration_marker/marker`, { status: 'MIGRATED' })

    const r = createCutoverResolver({ db, ttlMs: 0 })
    await activateWriterCutover({ db, familyId: FAMILY, writer: WRITER, operator: 'ops', evidence: goodEvidence, at: '2026-08-08T12:00:00.000Z' })
    r.invalidate(FAMILY)
    expect((await r.resolve(WRITER, FAMILY)).route).toBe('v4')

    await rollbackWriterCutover({ db, familyId: FAMILY, operator: 'ops', reason: 'pilot abort', at: '2026-08-08T12:05:00.000Z' })
    r.invalidate(FAMILY)

    expect((await r.resolve(WRITER, FAMILY)).route).toBe('legacy')
    expect(fs._get(`families/${FAMILY}/gamification_events/e1`)).toBeTruthy()
    expect(fs._get(`families/${FAMILY}/gamification_state/m1`)).toBeTruthy()
    expect(fs._get(`families/${FAMILY}/gamification_migration_marker/marker`)).toBeTruthy()
  })

  it('writes an audit record for activate AND rollback', async () => {
    const { db, fs } = createDb()
    const a = await activateWriterCutover({ db, familyId: FAMILY, writer: WRITER, operator: 'ops@x', evidence: goodEvidence, at: '2026-08-08T12:00:00.000Z' })
    const b = await rollbackWriterCutover({ db, familyId: FAMILY, operator: 'ops@x', reason: 'abort', at: '2026-08-08T12:05:00.000Z' })

    expect(a.audit.action).toBe('activate')
    expect(a.audit.gate1Hash).toBe('hash-1')
    expect(b.audit.action).toBe('rollback')
    expect(b.audit.previousStatus).toBe('active')
    expect(fs._get(cutoverAuditDocPath(FAMILY, 'activate-2026-08-08T12-00-00-000Z'))).toBeTruthy()
    expect(fs._get(cutoverAuditDocPath(FAMILY, 'rollback-2026-08-08T12-05-00-000Z'))).toBeTruthy()
  })

  it('rollback is always possible, even with no prior config', async () => {
    const { db } = createDb()
    const { config } = await rollbackWriterCutover({ db, familyId: OTHER, operator: 'ops', reason: 'safety', at: '2026-08-08T12:00:00.000Z' })
    expect(config.status).toBe('rolled_back')
  })
})

describe('Phase 4 — bounded cache', () => {
  it('caches within the TTL and re-reads after it', async () => {
    const { db, fs } = createDb()
    let clock = 1_000_000
    const r = createCutoverResolver({ db, ttlMs: 10_000, now: () => clock })

    await r.resolve(WRITER, FAMILY)
    const afterFirst = fs.reads
    await r.resolve(WRITER, FAMILY)
    expect(fs.reads).toBe(afterFirst) // served from cache

    clock += 10_001
    await r.resolve(WRITER, FAMILY)
    expect(fs.reads).toBe(afterFirst + 1)
  })

  it('clamps the TTL to a short hard maximum', async () => {
    const { db, fs } = createDb()
    let clock = 0
    const r = createCutoverResolver({ db, ttlMs: 10 * 60 * 1000, now: () => clock })
    await r.resolve(WRITER, FAMILY)
    const first = fs.reads
    clock += MAX_CUTOVER_CACHE_TTL_MS + 1
    await r.resolve(WRITER, FAMILY)
    expect(fs.reads).toBe(first + 1)
    expect(DEFAULT_CUTOVER_CACHE_TTL_MS).toBeLessThanOrEqual(MAX_CUTOVER_CACHE_TTL_MS)
  })

  it('a stale cache cannot outlive a rollback by more than one TTL', async () => {
    const { db } = createDb()
    let clock = 0
    const r = createCutoverResolver({ db, ttlMs: 15_000, now: () => clock })
    await activateWriterCutover({ db, familyId: FAMILY, writer: WRITER, operator: 'ops', evidence: goodEvidence, at: '2026-08-08T12:00:00.000Z' })
    expect((await r.resolve(WRITER, FAMILY)).route).toBe('v4')

    await rollbackWriterCutover({ db, familyId: FAMILY, operator: 'ops', reason: 'abort', at: '2026-08-08T12:01:00.000Z' })
    clock += 15_001
    expect((await r.resolve(WRITER, FAMILY)).route).toBe('legacy')
  })

  it('returns exactly one route — never a dual write instruction', async () => {
    const { db } = createDb()
    const r = createCutoverResolver({ db })
    const res = await r.resolve(WRITER, FAMILY)
    expect(['legacy', 'v4']).toContain(res.route)
    expect(typeof res.route).toBe('string')
  })
})
