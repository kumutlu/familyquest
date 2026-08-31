/**
 * Public surface of the Surge domain module.
 *
 * Engagement creates opportunities; Gamification awards value.
 */

export type {
  SurgeKind,
  SurgeReward,
  SurgeEligibilityDefinition,
  SurgeSnapshot,
  SurgeTaskContext,
  SurgeCompletionContext,
  SurgeFamilyPreferences,
  SurgeWindow,
  SurgeEligibilityInput,
  SurgeEligibilityReason,
  SurgeEligibilityResult,
} from './types'

export {
  surgeEventId,
  surgeReversalEventId,
  isInWindow,
} from './types'

export {
  evaluateSurgeEligibility,
  buildSurgeSnapshot,
  surgeIdempotencyKey,
} from './eligibility'

export {
  DEFAULT_SURGE_SCHEDULER_LIMITS,
  decideSurgeEmission,
  surgeDayKey,
  type SurgeSchedulerLimits,
  type SurgeSchedulerInput,
  type SurgeSchedulerDecision,
  type SurgeSchedulerDecisionReason,
} from './scheduler'