/**
 * Quest Board selectors — Queki v2 Wave 2.
 *
 * PURE functions over the authoritative domain data (tasks + immutable
 * completion history). They never mutate inputs and never touch Firestore,
 * the store, or i18n. All semantics are inherited from the proven domain
 * engine (`deriveTaskAvailability` in src/lib/taskRecurrence.ts) — no new
 * lifecycle is invented here.
 *
 * Ordering signals that ACTUALLY exist in the domain (no invented ones):
 *   1. retry        — a rejected attempt can be redone right now (needs attention)
 *   2. due_today    — recurring quest eligible today with no active attempt yet
 *   3. one_time     — one-time/custom quest never approved
 *   4. later        — recurring quest whose schedule excludes today
 * Assigned quests outrank shared quests; then higher reward; then id (stable).
 */
import {
  deriveTaskAvailability,
  isEligibleDay,
  isRecurringTask,
} from '../taskRecurrence';

export interface TaskLike {
  id: string;
  title?: string;
  pointsReward?: number;
  type?: string;
  assigneeId?: string | null;
  isActive?: boolean;
  /** Whether completion requires parent approval (defaults to true). */
  requiresApproval?: boolean;
  createdAt?: unknown;
}

export interface CompletionLike {
  id?: string;
  taskId?: string;
  assigneeId?: string;
  status?: string;
  completedAt?: { toDate?: () => Date } | Date | null;
  periodKey?: string | null;
  parentComment?: string | null;
}

/** Visual/interaction state of a quest on the board. */
export type QuestViewState =
  | 'available'
  | 'retry'
  | 'pending'
  | 'approved'
  | 'not_eligible_today'
  | 'unavailable';

export interface QuestView {
  task: TaskLike;
  state: QuestViewState;
  /** Authoritative completion document id when one exists for this period. */
  completionId?: string;
  /** Parent comment when the latest attempt was rejected. */
  parentComment?: string | null;
  /** Stable sort rank — lower sorts first. */
  rank: number;
}

const RANK_RETRY = 0;
const RANK_DUE_TODAY = 1;
const RANK_ONE_TIME = 2;
const RANK_LATER = 3;

