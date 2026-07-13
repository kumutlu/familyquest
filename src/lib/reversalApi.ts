import { doc, runTransaction, serverTimestamp } from 'firebase/firestore'
import { auth, db } from './firebase'
import { assertTraceableSource, effectSnapshot, type EffectSnapshot } from './reversalContracts'
import { planReversal, reversalRecordId } from './reversalDomain'

export type ReversalSourceKind =
  | 'wallet_transaction' | 'fund_transaction' | 'behaviour_event' | 'task_completion'
  | 'reward_redemption' | 'transfer_request' | 'money_request' | 'petbox_request'

const sourceCollections: Record<ReversalSourceKind, string> = {
  wallet_transaction: 'wallet_transactions',
  fund_transaction: 'fund_transactions',
  behaviour_event: 'behaviour_events',
  task_completion: 'task_completions',
  reward_redemption: 'redemptions',
  transfer_request: 'transfer_requests',
  money_request: 'money_requests',
  petbox_request: 'petbox_requests',
}

export function sourceCollectionFor(kind: string): string {
  const collectionName = sourceCollections[kind as ReversalSourceKind]
  if (!collectionName) throw new Error(`Unsupported reversal source kind: ${kind}`)
  return collectionName
}

export interface ReverseTransactionInput {
  familyId: string
  sourceKind: ReversalSourceKind
  sourceId: string
  reason: string
}

export interface ReverseTransactionResult {
  reversalId: string
  status: 'completed' | 'already_reversed'
}

function inverseSnapshot(source: EffectSnapshot, actorId: string, plan: ReturnType<typeof planReversal>): EffectSnapshot {
  return effectSnapshot({
    entityType: 'reversal', familyId: source.familyId, actorId,
    ...(source.childId ? { childId: source.childId } : {}),
    ...(source.counterpartyChildId ? { counterpartyChildId: source.counterpartyChildId } : {}),
    ...(source.fundId ? { fundId: source.fundId } : {}),
    ...(plan.inverseWalletDeltaPence !== undefined ? { walletDeltaPence: plan.inverseWalletDeltaPence } : {}),
    ...(plan.inverseCounterpartyWalletDeltaPence !== undefined ? { counterpartyWalletDeltaPence: plan.inverseCounterpartyWalletDeltaPence } : {}),
    ...(plan.inverseFundDeltaPence !== undefined ? { fundDeltaPence: plan.inverseFundDeltaPence } : {}),
    ...(plan.inversePointsDelta !== undefined ? { pointsDelta: plan.inversePointsDelta } : {}),
  })
}

