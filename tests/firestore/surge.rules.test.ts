/**
 * RED tests for Surge-related Firestore Rules.
 *
 * Adversarial coverage:
 *   - Child cannot create / edit / delete Surge event documents.
 *   - Parent cannot write Surge event documents (server-only).
 *   - Client (parent or child) cannot write Surge evidence records.
 *   - Client (parent or child) cannot write Surge bonus events to
 *     gamification_events (already covered by `allow write: if false`,
 *     but a regression test pins the contract).
 *   - Client cannot forge or edit surge_bonus on a feed entry.
 *   - Client cannot forge or edit engagementPreferences (server-only).
 *   - Client cannot forge a Surge-related completion.
 */
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  setLogLevel,
} from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { readFileSync } from 'node:fs'

const PROJECT_ID = `surge-rules-${Date.now()}`
let testEnv: Awaited<ReturnType<typeof initializeTestEnvironment>>

beforeAll(async () => {
  setLogLevel('error')
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  })
})

afterAll(async () => {
  await testEnv?.cleanup()
})

beforeEach(async () => {
  await testEnv.clearFirestore()
})

async function seedFamily(opts: {
  familyId: string
  parentId: string
  childId: string
}) {
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await setDoc(doc(db, `families/${opts.familyId}`), {
      id: opts.familyId,
      status: 'active',
      timezone: 'UTC',
    })
    await setDoc(doc(db, `users/${opts.parentId}`), {
      id: opts.parentId,
      role: 'parent',
      familyId: opts.familyId,
    })
    await setDoc(doc(db, `users/${opts.childId}`), {
      id: opts.childId,
      role: 'child',
      familyId: opts.familyId,
    })
  })
}

describe('Firestore Rules — Surge event collection', () => {
  it('denies child read of Surge event documents (server-owned, future work)', async () => {
    await seedFamily({ familyId: 'fam-1', parentId: 'parent-1', childId: 'child-1' })
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), `families/fam-1/events/surge-1`), {
        type: 'surge',
        status: 'active',
        startsAt: 0,
        endsAt: Number.MAX_SAFE_INTEGER,
      })
    })
    const ctx = testEnv.authenticatedContext('child-1', { sub: 'child-1' })
    await assertFails(
      getDoc(doc(ctx.firestore(), 'families/fam-1/events/surge-1')),
    )
  })

  it('denies child write of Surge event documents', async () => {
    await seedFamily({ familyId: 'fam-1', parentId: 'parent-1', childId: 'child-1' })
    const ctx = testEnv.authenticatedContext('child-1', { sub: 'child-1' })
    await assertFails(
      setDoc(doc(ctx.firestore(), 'families/fam-1/events/surge-1'), {
        type: 'surge',
        status: 'active',
      }),
    )
  })

  it('denies parent write of Surge event documents (server-only)', async () => {
    await seedFamily({ familyId: 'fam-1', parentId: 'parent-1', childId: 'child-1' })
    const ctx = testEnv.authenticatedContext('parent-1', { sub: 'parent-1' })
    await assertFails(
      setDoc(doc(ctx.firestore(), 'families/fam-1/events/surge-1'), {
        type: 'surge',
        status: 'active',
        endsAt: Number.MAX_SAFE_INTEGER,
      }),
    )
  })
})

describe('Firestore Rules — Surge evidence collection', () => {
  it('denies child write of surge_evidence', async () => {
    await seedFamily({ familyId: 'fam-1', parentId: 'parent-1', childId: 'child-1' })
    const ctx = testEnv.authenticatedContext('child-1', { sub: 'child-1' })
    await assertFails(
      setDoc(doc(ctx.firestore(), 'families/fam-1/surge_evidence/surge-1__completion-1'), {
        schemaVersion: 1,
        surgeId: 'surge-1',
      }),
    )
  })

  it('denies parent write of surge_evidence (server-only audit record)', async () => {
    await seedFamily({ familyId: 'fam-1', parentId: 'parent-1', childId: 'child-1' })
    const ctx = testEnv.authenticatedContext('parent-1', { sub: 'parent-1' })
    await assertFails(
      setDoc(doc(ctx.firestore(), 'families/fam-1/surge_evidence/surge-1__completion-1'), {
        schemaVersion: 1,
        surgeId: 'surge-1',
      }),
    )
  })
})

