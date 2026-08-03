import type { DocumentData, Firestore } from 'firebase-admin/firestore'
import {
  BEHAVIOUR_PROCESSOR_VERSION,
  behaviourGamificationEventId,
  planBehaviourAward,
  type BehaviourEventType,
} from './behaviourProcessor'

export interface ProcessBehaviourEventArgs {
  readonly familyId: string
  readonly behaviourEventId: string
  readonly processingAt: number
}

export interface BehaviourProcessResult {
  readonly status: 'processed' | 'duplicate' | 'ignored'
  readonly reason?: string
}

function integer(value: unknown, fallback = 0): number {
  return Number.isSafeInteger(value) ? value as number : fallback
}

function behaviourType(value: unknown): BehaviourEventType | undefined {
  return value === 'positive' || value === 'negative' || value === 'financial' ? value : undefined
}

function millis(value: unknown, fallback: number): number {
  if (value instanceof Date) return value.getTime()
  if (value !== null && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as { toMillis(): number }).toMillis()
  }
  return fallback
}

/**
 * Server-authoritative behaviour award pipeline.
 *
 * The client only creates the behaviour event document; all reward/XP balances
 * are derived here inside a single transaction. `users.lifetimeXP` is written
 * only as a COMPATIBILITY MIRROR of `gamification_summaries.xpTotal` and must
 * never be treated as authoritative.
 */
export class AdminBehaviourRepository {
  constructor(private readonly db: Firestore) {}

  async processBehaviourEvent(args: ProcessBehaviourEventArgs): Promise<BehaviourProcessResult> {
    const familyRef = this.db.doc(`families/${args.familyId}`)
    const eventRef = familyRef.collection('behaviour_events').doc(args.behaviourEventId)
    return this.db.runTransaction(async transaction => {
      const behaviourDocument = await transaction.get(eventRef)
      if (!behaviourDocument.exists) return { status: 'ignored', reason: 'behaviour_event_missing' }
      const behaviour = behaviourDocument.data() as DocumentData
      const childId = typeof behaviour.childId === 'string' ? behaviour.childId : undefined
      const type = behaviourType(behaviour.type)
      if (childId === undefined || type === undefined) return { status: 'ignored', reason: 'behaviour_event_malformed' }

      const childRef = this.db.doc(`users/${childId}`)
      const summaryRef = familyRef.collection('gamification_summaries').doc(childId)
      const [childDocument, summaryDocument] = await Promise.all([
        transaction.get(childRef), transaction.get(summaryRef),
      ])
      if (!childDocument.exists) return { status: 'ignored', reason: 'child_missing' }
      const child = childDocument.data() as DocumentData
      if (child.familyId !== args.familyId || child.role !== 'child'
        || child.status === 'deleted' || child.status === 'disabled' || child.disabled === true) {
        return { status: 'ignored', reason: 'child_not_active_in_family' }
      }

      const gamificationEventRef = familyRef.collection('gamification_events').doc(behaviourGamificationEventId(args.behaviourEventId))
      const existingEvent = await transaction.get(gamificationEventRef)
      const alreadyProcessed = existingEvent.exists || behaviour.gamificationProcessedAt !== undefined

      const summary = summaryDocument.exists ? summaryDocument.data() as DocumentData : undefined
      const plan = planBehaviourAward({
        familyId: args.familyId,
        childId,
        behaviourEventId: args.behaviourEventId,
        type,
        pointsDelta: integer(behaviour.pointsDelta),
        effectiveAt: millis(behaviour.createdAt, args.processingAt),
        processingAt: args.processingAt,
        currentRewardPoints: integer(child.rewardPoints),
        currentXpTotal: integer(summary?.xpTotal),
        currentLifetimeXP: integer(child.lifetimeXP),
        alreadyProcessed,
      })
      if (plan.status === 'duplicate') return { status: 'duplicate' }

      if (plan.rewardPointsDelta !== 0 || plan.xpDelta !== 0) {
        transaction.update(childRef, {
          rewardPoints: plan.nextRewardPoints,
          // Compatibility-only mirror; authoritative XP is summary.xpTotal.
          lifetimeXP: plan.nextLifetimeXP,
          lastBehaviourEventId: args.behaviourEventId,
        })
      }
      transaction.set(summaryRef, {
        schemaVersion: 1,
        familyId: args.familyId,
        childId,
        xpTotal: plan.nextXpTotal,
        level: plan.level,
        updatedAt: new Date(args.processingAt),
      }, { merge: true })
      transaction.create(gamificationEventRef, {
        ...plan.event,
        effectiveAt: new Date(plan.event.effectiveAt),
        createdAt: new Date(plan.event.createdAt),
      })
      transaction.update(eventRef, {
        gamificationProcessedAt: new Date(args.processingAt),
        gamificationProcessorVersion: BEHAVIOUR_PROCESSOR_VERSION,
        gamificationEffectSnapshot: {
          schemaVersion: 1,
          entityType: 'behaviour_event',
          familyId: args.familyId,
          childId,
          rewardPointsDelta: plan.rewardPointsDelta,
          xpDelta: plan.xpDelta,
          xpTotalAfter: plan.nextXpTotal,
          rewardPointsAfter: plan.nextRewardPoints,
          level: plan.level,
        },
      })
      return { status: 'processed' }
    })
  }
}
