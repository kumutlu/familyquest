/**
 * RED tests for Mascot Engine integration with Surge + Daily Engagement.
 *
 * Architectural law:
 *   The Mascot Engine never knows what a Surge IS.
 *   It only consumes `engagement.activeSurge` / `engagement.surgeEndingSoon`
 *   from the Daily Engagement resolver and renders an appropriate
 *   reaction. All Surge authority lives in the Surge domain module and
 *   the gamification processor.
 *
 * Priority rules:
 *   - Surge is BELOW major achievement / all-quests-complete (the brief).
 *   - Surge ending-soon is BELOW streak-at-risk but ABOVE seasonal/theme.
 *   - Surge active is BELOW ending-soon but ABOVE seasonal/theme.
 */
import { describe, expect, it } from 'vitest'

import { resolveMascotPresentation } from './resolver'
import type { MascotContext } from './types'
import { DEFAULT_MASCOT_PRESENTATION } from './types'

const BASE_CONTEXT: MascotContext = {
  now: Date.UTC(2026, 5, 1, 14, 0, 0), // mid-afternoon
  activity: {
    lastActiveAt: Date.UTC(2026, 5, 1, 8, 0, 0),
    questsRemaining: 2,
    questsCompletedToday: 0,
    currentStreak: 0,
  },
}

describe('resolveMascotPresentation — Surge reaction layers', () => {
  it('uses shocked/excited when a Surge is ending soon', () => {
    const result = resolveMascotPresentation({
      context: {
        ...BASE_CONTEXT,
        engagement: { activeSurge: true, surgeEndingSoon: true },
      },
    })
    expect(result.priorityTag).toBe('surge-ending-soon')
    expect(result.mood).toBe('shocked')
    expect(result.messageKey).toBe('mascot.surge.ending_soon')
  })

  it('uses excited/sparkle when a Surge is active (not ending soon)', () => {
    const result = resolveMascotPresentation({
      context: {
        ...BASE_CONTEXT,
        engagement: { activeSurge: true, surgeEndingSoon: false },
      },
    })
    expect(result.priorityTag).toBe('surge-active')
    expect(result.mood).toBe('excited')
    expect(result.messageKey).toBe('mascot.surge.active')
  })

  it('does NOT show a Surge reaction when engagement is missing', () => {
    const result = resolveMascotPresentation({ context: BASE_CONTEXT })
    expect(['default', 'seasonal']).toContain(result.priorityTag)
    expect(result.messageKey).not.toMatch(/mascot\.surge/)
  })

  it('does NOT show a Surge reaction when activeSurge is false', () => {
    const result = resolveMascotPresentation({
      context: {
        ...BASE_CONTEXT,
        engagement: { activeSurge: false, surgeEndingSoon: false },
      },
    })
    expect(['default', 'seasonal']).toContain(result.priorityTag)
    expect(result.messageKey).not.toMatch(/mascot\.surge/)
  })
})

describe('resolveMascotPresentation — Surge is BELOW achievements (priority)', () => {
  it('level up still wins over Surge ending-soon', () => {
    const result = resolveMascotPresentation({
      context: {
        ...BASE_CONTEXT,
        progression: { levelUpJustOccurred: true },
        engagement: { activeSurge: true, surgeEndingSoon: true },
      },
    })
    expect(result.priorityTag).toBe('level-up')
  })

  it('all quests complete still wins over Surge ending-soon', () => {
    const result = resolveMascotPresentation({
      context: {
        ...BASE_CONTEXT,
        activity: {
          ...BASE_CONTEXT.activity,
          allQuestsCompleted: true,
        },
        engagement: { activeSurge: true, surgeEndingSoon: true },
      },
    })
    expect(result.priorityTag).toBe('all-quests-complete')
  })

  it('welcome back still wins over Surge active', () => {
    const result = resolveMascotPresentation({
      context: {
        ...BASE_CONTEXT,
        state: { comebackJustOccurred: true },
        engagement: { activeSurge: true, surgeEndingSoon: false },
      },
    })
    expect(result.priorityTag).toBe('welcome-back')
  })

  it('streak at risk still wins over Surge active', () => {
    const result = resolveMascotPresentation({
      context: {
        ...BASE_CONTEXT,
        activity: {
          lastActiveAt: BASE_CONTEXT.now,
          questsRemaining: 2,
          questsCompletedToday: 0,
          currentStreak: 4,
        },
        engagement: { activeSurge: true, surgeEndingSoon: false },
      },
    })
    expect(result.priorityTag).toBe('streak-at-risk')
  })
})

describe('resolveMascotPresentation — Surge vs seasonal', () => {
  it('Surge ending-soon beats a passive seasonal theme', () => {
    const result = resolveMascotPresentation({
      context: {
        ...BASE_CONTEXT,
        event: { activeThemeId: 'theme.christmas', mascotCostumeId: 'costume.santa' },
        engagement: { activeSurge: true, surgeEndingSoon: true },
      },
    })
    expect(result.priorityTag).toBe('surge-ending-soon')
    // Costume is still forwarded when the mascot has one.
    expect(result.costumeId).toBe('costume.santa')
  })

  it('Surge active also beats passive seasonal theme', () => {
    const result = resolveMascotPresentation({
      context: {
        ...BASE_CONTEXT,
        event: { activeThemeId: 'theme.christmas', mascotCostumeId: 'costume.santa' },
        engagement: { activeSurge: true, surgeEndingSoon: false },
      },
    })
    expect(result.priorityTag).toBe('surge-active')
    expect(result.costumeId).toBe('costume.santa')
  })
})

describe('resolveMascotPresentation — defensive defaults', () => {
  it('still returns the safe default when engagement is malformed', () => {
    const result = resolveMascotPresentation({
      context: {
        ...BASE_CONTEXT,
        engagement: null as unknown as MascotContext['engagement'],
      },
    })
    expect(['default', 'seasonal']).toContain(result.priorityTag)
    expect(result.messageKey).toBe(DEFAULT_MASCOT_PRESENTATION.messageKey)
  })
})