export async function reverseTransaction(input: ReverseTransactionInput): Promise<ReverseTransactionResult> {
  const actorId = auth.currentUser?.uid
  if (!actorId) throw new Error('Not authenticated')
  const reason = input.reason.trim()
  if (!reason) throw new Error('Reversal reason is required')

  const reversalId = reversalRecordId(input.sourceKind, input.sourceId)
  const familyRef = doc(db, 'families', input.familyId)
  const actorRef = doc(db, 'users', actorId)
  const sourceRef = doc(db, `families/${input.familyId}/${sourceCollectionFor(input.sourceKind)}`, input.sourceId)
  const reversalRef = doc(db, `families/${input.familyId}/reversals`, reversalId)

  return runTransaction(db, async (transaction) => {
    const [actorDoc, familyDoc, sourceDoc, existingReversal] = await Promise.all([
      transaction.get(actorRef), transaction.get(familyRef), transaction.get(sourceRef), transaction.get(reversalRef),
    ])
    if (!actorDoc.exists() || actorDoc.data().familyId !== input.familyId || !['parent', 'owner'].includes(actorDoc.data().role)) {
      throw new Error('Only a parent or owner in this family can reverse transactions')
    }
    if (existingReversal.exists()) return { reversalId, status: 'already_reversed' as const }
    if (!familyDoc.exists()) throw new Error('Family not found')
    if (!sourceDoc.exists()) throw new Error('Reversal source not found')

    const source = assertTraceableSource(sourceDoc.data())
    const snapshot = source.effectSnapshot
    if (snapshot.familyId !== input.familyId || snapshot.schemaVersion !== 1 || snapshot.xpAdjustment !== 0) {
      throw new Error('Invalid effectSnapshot for this family')
    }

    const childWalletRef = snapshot.childId && snapshot.walletDeltaPence !== undefined
      ? doc(db, `families/${input.familyId}/wallets`, snapshot.childId) : null
    const counterpartyWalletRef = snapshot.counterpartyChildId && snapshot.counterpartyWalletDeltaPence !== undefined
      ? doc(db, `families/${input.familyId}/wallets`, snapshot.counterpartyChildId) : null
    const fundRef = snapshot.fundId && snapshot.fundDeltaPence !== undefined
      ? doc(db, `families/${input.familyId}/funds`, snapshot.fundId) : null
    const pointsUserRef = snapshot.childId && snapshot.pointsDelta !== undefined ? doc(db, 'users', snapshot.childId) : null

    const [childWalletDoc, counterpartyWalletDoc, fundDoc, pointsUserDoc] = await Promise.all([
      childWalletRef ? transaction.get(childWalletRef) : null,
      counterpartyWalletRef ? transaction.get(counterpartyWalletRef) : null,
      fundRef ? transaction.get(fundRef) : null,
      pointsUserRef ? transaction.get(pointsUserRef) : null,
    ])

    const plan = planReversal(snapshot, {
      childWalletPence: childWalletDoc?.exists() ? childWalletDoc.data().balance : undefined,
      counterpartyWalletPence: counterpartyWalletDoc?.exists() ? counterpartyWalletDoc.data().balance : undefined,
      fundPence: fundDoc?.exists() ? fundDoc.data().balance : undefined,
      points: pointsUserDoc?.exists() ? pointsUserDoc.data().rewardPoints : undefined,
    }, familyDoc.data().debtLimitPence ?? -5000)
    const inverse = inverseSnapshot(snapshot, actorId, plan)

    if (childWalletRef) transaction.update(childWalletRef, { balance: plan.childWalletPence, lastReversalId: reversalId })
    if (counterpartyWalletRef) transaction.update(counterpartyWalletRef, { balance: plan.counterpartyWalletPence, lastReversalId: reversalId })
    if (fundRef) transaction.update(fundRef, { balance: plan.fundPence, lastReversalId: reversalId })
    if (pointsUserRef) transaction.update(pointsUserRef, { rewardPoints: plan.points })

    if (plan.inverseWalletDeltaPence !== undefined) {
      transaction.set(doc(db, `families/${input.familyId}/wallet_transactions`, `${reversalId}__wallet`), {
        type: 'reversal', familyId: input.familyId, childId: snapshot.childId, amountPence: plan.inverseWalletDeltaPence,
        sourceKind: input.sourceKind, sourceId: input.sourceId, reversalId, actorId, effectSnapshot: inverse, createdAt: serverTimestamp(),
      })
    }
    if (plan.inverseCounterpartyWalletDeltaPence !== undefined) {
      transaction.set(doc(db, `families/${input.familyId}/wallet_transactions`, `${reversalId}__counterparty`), {
        type: 'reversal', familyId: input.familyId, childId: snapshot.counterpartyChildId, amountPence: plan.inverseCounterpartyWalletDeltaPence,
        sourceKind: input.sourceKind, sourceId: input.sourceId, reversalId, actorId, effectSnapshot: inverse, createdAt: serverTimestamp(),
      })
    }
    if (plan.inverseFundDeltaPence !== undefined) {
      transaction.set(doc(db, `families/${input.familyId}/fund_transactions`, `${reversalId}__fund`), {
        type: 'reversal', familyId: input.familyId, fundId: snapshot.fundId, amount: plan.inverseFundDeltaPence,
        sourceKind: input.sourceKind, sourceId: input.sourceId, reversalId, actorId, effectSnapshot: inverse, createdAt: serverTimestamp(),
      })
    }

    transaction.set(doc(db, `families/${input.familyId}/reversal_events`, reversalId), {
      reversalId, sourceKind: input.sourceKind, sourceId: input.sourceId, actorId, reason,
      effectSnapshot: inverse, xpAdjustment: 0, xpReversed: false, createdAt: serverTimestamp(),
    })
    transaction.set(reversalRef, {
      reversalId, familyId: input.familyId, sourceKind: input.sourceKind, sourceId: input.sourceId,
      actorId, reason, status: 'completed', originalEffectSnapshot: snapshot, inverseEffectSnapshot: inverse,
      xpAdjustment: 0, xpReversed: false, completedAt: serverTimestamp(),
    })
    return { reversalId, status: 'completed' as const }
  })
}
