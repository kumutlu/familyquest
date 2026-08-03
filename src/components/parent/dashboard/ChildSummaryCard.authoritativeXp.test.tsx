import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '../../../i18n/config';
import { ChildSummaryCard } from './ChildSummaryCard';
import type { GamificationSummaryView } from '../../../lib/gamificationAdapters';

const withRouter = (ui: React.ReactNode) => <MemoryRouter>{ui}</MemoryRouter>;

const summaryView = (overrides: Partial<GamificationSummaryView> = {}): GamificationSummaryView => ({
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

describe('ChildSummaryCard — authoritative XP reads', () => {
  it('renders level/progress from the projection even when users.lifetimeXP is stale', () => {
    const child = { id: 'c1', displayName: 'Alice', lifetimeXP: 9999, rewardPoints: 0 };
    render(withRouter(
      <ChildSummaryCard
        child={child}
        walletBalance={0}
        pendingTaskCount={0}
        gamificationSummary={summaryView({ level: 3, xpTotal: 2500, xpToNextLevel: 500, xpProgressInLevel: 500 })}
      />
    ));

    expect(screen.getByText('Level 3')).toBeInTheDocument();
    expect(screen.getByText('500 XP to Level 4')).toBeInTheDocument();
    expect(screen.queryByText('Level 10')).not.toBeInTheDocument();
  });

  it('does not fabricate a level from lifetimeXP when the projection is unavailable', () => {
    const child = { id: 'c1', displayName: 'Bob', lifetimeXP: 4200, rewardPoints: 0 };
    render(withRouter(
      <ChildSummaryCard
        child={child}
        walletBalance={0}
        pendingTaskCount={0}
        gamificationSummary={summaryView({ isAvailable: false })}
      />
    ));

    // Fallback state only — never a lifetimeXP-derived level, never a fake Level 1
    expect(screen.getByText('Updating…')).toBeInTheDocument();
    expect(screen.queryByText('Level 5')).not.toBeInTheDocument();
    expect(screen.queryByText('Level 1')).not.toBeInTheDocument();
    expect(screen.queryByText(/XP to Level/)).not.toBeInTheDocument();
  });

  it('does not fabricate a level when the summary is null', () => {
    const child = { id: 'c1', displayName: 'Cara', lifetimeXP: 1200, rewardPoints: 0 };
    render(withRouter(
      <ChildSummaryCard
        child={child}
        walletBalance={0}
        pendingTaskCount={0}
        gamificationSummary={null}
      />
    ));

    expect(screen.getByText('Updating…')).toBeInTheDocument();
    expect(screen.queryByText(/^Level /)).not.toBeInTheDocument();
  });
});
