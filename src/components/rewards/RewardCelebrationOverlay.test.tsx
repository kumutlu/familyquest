import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { RewardCelebrationOverlay } from './RewardCelebrationOverlay';
import SOURCE from './RewardCelebrationOverlay.tsx?raw';
import STYLES from './rewardCelebration.css?raw';

function setReducedMotion(reduced: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

beforeEach(() => {
  setReducedMotion(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('RewardCelebrationOverlay', () => {
  it('renders nothing while closed', () => {
    render(
      <RewardCelebrationOverlay
        open={false}
        rewardTitle="Cinema trip"
        beforePoints={80}
        afterPoints={60}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('reward-celebration-overlay')).toBeNull();
  });

  it('renders the supplied reward title and before/after points', () => {
    render(
      <RewardCelebrationOverlay
        open
        rewardTitle="Cinema trip"
        beforePoints={80}
        afterPoints={60}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId('reward-celebration-reward-title')).toHaveTextContent('Cinema trip');
    expect(screen.getByTestId('reward-celebration-points-before')).toHaveTextContent('80');
    expect(screen.getByTestId('reward-celebration-points-after')).toHaveTextContent('60');
  });

  it('is reusable for a different reward with different points', () => {
    const { rerender } = render(
      <RewardCelebrationOverlay
        open
        rewardTitle="Cinema trip"
        beforePoints={80}
        afterPoints={60}
        onClose={vi.fn()}
      />,
    );
    rerender(
      <RewardCelebrationOverlay
        open
        rewardTitle="Board game night"
        beforePoints={1234}
        afterPoints={1200}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId('reward-celebration-reward-title')).toHaveTextContent('Board game night');
    expect(screen.getByTestId('reward-celebration-points-before')).toHaveTextContent('1234');
    expect(screen.getByTestId('reward-celebration-points-after')).toHaveTextContent('1200');
  });

  it('never hard-codes reference reward data', () => {
    expect(SOURCE).not.toMatch(/Skittles/i);
    expect(SOURCE).not.toMatch(/\b(250|225)\b/);
    expect(STYLES).not.toMatch(/Skittles/i);
  });

  it('closes on Escape and via the Awesome button', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <RewardCelebrationOverlay
        open
        rewardTitle="Cinema trip"
        beforePoints={80}
        afterPoints={60}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <RewardCelebrationOverlay
        open
        rewardTitle="Cinema trip"
        beforePoints={80}
        afterPoints={60}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId('reward-celebration-awesome'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('traps Tab on the Awesome button', () => {
    render(
      <RewardCelebrationOverlay
        open
        rewardTitle="Cinema trip"
        beforePoints={80}
        afterPoints={60}
        onClose={vi.fn()}
      />,
    );
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByTestId('reward-celebration-awesome'));
  });

  it('restores focus to the previously focused element after close', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Redeem';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const onClose = vi.fn();
    render(
      <RewardCelebrationOverlay
        open
        rewardTitle="Cinema trip"
        beforePoints={80}
        afterPoints={60}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId('reward-celebration-awesome'));
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('respects prefers-reduced-motion: no animation frames, focus is ready immediately', () => {
    setReducedMotion(true);
    const raf = vi.spyOn(window, 'requestAnimationFrame');

    render(
      <RewardCelebrationOverlay
        open
        rewardTitle="Cinema trip"
        beforePoints={80}
        afterPoints={60}
        onClose={vi.fn()}
      />,
    );

    const overlay = screen.getByTestId('reward-celebration-overlay');
    expect(overlay).toHaveAttribute('data-reduced-motion', 'true');
    expect(overlay.className).toContain('is-ready');
    expect(raf).not.toHaveBeenCalled();
  });

  it('cancels animation frames and timers when dismissed', () => {
    vi.useFakeTimers();
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const clear = vi.spyOn(window, 'clearTimeout');

    const { rerender } = render(
      <RewardCelebrationOverlay
        open
        rewardTitle="Cinema trip"
        beforePoints={80}
        afterPoints={60}
        onClose={vi.fn()}
      />,
    );

    act(() => { vi.advanceTimersByTime(500); });

    rerender(
      <RewardCelebrationOverlay
        open={false}
        rewardTitle="Cinema trip"
        beforePoints={80}
        afterPoints={60}
        onClose={vi.fn()}
      />,
    );

    expect(cancel).toHaveBeenCalled();
    expect(clear).toHaveBeenCalled();
    expect(screen.queryByTestId('reward-celebration-overlay')).toBeNull();
  });

  it('cleans up on unmount', () => {
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const { unmount } = render(
      <RewardCelebrationOverlay
        open
        rewardTitle="Cinema trip"
        beforePoints={80}
        afterPoints={60}
        onClose={vi.fn()}
      />,
    );
    unmount();
    expect(cancel).toHaveBeenCalled();
    expect(document.querySelector('[data-testid="reward-celebration-overlay"]')).toBeNull();
  });

  it('uses no Canva SDK, CDN scripts, Tailwind CDN or Google Fonts', () => {
    for (const text of [SOURCE, STYLES]) {
      // Only the documentation reference may mention Canva; no SDK/global usage.
      expect(text).not.toMatch(/canva[-.]?sdk|window\.canva|cdn\.canva/i);
      expect(text).not.toMatch(/from ['"][^'"]*canva[^'"]*['"]/i);
      expect(text).not.toMatch(/https?:\/\//);
      expect(text).not.toMatch(/cdn\./i);
      expect(text).not.toMatch(/fonts\.googleapis/i);
    }
  });

  it('sound failures never break the celebration', () => {
    vi.stubGlobal('AudioContext', function BrokenAudioContext() {
      throw new Error('audio unavailable');
    } as unknown as typeof AudioContext);

    expect(() =>
      render(
        <RewardCelebrationOverlay
          open
          rewardTitle="Cinema trip"
          beforePoints={80}
          afterPoints={60}
          onClose={vi.fn()}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByTestId('reward-celebration-overlay')).toBeInTheDocument();
  });
});
