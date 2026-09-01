/**
 * Engagement wiring — Mystery Drops + Comeback Missions (V1).
 *
 * Minimal integration with `processApprovedCompletion`. This module is
 * the ONLY place that knows how to translate the family's stored
 * `events` documents into Mystery Drop definitions, and how to derive
 * the Comeback tier from existing child user state.
 *
 * Failure mode: every call site here is wrapped in try/catch so an
 * evaluator failure can NEVER block the base task approval (mirrors
 * the existing Surge contract).
 */
import type { Firestore, Transaction } from 'firebase-admin/firestore'

import { familyLocalDateKey, type ComebackTier } from '../../../src/domain/comeback/types'
import { evaluateAndAwardComeback } from '../comeback/evaluator'
import { comebackEventId, comebackEvidenceId } from '../../../src/domain/comeback/eligibility'
import {
  evaluateAndAwardMysteryDrop,
  mysteryDropEventId,
  mysteryDropInventoryItemId,
  type MysteryDropDefinition,
  type MysteryDropTransactionLike,
} from '../mysteryDrop/evaluator'

export interface EngagementWireContext {
  readonly familyId: string
  readonly childId: string
  readonly taskId: string
  readonly completionId: string
  readonly completedAt: number
  readonly requiresApproval: boolean
  readonly timezone: string
  readonly now: number
  readonly alreadyInvalid: boolean
}

export interface EngagementWireResult {
  readonly mysteryDropXpAwarded: number
  readonly comebackXpAwarded: number
}

interface DocumentLike {
  readonly id: string
  data(): Record<string, unknown> | undefined
}

/**
 * Run the Mystery Drop + Comeback evaluators inside an existing
 * transaction. Mirrors the existing Surge wire-up: any failure is
 * logged and absorbed so the base task approval still succeeds.
 */
export async function runEngagementBonuses(
  db: Firestore,
  transaction: Transaction,
  context: EngagementWireContext,
): Promise<EngagementWireResult> {
  const mysteryDropXp = await runMysteryDrop(db, transaction, context)
  const comebackXp = await runComeback(db, transaction, context)
  return { mysteryDropXpAwarded: mysteryDropXp, comebackXpAwarded: comebackXp }
}

async function runMysteryDrop(
  db: Firestore,
  transaction: Transaction,
  context: EngagementWireContext,
): Promise<number> {
  try {
    const eventsQuery = db.collection(`families/${context.familyId}/events`)
        .where('type', '==', 'mystery_drop')
        .where('status', '==', 'active')
    const eventsSnapshot = await transaction.get(eventsQuery)
    const drops = readMysteryDropDefinitions((eventsSnapshot as { docs: readonly DocumentLike[] }).docs)
    if (drops.length === 0) return 0

    const results = await evaluateAndAwardMysteryDrop(transaction as unknown as MysteryDropTransactionLike, {
      familyId: context.familyId,
      childId: context.childId,
      catalog: { familyId: context.familyId, drops },
      completion: {
        id: context.completionId,
        childId: context.childId,
        taskId: context.taskId,
        completedAt: context.completedAt,
        requiresApproval: context.requiresApproval,
      },
      now: context.now,
      mysteryDropEventRef: (dropId, childId) => ({
        id: `families/${context.familyId}/gamification_events/${mysteryDropEventId(dropId, childId)}`,
      }),
      mysteryDropEvidenceRef: (dropId, childId) => ({
        id: `families/${context.familyId}/mystery_drop_evidence/${dropId}__${childId}`,
      }),
      inventoryItemRef: (itemId, childId) => ({
        id: `users/${childId}/inventory/${mysteryDropInventoryItemId(itemId, childId)}`,
      }),
    })

    let total = 0
    for (const r of results) {
      if (r.status === 'awarded' && !context.alreadyInvalid && r.reward.type === 'xp_bonus') {
        total += r.reward.amount
      }
    }
    return total
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[mystery-drop-evaluator-skipped]', JSON.stringify({
      familyId: context.familyId, childId: context.childId, taskId: context.taskId,
      error: (error as Error).message,
    }))
    return 0
  }
}

