/**
 * Living Home priority selectors — Queki v2 Wave 1.
 *
 * PURE functions: they never mutate their inputs and never touch the store,
 * Firebase, or i18n. They answer "what matters right now?" deterministically:
 *
 *   1. higher score wins;
 *   2. ties break by a fixed kind priority order;
 *   3. remaining ties break by id (stable across renders).
 *
 * Rendering components map the returned descriptors to copy via i18n keys, so
 * these selectors stay trivially unit-testable.
 */

export type ParentPriorityKind =
  | 'approvals'
  | 'goal_milestone'
  | 'challenge_update';

export type ChildFocusKind =
  | 'approval_waiting'
  | 'money_received'
  | 'next_quest'
  | 'streak_keep'
  | 'reward_available'
  | 'family_quest';

export interface ParentPriority {
  id: string;
  kind: ParentPriorityKind;
  score: number;
  /** Kind-specific payload for rendering. */
  count?: number;
  title?: string;
  goalId?: string;
  goalTitle?: string;
  progressPct?: number;
  challengeId?: string;
  challengeTitle?: string;
}

export interface ChildFocus {
  id: string;
  kind: ChildFocusKind;
  score: number;
  count?: number;
  taskId?: string;
  taskTitle?: string;
  pointsReward?: number;
  amountPence?: number;
  streakDays?: number;
  rewardId?: string;
  rewardTitle?: number | string;
  challengeId?: string;
  challengeTitle?: string;
}

export interface ParentPrioritiesInput {
  taskCompletions?: any[];
  transferRequests?: any[];
  moneyRequests?: any[];
  petboxRequests?: any[];
  profileUpdateRequests?: any[];
  goalRequests?: any[];
  childJoinRequests?: any[];
  childQrJoinRequests?: any[];
  savingsGoals?: any[];
  challenges?: any[];
  /** Feature flag mirror — Pet Box requests only count when enabled. */
  petBoxEnabled?: boolean;
}

export interface ChildFocusInput {
  currentUser: { id: string; rewardPoints?: number } | null;
  tasks?: any[];
  taskCompletions?: any[];
  rewards?: any[];
  walletTransactions?: any[];
  challenges?: any[];
  gamificationSummary?: { currentStreak?: number } | null;
  dailyProgress?: { dailyGoalReached?: boolean | null } | null;
}

const MAX_ITEMS = 3;

const KIND_ORDER: Record<string, number> = {
  // Parent
  approvals: 0,
  goal_milestone: 1,
  challenge_update: 2,
  // Child
  approval_waiting: 0,
  money_received: 1,
  next_quest: 2,
  streak_keep: 3,
  reward_available: 4,
  family_quest: 5,
};

function millis(value: any): number {
  if (!value) return 0;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  return 0;
}

function isPendingStatus(status: unknown): boolean {
  return status === 'pending' || status === 'pending_approval';
}

/** Count every item waiting on a parent decision across all request families. */
export function countPendingApprovals(input: ParentPrioritiesInput): number {
  const sources: any[][] = [
    input.taskCompletions ?? [],
    input.transferRequests ?? [],
    input.moneyRequests ?? [],
    ...(input.petBoxEnabled ? [input.petboxRequests ?? []] : []),
    input.profileUpdateRequests ?? [],
    input.goalRequests ?? [],
    input.childJoinRequests ?? [],
    input.childQrJoinRequests ?? [],
  ];
  return sources.reduce(
    (sum, source) => sum + source.filter(item => isPendingStatus(item?.status)).length,
    0,
  );
}

function sortAndCap<T extends { score: number; kind: string; id: string }>(items: T[]): T[] {
  return [...items]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const kindDiff = (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99);
      if (kindDiff !== 0) return kindDiff;
      return String(a.id).localeCompare(String(b.id));
    })
    .slice(0, MAX_ITEMS);
}

// ---------------------------------------------------------------------------
// Parent Living Home
// ---------------------------------------------------------------------------

