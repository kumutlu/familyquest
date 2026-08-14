import { localWeekKey } from './taskRecurrence';

type Member = { id: string; [key: string]: any };
type Task = { id: string; pointsReward?: number };
type Completion = {
  assigneeId?: string;
  taskId?: string;
  status?: string;
  approvedAt?: { toDate(): Date } | null;
};

export type RankedMember<T extends Member = Member> = T & { weeklyXP: number };

export interface WeeklyLeaderboard<T extends Member = Member> {
  weekKey: string;
  rankings: RankedMember<T>[];
}

interface BuildWeeklyLeaderboardsInput<T extends Member> {
  members: T[];
  tasks: Task[];
  taskCompletions: Completion[];
}

function approvedCompletionWeek(completion: Completion): string | null {
  if (completion.status !== 'approved' || !completion.approvedAt) return null;
  return localWeekKey(completion.approvedAt.toDate());
}

export function buildWeeklyLeaderboard<T extends Member>(
  input: BuildWeeklyLeaderboardsInput<T>,
  weekKey: string,
): RankedMember<T>[] {
  const taskPoints = new Map(input.tasks.map(task => [task.id, task.pointsReward || 0]));
  const pointsByMember = new Map<string, number>();

  for (const completion of input.taskCompletions) {
    if (approvedCompletionWeek(completion) !== weekKey || !completion.assigneeId || !completion.taskId) continue;
    pointsByMember.set(
      completion.assigneeId,
      (pointsByMember.get(completion.assigneeId) || 0) + (taskPoints.get(completion.taskId) || 0),
    );
  }

  return input.members
    .map(member => ({ ...member, weeklyXP: pointsByMember.get(member.id) || 0 }))
    .sort((a, b) => b.weeklyXP - a.weeklyXP);
}

export function buildWeeklyLeaderboardHistory<T extends Member>(
  input: BuildWeeklyLeaderboardsInput<T> & { currentWeekKey: string },
): WeeklyLeaderboard<T>[] {
  const pastWeekKeys = new Set<string>();

  for (const completion of input.taskCompletions) {
    const weekKey = approvedCompletionWeek(completion);
    if (weekKey && weekKey < input.currentWeekKey) pastWeekKeys.add(weekKey);
  }

  return [...pastWeekKeys]
    .sort((a, b) => b.localeCompare(a))
    .map(weekKey => ({
      weekKey,
      rankings: buildWeeklyLeaderboard(input, weekKey),
    }));
}
