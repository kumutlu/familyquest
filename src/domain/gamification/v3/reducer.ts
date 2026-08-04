import { GAMIFICATION_CONFIG_V1 } from '../config'
import { levelProgressForXp } from '../level'
import { type GamificationEventV3 } from './event'
import { PROJECTION_VERSION_V3, type GamificationStateV3 } from './state'
import { assertInstant, assertUniqueEventIds, assertValidEventV3, ValidationErrorV3 } from './validators'
import {
  dayKeyFor,
  daysBetweenDayKeys,
  weeklyWindowKeyFor,
  type WeeklyContextV3,
} from './weeklyWindow'

/**
 * Pure, deterministic V3 fold.
 *
 * No Firestore, no Cloud Functions, no `Date.now()`, no global state. The same
 * ledger and the same context always produce byte-identical business fields.
 */
export interface ReducerContextV3 {
  readonly weekly: WeeklyContextV3
  /** Projection instant; supplies the current weekly window and `updatedAt`. */
  readonly asOf: string
  /** Required only when the ledger is empty. */
  readonly familyId?: string
  readonly memberId?: string
}

/**
 * Event-type precedence for deterministic ordering when effectiveAt and
 * createdAt are identical.
 *
 * Canonical ordering:
 *   1. effectiveAt (ascending)
 *   2. createdAt (ascending)
 *   3. eventType precedence (see EVENT_PRECEDENCE below)
 *   4. eventId (ascending, final stable tie-breaker)
 *
 * Precedence rules:
 *   - LEGACY_BASELINE (0): opens the ledger, must be first
 *   - WEEK_ROLLOVER (1): marker event
 *   - Earning events (2-5): TASK_APPROVED, BEHAVIOUR_POSITIVE,
 *     DAILY_GOAL_AWARDED, PERFECT_DAY_AWARDED
 *   - Spending events (6-9): BEHAVIOUR_NEGATIVE, REWARD_REDEEMED,
 *     AVATAR_UNLOCKED, MANUAL_ADJUSTMENT
 *   - REVERSAL (10): references prior events, must be last
 *
 * This ensures that at the same timestamp:
 *   - baseline opens the ledger
 *   - earnings are applied before spending (rewardPoints never negative)
 *   - reversals are applied after the original event
 */
const EVENT_PRECEDENCE: Readonly<Record<string, number>> = Object.freeze({
  LEGACY_BASELINE: 0,
  WEEK_ROLLOVER: 1,
  TASK_APPROVED: 2,
  BEHAVIOUR_POSITIVE: 3,
  DAILY_GOAL_AWARDED: 4,
  PERFECT_DAY_AWARDED: 5,
  BEHAVIOUR_NEGATIVE: 6,
  REWARD_REDEEMED: 7,
  AVATAR_UNLOCKED: 8,
  MANUAL_ADJUSTMENT: 9,
  REVERSAL: 10,
})

export function sortEventsV3(events: readonly GamificationEventV3[]): GamificationEventV3[] {
  return [...events].sort((a, b) => {
    if (a.effectiveAt !== b.effectiveAt) return a.effectiveAt < b.effectiveAt ? -1 : 1
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
    const pa = EVENT_PRECEDENCE[a.eventType] ?? 99
    const pb = EVENT_PRECEDENCE[b.eventType] ?? 99
    if (pa !== pb) return pa - pb
    if (a.eventId !== b.eventId) return a.eventId < b.eventId ? -1 : 1
    return 0
  })
}

function isQualifiedDayEvent(event: GamificationEventV3): boolean {
  return event.eventType === 'DAILY_GOAL_AWARDED' || event.eventType === 'PERFECT_DAY_AWARDED'
}

