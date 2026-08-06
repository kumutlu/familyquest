import { describe, expect, it } from 'vitest'

import {
  FORBIDDEN_COLLECTIONS,
  LEGACY_COLLECTION_MAP,
  ProductionAccessError,
  assertEmulator,
  buildFixture,
  normalizeDoc,
  parseArgs,
  readFamily,
  toIso,
} from './export-to-fixtures'

describe('toIso', () => {
  it('passes through ISO strings', () => {
    expect(toIso('2026-01-01T10:00:00.000Z')).toBe('2026-01-01T10:00:00.000Z')
  })
  it('converts admin Timestamp objects', () => {
    expect(toIso({ _seconds: 1767261600, _nanoseconds: 0 })).toBe('2026-01-01T10:00:00.000Z')
  })
  it('converts objects exposing toDate()', () => {
    expect(toIso({ toDate: () => new Date('2026-01-02T00:00:00.000Z') })).toBe('2026-01-02T00:00:00.000Z')
  })
  it('returns null for non-timestamps', () => {
    expect(toIso({ foo: 1 })).toBeNull()
    expect(toIso(null)).toBeNull()
  })
})

describe('normalizeDoc', () => {
  it('injects the document id and converts timestamps', () => {
    const out = normalizeDoc('t1', {
      childId: 'm1',
      createdAt: { _seconds: 1767261600, _nanoseconds: 0 },
      awardedPoints: 20,
    })
    expect(out).toEqual({ id: 't1', awardedPoints: 20, childId: 'm1', createdAt: '2026-01-01T10:00:00.000Z' })
  })
})

