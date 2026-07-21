import { describe, expect, it } from 'vitest';
import {
  localDateKey,
  localWeekKey,
  periodKeyFor,
  isEligibleDay,
  isRecurringTask,
  completionPeriodKey,
  deriveTaskAvailability,
  isTaskDoneThisPeriod,
  weekStart,
  isInCurrentWeek,
  type CompletionRecordLike,
} from './taskRecurrence';

// Helper to build a completion record. `completedAt` may be a Date or a
// Firestore-like { toDate } sentinel.
function completion(
  over: Partial<CompletionRecordLike> & { taskId: string; assigneeId: string },
): CompletionRecordLike {
  return { status: 'approved', ...over };
}

const child = 'child-1';

describe('period key calculation', () => {
  it('daily/weekday/weekend use the local YYYY-MM-DD', () => {
    const d = new Date(2026, 6, 20, 14, 30); // 2026-07-20 local
    expect(periodKeyFor('daily', d)).toBe('2026-07-20');
    expect(periodKeyFor('weekdays', d)).toBe('2026-07-20');
    expect(periodKeyFor('weekends', d)).toBe('2026-07-20');
  });

  it('weekly uses a Monday-based week id', () => {
    // 2026-07-20 is a Monday; 2026-07-26 is the following Sunday.
    const monday = new Date(2026, 6, 20, 9, 0);
    const sunday = new Date(2026, 6, 26, 9, 0);
    expect(periodKeyFor('weekly', monday)).toBe('week:2026-07-20');
    expect(periodKeyFor('weekly', sunday)).toBe('week:2026-07-20');
    // Next Monday starts a new week.
    const nextMonday = new Date(2026, 6, 27, 9, 0);
    expect(periodKeyFor('weekly', nextMonday)).toBe('week:2026-07-27');
  });

  it('one-time / custom use a permanent marker', () => {
    const d = new Date(2026, 6, 20, 9, 0);
    expect(periodKeyFor('one-time', d)).toBe('one-time');
    expect(periodKeyFor('custom', d)).toBe('one-time');
    expect(periodKeyFor(undefined, d)).toBe('one-time');
  });

  it('localWeekKey returns the Monday of the week (week starts Monday)', () => {
    // Sunday 2026-07-26 -> Monday 2026-07-20
    expect(localWeekKey(new Date(2026, 6, 26))).toBe('2026-07-20');
    // Monday 2026-07-20 -> itself
    expect(localWeekKey(new Date(2026, 6, 20))).toBe('2026-07-20');
  });
});

describe('day-of-week eligibility', () => {
  it('weekdays are Mon–Fri only', () => {
    expect(isEligibleDay('weekdays', new Date(2026, 6, 20))).toBe(true); // Mon
    expect(isEligibleDay('weekdays', new Date(2026, 6, 24))).toBe(true); // Fri
    expect(isEligibleDay('weekdays', new Date(2026, 6, 25))).toBe(false); // Sat
    expect(isEligibleDay('weekdays', new Date(2026, 6, 26))).toBe(false); // Sun
  });

  it('weekends are Sat–Sun only', () => {
    expect(isEligibleDay('weekends', new Date(2026, 6, 25))).toBe(true); // Sat
    expect(isEligibleDay('weekends', new Date(2026, 6, 26))).toBe(true); // Sun
    expect(isEligibleDay('weekends', new Date(2026, 6, 20))).toBe(false); // Mon
  });

  it('daily/weekly/one-time are eligible every day', () => {
    const sun = new Date(2026, 6, 26);
    expect(isEligibleDay('daily', sun)).toBe(true);
    expect(isEligibleDay('weekly', sun)).toBe(true);
    expect(isEligibleDay('one-time', sun)).toBe(true);
  });
});