export function reduceGamificationEventsV3(
  events: readonly GamificationEventV3[],
  context: ReducerContextV3,
): GamificationStateV3 {
  if (!Array.isArray(events)) {
    throw new ValidationErrorV3('events must be an array')
  }
  assertInstant(context.asOf, 'context.asOf')

  for (const event of events) {
    assertValidEventV3(event)
  }
  assertUniqueEventIds(events)

  const familyId = events[0]?.familyId ?? context.familyId
  const memberId = events[0]?.memberId ?? context.memberId
  if (typeof familyId !== 'string' || typeof memberId !== 'string') {
    throw new ValidationErrorV3('familyId and memberId must be resolvable for an empty ledger')
  }
  for (const event of events) {
    if (event.familyId !== familyId || event.memberId !== memberId) {
      throw new ValidationErrorV3('a projection may only fold a single member of a single family')
    }
  }

  const ordered = sortEventsV3(events)
  const byId = new Map(ordered.map((event) => [event.eventId, event]))
  const currentWindowKey = weeklyWindowKeyFor(context.asOf, context.weekly)

  let rewardPoints = 0
  let xpTotal = 0
  let weeklyPoints = 0
  let currentStreak = 0
  let bestStreak = 0
  let lastQualifiedDayKey: string | null = null
  const unlockedAvatarIds: string[] = []
  const reversed = new Set<string>()
  const applied = new Set<string>()

  for (const event of ordered) {
    if (applied.has(event.eventId)) {
      throw new ValidationErrorV3(`duplicate event identity detected: ${event.eventId}`)
    }
    applied.add(event.eventId)

    let weeklyWindowOfEvent = weeklyWindowKeyFor(event.effectiveAt, context.weekly)

    if (event.eventType === 'REVERSAL') {
      const original = byId.get(event.reversalOfEventId)
      if (original === undefined) {
        throw new ValidationErrorV3(
          `reversalOfEventId ${event.reversalOfEventId} is not present in the folded ledger`,
        )
      }
      if (!applied.has(original.eventId)) {
        throw new ValidationErrorV3(
          `reversalOfEventId ${event.reversalOfEventId} must be ordered before its reversal`,
        )
      }
      if (reversed.has(original.eventId)) {
        throw new ValidationErrorV3(`event ${original.eventId} has already reversed`)
      }
      reversed.add(original.eventId)
      // A reversal belongs to the weekly window of the event it corrects.
      weeklyWindowOfEvent = weeklyWindowKeyFor(original.effectiveAt, context.weekly)
      if (original.eventType === 'AVATAR_UNLOCKED') {
        const avatarId = original.metadata.avatarId as string
        const index = unlockedAvatarIds.indexOf(avatarId)
        if (index >= 0) unlockedAvatarIds.splice(index, 1)
      }
    }

    const nextReward = rewardPoints + event.rewardPointsDelta
    if (nextReward < 0) {
      const clampAllowed = event.eventType === 'MANUAL_ADJUSTMENT' && event.metadata.clampToZero === true
      if (!clampAllowed) {
        throw new ValidationErrorV3(
          `event ${event.eventId} would drive rewardPoints negative (${nextReward}); reward points may never be negative`,
        )
      }
      rewardPoints = 0
    } else {
      rewardPoints = nextReward
    }

    const nextXp = xpTotal + event.xpDelta
    if (nextXp < 0) {
      throw new ValidationErrorV3(`event ${event.eventId} would drive xpTotal negative (${nextXp})`)
    }
    xpTotal = nextXp

    if (weeklyWindowOfEvent === currentWindowKey) {
      weeklyPoints = Math.max(0, weeklyPoints + event.weeklyPointsDelta)
    }

    if (event.eventType === 'AVATAR_UNLOCKED') {
      const avatarId = event.metadata.avatarId as string
      if (!unlockedAvatarIds.includes(avatarId)) unlockedAvatarIds.push(avatarId)
    }

    if (isQualifiedDayEvent(event)) {
      const dayKey = (event.metadata.dayKey as string) ?? dayKeyFor(event.effectiveAt, context.weekly)
      if (lastQualifiedDayKey === null) {
        currentStreak = 1
      } else {
        const gap = daysBetweenDayKeys(lastQualifiedDayKey, dayKey)
        if (gap === 0) {
          // Same qualified day already counted (daily goal plus perfect day).
        } else if (gap === 1) {
          currentStreak += 1
        } else {
          currentStreak = 1
        }
      }
      lastQualifiedDayKey = dayKey
      bestStreak = Math.max(bestStreak, currentStreak)
    }
  }

  const progress = levelProgressForXp(xpTotal, GAMIFICATION_CONFIG_V1.xpPerLevel)

  return {
    memberId,
    familyId,
    rewardPoints,
    xpTotal,
    weeklyPoints,
    currentStreak,
    bestStreak,
    lastQualifiedDayKey,
    unlockedAvatarIds,
    weeklyWindowKey: currentWindowKey,
    level: progress.level,
    xpProgressInLevel: progress.xpIntoLevel,
    xpToNextLevel: progress.xpToNextLevel,
    levelProgressPercentage: progress.percentage,
    projectionVersion: PROJECTION_VERSION_V3,
    foldedThroughEventId: ordered.length > 0 ? ordered[ordered.length - 1].eventId : null,
    updatedAt: context.asOf,
  }
}
