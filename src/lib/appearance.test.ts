import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isAppearance,
  getStoredAppearance,
  storeAppearance,
  getSystemPrefersDark,
  resolveResolvedTheme,
  getThemeColor,
  applyTheme,
  subscribeSystemPreference,
  APPEARANCE_STORAGE_KEY,
} from './appearance';

function installMatchMedia(initial: boolean) {
  let handler: ((event: MediaQueryListEvent) => void) | null = null;
  const mql = {
    matches: initial,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: (_type: string, cb: (event: MediaQueryListEvent) => void) => {
      handler = cb;
    },
    removeEventListener: () => {
      handler = null;
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  };
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia;
  return {
    trigger: (next: boolean) => {
      mql.matches = next;
      handler?.({ matches: next } as MediaQueryListEvent);
    },
  };
}

describe('isAppearance', () => {
  it('accepts the three valid values', () => {
    expect(isAppearance('system')).toBe(true);
    expect(isAppearance('light')).toBe(true);
    expect(isAppearance('dark')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isAppearance('auto')).toBe(false);
    expect(isAppearance('')).toBe(false);
    expect(isAppearance(null)).toBe(false);
    expect(isAppearance(undefined)).toBe(false);
    expect(isAppearance(42)).toBe(false);
  });
});

describe('persistence', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to system when nothing is stored', () => {
    expect(getStoredAppearance()).toBe('system');
  });

  it('reads a previously stored value', () => {
    storeAppearance('dark');
    expect(getStoredAppearance()).toBe('dark');
  });

  it('falls back to system for an invalid stored value', () => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, 'banana');
    expect(getStoredAppearance()).toBe('system');
  });

  it('persists the preference so it survives a reload', () => {
    storeAppearance('light');
    expect(localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe('light');
    // Simulate a fresh read (new page / reload)
    expect(getStoredAppearance()).toBe('light');
  });
});

describe('resolveResolvedTheme', () => {
  it('System + OS light renders light', () => {
    expect(resolveResolvedTheme('system', false)).toBe('light');
  });

  it('System + OS dark renders dark', () => {
    expect(resolveResolvedTheme('system', true)).toBe('dark');
  });

  it('explicit Light overrides OS dark', () => {
    expect(resolveResolvedTheme('light', true)).toBe('light');
  });

  it('explicit Dark overrides OS light', () => {
    expect(resolveResolvedTheme('dark', false)).toBe('dark');
  });
});

describe('getSystemPrefersDark', () => {
  it('reflects the OS media query', () => {
    installMatchMedia(true);
    expect(getSystemPrefersDark()).toBe(true);
    installMatchMedia(false);
    expect(getSystemPrefersDark()).toBe(false);
  });
});

describe('getThemeColor', () => {
  it('returns the brand teal for light and the dark neutral for dark', () => {
    expect(getThemeColor('light')).toBe('#0f766e');
    expect(getThemeColor('dark')).toBe('#0e1116');
  });
});

describe('applyTheme', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = '';
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', '#0f766e');
  });

  it('adds the dark class, sets color-scheme and dark theme-color', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#0e1116');
  });

  it('removes the dark class and restores light theme-color', () => {
    document.documentElement.classList.add('dark');
    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#0f766e');
  });
});

describe('subscribeSystemPreference', () => {
  it('invokes the callback on OS changes and supports unsubscribe', () => {
    const { trigger } = installMatchMedia(false);
    const callback = vi.fn();
    const unsubscribe = subscribeSystemPreference(callback);

    expect(callback).not.toHaveBeenCalled();
    trigger(true);
    expect(callback).toHaveBeenCalledWith(true);
    trigger(false);
    expect(callback).toHaveBeenCalledWith(false);

    unsubscribe();
    trigger(true);
    expect(callback).toHaveBeenCalledTimes(2);
  });
});
