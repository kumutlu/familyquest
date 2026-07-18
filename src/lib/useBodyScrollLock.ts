import { useEffect } from 'react';

/**
 * Centralised body scroll-lock used by all modals.
 *
 * While `locked` is true the background page scroll is disabled by preserving
 * the previous inline `overflow` (and any other style) and restoring it on
 * unlock. This avoids the page-jump-on-close problem and never touches the
 * modal's own internal scroll container, so the modal can still scroll.
 *
 * It also sets `padding-right` to compensate for the removed scrollbar width
 * only when a vertical scrollbar is actually present, preventing layout shift.
 */
export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;

    const body = document.body;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    const previousTouchAction = body.style.touchAction;

    // Capture scrollbar width before locking to avoid layout shift.
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      const currentPadding = parseFloat(getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${currentPadding + scrollbarWidth}px`;
    }
    // Prevent background taps/scroll on touch devices (e.g. bottom nav).
    body.style.touchAction = 'none';

    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
      body.style.touchAction = previousTouchAction;
    };
  }, [locked]);
}