describe('isRecurringTask', () => {
  it('classifies recurring vs one-time', () => {
    expect(isRecurringTask('daily')).toBe(true);
    expect(isRecurringTask('weekdays')).toBe(true);
    expect(isRecurringTask('weekends')).toBe(true);
    expect(isRecurringTask('weekly')).toBe(true);
    expect(isRecurringTask('one-time')).toBe(false);
    expect(isRecurringTask('custom')).toBe(false);
    expect(isRecurringTask(undefined)).toBe(false);
  });
});

describe('daily tasks', () => {
  const task = { id: 't-daily', type: 'daily' as const };

  it('incomplete today -> available', () => {
    const now = new Date(2026, 6, 20, 10, 0);
    const av = deriveTaskAvailability(task, [], now, child);
    expect(av.status).toBe('pending');
    expect(av.available).toBe(true);
  });

  it('completed today -> unavailable', () => {
    const now = new Date(2026, 6, 20, 10, 0);
    const completions = [
      completion({ taskId: 't-daily', assigneeId: child, status: 'approved', completedAt: new Date(2026, 6, 20, 8, 0) }),
    ];
    const av = deriveTaskAvailability(task, completions, now, child);
    expect(av.status).toBe('approved');
    expect(av.available).toBe(false);
  });

  it('available again the next day', () => {
    const now = new Date(2026, 6, 21, 10, 0);
    const completions = [
      completion({ taskId: 't-daily', assigneeId: child, status: 'approved', completedAt: new Date(2026, 6, 20, 8, 0) }),
    ];
    const av = deriveTaskAvailability(task, completions, now, child);
    expect(av.status).toBe('pending');
    expect(av.available).toBe(true);
  });

  it('not available twice on the same day', () => {
    const now = new Date(2026, 6, 20, 19, 0);
    const completions = [
      completion({ taskId: 't-daily', assigneeId: child, status: 'approved', completedAt: new Date(2026, 6, 20, 8, 0) }),
    ];
    const av = deriveTaskAvailability(task, completions, now, child);
    expect(av.available).toBe(false);
    expect(av.status).toBe('approved');
  });
});

describe('weekday tasks', () => {
  const task = { id: 't-wd', type: 'weekdays' as const };

  it('available Monday–Friday', () => {
    const mon = new Date(2026, 6, 20, 10, 0);
    expect(deriveTaskAvailability(task, [], mon, child).available).toBe(true);
    const fri = new Date(2026, 6, 24, 10, 0);
    expect(deriveTaskAvailability(task, [], fri, child).available).toBe(true);
  });

  it('unavailable on weekends', () => {
    const sat = new Date(2026, 6, 25, 10, 0);
    const av = deriveTaskAvailability(task, [], sat, child);
    expect(av.available).toBe(false);
    expect(av.status).toBe('not_eligible');
    const sun = new Date(2026, 6, 26, 10, 0);
    expect(deriveTaskAvailability(task, [], sun, child).status).toBe('not_eligible');
  });

  it('resets on the next eligible day', () => {
    const sat = new Date(2026, 6, 25, 10, 0);
    const completions = [
      completion({ taskId: 't-wd', assigneeId: child, status: 'approved', completedAt: new Date(2026, 6, 24, 8, 0) }), // Fri
    ];
    // Saturday: not eligible, so not "done" in an actionable sense.
    expect(deriveTaskAvailability(task, completions, sat, child).status).toBe('not_eligible');
    // Monday: new eligible day, previous Friday completion no longer counts.
    const mon = new Date(2026, 6, 27, 10, 0);
    const av = deriveTaskAvailability(task, completions, mon, child);
    expect(av.available).toBe(true);
    expect(av.status).toBe('pending');
  });
});

