import type { DocumentData, Firestore } from 'firebase-admin/firestore'
import {
  BEHAVIOUR_PROCESSOR_VERSION,
  behaviourEventIdempotencyKey,
  behaviourGamificationEventId,
  planBehaviourAward,
  type BehaviourEventType,
} from './behaviourProcessor'
import { DEFAULT_WEEKLY_CONTEXT } from '../../src/domain/gamification/v3/weeklyWindow'
import { applyV3Shadow, BaselineMissingErrorV3, readV3ShadowState, type PreparedV3Shadow } from './gamificationV3/integration'
import { mapBehaviour } from './gamificationV3/sourceMappers/behaviourMapper'
import { requireLegacyRoute } from './gamification/routingShim'

export interface ProcessBehaviourEventArgs {
  readonly familyId: string
  readonly behaviourEventId: string
  readonly processingAt: number
}

export interface ProcessChallengeClaimArgs {
  readonly familyId: string
  readonly childId: string
  readonly challengeId: string
  /** Reward points granted to the child for this challenge (>= 0). */
  readonly points: number
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
    // Stage 7 pre-cutover routing: single authoritative route, fail-closed.
    await requireLegacyRoute('behaviour', args.familyId)
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

      // ---- V3 shadow READ PHASE ----
      // Firestore aborts the entire transaction when a read follows a write,
      // which would silently discard the authoritative rewardPoints/summary
      // writes below. All shadow reads therefore happen before the first write;
      // the shadow itself is applied afterwards via applyV3Shadow so it stays
      // atomic with the authoritative writes (Amendment 4).
      let preparedShadow: PreparedV3Shadow | undefined
      try {
        preparedShadow = await readV3ShadowState(transaction, (path) => this.db.doc(path), {
          familyId: args.familyId,
          memberId: childId,
          event: mapBehaviour({
            familyId: args.familyId,
            memberId: childId,
            behaviourEventId: args.behaviourEventId,
            type: type as 'positive' | 'negative' | 'financial',
            pointsDelta: plan.rewardPointsDelta,
            effectiveAt: new Date(plan.event.effectiveAt).toISOString(),
            createdAt: new Date(args.processingAt).toISOString(),
          }),
          weeklyContext: DEFAULT_WEEKLY_CONTEXT,
          asOf: new Date(args.processingAt).toISOString(),
        })
      } catch (error) {
        if (error instanceof BaselineMissingErrorV3) {
          console.warn('[gamification-v3-shadow-skipped]', JSON.stringify({
            familyId: args.familyId, memberId: childId, processor: 'processBehaviourEvent',
          }))
        } else {
          throw error
        }
      }

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
      // ---- V3 shadow WRITE PHASE ----
      // Pure write, no reads: atomic with the authoritative writes above.
      // Duplicate processing is idempotent — readV3ShadowState returns
      // undefined when the event already exists, and applyV3Shadow no-ops.
      applyV3Shadow(transaction, preparedShadow)
      return { status: 'processed' }
    })
  }

  /**
   * Server-authoritative Family Challenge reward distribution.
   *
   * Reuses the EXACT same award pipeline as `processBehaviourEvent` (the
   * existing authoritative gamification/write mechanism): `planBehaviourAward`
   * for the delta math, the same `users.rewardPoints` + `users.lifetimeXP`
   * compatibility mirror, the `gamification_summaries` projection, the
   * immutable `gamification_events` ledger, and the V3 shadow. No parallel
   * reward engine is introduced — this is the behaviour processor applied to a
   * challenge award with a deterministic, challenge-scoped event anchor.
   *
   * Idempotency: the award is anchored on a deterministic event id derived from
   * the challenge + child, so a retried claim (or a concurrent double-tap) can
   * never double-award a child. The caller (the challenge-claim callable) is
   * responsible for the challenge-level idempotency (closing the challenge).
   */
  async processChallengeClaim(args: ProcessChallengeClaimArgs): Promise<BehaviourProcessResult> {
    const familyRef = this.db.doc(`families/${args.familyId}`)
    // Deterministic, collision-free anchor for this challenge→child award.
    // Uses `__` (not `:`) because the V3 shadow event id validator rejects
    // ':', '/', and whitespace; `__` is also safe for the idempotency key and
    // is not present in real challenge/child ids, so it cannot collide.
    const syntheticId = `challenge_reward__${args.challengeId}__${args.childId}`
    const childRef = this.db.doc(`users/${args.childId}`)
    const summaryRef = familyRef.collection('gamification_summaries').doc(args.childId)
    return this.db.runTransaction(async transaction => {
      const [childDocument, summaryDocument] = await Promise.all([
        transaction.get(childRef), transaction.get(summaryRef),
      ])
      if (!childDocument.exists) return { status: 'ignored', reason: 'child_missing' }
      const child = childDocument.data() as DocumentData
      if (child.familyId !== args.familyId || child.role !== 'child'
        || child.status === 'deleted' || child.status === 'disabled' || child.disabled === true) {
        return { status: 'ignored', reason: 'child_not_active_in_family' }
      }

      const gamificationEventRef = familyRef.collection('gamification_events').doc(behaviourGamificationEventId(syntheticId))
      const existingEvent = await transaction.get(gamificationEventRef)
      const alreadyProcessed = existingEvent.exists
      if (existingEvent.exists) {
        const existing = existingEvent.data() as DocumentData
        const verified = existing.schemaVersion === 1
          && existing.familyId === args.familyId
          && existing.childId === args.childId
          && existing.sourceBehaviourEventId === syntheticId
          && existing.eventType === 'behaviour_positive'
          && existing.rewardPointsDelta === integer(args.points)
          && existing.xpDelta === integer(args.points)
          && existing.idempotencyKey === behaviourEventIdempotencyKey(args.familyId, args.childId, syntheticId)
        if (!verified) return { status: 'ignored', reason: 'challenge_reward_event_unverified' }
      }

      const summary = summaryDocument.exists ? summaryDocument.data() as DocumentData : undefined
      const plan = planBehaviourAward({
        familyId: args.familyId,
        childId: args.childId,
        behaviourEventId: syntheticId,
        type: 'positive',
        pointsDelta: integer(args.points),
        effectiveAt: args.processingAt,
        processingAt: args.processingAt,
        currentRewardPoints: integer(child.rewardPoints),
        currentXpTotal: integer(summary?.xpTotal),
        currentLifetimeXP: integer(child.lifetimeXP),
        alreadyProcessed,
      })
      if (plan.status === 'duplicate') return { status: 'duplicate' }

      // ---- V3 shadow READ PHASE ----
      // All shadow reads happen before the first write (Firestore aborts the
      // whole transaction if a read follows a write). Mirrors processBehaviourEvent.
      let preparedShadow: PreparedV3Shadow | undefined
      try {
        preparedShadow = await readV3ShadowState(transaction, (path) => this.db.doc(path), {
          familyId: args.familyId,
          memberId: args.childId,
          event: mapBehaviour({
            familyId: args.familyId,
            memberId: args.childId,
            behaviourEventId: syntheticId,
            type: 'positive',
            pointsDelta: plan.rewardPointsDelta,
            effectiveAt: new Date(plan.event.effectiveAt).toISOString(),
            createdAt: new Date(args.processingAt).toISOString(),
          }),
          weeklyContext: DEFAULT_WEEKLY_CONTEXT,
          asOf: new Date(args.processingAt).toISOString(),
        })
      } catch (error) {
        if (error instanceof BaselineMissingErrorV3) {
          console.warn('[gamification-v3-shadow-skipped]', JSON.stringify({
            familyId: args.familyId, memberId: args.childId, processor: 'processChallengeClaim',
          }))
        } else {
          throw error
        }
      }

      if (plan.rewardPointsDelta !== 0 || plan.xpDelta !== 0) {
        transaction.update(childRef, {
          rewardPoints: plan.nextRewardPoints,
          // Compatibility-only mirror; authoritative XP is summary.xpTotal.
          lifetimeXP: plan.nextLifetimeXP,
        })
      }
      transaction.set(summaryRef, {
        schemaVersion: 1,
        familyId: args.familyId,
        childId: args.childId,
        xpTotal: plan.nextXpTotal,
        level: plan.level,
        updatedAt: new Date(args.processingAt),
      }, { merge: true })
      transaction.create(gamificationEventRef, {
        ...plan.event,
        effectiveAt: new Date(plan.event.effectiveAt),
        createdAt: new Date(plan.event.createdAt),
      })
      // ---- V3 shadow WRITE PHASE ----
      // Pure write, no reads: atomic with the authoritative writes above.
      applyV3Shadow(transaction, preparedShadow)
      return { status: 'processed' }
    })
  }
}
