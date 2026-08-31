/**
 * Component tests for the <Mascot /> surface.
 *
 * Verifies:
 *  - Default friendly rendering when no presentation is supplied.
 *  - Mood + expression forwarded into data-* attributes.
 *  - Costume id forwarded from the presentation.
 *  - src prop swaps the placeholder art entirely.
 *  - Custom descriptor path works (presentation === undefined).
 *  - aria-label varies by mood.
 *  - No raw HTML is rendered.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Mascot } from './Mascot';
import { resolveMascotPresentation, type MascotContext } from '../../domain/mascot';

const NOON = Date.UTC(2026, 5, 15, 12, 0, 0);

function buildPresentation(overrides: Partial<Parameters<typeof resolveMascotPresentation>[0]> = {}) {
  return resolveMascotPresentation({
    context: {
      now: NOON,
      ...(overrides.context ?? {}),
    } as MascotContext,
    resolvedCostumeId: overrides.resolvedCostumeId,
  });
}

describe('<Mascot />', () => {
  it('renders a friendly default when no presentation is supplied', () => {
    render(<Mascot />);
    const el = screen.getByTestId('mascot-character');
    expect(el).toBeInTheDocument();
    expect(el.dataset.mascotMood).toBe('friendly');
    expect(el.dataset.mascotExpression).toBe('soft_smile');
    expect(el.dataset.mascotCharacter).toBe('queki');
    expect(el.getAttribute('aria-label')).toMatch(/friendly/i);
  });

  it('forwards mood + expression + character from the presentation', () => {
    const presentation = buildPresentation({
      context: {
        now: NOON,
        progression: { levelUpJustOccurred: true },
      },
    });
    render(<Mascot presentation={presentation} />);
    const el = screen.getByTestId('mascot-character');
    expect(el.dataset.mascotMood).toBe('celebrating');
    expect(el.dataset.mascotExpression).toBe('sparkle_burst');
    expect(el.getAttribute('aria-label')).toMatch(/celebrating/i);
  });

  it('forwards the costume id from the presentation', () => {
    const presentation = buildPresentation({
      resolvedCostumeId: 'mascot.santa-hat',
      context: {
        now: NOON,
        event: { activeThemeId: 'theme.christmas', mascotCostumeId: 'mascot.santa-hat' },
      },
    });
    render(<Mascot presentation={presentation} />);
    const el = screen.getByTestId('mascot-character');
    expect(el.dataset.mascotCostume).toBe('mascot.santa-hat');
  });

  it('omits the costume data attribute when no costume is set', () => {
    render(<Mascot presentation={buildPresentation({})} />);
    const el = screen.getByTestId('mascot-character');
    expect(el.dataset.mascotCostume).toBeUndefined();
  });

  it('forwards animation id when set on the presentation', () => {
    const presentation = buildPresentation({
      context: { now: NOON, progression: { levelUpJustOccurred: true } },
    });
    render(<Mascot presentation={presentation} />);
    const el = screen.getByTestId('mascot-character');
    expect(el.dataset.mascotAnimation).toBe('anim.celebrate.jump');
  });

  it('renders a custom descriptor when no presentation is supplied', () => {
    render(
      <Mascot
        descriptor={{
          characterId: 'queki',
          mood: 'grumpy',
          expression: 'frown',
          costumeId: 'mascot.witch-hat',
        }}
      />,
    );
    const el = screen.getByTestId('mascot-character');
    expect(el.dataset.mascotMood).toBe('grumpy');
    expect(el.dataset.mascotExpression).toBe('frown');
    expect(el.dataset.mascotCostume).toBe('mascot.witch-hat');
  });

  it('swaps the placeholder art when src is provided', () => {
    render(<Mascot src="/test-mascot.png" />);
    const el = screen.getByTestId('mascot-character');
    const img = el.querySelector('img');
    expect(img).toBeInTheDocument();
    expect(img?.getAttribute('src')).toBe('/test-mascot.png');
    // The descriptor attributes still drive accessibility.
    expect(el.dataset.mascotMood).toBe('friendly');
  });

  it('applies the size prop to the wrapping span', () => {
    render(<Mascot size={120} />);
    const el = screen.getByTestId('mascot-character');
    expect(el.style.width).toBe('120px');
    expect(el.style.height).toBe('120px');
  });

  it('never renders raw HTML or script tags', () => {
    const { container } = render(<Mascot />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('style')).toBeNull();
    // Only <svg> + the wrapping span should be in the markup.
    expect(container.querySelectorAll('svg').length).toBeGreaterThan(0);
  });

  it('aria-label updates per mood', () => {
    const moods: Array<{ mood: string; label: RegExp }> = [
      { mood: 'friendly', label: /friendly/i },
      { mood: 'excited', label: /excited/i },
      { mood: 'proud', label: /proud/i },
      { mood: 'welcome_back', label: /waving hello/i },
      { mood: 'celebrating', label: /celebrating/i },
    ];
    for (const { mood, label } of moods) {
      const { unmount } = render(
        <Mascot
          descriptor={{
            characterId: 'queki',
            mood: mood as never,
            expression: 'soft_smile',
          }}
        />,
      );
      const el = screen.getByTestId('mascot-character');
      expect(el.getAttribute('aria-label')).toMatch(label);
      unmount();
    }
  });

  it('is purely presentational — does not read or write gamification state', () => {
    // Render with an explicit presentation. The component renders without
    // touching gamification, XP, points, wallet, or notifications.
    const presentation = buildPresentation({
      context: {
        now: NOON,
        progression: { levelUpJustOccurred: true },
        activity: { currentStreak: 99, allQuestsCompleted: true },
      },
    });
    render(<Mascot presentation={presentation} />);
    expect(screen.getByTestId('mascot-character')).toBeInTheDocument();
    // No buttons, no interactive affordances — purely an image.
    expect(screen.queryByRole('button')).toBeNull();
  });
});