import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  Timestamp,
  type Firestore,
} from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import {
  bootstrapResourcesForRole,
  createBootstrapQueryPlan,
  type BootstrapQueryPlanEntry,
  type BootstrapRole,
} from '../../src/lib/bootstrapQueries'

const familyId = 'bootstrap-family'
const parentId = 'bootstrap-parent'
const ownerId = 'bootstrap-owner'
const childId = 'bootstrap-child'
const siblingId = 'bootstrap-sibling'
const now = Timestamp.fromMillis(1_700_000_000_000)

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'familyquest-bootstrap-query-plan',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  })

  it('child only sees their own outgoing transfer requests, never a sibling’s', async () => {
    const results = await executePlan(testEnv.authenticatedContext(childId).firestore(), childId, 'child');
    expect(results.get('transferRequests')).toEqual(['own']);
    expect(results.get('transferRequests')).not.toContain('sibling');
  });

})

afterAll(async () => testEnv.cleanup())

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, `families/${familyId}`), { name: 'Bootstrap Family' }),
      setDoc(doc(db, `users/${parentId}`), { familyId, role: 'parent' }),
      setDoc(doc(db, `users/${ownerId}`), { familyId, role: 'owner' }),
      setDoc(doc(db, `users/${childId}`), { familyId, role: 'child' }),
      setDoc(doc(db, `users/${siblingId}`), { familyId, role: 'child' }),
      setDoc(doc(db, `families/${familyId}/tasks/task`), { title: 'Task' }),
      setDoc(doc(db, `families/${familyId}/rewards/reward`), { title: 'Reward' }),
      setDoc(doc(db, `families/${familyId}/wallets/${childId}`), { balance: 100 }),
      setDoc(doc(db, `families/${familyId}/wallets/${siblingId}`), { balance: 200 }),
      setDoc(doc(db, `families/${familyId}/join_requests/join`), { uid: 'joiner', status: 'pending' }),
      setDoc(doc(db, `families/${familyId}/task_completions/own`), { assigneeId: childId }),
      setDoc(doc(db, `families/${familyId}/task_completions/sibling`), { assigneeId: siblingId }),
      setDoc(doc(db, `families/${familyId}/redemptions/own`), { userId: childId }),
      setDoc(doc(db, `families/${familyId}/redemptions/sibling`), { userId: siblingId }),
      setDoc(doc(db, `families/${familyId}/wallet_transactions/own-legacy`), { childId, createdAt: now }),
      setDoc(doc(db, `families/${familyId}/wallet_transactions/own-v2`), { childId, timestamp: now }),
      setDoc(doc(db, `families/${familyId}/wallet_transactions/sibling`), { childId: siblingId, timestamp: now }),
      setDoc(doc(db, `families/${familyId}/savings_goals/own`), { childId }),
      setDoc(doc(db, `families/${familyId}/savings_goals/sibling`), { childId: siblingId }),
      setDoc(doc(db, `families/${familyId}/transfer_requests/own`), { fromChildId: childId, toChildId: siblingId, createdAt: now }),
      setDoc(doc(db, `families/${familyId}/transfer_requests/sibling`), { fromChildId: siblingId, toChildId: childId, createdAt: now }),
      setDoc(doc(db, `families/${familyId}/money_requests/sent`), { requesterId: childId, requestedFromId: siblingId, createdAt: now }),
      setDoc(doc(db, `families/${familyId}/money_requests/received`), { requesterId: siblingId, requestedFromId: childId, createdAt: now }),
      setDoc(doc(db, `families/${familyId}/petbox_requests/own`), { childId, createdAt: now }),
      setDoc(doc(db, `families/${familyId}/petbox_requests/sibling`), { childId: siblingId, createdAt: now }),
      setDoc(doc(db, `families/${familyId}/reversals/reversal`), { status: 'completed', completedAt: now }),
      setDoc(doc(db, `families/${familyId}/feed/family-wide`), { visibleTo: [parentId, ownerId, childId, siblingId], timestamp: now }),
      setDoc(doc(db, `families/${familyId}/feed/child-visible`), { visibleTo: [parentId, childId], timestamp: now }),
      setDoc(doc(db, `families/${familyId}/feed/sibling-only`), { visibleTo: [parentId, siblingId], timestamp: now }),
      setDoc(doc(db, `families/${familyId}/feed/parent-only`), { visibleTo: [parentId, ownerId], timestamp: now }),
      setDoc(doc(db, `families/${familyId}/feed/public`), { timestamp: now }),
      setDoc(doc(db, `families/${familyId}/behaviour_events/legacy`), { createdAt: now }),
      setDoc(doc(db, `families/${familyId}/behaviour_events/v2`), { timestamp: now }),
      setDoc(doc(db, `families/${familyId}/funds/fund`), { balance: 0 }),
      setDoc(doc(db, `families/${familyId}/fund_transactions/transaction`), { createdAt: now }),
      // A sibling completion in a DIFFERENT family, used to prove cross-family
      // isolation: a child must NOT be able to read it.
      setDoc(doc(db, `families/other-family/task_completions/sibling`), { assigneeId: siblingId }),
    ])
  })
})

