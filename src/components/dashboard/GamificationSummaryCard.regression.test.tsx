import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GamificationSummaryCard } from './GamificationSummaryCard';
import type { GamificationSummaryView } from '../../lib/gamificationAdapters';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: any) => {
      const translations: Record<string, string> = {
        'gamification.level': `Level ${options?.level ?? ''}`,
        'gamification.loading': 'Loading…',
        'gamification.unavailableTitle': 'Progress',
        'gamification.unavailable': 'Progress details are not available right now.',
        'gamification.xpTotal': `${options?.xp ?? 0} Total XP`,
        'gamification.currentStreak': 'Current Streak',
        'gamification.bestStreak': 'Best Streak',
      };
      return translations[key] || key;
    },
  }),
}));

const unavailable: GamificationSummaryView = {
  xpTotal: 0,
  level: 1,
  xpToNextLevel: 1000,
  xpProgressInLevel: 0,
  currentStreak: 0,
  bestStreak: 0,
  perfectDayCount: 0,
  todayProgress: null,
  todayGoalReached: null,
  todayPerfectDay: null,
  isAvailable: false,
};

/**
 * P1 regression: the dashboard summary card stayed in a skeleton state forever
 * in production because the gamification projection document does not exist,
 * so `isAvailable` was permanently false and the card rendered `aria-busy`
 * skeleton markup with no request in flight.
 */
describe('GamificationSummaryCard — permanent skeleton regression', () => {
  it('renders the fallback UI (not a skeleton) when the summary is unavailable and nothing is loading', () => {
    render(<GamificationSummaryCard summary={unavailable} loading={false} />);

    expect(screen.queryByTestId('gamification-summary-skeleton')).not.toBeInTheDocument();
    expect(screen.getByTestId('gamification-summary-unavailable')).toBeInTheDocument();
  });

  it('renders the fallback UI (not a skeleton) when the summary is null and nothing is loading', () => {
    render(<GamificationSummaryCard summary={null} loading={false} />);

    expect(screen.queryByTestId('gamification-summary-skeleton')).not.toBeInTheDocument();
    expect(screen.getByTestId('gamification-summary-unavailable')).toBeInTheDocument();
  });

  it('defaults to the fallback UI when no loading flag is supplied', () => {
    render(<GamificationSummaryCard summary={null} />);

    expect(screen.queryByTestId('gamification-summary-skeleton')).not.toBeInTheDocument();
    expect(screen.getByTestId('gamification-summary-unavailable')).toBeInTheDocument();
  });

  it('never leaves aria-busy set once loading has finished', () => {
    const { container } = render(<GamificationSummaryCard summary={unavailable} loading={false} />);

    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });

  it('still renders a skeleton while a request is genuinely in flight', () => {
    render(<GamificationSummaryCard summary={null} loading />);

    expect(screen.getByTestId('gamification-summary-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('gamification-summary-unavailable')).not.toBeInTheDocument();
  });
});
