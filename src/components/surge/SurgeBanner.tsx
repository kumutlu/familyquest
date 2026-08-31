/**
 * SurgeBanner — V1 presentation for an active Surge.
 *
 * Architectural rules:
 *   - READ-ONLY. The banner never awards points or XP.
 *   - All reward authority is in the gamification processor.
 *   - Selecting a Surge task invokes the existing `completeTask()` path;
 *     no second completion implementation is introduced here.
 *   - Countdown is derived from `endsAt`. When the window has elapsed
 *     the banner disappears on the next render (the parent unmounts).
 *
 * The banner receives its inputs as plain props; it does NOT fetch from
 * Firestore or read from Zustand directly. The parent (QuestBoard) is
 * the integration point that owns the data lifecycle.
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { SurgeEligibilityDefinition } from '../../domain/surge/types'
import type { TaskSummary } from '../../domain/engagement/resolver'

export interface SurgeBannerProps {
  /** Stable surge id (used as the React key when many banners exist). */
  readonly surgeId: string
  /** Eligibility definition (immutable snapshot of the catalog row). */
  readonly surge: SurgeEligibilityDefinition
  /** Window end timestamp (epoch ms). */
  readonly endsAt: number
  /** Tasks the viewing child may complete under this Surge. */
  readonly eligibleTasks: readonly TaskSummary[]
  /** Triggered when the child picks a Surge task to complete. The
   *  parent's existing `completeTask()` handler MUST be used here. */
  readonly onSelectTask: (taskId: string) => void
}

/** Format a millisecond duration as `mm:ss` for the countdown. */
function formatRemaining(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00'
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function SurgeBanner(props: SurgeBannerProps) {
  const { t } = useTranslation('quests')
  const { surgeId, surge, endsAt, eligibleTasks, onSelectTask } = props

  // Countdown ticker — local-only state, no Firestore writes.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!Number.isFinite(endsAt) || endsAt <= now) return
    const handle = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(handle)
  }, [endsAt, now])

  const remainingMs = endsAt - now
  const expired = remainingMs <= 0

  // Defensive: bonus_points is the only V1 reward type. xp_multiplier is
  // intentionally rejected by the eligibility resolver. We render nothing
  // if we somehow received an unrecognised reward.
  const headline = useMemo(() => {
    if (surge.reward.type !== 'bonus_points') return null
    return t('surge.banner.headline', '+{{amount}} BONUS', {
      amount: surge.reward.amount,
    })
  }, [surge, t])

  if (expired || headline === null || eligibleTasks.length === 0) {
    return null
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={`surge-banner-${surgeId}`}
      className="rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-xs uppercase tracking-wider text-amber-700">
            {t('surge.banner.surgeLabel', 'Surge')}
          </span>
          <span className="text-lg font-semibold text-amber-900">{headline}</span>
        </div>
        <div className="text-sm font-mono text-amber-800">
          {t('surge.banner.remaining', '{{time}} left', {
            time: formatRemaining(remainingMs),
          })}
        </div>
      </div>
      <ul className="mt-3 flex flex-col gap-2">
        {eligibleTasks.map(task => (
          <li key={task.id}>
            <button
              type="button"
              data-testid={`surge-task-${task.id}`}
              onClick={() => onSelectTask(task.id)}
              className="w-full rounded-xl bg-white px-3 py-2 text-left text-sm font-medium text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100"
            >
              {task.title}
              <span className="ml-2 text-xs text-amber-700">
                {t('surge.banner.taskHold', 'Hold to Complete')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}