export function selectParentPriorities(input: ParentPrioritiesInput, _now: Date = new Date()): ParentPriority[] {
  const items: ParentPriority[] = [];

  // 1. Approvals waiting — always the single most important thing for a parent.
  const approvals = countPendingApprovals(input);
  if (approvals > 0) {
    items.push({ id: 'approvals', kind: 'approvals', score: 100, count: approvals });
  }

  // 2. Goal milestones — an active savings goal at ≥80% is worth celebrating.
  const milestone = (input.savingsGoals ?? [])
    .filter(goal => goal?.status === 'active' && Number(goal?.targetAmountPence) > 0)
    .map(goal => ({
      goal,
      pct: Math.round((Number(goal.currentAmountPence ?? 0) / Number(goal.targetAmountPence)) * 100),
    }))
    .filter(({ pct }) => pct >= 80)
    .sort((a, b) => b.pct - a.pct || String(a.goal.goalId ?? a.goal.id).localeCompare(String(b.goal.goalId ?? b.goal.id)))[0];
  if (milestone) {
    items.push({
      id: `goal:${milestone.goal.goalId ?? milestone.goal.id}`,
      kind: 'goal_milestone',
      score: 60,
      goalId: milestone.goal.goalId ?? milestone.goal.id,
      goalTitle: milestone.goal.title,
      progressPct: Math.min(100, milestone.pct),
    });
  }

  // 3. Family Quest updates — a completed quest awaiting attention.
  const challenge = (input.challenges ?? []).find(challenge =>
    ['completed', 'ready_to_claim'].includes(String(challenge?.status)),
  );
  if (challenge) {
    items.push({
      id: `challenge:${challenge.id}`,
      kind: 'challenge_update',
      score: 50,
      challengeId: challenge.id,
      challengeTitle: challenge.title,
    });
  }

  return sortAndCap(items);
}

// ---------------------------------------------------------------------------
// Child Living Home
// ---------------------------------------------------------------------------

export function selectChildFocus(input: ChildFocusInput, now: Date = new Date()): ChildFocus[] {
  const user = input.currentUser;
  const uid = user?.id;
  if (!user || !uid) return [];
  const items: ChildFocus[] = [];
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  // 1. Something of mine is waiting for approval.
  const myPending = (input.taskCompletions ?? []).filter(
    c => c?.childId === uid && c?.status === 'pending_approval',
  );
  if (myPending.length > 0) {
    items.push({ id: 'approval_waiting', kind: 'approval_waiting', score: 100, count: myPending.length });
  }

  // 2. Money received in the last 24h (real money — distinct identity).
  const dayAgo = now.getTime() - 24 * 60 * 60 * 1000;
  const received = (input.walletTransactions ?? [])
    .filter(tx => {
      const type = String(tx?.type ?? '');
      const incoming = type === 'deposit' || type === 'request_payment' ||
        (type === 'transfer' && tx?.toChildId === uid);
      return incoming && millis(tx?.timestamp ?? tx?.createdAt) >= dayAgo;
    })
    .sort((a, b) => millis(b?.timestamp ?? b?.createdAt) - millis(a?.timestamp ?? a?.createdAt))[0];
  if (received) {
    items.push({
      id: `money:${received.id}`,
      kind: 'money_received',
      score: 90,
      amountPence: typeof received.amountPence === 'number'
        ? received.amountPence
        : Number(received.amount ?? 0),
    });
  }

  // 3. Next quest — first active task assigned to me without a completion today.
  const completedToday = new Set(
    (input.taskCompletions ?? [])
      .filter(c => c?.childId === uid && millis(c?.completedAt ?? c?.createdAt) >= startOfToday)
      .map(c => c.taskId),
  );
  const nextTask = (input.tasks ?? [])
    .filter(task => task?.assigneeId === uid && task?.isActive !== false && !completedToday.has(task.id))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
  if (nextTask) {
    items.push({
      id: `quest:${nextTask.id}`,
      kind: 'next_quest',
      score: 70,
      taskId: nextTask.id,
      taskTitle: nextTask.title,
      pointsReward: nextTask.pointsReward,
    });
  }

  // 4. Streak state — streak alive but today's goal not yet reached.
  const streak = Number(input.gamificationSummary?.currentStreak ?? 0);
  const goalReached = input.dailyProgress?.dailyGoalReached;
  if (streak > 0 && goalReached === false) {
    items.push({ id: 'streak', kind: 'streak_keep', score: 60, streakDays: streak });
  }

  // 5. Reward affordable right now.
  const points = Number(user.rewardPoints ?? 0);
  const affordable = (input.rewards ?? [])
    .filter(reward => {
      const cost = Number(reward?.pointsCost ?? reward?.cost ?? NaN);
      return Number.isFinite(cost) && cost > 0 && points >= cost;
    })
    .sort((a, b) => {
      const costA = Number(a.pointsCost ?? a.cost);
      const costB = Number(b.pointsCost ?? b.cost);
      return costB - costA || String(a.id).localeCompare(String(b.id));
    })[0];
  if (affordable) {
    items.push({
      id: `reward:${affordable.id}`,
      kind: 'reward_available',
      score: 50,
      rewardId: affordable.id,
      rewardTitle: affordable.title,
    });
  }

  // 6. Family Quest update.
  const activeChallenge = (input.challenges ?? []).find(challenge => String(challenge?.status) === 'active');
  if (activeChallenge) {
    items.push({
      id: `challenge:${activeChallenge.id}`,
      kind: 'family_quest',
      score: 40,
      challengeId: activeChallenge.id,
      challengeTitle: activeChallenge.title,
    });
  }

  return sortAndCap(items);
}
