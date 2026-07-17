import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore'
import { readFileSync } from 'fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildReversalPayloads } from '../../src/lib/reversalPayloads'
import { effectSnapshot, type EffectSnapshot } from '../../src/lib/reversalContracts'
import { reversalRecordId } from '../../src/lib/reversalDomain'

let testEnv: any
const familyId = 'reversal-family'
const parentId = 'parent-1'
const ownerId = 'owner-1'
const childId = 'child-1'
const child2Id = 'child-2'

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'familyquest-reversal-rules',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
})

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (context: any) => {
    const db = context.firestore()
    await setDoc(doc(db, `families/${familyId}`), { debtLimitPence: -500 })
    await setDoc(doc(db, 'users', parentId), { familyId, role: 'parent', displayName: 'Parent' })
    await setDoc(doc(db, 'users', ownerId), { familyId, role: 'owner', displayName: 'Owner' })
    await setDoc(doc(db, 'users', childId), { familyId, role: 'child', displayName: 'Ada', rewardPoints: 100, lifetimeXP: 500 })
    await setDoc(doc(db, 'users', child2Id), { familyId, role: 'child', displayName: 'Ben', rewardPoints: 100, lifetimeXP: 500 })
    await setDoc(doc(db, 'users', 'other-parent'), { familyId: 'other-family', role: 'parent', displayName: 'Other' })
    await setDoc(doc(db, `families/${familyId}/wallets/${childId}`), { balance: 500, createdAt: new Date(), migratedFromLegacy: true })
    await setDoc(doc(db, `families/${familyId}/wallets/${child2Id}`), { balance: 200, createdAt: new Date(), migratedFromLegacy: true })
    await setDoc(doc(db, `families/${familyId}/funds/fund-1`), { balance: 700 })
  })
})

afterAll(async () => testEnv.cleanup())

async function seedSource(collectionName: string, sourceId: string, snapshot?: EffectSnapshot) {
  await testEnv.withSecurityRulesDisabled(async (context: any) => {
    await setDoc(doc(context.firestore(), `families/${familyId}/${collectionName}/${sourceId}`), snapshot ? { effectSnapshot: snapshot } : { type: 'legacy' })
  })
}

function walletReversalBatch(actorId: string, sourceId: string, original: EffectSnapshot, overrides: Record<string, any> = {}) {
  const db = testEnv.authenticatedContext(actorId).firestore()
  const reversalId = reversalRecordId('wallet_transaction', sourceId)
  const inverse = effectSnapshot({ entityType: 'reversal', familyId, actorId, childId, walletDeltaPence: -(original.walletDeltaPence || 0) })
  const payloads = buildReversalPayloads({ familyId, sourceKind: 'wallet_transaction', sourceId, reversalId, actorId, actorName: actorId === ownerId ? 'Owner' : 'Parent', reason: 'Duplicate', original, inverse, timestamp: serverTimestamp() })
  const batch = writeBatch(db)
  batch.update(doc(db, `families/${familyId}/wallets/${childId}`), { balance: 500 + inverse.walletDeltaPence!, lastReversalId: reversalId })
  batch.set(doc(db, `families/${familyId}/wallet_transactions/${reversalId}__wallet`), { ...payloads.wallet(childId, inverse.walletDeltaPence!), ...(overrides.ledger || {}) })
  batch.set(doc(db, `families/${familyId}/reversal_events/${reversalId}`), { ...payloads.event, ...(overrides.event || {}) })
  batch.set(doc(db, `families/${familyId}/reversals/${reversalId}`), { ...payloads.record, ...(overrides.record || {}) })
  return { db, batch, reversalId }
}

const sourceCollections: Record<string, string> = {
  wallet_transaction: 'wallet_transactions', fund_transaction: 'fund_transactions', behaviour_event: 'behaviour_events',
  task_completion: 'task_completions', reward_redemption: 'redemptions', transfer_request: 'transfer_requests',
  money_request: 'money_requests', petbox_request: 'petbox_requests',
}

