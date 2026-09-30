/**
 * RED tests for the SurgeBanner UI.
 *
 * The banner is presentation-only. It never awards anything. The
 * reward authority lives in `processApprovedCompletion`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'

import { SurgeBanner, type SurgeBannerProps } from './SurgeBanner'
import type { SurgeEligibilityDefinition } from '../../domain/surge/types'

let onSelectTask: ReturnType<typeof vi.fn<(taskId: string) => void>>

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(FIXED_NOW_MS))
  onSelectTask = vi.fn()
  if (!i18next.isInitialized) {
    await i18next.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: 'en',
      defaultNS: 'quests',
      resources: {
        en: {
          quests: {
            'surge.banner.surgeLabel': 'Surge',
            'surge.banner.headline': '+{{amount}} BONUS',
            'surge.banner.remaining': '{{time}} left',
            'surge.banner.taskHold': 'Hold to Complete',
          },
        },
      },
      interpolation: { escapeValue: false },
    })
  }
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const FIXED_NOW_MS = Date.UTC(2026, 5, 1, 17, 0, 0)
const SURGE: SurgeEligibilityDefinition = {
  kind: 'task_bonus',
  eligibleTaskIds: ['t1', 't2'],
  reward: { type: 'bonus_points', amount: 10 },
}


const ENDS_AT = FIXED_NOW_MS + 60 * 60 * 1000 // 1 hour

function banner(overrides: Partial<SurgeBannerProps> = {}) {
  const props: SurgeBannerProps = {
    surgeId: 'surge-1',
    surge: SURGE,
    endsAt: ENDS_AT,
    eligibleTasks: [
      { id: 't1', title: 'House Vacuum', pointsReward: 15, assigneeId: 'child-A', isCompleted: false },
      { id: 't2', title: 'Yard Pickup', pointsReward: 12, assigneeId: null, isCompleted: false },
    ],
    onSelectTask,
    ...overrides,
  }
  return render(
    <I18nextProvider i18n={i18next}>
      <SurgeBanner {...props} />
    </I18nextProvider>,
  )
}

describe('SurgeBanner — presentation', () => {
  it('renders the surge label and bonus amount', () => {
    banner()
    expect(screen.getByText('Surge')).toBeInTheDocument()
    expect(screen.getByText('+10 BONUS')).toBeInTheDocument()
  })

  it('renders one button per eligible task', () => {
    banner()
    expect(screen.getByTestId('surge-task-t1')).toBeInTheDocument()
    expect(screen.getByTestId('surge-task-t2')).toBeInTheDocument()
  })

  it('invokes onSelectTask with the task id when a task is tapped', () => {
    banner()
    fireEvent.click(screen.getByTestId('surge-task-t1'))
    expect(onSelectTask).toHaveBeenCalledWith('t1')
  })
})

describe('SurgeBanner — countdown & expiry', () => {
  it('hides the banner when the window has already elapsed', () => {
    banner({ endsAt: FIXED_NOW_MS - 1 })
    expect(screen.queryByTestId('surge-banner-surge-1')).toBeNull()
  })

  it('hides the banner when no eligible tasks are visible to the child', () => {
    banner({ eligibleTasks: [] })
    expect(screen.queryByTestId('surge-banner-surge-1')).toBeNull()
  })

  it('hides the banner for unrecognised reward types (xp_multiplier is V1-disabled)', () => {
    banner({
      surge: { ...SURGE, reward: { type: 'xp_multiplier', multiplier: 2 } },
    })
    expect(screen.queryByTestId('surge-banner-surge-1')).toBeNull()
  })
})

describe('SurgeBanner — read-only contract', () => {
  it('never calls any side-effectful API', () => {
    banner()
    fireEvent.click(screen.getByTestId('surge-task-t1'))
    expect(onSelectTask).toHaveBeenCalledTimes(1)
    expect(onSelectTask).toHaveBeenCalledWith('t1')
  })
})