import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefersReducedMotion, subscribeReducedMotion, useReducedMotion } from './motion';

type Mql = { matches: boolean; listeners: Set<(e: { matches: boolean }) => void> };

const originalMatchMedia = window.matchMedia;

function installMatchMedia(initialMatches: boolean): Mql {
  const mql: Mql = { matches: initialMatches, listeners: new Set() };
  window.matchMedia = ((query: string) => ({
    matches: query.includes('reduce') ? mql.matches : false,
    addEventListener: (_: string, listener: (e: { matches: boolean }) => void) =>
      mql.listeners.add(listener),
    removeEventListener: (_: string, listener: (e: { matches: boolean }) => void) =>
      mql.listeners.delete(listener),
  })) as unknown as typeof window.matchMedia;
  return mql;
}

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe('reduced-motion service', () => {
  it('reports false when the user has no reduced-motion preference', () => {
    installMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it('reports true when the user prefers reduced motion', () => {
    installMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
  });

  it('subscribes to preference changes and unsubscribes cleanly', () => {
    const mql = installMatchMedia(false);
    const callback = vi.fn();
    const unsubscribe = subscribeReducedMotion(callback);

    mql.matches = true;
    mql.listeners.forEach(listener => listener({ matches: true }));
    expect(callback).toHaveBeenCalledWith(true);

    unsubscribe();
    mql.listeners.forEach(listener => listener({ matches: false }));
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('useReducedMotion reflects the live preference', () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });
});