describe('weekend tasks', () => {
  const task = { id: 't-we', type: 'weekends' as const };

  it('unavailable on weekdays', () => {
    const wed = new Date(2026, 6, 22, 10, 0);
    const av = deriveTaskAvailability(task, [], wed, child);
    expect(av.available).toBe(false);
    expect(av.status).toBe('not_eligible');
  });

  it('can be completed separately on Saturday and Sunday', () => {
    const sat = new Date(2026, 6, 25, 10, 0);
    const sun = new Date(2026, 6, 26, 10, 0);
    // Saturday completion must not block Sunday.
    const completions = [
      completion({ taskId: 't-we', assigneeId: child, status: 'approved', completedAt: new Date(2026, 6, 25, 9, 0) }),
    ];
    expect(deriveTaskAvailability(task, completions, sat, child).available).toBe(false);
    const sunAv = deriveTaskAvailability(task, completions, sun, child);
    expect(sunAv.available).toBe(true);
    expect(sunAv.status).toBe('pending');
  });
});

describe('weekly tasks', () => {
  const task = { id: 't-wk', type: 'weekly' as const };

  it('unavailable after completion in the same week', () => {
    const now = new Date(2026, 6, 22, 10, 0); // Wed
    const completions = [
      completion({ taskId: 't-wk', assigneeId: child, status: 'approved', completedAt: new Date(2026, 6, 20, 9, 0) }), // Mon
    ];
    const av = deriveTaskAvailability(task, completions, now, child);
    expect(av.available).toBe(false);
    expect(av.status).toBe('approved');
  });

  it('available in the next week', () => {
    const now = new Date(2026, 6, 27, 10, 0); // next Monday
    const completions = [
      completion({ taskId: 't-wk', assigneeId: child, status: 'approved', completedAt: new Date(2026, 6, 20, 9, 0) }), // prev Mon
    ];
    const av = deriveTaskAvailability(task, completions, now, child);
    expect(av.available).toBe(true);
    expect(av.status).toBe('pending');
  });
});

describe('one-time tasks', () => {
  const task = { id: 't-once', type: 'one-time' as const };

  it('remain permanently completed', () => {
    const completions = [
      completion({ taskId: 't-once', assigneeId: child, status: 'approved', completedAt: new Date(2020, 0, 1) }),
    ];
    const farFuture = new Date(2030, 11, 31, 23, 59);
    const av = deriveTaskAvailability(task, completions, farFuture, child);
    expect(av.available).toBe(false);
    expect(av.status).toBe('approved');
  });

  it('rejected one-time can be retried', () => {
    const completions = [
      completion({ taskId: 't-once', assigneeId: child, status: 'rejected', completedAt: new Date(2020, 0, 1) }),
    ];
    const av = deriveTaskAvailability(task, completions, new Date(2030, 11, 31), child);
    expect(av.available).toBe(true);
    expect(av.status).toBe('rejected');
  });
});

describe('approval-required vs non-approval recurring tasks', () => {
  it('approval-required: pending_approval counts as done this period', () => {
    const task = { id: 't-appr', type: 'daily' as const };
    const now = new Date(2026, 6, 20, 10, 0);
    const completions = [
      completion({ taskId: 't-appr', assigneeId: child, status: 'pending_approval', completedAt: new Date(2026, 6, 20, 8, 0) }),
    ];
    const av = deriveTaskAvailability(task, completions, now, child);
    expect(av.available).toBe(false);
    expect(av.status).toBe('pending_approval');
    expect(isTaskDoneThisPeriod(task, completions, now, child)).toBe(true);
  });

  it('non-approval: approved counts as done this period', () => {
    const task = { id: 't-noappr', type: 'daily' as const };
    const now = new Date(2026, 6, 20, 10, 0);
    const completions = [
      completion({ taskId: 't-noappr', assigneeId: child, status: 'approved', completedAt: new Date(2026, 6, 20, 8, 0) }),
    ];
    expect(isTaskDoneThisPeriod(task, completions, now, child)).toBe(true);
  });

  it('rejected recurring task can be re-completed in the same period', () => {
    const task = { id: 't-rej', type: 'daily' as const };
    const now = new Date(2026, 6, 20, 10, 0);
    const completions = [
      completion({ taskId: 't-rej', assigneeId: child, status: 'rejected', completedAt: new Date(2026, 6, 20, 8, 0) }),
    ];
    const av = deriveTaskAvailability(task, completions, now, child);
    expect(av.available).toBe(true);
    expect(av.status).toBe('rejected');
  });
});

