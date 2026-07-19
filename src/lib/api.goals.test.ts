import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requestHashOf } from './goalContracts'

// Mirror of the firebase/firestore mock used by api.transfers.test.ts so we can
// assert on the exact balances / ledger entries written inside each goal
// transaction. The contributions subcollection is emulated by storing an
// `__legs__` array on the collection document snapshot (matching the
// `contribSnap.data().__legs__` convention used by the API).
const firestore = vi.hoisted(() => {
  let id = 0
  const collection = vi.fn((_db: unknown, path: string) => ({ path }))
  const doc = vi.fn((first: any, ...parts: string[]) => {
    if (parts.length) return { id: parts.at(-1), path: parts.join('/') }
    id += 1
    return { id: `generated-${id}`, path: `${first.path}/generated-${id}` }
  })
  return { collection, doc, runTransaction: vi.fn(), serverTimestamp: vi.fn(() => ({ server: true })), reset: () => { id = 0 } }
})
const authState = vi.hoisted(() => ({ currentUser: { uid: 'child-1' } as any }))

// Shared doc store so both getDoc (outside transactions) and transaction.get
// resolve the same fixtures.
const docStore: Record<string, Record<string, any> | undefined> = {}

vi.mock('firebase/firestore', () => ({
  ...firestore,
  setDoc: vi.fn(),
  addDoc: vi.fn(),
  query: vi.fn((ref: any) => ref),
  where: vi.fn(),
  // getDocs resolves the contributions subcollection snapshot from docStore,
  // matching the real Firestore shape the API reads via contribSnap.docs.map(d => d.data()).
  getDocs: vi.fn(async (ref: { path: string }) => {
    const data = docStore[ref.path]
    const docs = data && Array.isArray((data as any).__docs__)
      ? (data as any).__docs__.map((d: any) => ({ data: () => d, id: d.contribId ?? d.proposalId ?? 'leg' }))
      : []
    return { docs, empty: docs.length === 0 }
  }),
  getDoc: vi.fn(async (ref: { path: string }) => ({ exists: () => docStore[ref.path] !== undefined, data: () => docStore[ref.path] })),
  deleteDoc: vi.fn(),
  updateDoc: vi.fn(),
  writeBatch: vi.fn(() => {
    const ops: { path: string; data: any }[] = [];
    const batch = {
      set: vi.fn((ref: any, data: any) => { ops.push({ path: ref?.path, data }); return batch; }),
      update: vi.fn(() => batch),
      delete: vi.fn(() => batch),
      commit: vi.fn(async () => { (batch as any).__ops = ops; }),
      __ops: ops,
    };
    return batch;
  }),

}))
vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(), signInWithEmailAndPassword: vi.fn(), signInWithPopup: vi.fn(), signOut: vi.fn(),
}))
vi.mock('./firebase', () => ({ db: { name: 'db' }, auth: authState, googleProvider: {} }))

import {
  createGoal,
  contributeToGoal,
  addParentGoalContribution,
  approveGoalWithdrawal,
  completeGoalPurchased,
  returnGoalFunds,
  approveMatchProposal,
  rejectMatchProposal,
  createMatchProposal,
} from './api'

function snapshot(data?: Record<string, any>) {
  // A contributions-collection snapshot carries `docs` (one doc per leg),
  // matching the real Firestore subcollection shape the API reads via
  // `contribSnap.docs.map(d => d.data())`.
  if (data && Array.isArray((data as any).__docs__)) {
    const docs = (data as any).__docs__.map((d: any) => ({ data: () => d, id: d.contribId ?? d.proposalId ?? 'leg' }))
    return { exists: () => true, data: () => data, docs, empty: docs.length === 0 }
  }
  return { exists: () => data !== undefined, data: () => data, docs: [], empty: true }
}
function transactionWith(docs: Record<string, Record<string, any> | undefined>, enforceReadBeforeWrite = false) {
  Object.assign(docStore, docs)
  let wrote = false
  const tx = {
    get: vi.fn(async (ref: { path: string }) => {
      if (enforceReadBeforeWrite && wrote) throw new Error('Firestore transactions require all reads to be executed before all writes.')
      return snapshot(docs[ref.path])
    }),
    update: vi.fn() as unknown as { mock: { calls: any[] }; (...args: any[]): void },
    set: vi.fn() as unknown as { mock: { calls: any[] }; (...args: any[]): void },
    delete: vi.fn() as unknown as { mock: { calls: any[] }; (...args: any[]): void },
  }
  firestore.runTransaction.mockImplementation(async (_db: unknown, callback: any) => callback(tx))
  return tx
}
const updateCall = (tx: any, path: string) => { const calls = tx.update.mock.calls.filter((c: any[]) => c[0]?.path === path); return calls.length ? calls[calls.length-1][1] : undefined }
const setCallsWhere = (tx: any, pred: (d: any) => boolean) =>
  tx.set.mock.calls
    .filter((c: any[]) => (c[0]?.path ?? '').includes('/contributions/') && pred(c[1]))
    .map((c: any[]) => c[1])
const ledgerCallsWhere = (tx: any, pred: (d: any) => boolean) =>
  tx.set.mock.calls
    .filter((c: any[]) => (c[0]?.path ?? '').includes('/goal_ledger/') && pred(c[1]))
    .map((c: any[]) => c[1])


