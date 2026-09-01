import { useMemo } from 'react';
import { useDailyEngagement } from './useDailyEngagement';
import type { TaskSummary } from '../domain/engagement/resolver';
import type { SurgeEligibilityDefinition, SurgeWindow } from '../domain/surge/types';
import type { ComebackTier, ResolveComebackInput, ResolveComebackResult } from '../domain/comeback/types';
import { resolveComeback } from '../domain/comeback/eligibility';
import type { DailyEngagementUrgency } from '../domain/engagement/resolver';
import {
  resolveDailyAdventurePresentation,
  type DailyAdventurePresentation,
  type DailyAdventureContext,
} from '../domain/adventure/presentation.v1';

/**
 * `useChildAdventure` — wires the existing domain resolvers into a
 * single V1 bundle for the Child Home "Today's Adventure" surface.
 *
 * Architectural law
 * -----------------
 *   Engagement Engine creates opportunities.
 *   Gamification Engine awards value.
 *   Presentation Engine renders.
 *
 * This hook composes a presentation bundle. It NEVER writes to
 * authoritative state, NEVER awards value, NEVER picks precedence by
 * itself — precedence is delegated to the pure resolver
 * `resolveDailyAdventurePresentation`.
 *
 * The hook is the only place the React tree talks to that resolver so
 * precedence cannot drift across surfaces.
 */

export interface ActiveSurgeInput {
  readonly surgeId: string;
  readonly surge: SurgeEligibilityDefinition;
  readonly window: SurgeWindow;
}

export interface MysteryDropInput {
  readonly id: string;
  readonly rarity: 'common' | 'rare' | 'epic';
  /** When true, the drop is currently in its reveal-ready state. */
  readonly isRevealReady: boolean;
}

export interface UseChildAdventureInput {
  readonly now: number;
  readonly activeSurges: readonly ActiveSurgeInput[];
  readonly availableTasks: readonly TaskSummary[];
  readonly surgeHoursEnabled: boolean;
  readonly currentStreak?: number;
  readonly questsRemaining?: number;
  readonly questsCompletedToday?: number;
  readonly activeEventId?: string | null;
  readonly comeback?: ResolveComebackInput | null;
  readonly mysteryDrop?: MysteryDropInput | null;
  /**
   * Whether the underlying state has been resolved by the host.
   * Defaults to `false`; the host flips it to `true` once authoritative
   * data is present. Until then, the surface suppresses all special
   * opportunities and shows a calm loading state.
   */
  readonly resolved?: boolean;
  /** Whether a recognised seasonal event is currently live. */
  readonly seasonalActive?: boolean;
}

export interface ChildAdventureBundle {
  /** Resolved Surge presentation (already precedence-ranked by the resolver). */
  readonly surge: {
    readonly surgeId: string;
    readonly surge: SurgeEligibilityDefinition;
    readonly window: SurgeWindow;
    readonly eligibleTasks: readonly TaskSummary[];
  } | null;
  /** Urgency surfaced from the engagement resolver. */
  readonly urgency: DailyEngagementUrgency;
  /** The selected Comeback Mission, or null when not applicable. */
  readonly comeback: ResolveComebackResult | null;
  /** The Mystery Drop, or null when not applicable. */
  readonly mysteryDrop: MysteryDropInput | null;
  /** Resolved presentation kind (the SINGLE field the UI multiplexes on). */
  readonly presentation: DailyAdventurePresentation;
}

function deriveMemoKey(input: UseChildAdventureInput): string {
  const surgeKey = input.activeSurges
    .map(s => `${s.surgeId}:${s.window.startsAt}-${s.window.endsAt}:${s.surge.eligibleTaskIds.join(',')}`)
    .join('|');
  const taskKey = input.availableTasks
    .map(t => `${t.id}:${t.isCompleted ? '1' : '0'}`)
    .join('|');
  const comebackKey = input.comeback
    ? `${input.comeback.timezone}:${input.comeback.now}:${input.comeback.lastMeaningfulActivityAt ?? ''}:${(input.comeback.completedTiersForDate ?? []).join(',')}`
    : '';
  const mysteryKey = input.mysteryDrop
    ? `${input.mysteryDrop.id}:${input.mysteryDrop.rarity}:${input.mysteryDrop.isRevealReady ? '1' : '0'}`
    : '';
  return [
    input.now,
    surgeKey,
    taskKey,
    input.surgeHoursEnabled ? '1' : '0',
    input.currentStreak ?? '',
    input.questsRemaining ?? '',
    input.questsCompletedToday ?? '',
    input.activeEventId ?? '',
    comebackKey,
    mysteryKey,
    input.resolved ? '1' : '0',
    input.seasonalActive ? '1' : '0',
  ].join('::');
}

