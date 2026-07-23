import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GamificationSummaryCard } from './GamificationSummaryCard';
import type { GamificationSummaryView } from '../../lib/gamificationAdapters';

// Mock the useTranslation hook
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: any) => {
      const translations: Record<string, string> = {
        'gamification.level': `Level ${options?.level ?? ''}`,
        'gamification.loading': 'Loading…',
        'gamification.updating': 'Updating…',
        'gamification.xpTotal': `${options?.xp ?? 0} Total XP`,
        'gamification.xpToNext': `${options?.xp ?? 0} XP to Level ${options?.level ?? ''}`,
        'gamification.xpProgress': `${options?.xp ?? 0} XP in Level ${options?.level ?? ''}`,
        'gamification.xpToNextLevel': `${options?.xp ?? 0} XP to reach Level ${options?.level ?? ''}`,
        'gamification.currentStreak': 'Current Streak',
        'gamification.bestStreak': 'Best Streak',
        'gamification.todayProgress': 'Today',
        'gamification.todayProgressAria': `${options?.progress ?? 0}% complete`,
        'gamification.dailyGoalReached': 'Goal Reached',
        'gamification.dailyGoalNotReached': 'Goal in Progress',
        'gamification.perfectDay': 'Perfect Day',
        'gamification.rebuilding': 'Updating…',
        'gamification.noEligibleTasks': 'No tasks today',
      };
      return translations[key] || key;
    },
  }),
}));

describe('GamificationSummaryCard', () => {
  it('renders unavailable state when summary is null', () => {
    render(<GamificationSummaryCard summary={null} />);
    expect(screen.getByTestId('gamification-summary')).toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('renders unavailable state when summary is undefined', () => {
    render(<GamificationSummaryCard summary={undefined as any} />);
    expect(screen.getByTestId('gamification-summary')).toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('renders unavailable state when isAvailable is false', () => {
    const summary: GamificationSummaryView = {
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
    render(<GamificationSummaryCard summary={summary} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('renders available summary with level and XP progress', () => {
    const summary: GamificationSummaryView = {
      xpTotal: 2500,
      level: 3,
      xpToNextLevel: 500,
      xpProgressInLevel: 500,
      currentStreak: 2,
      bestStreak: 5,
      perfectDayCount: 1,
      todayProgress: 75,
      todayGoalReached: true,
      todayPerfectDay: false,
      isAvailable: true,
    };
    render(<GamificationSummaryCard summary={summary} />);
    expect(screen.getByText('Level 3')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('Goal Reached')).toBeInTheDocument();
  });

  it('renders streak information', () => {
    const summary: GamificationSummaryView = {
      xpTotal: 1000,
      level: 2,
      xpToNextLevel: 1000,
      xpProgressInLevel: 0,
      currentStreak: 3,
      bestStreak: 10,
      perfectDayCount: 0,
      todayProgress: null,
      todayGoalReached: null,
      todayPerfectDay: null,
      isAvailable: true,
    };
    render(<GamificationSummaryCard summary={summary} />);
    expect(screen.getByText('Current Streak')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Best Streak')).toBeInTheDocument();
    expect(screen.getAllByText('10')[0]).toBeInTheDocument();
  });

  it('shows Perfect Day status when achieved', () => {
    const summary: GamificationSummaryView = {
      xpTotal: 1000,
      level: 2,
      xpToNextLevel: 1000,
      xpProgressInLevel: 0,
      currentStreak: 1,
      bestStreak: 1,
      perfectDayCount: 1,
      todayProgress: 100,
      todayGoalReached: true,
      todayPerfectDay: true,
      isAvailable: true,
    };
    render(<GamificationSummaryCard summary={summary} />);
    expect(screen.getByText('Perfect Day')).toBeInTheDocument();
  });

  it('does not show Perfect Day status when not achieved', () => {
    const summary: GamificationSummaryView = {
      xpTotal: 1000,
      level: 2,
      xpToNextLevel: 1000,
      xpProgressInLevel: 0,
      currentStreak: 1,
      bestStreak: 1,
      perfectDayCount: 0,
      todayProgress: 75,
      todayGoalReached: true,
      todayPerfectDay: false,
      isAvailable: true,
    };
    render(<GamificationSummaryCard summary={summary} />);
    expect(screen.queryByText('Perfect Day')).not.toBeInTheDocument();
  });

  it('shows "No tasks today" when todayProgress is null', () => {
    const summary: GamificationSummaryView = {
      xpTotal: 1000,
      level: 2,
      xpToNextLevel: 1000,
      xpProgressInLevel: 0,
      currentStreak: 0,
      bestStreak: 0,
      perfectDayCount: 0,
      todayProgress: null,
      todayGoalReached: null,
      todayPerfectDay: null,
      isAvailable: true,
    };
    render(<GamificationSummaryCard summary={summary} />);
    expect(screen.getByText('No tasks today')).toBeInTheDocument();
  });

  it('shows "Goal in Progress" when daily goal not reached', () => {
    const summary: GamificationSummaryView = {
      xpTotal: 1000,
      level: 2,
      xpToNextLevel: 1000,
      xpProgressInLevel: 0,
      currentStreak: 0,
      bestStreak: 0,
      perfectDayCount: 0,
      todayProgress: 50,
      todayGoalReached: false,
      todayPerfectDay: false,
      isAvailable: true,
    };
    render(<GamificationSummaryCard summary={summary} />);
    expect(screen.getByText('Goal in Progress')).toBeInTheDocument();
  });

  it('has screen-reader-friendly XP progress description', () => {
    const summary: GamificationSummaryView = {
      xpTotal: 1500,
      level: 2,
      xpToNextLevel: 500,
      xpProgressInLevel: 500,
      currentStreak: 0,
      bestStreak: 0,
      perfectDayCount: 0,
      todayProgress: 50,
      todayGoalReached: false,
      todayPerfectDay: false,
      isAvailable: true,
    };
    render(<GamificationSummaryCard summary={summary} />);
    expect(screen.getByLabelText('500 XP in Level 2')).toBeInTheDocument();
    expect(screen.getByLabelText('50% complete')).toBeInTheDocument();
  });

  it('has screen-reader-friendly XP to next level description', () => {
    const summary: GamificationSummaryView = {
      xpTotal: 1500,
      level: 2,
      xpToNextLevel: 500,
      xpProgressInLevel: 500,
      currentStreak: 0,
      bestStreak: 0,
      perfectDayCount: 0,
      todayProgress: null,
      todayGoalReached: null,
      todayPerfectDay: null,
      isAvailable: true,
    };
    render(<GamificationSummaryCard summary={summary} />);
    expect(screen.getByLabelText('500 XP to reach Level 3')).toBeInTheDocument();
  });
});