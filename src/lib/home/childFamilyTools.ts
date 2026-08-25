import { normalizeGoalDoc } from '../goalContracts';

export interface FeaturedChildGoal {
  id: string;
  title: string;
  context: 'family' | 'mine';
  currentAmountPence: number;
  targetAmountPence: number;
  remainingAmountPence: number;
  progressPercent: number;
}

export function selectFeaturedChildGoal(rawGoals: unknown[] | undefined, childId?: string): FeaturedChildGoal | null {
  const candidates = (rawGoals ?? [])
    .map(raw => ({ raw: raw as Record<string, unknown>, goal: normalizeGoalDoc(raw as Record<string, unknown>) }))
    .filter(({ goal }) => goal.status === 'active' || goal.status === 'reached')
    .filter(({ goal }) => goal.kind === 'family' || (!!childId && goal.childId === childId))
    .map(({ raw, goal }) => {
      const progress = goal.targetAmountPence > 0
        ? Math.min(100, Math.max(0, (goal.currentAmountPence / goal.targetAmountPence) * 100))
        : 0;
      return {
        id: goal.goalId || String(raw.id || ''),
        title: goal.title,
        context: goal.kind === 'family' ? 'family' as const : 'mine' as const,
        currentAmountPence: goal.currentAmountPence,
        targetAmountPence: goal.targetAmountPence,
        remainingAmountPence: Math.max(0, goal.targetAmountPence - goal.currentAmountPence),
        progressPercent: Math.round(progress),
        sortProgress: progress,
      };
    })
    .sort((a, b) => b.sortProgress - a.sortProgress || a.id.localeCompare(b.id));

  if (!candidates[0]) return null;
  const { sortProgress: _sortProgress, ...featured } = candidates[0];
  return featured;
}