/**
 * Select up to N tasks from `availableTasks` that are eligible under the
 * surge. Mirrors the resolver's sibling-denial rule.
 */
function eligibleTasksForSurge(
  surge: ActiveSurgeInput,
  availableTasks: readonly TaskSummary[],
  viewingChildId: string | null | undefined,
): TaskSummary[] {
  const ids = new Set(surge.surge.eligibleTaskIds);
  return availableTasks.filter(task => {
    if (!ids.has(task.id)) return false;
    if (task.isCompleted) return false;
    if (task.assigneeId !== null) {
      if (!viewingChildId) return false;
      if (task.assigneeId !== viewingChildId) return false;
    }
    return true
  });
}

/**
 * Memoised bundle. The hook returns a stable identity for unchanged
 * inputs so consumers can rely on referential equality.
 */
export function useChildAdventure(input: UseChildAdventureInput): ChildAdventureBundle {
  // 1. Always call the engagement hook at the top level — it owns its
  //    own memoisation keyed by derived identity.
  const engagement = useDailyEngagement({
    now: input.now,
    activeSurges: input.activeSurges,
    availableTasks: input.availableTasks,
    familyPreferences: { surgeHours: input.surgeHoursEnabled },
    activeEvent: input.activeEventId ? { id: input.activeEventId } as any : null,
    currentStreak: input.currentStreak,
    questsRemaining: input.questsRemaining,
    questsCompletedToday: input.questsCompletedToday,
  });

  const memoKey = deriveMemoKey(input);

  // memoKey is the stable identity derived from every input below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo<ChildAdventureBundle>(() => {
    const viewingChildId =
      (input.availableTasks.find(t => t.assigneeId !== null)?.assigneeId) ?? null;

    // ---- 1) Daily Engagement (Surge) ------------------------------------
    let surgeBundle: ChildAdventureBundle['surge'] = null;
    let eligibleTaskCount = 0;
    if (engagement.primaryOpportunity?.kind === 'surge') {
      const op = engagement.primaryOpportunity;
      const full = input.activeSurges.find(s => s.surgeId === op.surgeId);
      if (full) {
        const eligible = eligibleTasksForSurge(full, input.availableTasks, viewingChildId);
        eligibleTaskCount = eligible.length;
        if (eligibleTaskCount > 0) {
          surgeBundle = {
            surgeId: full.surgeId,
            surge: full.surge,
            window: full.window,
            eligibleTasks: eligible,
          };
        }
      }
    }

    // ---- 2) Comeback ----------------------------------------------------
    const comeback: ResolveComebackResult | null = input.comeback
      ? resolveComeback(input.comeback)
      : null;
    const comebackTier: ComebackTier = comeback?.tier ?? 'none';

    // ---- 3) Mystery Drop -----------------------------------------------
    // Surface the Mystery Drop as-is. The presentation resolver decides
    // whether to outrank it against Surge / Comeback — the hook does
    // NOT pre-filter.
    const mysteryDrop: MysteryDropInput | null = input.mysteryDrop ?? null;

    // ---- 4) Presentation -----------------------------------------------
    // Build a pure context for the resolver. The hook never embeds
    // precedence logic itself.
    const presentationContext: DailyAdventureContext = {
      surge: surgeBundle
        ? { surgeId: surgeBundle.surgeId, eligibleTaskCount }
        : null,
      mysteryDrop,
      comeback: comeback
        ? { tier: comebackTier, inactivityDays: comeback.inactivityDays }
        : null,
      seasonalActive: input.seasonalActive === true,
      resolved: input.resolved === true,
    };
    const presentation = resolveDailyAdventurePresentation(presentationContext);

    return {
      surge: surgeBundle,
      urgency: engagement.urgency,
      comeback,
      mysteryDrop,
      presentation,
    };
    // memoKey is the stable identity derived from every input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoKey, engagement]);
}