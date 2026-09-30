/**
 * `useAppearanceSafe` — read the current dark/light preference.
 *
 * The world renderer needs to know whether to use the light or dark
 * palette for a world. The store is a tiny zustand-style hook owned
 * by the rest of the app, but the world layer is intentionally
 * decoupled from it: a host that does not have an appearance store
 * can still mount a world. When the store is missing or throws, the
 * helper returns `false` (light mode default) so the world paints
 * with a sensible palette.
 *
 * Presentation only. No state writes.
 */

import { useEffect, useState } from 'react';

function readClassDark(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    return document.documentElement.classList.contains('dark');
  } catch {
    return false;
  }
}

/**
 * Read the current dark/light preference in a non-throwing way.
 *
 * Listens to the `dark` class on the root element so the world
 * follows the appearance toggles. Returns `false` on the server
 * (matches the appearance store's SSR behaviour).
 */
export function useAppearanceSafe(): boolean {
  const [isDark, setIsDark] = useState<boolean>(() => readClassDark());

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const apply = () => setIsDark(readClassDark());
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  return isDark;
}
