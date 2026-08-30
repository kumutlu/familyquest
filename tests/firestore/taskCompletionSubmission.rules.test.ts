import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const FAMILY_ID = 'completion-family'
const OTHER_FAMILY_ID = 'other-family'
const CHILD_ID = 'child-1'
const SIBLING_ID = 'child-2'
const MANAGED_CHILD_ID = 'managed-child-1'
const MANAGED_AUTH_UID = 'managed-auth-1'
const PARENT_ID = 'parent-1'

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'familyquest-task-completion-submission',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  })
})

afterAll(async () => testEnv.cleanup())

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, `families/${FAMILY_ID}`), { lifecycleState: 'active' }),
      setDoc(doc(db, `families/${OTHER_FAMILY_ID}`), { lifecycleState: 'active' }),
      setDoc(doc(db, `users/${PARENT_ID}`), { familyId: FAMILY_ID, role: 'parent', displayName: 'Parent' }),
      setDoc(doc(db, `users/${CHILD_ID}`), {
        familyId: FAMILY_ID,
        role: 'child',
        displayName: 'Child One',
        currentStreak: 0,
        longestStreak: 0,
        rewardPoints: 10,
        lifetimeXP: 20,
      }),
      setDoc(doc(db, `users/${SIBLING_ID}`), {
        familyId: FAMILY_ID,
        role: 'child',
        displayName: 'Child Two',
        currentStreak: 0,
        longestStreak: 0,
        rewardPoints: 30,
        lifetimeXP: 40,
      }),
      setDoc(doc(db, `users/${MANAGED_CHILD_ID}`), {
        familyId: FAMILY_ID,
        role: 'child',
        displayName: 'Managed Child',
        currentStreak: 0,
        longestStreak: 0,
        rewardPoints: 50,
        lifetimeXP: 60,
        isManaged: true,
        authUid: MANAGED_AUTH_UID,
        requiresPasswordChange: false,
      }),
      setDoc(doc(db, `families/${FAMILY_ID}/tasks/normal-task`), {
        title: 'Normal task',
        assigneeId: CHILD_ID,
        requiresApproval: false,
        pointsReward: 10,
      }),
      setDoc(doc(db, `families/${FAMILY_ID}/tasks/unassigned-task`), {
        title: 'Unassigned family task',
        assigneeId: null,
        requiresApproval: true,
        pointsReward: 40,
      }),
      setDoc(doc(db, `families/${FAMILY_ID}/tasks/approval-task`), {
        title: 'Approval task',
        assigneeId: CHILD_ID,
        requiresApproval: true,
        pointsReward: 10,
      }),
      setDoc(doc(db, `families/${FAMILY_ID}/tasks/managed-task`), {
        title: 'Managed task',
        assigneeId: MANAGED_CHILD_ID,
        requiresApproval: true,
        pointsReward: 10,
      }),
      setDoc(doc(db, `families/${OTHER_FAMILY_ID}/tasks/other-task`), {
        title: 'Other task',
        assigneeId: 'other-child',
        requiresApproval: true,
      }),
    ])
  })
})

function normalChildDb() {
  return testEnv.authenticatedContext(CHILD_ID).firestore()
}

function managedChildDb() {
  return testEnv.authenticatedContext(MANAGED_AUTH_UID, {
    managedChild: true,
    childId: MANAGED_CHILD_ID,
    role: 'child',
    familyId: FAMILY_ID,
  }).firestore()
}

async function submitCompletion(
  db: ReturnType<typeof normalChildDb>,
  options: {
    childId: string
    taskId: string
    completionId: string
    requiresApproval: boolean
    currentStreak?: number
    longestStreak?: number
  },
) {
  const userRef = doc(db, `users/${options.childId}`)
  const taskRef = doc(db, `families/${FAMILY_ID}/tasks/${options.taskId}`)
  const completionRef = doc(db, `families/${FAMILY_ID}/task_completions/${options.completionId}`)
  const notificationRef = doc(db, `families/${FAMILY_ID}/notifications/task_submitted_${options.completionId}`)
  await runTransaction(db, async transaction => {
    await transaction.get(userRef)
    await transaction.get(taskRef)
    await transaction.get(completionRef)
    if (options.requiresApproval) await transaction.get(notificationRef)

    transaction.set(completionRef, {
      taskId: options.taskId,
      assigneeId: options.childId,
      status: options.requiresApproval ? 'pending_approval' : 'approved',
      periodKey: 'one-time',
      completedAt: serverTimestamp(),
      approvedAt: options.requiresApproval ? null : serverTimestamp(),
    })
    transaction.update(userRef, {
      currentStreak: options.currentStreak ?? 1,
      longestStreak: options.longestStreak ?? 1,
      lastActiveDate: serverTimestamp(),
    })
    if (options.requiresApproval) {
      transaction.set(notificationRef, {
        familyId: FAMILY_ID,
        type: 'task_submitted',
        actorId: options.childId,
        recipientIds: [PARENT_ID],
        title: 'A child completed a task',
        body: 'Review task completion',
        entityType: 'task_completion',
        entityId: options.completionId,
        actionUrl: '/',
        dedupeKey: `task_submitted:${options.completionId}`,
        createdAt: serverTimestamp(),
      })
    }
  })
}

