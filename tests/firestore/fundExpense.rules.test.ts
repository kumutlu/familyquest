import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore'
import { readFileSync } from 'fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

let testEnv: any
const familyId = 'fund-expense-family'
const parentId = 'parent-1'
const ownerId = 'owner-1'
const childId = 'child-1'

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'familyquest-fund-expense-rules',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
})

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (context: any) => {
    const db = context.firestore()
    await setDoc(doc(db, `families/${familyId}`), { debtLimitPence: -5000 })
    await setDoc(doc(db, 'users', parentId), { familyId, role: 'parent', displayName: 'Parent' })
    await setDoc(doc(db, 'users', ownerId), { familyId, role: 'owner', displayName: 'Owner' })
    await setDoc(doc(db, 'users', childId), { familyId, role: 'child', displayName: 'Ada' })
    await setDoc(doc(db, 'users', 'other-parent'), { familyId: 'other-family', role: 'parent', displayName: 'Other' })
    await setDoc(doc(db, `families/${familyId}/funds/fund-1`), { balance: 1000, monthlyBudget: 6000, name: 'Pet Box' })
  })
})

afterAll(async () => testEnv.cleanup())

// Build a valid expense write batch (ledger create + fund balance decrease).
function expenseBatch(actorId: string, txId: string, amount: number, startingBalance: number, overrides: Record<string, any> = {}) {
  const db = testEnv.authenticatedContext(actorId).firestore()
  const batch = writeBatch(db)
  batch.set(doc(db, `families/${familyId}/fund_transactions/${txId}`), {
    familyId, fundId: 'fund-1', type: 'expense', amount, category: 'Vet', description: 'Check-up',
    sourceId: txId, actorId, createdAt: serverTimestamp(), status: 'completed',
    effectSnapshot: { schemaVersion: 1, entityType: 'fund_transaction', familyId, actorId, fundId: 'fund-1', fundDeltaPence: -amount, xpAdjustment: 0 },
    ...overrides.tx,
  })
  batch.update(doc(db, `families/${familyId}/funds/fund-1`), { balance: startingBalance - amount, lastFundTxId: txId, ...overrides.fund })
  return { db, batch }
}

