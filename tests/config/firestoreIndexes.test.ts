import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bootstrapCompositeIndexes } from '../../src/lib/bootstrapQueries'

describe('Firestore composite index configuration', () => {
  it('points Firebase at a source-controlled manifest matching production bootstrap queries', () => {
    const firebaseConfig = JSON.parse(readFileSync('firebase.json', 'utf8'))
    const indexConfig = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'))

    expect(firebaseConfig.firestore.indexes).toBe('firestore.indexes.json')
    expect(indexConfig).toEqual({
      indexes: bootstrapCompositeIndexes,
      fieldOverrides: [],
    })
  })
})
