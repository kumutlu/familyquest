import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import {
  encodeFirestoreValue,
  FirebaseAdminDataStore,
  LocalJsonWriter,
} from '../../scripts/lib/firebase-admin-data-tools'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('FirebaseAdminDataStore', () => {
  it('enumerates document references, including missing parent documents', async () => {
    const listDocuments = vi.fn().mockResolvedValue([
      { id: 'present', path: 'families/fam-1/tasks/present' },
      { id: 'missing', path: 'families/fam-1/tasks/missing' },
    ])
    const db = {
      collection: vi.fn(() => ({ listDocuments })),
    } as unknown as Firestore
    const store = new FirebaseAdminDataStore(db)

    await expect(store.listDocumentReferences('families/fam-1/tasks')).resolves.toEqual([
      { id: 'present', path: 'families/fam-1/tasks/present' },
      { id: 'missing', path: 'families/fam-1/tasks/missing' },
    ])
    expect(listDocuments).toHaveBeenCalledOnce()
  })

  it('translates removals and commits exactly one production batch', async () => {
    const update = vi.fn()
    const commit = vi.fn().mockResolvedValue(undefined)
    const reference = { path: 'families/fam-1/wallets/child-1' }
    const db = {
      doc: vi.fn(() => reference),
      batch: vi.fn(() => ({ delete: vi.fn(), set: vi.fn(), update, commit })),
    } as unknown as Firestore
    const store = new FirebaseAdminDataStore(db)

    await store.commit([{
      type: 'update', path: reference.path, data: { balance: 0 }, removeFields: ['lastManualTxId'],
    }])

    expect(update).toHaveBeenCalledOnce()
    expect(update.mock.calls[0][0]).toBe(reference)
    expect(update.mock.calls[0][1]).toMatchObject({ balance: 0, lastManualTxId: expect.anything() })
    expect(commit).toHaveBeenCalledOnce()
  })
})

describe('LocalJsonWriter', () => {
  it('creates an exclusive owner-only backup with lossless Firestore type tags', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'family-data-tools-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'nested', 'backup.json')
    const writer = new LocalJsonWriter()

    class Timestamp {
      toDate() { return new Date('2026-07-13T08:09:10.000Z') }
    }
    class DocumentReference {
      constructor(readonly path: string) {}
    }
    class GeoPoint {
      constructor(readonly latitude: number, readonly longitude: number) {}
    }

    await writer.writeJson(path, {
      date: new Date('2026-07-13T08:09:10.000Z'),
      timestamp: new Timestamp(),
      reference: new DocumentReference('families/fam-1'),
      geopoint: new GeoPoint(51.5, -0.1),
      bytes: Buffer.from('safe'),
    })

    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      date: { __firestoreType: 'date', value: '2026-07-13T08:09:10.000Z' },
      timestamp: { __firestoreType: 'timestamp', value: '2026-07-13T08:09:10.000Z' },
      reference: { __firestoreType: 'reference', value: 'families/fam-1' },
      geopoint: { __firestoreType: 'geopoint', latitude: 51.5, longitude: -0.1 },
      bytes: { __firestoreType: 'bytes', value: Buffer.from('safe').toString('base64') },
    })
    await expect(writer.writeJson(path, {})).rejects.toMatchObject({ code: 'EEXIST' })
  })

  it('recursively encodes nested arrays and maps before Date.toJSON can run', () => {
    expect(encodeFirestoreValue({ nested: [new Date('2026-07-13T08:09:10.000Z')] })).toEqual({
      nested: [{ __firestoreType: 'date', value: '2026-07-13T08:09:10.000Z' }],
    })
  })
})
