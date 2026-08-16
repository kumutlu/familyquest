import { create } from 'zustand';
import {
  type Appearance,
  type ResolvedTheme,
  getStoredAppearance,
  storeAppearance,
  getSystemPrefersDark,
  resolveResolvedTheme,
  applyTheme,
  subscribeSystemPreference,
} from '../lib/appearance';

interface AppearanceState {
  /** The user's chosen preference (defaults to `system`). */
  appearance: Appearance;
  /** Live OS dark-mode flag, kept in sync via a matchMedia listener. */
  systemDark: boolean;
  /** The concrete theme currently applied to the document. */
  resolvedTheme: ResolvedTheme;
  initialized: boolean;
  /** Persist and apply a new preference. */
  setAppearance: (value: Appearance) => void;
  /** Read storage, apply the initial theme, and start listening for OS changes. */
  initAppearance: () => void;
}

let unsubscribeSystem: (() => void) | null = null;

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  appearance: 'system',
  systemDark: false,
  resolvedTheme: 'light',
  initialized: false,

  setAppearance: (value) => {
    storeAppearance(value);
    const resolved = resolveResolvedTheme(value, get().systemDark);
    applyTheme(resolved);
    set({ appearance: value, resolvedTheme: resolved });
  },

  initAppearance: () => {
    if (get().initialized) return;
    const appearance = getStoredAppearance();
    const systemDark = getSystemPrefersDark();
    const resolved = resolveResolvedTheme(appearance, systemDark);
    applyTheme(resolved);
    set({ appearance, systemDark, resolvedTheme: resolved, initialized: true });

    // Keep the rendered theme in sync with the OS only while System is active.
    unsubscribeSystem = subscribeSystemPreference((dark) => {
      const resolved = resolveResolvedTheme(get().appearance, dark);
      applyTheme(resolved);
      set({ systemDark: dark, resolvedTheme: resolved });
    });
  },
}));

/**
 * Erase the OS listener. Exposed for tests; the app lives for the lifetime of
 * the page so it is not strictly required in production.
 */
export function disposeAppearance(): void {
  unsubscribeSystem?.();
  unsubscribeSystem = null;
}

/**
 * Convenience hook returning the current appearance state plus a few derived
 * helpers. Mirrors the existing `useStore`/`useTranslation` calling pattern.
 */
export function useAppearance() {
  const appearance = useAppearanceStore((s) => s.appearance);
  const resolvedTheme = useAppearanceStore((s) => s.resolvedTheme);
  const systemDark = useAppearanceStore((s) => s.systemDark);
  const setAppearance = useAppearanceStore((s) => s.setAppearance);
  return {
    appearance,
    resolvedTheme,
    isDark: resolvedTheme === 'dark',
    systemDark,
    setAppearance,
  };
}
