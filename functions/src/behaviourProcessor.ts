import { GAMIFICATION_CONFIG_V1 } from '../../src/domain/gamification/config'
import { levelProgressForXp, type LevelProgress } from '../../src/domain/gamification/level'

/**
 * Server-authoritative behaviour award semantics (approved product rule):
 *
 * - Positive behaviour: rewardPointsDelta = +pointsDelta, xpDelta = +pointsDelta.
 * - Negative behaviour: rewardPointsDelta = negative pointsDelta, xpDelta = 0.
 * - Financial behaviour: neither points nor XP change (wallet only).
 *
 * Lifetime XP must never decrease. `users.lifetimeXP` remains only as a
 * compatibility mirror written inside the same server transaction; the
 * authoritative XP balance is `gamification_summaries.xpTotal`.
 */
export const BEHAVIOUR_PROCESSOR_VERSION = 'behaviour-processor-v1'

export type BehaviourEventType = 'positive' | 'negative' | 'financial'

export interface BehaviourAwardInput {
  readonly familyId: string
  readonly childId: string
  readonly behaviourEventId: string
  readonly type: BehaviourEventType
  readonly pointsDelta: number
  readonly effectiveAt: number
  readonly processingAt: number
  readonly currentRewardPoints: number
  readonly currentXpTotal: number
  readonly currentLifetimeXP: number
  readonly alreadyProcessed?: boolean
  readonly xpPerLevel?: number
}

export interface BehaviourGamificationEvent {
  readonly schemaVersion: 1
  readonly familyId: string
  readonly childId: string
  readonly memberId: string
  readonly sourceBehaviourEventId: string
  readonly eventType: 'behaviour_positive' | 'behaviour_negative' | 'behaviour_financial'
  readonly rewardPointsDelta: number
  readonly xpDelta: number
  readonly effectiveAt: number
  readonly createdAt: number
  readonly processorVersion: string
  readonly idempotencyKey: string
}

export interface BehaviourAwardPlan {
  readonly status: 'planned' | 'duplicate'
  readonly rewardPointsDelta: number
  readonly xpDelta: number
  readonly nextRewardPoints: number
  readonly nextXpTotal: number
  readonly nextLifetimeXP: number
  readonly level: number
  readonly progress: Readonly<LevelProgress>
  readonly eventId: string
  readonly event: BehaviourGamificationEvent
}

/** Deterministic, collision-free identity for one behaviour award. */
export function behaviourEventIdempotencyKey(familyId: string, childId: string, behaviourEventId: string): string {
  for (const [label, value] of [['familyId', familyId], ['childId', childId], ['behaviourEventId', behaviourEventId]] as const) {
    if (value.length === 0 || value.includes('|') || value.includes('/')) {
      throw new Error(`${label} must be a non-empty Firestore identity`)
    }
  }
  return `behaviour_event_v1|${familyId}|${childId}|${behaviourEventId}`
}

export function behaviourGamificationEventId(behaviourEventId: string): string {
  return `behaviour_xp:${encodeURIComponent(behaviourEventId)}`
}

function assertBalance(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`)
}

export function planBehaviourAward(input: BehaviourAwardInput): BehaviourAwardPlan {
  const idempotencyKey = behaviourEventIdempotencyKey(input.familyId, input.childId, input.behaviourEventId)
  assertBalance(input.currentRewardPoints, 'rewardPoints')
  assertBalance(input.currentXpTotal, 'xpTotal')
  assertBalance(input.currentLifetimeXP, 'lifetimeXP')
  if (!Number.isSafeInteger(input.pointsDelta)) throw new Error('pointsDelta must be a safe integer')
  if (input.type === 'positive' && input.pointsDelta < 0) throw new Error('A positive behaviour requires a non-negative pointsDelta')
  if (input.type === 'negative' && input.pointsDelta > 0) throw new Error('A negative behaviour requires a non-positive pointsDelta')
  if (input.type === 'financial' && input.pointsDelta !== 0) throw new Error('A financial behaviour must not change points')

  const xpPerLevel = input.xpPerLevel ?? GAMIFICATION_CONFIG_V1.xpPerLevel
  const duplicate = input.alreadyProcessed === true

  const requestedRewardDelta = input.type === 'positive' ? input.pointsDelta
    : input.type === 'negative' ? input.pointsDelta
      : 0
  // Spendable points are clamped at zero; XP is never reduced by behaviour.
  const clampedRewardDelta = duplicate ? 0 : Math.max(requestedRewardDelta, -input.currentRewardPoints)
  const xpDelta = duplicate || input.type !== 'positive' ? 0 : input.pointsDelta

  const nextRewardPoints = input.currentRewardPoints + clampedRewardDelta
  const nextXpTotal = input.currentXpTotal + xpDelta
  const nextLifetimeXP = input.currentLifetimeXP + xpDelta
  if (!Number.isSafeInteger(nextRewardPoints) || !Number.isSafeInteger(nextXpTotal) || !Number.isSafeInteger(nextLifetimeXP)) {
    throw new Error('Behaviour award would exceed the safe integer range')
  }

  const progress = levelProgressForXp(nextXpTotal, xpPerLevel)
  return {
    status: duplicate ? 'duplicate' : 'planned',
    rewardPointsDelta: clampedRewardDelta,
    xpDelta,
    nextRewardPoints,
    nextXpTotal,
    nextLifetimeXP,
    level: progress.level,
    progress,
    eventId: behaviourGamificationEventId(input.behaviourEventId),
    event: {
      schemaVersion: 1,
      familyId: input.familyId,
      childId: input.childId,
      memberId: input.childId,
      sourceBehaviourEventId: input.behaviourEventId,
      eventType: input.type === 'positive' ? 'behaviour_positive'
        : input.type === 'negative' ? 'behaviour_negative' : 'behaviour_financial',
      rewardPointsDelta: clampedRewardDelta,
      xpDelta,
      effectiveAt: input.effectiveAt,
      createdAt: input.processingAt,
      processorVersion: BEHAVIOUR_PROCESSOR_VERSION,
      idempotencyKey,
    },
  }
}
