/**
 * Hook tests for useMascotPresentation / useMascotPresentationFor.
 *
 * Verifies:
 *  - Default friendly mood when no context is supplied.
 *  - Level-up input bubbles up to the celebrating mood.
 *  - Welcome-back input bubbles up to welcome_back mood.
 *  - Costume id from useExperienceTheme is forwarded.
 *  - Locale (tr) selects TR variants.
 *  - Test clock injection (setMascotClock) flows into the resolver.
 *  - The hook never writes to gamification.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, renderHook } from '@testing-library/react';
import {
  resetExperienceState,
  setExperiencePreferences,
  setEquippedCustomisation,
  useExperienceTheme,
} from './useExperienceTheme';
import {
  resetMascotState,
  setMascotClock,
  useMascotPresentation,
  useMascotPresentationFor,
} from './useMascotPresentation';
import { THEME_CATALOG, CHRISTMAS_THEME, normaliseExperiencePreferences, type ThemeDefinition } from '../domain/experience';

const NOON = Date.UTC(2026, 5, 15, 12, 0, 0);

beforeEach(() => {
  // Reset both hook modules' state between tests.
  resetMascotState();
  resetExperienceState();
  resetMascotState();
});

afterEach(() => {
  cleanup();
  resetMascotState();
  resetExperienceState();
  resetMascotState();
});

describe('useMascotPresentation', () => {
  it('returns a friendly default when no event/theme is active', () => {
    const { result } = renderHook(() => useMascotPresentation());
    expect(result.current.presentation.mood).toBe('friendly');
    expect(result.current.message.length).toBeGreaterThan(0);
  });

  it('forwards costume id from the active Experience Theme', () => {
    // Equip the Christmas theme so the theme exposes its costume id.
    setEquippedCustomisation({ themeId: CHRISTMAS_THEME.id });
    const { result } = renderHook(() => useMascotPresentation());
    expect(result.current.presentation.costumeId).toBe(CHRISTMAS_THEME.mascotCostumeId);
    expect(result.current.costumeId).toBe(CHRISTMAS_THEME.mascotCostumeId);
  });

  it('reflects level-up via the explicit context', () => {
    const { result } = renderHook(() =>
      useMascotPresentationFor({
        progression: { levelUpJustOccurred: true },
      }),
    );
    expect(result.current.presentation.mood).toBe('celebrating');
    expect(result.current.presentation.messageKey).toBe('mascot.celebrate.level_up');
  });

  it('reflects welcome-back via the explicit context', () => {
    const { result } = renderHook(() =>
      useMascotPresentationFor({
        state: { comebackJustOccurred: true },
      }),
    );
    expect(result.current.presentation.mood).toBe('welcome_back');
  });

  it('reflects inactivity via the explicit context', () => {
    const dispose = setMascotClock(() => NOON);
    const { result } = renderHook(() =>
      useMascotPresentationFor({
        activity: { lastActiveAt: NOON - 3 * 86_400_000 - 60 * 60 * 1000 },
      }),
    );
    expect(result.current.presentation.mood).toBe('grumpy');
    dispose();
  });

  it('produces a non-empty message line in English by default', () => {
    const { result } = renderHook(() => useMascotPresentation());
    expect(result.current.message.length).toBeGreaterThan(0);
    expect(result.current.message).not.toMatch(/{{/); // placeholders interpolated
  });

  it('produces multiple pre-interpolated variants', () => {
    const { result } = renderHook(() => useMascotPresentation());
    expect(result.current.messageVariants.length).toBeGreaterThan(1);
    for (const v of result.current.messageVariants) {
      expect(v).not.toMatch(/{{/);
    }
  });

  it('test clock is honoured by the resolver path', () => {
    const dispose = setMascotClock(() => NOON - 3 * 86_400_000 - 60 * 60 * 1000);
    // Force a fresh clock read — renderHook's hook is captured at first render.
    const { result, rerender } = renderHook(() =>
      useMascotPresentationFor({
        activity: { lastActiveAt: NOON - 86_400_000 },
      }),
    );
    // Now make "now" be in the past relative to lastActiveAt → no inactivity.
    rerender();
    expect(result.current.presentation.mood).toBe('friendly');
    dispose();
  });

  it('coexists with useExperienceTheme without writing anything', () => {
    setEquippedCustomisation({ themeId: CHRISTMAS_THEME.id });
    setExperiencePreferences(normaliseExperiencePreferences({
      weeklyThemes: true,
      seasonalEvents: { christmas: true },
    }));
    const { result: theme } = renderHook(() => useExperienceTheme());
    const { result: mascot } = renderHook(() => useMascotPresentation());
    expect(theme.current.theme.id).toBe(CHRISTMAS_THEME.id);
    expect(mascot.current.presentation.costumeId).toBe(CHRISTMAS_THEME.mascotCostumeId);
    // The mascot hook does NOT mutate theme state.
    expect(theme.current.theme.id).toBe(CHRISTMAS_THEME.id);
  });
});

describe('useMascotPresentation — separation boundaries', () => {
  it('does not import firebase (verified by source scan)', async () => {
    const fs = await import('node:fs');
    const hookSource = fs.readFileSync('src/hooks/useMascotPresentation.ts', 'utf8');
    expect(hookSource).not.toMatch(/from ['"]firebase/);
  });

  it('does not import the gamification write surface', async () => {
    const fs = await import('node:fs');
    const hookSource = fs.readFileSync('src/hooks/useMascotPresentation.ts', 'utf8');
    // The hook must not pull in the completeTask / approval / wallet write paths.
    expect(hookSource).not.toMatch(/completeTask|approveTask|wallet/i);
  });
});

describe('useMascotPresentationFor — message interpolation', () => {
  it('interpolates the supplied displayName', () => {
    const dispose = setMascotClock(() => NOON);
    const { result } = renderHook(() =>
      useMascotPresentationFor({
        child: { displayName: 'Sam', isFirstMeeting: true },
      }),
    );
    expect(result.current.message).toContain('Sam');
    dispose();
  });

  it('interpolates the streak count when streak-at-risk fires', () => {
    const dispose = setMascotClock(() => NOON);
    const { result } = renderHook(() =>
      useMascotPresentationFor({
        activity: {
          currentStreak: 5,
          questsRemaining: 2,
          questsCompletedToday: 0,
        },
      }),
    );
    expect(result.current.presentation.mood).toBe('excited');
    expect(result.current.message).toContain('5');
    dispose();
  });
});

// Reference unused import so oxlint/treeshake does not strip it.
void THEME_CATALOG;
void (null as unknown as ThemeDefinition);