async function runComeback(
  db: Firestore,
  transaction: Transaction,
  context: EngagementWireContext,
): Promise<number> {
  try {
    const childRef = db.doc(`users/${context.childId}`)
    const childDoc = await transaction.get(childRef)
    const childData = (childDoc.data() ?? {}) as Record<string, unknown>
    const lastMeaningfulActivityAt = typeof childData.lastTaskCompletionApprovedAt === 'number'
      ? childData.lastTaskCompletionApprovedAt
      : null

    const evidenceCollection = db.collection(`families/${context.familyId}/comeback_evidence`)
    const evidenceSnapshot = await transaction.get(evidenceCollection)
    const localDate = familyLocalDateKey(context.now, context.timezone)
    const alreadyCompletedTiers: ComebackTier[] = []
    for (const doc of (evidenceSnapshot as { docs: readonly DocumentLike[] }).docs) {
      const data = (doc.data() ?? {}) as Record<string, unknown>
      if (data.childId === context.childId && data.localDate === localDate) {
        const tier = data.tier
        if (tier === 'return_1d' || tier === 'return_3d' || tier === 'return_7d') {
          alreadyCompletedTiers.push(tier)
        }
      }
    }

    const result = await evaluateAndAwardComeback(transaction as unknown as MysteryDropTransactionLike, {
      familyId: context.familyId,
      childId: context.childId,
      timezone: context.timezone,
      now: context.now,
      lastMeaningfulActivityAt,
      alreadyCompletedTiersForDate: alreadyCompletedTiers,
      comebackEventRef: (childId, ld, tier) => ({
        id: `families/${context.familyId}/gamification_events/${comebackEventId(childId, ld, tier)}`,
      }),
      comebackEvidenceRef: (childId, ld, tier) => ({
        id: `families/${context.familyId}/comeback_evidence/${comebackEvidenceId(childId, ld, tier)}`,
      }),
      completionId: context.completionId,
      completionCompletedAt: context.completedAt,
    })
    if (result.status === 'awarded' && !context.alreadyInvalid) {
      return result.xpDelta
    }
    return 0
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[comeback-evaluator-skipped]', JSON.stringify({
      familyId: context.familyId, childId: context.childId, taskId: context.taskId,
      error: (error as Error).message,
    }))
    return 0
  }
}

/**
 * Parse stored `EventDefinition` documents (V1 rides the existing Event
 * Engine for date windows) into MysteryDropDefinition. Defensive: any
 * missing / malformed field is silently skipped — the rest of the
 * pipeline (the resolver's `invalid_definition` branch) handles
 * rejections.
 */
function readMysteryDropDefinitions(docs: readonly DocumentLike[]): MysteryDropDefinition[] {
  const out: MysteryDropDefinition[] = []
  for (const doc of docs) {
    const data = doc.data() ?? {}
    if (data.type !== 'mystery_drop' || data.status !== 'active') continue
    const md = (data.metadata as Record<string, unknown> ?? {}).mysteryDrop
    if (!md || typeof md !== 'object') continue
    const o = md as Record<string, unknown>
    if (
      typeof o.id !== 'string' || typeof o.version !== 'number' ||
      typeof o.startsAt !== 'number' || typeof o.endsAt !== 'number' ||
      typeof o.reward !== 'object' || o.reward === null ||
      typeof o.unlockCondition !== 'object' || o.unlockCondition === null ||
      typeof o.eligibility !== 'object' || o.eligibility === null ||
      typeof o.presentation !== 'object' || o.presentation === null
    ) {
      continue
    }
    out.push({
      id: o.id,
      version: o.version,
      startsAt: o.startsAt,
      endsAt: o.endsAt,
      eligibility: o.eligibility as MysteryDropDefinition['eligibility'],
      unlockCondition: o.unlockCondition as MysteryDropDefinition['unlockCondition'],
      reward: o.reward as MysteryDropDefinition['reward'],
      presentation: o.presentation as MysteryDropDefinition['presentation'],
    })
  }
  return out
}