describe('Pet Box expense security rules', () => {
  it('9. allows a parent to record an expense', async () => {
    const { batch } = expenseBatch(parentId, 'exp-parent', 500, 1000)
    await assertSucceeds(batch.commit())
  })

  it('9. allows an owner to record an expense', async () => {
    const { batch } = expenseBatch(ownerId, 'exp-owner', 500, 1000)
    await assertSucceeds(batch.commit())
  })

  it('8. denies a child from recording an expense', async () => {
    const { batch } = expenseBatch(childId, 'exp-child', 500, 1000)
    await assertFails(batch.commit())
  })

  it('8. denies a parent from a different family', async () => {
    const { batch } = expenseBatch('other-parent', 'exp-other', 500, 1000)
    await assertFails(batch.commit())
  })

  it('3. allows a parent to record an expense that overdraws the fund (negative balance permitted)', async () => {
    const { batch } = expenseBatch(parentId, 'exp-overdraw', 1500, 1000)
    await assertSucceeds(batch.commit())
    expect((await getDoc(doc(testEnv.authenticatedContext(parentId).firestore(), `families/${familyId}/funds/fund-1`))).data()?.balance).toBe(-500)
  })

  it('10. rejects a zero amount', async () => {
    const { batch } = expenseBatch(parentId, 'exp-zero', 0, 1000)
    await assertFails(batch.commit())
  })

  it('10. rejects a negative amount', async () => {
    const { batch } = expenseBatch(parentId, 'exp-neg', -500, 1000)
    await assertFails(batch.commit())
  })

  it('10. rejects a non-integer (fractional pence) amount', async () => {
    const { batch } = expenseBatch(parentId, 'exp-frac', 123.45, 1000)
    await assertFails(batch.commit())
  })

  it('13. rejects changing unrelated fund fields when recording an expense', async () => {
    const { batch } = expenseBatch(parentId, 'exp-extra', 500, 1000, { fund: { name: 'Hacked' } })
    await assertFails(batch.commit())
  })

  it('rejects an expense whose balance does not decrease by exactly the amount', async () => {
    const { batch } = expenseBatch(parentId, 'exp-wrong', 500, 1000, { fund: { balance: 1000 - 400 } })
    await assertFails(batch.commit())
  })

  it('12. rejects reusing an existing expense document id', async () => {
    const { batch } = expenseBatch(parentId, 'exp-dup', 500, 1000)
    await assertSucceeds(batch.commit())
    const { batch: second } = expenseBatch(parentId, 'exp-dup', 500, 500)
    await assertFails(second.commit())
  })

  it('11. keeps the expense ledger immutable (no updates to a recorded expense)', async () => {
    const { batch } = expenseBatch(parentId, 'exp-imm', 500, 1000)
    await assertSucceeds(batch.commit())
    const db = testEnv.authenticatedContext(parentId).firestore()
    await assertFails(updateDoc(doc(db, `families/${familyId}/fund_transactions/exp-imm`), { amount: 1 }))
  })

  it('6 & 7. lets child contributions climb a negative fund back to positive', async () => {
    await testEnv.withSecurityRulesDisabled(async (context: any) => {
      const db = context.firestore()
      await setDoc(doc(db, `families/${familyId}/funds/fund-1`), { balance: -388, monthlyBudget: 6000, name: 'Pet Box' })
      await setDoc(doc(db, `families/${familyId}/petbox_requests/pet-a`), { familyId, fundId: 'fund-1', childId, amountPence: 200, status: 'approved', fundTransactionId: 'don-a' })
      await setDoc(doc(db, `families/${familyId}/petbox_requests/pet-b`), { familyId, fundId: 'fund-1', childId, amountPence: 500, status: 'approved', fundTransactionId: 'don-b' })
    })
    const db = testEnv.authenticatedContext(parentId).firestore()

    // +£2.00 (200p): -£3.88 → -£1.88
    let batch = writeBatch(db)
    batch.set(doc(db, `families/${familyId}/fund_transactions/don-a`), {
      familyId, fundId: 'fund-1', type: 'contribution', amount: 200, fromUserId: childId, sourceId: 'pet-a',
      actorId: parentId, createdAt: serverTimestamp(), status: 'completed',
      effectSnapshot: { schemaVersion: 1, entityType: 'petbox_donation', familyId, actorId: parentId, childId, fundId: 'fund-1', sourceRequestId: 'pet-a', fundDeltaPence: 200, walletDeltaPence: -200, xpAdjustment: 0 },
    })
    batch.update(doc(db, `families/${familyId}/funds/fund-1`), { balance: -388 + 200, lastFundTxId: 'don-a' })
    await assertSucceeds(batch.commit())
    expect((await getDoc(doc(db, `families/${familyId}/funds/fund-1`))).data()?.balance).toBe(-188)

    // +£5.00 (500p): -£1.88 → £3.12
    batch = writeBatch(db)
    batch.set(doc(db, `families/${familyId}/fund_transactions/don-b`), {
      familyId, fundId: 'fund-1', type: 'contribution', amount: 500, fromUserId: childId, sourceId: 'pet-b',
      actorId: parentId, createdAt: serverTimestamp(), status: 'completed',
      effectSnapshot: { schemaVersion: 1, entityType: 'petbox_donation', familyId, actorId: parentId, childId, fundId: 'fund-1', sourceRequestId: 'pet-b', fundDeltaPence: 500, walletDeltaPence: -500, xpAdjustment: 0 },
    })
    batch.update(doc(db, `families/${familyId}/funds/fund-1`), { balance: -188 + 500, lastFundTxId: 'don-b' })
    await assertSucceeds(batch.commit())
    expect((await getDoc(doc(db, `families/${familyId}/funds/fund-1`))).data()?.balance).toBe(312)
  })
})
