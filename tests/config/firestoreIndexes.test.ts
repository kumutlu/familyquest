import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bootstrapCompositeIndexes } from '../../src/lib/bootstrapQueries'

describe('Firestore composite index configuration', () => {
  it('points Firebase at a source-controlled manifest matching production bootstrap queries', () => {
    const firebaseConfig = JSON.parse(readFileSync('firebase.json', 'utf8'))
    const indexConfig = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'))

    expect(firebaseConfig.firestore.indexes).toBe('firestore.indexes.json')
    expect(indexConfig.indexes).toEqual(bootstrapCompositeIndexes)
    expect(Object.keys(indexConfig).sort()).toEqual(['fieldOverrides', 'indexes'])
  })

  it('retains the single-field override required by the invitation collection-group query', () => {
    // functions/src/familyInvitations.ts runs
    //   db.collectionGroup('invitations').where('code', '==', code)
    // which requires an explicit COLLECTION_GROUP scoped single-field index on
    // `code`. Automatic single-field indexes are COLLECTION scoped only, so this
    // override is required by a real production query and must not be removed.
    const indexConfig = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'))

    const override = indexConfig.fieldOverrides.find(
      (entry: any) => entry.collectionGroup === 'invitations' && entry.fieldPath === 'code',
    )
    expect(override).toBeDefined()
    expect(override.indexes).toContainEqual({
      order: 'ASCENDING',
      queryScope: 'COLLECTION_GROUP',
    })
  })

  it('supports cross-family pending membership discovery with the production collection-group index', () => {
    const indexConfig = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'))

    expect(indexConfig.indexes).toContainEqual({
      collectionGroup: 'join_requests',
      queryScope: 'COLLECTION_GROUP',
      fields: [
        { fieldPath: 'uid', order: 'ASCENDING' },
        { fieldPath: 'status', order: 'ASCENDING' },
      ],
    })
  })

  it('keeps the transfer_requests index in sync with the child pending-query shape', () => {
    // The child pending-transfer query filters by `fromChildId` only (no orderBy),
    // so it relies on the automatic single-field index and must NOT require a
    // composite index to load. The composite index defined here is retained for
    // any ordered server-side reads, but its absence must never break the query.
    const transferIndex = bootstrapCompositeIndexes.find(
      (idx: any) =>
        idx.collectionGroup === 'transfer_requests' &&
        idx.fields.some((f: any) => f.fieldPath === 'fromChildId'),
    )
    expect(transferIndex).toBeDefined()
    expect(transferIndex.fields.map((f: any) => f.fieldPath)).toEqual([
      'fromChildId',
      'createdAt',
    ])
  })
})
