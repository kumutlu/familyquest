/**
 * `useDailyEngagement` — the React hook that turns existing store state
 * into a `ResolvedDailyEngagement` value.
 *
 * This is the ONLY place where the Daily Engagement resolver is wired
 * into the React tree. Components consume the hook result; they never
 * call the resolver directly so precedence cannot drift across screens.
 *
 * Architectural law:
 *   Engagement Engine creates opportunities.
 *   Gamification Engine awards value.
 *
 * The hook NEVER writes to authoritative state. It only composes a
 * presentation bundle for the UI and the Mascot.
 */

import { useMemo } from 'react'

import {
  resolveDailyEngagement,
  type ResolvedDailyEngagement,
  type TaskSummary,
} from '../domain/engagement/resolver'
import type { EventDefinition } from '../domain/experience/types'
import type { SurgeFamilyPreferences } from '../domain/surge/types'

export interface UseDailyEngagementInput {
  readonly now: number
  readonly activeSurges: ReadonlyArray<{
    readonly surgeId: string
    readonly surge: import('../domain/surge/types').SurgeEligibilityDefinition
    readonly window: { readonly startsAt: number; readonly endsAt: number }
  }>
  readonly availableTasks: readonly TaskSummary[]
  readonly familyPreferences: SurgeFamilyPreferences
  readonly activeEvent?: EventDefinition | null
  readonly viewingChildId?: string | null
  readonly currentStreak?: number
  readonly questsRemaining?: number
  readonly questsCompletedToday?: number
}

/** Memo key derivation. Stable for unchanged inputs. */
function deriveMemoKey(input: UseDailyEngagementInput): string {
  const surgeKey = input.activeSurges
    .map(s => `${s.surgeId}:${s.window.startsAt}-${s.window.endsAt}:${s.surge.eligibleTaskIds.join(',')}`)
    .join('|')
  const taskKey = input.availableTasks
    .map(t => `${t.id}:${t.isCompleted ? '1' : '0'}`)
    .join('|')
  return [
    input.now,
    surgeKey,
    taskKey,
    input.familyPreferences.surgeHours ? '1' : '0',
    input.activeEvent?.id ?? '',
    input.viewingChildId ?? '',
    input.currentStreak ?? '',
    input.questsRemaining ?? '',
    input.questsCompletedToday ?? '',
  ].join('::')
}

export function useDailyEngagement(
  input: UseDailyEngagementInput,
): ResolvedDailyEngagement {
  const memoKey = deriveMemoKey(input)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- memoKey is the stable identity derived from every input
  return useMemo(() => resolveDailyEngagement(input), [memoKey])
}