describe('buildFixture', () => {
  const raw = {
    task_completions: [
      { id: 't2', data: { childId: 'm1', taskId: 'ta', createdAt: '2026-01-02T10:00:00.000Z' } },
      { id: 't1', data: { childId: 'm1', taskId: 'ta', awardedPoints: 20, createdAt: '2026-01-01T10:00:00.000Z' } },
    ],
    behaviour_events: [
      { id: 'b1', data: { childId: 'm1', behaviourType: 'positive', pointsDelta: 5, createdAt: '2026-01-03T10:00:00.000Z' } },
    ],
  }

  it('produces every LegacyFamily field, defaulting to empty arrays', () => {
    const fixture = buildFixture('FAM_1', raw)
    for (const field of Object.values(LEGACY_COLLECTION_MAP)) {
      expect(Array.isArray((fixture as unknown as Record<string, unknown>)[field])).toBe(true)
    }
    expect(fixture.familyId).toBe('FAM_1')
    expect(fixture.dailyProgress).toEqual([])
  })

  it('is deterministic: documents sorted by id', () => {
    const fixture = buildFixture('FAM_1', raw)
    expect(fixture.taskCompletions.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(JSON.stringify(buildFixture('FAM_1', raw))).toBe(JSON.stringify(buildFixture('FAM_1', raw)))
  })

  it('maps summaries to displayed state and tasks to a points lookup', () => {
    const fixture = buildFixture(
      'FAM_1',
      raw,
      [{ id: 'm1', data: { rewardPoints: 50, xpTotal: 40, level: 3 } }],
      [{ id: 'ta', data: { points: 12 } }],
    )
    expect(fixture.displayed).toEqual({ m1: { rewardPoints: 50, xpTotal: 40, level: 3 } })
    expect(fixture.tasks).toEqual({ ta: 12 })
  })

  it('never emits wallet collections', () => {
    const fixture = buildFixture('FAM_1', raw) as unknown as Record<string, unknown>
    for (const forbidden of FORBIDDEN_COLLECTIONS) {
      expect(fixture[forbidden]).toBeUndefined()
    }
  })
})

describe('assertEmulator', () => {
  it('throws when FIRESTORE_EMULATOR_HOST is unset', () => {
    expect(() => assertEmulator({} as NodeJS.ProcessEnv)).toThrow(ProductionAccessError)
  })
  it('throws for non-local hosts', () => {
    expect(() => assertEmulator({ FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' } as NodeJS.ProcessEnv)).toThrow(
      /must be local/,
    )
  })
  it('accepts a local emulator host', () => {
    expect(assertEmulator({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' } as NodeJS.ProcessEnv)).toBe('127.0.0.1:8080')
  })
})

describe('parseArgs', () => {
  it('requires --out', () => {
    expect(() => parseArgs([])).toThrow(/--out/)
  })
  it('parses --out and --family', () => {
    expect(parseArgs(['--out', 'tmp', '--family', 'F1'])).toEqual({ out: 'tmp', family: 'F1' })
  })
})

describe('readFamily', () => {
  it('only calls read APIs and reads no wallet collection', async () => {
    const touched: string[] = []
    const snapshot = (docs: Array<{ id: string; data: Record<string, unknown> }>) => ({
      docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
    })
    const db = {
      collection: (p: string) => {
        touched.push(p)
        return {
          get: async () => snapshot([]),
          doc: () => ({
            collection: (c: string) => {
              touched.push(c)
              return {
                get: async () =>
                  snapshot(c === 'task_completions' ? [{ id: 't1', data: { childId: 'm1', taskId: 'ta' } }] : []),
              }
            },
          }),
        }
      },
    }
    const fixture = await readFamily(db as never, 'FAM_1')
    expect(fixture.taskCompletions).toEqual([{ id: 't1', childId: 'm1', taskId: 'ta' }])
    for (const forbidden of FORBIDDEN_COLLECTIONS) {
      expect(touched).not.toContain(forbidden)
    }
  })
})

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { afterAll, describe as describeInit, expect as expectInit, it as itInit } from 'vitest'

const require = createRequire(import.meta.url)

// Clean up any Firebase Admin apps so the test process does not hang on open
// gRPC channels.
afterAll(async () => {
  const { getApps, deleteApp } = require('firebase-admin/app')
  await Promise.all(getApps().map((a: { delete: () => Promise<unknown> }) => a.delete()))
})

describeInit('firebase-admin initializer (modular API)', () => {
  const helperPath = resolve(__dirname, '../firebase-admin-init.cjs')

  itInit('emulator init creates app when none exists', () => {
    if (!process.env.FIRESTORE_EMULATOR_HOST) return
    const { getApps } = require('firebase-admin/app')
    const { initFirestore } = require('../firebase-admin-init.cjs')
    expect(getApps().length).toBe(0)
    const db = initFirestore({ emulator: true })
    expect(db).toBeTruthy()
    expect(getApps().length).toBe(1)
  })

  itInit('emulator init reuses an existing app', () => {
    if (!process.env.FIRESTORE_EMULATOR_HOST) return
    const { getApps } = require('firebase-admin/app')
    const { initFirestore } = require('../firebase-admin-init.cjs')
    const before = getApps().length
    const db = initFirestore({ emulator: true })
    expect(db).toBeTruthy()
    expect(getApps().length).toBe(before)
  })

  itInit('no applicationDefault() is invoked in emulator mode', () => {
    // The emulator branch of the shared initializer must never reference
    // applicationDefault (which would construct production credentials).
    const src = readFileSync(helperPath, 'utf8')
    const emulatorBranch = src.slice(src.indexOf('if (opts.emulator)'), src.indexOf('return getFirestore()'))
    expectInit(/applicationDefault/.test(emulatorBranch)).toBe(false)
    // Sanity: applicationDefault is still referenced somewhere (production path).
    expectInit(/applicationDefault/.test(src)).toBe(true)
    const { initFirestore } = require('../firebase-admin-init.cjs')
    const db = initFirestore({ emulator: true })
    expectInit(db).toBeTruthy()
  })

  itInit('source uses modular API and never references the legacy namespace', () => {
    const helper = readFileSync(helperPath, 'utf8')
    const tool = readFileSync(resolve(__dirname, 'export-to-fixtures.ts'), 'utf8')
    const legacyNs = 'admin' + '.apps'
    const legacyLen = 'apps' + '.length'
    expectInit(new RegExp(legacyNs).test(helper + '\n' + tool)).toBe(false)
    expectInit(new RegExp(legacyLen).test(helper + '\n' + tool)).toBe(false)
  })
})

describeInit('export-to-fixtures reads the emulator without writing', () => {
  itInit('reaches collection reads without crashing and performs zero writes', async () => {
    if (!process.env.FIRESTORE_EMULATOR_HOST) return
    const { initFirestore } = require('../firebase-admin-init.cjs')
    const realDb = initFirestore({ emulator: true })
    const famSnap = await realDb.collection('families').limit(1).get()
    if (!famSnap.docs.length) return
    const familyId = famSnap.docs[0].id

    const writes: string[] = []
    const fail = (m: string) => {
      writes.push(m)
      throw new Error('FIRESTORE WRITE: ' + m)
    }
    const wrapDoc = (ref: {
      id: string
      path: string
      get: () => Promise<unknown>
      listCollections: () => Promise<unknown>
      collection: (c: string) => unknown
      set: () => unknown
      update: () => unknown
      delete: () => unknown
      create: () => unknown
    }) => ({
      id: ref.id,
      path: ref.path,
      get: () => ref.get(),
      listCollections: () => ref.listCollections(),
      collection: (c: string) => wrapColl(ref.collection(c) as never),
      set: () => fail('doc.set'),
      update: () => fail('doc.update'),
      delete: () => fail('doc.delete'),
      create: () => fail('doc.create'),
    })
    const wrapColl = (ref: {
      get: () => Promise<unknown>
      where: (...a: unknown[]) => unknown
      orderBy: (...a: unknown[]) => unknown
      limit: (...a: unknown[]) => unknown
      doc: (id: string) => unknown
      add: () => unknown
    }) => ({
      get: () => ref.get(),
      where: (...a: unknown[]) => wrapColl(ref.where(...a) as never),
      orderBy: (...a: unknown[]) => wrapColl(ref.orderBy(...a) as never),
      limit: (...a: unknown[]) => wrapColl(ref.limit(...a) as never),
      doc: (id: string) => wrapDoc(ref.doc(id) as never),
      add: () => fail('coll.add'),
    })
    const tracked = {
      collection: (p: string) => wrapColl(realDb.collection(p) as never),
      doc: (p: string) => wrapDoc(realDb.doc(p) as never),
      batch: () => fail('firestore.batch'),
      bulkWriter: () => fail('firestore.bulkWriter'),
      runTransaction: () => fail('firestore.runTransaction'),
      recursiveDelete: () => fail('firestore.recursiveDelete'),
    }

    const fixture = await readFamily(tracked as never, familyId)
    expectInit(writes).toEqual([])
    expectInit(fixture.familyId).toBe(familyId)
  })
})
