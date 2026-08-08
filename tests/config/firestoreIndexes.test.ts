import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bootstrapCompositeIndexes } from '../../src/lib/bootstrapQueries'

const dailyCheckinFieldOverrides = ['daily_checkins', 'daily_checkin_skips'].map(collectionGroup => ({
  collectionGroup,
  fieldPath: 'userId',
  indexes: [
    { order: 'ASCENDING', queryScope: 'COLLECTION_GROUP' },
    { order: 'DESCENDING', queryScope: 'COLLECTION_GROUP' },
  ],
}))

const invitationFieldOverride = {
  collectionGroup: 'invitations',
  fieldPath: 'code',
  indexes: [
    { order: 'ASCENDING', queryScope: 'COLLECTION' },
    { order: 'DESCENDING', queryScope: 'COLLECTION' },
    { order: 'ASCENDING', queryScope: 'COLLECTION_GROUP' },
  ],
}

describe('Firestore composite index configuration', () => {
  it('points Firebase at a source-controlled manifest matching production bootstrap queries', () => {
    const firebaseConfig = JSON.parse(readFileSync('firebase.json', 'utf8'))
    const indexConfig = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'))

    expect(firebaseConfig.firestore.indexes).toBe('firestore.indexes.json')
    expect(indexConfig).toEqual({
      indexes: bootstrapCompositeIndexes,
      fieldOverrides: [...dailyCheckinFieldOverrides, invitationFieldOverride],
    })
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

  it('deploys collection-group userId indexes for permanent account cleanup', () => {
    const indexConfig = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'))
    expect(indexConfig.fieldOverrides).toEqual(expect.arrayContaining(dailyCheckinFieldOverrides))
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
