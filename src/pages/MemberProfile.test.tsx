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
      {summary?.isAvailable ? `Level ${summary.level}` : 'Loading…'}
    </div>
  ),
}));

import { MemberProfile } from './MemberProfile';

describe('MemberProfile gamification summary', () => {
  beforeEach(async () => {
    await i18n.loadNamespaces(['profile', 'dashboard']);
    await i18n.changeLanguage('en');
  });

  it('shows loading state when summary is unavailable', () => {
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
    expect(screen.getByTestId('gamification-summary')).toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows gamification summary for available child data', () => {
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
    expect(screen.getByTestId('gamification-summary')).toBeInTheDocument();
    expect(screen.getByText('Level 3')).toBeInTheDocument();
  });

  it('shows rebuilding state when rebuildRequired is true', () => {
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
    expect(screen.getByTestId('gamification-summary')).toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows no misleading zeroes when summary is unavailable', () => {
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
    // Should show "Loading…" not "0" for streaks/level
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
    expect(screen.getByText('Level 3')).toBeInTheDocument();
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