function inverseFor(original: EffectSnapshot, actorId: string) {
  return effectSnapshot({
    entityType: 'reversal', familyId, actorId,
    ...(original.childId ? { childId: original.childId } : {}),
    ...(original.counterpartyChildId ? { counterpartyChildId: original.counterpartyChildId } : {}),
    ...(original.fundId ? { fundId: original.fundId } : {}),
    ...(original.walletDeltaPence !== undefined ? { walletDeltaPence: -original.walletDeltaPence } : {}),
    ...(original.counterpartyWalletDeltaPence !== undefined ? { counterpartyWalletDeltaPence: -original.counterpartyWalletDeltaPence } : {}),
    ...(original.fundDeltaPence !== undefined ? { fundDeltaPence: -original.fundDeltaPence } : {}),
    ...(original.pointsDelta !== undefined ? { pointsDelta: -original.pointsDelta } : {}),
  })
}

function fullReversalBatch(actorId: string, sourceKind: string, sourceId: string, original: EffectSnapshot, overrides: Record<string, any> = {}, startingFundBalance: number = 700) {
  const db = testEnv.authenticatedContext(actorId).firestore()
  const reversalId = reversalRecordId(sourceKind, sourceId)
  const inverse = inverseFor(original, actorId)
  const actorName = actorId === ownerId ? 'Owner' : actorId === parentId ? 'Parent' : actorId === childId ? 'Ada' : 'Other'
  const payloads = buildReversalPayloads({ familyId, sourceKind, sourceId, reversalId, actorId, actorName, reason: 'Correct mistake', original, inverse, timestamp: serverTimestamp() })
  const batch = writeBatch(db)
  if (inverse.walletDeltaPence !== undefined) {
    batch.update(doc(db, `families/${familyId}/wallets/${original.childId}`), { balance: 500 + inverse.walletDeltaPence, lastReversalId: reversalId })
    batch.set(doc(db, `families/${familyId}/wallet_transactions/${reversalId}__wallet`), { ...payloads.wallet(original.childId!, inverse.walletDeltaPence), ...(overrides.wallet || {}) })
  }
  if (inverse.counterpartyWalletDeltaPence !== undefined) {
    batch.update(doc(db, `families/${familyId}/wallets/${original.counterpartyChildId}`), { balance: 200 + inverse.counterpartyWalletDeltaPence, lastReversalId: reversalId })
    batch.set(doc(db, `families/${familyId}/wallet_transactions/${reversalId}__counterparty`), { ...payloads.wallet(original.counterpartyChildId!, inverse.counterpartyWalletDeltaPence), ...(overrides.counterparty || {}) })
  }
  if (inverse.fundDeltaPence !== undefined) {
    batch.update(doc(db, `families/${familyId}/funds/${original.fundId}`), { balance: startingFundBalance + inverse.fundDeltaPence, lastReversalId: reversalId })
    batch.set(doc(db, `families/${familyId}/fund_transactions/${reversalId}__fund`), { ...payloads.fund(original.fundId!, inverse.fundDeltaPence), ...(overrides.fund || {}) })
  }
  if (inverse.pointsDelta !== undefined) {
    batch.update(doc(db, 'users', original.childId!), { rewardPoints: 100 + inverse.pointsDelta, lastReversalId: reversalId })
  }
  batch.set(doc(db, `families/${familyId}/reversal_events/${reversalId}`), { ...payloads.event, ...(overrides.event || {}) })
  batch.set(doc(db, `families/${familyId}/reversals/${reversalId}`), { ...payloads.record, ...(overrides.record || {}) })
  return { db, batch, reversalId, inverse }
}