describe('child authoritative task-completion submission', () => {
  it('normal child completion transaction creates an approved authoritative record', async () => {
    const db = normalChildDb()
    await assertSucceeds(submitCompletion(db, {
      childId: CHILD_ID,
      taskId: 'normal-task',
      completionId: 'normal-completion',
      requiresApproval: false,
    }))
    await testEnv.withSecurityRulesDisabled(async context => {
      const completion = await getDoc(doc(context.firestore(), `families/${FAMILY_ID}/task_completions/normal-completion`))
      expect(completion.data()?.status).toBe('approved')
      const child = await getDoc(doc(context.firestore(), `users/${CHILD_ID}`))
      expect(child.data()).toMatchObject({ rewardPoints: 10, lifetimeXP: 20 })
    })
  })

  it('normal child can complete an approval-required family task with a null assignee', async () => {
    const db = normalChildDb()
    await assertSucceeds(submitCompletion(db, {
      childId: CHILD_ID,
      taskId: 'unassigned-task',
      completionId: 'unassigned-completion',
      requiresApproval: true,
    }))
  })

  it('normal child completion accepts a legacy streak where longest is below current', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await updateDoc(doc(context.firestore(), `users/${CHILD_ID}`), {
        currentStreak: 4,
        longestStreak: 0,
      })
    })
    const db = normalChildDb()
    await assertSucceeds(submitCompletion(db, {
      childId: CHILD_ID,
      taskId: 'normal-task',
      completionId: 'legacy-streak-completion',
      requiresApproval: false,
      currentStreak: 4,
      longestStreak: 0,
    }))
  })

  it('managed child completion transaction creates the pending authoritative record and notification', async () => {
    const db = managedChildDb()
    await assertSucceeds(submitCompletion(db, {
      childId: MANAGED_CHILD_ID,
      taskId: 'managed-task',
      completionId: 'managed-completion',
      requiresApproval: true,
    }))
    await testEnv.withSecurityRulesDisabled(async context => {
      const adminDb = context.firestore()
      expect((await getDoc(doc(adminDb, `families/${FAMILY_ID}/task_completions/managed-completion`))).data()?.status)
        .toBe('pending_approval')
      expect((await getDoc(doc(adminDb, `families/${FAMILY_ID}/notifications/task_submitted_managed-completion`))).exists())
        .toBe(true)
      expect((await getDoc(doc(adminDb, `users/${MANAGED_CHILD_ID}`))).data())
        .toMatchObject({ rewardPoints: 50, lifetimeXP: 60 })
    })
  })

  it('approval-required task enters pending approval and creates its notification', async () => {
    const db = normalChildDb()
    await assertSucceeds(submitCompletion(db, {
      childId: CHILD_ID,
      taskId: 'approval-task',
      completionId: 'approval-completion',
      requiresApproval: true,
    }))
    expect((await getDoc(doc(db, `families/${FAMILY_ID}/task_completions/approval-completion`))).data()?.status)
      .toBe('pending_approval')
  })

  it('approval-required task cannot be forged directly into approved state', async () => {
    const db = normalChildDb()
    await assertFails(setDoc(doc(db, `families/${FAMILY_ID}/task_completions/forged-approval`), {
      taskId: 'approval-task',
      assigneeId: CHILD_ID,
      status: 'approved',
      periodKey: 'one-time',
      completedAt: serverTimestamp(),
      approvedAt: serverTimestamp(),
    }))
  })

  it('completion transaction cannot directly mint points or XP', async () => {
    const db = normalChildDb()
    const batch = writeBatch(db)
    batch.set(doc(db, `families/${FAMILY_ID}/task_completions/forged-award`), {
      taskId: 'normal-task',
      assigneeId: CHILD_ID,
      status: 'approved',
      periodKey: 'one-time',
      completedAt: serverTimestamp(),
      approvedAt: serverTimestamp(),
    })
    batch.update(doc(db, `users/${CHILD_ID}`), {
      currentStreak: 1,
      longestStreak: 1,
      lastActiveDate: serverTimestamp(),
      rewardPoints: 9999,
      lifetimeXP: 9999,
    })
    await assertFails(batch.commit())
  })

  it('child cannot mutate parent-owned task fields', async () => {
    const db = normalChildDb()
    await assertFails(updateDoc(doc(db, `families/${FAMILY_ID}/tasks/normal-task`), { pointsReward: 9999 }))
  })

  it('cross-family completion is denied', async () => {
    const db = normalChildDb()
    await assertFails(setDoc(doc(db, `families/${OTHER_FAMILY_ID}/task_completions/forged`), {
      taskId: 'other-task',
      assigneeId: CHILD_ID,
      status: 'pending_approval',
      periodKey: 'one-time',
      completedAt: serverTimestamp(),
      approvedAt: null,
    }))
  })

  it('completion for a sibling task is denied', async () => {
    const db = normalChildDb()
    await assertFails(setDoc(doc(db, `families/${FAMILY_ID}/task_completions/forged-sibling`), {
      taskId: 'managed-task',
      assigneeId: MANAGED_CHILD_ID,
      status: 'pending_approval',
      periodKey: 'one-time',
      completedAt: serverTimestamp(),
      approvedAt: null,
    }))
  })
})
