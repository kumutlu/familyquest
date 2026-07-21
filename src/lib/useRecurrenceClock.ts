import { useEffect, useState } from 'react';
import { localDateKey, localWeekKey } from './taskRecurrence';

/**
 * Returns the current time, but only triggers a re-render when the local
 * day or week boundary crosses while the session is open.
 *
 * Views that derive recurring-task availability (Tasks) or the weekly
 * scoreboard (Family) compute their state from `new Date()`. Without this
 * hook a task that was completed "yesterday" would stay shown as completed
 * after midnight (and the weekly scoreboard would not roll over on Monday)
 * until some unrelated re-render happened. This hook makes the boundary
 * crossing itself drive a refresh — no full page reload required.
 *
 * The interval is coarse (30s); state only updates on an actual day/week
 * change, so idle sessions are not constantly re-rendering.
 */
export function useRecurrenceClock(): Date {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    let lastDate = localDateKey(now);
    let lastWeek = localWeekKey(now);

    const id = window.setInterval(() => {
      const next = new Date();
      const d = localDateKey(next);
      const w = localWeekKey(next);
      if (d !== lastDate || w !== lastWeek) {
        lastDate = d;
        lastWeek = w;
        setNow(next);
      }
    }, 30_000);

    return () => window.clearInterval(id);
  }, []);

  return now;
}