describe('reversal security rules', () => {
  it.each([[parentId], [ownerId]])('%s atomically reverses a traceable wallet effect', async actorId => {
    const original = effectSnapshot({ entityType: 'wallet_transaction', familyId, actorId: parentId, childId, walletDeltaPence: 300 })
    await seedSource('wallet_transactions', 'deposit-1', original)
    const { db, batch, reversalId } = walletReversalBatch(actorId, 'deposit-1', original)
    await assertSucceeds(batch.commit())
    expect((await getDoc(doc(db, `families/${familyId}/wallets/${childId}`))).data()?.balance).toBe(200)
    await assertFails(updateDoc(doc(db, `families/${familyId}/reversals/${reversalId}`), { reason: 'changed' }))
  })

  it('denies a child reversal', async () => {
    const original = effectSnapshot({ entityType: 'wallet_transaction', familyId, actorId: parentId, childId, walletDeltaPence: 300 })
    await seedSource('wallet_transactions', 'deposit-1', original)
    await assertFails(walletReversalBatch(childId, 'deposit-1', original).batch.commit())
  })

  const sourceCases: Array<[string, EffectSnapshot]> = [
    ['wallet_transaction', effectSnapshot({ entityType: 'wallet_transaction', familyId, actorId: parentId, childId, walletDeltaPence: 300 })],
    ['fund_transaction', effectSnapshot({ entityType: 'fund_transaction', familyId, actorId: parentId, fundId: 'fund-1', fundDeltaPence: 200 })],
    ['behaviour_event', effectSnapshot({ entityType: 'behaviour_event', familyId, actorId: parentId, childId, pointsDelta: -10 })],
    ['task_completion', effectSnapshot({ entityType: 'task_completion', familyId, actorId: parentId, childId, pointsDelta: 20 })],
    ['reward_redemption', effectSnapshot({ entityType: 'reward_redemption', familyId, actorId: childId, childId, pointsDelta: -25 })],
    ['transfer_request', effectSnapshot({ entityType: 'transfer_request', familyId, actorId: parentId, childId, counterpartyChildId: child2Id, walletDeltaPence: -100, counterpartyWalletDeltaPence: 100 })],
    ['money_request', effectSnapshot({ entityType: 'money_request', familyId, actorId: parentId, childId, walletDeltaPence: 100 })],
    ['petbox_request', effectSnapshot({ entityType: 'petbox_donation', familyId, actorId: parentId, childId, fundId: 'fund-1', walletDeltaPence: -100, fundDeltaPence: 100 })],
  ]

  it.each(sourceCases)('accepts exact production payloads for %s', async (kind, original) => {
    await seedSource(sourceCollections[kind], `${kind}-source`, original)
    await assertSucceeds(fullReversalBatch(parentId, kind, `${kind}-source`, original).batch.commit())
  })

  it.each([
    ['forged actor', { record: { actorId: ownerId } }],
    ['forged actor name', { record: { actorName: 'Forged' } }],
    ['altered inverse amount', { wallet: { amountPence: -299 } }],
    ['extra ledger field', { wallet: { unexpected: true } }],
    ['past timestamp', { event: { createdAt: new Date(1) } }],
    ['wrong linked source', { record: { sourceId: 'different' } }],
  ])('denies %s', async (_label, overrides) => {
    const original = effectSnapshot({ entityType: 'wallet_transaction', familyId, actorId: parentId, childId, walletDeltaPence: 300 })
    await seedSource('wallet_transactions', 'strict-source', original)
    await assertFails(fullReversalBatch(parentId, 'wallet_transaction', 'strict-source', original, overrides).batch.commit())
  })

  it('denies wrong-family parents and legacy sources', async () => {
    const original = effectSnapshot({ entityType: 'wallet_transaction', familyId, actorId: parentId, childId, walletDeltaPence: 300 })
    await seedSource('wallet_transactions', 'strict-source', original)
    await assertFails(fullReversalBatch('other-parent', 'wallet_transaction', 'strict-source', original).batch.commit())
    await seedSource('wallet_transactions', 'legacy-source')
    await assertFails(fullReversalBatch(parentId, 'wallet_transaction', 'legacy-source', original).batch.commit())
  })

  it('denies duplicate reversal records and keeps ledgers immutable', async () => {
    const original = effectSnapshot({ entityType: 'wallet_transaction', familyId, actorId: parentId, childId, walletDeltaPence: 300 })
    await seedSource('wallet_transactions', 'duplicate-source', original)
    const first = fullReversalBatch(parentId, 'wallet_transaction', 'duplicate-source', original)
    await assertSucceeds(first.batch.commit())
    await assertFails(fullReversalBatch(parentId, 'wallet_transaction', 'duplicate-source', original).batch.commit())
    await assertFails(updateDoc(doc(first.db, `families/${familyId}/wallet_transactions/${first.reversalId}__wallet`), { amountPence: 1 }))
    await assertFails(updateDoc(doc(first.db, `families/${familyId}/reversal_events/${first.reversalId}`), { reason: 'changed' }))
  })

  it('enforces the wallet debt limit on reversals', async () => {
    const wallet = effectSnapshot({ entityType: 'wallet_transaction', familyId, actorId: parentId, childId, walletDeltaPence: 1100 })
    await seedSource('wallet_transactions', 'debt-source', wallet)
    await assertFails(fullReversalBatch(parentId, 'wallet_transaction', 'debt-source', wallet).batch.commit())
  })

  it('allows a fund reversal that drives the balance negative (negative balances permitted)', async () => {
    const fund = effectSnapshot({ entityType: 'fund_transaction', familyId, actorId: parentId, fundId: 'fund-1', fundDeltaPence: 800 })
    await seedSource('fund_transactions', 'fund-source', fund)
    // Fund balance is 700, inverse fundDeltaPence = -800 → balance would be -100 (allowed).
    await assertSucceeds(fullReversalBatch(parentId, 'fund_transaction', 'fund-source', fund).batch.commit())
  })

  it('14. allows an expense refund that increases a negative fund balance', async () => {
    // Pre-set the fund to a negative balance (-£3.88) before refunding a £2.00 expense.
    await testEnv.withSecurityRulesDisabled(async (context: any) => {
      await setDoc(doc(context.firestore(), `families/${familyId}/funds/fund-1`), { balance: -388 })
    })
    const original = effectSnapshot({ entityType: 'fund_transaction', familyId, actorId: parentId, fundId: 'fund-1', fundDeltaPence: -200 })
    await seedSource('fund_transactions', 'neg-fund-source', original)
    const { db, batch } = fullReversalBatch(parentId, 'fund_transaction', 'neg-fund-source', original, {}, -388)
    await assertSucceeds(batch.commit())
    expect((await getDoc(doc(db, `families/${familyId}/funds/fund-1`))).data()?.balance).toBe(-188)
  })

  it('accepts petbox_request reversal (donation refund) from parent/owner', async () => {
    // Petbox donation: child wallet -200, fund +200
    const original = effectSnapshot({ entityType: 'petbox_donation', familyId, actorId: parentId, childId, fundId: 'fund-1', walletDeltaPence: -200, fundDeltaPence: 200 })
    await seedSource('petbox_requests', 'petbox-source', original)
    // Fund starts at 700 (set in beforeEach) — enough to return 200
    await assertSucceeds(fullReversalBatch(parentId, 'petbox_request', 'petbox-source', original).batch.commit())
  })

  it('allows a petbox_request refund even when it drives the fund negative', async () => {
    // Donation of 800 — fund only has 700, so returning 800 drives the balance to -100.
    const original = effectSnapshot({ entityType: 'petbox_donation', familyId, actorId: parentId, childId, fundId: 'fund-1', walletDeltaPence: -800, fundDeltaPence: 800 })
    await seedSource('petbox_requests', 'petbox-debt-source', original)
    // Negative resulting balances are permitted, so the refund succeeds.
    await assertSucceeds(fullReversalBatch(parentId, 'petbox_request', 'petbox-debt-source', original).batch.commit())
  })

  it('denies petbox_request refund from a child', async () => {
    const original = effectSnapshot({ entityType: 'petbox_donation', familyId, actorId: parentId, childId, fundId: 'fund-1', walletDeltaPence: -200, fundDeltaPence: 200 })
    await seedSource('petbox_requests', 'petbox-child-source', original)
    await assertFails(fullReversalBatch(childId, 'petbox_request', 'petbox-child-source', original).batch.commit())
  })
})
