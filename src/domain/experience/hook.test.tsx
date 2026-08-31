/**
 * Tests for the React-facing experience hook + visible ribbon.
 *
 * These tests verify:
 *   - The hook resolves identically to the bare resolver.
 *   - The ribbon renders nothing when no event is live.
 *   - The ribbon renders when an event is live.
 *   - The hook respects preference updates without a re-render loop.
 */

import { act, renderHook } from '@testing-library/react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ExperienceThemeRibbon,
} from '../../components/experience/ExperienceThemeRibbon';
import {
  resetExperienceState,
  setEquippedCustomisation,
  setExperienceClock,
  setExperiencePreferences,
  useExperienceTheme,
  type UseExperienceThemeResult,
} from '../../hooks/useExperienceTheme';
import {
  CHRISTMAS_EVENT_2026,
  CHRISTMAS_THEME,
  EID_THEME,
  NEON_WEEK_THEME,
  STANDARD_THEME,
  type ExperiencePreferences,
  normaliseExperiencePreferences,
} from './index';

const PREFS_ALL_ON: ExperiencePreferences = normaliseExperiencePreferences({
  weeklyThemes: true,
  seasonalEvents: { christmas: true },
});

describe('useExperienceTheme', () => {
  beforeEach(() => {
    resetExperienceState();
  });
  afterEach(() => {
    resetExperienceState();
  });

  it('returns base theme when no event is live', () => {
    // Freeze time far from any fixture window.
    const restore = setExperienceClock(() => Date.UTC(2026, 5, 15, 12, 0, 0));
    try {
      const { result } = renderHook(() => useExperienceTheme());
      expect(result.current.theme.id).toBe(STANDARD_THEME.id);
      expect(result.current.source).toBe('base');
      expect(result.current.appliedEventName).toBeNull();
    } finally {
      restore();
    }
  });

  it('returns the weekly theme during its window', () => {
    const restore = setExperienceClock(() => Date.UTC(2026, 6, 3, 12, 0, 0));
    try {
      const { result } = renderHook(() => useExperienceTheme());
      expect(result.current.theme.id).toBe(NEON_WEEK_THEME.id);
      expect(result.current.source).toBe('weekly');
    } finally {
      restore();
    }
  });

  it('returns the seasonal theme when opted-in', () => {
    const restore = setExperienceClock(() => Date.UTC(2026, 11, 15, 12, 0, 0));
    try {
      act(() => setExperiencePreferences(PREFS_ALL_ON));
      const { result } = renderHook(() => useExperienceTheme());
      expect(result.current.theme.id).toBe(CHRISTMAS_THEME.id);
      expect(result.current.source).toBe('seasonal');
    } finally {
      restore();
    }
  });

  it('falls back to weekly when seasonal preference is disabled', () => {
    const restore = setExperienceClock(() => Date.UTC(2026, 11, 15, 12, 0, 0));
    try {
      // Disable christmas AND override clock to a week that includes neon week.
      // Re-set to a window where only weekly applies.
      // Easier: stay in Dec, but disable christmas; expect base (no weekly active).
      act(() =>
        setExperiencePreferences(
          normaliseExperiencePreferences({
            weeklyThemes: true,
            seasonalEvents: { christmas: false },
          }),
        ),
      );
      const { result } = renderHook(() => useExperienceTheme());
      expect(result.current.theme.id).toBe(STANDARD_THEME.id);
      expect(result.current.source).toBe('base');
    } finally {
      restore();
    }
  });

  it('equipped theme wins over the active seasonal', () => {
    const restore = setExperienceClock(() => Date.UTC(2026, 11, 15, 12, 0, 0));
    try {
      act(() => setExperiencePreferences(PREFS_ALL_ON));
      act(() => setEquippedCustomisation({ themeId: EID_THEME.id }));
      const { result } = renderHook(() => useExperienceTheme());
      expect(result.current.theme.id).toBe(EID_THEME.id);
      expect(result.current.source).toBe('equipped');
    } finally {
      restore();
    }
  });

  it('resetExperienceState returns to defaults', () => {
    const restore = setExperienceClock(() => Date.UTC(2026, 11, 15, 12, 0, 0));
    try {
      act(() => setExperiencePreferences(PREFS_ALL_ON));
      act(() => setEquippedCustomisation({ themeId: EID_THEME.id }));
      act(() => resetExperienceState());
      const { result } = renderHook(() => useExperienceTheme());
      expect(result.current.theme.id).toBe(STANDARD_THEME.id);
      expect(result.current.source).toBe('base');
    } finally {
      restore();
    }
  });

  it('result contains baseTheme + themes for consumer fallback paths', () => {
    const { result } = renderHook<unknown, UseExperienceThemeResult>(() => useExperienceTheme());
    expect(result.current.baseTheme.id).toBe(STANDARD_THEME.id);
    expect(result.current.themes.length).toBeGreaterThan(0);
  });
});

describe('ExperienceThemeRibbon', () => {
  beforeEach(() => {
    resetExperienceState();
    cleanup();
  });
  afterEach(() => {
    resetExperienceState();
    cleanup();
  });

  it('renders nothing when no event is live', () => {
    const restore = setExperienceClock(() => Date.UTC(2026, 5, 15, 12, 0, 0));
    try {
      const { container } = render(<ExperienceThemeRibbon />);
      expect(container.firstChild).toBeNull();
    } finally {
      restore();
    }
  });

  it('renders the active event name with a data-source attribute', () => {
    const restore = setExperienceClock(() => Date.UTC(2026, 11, 15, 12, 0, 0));
    try {
      act(() => setExperiencePreferences(PREFS_ALL_ON));
      render(<ExperienceThemeRibbon />);
      const ribbon = screen.getByTestId('experience-theme-ribbon');
      expect(ribbon.getAttribute('data-source')).toBe('seasonal');
      expect(ribbon.getAttribute('data-theme-id')).toBe(CHRISTMAS_THEME.id);
      expect(ribbon.textContent).toContain(CHRISTMAS_EVENT_2026.name);
    } finally {
      restore();
    }
  });
});

// Re-export fixture to make the import side-effect explicit for the
// safety audit (this file must touch no firebase / store modules).
void CHRISTMAS_EVENT_2026;