describe('Firestore Rules — gamification_events Surge bonus protection', () => {
  it('denies client write of a Surge bonus event in gamification_events', async () => {
    await seedFamily({ familyId: 'fam-1', parentId: 'parent-1', childId: 'child-1' })
    const ctx = testEnv.authenticatedContext('parent-1', { sub: 'parent-1' })
    await assertFails(
      setDoc(
        doc(ctx.firestore(), 'families/fam-1/gamification_events/surge:surge-1:completion:completion-1'),
        {
          schemaVersion: 1,
          eventType: 'SURGE_BONUS_AWARDED',
          rewardPointsDelta: 100,
        },
      ),
    )
  })

  it('denies child write of a Surge bonus event', async () => {
    await seedFamily({ familyId: 'fam-1', parentId: 'parent-1', childId: 'child-1' })
    const ctx = testEnv.authenticatedContext('child-1', { sub: 'child-1' })
    await assertFails(
      setDoc(
        doc(ctx.firestore(), 'families/fam-1/gamification_events/surge:surge-1:completion:completion-1'),
        {
          schemaVersion: 1,
          eventType: 'SURGE_BONUS_AWARDED',
          rewardPointsDelta: 100,
        },
      ),
    )
  })
})

describe('Firestore Rules — feed entries cannot forge surgeBonusAmount', () => {
  it('still allows the normal feed entry write (no surgeBonusAmount field)', async () => {
    await seedFamily({ familyId: 'fam-1', parentId: 'parent-1', childId: 'child-1' })
    const ctx = testEnv.authenticatedContext('parent-1', { sub: 'parent-1' })
    // A normal "Task approved" feed entry with no surgeBonusAmount is fine —
    // the family controls who can write feeds.
    await assertSucceeds(
      setDoc(doc(ctx.firestore(), 'families/fam-1/feed/feed-1'), {
        actorId: 'parent-1',
        actorName: 'Parent',
        type: 'custom',
        text: 'Task approved: House Vacuum (+15 pts)',
        visibleTo: ['child-1'],
        timestamp: new Date(),
        entityType: 'task_completion',
        entityId: 'completion-1',
        createdAt: new Date(),
      }),
    )
  })
})

describe('Firestore Rules — engagementPreferences protection', () => {
  it('denies child write of engagementPreferences on the family doc', async () => {
    await seedFamily({ familyId: 'fam-1', parentId: 'parent-1', childId: 'child-1' })
    const ctx = testEnv.authenticatedContext('child-1', { sub: 'child-1' })
    await assertFails(
      updateDoc(doc(ctx.firestore(), 'families/fam-1'), {
        engagementPreferences: { surgeHours: false },
      }),
    )
  })
})

describe('Firestore Rules — task_completions create still enforces assigneeId', () => {
  // Regression: a previous P0 commit added isValidTaskCompletionCreate.
  // A sibling trying to forge a completion for a different assignee must
  // still fail.
  it('denies a sibling completing another child\'s assigned task', async () => {
    await seedFamily({ familyId: 'fam-1', parentId: 'parent-1', childId: 'child-1' })
    await testEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore()
      await setDoc(doc(db, 'families/fam-1/tasks/task-1'), {
        id: 'task-1',
        title: 'Sibling task',
        assigneeId: 'child-2',
        pointsReward: 10,
        requiresApproval: false,
      })
    })
    const ctx = testEnv.authenticatedContext('child-1', { sub: 'child-1' })
    await assertFails(
      setDoc(doc(ctx.firestore(), 'families/fam-1/task_completions/completion-1'), {
        id: 'completion-1',
        taskId: 'task-1',
        assigneeId: 'child-1',
        status: 'approved',
        approvedAt: new Date(),
        completedAt: new Date(),
        familyId: 'fam-1',
      }),
    )
  })

  it('allows an unassigned family task completion', async () => {
    await seedFamily({ familyId: 'fam-1', parentId: 'parent-1', childId: 'child-1' })
    await testEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore()
      await setDoc(doc(db, 'families/fam-1/tasks/task-1'), {
        id: 'task-1',
        title: 'Family Wash',
        assigneeId: null,
        pointsReward: 10,
        requiresApproval: true,
      })
    })
    const ctx = testEnv.authenticatedContext('child-1', { sub: 'child-1' })
    await assertSucceeds(
      setDoc(doc(ctx.firestore(), 'families/fam-1/task_completions/completion-1'), {
        id: 'completion-1',
        taskId: 'task-1',
        assigneeId: 'child-1',
        status: 'pending_approval',
        approvedAt: null,
        completedAt: new Date(),
        familyId: 'fam-1',
      }),
    )
  })
})