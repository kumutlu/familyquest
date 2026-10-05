/**
 * Theme preview override — presentation-only channel for the Theme Shop.
 *
 * Why this exists
 * ---------------
 * The child's theme is applied by a SINGLE persistent boundary that sits above
 * the router outlet (see `ChildThemeBoundary`). That gives one world plate and
 * one token scope for every child route — but it also means a descendant like
 * the Theme Shop can no longer mount its own shell to preview the world it is
 * selling: nesting a second shell would stack two painted plates and decode
 * the same artwork twice.
 *
 * So the shop does not mount a shell. It PUBLISHES the theme it wants the child
 * to preview, and the already-mounted boundary adopts it for as long as the
 * shop is on screen. One shell, one plate, live preview.
 *
 * Contract
 * --------
 *   - Presentation only. Never encodes ownership, price or eligibility, and
 *     never writes to Firestore. The shop decides what a child may BUY; this
 *     only decides what the background looks like while they look at it.
 *   - The override is cleared on unmount, so navigating away restores the
 *     child's real equipped theme with no visit to Home required.
 */

import { useEffect } from 'react';
import { useSyncExternalStore } from 'react';
import type { ResolvedExperienceTheme } from './types';

let override: ResolvedExperienceTheme | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Read the currently published override. `null` means "use the real theme". */
export function getThemePreviewOverride(): ResolvedExperienceTheme | null {
  return override;
}

export function subscribeThemePreviewOverride(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Publish (or clear) the previewed theme. Passing the same identity twice is a
 * no-op so a re-render cannot spin the boundary.
 */
export function setThemePreviewOverride(next: ResolvedExperienceTheme | null): void {
  if (override === next) return;
  override = next;
  emit();
}

/** Test helper — clears the channel without subscribing. */
export function resetThemePreviewOverride(): void {
  if (override === null) return;
  override = null;
  emit();
}

/** Subscribe a component to the published preview theme. */
export function useThemePreviewOverride(): ResolvedExperienceTheme | null {
  return useSyncExternalStore(
    subscribeThemePreviewOverride,
    getThemePreviewOverride,
    getThemePreviewOverride,
  );
}

/**
 * Publish a theme for as long as the calling surface is mounted.
 *
 * Called with `null` this is a no-op, so surfaces that are NOT previewing
 * anything (the normal case: Home, Quests, Rewards…) never touch the channel.
 */
export function useThemePreviewPublisher(theme: ResolvedExperienceTheme | null): void {
  useEffect(() => {
    if (!theme) return;
    setThemePreviewOverride(theme);
    return () => {
      resetThemePreviewOverride();
    };
  }, [theme]);
}
