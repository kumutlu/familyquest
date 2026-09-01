import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n';
import { XpPop } from './XpPop';

function wrap(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe('XpPop', () => {
  it('renders nothing when not visible', () => {
    const { container } = render(wrap(<XpPop amount={25} visible={false} />));
    expect(container.firstChild).toBeNull();
  });

  it('renders the +amount XP pop when visible', () => {
    render(wrap(<XpPop amount={25} visible={true} />));
    const pop = screen.getByTestId('xp-pop');
    expect(pop).toHaveAttribute('data-xp-variant', 'generic');
    expect(pop).toHaveAttribute('data-xp-amount', '25');
    expect(pop).toHaveAttribute('aria-label', 'Awarded 25 XP');
  });

  it('renders the mystery variant with the mystery copy', () => {
    render(wrap(<XpPop amount={20} visible={true} variant="mystery" />));
    const pop = screen.getByTestId('xp-pop');
    expect(pop).toHaveAttribute('data-xp-variant', 'mystery');
    expect(pop).toHaveAttribute('aria-label', 'Mystery +20 XP');
  });

  it('renders the comeback variant with the comeback copy', () => {
    render(wrap(<XpPop amount={50} visible={true} variant="comeback" />));
    const pop = screen.getByTestId('xp-pop');
    expect(pop).toHaveAttribute('data-xp-variant', 'comeback');
    expect(pop).toHaveAttribute('aria-label', 'Comeback +50 XP');
  });

  it('renders the reverse tone with a minus sign and coral identity', () => {
    render(wrap(<XpPop amount={10} visible={true} variant="reverse" />));
    const pop = screen.getByTestId('xp-pop');
    expect(pop).toHaveAttribute('data-xp-variant', 'reverse');
    expect(pop).toHaveAttribute('aria-label', 'Removed 10 XP');
  });

  it('floors non-integer amounts and clamps negatives to zero', () => {
    render(wrap(<XpPop amount={-5} visible={true} />));
    expect(screen.getByTestId('xp-pop')).toHaveAttribute('data-xp-amount', '0');
  });
});