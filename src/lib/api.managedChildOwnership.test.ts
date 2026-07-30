// ---------------------------------------------------------------------------
// Regression tests for managed-child ownership comparisons.
//
// When a managed child signs in, the Firebase Auth UID is a synthetic
// account UID created by auth.createUser() in the backend. The child's
// Firestore document ID (childId) is carried as a custom claim on the
// Auth token. The frontend resolves the child's profile from users/{childId}
// and stores currentUser.id = childId.
//
// Before the fix, ownership comparisons in completeTask, redeemReward,
// contributeToFund, contributeToGoal, and requestGoalWithdrawal compared
// auth.currentUser.uid (the synthetic Auth UID) against the child's
// Firestore document ID, which always failed for managed children.
//
// After the fix, getEffectiveActorId() resolves the correct actor ID
// from the token claims, so the comparison works for both regular users
// and managed children.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest'

const firestore = vi.hoisted(() => {
  let id = 0
  const collection = vi.fn((_db: unknown, path: string) => ({ path }))
  const doc = vi.fn((first: any, ...parts: string[]) => {
    if (parts.length) return { id: parts.at(-1), path: parts.join('/') }
    id += 1
    return { id: `generated-${id}`, path: `${first?.path ?? 'db'}/generated-${id}` }
  })
  return {
    collection,
    doc,
    runTransaction: vi.fn(),
    serverTimestamp: vi.fn(() => ({ server: true })),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    addDoc: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    startAfter: vi.fn(),
    writeBatch: vi.fn(() => ({ set: vi.fn(), commit: vi.fn(async () => {}) })),
    reset: () => { id = 0 },
  }
})

// Auth UID is a synthetic account UID — DIFFERENT from the child's
// Firestore document ID. This simulates the managed-child identity
// model where auth.currentUser.uid is a synthetic Auth UID and the
// child's Firestore document ID is carried as the `childId` custom claim.
const authState = vi.hoisted(() => ({
  currentUser: {
    uid: 'auth-uid-synthetic-abc123',
    getIdTokenResult: vi.fn(async () => ({
      claims: { managedChild: true, childId: 'child-1', role: 'child', familyId: 'fam1' },
    })),
  } as any,
}))

const CHILD_FIRESTORE_ID = 'child-1'

vi.mock('firebase/firestore', () => ({ ...firestore }))
vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('./firebase', () => ({ db: { name: 'db' }, auth: authState, googleProvider: {} }))

import {
  completeTask,
  redeemReward,
  contributeToFund,
  contributeToGoal,
  requestGoalWithdrawal,
} from './api'

function snapshot(data?: Record<string, any>) {
  return { exists: () => data !== undefined, data: () => data }
}

function transactionWith(docs: Record<string, Record<string, any> | undefined>) {
  const tx = {
    get: vi.fn(async (ref: { path: string }) => snapshot(docs[ref.path])),
    update: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  }
  firestore.runTransaction.mockImplementation(async (_db: unknown, callback: any) => callback(tx))
  return tx
}

const approvers = {
  docs: [
    { id: 'owner-1', data: () => ({ role: 'owner', familyId: 'fam1' }) },
    { id: 'parent-1', data: () => ({ role: 'parent', familyId: 'fam1' }) },
  ],
}