// Build a contributions-collection snapshot carrying __docs__ (one doc per leg),
// matching the real Firestore subcollection shape the API reads via
// `contribSnap.docs.map(d => d.data())`.
function withLegs(legs: any[]) {
  return { __docs__: legs }
}

const GOAL_PATH = 'families/family-1/savings_goals/goal-1'
const CONTRIB_PATH = 'families/family-1/savings_goals/goal-1/contributions'
const WALLET_C1 = 'families/family-1/wallets/child-1'
const WALLET_C2 = 'families/family-1/wallets/child-2'

describe('Goals — createGoal', () => {
  beforeEach(() => { vi.clearAllMocks(); firestore.reset(); authState.currentUser = { uid: 'parent-1' } })

  it('parent creates a family goal with v1 fields (no parent contribution)', async () => {
    const tx = transactionWith({ 'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'P' } })
    await createGoal('family-1', { title: 'Holiday', kind: 'family', targetAmountPence: 5000 })
    expect(firestore.runTransaction).toHaveBeenCalled()
    // Goal doc written with zero current amount, no contribution ledger.
    const goalSet = tx.set.mock.calls.find((c: any[]) => (c[0]?.path ?? '').endsWith('/savings_goals/generated-1'))
    expect(goalSet).toBeTruthy()
    expect(goalSet[1].currentAmountPence).toBe(0)
    expect(goalSet[1].status).toBe('active')
    // No parent_contribution ledger entry.
    const contribs = setCallsWhere(tx, (d: any) => d.type === 'parent_contribution')
    expect(contribs.length).toBe(0)
  })

  it('parent creates a child goal with no parent contribution', async () => {
    const tx = transactionWith({ 'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'P' } })
    await createGoal('family-1', { title: 'Lego', kind: 'child', childId: 'child-1', targetAmountPence: 2000 })
    const goalSet = tx.set.mock.calls.find((c: any[]) => (c[0]?.path ?? '').endsWith('/savings_goals/generated-1'))
    expect(goalSet[1].kind).toBe('child')
    expect(goalSet[1].childId).toBe('child-1')
    expect(goalSet[1].currentAmountPence).toBe(0)
    expect(setCallsWhere(tx, (d: any) => d.type === 'parent_contribution').length).toBe(0)
  })

  it('writes a fixed parent contribution ledger + goal_ledger atomically', async () => {
    const tx = transactionWith({ 'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'P' } })
    await createGoal('family-1', { title: 'Holiday', kind: 'family', targetAmountPence: 5000, parentContribution: { fixedPence: 1000 } })
    const goalSet = tx.set.mock.calls.find((c: any[]) => (c[0]?.path ?? '').endsWith('/savings_goals/generated-1'))
    expect(goalSet[1].currentAmountPence).toBe(1000)
    expect(goalSet[1].status).toBe('active')
    const contribs = setCallsWhere(tx, (d: any) => d.type === 'parent_contribution')
    expect(contribs.length).toBe(1)
    expect(contribs[0].amountPence).toBe(1000)
    expect(contribs[0].ownerType).toBe('parent')
    const ledger = ledgerCallsWhere(tx, (d: any) => d.type === 'parent_contribution')
    expect(ledger.length).toBe(1)
    expect(ledger[0].amountPence).toBe(1000)
  })

  it('writes a percentage parent contribution (of target) atomically', async () => {
    const tx = transactionWith({ 'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'P' } })
    await createGoal('family-1', { title: 'Holiday', kind: 'family', targetAmountPence: 5000, parentContribution: { percent: 20 } })
    const goalSet = tx.set.mock.calls.find((c: any[]) => (c[0]?.path ?? '').endsWith('/savings_goals/generated-1'))
    expect(goalSet[1].currentAmountPence).toBe(1000) // 20% of 5000
    const contribs = setCallsWhere(tx, (d: any) => d.type === 'parent_contribution')
    expect(contribs.length).toBe(1)
    expect(contribs[0].amountPence).toBe(1000)
  })

  it('rejects negative parent contribution', async () => {
    transactionWith({ 'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'P' } })
    await expect(createGoal('family-1', { title: 'Holiday', kind: 'family', targetAmountPence: 5000, parentContribution: { fixedPence: -100 } }))
      .rejects.toThrow(/cannot be negative/)
  })

  it('rejects fixed amount exceeding target', async () => {
    transactionWith({ 'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'P' } })
    await expect(createGoal('family-1', { title: 'Holiday', kind: 'family', targetAmountPence: 5000, parentContribution: { fixedPence: 6000 } }))
      .rejects.toThrow(/cannot exceed the goal target/)
  })

  it('rejects percentage above the approved bound', async () => {
    transactionWith({ 'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'P' } })
    await expect(createGoal('family-1', { title: 'Holiday', kind: 'family', targetAmountPence: 5000, parentContribution: { percent: 150 } }))
      .rejects.toThrow(/cannot exceed/)
  })

  it('atomic rollback: a throwing transaction writes nothing (no idempotency record)', async () => {
    transactionWith({ 'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'P' } })
    // Force the transaction callback to throw after reads, simulating a failure.
    firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: any) => {
      const tx = {
        get: vi.fn(async (ref: { path: string }) => snapshot(docStore[ref.path])),
        set: vi.fn(() => { throw new Error('simulated write failure') }),
        update: vi.fn(() => { throw new Error('simulated write failure') }),
        delete: vi.fn(),
      }
      try { await callback(tx) } catch (e) { throw e }
    })
    await expect(createGoal('family-1', { title: 'Holiday', kind: 'family', targetAmountPence: 5000, parentContribution: { fixedPence: 1000 } }))
      .rejects.toThrow(/simulated write failure/)
    // No idempotency record should be present (transaction aborted).
    expect(docStore['families/family-1/idempotency/goalContribution:generated-1:create:generated-1']).toBeUndefined()
  })

  it('idempotent replay with same clientReqId writes nothing new', async () => {
    const hash = requestHashOf({ title: 'Holiday', kind: 'family', targetAmountPence: 5000, childId: undefined, parentPence: 1000 })
    // The idempotency key is now derived from clientReqId (goalCreate_<clientReqId>),
    // not the request hash. Seed the doc at the deterministic clientReqId path.
    const idemPath = `families/family-1/idempotency/goalCreate_r1`
    const docs: Record<string, any> = {
      'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'P' },
      [idemPath]: { operationType: 'goal_create', actorId: 'parent-1', requestHash: hash, clientReqId: 'r1', status: 'completed', resultRef: 'generated-1' },
    }
    const tx = transactionWith(docs)
    await createGoal('family-1', { title: 'Holiday', kind: 'family', targetAmountPence: 5000, parentContribution: { fixedPence: 1000 }, clientReqId: 'r1' })
    // No new goal doc / contribution writes (idempotent replay returns early).
    expect(tx.set.mock.calls.filter((c: any[]) => (c[0]?.path ?? '').includes('/savings_goals/')).length).toBe(0)
  })

  it('parent wallet remains unchanged (no wallet write on goal creation)', async () => {
    const tx = transactionWith({
      'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'P' },
      'families/family-1/wallets/parent-1': { balance: 99999 },
    })
    await createGoal('family-1', { title: 'Holiday', kind: 'family', targetAmountPence: 5000, parentContribution: { fixedPence: 1000 } })
    // No wallet update for the parent wallet.
    const walletWrites = tx.update.mock.calls.filter((c: any[]) => (c[0]?.path ?? '').includes('/wallets/'))
    expect(walletWrites.length).toBe(0)
    const walletSets = tx.set.mock.calls.filter((c: any[]) => (c[0]?.path ?? '').includes('/wallets/'))
    expect(walletSets.length).toBe(0)
  })
})

describe('Goals — contributeToGoal (child wallet -> goal)', () => {
  beforeEach(() => { vi.clearAllMocks(); firestore.reset(); authState.currentUser = { uid: 'child-1' } })

  const baseDocs = (overrides: Record<string, any> = {}) => ({
    'users/child-1': { familyId: 'family-1', role: 'child', displayName: 'C1' },
    [WALLET_C1]: { balance: 1000 },
    [GOAL_PATH]: { goalId: 'goal-1', title: 'Bike', kind: 'child', childId: 'child-1', targetAmountPence: 2000, currentAmountPence: 0, currency: 'GBP', status: 'active', matching: { mode: 'none', perX: 0, matchY: 0 }, version: 1 },
    [CONTRIB_PATH]: withLegs([]),
    ...overrides,
  })

  it('debits wallet and credits goal by equal integer; wallet never negative', async () => {
    const tx = transactionWith(baseDocs())
    await contributeToGoal('family-1', 'goal-1', 'child-1', 500, { clientReqId: 'r1' })
    expect(updateCall(tx, WALLET_C1).balance).toBe(500)
    expect(updateCall(tx, GOAL_PATH).currentAmountPence).toBe(500)
  })

  it('throws on insufficient funds', async () => {
    transactionWith({ ...baseDocs(), [WALLET_C1]: { balance: 100 } })
    await expect(contributeToGoal('family-1', 'goal-1', 'child-1', 500, { clientReqId: 'r1' }))
      .rejects.toThrow(/Insufficient funds/)
  })

  it('sets reached when currentAmountPence >= targetAmountPence', async () => {
    const tx = transactionWith({ ...baseDocs(), [WALLET_C1]: { balance: 2000 } })
    await contributeToGoal('family-1', 'goal-1', 'child-1', 2000, { clientReqId: 'r1' })
    expect(updateCall(tx, GOAL_PATH).status).toBe('reached')
  })

  it('auto-match adds a parent-owned auto_match leg and credits goal', async () => {
    const tx = transactionWith(baseDocs({ [GOAL_PATH]: { goalId: 'goal-1', title: 'Bike', kind: 'child', childId: 'child-1', targetAmountPence: 2000, currentAmountPence: 0, currency: 'GBP', status: 'active', matching: { mode: 'auto', perX: 100, matchY: 50 }, version: 1 } }))
    await contributeToGoal('family-1', 'goal-1', 'child-1', 250, { clientReqId: 'r1' })
    // 250p child + 100p match (floor(250/100)*50) = 350
    expect(updateCall(tx, GOAL_PATH).currentAmountPence).toBe(350)
    const matchLegs = setCallsWhere(tx, (d) => d?.type === 'auto_match')
    expect(matchLegs.length).toBe(1)
    expect(matchLegs[0].ownerType).toBe('parent')
    expect(matchLegs[0].amountPence).toBe(100)
  })

  it('auto-match respects capPence', async () => {
    const tx = transactionWith(baseDocs({ [GOAL_PATH]: { goalId: 'goal-1', title: 'Bike', kind: 'child', childId: 'child-1', targetAmountPence: 2000, currentAmountPence: 0, currency: 'GBP', status: 'active', matching: { mode: 'auto', perX: 100, matchY: 50, capPence: 30 }, version: 1 } }))
    await contributeToGoal('family-1', 'goal-1', 'child-1', 500, { clientReqId: 'r1' })
    const matchLegs = setCallsWhere(tx, (d) => d?.type === 'auto_match')
    expect(matchLegs[0].amountPence).toBe(30)
  })

  it('manual mode creates a match_proposals with immutable source + proposed amount; no match money', async () => {
    const tx = transactionWith(baseDocs({ [GOAL_PATH]: { goalId: 'goal-1', title: 'Bike', kind: 'child', childId: 'child-1', targetAmountPence: 2000, currentAmountPence: 0, currency: 'GBP', status: 'active', matching: { mode: 'manual', perX: 100, matchY: 50 }, version: 1 } }))
    await contributeToGoal('family-1', 'goal-1', 'child-1', 250, { clientReqId: 'r1' })
    const proposals = tx.set.mock.calls.filter((c: any[]) => (c[0]?.path ?? '').includes('/match_proposals/')).map((c: any[]) => c[1])
    expect(proposals.length).toBe(1)
    expect(proposals[0].status).toBe('proposed')
    expect(proposals[0].proposedMatchAmountPence).toBe(100)
    expect(proposals[0].sourceContributionId).toBeDefined()
    // No match money credited yet.
    expect(setCallsWhere(tx, (d) => d?.type === 'manual_match').length).toBe(0)
    expect(updateCall(tx, GOAL_PATH).currentAmountPence).toBe(250)
  })
})

describe('Goals — addParentGoalContribution (external)', () => {
  beforeEach(() => { vi.clearAllMocks(); firestore.reset(); authState.currentUser = { uid: 'parent-1' } })

  it('credits goal only (no wallet debit)', async () => {
    const tx = transactionWith({
      'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'P' },
      [GOAL_PATH]: { goalId: 'goal-1', title: 'Bike', kind: 'family', targetAmountPence: 2000, currentAmountPence: 0, currency: 'GBP', status: 'active', matching: { mode: 'none', perX: 0, matchY: 0 }, version: 1 },
      [CONTRIB_PATH]: withLegs([]),
    })
    await addParentGoalContribution('family-1', 'goal-1', 700, 'r1')
    expect(updateCall(tx, GOAL_PATH).currentAmountPence).toBe(700)
    // No wallet update should occur.
    expect(tx.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('/wallets/') }),
      expect.anything(),
    )
    const parentLegs = setCallsWhere(tx, (d) => d?.type === 'parent_contribution')
    expect(parentLegs.length).toBe(1)
  })

  it('non-parent is rejected', async () => {
    authState.currentUser = { uid: 'child-1' }
    transactionWith({ 'users/child-1': { familyId: 'family-1', role: 'child' }, [GOAL_PATH]: { status: 'active' }, [CONTRIB_PATH]: withLegs([]) })
    await expect(addParentGoalContribution('family-1', 'goal-1', 700, 'r1')).rejects.toThrow(/parent or owner/)
  })
})

describe('Goals — manual match proposal approval', () => {
  beforeEach(() => { vi.clearAllMocks(); firestore.reset(); authState.currentUser = { uid: 'parent-1' } })

  it('approveMatchProposal credits manual_match exactly once', async () => {
    const tx = transactionWith({
      'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'P' },
      [GOAL_PATH]: { goalId: 'goal-1', title: 'Bike', kind: 'child', childId: 'child-1', targetAmountPence: 2000, currentAmountPence: 250, currency: 'GBP', status: 'active', matching: { mode: 'manual', perX: 100, matchY: 50 }, version: 1 },
      'families/family-1/savings_goals/goal-1/match_proposals/prop-1': { proposalId: 'prop-1', goalId: 'goal-1', sourceContributionId: 'c1', proposedMatchAmountPence: 100, status: 'proposed' },
      [CONTRIB_PATH]: withLegs([]),
    })
    await approveMatchProposal('family-1', 'goal-1', 'prop-1', 'r1')
    const matchLegs = setCallsWhere(tx, (d) => d?.type === 'manual_match')
    expect(matchLegs.length).toBe(1)
    expect(matchLegs[0].amountPence).toBe(100)
    expect(matchLegs[0].ownerType).toBe('parent')
    expect(updateCall(tx, GOAL_PATH).currentAmountPence).toBe(350)
  })

  it('approves a manual match proposal exactly once (credits exactly once)', async () => {
    const tx = transactionWith({
      'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'P' },
      [GOAL_PATH]: { goalId: 'goal-1', title: 'Bike', kind: 'child', childId: 'child-1', targetAmountPence: 2000, currentAmountPence: 250, currency: 'GBP', status: 'active', matching: { mode: 'manual', perX: 100, matchY: 50 }, version: 1 },
      'families/family-1/savings_goals/goal-1/match_proposals/prop-1': { proposalId: 'prop-1', goalId: 'goal-1', sourceContributionId: 'c1', proposedMatchAmountPence: 100, status: 'proposed' },
      [CONTRIB_PATH]: withLegs([]),
    })
    await approveMatchProposal('family-1', 'goal-1', 'prop-1', 'r1')
    // Exactly one manual_match credit is written on first approval.
    const matchLegs = setCallsWhere(tx, (d) => d?.type === 'manual_match')
    expect(matchLegs.length).toBe(1)
    expect(matchLegs[0].amountPence).toBe(100)
    expect(updateCall(tx, GOAL_PATH).currentAmountPence).toBe(350)
  })

  it('concurrent/double approval of one manual match proposal credits exactly once', async () => {
    const idemPath = 'families/family-1/idempotency/goalMatch:prop-1:r1'
    const tx = transactionWith({
      'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'P' },
      [GOAL_PATH]: { goalId: 'goal-1', title: 'Bike', kind: 'child', childId: 'child-1', targetAmountPence: 2000, currentAmountPence: 350, currency: 'GBP', status: 'active', matching: { mode: 'manual', perX: 100, matchY: 50 }, version: 1 },
      'families/family-1/savings_goals/goal-1/match_proposals/prop-1': { proposalId: 'prop-1', goalId: 'goal-1', sourceContributionId: 'c1', proposedMatchAmountPence: 100, status: 'approved' },
      [CONTRIB_PATH]: withLegs([]),
      [idemPath]: { operationType: 'goal_match_approve', actorId: 'parent-1', requestHash: requestHashOf({ goalId: 'goal-1', proposalId: 'prop-1', approve: true }), status: 'completed', resultRef: 'x' },
    })
    await approveMatchProposal('family-1', 'goal-1', 'prop-1', 'r1')
    // No new manual_match written on idempotent replay (concurrent double approval).
    expect(setCallsWhere(tx, (d) => d?.type === 'manual_match').length).toBe(0)
    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.set).not.toHaveBeenCalled()
  })

  it('rejectMatchProposal leaves the child contribution unchanged', async () => {
    const tx = transactionWith({
      'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'P' },
      'families/family-1/savings_goals/goal-1/match_proposals/prop-1': { proposalId: 'prop-1', goalId: 'goal-1', sourceContributionId: 'c1', proposedMatchAmountPence: 100, status: 'proposed' },
    })
    await rejectMatchProposal('family-1', 'goal-1', 'prop-1')
    expect(updateCall(tx, 'families/family-1/savings_goals/goal-1/match_proposals/prop-1').status).toBe('rejected')
  })
})

describe('Goals — withdrawal approval', () => {
  beforeEach(() => { vi.clearAllMocks(); firestore.reset(); authState.currentUser = { uid: 'parent-1' } })

  const goalWithChildContrib = (current: number, legs: any[]) => ({
    'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'P' },
    [GOAL_PATH]: { goalId: 'goal-1', title: 'Bike', kind: 'child', childId: 'child-1', targetAmountPence: 2000, currentAmountPence: current, currency: 'GBP', status: 'reached', matching: { mode: 'none', perX: 0, matchY: 0 }, version: 1 },
    [WALLET_C1]: { balance: 0 },
    [CONTRIB_PATH]: withLegs(legs),
    'families/family-1/goal_requests/req-1': { requestType: 'withdrawal', goalId: 'goal-1', childId: 'child-1', amountPence: 500, status: 'pending' },
  })

  it('refunds exactly netChild(child) and transitions reached -> active when below target', async () => {
    const tx = transactionWith(goalWithChildContrib(2000, [
      { type: 'child_contribution', ownerType: 'child', ownerId: 'child-1', amountPence: 2000, status: 'applied' },
    ]))
    await approveGoalWithdrawal('family-1', 'req-1', 'r1')
    expect(updateCall(tx, WALLET_C1).balance).toBe(500)
    expect(updateCall(tx, GOAL_PATH).currentAmountPence).toBe(1500)
    expect(updateCall(tx, GOAL_PATH).status).toBe('active')
  })

  it('rejects amount > netChild', async () => {
    transactionWith(goalWithChildContrib(2000, [
      { type: 'child_contribution', ownerType: 'child', ownerId: 'child-1', amountPence: 300, status: 'applied' },
    ]))
    await expect(approveGoalWithdrawal('family-1', 'req-1', 'r1')).rejects.toThrow(/Withdrawal exceeds owned contribution/)
  })

  it('parent/match money never returned to a child wallet', async () => {
    const tx = transactionWith(goalWithChildContrib(2000, [
      { type: 'child_contribution', ownerType: 'child', ownerId: 'child-1', amountPence: 500, status: 'applied' },
      { type: 'parent_contribution', ownerType: 'parent', ownerId: 'parent-1', amountPence: 1500, status: 'applied' },
    ]))
    // Request asks for 500 (the child's net); parent money must stay in goal.
    await approveGoalWithdrawal('family-1', 'req-1', 'r1')
    expect(updateCall(tx, WALLET_C1).balance).toBe(500)
    expect(updateCall(tx, GOAL_PATH).currentAmountPence).toBe(1500)
  })

  it('approves a withdrawal exactly once (credits exactly once)', async () => {
    const tx = transactionWith(goalWithChildContrib(2000, [
      { type: 'child_contribution', ownerType: 'child', ownerId: 'child-1', amountPence: 2000, status: 'applied' },
    ]))
    await approveGoalWithdrawal('family-1', 'req-1', 'r1')
    // Exactly one wallet credit + one goal update on first approval.
    expect(updateCall(tx, WALLET_C1).balance).toBe(500)
    expect(updateCall(tx, GOAL_PATH).currentAmountPence).toBe(1500)
    const withdrawLegs = setCallsWhere(tx, (d) => d?.type === 'child_withdrawal')
    expect(withdrawLegs.length).toBe(1)
  })

  it('concurrent/double approval of one withdrawal credits exactly once (idempotent replay)', async () => {
    const idemPath = 'families/family-1/idempotency/goalWithdrawal:req:req-1:r1'
    const hash = requestHashOf({ requestId: 'req-1', approve: true })
    const tx = transactionWith({
      ...goalWithChildContrib(2000, [
        { type: 'child_contribution', ownerType: 'child', ownerId: 'child-1', amountPence: 2000, status: 'applied' },
      ]),
      [idemPath]: { operationType: 'goal_withdrawal_approve', actorId: 'parent-1', requestHash: hash, status: 'completed', resultRef: 'x' },
    })
    await approveGoalWithdrawal('family-1', 'req-1', 'r1')
    // No wallet/goal/ledger writes on idempotent replay (concurrent double approval).
    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.set).not.toHaveBeenCalled()
  })
})

  describe('Goals — returnGoalFunds (per-child separate refund + external closure)', () => {
  beforeEach(() => { vi.clearAllMocks(); firestore.reset(); authState.currentUser = { uid: 'parent-1' } })

  it('refunds each child separately; parent+match closed via immutable external_closure; currentAmountPence = 0', async () => {
    const tx = transactionWith({
      'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'P' },
      [GOAL_PATH]: { goalId: 'goal-1', title: 'Trip', kind: 'family', targetAmountPence: 5000, currentAmountPence: 2000, currency: 'GBP', status: 'active', matching: { mode: 'none', perX: 0, matchY: 0 }, version: 1 },
      [WALLET_C1]: { balance: 0 },
      [WALLET_C2]: { balance: 0 },
      [CONTRIB_PATH]: withLegs([
        { type: 'child_contribution', ownerType: 'child', ownerId: 'child-1', amountPence: 800, status: 'applied' },
        { type: 'child_contribution', ownerType: 'child', ownerId: 'child-2', amountPence: 700, status: 'applied' },
        { type: 'parent_contribution', ownerType: 'parent', ownerId: 'parent-1', amountPence: 500, status: 'applied' },
      ]),
    })
    await returnGoalFunds('family-1', 'goal-1', 'r1')
    expect(updateCall(tx, WALLET_C1).balance).toBe(800)
    expect(updateCall(tx, WALLET_C2).balance).toBe(700)
    // Each refunded child receives an immutable completion_refund contribution leg.
    const refunds = setCallsWhere(tx, (d) => d?.type === 'completion_refund')
    expect(refunds.length).toBe(2)
    expect(refunds.find((d: any) => d.ownerId === 'child-1')?.amountPence).toBe(-800)
    expect(refunds.find((d: any) => d.ownerId === 'child-2')?.amountPence).toBe(-700)
    // Parent 500 closed via an immutable external_closure contribution leg (never
    // credited to a wallet, never a scalar on the goal doc).
    const closures = setCallsWhere(tx, (d) => d?.type === 'external_closure')
    expect(closures.length).toBe(1)
    expect(closures[0].amountPence).toBe(-500)
    // No closedExternalPence scalar is written to the goal doc.
    expect(updateCall(tx, GOAL_PATH).closedExternalPence).toBeUndefined()
    expect(updateCall(tx, GOAL_PATH).currentAmountPence).toBe(0)
    expect(updateCall(tx, GOAL_PATH).status).toBe('completed_returned')
  })

  it('missing wallet during multi-child return fails closed (no idempotency record written)', async () => {
    const tx = transactionWith({
      'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'P' },
      [GOAL_PATH]: { goalId: 'goal-1', title: 'Trip', kind: 'family', targetAmountPence: 5000, currentAmountPence: 1500, currency: 'GBP', status: 'active', matching: { mode: 'none', perX: 0, matchY: 0 }, version: 1 },
      [WALLET_C1]: { balance: 0 },
      // child-2 wallet document intentionally missing -> operation must fail.
      [CONTRIB_PATH]: withLegs([
        { type: 'child_contribution', ownerType: 'child', ownerId: 'child-1', amountPence: 800, status: 'applied' },
        { type: 'child_contribution', ownerType: 'child', ownerId: 'child-2', amountPence: 700, status: 'applied' },
      ]),
    })
    await expect(returnGoalFunds('family-1', 'goal-1', 'r1')).rejects.toThrow(/Wallet not found/)
    // The operation did not complete: no idempotency operation document was
    // written (in a real Firestore transaction the partial wallet writes are
    // rolled back atomically on the thrown error).
    const idemWrites = tx.set.mock.calls.filter((c: any[]) => c[0]?.path?.includes('/idempotency/'))
    expect(idemWrites.length).toBe(0)
    // The goal was not marked completed_returned.
    const goalUpdate = tx.update.mock.calls.find((c: any[]) => c[0]?.path === GOAL_PATH)?.[1]
    expect(goalUpdate?.status).not.toBe('completed_returned')
  })

  it('refund-child limit is enforced with zero writes', async () => {
    // Build 21 distinct child owners, exceeding MAX_CHILD_REFUNDS_PER_GOAL (20).
    const legs: any[] = []
    for (let i = 1; i <= 21; i++) {
      legs.push({ type: 'child_contribution', ownerType: 'child', ownerId: `child-${i}`, amountPence: 10, status: 'applied' })
    }
    const tx = transactionWith({
      'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'P' },
      [GOAL_PATH]: { goalId: 'goal-1', title: 'Trip', kind: 'family', targetAmountPence: 5000, currentAmountPence: 210, currency: 'GBP', status: 'active', matching: { mode: 'none', perX: 0, matchY: 0 }, version: 1 },
      [CONTRIB_PATH]: withLegs(legs),
    })
    await expect(returnGoalFunds('family-1', 'goal-1', 'r1')).rejects.toThrow(/safety limit/i)
    // Limit validated before the write stage: zero financial writes.
    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.set).not.toHaveBeenCalled()
  })
})

describe('Goals — completeGoalPurchased', () => {
  beforeEach(() => { vi.clearAllMocks(); firestore.reset(); authState.currentUser = { uid: 'parent-1' } })

  it('sets completed_purchased with no wallet movement; locks further writes', async () => {
    const tx = transactionWith({
      'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'P' },
      [GOAL_PATH]: { goalId: 'goal-1', title: 'Bike', kind: 'child', childId: 'child-1', targetAmountPence: 2000, currentAmountPence: 2000, currency: 'GBP', status: 'reached', matching: { mode: 'none', perX: 0, matchY: 0 }, version: 1 },
    })
    await completeGoalPurchased('family-1', 'goal-1', 'r1')
    expect(updateCall(tx, GOAL_PATH).status).toBe('completed_purchased')
    expect(tx.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('/wallets/') }),
      expect.anything(),
    )
  })

  it('non-parent is rejected', async () => {
    authState.currentUser = { uid: 'child-1' }
    transactionWith({ 'users/child-1': { familyId: 'family-1', role: 'child' }, [GOAL_PATH]: { status: 'reached' } })
    await expect(completeGoalPurchased('family-1', 'goal-1', 'r1')).rejects.toThrow(/parent or owner/)
  })
})

describe('Goals — atomic idempotency', () => {
  beforeEach(() => { vi.clearAllMocks(); firestore.reset(); authState.currentUser = { uid: 'child-1' } })

  const baseDocs = () => ({
    'users/child-1': { familyId: 'family-1', role: 'child', displayName: 'C1' },
    [WALLET_C1]: { balance: 1000 },
    [GOAL_PATH]: { goalId: 'goal-1', title: 'Bike', kind: 'child', childId: 'child-1', targetAmountPence: 2000, currentAmountPence: 0, currency: 'GBP', status: 'active', matching: { mode: 'none', perX: 0, matchY: 0 }, version: 1 },
    [CONTRIB_PATH]: withLegs([]),
  })

  it('replay with same key + same requestHash -> no new writes', async () => {
    const idemPath = 'families/family-1/idempotency/goalContribution:goal-1:r1'
    const hash = requestHashOf({ goalId: 'goal-1', childId: 'child-1', amountPence: 500, approvalRequired: false })
    const tx = transactionWith({
      ...baseDocs(),
      [idemPath]: { operationType: 'goal_contribution', actorId: 'child-1', requestHash: hash, status: 'completed', resultRef: 'contrib-x' },
    })
    await contributeToGoal('family-1', 'goal-1', 'child-1', 500, { clientReqId: 'r1' })
    // No wallet/goal writes on idempotent replay.
    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.set).not.toHaveBeenCalled()
  })

  it('replay with same key + different requestHash -> rejected', async () => {
    const idemPath = 'families/family-1/idempotency/goalContribution:goal-1:r1'
    const tx = transactionWith({
      ...baseDocs(),
      [idemPath]: { operationType: 'goal_contribution', actorId: 'child-1', requestHash: 'deadbeef', status: 'completed', resultRef: 'contrib-x' },
    })
    await expect(contributeToGoal('family-1', 'goal-1', 'child-1', 500, { clientReqId: 'r1' }))
      .rejects.toThrow(/Idempotency key conflict/)
    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.set).not.toHaveBeenCalled()
  })

  it('failed transaction leaves no idempotency record', async () => {
    // Insufficient funds -> throws before any write, so idempotency never written.
    const tx = transactionWith({ ...baseDocs(), [WALLET_C1]: { balance: 100 } })
    await expect(contributeToGoal('family-1', 'goal-1', 'child-1', 500, { clientReqId: 'r1' }))
      .rejects.toThrow(/Insufficient funds/)
    const idemWrites = tx.set.mock.calls.filter((c: any[]) => c[0]?.path?.includes('/idempotency/'))
    expect(idemWrites.length).toBe(0)
  })

  it('malformed existing idempotency record fails closed', async () => {
    const idemPath = 'families/family-1/idempotency/goalContribution:goal-1:r1'
    const tx = transactionWith({
      ...baseDocs(),
      // status is a number, not a string -> malformed record
      [idemPath]: { operationType: 'goal_contribution', actorId: 'child-1', requestHash: 'abc', status: 123 },
    })
    await expect(contributeToGoal('family-1', 'goal-1', 'child-1', 500, { clientReqId: 'r1' }))
      .rejects.toThrow(/malformed/i)
    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.set).not.toHaveBeenCalled()
  })

  it('non-completed existing idempotency record fails closed', async () => {
    const idemPath = 'families/family-1/idempotency/goalContribution:goal-1:r1'
    const tx = transactionWith({
      ...baseDocs(),
      [idemPath]: { operationType: 'goal_contribution', actorId: 'child-1', requestHash: requestHashOf({ goalId: 'goal-1', childId: 'child-1', amountPence: 500, approvalRequired: false }), status: 'processing' },
    })
    await expect(contributeToGoal('family-1', 'goal-1', 'child-1', 500, { clientReqId: 'r1' }))
      .rejects.toThrow(/unexpected status/i)
    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.set).not.toHaveBeenCalled()
  })

  it('contribution racing with goal completion cannot modify a terminal goal', async () => {
    // Goal already in a terminal state (completed_returned). A late contribution
    // must be rejected and must not write anything.
    const tx = transactionWith({
      ...baseDocs(),
      [GOAL_PATH]: { goalId: 'goal-1', title: 'Bike', kind: 'child', childId: 'child-1', targetAmountPence: 2000, currentAmountPence: 0, currency: 'GBP', status: 'completed_returned', matching: { mode: 'none', perX: 0, matchY: 0 }, version: 1 },
    })
    await expect(contributeToGoal('family-1', 'goal-1', 'child-1', 500, { clientReqId: 'r1' }))
      .rejects.toThrow(/not in active\/reached/i)
    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.set).not.toHaveBeenCalled()
  })
})

describe('Goals — BUG 1A/1B write payloads (regression)', () => {
  beforeEach(() => { vi.clearAllMocks(); firestore.reset(); authState.currentUser = { uid: 'parent-1' } })

  it('BUG1A: seeded goal where parent contribution == target is written with status "reached"', async () => {
    const tx = transactionWith({ 'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'P' } })
    // target 1000, fixed parent contribution 1000 -> seed meets target.
    await createGoal('family-1', { title: 'Holiday', kind: 'family', targetAmountPence: 1000, parentContribution: { fixedPence: 1000 } })
    const goalSet = tx.set.mock.calls.find((c: any[]) => (c[0]?.path ?? '').endsWith('/savings_goals/generated-1'))
    expect(goalSet).toBeTruthy()
    expect(goalSet[1].currentAmountPence).toBe(1000)
    // The exact condition that previously failed the rules check: status 'reached'.
    expect(goalSet[1].status).toBe('reached')
    // All seed legs present (contribution + ledger + idempotency).
    expect(setCallsWhere(tx, (d: any) => d.type === 'parent_contribution').length).toBe(1)
    expect(ledgerCallsWhere(tx, (d: any) => d.type === 'parent_contribution').length).toBe(1)
  })

  it('BUG1A: seeded goal where parent contribution == target via percentage is written with status "reached"', async () => {
    const tx = transactionWith({ 'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'P' } })
    // 100% of a 1000p target = 1000p seed, meeting the target exactly.
    await createGoal('family-1', { title: 'Holiday', kind: 'family', targetAmountPence: 1000, parentContribution: { percent: 100 } })
    const goalSet = tx.set.mock.calls.find((c: any[]) => (c[0]?.path ?? '').endsWith('/savings_goals/generated-1'))
    expect(goalSet[1].currentAmountPence).toBe(1000)
    expect(goalSet[1].status).toBe('reached')
  })

  it('BUG1B: createMatchProposal writes via a transaction with serverTimestamp() and immutable fields', async () => {
    const tx = transactionWith({
      'families/family-1/savings_goals/goal-1': { goalId: 'goal-1', title: 'Bike', kind: 'child', childId: 'child-1', targetAmountPence: 2000, currentAmountPence: 0, currency: 'GBP', status: 'active', version: 1 },
    })
    await createMatchProposal('family-1', 'goal-1', 'c1', 100)
    // The fix routes the proposal through runTransaction so serverTimestamp()
    // resolves to request.time (satisfying the match_proposals create rule) and
    // an idempotency doc guards against duplicate proposals on double-tap.
    expect(firestore.runTransaction).toHaveBeenCalled()
    const proposalSet = tx.set.mock.calls.find((c: any[]) => (c[0]?.path ?? '').includes('/match_proposals/'))
    expect(proposalSet).toBeDefined()
    const data = proposalSet![1]
    expect(data.proposalId).toBe('generated-1')
    expect(data.goalId).toBe('goal-1')
    expect(data.sourceContributionId).toBe('c1')
    expect(data.proposedMatchAmountPence).toBe(100)
    expect(data.status).toBe('proposed')
    expect(data.createdBy).toBe('parent-1')
    // serverTimestamp() sentinel is written (resolved to request.time by Firestore).
    expect(data.createdAt).toEqual({ server: true })
    // Idempotency doc is written alongside the proposal.
    const idemSet = tx.set.mock.calls.find((c: any[]) => (c[0]?.path ?? '').includes('/idempotency/'))
    expect(idemSet).toBeDefined()
    expect(idemSet![1].operationType).toBe('goal_match_proposal')
  })

  it('createMatchProposal is idempotent: double-tap with same clientReqId writes one proposal', async () => {
    const idemPath = 'families/family-1/idempotency/goalMatch:c1:r1'
    const tx = transactionWith({
      'families/family-1/savings_goals/goal-1': { goalId: 'goal-1', title: 'Bike', kind: 'child', childId: 'child-1', targetAmountPence: 2000, currentAmountPence: 0, currency: 'GBP', status: 'active', version: 1 },
      [idemPath]: { operationType: 'goal_match_proposal', actorId: 'parent-1', requestHash: requestHashOf({ goalId: 'goal-1', sourceContributionId: 'c1', proposedMatchAmountPence: 100 }), status: 'completed', resultRef: 'p1' },
    })
    await createMatchProposal('family-1', 'goal-1', 'c1', 100, 'r1')
    // Replay must perform no new proposal write (idempotency short-circuits).
    const proposalSets = tx.set.mock.calls.filter((c: any[]) => (c[0]?.path ?? '').includes('/match_proposals/'))
    expect(proposalSets.length).toBe(0)
  })
})