async function executePlan(db: Firestore, userId: string, role: BootstrapRole) {
  const plan = createBootstrapQueryPlan(db, { familyId, userId, role })
  const results = new Map<string, string[]>()

  for (const entry of plan) {
    const snapshot = await assertSucceeds(readEntry(entry))
    results.set(entry.key, entry.kind === 'document'
      ? (snapshot.exists() ? [snapshot.id] : [])
      : snapshot.docs.map(document => document.id))
  }

  expect(new Set(plan.map(entry => entry.resource))).toEqual(new Set(bootstrapResourcesForRole(role)))
  return results
}

function readEntry(entry: BootstrapQueryPlanEntry) {
  return entry.kind === 'document' ? getDoc(entry.target) : getDocs(entry.target)
}

describe('production bootstrap query plan against Firestore rules', () => {
  it.each([
    ['parent', parentId],
    ['owner', ownerId],
  ] as const)('resolves every required %s query', async (role, userId) => {
    const results = await executePlan(testEnv.authenticatedContext(userId).firestore(), userId, role)
    expect(results.get('feed')).toEqual(expect.arrayContaining([
      'family-wide', 'child-visible', 'sibling-only', 'parent-only', 'public',
    ]))
    expect(results.get('walletTransactions')).toEqual(expect.arrayContaining(['own-legacy', 'own-v2', 'sibling']))
    expect(results.get('behaviourEvents')).toEqual(expect.arrayContaining(['legacy', 'v2']))
  })

  it.each([
    ['parent', parentId],
    ['owner', ownerId],
  ] as const)('supports legacy %s role membership for family-scoped data', async (role, userId) => {
    await executePlan(testEnv.authenticatedContext(userId).firestore(), userId, role)
  })

  it('resolves every required child query while keeping private resources scoped', async () => {
    const results = await executePlan(testEnv.authenticatedContext(childId).firestore(), childId, 'child')
    expect(results.get('feed')).toEqual(expect.arrayContaining([
      'family-wide', 'child-visible', 'sibling-only', 'parent-only', 'public',
    ]))
    expect(results.get('savingsGoals')).toEqual(['own'])
    expect(results.get('walletTransactions')).toEqual(expect.arrayContaining(['own-legacy', 'own-v2']))
    expect(results.get('walletTransactions')).not.toContain('sibling')
    expect(results.get('behaviourEvents')).toEqual(expect.arrayContaining(['legacy', 'v2']))
    expect(results.get('petboxRequests')).toEqual(['own'])
    expect(results.get('moneyRequests:requester')).toEqual(['sent'])
    expect(results.get('moneyRequests:requestedFrom')).toEqual(['received'])
  })

  // Regression test for the Family weekly ranking inconsistency: a child must be
  // able to read a SIBLING's approved task completion in the same family (so the
  // weekly ranking can include every child's completions), but must NOT be able
  // to read a completion in a different family.
  it('child can read a sibling task completion in the same family but not in another family', async () => {
    const childDb = testEnv.authenticatedContext(childId).firestore()

    // Sibling completion in the SAME family — must be readable.
    await assertSucceeds(getDoc(doc(childDb, `families/${familyId}/task_completions/sibling`)))

    // Sibling completion in a DIFFERENT family — must be denied.
    await assertFails(getDoc(doc(childDb, 'families/other-family/task_completions/sibling')))
  })
})