describe('parent and child views agree', () => {
  it('deriveTaskAvailability and isTaskDoneThisPeriod are consistent', () => {
    const task = { id: 't-agree', type: 'daily' as const };
    const now = new Date(2026, 6, 20, 10, 0);
    const done = [
      completion({ taskId: 't-agree', assigneeId: child, status: 'approved', completedAt: new Date(2026, 6, 20, 8, 0) }),
    ];
    const av = deriveTaskAvailability(task, done, now, child);
    expect(av.status === 'approved' || av.status === 'pending_approval').toBe(isTaskDoneThisPeriod(task, done, now, child));
    expect(av.available).toBe(!isTaskDoneThisPeriod(task, done, now, child) || av.status === 'rejected');
  });

  it('both views ignore other children completions', () => {
    const task = { id: 't-share', type: 'daily' as const };
    const now = new Date(2026, 6, 20, 10, 0);
    const completions = [
      completion({ taskId: 't-share', assigneeId: 'other-child', status: 'approved', completedAt: new Date(2026, 6, 20, 8, 0) }),
    ];
    const av = deriveTaskAvailability(task, completions, now, child);
    expect(av.available).toBe(true);
    expect(av.status).toBe('pending');
  });
});

describe('local midnight boundary', () => {
  it('a completion just before midnight does not block just after midnight', () => {
    const task = { id: 't-mid', type: 'daily' as const };
    const completions = [
      completion({ taskId: 't-mid', assigneeId: child, status: 'approved', completedAt: new Date(2026, 6, 20, 23, 59) }),
    ];
    const afterMidnight = new Date(2026, 6, 21, 0, 1);
    const av = deriveTaskAvailability(task, completions, afterMidnight, child);
    expect(av.available).toBe(true);
    expect(av.status).toBe('pending');
  });

  it('period keys differ across local midnight', () => {
    const before = new Date(2026, 6, 20, 23, 59);
    const after = new Date(2026, 6, 21, 0, 1);
    expect(localDateKey(before)).toBe('2026-07-20');
    expect(localDateKey(after)).toBe('2026-07-21');
  });
});

describe('DST-safe period calculation', () => {
  it('uses local calendar date, not UTC, around a DST transition', () => {
    // London springs forward on 2026-03-29. A local time late on the 28th and
    // early on the 29th must map to their LOCAL dates, not UTC-shifted ones.
    const lateSat = new Date(2026, 2, 28, 23, 30); // local Sat 23:30
    const earlySun = new Date(2026, 2, 29, 1, 30); // local Sun 01:30 (DST gap is 01:00-02:00)
    expect(localDateKey(lateSat)).toBe('2026-03-28');
    expect(localDateKey(earlySun)).toBe('2026-03-29');
    // Both are distinct local days -> distinct daily period keys.
    expect(periodKeyFor('daily', lateSat)).not.toBe(periodKeyFor('daily', earlySun));
  });

  it('week key is stable across a DST boundary within the same local week', () => {
    // Mon 2026-03-23 .. Sun 2026-03-29 (DST starts 2026-03-29). All same week.
    const mon = new Date(2026, 2, 23, 9, 0);
    const sun = new Date(2026, 2, 29, 9, 0);
    expect(periodKeyFor('weekly', mon)).toBe(periodKeyFor('weekly', sun));
  });
});

