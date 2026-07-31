import { describe, expect, it } from 'vitest'
import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import {
  bootstrapResources,
  bootstrapResourcesForRole,
  createBootstrapQueryPlan,
} from './bootstrapQueries'

const db = getFirestore(initializeApp({ projectId: 'demo-child-join' }, 'child-join-plan-test'))

const planFor = (role: 'parent' | 'owner' | 'child') =>
  createBootstrapQueryPlan(db, { familyId: 'family-1', userId: 'user-1', role })

describe('bootstrap plan — child join requests', () => {
  it('registers childJoinRequests as a bootstrap resource', () => {
    expect(bootstrapResources).toContain('childJoinRequests')
  })

  it.each(['parent', 'owner'] as const)('subscribes %s to the family child join requests', role => {
    const entry = planFor(role).find(item => item.resource === 'childJoinRequests')
    expect(entry).toBeDefined()
    expect((entry?.target as { path?: string }).path).toBe('families/family-1/child_join_requests')
  })

  it('never subscribes a child to child join requests', () => {
    expect(planFor('child').some(item => item.resource === 'childJoinRequests')).toBe(false)
    expect(bootstrapResourcesForRole('child')).not.toContain('childJoinRequests')
  })

  it('keeps childJoinRequests in the parent resource set', () => {
    expect(bootstrapResourcesForRole('parent')).toContain('childJoinRequests')
  })
})
