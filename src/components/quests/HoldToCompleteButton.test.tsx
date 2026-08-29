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
    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 20, clientY: 20 });

    nowMs = 400;
    act(() => {
      rafSpy.mock.calls[0][0](nowMs);
    });
    expect(onComplete).not.toHaveBeenCalled();

    nowMs = 950;
    act(() => {
      rafSpy.mock.calls[1][0](nowMs);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);

    nowMs = 2000;
    act(() => {
      try {
        rafSpy.mock.calls[2]?.[0](nowMs);
      } catch {
        /* loop may have stopped */
      }
    });
    fireEvent.pointerDown(button, { button: 0, pointerId: 2, clientX: 20, clientY: 20 });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('cancels cleanly on early pointer release', () => {
    const onComplete = vi.fn();
    render(<HoldToCompleteButton label="Complete: Feed cat" onComplete={onComplete} />);

    const button = screen.getByTestId('hold-to-complete');
    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 20, clientY: 20 });
    expect(button.getAttribute('data-holding')).toBe('true');

    fireEvent.pointerUp(button, { pointerId: 1 });
    expect(onComplete).not.toHaveBeenCalled();
    expect(button.getAttribute('data-holding')).toBeNull();

    fireEvent.pointerDown(button, { button: 0, pointerId: 2, clientX: 20, clientY: 20 });
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
    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerCancel(button, { pointerId: 1 });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('does not bypass the hold threshold when reduced motion is enabled', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));

    const onComplete = vi.fn();
    render(<HoldToCompleteButton label="Complete: Feed cat" onComplete={onComplete} />);

    const button = screen.getByTestId('hold-to-complete');
    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 20, clientY: 20 });

    expect(onComplete).not.toHaveBeenCalled();

    nowMs = 950;
    act(() => {
      const last = rafSpy.mock.calls.at(-1);
      if (last) last[0](nowMs);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('cancels the hold when the pointer moves far enough to indicate scrolling', () => {
    const onComplete = vi.fn();
    render(<HoldToCompleteButton label="Complete: Feed cat" onComplete={onComplete} />);

    const button = screen.getByTestId('hold-to-complete');
    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 20, clientY: 20 });
    expect(button.getAttribute('data-holding')).toBe('true');

    fireEvent.pointerMove(button, { pointerId: 1, clientX: 20, clientY: 48 });
    expect(button.getAttribute('data-holding')).toBeNull();

    nowMs = 1200;
    act(() => {
      const last = rafSpy.mock.calls.at(-1);
      if (last) last[0](nowMs);
    });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('keyboard activation completes immediately (accessible alternative)', () => {
    const onComplete = vi.fn();
    render(<HoldToCompleteButton label="Complete: Feed cat" onComplete={onComplete} />);
    const button = screen.getByTestId('hold-to-complete');
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(onComplete).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(button, { key: ' ' });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('does nothing while disabled', () => {
    const onComplete = vi.fn();
    render(<HoldToCompleteButton label="x" onComplete={onComplete} disabled />);
    const button = screen.getByTestId('hold-to-complete');
    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(onComplete).not.toHaveBeenCalled();
  });
});
