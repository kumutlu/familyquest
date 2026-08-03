import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n/config';

const store = vi.hoisted(() => ({
  state: {
    familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Test Child', rewardPoints: 100 }],
    loading: false,
    behaviourEvents: [],
    gamificationSummaries: [],
    dailyProgress: [],
  } as any,
}));

vi.mock('../store/useStore', () => ({ useStore: () => store.state }));
vi.mock('../components/reversals/HistoryActionControl', () => ({ HistoryActionControl: () => null }));
vi.mock('../components/dashboard/GamificationSummaryCard', () => ({
  GamificationSummaryCard: ({ summary }: { summary: any }) => (
    <div data-testid="gamification-summary">
      {summary?.isAvailable ? `Streaks for level ${summary.level}` : 'Loading…'}
    </div>
  ),
}));

import { MemberProfile } from './MemberProfile';

describe('MemberProfile gamification summary', () => {
  beforeEach(async () => {
    await i18n.loadNamespaces(['profile', 'dashboard']);
    await i18n.changeLanguage('en');
  });

  it('still shows progression (derived from lifetime XP) when the projection is unavailable', () => {
    store.state = {
      familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Test Child', rewardPoints: 100 }],
      loading: false,
      behaviourEvents: [],
      gamificationSummaries: [],
      dailyProgress: [],
    };
    render(
      <MemoryRouter initialEntries={['/family/child-1']}>
        <Routes>
          <Route path="/family/:id" element={<MemberProfile />} />
        </Routes>
      </MemoryRouter>
    );
    // No streak card (no server projection) but progression is always present.
    expect(screen.queryByTestId('gamification-summary')).not.toBeInTheDocument();
    expect(screen.getByTestId('profile-progression')).toBeInTheDocument();
    expect(screen.getByTestId('profile-level')).toHaveTextContent('Level 1');
  });

  it('renders a single merged progression card for available child data', () => {
    store.state = {
      familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Test Child', rewardPoints: 100 }],
      loading: false,
      behaviourEvents: [],
      gamificationSummaries: [{
        schemaVersion: 1,
        familyId: 'family-1',
        childId: 'child-1',
        xpTotal: 2500,
        level: 3,
        currentStreak: 2,
        bestStreak: 5,
        perfectDayCount: 1,
        lastQualifiedDayKey: null,
        projectionRevision: 1,
        foldedThrough: null,
        rebuildRequired: false,
        earliestDirtyCursor: null,
        projectionStatus: 'ready',
        updatedAt: Date.now(),
      }],
      dailyProgress: [{
        schemaVersion: 1,
        familyId: 'family-1',
        childId: 'child-1',
        dayKey: '20240115',
        timezone: 'Europe/London',
        eligibilitySnapshotId: 'snap1',
        dailyGoalPercentage: 80,
        eligiblePoints: 100,
        approvedPoints: 80,
        eligibleTaskCount: 4,
        approvedTaskCount: 3,
        progressPercentage: 80,
        dailyGoalReached: true,
        perfectDayReached: false,
        finalized: true,
        contributingLogicalCompletionKeys: [],
        invalidatedLogicalCompletionKeys: [],
        calculatedAt: Date.now(),
      }],
    };
    render(
      <MemoryRouter initialEntries={['/family/child-1']}>
        <Routes>
          <Route path="/family/:id" element={<MemberProfile />} />
        </Routes>
      </MemoryRouter>
    );
    // The legacy second card is gone; all values live on one card.
    expect(screen.queryByTestId('gamification-summary')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('profile-progression')).toHaveLength(1);
    expect(screen.getByTestId('profile-level')).toHaveTextContent('Level 3');
    expect(screen.getByTestId('profile-current-streak')).toHaveTextContent('2');
    expect(screen.getByTestId('profile-best-streak')).toHaveTextContent('5');
  });

  it('renders exactly one progression card with no duplicated level/XP/progress bar', () => {
    store.state = {
      familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Test Child', rewardPoints: 100 }],
      loading: false,
      behaviourEvents: [],
      gamificationSummaries: [{
        schemaVersion: 1,
        familyId: 'family-1',
        childId: 'child-1',
        xpTotal: 2500,
        level: 3,
        currentStreak: 2,
        bestStreak: 5,
        perfectDayCount: 1,
        lastQualifiedDayKey: null,
        projectionRevision: 1,
        foldedThrough: null,
        rebuildRequired: false,
        earliestDirtyCursor: null,
        projectionStatus: 'ready',
        updatedAt: Date.now(),
      }],
      dailyProgress: [],
    };
    render(
      <MemoryRouter initialEntries={['/family/child-1']}>
        <Routes>
          <Route path="/family/:id" element={<MemberProfile />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getAllByTestId('profile-progression')).toHaveLength(1);
    expect(screen.getAllByTestId('profile-level')).toHaveLength(1);
    expect(screen.getAllByTestId('profile-progress-bar')).toHaveLength(1);
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    expect(screen.getAllByTestId('profile-current-xp')).toHaveLength(1);
    expect(screen.getAllByTestId('profile-next-level-xp')).toHaveLength(1);
    expect(screen.getAllByTestId('profile-lifetime-xp')).toHaveLength(1);
    expect(screen.getAllByTestId('profile-reward-points')).toHaveLength(1);
    expect(screen.getAllByTestId('profile-current-streak')).toHaveLength(1);
    expect(screen.getAllByTestId('profile-best-streak')).toHaveLength(1);
    expect(screen.queryByTestId('gamification-summary')).not.toBeInTheDocument();
  });

  it('hides the streak card but keeps progression when rebuildRequired is true', () => {
    store.state = {
      familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Test Child', rewardPoints: 100 }],
      loading: false,
      behaviourEvents: [],
      gamificationSummaries: [{
        schemaVersion: 1,
        familyId: 'family-1',
        childId: 'child-1',
        xpTotal: 2500,
        level: 3,
        currentStreak: 2,
        bestStreak: 5,
        perfectDayCount: 1,
        lastQualifiedDayKey: null,
        projectionRevision: 1,
        foldedThrough: null,
        rebuildRequired: true,
        earliestDirtyCursor: null,
        projectionStatus: 'ready',
        updatedAt: Date.now(),
      }],
      dailyProgress: [],
    };
    render(
      <MemoryRouter initialEntries={['/family/child-1']}>
        <Routes>
          <Route path="/family/:id" element={<MemberProfile />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.queryByTestId('gamification-summary')).not.toBeInTheDocument();
    expect(screen.getByTestId('profile-progression')).toBeInTheDocument();
  });

  it('shows no misleading streak data when the projection is unavailable', () => {
    store.state = {
      familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Test Child', rewardPoints: 100 }],
      loading: false,
      behaviourEvents: [],
      gamificationSummaries: [],
      dailyProgress: [],
    };
    render(
      <MemoryRouter initialEntries={['/family/child-1']}>
        <Routes>
          <Route path="/family/:id" element={<MemberProfile />} />
        </Routes>
      </MemoryRouter>
    );
    // Streak stats are projection-only; never invented from the fallback.
    expect(screen.queryByText('Level 0')).not.toBeInTheDocument();
    expect(screen.queryByText('Current Streak')).not.toBeInTheDocument();
  });

  it('shows correct selected-child profile summary', () => {
    store.state = {
      familyMembers: [
        { id: 'child-1', role: 'child', displayName: 'Child One', rewardPoints: 100 },
        { id: 'child-2', role: 'child', displayName: 'Child Two', rewardPoints: 200 },
      ],
      loading: false,
      behaviourEvents: [],
      gamificationSummaries: [
        {
          schemaVersion: 1,
          familyId: 'family-1',
          childId: 'child-1',
          xpTotal: 1000,
          level: 2,
          currentStreak: 1,
          bestStreak: 2,
          perfectDayCount: 0,
          lastQualifiedDayKey: null,
          projectionRevision: 1,
          foldedThrough: null,
          rebuildRequired: false,
          earliestDirtyCursor: null,
          projectionStatus: 'ready',
          updatedAt: Date.now(),
        },
        {
          schemaVersion: 1,
          familyId: 'family-1',
          childId: 'child-2',
          xpTotal: 2500,
          level: 3,
          currentStreak: 2,
          bestStreak: 5,
          perfectDayCount: 1,
          lastQualifiedDayKey: null,
          projectionRevision: 1,
          foldedThrough: null,
          rebuildRequired: false,
          earliestDirtyCursor: null,
          projectionStatus: 'ready',
          updatedAt: Date.now(),
        },
      ],
      dailyProgress: [],
    };
    render(
      <MemoryRouter initialEntries={['/family/child-2']}>
        <Routes>
          <Route path="/family/:id" element={<MemberProfile />} />
        </Routes>
      </MemoryRouter>
    );
    // Should show child-2's summary (level 3), not child-1's (level 2)
    expect(screen.getByText('Child Two')).toBeInTheDocument();
    expect(screen.getByTestId('profile-level')).toHaveTextContent('Level 3');
  });

  it('shows not found when member does not exist', () => {
    store.state = {
      familyMembers: [],
      loading: false,
      behaviourEvents: [],
      gamificationSummaries: [],
      dailyProgress: [],
    };
    render(
      <MemoryRouter initialEntries={['/family/nonexistent']}>
        <Routes>
          <Route path="/family/:id" element={<MemberProfile />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('Member not found.')).toBeInTheDocument();
  });
});