/**
 * Gamification V4 — canonical storage path contract (path alignment fix).
 *
 * These tests pin the ONE canonical V4 state path from the approved design:
 *
 *   docs/gamification-v4-design.md §2.4
 *     "Collection: `families/{familyId}/gamification_state/{memberId}`"
 *
 * and the already-correct event path:
 *
 *   docs/gamification-v4-design.md §2.1
 *     "Collection: `families/{familyId}/gamification_events/{eventId}`"
 *
 * There is exactly one canonical path per collection. No aliases, no
 * root-level duplicate, no V2/V3 compatibility path.
 */

import { describe, expect, it } from 'vitest'

import {
  EVENTS_V4_COLLECTION_ID,
  STATE_V4_COLLECTION_ID,
  eventCollectionPath,
  eventDocPath,
  stateCollectionPath,
  stateDocPath,
} from './storage'

const FAMILY = 'family-1'
const MEMBER = 'member-1'

describe('V4 canonical collection ids', () => {
  it('uses the unsuffixed V4 collection ids', () => {
    expect(EVENTS_V4_COLLECTION_ID).toBe('gamification_events')
    expect(STATE_V4_COLLECTION_ID).toBe('gamification_state')
  })

  it('never reuses a V2/V3 suffixed collection id', () => {
    expect(EVENTS_V4_COLLECTION_ID).not.toMatch(/_v[23]$/)
    expect(STATE_V4_COLLECTION_ID).not.toMatch(/_v[23]$/)
  })
})

describe('canonical state path', () => {
  it('is family-scoped exactly as the design specifies', () => {
    expect(stateDocPath(FAMILY, MEMBER)).toBe('families/family-1/gamification_state/member-1')
  })

  it('is NOT a root-level collection', () => {
    expect(stateDocPath(FAMILY, MEMBER)).not.toBe('gamification_state/member-1')
    expect(stateDocPath(FAMILY, MEMBER).startsWith('families/')).toBe(true)
  })

  it('partitions state by family (isolation is structural)', () => {
    expect(stateDocPath('fam-A', MEMBER)).not.toBe(stateDocPath('fam-B', MEMBER))
  })

  it('exposes the collection path used for rebuild/leaderboard reads', () => {
    expect(stateCollectionPath(FAMILY)).toBe('families/family-1/gamification_state')
    expect(stateDocPath(FAMILY, MEMBER)).toBe(`${stateCollectionPath(FAMILY)}/${MEMBER}`)
  })
})

describe('canonical event path (unchanged)', () => {
  it('matches the design event path', () => {
    expect(eventDocPath(FAMILY, 'evt-1')).toBe('families/family-1/gamification_events/evt-1')
    expect(eventCollectionPath(FAMILY)).toBe('families/family-1/gamification_events')
  })
})

describe('path segment validation', () => {
  it('rejects an empty familyId', () => {
    expect(() => stateDocPath('', MEMBER)).toThrow()
    expect(() => eventDocPath('', 'evt-1')).toThrow()
  })

  it('rejects an empty memberId / eventId', () => {
    expect(() => stateDocPath(FAMILY, '')).toThrow()
    expect(() => eventDocPath(FAMILY, '')).toThrow()
  })

  it('rejects segments containing a slash (path injection)', () => {
    expect(() => stateDocPath(FAMILY, 'a/b')).toThrow()
    expect(() => stateDocPath('fam/../other', MEMBER)).toThrow()
  })
})
