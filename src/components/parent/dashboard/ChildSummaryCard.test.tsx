import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n/config';
import { ChildSummaryCard } from './ChildSummaryCard';
import type { GamificationSummaryView } from '../../../lib/gamificationAdapters';

const withRouter = (ui: React.ReactNode) => <MemoryRouter>{ui}</MemoryRouter>;

const createMockChild = (overrides: any = {}) => ({
  id: 'child-1',
  displayName: 'Test Child',
  avatarUrl: undefined,
  lifetimeXP: 0,
  rewardPoints: 0,
  currentStreak: 0,
  ...overrides,
});

const createMockSummary = (overrides: Partial<GamificationSummaryView> = {}): GamificationSummaryView => ({
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
  isAvailable: true,
  ...overrides,
});

beforeEach(async () => {
  await i18n.loadNamespaces(['dashboard']);
  await i18n.changeLanguage('en');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ChildSummaryCard', () => {
  describe('normal summary', () => {
    it('renders level, XP progress, and streak from gamification summary', () => {
      const child = createMockChild({ displayName: 'Alice' });
      const summary = createMockSummary({
        level: 3,
        xpTotal: 2500,
        xpToNextLevel: 500,
        xpProgressInLevel: 500,
        currentStreak: 2,
        bestStreak: 5,
      });

      render(withRouter(
        <ChildSummaryCard
          child={child}
          walletBalance={1000}
          pendingTaskCount={0}
          gamificationSummary={summary}
        />
      ));

      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Level 3')).toBeInTheDocument();
      expect(screen.getByText('Total XP')).toBeInTheDocument();
      expect(screen.getByText('500 XP to Level 4')).toBeInTheDocument();
      expect(screen.getByText('Best Streak')).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('shows today progress and daily goal status when available', () => {
      const child = createMockChild();
      const summary = createMockSummary({
        todayProgress: 75,
        todayGoalReached: true,
        todayPerfectDay: false,
      });

      render(withRouter(
        <ChildSummaryCard
          child={child}
          walletBalance={0}
          pendingTaskCount={0}
          gamificationSummary={summary}
        />
      ));

      expect(screen.getByText('Today')).toBeInTheDocument();
      expect(screen.getByText('75%')).toBeInTheDocument();
      expect(screen.getByText('Goal Reached')).toBeInTheDocument();
    });

    it('shows perfect day status when achieved', () => {
      const child = createMockChild();
      const summary = createMockSummary({
        todayProgress: 100,
        todayGoalReached: true,
        todayPerfectDay: true,
      });

      render(withRouter(
        <ChildSummaryCard
          child={child}
          walletBalance={0}
          pendingTaskCount={0}
          gamificationSummary={summary}
        />
      ));

      expect(screen.getByText('Perfect Day')).toBeInTheDocument();
    });

    it('shows goal in progress when daily goal not reached', () => {
      const child = createMockChild();
      const summary = createMockSummary({
        todayProgress: 50,
        todayGoalReached: false,
        todayPerfectDay: false,
      });

      render(withRouter(
        <ChildSummaryCard
          child={child}
          walletBalance={0}
          pendingTaskCount={0}
          gamificationSummary={summary}
      />
      ));

      expect(screen.getByText('Goal in Progress')).toBeInTheDocument();
    });
  });

  describe('missing summary', () => {
    it('shows rebuilding indicator when summary is null', () => {
      const child = createMockChild({ displayName: 'Bob' });

      render(withRouter(
        <ChildSummaryCard
          child={child}
          walletBalance={0}
          pendingTaskCount={0}
          gamificationSummary={null}
        />
      ));

      expect(screen.getByText('Bob')).toBeInTheDocument();
      expect(screen.getByText('Updating…')).toBeInTheDocument();
    });

    it('shows rebuilding indicator when summary is unavailable', () => {
      const child = createMockChild();
      const summary = createMockSummary({ isAvailable: false });

      render(withRouter(
        <ChildSummaryCard
          child={child}
          walletBalance={0}
          pendingTaskCount={0}
          gamificationSummary={summary}
        />
      ));

      expect(screen.getByText('Updating…')).toBeInTheDocument();
    });

    it('does not show today progress when summary unavailable', () => {
      const child = createMockChild();
      const summary = createMockSummary({
        isAvailable: false,
        todayProgress: 50,
        todayGoalReached: true,
      });

      render(withRouter(
        <ChildSummaryCard
          child={child}
          walletBalance={0}
          pendingTaskCount={0}
          gamificationSummary={summary}
        />
      ));

      expect(screen.queryByText('Today')).not.toBeInTheDocument();
      expect(screen.queryByText('Goal Reached')).not.toBeInTheDocument();
    });
  });

  describe('rebuilding/dirty state', () => {
    it('shows rebuilding state without misleading zeroes', () => {
      const child = createMockChild();
      const summary = createMockSummary({
        isAvailable: false,
        xpTotal: 0,
        level: 1,
        currentStreak: 0,
        bestStreak: 0,
      });

      render(withRouter(
        <ChildSummaryCard
          child={child}
          walletBalance={0}
          pendingTaskCount={0}
          gamificationSummary={summary}
        />
      ));

      // Should show "Updating…" instead of showing zeroes as real data
      expect(screen.getByText('Updating…')).toBeInTheDocument();
    });
  });

  describe('level boundary', () => {
    it('handles exact level boundary (1000 XP)', () => {
      const child = createMockChild();
      const summary = createMockSummary({
        level: 2,
        xpTotal: 1000,
        xpToNextLevel: 1000,
        xpProgressInLevel: 0,
      });

      render(withRouter(
        <ChildSummaryCard
          child={child}
          walletBalance={0}
          pendingTaskCount={0}
          gamificationSummary={summary}
        />
      ));

      expect(screen.getByText('Level 2')).toBeInTheDocument();
      expect(screen.getByText('1000 XP to Level 3')).toBeInTheDocument();
    });

    it('handles level 1 with low XP', () => {
      const child = createMockChild();
      const summary = createMockSummary({
        level: 1,
        xpTotal: 100,
        xpToNextLevel: 900,
        xpProgressInLevel: 100,
      });

      render(withRouter(
        <ChildSummaryCard
          child={child}
          walletBalance={0}
          pendingTaskCount={0}
          gamificationSummary={summary}
        />
      ));

      expect(screen.getByText('Level 1')).toBeInTheDocument();
      expect(screen.getByText('900 XP to Level 2')).toBeInTheDocument();
    });
  });

  describe('today progress', () => {
    it('shows no eligible tasks message when todayProgress is null', () => {
      const child = createMockChild();
      const summary = createMockSummary({
        todayProgress: null,
        todayGoalReached: null,
      });

      render(withRouter(
        <ChildSummaryCard
          child={child}
          walletBalance={0}
          pendingTaskCount={0}
          gamificationSummary={summary}
        />
      ));

      expect(screen.getByText('No tasks today')).toBeInTheDocument();
    });

    it('shows progress percentage with screen reader label', () => {
      const child = createMockChild();
      const summary = createMockSummary({
        todayProgress: 75,
        todayGoalReached: true,
      });

      render(withRouter(
        <ChildSummaryCard
          child={child}
          walletBalance={0}
          pendingTaskCount={0}
          gamificationSummary={summary}
        />
      ));

      const progressElement = screen.getByText('75%');
      expect(progressElement).toHaveAttribute('aria-label', '75% complete');
    });
  });

  describe('Daily Goal reached/not reached', () => {
    it('shows check icon when daily goal reached', () => {
      const child = createMockChild();
      const summary = createMockSummary({
        todayProgress: 100,
        todayGoalReached: true,
      });

      render(withRouter(
        <ChildSummaryCard
          child={child}
          walletBalance={0}
          pendingTaskCount={0}
          gamificationSummary={summary}
        />
      ));

      // Check for success icon (CheckCircle2)
      const goalStatus = screen.getByText('Goal Reached');
      expect(goalStatus).toBeInTheDocument();
    });

    it('shows empty circle icon when daily goal not reached', () => {
      const child = createMockChild();
      const summary = createMockSummary({
        todayProgress: 50,
        todayGoalReached: false,
      });

      render(withRouter(
        <ChildSummaryCard
          child={child}
          walletBalance={0}
          pendingTaskCount={0}
          gamificationSummary={summary}
        />
      ));

      expect(screen.getByText('Goal in Progress')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('has meaningful aria-label on the link', () => {
      const child = createMockChild({ displayName: 'Charlie' });
      const summary = createMockSummary();

      render(withRouter(
        <ChildSummaryCard
          child={child}
          walletBalance={0}
          pendingTaskCount={0}
          gamificationSummary={summary}
        />
      ));

      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('aria-label', "View Charlie's profile");
    });

    it('has keyboard-safe focus ring', () => {
      const child = createMockChild();
      const summary = createMockSummary();

      render(withRouter(
        <ChildSummaryCard
          child={child}
          walletBalance={0}
          pendingTaskCount={0}
          gamificationSummary={summary}
        />
      ));

      const link = screen.getByRole('link');
      expect(link).toHaveClass('focus-visible:ring-2');
    });
  });

  describe('isolation between child cards', () => {
    it('renders multiple children with independent data', () => {
      const child1 = createMockChild({ id: 'c-1', displayName: 'Alice' });
      const child2 = createMockChild({ id: 'c-2', displayName: 'Bob' });
      const summary1 = createMockSummary({ level: 2, currentStreak: 3 });
      const summary2 = createMockSummary({ level: 5, currentStreak: 10 });

      render(withRouter(
        <>
          <ChildSummaryCard
            child={child1}
            walletBalance={100}
            pendingTaskCount={0}
            gamificationSummary={summary1}
          />
          <ChildSummaryCard
            child={child2}
            walletBalance={200}
            pendingTaskCount={0}
            gamificationSummary={summary2}
          />
        </>
      ));

      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
      expect(screen.getAllByText('Level 2')[0]).toBeInTheDocument();
      expect(screen.getAllByText('Level 5')[0]).toBeInTheDocument();
    });
  });
});

describe('ChildSummaryCard Turkish locale', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('tr');
  });

  it('renders Turkish translations for gamification fields', () => {
    const child = createMockChild({ displayName: 'Ali' });
    const summary = createMockSummary({
      level: 3,
      todayProgress: 75,
      todayGoalReached: true,
    });

    render(withRouter(
      <ChildSummaryCard
        child={child}
        walletBalance={0}
        pendingTaskCount={0}
        gamificationSummary={summary}
      />
    ));

    expect(screen.getByText('Seviye 3')).toBeInTheDocument();
    expect(screen.getByText('Toplam XP')).toBeInTheDocument();
    expect(screen.getByText('Hedefe Ulaşıldı')).toBeInTheDocument();
  });
});