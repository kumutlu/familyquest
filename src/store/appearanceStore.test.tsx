import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppearanceStore, disposeAppearance } from './appearanceStore';
import { APPEARANCE_STORAGE_KEY } from '../lib/appearance';

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

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  document.documentElement.style.colorScheme = '';
  useAppearanceStore.setState({
    appearance: 'system',
    systemDark: false,
    resolvedTheme: 'light',
    initialized: false,
  });
  disposeAppearance();
});

describe('appearanceStore', () => {
  it('defaults to system', () => {
    expect(useAppearanceStore.getState().appearance).toBe('system');
  });

  it('setAppearance persists and applies the dark class', () => {
    useAppearanceStore.getState().setAppearance('dark');
    expect(localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(useAppearanceStore.getState().resolvedTheme).toBe('dark');
  });

  it('initAppearance reads the stored preference and applies it', () => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, 'light');
    useAppearanceStore.getState().initAppearance();
    expect(useAppearanceStore.getState().appearance).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(useAppearanceStore.getState().initialized).toBe(true);
  });

  it('updates the resolved theme when the OS changes while System is selected', () => {
    const mq = installMatchMedia(false);
    useAppearanceStore.getState().initAppearance();
    expect(useAppearanceStore.getState().resolvedTheme).toBe('light');

    mq.trigger(true);
    expect(useAppearanceStore.getState().resolvedTheme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('does NOT let an OS change override an explicit preference', () => {
    const mq = installMatchMedia(false);
    useAppearanceStore.getState().initAppearance();
    useAppearanceStore.getState().setAppearance('light'); // explicit

    mq.trigger(true); // OS goes dark
    expect(useAppearanceStore.getState().resolvedTheme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