function toMillis(value: unknown): number {
  if (!value) return 0;
  if (typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return 0;
}

/**
 * Derive the board view of a single task for `viewerId`.
 * Children pass their own id; parents may pass undefined to see everything.
 */
export function deriveQuestView(
  task: TaskLike,
  completions: CompletionLike[],
  now: Date,
  viewerId?: string,
): QuestView {
  const base = { task };

  if (task.isActive === false) {
    return { ...base, state: 'unavailable', rank: RANK_LATER };
  }

  // Completion ownership: for shared tasks the viewer's own records decide;
  // for assigned tasks the assignee's records decide (parents see the child's).
  const effectiveAssignee =
    viewerId && task.assigneeId != null && task.assigneeId !== '' ? task.assigneeId : viewerId;

  const av = deriveTaskAvailability(
    { id: task.id, type: task.type, assigneeId: task.assigneeId ?? undefined },
    completions,
    now,
    effectiveAssignee ?? undefined,
  );

  switch (av.status) {
    case 'pending_approval':
      return { ...base, state: 'pending', completionId: av.completionId, rank: RANK_DUE_TODAY };
    case 'approved':
      return { ...base, state: 'approved', completionId: av.completionId, rank: RANK_DUE_TODAY };
    case 'rejected':
      return {
        ...base,
        state: 'retry',
        completionId: av.completionId,
        parentComment: latestComment(completions, task.id, effectiveAssignee),
        rank: RANK_RETRY,
      };
    case 'not_eligible':
      return { ...base, state: 'not_eligible_today', rank: RANK_LATER };
    case 'pending':
    default:
      break;
  }

  const rank = isRecurringTask(task.type) && !isEligibleDay(task.type, now)
    ? RANK_LATER
    : isRecurringTask(task.type)
      ? RANK_DUE_TODAY
      : RANK_ONE_TIME;
  return { ...base, state: 'available', rank };
}

function latestComment(
  completions: CompletionLike[],
  taskId: string,
  assigneeId?: string,
): string | null {
  const mine = completions
    .filter(c => c.taskId === taskId && (!assigneeId || !c.assigneeId || c.assigneeId === assigneeId))
    .filter(c => typeof c.parentComment === 'string' && c.parentComment.length > 0)
    .sort((a, b) => toMillis(b.completedAt) - toMillis(a.completedAt));
  return mine[0]?.parentComment ?? null;
}

export interface QuestBoard {
  /** Active quests sorted by deterministic priority (best first). */
  active: QuestView[];
  /** The single highest-priority active quest (may be undefined). */
  featured?: QuestView;
  /** First slice of the board shown before "N more" expansion. */
  initiallyVisible: QuestView[];
  moreCount: number;
  /** Submitted, awaiting approval. */
  pending: QuestView[];
  /** Confirmed done for the current period. */
  done: QuestView[];
}

const INITIAL_VISIBLE_COUNT = 4;

/**
 * Build the full Quest Board model. Deterministic: same input → same output.
 * Tie-breaking: rank → assigned-before-shared → higher reward → newest → id.
 */
/** Child visibility rule: own assigned tasks + shared tasks only. */
function isVisibleToViewer(task: TaskLike, viewerId?: string): boolean {
  return !(
    viewerId &&
    task.assigneeId != null &&
    task.assigneeId !== '' &&
    task.assigneeId !== viewerId
  );
}

export function selectQuestBoard(
  tasks: TaskLike[],
  completions: CompletionLike[],
  now: Date,
  viewerId?: string,
): QuestBoard {
  const views = tasks
    .filter(task => isVisibleToViewer(task, viewerId))
    .map(task => deriveQuestView(task, completions, now, viewerId));

  const active = views
    .filter(v => v.state === 'available' || v.state === 'retry' || v.state === 'not_eligible_today')
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      const aAssigned = a.task.assigneeId != null && a.task.assigneeId !== '';
      const bAssigned = b.task.assigneeId != null && b.task.assigneeId !== '';
      if (aAssigned !== bAssigned) return aAssigned ? -1 : 1;
      const rewardDiff = Number(b.task.pointsReward ?? 0) - Number(a.task.pointsReward ?? 0);
      if (rewardDiff !== 0) return rewardDiff;
      const createdDiff = toMillis(b.task.createdAt) - toMillis(a.task.createdAt);
      if (createdDiff !== 0) return createdDiff;
      return String(a.task.id).localeCompare(String(b.task.id));
    });

  const pending = views.filter(v => v.state === 'pending');
  const done = views.filter(v => v.state === 'approved');

  return {
    active,
    featured: active.find(v => v.state !== 'not_eligible_today') ?? active[0],
    initiallyVisible: active.slice(0, INITIAL_VISIBLE_COUNT),
    moreCount: Math.max(0, active.length - INITIAL_VISIBLE_COUNT),
    pending,
    done,
  };
}

export interface TodayProgress {
  /** Confirmed approvals this period. */
  confirmed: number;
  /** Submitted but awaiting approval (honest "handed in" count — NOT confirmed). */
  submitted: number;
  /**
   * Denominator: quests actionable today (eligible recurring + unfinished
   * one-time). Approved one-time quests leave today's board entirely.
   */
  total: number;
}

/**
 * Today Progress semantics (documented contract):
 *  - numerator `confirmed`: quests whose CURRENT-period status is `approved`;
 *  - `submitted`: current-period `pending_approval` — shown separately, never
 *    merged into confirmed completion;
 *  - denominator `total`: eligible-today recurring quests (any state except
 *    not-eligible-day) + one-time quests not yet approved. Rejected retries
 *    stay in the denominator (they still need doing).
 */
export function computeTodayProgress(
  tasks: TaskLike[],
  completions: CompletionLike[],
  now: Date,
  viewerId?: string,
): TodayProgress {
  let confirmed = 0;
  let submitted = 0;
  let total = 0;

  for (const task of tasks) {
    if (task.isActive === false) continue;
    if (!isVisibleToViewer(task, viewerId)) continue;
    const view = deriveQuestView(task, completions, now, viewerId);
    if (view.state === 'approved') {
      // One-time quests are permanently finished — they no longer belong on
      // today's board at all.
      if (!isRecurringTask(task.type)) continue;
      confirmed += 1;
      total += 1;
    } else if (view.state === 'pending') {
      submitted += 1;
      total += 1;
    } else if (view.state === 'available' || view.state === 'retry') {
      total += 1;
    }
    // not_eligible_today: excluded from today's denominator entirely.
  }

  return { confirmed, submitted, total };
}