describe('managed child ownership — Auth UID != Firestore doc ID', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    firestore.reset()
  })

  describe('completeTask', () => {
    it('allows a managed child to complete their own assigned task', async () => {
      firestore.getDocs.mockResolvedValue(approvers)
      firestore.getDoc.mockResolvedValue(snapshot({ title: 'Clean bedroom', pointsReward: 20, assigneeId: CHILD_FIRESTORE_ID }))
      transactionWith({
        'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'Muhammed', rewardPoints: 0, lifetimeXP: 0, lastActiveDate: null },
        'families/fam1/tasks/task-1': { title: 'Clean bedroom', pointsReward: 20, assigneeId: CHILD_FIRESTORE_ID },
      })
      // Should NOT throw "Cannot complete a task for another user"
      await completeTask('fam1', 'task-1', CHILD_FIRESTORE_ID, true)
    })

    it('rejects when a managed child tries to complete a task for a different child', async () => {
      firestore.getDocs.mockResolvedValue(approvers)
      await expect(completeTask('fam1', 'task-1', 'child-2', true))
        .rejects.toThrow('Cannot complete a task for another user')
    })
  })

  describe('redeemReward', () => {
    it('allows a managed child to redeem their own reward', async () => {
      firestore.getDocs.mockResolvedValue(approvers)
      transactionWith({
        'families/fam1/rewards/reward-1': { title: 'Extra screen time', pointsCost: 50 },
        'users/child-1': { familyId: 'fam1', role: 'child', rewardPoints: 100, lifetimeXP: 0 },
      })
      await redeemReward('fam1', CHILD_FIRESTORE_ID, 'reward-1')
    })

    it('rejects when a managed child tries to redeem a reward for another child', async () => {
      firestore.getDocs.mockResolvedValue(approvers)
      await expect(redeemReward('fam1', 'child-2', 'reward-1'))
        .rejects.toThrow('Cannot redeem a reward for another user')
    })
  })

  describe('contributeToFund', () => {
    it('allows a managed child to contribute to their own fund', async () => {
      firestore.getDocs.mockResolvedValue(approvers)
      transactionWith({
        'families/fam1/funds/fund-1': { balance: 1000 },
        'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'Muhammed', rewardPoints: 0, lifetimeXP: 0 },
      })
      await contributeToFund('fam1', 'fund-1', CHILD_FIRESTORE_ID, 100, 'Fund', 'Child')
    })

    it('rejects when a managed child tries to contribute for another child', async () => {
      firestore.getDocs.mockResolvedValue(approvers)
      await expect(contributeToFund('fam1', 'fund-1', 'child-2', 100, 'Fund', 'Child'))
        .rejects.toThrow('Cannot create a contribution for another user')
    })
  })

  describe('contributeToGoal', () => {
    it('allows a managed child to contribute from their own wallet', async () => {
      firestore.getDocs.mockResolvedValue({ docs: [] })
      transactionWith({
        'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'Muhammed', rewardPoints: 0, lifetimeXP: 0 },
        'families/fam1/savings_goals/goal-1': { goalId: 'goal-1', title: 'Bike', kind: 'child', childId: CHILD_FIRESTORE_ID, targetAmountPence: 2000, currentAmountPence: 0, currency: 'GBP', status: 'active', matching: { mode: 'none', perX: 0, matchY: 0 }, version: 1 },
        'families/fam1/wallets/child-1': { balance: 1000 },
        'families/fam1/savings_goals/goal-1/contributions': { __docs__: [] },
      })
      await contributeToGoal('fam1', 'goal-1', CHILD_FIRESTORE_ID, 500, { clientReqId: 'r1' })
    })

    it('rejects when a managed child tries to contribute for another child', async () => {
      firestore.getDocs.mockResolvedValue({ docs: [] })
      transactionWith({
        'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'Muhammed', rewardPoints: 0, lifetimeXP: 0 },
        'families/fam1/savings_goals/goal-1': { goalId: 'goal-1', title: 'Bike', kind: 'child', childId: CHILD_FIRESTORE_ID, targetAmountPence: 2000, currentAmountPence: 0, currency: 'GBP', status: 'active', matching: { mode: 'none', perX: 0, matchY: 0 }, version: 1 },
        'families/fam1/wallets/child-1': { balance: 1000 },
        'families/fam1/savings_goals/goal-1/contributions': { __docs__: [] },
      })
      await expect(contributeToGoal('fam1', 'goal-1', 'child-2', 500, { clientReqId: 'r1' }))
        .rejects.toThrow('A child can only contribute from their own wallet')
    })
  })

  describe('requestGoalWithdrawal', () => {
    const contribDocs = [{ type: 'child_contribution', ownerType: 'child', ownerId: CHILD_FIRESTORE_ID, amountPence: 2000, status: 'applied' }]
    const contribSnapshot = { docs: contribDocs.map((d, i) => ({ data: () => d, id: `contrib-${i}` })), empty: false }

    it('allows a managed child to request their own withdrawal', async () => {
      firestore.getDocs.mockResolvedValue(contribSnapshot)
      transactionWith({
        'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'Muhammed', rewardPoints: 0, lifetimeXP: 0 },
        'families/fam1/savings_goals/goal-1': { goalId: 'goal-1', title: 'Bike', kind: 'child', childId: CHILD_FIRESTORE_ID, targetAmountPence: 2000, currentAmountPence: 2000, currency: 'GBP', status: 'reached', matching: { mode: 'none', perX: 0, matchY: 0 }, version: 1 },
      })
      await requestGoalWithdrawal('fam1', 'goal-1', CHILD_FIRESTORE_ID, 500, 'r1')
    })

    it('rejects when a managed child tries to request a withdrawal for another child', async () => {
      firestore.getDocs.mockResolvedValue(contribSnapshot)
      transactionWith({
        'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'Muhammed', rewardPoints: 0, lifetimeXP: 0 },
        'families/fam1/savings_goals/goal-1': { goalId: 'goal-1', title: 'Bike', kind: 'child', childId: CHILD_FIRESTORE_ID, targetAmountPence: 2000, currentAmountPence: 2000, currency: 'GBP', status: 'reached', matching: { mode: 'none', perX: 0, matchY: 0 }, version: 1 },
      })
      await expect(requestGoalWithdrawal('fam1', 'goal-1', 'child-2', 500, 'r1'))
        .rejects.toThrow('A child can only request their own withdrawal')
    })
  })
})
