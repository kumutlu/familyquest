import { fireEvent, render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoldToCompleteButton } from './HoldToCompleteButton';

describe('HoldToCompleteButton', () => {
  let rafCallbacks: number[];
  let nowMs: number;

  let rafSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    rafCallbacks = [];
    nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    rafSpy = vi.fn((_cb: (t: number) => void) => {
      rafCallbacks.push(1);
      return rafCallbacks.length;
    });
    vi.stubGlobal('requestAnimationFrame', rafSpy);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fires exactly once when the hold threshold is reached', () => {
    const onComplete = vi.fn();
    render(<HoldToCompleteButton label="Complete: Feed cat" onComplete={onComplete} />);

    const button = screen.getByTestId('hold-to-complete');
    fireEvent.pointerDown(button, { button: 0 });

    // Drive the rAF loop manually to the threshold.
    const rafSpy = globalThis.requestAnimationFrame as unknown as ReturnType<typeof vi.fn>;
    // First frame: 400ms elapsed
    nowMs = 400;
    act(() => {
      rafSpy.mock.calls[0][0](nowMs);
    });
    expect(onComplete).not.toHaveBeenCalled();

    // Second frame: past the 900ms threshold
    nowMs = 950;
    act(() => {
      rafSpy.mock.calls[1][0](nowMs);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);

    // Repeated frames / pointer events must NOT fire again.
    nowMs = 2000;
    act(() => {
      try {
        rafSpy.mock.calls[2]?.[0](nowMs);
      } catch {
        /* loop may have stopped */
      }
    });
    fireEvent.pointerDown(button, { button: 0 });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('cancels cleanly on early pointer release', () => {
    const onComplete = vi.fn();
    render(<HoldToCompleteButton label="Complete: Feed cat" onComplete={onComplete} />);

    const button = screen.getByTestId('hold-to-complete');
    fireEvent.pointerDown(button, { button: 0 });
    expect(button.getAttribute('data-holding')).toBe('true');

    fireEvent.pointerUp(button);
    expect(onComplete).not.toHaveBeenCalled();
    expect(button.getAttribute('data-holding')).toBeNull();

    // A fresh hold can still complete.
    fireEvent.pointerDown(button, { button: 0 });
    nowMs = 1000;
    act(() => {
      const last = rafSpy.mock.calls.at(-1);
      if (last) last[0](nowMs);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('cancels on pointer cancel / leave without firing', () => {
    const onComplete = vi.fn();
    render(<HoldToCompleteButton label="x" onComplete={onComplete} />);
    const button = screen.getByTestId('hold-to-complete');
    fireEvent.pointerDown(button, { button: 0 });
    fireEvent.pointerCancel(button);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('keyboard activation completes immediately (accessible alternative)', () => {
    const onComplete = vi.fn();
    render(<HoldToCompleteButton label="Complete: Feed cat" onComplete={onComplete} />);
    const button = screen.getByTestId('hold-to-complete');
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(onComplete).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(button, { key: ' ' });
    expect(onComplete).toHaveBeenCalledTimes(1); // still once
  });

  it('does nothing while disabled', () => {
    const onComplete = vi.fn();
    render(<HoldToCompleteButton label="x" onComplete={onComplete} disabled />);
    const button = screen.getByTestId('hold-to-complete');
    fireEvent.pointerDown(button, { button: 0 });
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(onComplete).not.toHaveBeenCalled();
  });
});
