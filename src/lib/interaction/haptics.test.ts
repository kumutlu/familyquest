import { afterEach, describe, expect, it, vi } from 'vitest';
import { hapticsSupported, triggerHaptic } from './haptics';

const originalNavigator = globalThis.navigator;

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, 'navigator', {
    value: originalNavigator,
    configurable: true,
    writable: true,
  });
});

function withVibrate(vibrate?: (p: number | number[]) => boolean) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { ...(originalNavigator ?? {}), vibrate },
    configurable: true,
    writable: true,
  });
}

describe('haptics abstraction', () => {
  it('reports unsupported when the platform has no vibration API', () => {
    withVibrate(undefined);
    expect(hapticsSupported()).toBe(false);
  });

  it('reports supported only when navigator.vibrate exists', () => {
    withVibrate(() => true);
    expect(hapticsSupported()).toBe(true);
  });

  it('fires a subtle clamped pattern for taps', () => {
    const vibrate = vi.fn(() => true);
    withVibrate(vibrate);
    triggerHaptic('tap');
    expect(vibrate).toHaveBeenCalledWith([8]);
  });

  it('never throws when the engine rejects the pattern', () => {
    withVibrate(() => {
      throw new Error('NotAllowedError');
    });
    expect(() => triggerHaptic('celebrate')).not.toThrow();
  });

  it('is a safe no-op without any vibration support', () => {
    withVibrate(undefined);
    expect(() => triggerHaptic('success')).not.toThrow();
  });

  it('keeps every segment subtle (≤60ms)', () => {
    const vibrate = vi.fn((_pattern: number | number[]) => true);
    withVibrate(vibrate);
    triggerHaptic('celebrate');
    const pattern = vibrate.mock.calls[0]?.[0] as unknown as number[];
    expect(Math.max(...pattern)).toBeLessThanOrEqual(60);
  });

  // ---- Wave 2 semantic patterns ---------------------------------------------
  it.each(['hold', 'submit', 'approve', 'reject', 'queueComplete'] as const)(
    'fires a subtle clamped pattern for %s',
    (patternName) => {
      const vibrate = vi.fn((_pattern: number | number[]) => true);
      withVibrate(vibrate);
      triggerHaptic(patternName);
      expect(vibrate).toHaveBeenCalled();
      const pattern = vibrate.mock.calls[0]?.[0] as unknown as number[];
      expect(pattern.length).toBeGreaterThan(0);
      expect(Math.max(...pattern)).toBeLessThanOrEqual(60);
    },
  );
});