describe('backward compatibility: historical records without periodKey', () => {
  it('derives period key from completedAt when periodKey is absent', () => {
    const task = { id: 't-legacy', type: 'daily' as const };
    // Historical completion with no periodKey field, completed yesterday.
    const legacy = {
      id: 'c-legacy',
      taskId: 't-legacy',
      assigneeId: child,
      status: 'approved',
      completedAt: new Date(2026, 6, 19, 8, 0), // yesterday
    };
    const today = new Date(2026, 6, 20, 10, 0);
    const av = deriveTaskAvailability(task, [legacy], today, child);
    expect(av.available).toBe(true); // yesterday's completion no longer blocks today
    expect(av.status).toBe('pending');
  });

  it('explicit periodKey takes precedence over derived completedAt', () => {
    const task = { id: 't-explicit', type: 'daily' as const };
    const rec = {
      id: 'c-explicit',
      taskId: 't-explicit',
      assigneeId: child,
      status: 'approved',
      completedAt: new Date(2026, 6, 19, 8, 0), // would derive to yesterday
      periodKey: '2026-07-20', // but explicitly today
    };
    const today = new Date(2026, 6, 20, 10, 0);
    const av = deriveTaskAvailability(task, [rec], today, child);
    expect(av.available).toBe(false); // explicit periodKey wins
    expect(av.status).toBe('approved');
  });

  it('supports Firestore Timestamp-like completedAt ({ toDate })', () => {
    const task = { id: 't-ts', type: 'weekly' as const };
    const rec = {
      id: 'c-ts',
      taskId: 't-ts',
      assigneeId: child,
      status: 'approved',
      completedAt: { toDate: () => new Date(2026, 6, 20, 9, 0) }, // this week
    };
    const laterThisWeek = new Date(2026, 6, 22, 10, 0);
    const av = deriveTaskAvailability(task, [rec], laterThisWeek, child);
    expect(av.available).toBe(false);
    expect(av.status).toBe('approved');
  });
});

describe('completionPeriodKey', () => {
  it('returns stored periodKey when present', () => {
    expect(completionPeriodKey({ periodKey: 'week:2026-07-20' }, 'weekly')).toBe('week:2026-07-20');
  });
  it('derives from completedAt when missing', () => {
    expect(completionPeriodKey({ completedAt: new Date(2026, 6, 20) }, 'daily')).toBe('2026-07-20');
  });
});

describe('weekStart and isInCurrentWeek (shared with weekly scoreboard)', () => {
  it('weekStart returns Monday 00:00:00 of the week containing the date', () => {
    // Sunday 2026-07-26 -> Monday 2026-07-20 00:00:00
    const sun = new Date(2026, 6, 26, 15, 30);
    const ws = weekStart(sun);
    expect(ws.getFullYear()).toBe(2026);
    expect(ws.getMonth()).toBe(6); // July
    expect(ws.getDate()).toBe(20);
    expect(ws.getHours()).toBe(0);
    expect(ws.getMinutes()).toBe(0);
  });

  it('isInCurrentWeek returns true for dates in the current local week', () => {
    // 2026-07-20 is a Monday.
    const now = new Date(2026, 6, 22, 10, 0); // Wednesday
    const thisWeekMon = new Date(2026, 6, 20);
    const thisWeekSun = new Date(2026, 6, 26);
    const lastWeek = new Date(2026, 6, 19);
    const nextWeek = new Date(2026, 6, 27);

    expect(isInCurrentWeek(thisWeekMon, now)).toBe(true);
    expect(isInCurrentWeek(thisWeekSun, now)).toBe(true);
    expect(isInCurrentWeek(lastWeek, now)).toBe(false);
    expect(isInCurrentWeek(nextWeek, now)).toBe(false);
  });

  it('isInCurrentWeek is DST-safe (uses calendar arithmetic)', () => {
    // London springs forward on 2026-03-29.
    // 2026-03-28 late and 2026-03-29 early are different local days.
    const lateSat = new Date(2026, 2, 28, 23, 30);
    const earlySun = new Date(2026, 2, 29, 1, 30);
    // Both are in the same local week (Mon 2026-03-23 .. Sun 2026-03-29)
    expect(isInCurrentWeek(lateSat, earlySun)).toBe(true);
  });
});
