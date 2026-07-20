/**
 * Task recurrence / availability logic.
 *
 * Root cause of the recurring-task bug: completion availability was derived from
 * the *latest* historical completion record's status, with no recurrence period
 * key. A recurring task's completion from a previous day/week was therefore
 * treated as permanently completed, so the task could never be completed again.
 *
 * Fix: completion history is immutable. We derive current availability from a
 * recurrence *period key* (e.g. local YYYY-MM-DD for daily/weekday/weekend, a
 * local week id for weekly, and a permanent marker for one-time). A task is
 * "done" only if a completion exists whose period key matches the *current*
 * period.
 *
 * Timezone: the project has no explicit family/user timezone architecture, so we
 * use the established local-time source already used by the streak logic in
 * `api.ts` (the client's local wall-clock time). Period keys are computed with
 * local calendar methods (getFullYear/getMonth/getDate and setDate arithmetic),
 * which are DST-safe and align to local midnight boundaries — never UTC.
 *
 * Week-start convention: Monday. No prior convention existed, so this is
 * documented here as the canonical choice.
 */

export type TaskScheduleType =
  | 'daily'
  | 'weekdays'
  | 'weekends'
  | 'weekly'
  | 'one-time'
  | 'custom';

/** Schedules that reset on a recurring period. */
export const RECURRING_TYPES: ReadonlyArray<TaskScheduleType> = [
  'daily',
  'weekdays',
  'weekends',
  'weekly',
];

/** Monday is the start of the week (documented project convention). */
export const WEEK_STARTS_ON_MONDAY = true;

export function isRecurringTask(type: string | undefined | null): boolean {
  return RECURRING_TYPES.includes((type as TaskScheduleType) ?? 'one-time');
}

/** Local calendar date key, e.g. "2026-07-20". DST-safe (wall-clock local). */
export function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Local week identifier: the Monday (week start) of the local week, expressed as
 * a date key. Two dates in the same Monday–Sunday week share the same key.
 * Uses calendar arithmetic (setDate) so it is DST-safe.
 */
export function localWeekKey(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = d.getDay(); // 0 = Sunday .. 6 = Saturday
  const diffToMonday = (dow + 6) % 7; // days since Monday
  d.setDate(d.getDate() - diffToMonday);
  return localDateKey(d);
}

/**
 * Period key for a schedule type at a given local date.
 *  - daily / weekdays / weekends: local YYYY-MM-DD
 *  - weekly: "week:" + Monday's date key
 *  - one-time / custom: "one-time" (permanent completion)
 */
export function periodKeyFor(type: string | undefined | null, date: Date): string {
  switch (type) {
    case 'daily':
    case 'weekdays':
    case 'weekends':
      return localDateKey(date);
    case 'weekly':
      return `week:${localWeekKey(date)}`;
    case 'one-time':
    case 'custom':
    default:
      return 'one-time';
  }
}

/** Whether a schedule type is eligible on the given local day-of-week. */
export function isEligibleDay(type: string | undefined | null, date: Date): boolean {
  const dow = date.getDay(); // 0 = Sunday
  switch (type) {
    case 'weekdays':
      return dow >= 1 && dow <= 5; // Mon–Fri
    case 'weekends':
      return dow === 0 || dow === 6; // Sat–Sun
    default:
      return true;
  }
}

export interface CompletionRecordLike {
  id?: string;
  taskId?: string;
  assigneeId?: string;
  status?: string;
  completedAt?: { toDate?: () => Date } | Date | null;
  periodKey?: string | null;
}

function completionDate(c: CompletionRecordLike): Date {
  const v = c.completedAt;
  if (v && typeof (v as { toDate?: () => Date }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  if (v instanceof Date) return v;
  return new Date(0);
}

/**
 * Period key for a completion. New records carry an explicit `periodKey`;
 * historical records (created before this field existed) derive it from
 * `completedAt` so they remain compatible and reset correctly for recurring
 * schedules.
 */
export function completionPeriodKey(
  c: CompletionRecordLike,
  type: string | undefined | null,
): string {
  if (c.periodKey) return c.periodKey;
  return periodKeyFor(type, completionDate(c));
}

export type TaskAvailabilityStatus =
  | 'pending'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'not_eligible';

export interface TaskAvailability {
  status: TaskAvailabilityStatus;
  completionId?: string;
  /** Whether the assignee can act on the task right now (eligible day + not done). */
  available: boolean;
}

/**
 * Derive the current availability/status of a task for an assignee from
 * immutable completion history + the current recurrence period.
 *
 * This is the single source of truth shared by the child and parent views so
 * they always agree.
 */
export function deriveTaskAvailability(
  task: { id: string; type?: string | undefined; assigneeId?: string | undefined },
  completions: CompletionRecordLike[],
  now: Date = new Date(),
  assigneeId?: string,
): TaskAvailability {
  const type = task.type;
  const uid = assigneeId ?? task.assigneeId;
  const mine = completions.filter(
    (c) => c.taskId === task.id && (!uid || c.assigneeId === uid),
  );

  if (!isRecurringTask(type)) {
    // One-time / custom: permanent completion. Latest record wins.
    const latest = [...mine].sort(
      (a, b) => completionDate(b).getTime() - completionDate(a).getTime(),
    )[0];
    if (!latest) return { status: 'pending', available: true };
    return {
      status: (latest.status as TaskAvailabilityStatus) ?? 'pending',
      completionId: latest.id,
      available: latest.status === 'rejected',
    };
  }

  // Recurring: eligibility by day-of-week.
  if (!isEligibleDay(type, now)) {
    return { status: 'not_eligible', available: false };
  }

  const currentKey = periodKeyFor(type, now);
  const inPeriod = mine
    .filter((c) => completionPeriodKey(c, type) === currentKey)
    .sort((a, b) => completionDate(b).getTime() - completionDate(a).getTime())[0];

  if (!inPeriod) return { status: 'pending', available: true };
  return {
    status: (inPeriod.status as TaskAvailabilityStatus) ?? 'pending',
    completionId: inPeriod.id,
    available: inPeriod.status === 'rejected',
  };
}

/** True when a task is considered "done" (completed/submitted) for the period. */
export function isTaskDoneThisPeriod(
  task: { id: string; type?: string | undefined; assigneeId?: string | undefined },
  completions: CompletionRecordLike[],
  now: Date = new Date(),
  assigneeId?: string,
): boolean {
  const av = deriveTaskAvailability(task, completions, now, assigneeId);
  return av.status === 'approved' || av.status === 'pending_approval';
}
