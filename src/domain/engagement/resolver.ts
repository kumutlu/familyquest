/**
 * Daily Engagement resolver — single source of truth.
 *
 * Pure function. Decides what the child should see RIGHT NOW given:
 *   - Active Surges (read-only view of the Surge catalog)
 *   - Available tasks
 *   - Active event (from the Experience Engine)
 *   - Family opt-in (`engagementPreferences.surgeHours`)
 *
 * Architectural law:
 *   Engagement Engine creates opportunities.
 *   Gamification Engine awards value.
 *
 * This resolver NEVER writes anything to authoritative state. It only
 * composes a presentation bundle that the UI and the Mascot consume.
 *
 * Precedence (top wins):
 *   1. Surge ending soon (< 10 min)
 *   2. Surge active
 *   3. Streak at risk
 *   4. Seasonal event
 *   5. Default (no primary opportunity)
 */

import {
  isInWindow,
  type SurgeEligibilityDefinition,
  type SurgeWindow,
} from '../surge/types'
import type { EventDefinition } from '../experience/types'

/** A Surge exposed to the resolver. Mirrors the minimum the resolver
 *  needs; the catalog may carry more metadata that the resolver ignores. */
export interface ActiveSurge {
  readonly surgeId: string
  readonly surge: SurgeEligibilityDefinition
  readonly window: SurgeWindow
}

export interface TaskSummary {
  readonly id: string
  readonly title: string
  readonly pointsReward: number
  readonly assigneeId: string | null
  readonly isCompleted: boolean
}

export interface DailyEngagementInput {
  readonly now: number
  readonly activeSurges: readonly ActiveSurge[]
  readonly availableTasks: readonly TaskSummary[]
  readonly activeEvent?: EventDefinition | null
  readonly familyPreferences: { readonly surgeHours: boolean }
  readonly viewingChildId?: string | null
  readonly currentStreak?: number
  readonly questsRemaining?: number
  readonly questsCompletedToday?: number
}

export type DailyEngagementUrgency = 'normal' | 'soon' | 'ending'

export type DailyEngagementPresentation =
  | {
      readonly kind: 'surge'
      readonly surge: SurgeEligibilityDefinition
      readonly surgeId: string
      readonly eligibleTasks: readonly TaskSummary[]
      readonly endsAt: number
    }
  | {
      readonly kind: 'streak'
      readonly streak: number
      readonly questsRemaining: number
    }
  | {
      readonly kind: 'seasonal'
      readonly event: EventDefinition
    }

export interface ResolvedDailyEngagement {
  readonly primaryOpportunity?: DailyEngagementPresentation
  readonly urgency: DailyEngagementUrgency
  readonly nextRefreshAt?: number
}

/** A Surge is "ending soon" when less than this many ms remain. */
const ENDING_SOON_MS = 10 * 60 * 1000

function surgeEndsWithin(surge: ActiveSurge, now: number, ms: number): boolean {
  return surge.window.endsAt - now <= ms
}

function eligibleTasksFor(
  surge: ActiveSurge,
  availableTasks: readonly TaskSummary[],
  viewingChildId: string | null | undefined,
): TaskSummary[] {
  const ids = new Set(surge.surge.eligibleTaskIds)
  return availableTasks.filter(task => {
    if (!ids.has(task.id)) return false
    if (task.isCompleted) return false
    // Sibling denial — same as the authoritative resolver.
    if (task.assigneeId !== null) {
      if (!viewingChildId) return false
      if (task.assigneeId !== viewingChildId) return false
    }
    return true
  })
}

function liveSurges(input: DailyEngagementInput): ActiveSurge[] {
  if (!Array.isArray(input.activeSurges)) return []
  return input.activeSurges.filter(s => {
    if (!s || !s.surge || !s.window) return false
    return isInWindow(input.now, s.window)
  })
}

export function resolveDailyEngagement(
  input: DailyEngagementInput,
): ResolvedDailyEngagement {
  if (
    typeof input.now !== 'number' ||
    !Number.isFinite(input.now)
  ) {
    return { urgency: 'normal' }
  }

  if (input.familyPreferences.surgeHours !== true) {
    // Surge participation disabled — fall through to lower precedence.
  }

  const surges = liveSurges(input)
    .filter(() => input.familyPreferences.surgeHours === true)

  // 1) Ending-soon Surge.
  for (const surge of surges) {
    if (surgeEndsWithin(surge, input.now, ENDING_SOON_MS)) {
      return {
        primaryOpportunity: {
          kind: 'surge',
          surge: surge.surge,
          surgeId: surge.surgeId,
          eligibleTasks: eligibleTasksFor(surge, input.availableTasks, input.viewingChildId),
          endsAt: surge.window.endsAt,
        },
        urgency: 'ending',
        nextRefreshAt: surge.window.endsAt,
      }
    }
  }

  // 2) Regular Surge.
  for (const surge of surges) {
    return {
      primaryOpportunity: {
        kind: 'surge',
        surge: surge.surge,
        surgeId: surge.surgeId,
        eligibleTasks: eligibleTasksFor(surge, input.availableTasks, input.viewingChildId),
        endsAt: surge.window.endsAt,
      },
      urgency: 'normal',
      nextRefreshAt: surge.window.endsAt,
    }
  }

  // 3) Streak at risk (carry-over from mascot logic).
  const streak = input.currentStreak ?? 0
  const questsRemaining = input.questsRemaining ?? 0
  const questsCompletedToday = input.questsCompletedToday ?? 0
  if (streak > 0 && questsCompletedToday === 0 && questsRemaining > 0) {
    return {
      primaryOpportunity: {
        kind: 'streak',
        streak,
        questsRemaining,
      },
      urgency: 'normal',
    }
  }

  // 4) Seasonal event.
  if (input.activeEvent && input.activeEvent.status === 'active') {
    return {
      primaryOpportunity: { kind: 'seasonal', event: input.activeEvent },
      urgency: 'normal',
    }
  }

  // 5) Default.
  return { urgency: 'normal' }
}