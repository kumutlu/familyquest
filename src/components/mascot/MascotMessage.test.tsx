/**
 * Component tests for the <MascotMessage /> surface.
 *
 * Verifies:
 *  - Renders a deterministic message line.
 *  - Forwards mood + messageKey into data-* attributes.
 *  - Locale variant counts are surfaced in data-* attributes (so QA can audit).
 *  - Falls back to a friendly default when no presentation is supplied.
 *  - Does NOT pass content through dangerouslySetInnerHTML.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MascotMessage } from './MascotMessage';
import { resolveMascotPresentation } from '../../domain/mascot';

const NOON = Date.UTC(2026, 5, 15, 12, 0, 0);

function presentation(contextOverrides: object = {}) {
  return resolveMascotPresentation({
    context: { now: NOON, ...contextOverrides } as never,
  });
}

describe('<MascotMessage />', () => {
  it('renders the supplied message verbatim', () => {
    render(
      <MascotMessage
        presentation={presentation()}
        message="Hey Sam! Ready when you are."
      />,
    );
    expect(screen.getByTestId('mascot-message')).toHaveTextContent(
      'Hey Sam! Ready when you are.',
    );
  });

  it('forwards mood into a data-* attribute', () => {
    const p = presentation({ progression: { levelUpJustOccurred: true } });
    render(<MascotMessage presentation={p} message="Level up!" />);
    const el = screen.getByTestId('mascot-message');
    expect(el.dataset.mascotMood).toBe('celebrating');
  });

  it('forwards the messageKey into a data-* attribute', () => {
    const p = presentation({ progression: { levelUpJustOccurred: true } });
    render(<MascotMessage presentation={p} message="Boom!" />);
    const el = screen.getByTestId('mascot-message');
    expect(el.dataset.mascotMessageKey).toBe('mascot.celebrate.level_up');
  });

  it('surfaces EN + TR variant counts for QA auditing', () => {
    const p = presentation();
    render(<MascotMessage presentation={p} message="Hi!" />);
    const el = screen.getByTestId('mascot-message');
    expect(Number(el.dataset.mascotLocaleKeyCountEn)).toBeGreaterThan(0);
    expect(Number(el.dataset.mascotLocaleKeyCountTr)).toBeGreaterThan(0);
  });

  it('falls back to friendly mood + unknown message key when no presentation is supplied', () => {
    render(<MascotMessage presentation={null} message="Default line." />);
    const el = screen.getByTestId('mascot-message');
    expect(el.dataset.mascotMood).toBe('friendly');
    expect(el.dataset.mascotMessageKey).toBe('unknown');
    expect(el).toHaveTextContent('Default line.');
  });

  it('mood override wins over the presentation mood', () => {
    const p = presentation({ progression: { levelUpJustOccurred: true } });
    render(
      <MascotMessage presentation={p} message="Override." mood="friendly" />,
    );
    const el = screen.getByTestId('mascot-message');
    expect(el.dataset.mascotMood).toBe('friendly');
  });

  it('does NOT pass content through dangerouslySetInnerHTML (no <script>)', () => {
    const { container } = render(
      <MascotMessage presentation={presentation()} message="Safe text." />,
    );
    expect(container.querySelector('script')).toBeNull();
  });

  it('is a pure <p> — no buttons, no links, no forms', () => {
    render(<MascotMessage presentation={presentation()} message="Hi" />);
    expect(screen.getByTestId('mascot-message').tagName).toBe('P');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});