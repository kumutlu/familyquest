import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n/config';
import { ChildrenOverview } from './ChildrenOverview';

const withRouter = (ui: React.ReactNode) => <MemoryRouter>{ui}</MemoryRouter>;

const store = vi.hoisted(() => ({
  state: {
    familyMembers: [],
    childWallets: [],
    tasks: [],
    taskCompletions: [],
    gamificationSummaries: [],
    dailyProgress: [],
    bootstrapStatus: { wallets: 'ready', gamificationSummaries: 'ready' },
  } as any,
}));

vi.mock('../../../store/useStore', () => ({ useStore: () => store.state }));
vi.mock('../../../lib/roles', () => ({
  isChildRole: (role: string) => role === 'child',
}));
vi.mock('../../../lib/taskRecurrence', () => ({
  isTaskDoneThisPeriod: () => false,
}));
vi.mock('../../../lib/useRecurrenceClock', () => ({
  useRecurrenceClock: () => new Date('2024-01-15T12:00:00Z'),
}));

beforeEach(async () => {
  await i18n.loadNamespaces(['dashboard']);
  await i18n.changeLanguage('en');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ChildrenOverview', () => {
  describe('loading state', () => {
    it('shows skeleton cards while gamification summaries are loading', () => {
      store.state = {
        familyMembers: [
          { id: 'c-1', role: 'child', displayName: 'Alice' },
          { id: 'c-2', role: 'child', displayName: 'Bob' },
        ],
        childWallets: [],
        tasks: [],
        taskCompletions: [],
        gamificationSummaries: [],
        dailyProgress: [],
        bootstrapStatus: { wallets: 'ready', gamificationSummaries: 'loading' },
      } as any;

      render(withRouter(<ChildrenOverview />));

      // Should show skeleton loading state, not actual child data
      expect(screen.queryByText('Alice')).not.toBeInTheDocument();
      expect(screen.queryByText('Bob')).not.toBeInTheDocument();
    });

    it('shows skeleton cards while wallets are loading', () => {
      store.state = {
        familyMembers: [
          { id: 'c-1', role: 'child', displayName: 'Alice' },
        ],
        childWallets: [],
        tasks: [],
        taskCompletions: [],
        gamificationSummaries: [],
        dailyProgress: [],
        bootstrapStatus: { wallets: 'loading', gamificationSummaries: 'ready' },
      } as any;

      render(withRouter(<ChildrenOverview />));

      expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    });
  });

  describe('missing summary', () => {
    it('shows rebuilding state for child with no gamification summary', () => {
      store.state = {
        familyMembers: [
          { id: 'c-1', role: 'child', displayName: 'Alice', lifetimeXP: 500 },
        ],
        childWallets: [{ id: 'c-1', balance: 1000 }],
        tasks: [],
        taskCompletions: [],
        gamificationSummaries: [], // No summary document
        dailyProgress: [],
        bootstrapStatus: { wallets: 'ready', gamificationSummaries: 'ready' },
      } as any;

      render(withRouter(<ChildrenOverview />));

      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Updating…')).toBeInTheDocument();
    });
  });

  describe('rebuilding/dirty state', () => {
    it('shows rebuilding state for child with rebuildRequired summary', () => {
      store.state = {
        familyMembers: [
          { id: 'c-1', role: 'child', displayName: 'Alice' },
        ],
        childWallets: [{ id: 'c-1', balance: 1000 }],
        tasks: [],
        taskCompletions: [],
        gamificationSummaries: [
          {
            schemaVersion: 1,
            familyId: 'f-1',
            childId: 'c-1',
            xpTotal: 1000,
            level: 2,
            currentStreak: 1,
            bestStreak: 3,
            perfectDayCount: 0,
            lastQualifiedDayKey: null,
            projectionRevision: 1,
            foldedThrough: null,
            rebuildRequired: true,
            earliestDirtyCursor: null,
            projectionStatus: 'ready',
            updatedAt: Date.now(),
          },
        ],
        dailyProgress: [],
        bootstrapStatus: { wallets: 'ready', gamificationSummaries: 'ready' },
      } as any;

      render(withRouter(<ChildrenOverview />));

      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Updating…')).toBeInTheDocument();
    });
  });

  describe('zero eligible tasks', () => {
    it('shows no eligible tasks message when today has no progress', () => {
      store.state = {
        familyMembers: [
          { id: 'c-1', role: 'child', displayName: 'Alice' },
        ],
        childWallets: [{ id: 'c-1', balance: 1000 }],
        tasks: [],
        taskCompletions: [],
        gamificationSummaries: [
          {
            schemaVersion: 1,
            familyId: 'f-1',
            childId: 'c-1',
            xpTotal: 1000,
            level: 2,
            currentStreak: 1,
            bestStreak: 3,
            perfectDayCount: 0,
            lastQualifiedDayKey: null,
            projectionRevision: 1,
            foldedThrough: null,
            rebuildRequired: false,
            earliestDirtyCursor: null,
            projectionStatus: 'ready',
            updatedAt: Date.now(),
          },
        ],
        dailyProgress: [], // No daily progress = no eligible tasks
        bootstrapStatus: { wallets: 'ready', gamificationSummaries: 'ready' },
      } as any;

      render(withRouter(<ChildrenOverview />));

      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('No tasks today')).toBeInTheDocument();
    });
  });

  describe('normal active summary', () => {
    it('renders child with full gamification summary', () => {
      store.state = {
        familyMembers: [
          { id: 'c-1', role: 'child', displayName: 'Alice' },
        ],
        childWallets: [{ id: 'c-1', balance: 1000 }],
        tasks: [],
        taskCompletions: [],
        gamificationSummaries: [
          {
            schemaVersion: 1,
            familyId: 'f-1',
            childId: 'c-1',
            xpTotal: 2500,
            level: 3,
            currentStreak: 2,
            bestStreak: 5,
            perfectDayCount: 1,
            lastQualifiedDayKey: '20240114',
            projectionRevision: 1,
            foldedThrough: null,
            rebuildRequired: false,
            earliestDirtyCursor: null,
            projectionStatus: 'ready',
            updatedAt: Date.now(),
          },
        ],
        dailyProgress: [
          {
            schemaVersion: 1,
            familyId: 'f-1',
            childId: 'c-1',
            dayKey: '20240115',
            timezone: 'Europe/London',
            eligibilitySnapshotId: 'snap-1',
            dailyGoalPercentage: 75,
            eligiblePoints: 100,
            approvedPoints: 75,
            eligibleTaskCount: 4,
            approvedTaskCount: 3,
            progressPercentage: 75,
            dailyGoalReached: true,
            perfectDayReached: false,
            finalized: true,
            contributingLogicalCompletionKeys: [],
            invalidatedLogicalCompletionKeys: [],
            calculatedAt: Date.now(),
          },
        ],
        bootstrapStatus: { wallets: 'ready', gamificationSummaries: 'ready' },
      } as any;

      render(withRouter(<ChildrenOverview />));

      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Level 3')).toBeInTheDocument();
      expect(screen.getByText('Goal Reached')).toBeInTheDocument();
    });
  });

  describe('child card isolation', () => {
    it('renders multiple children with independent gamification data', () => {
      store.state = {
        familyMembers: [
          { id: 'c-1', role: 'child', displayName: 'Alice' },
          { id: 'c-2', role: 'child', displayName: 'Bob' },
        ],
        childWallets: [
          { id: 'c-1', balance: 1000 },
          { id: 'c-2', balance: 500 },
        ],
        tasks: [],
        taskCompletions: [],
        gamificationSummaries: [
          {
            schemaVersion: 1,
            familyId: 'f-1',
            childId: 'c-1',
            xpTotal: 1000,
            level: 2,
            currentStreak: 1,
            bestStreak: 3,
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
            familyId: 'f-1',
            childId: 'c-2',
            xpTotal: 5000,
            level: 6,
            currentStreak: 5,
            bestStreak: 10,
            perfectDayCount: 2,
            lastQualifiedDayKey: null,
            projectionRevision: 1,
            foldedThrough: null,
            rebuildRequired: false,
            earliestDirtyCursor: null,
            projectionStatus: 'ready',
            updatedAt: Date.now(),
          },
        ],
        dailyProgress: [
          {
            schemaVersion: 1,
            familyId: 'f-1',
            childId: 'c-1',
            dayKey: '20240115',
            timezone: 'Europe/London',
            eligibilitySnapshotId: 'snap-1',
            dailyGoalPercentage: 50,
            eligiblePoints: 100,
            approvedPoints: 50,
            eligibleTaskCount: 4,
            approvedTaskCount: 2,
            progressPercentage: 50,
            dailyGoalReached: false,
            perfectDayReached: false,
            finalized: true,
            contributingLogicalCompletionKeys: [],
            invalidatedLogicalCompletionKeys: [],
            calculatedAt: Date.now(),
          },
          {
            schemaVersion: 1,
            familyId: 'f-1',
            childId: 'c-2',
            dayKey: '20240115',
            timezone: 'Europe/London',
            eligibilitySnapshotId: 'snap-2',
            dailyGoalPercentage: 100,
            eligiblePoints: 100,
            approvedPoints: 100,
            eligibleTaskCount: 4,
            approvedTaskCount: 4,
            progressPercentage: 100,
            dailyGoalReached: true,
            perfectDayReached: true,
            finalized: true,
            contributingLogicalCompletionKeys: [],
            invalidatedLogicalCompletionKeys: [],
            calculatedAt: Date.now(),
          },
        ],
        bootstrapStatus: { wallets: 'ready', gamificationSummaries: 'ready' },
      } as any;

      render(withRouter(<ChildrenOverview />));

      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
      expect(screen.getByText('Level 2')).toBeInTheDocument();
      expect(screen.getByText('Level 6')).toBeInTheDocument();
      expect(screen.getByText('Goal in Progress')).toBeInTheDocument();
      expect(screen.getByText('Perfect Day')).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('returns null when there are no children', () => {
      store.state = {
        familyMembers: [
          { id: 'p-1', role: 'parent', displayName: 'Parent' },
        ],
        childWallets: [],
        tasks: [],
        taskCompletions: [],
        gamificationSummaries: [],
        dailyProgress: [],
        bootstrapStatus: { wallets: 'ready', gamificationSummaries: 'ready' },
      } as any;

      const { container } = render(withRouter(<ChildrenOverview />));

      expect(container.innerHTML).toBe('');
    });
  });
});

describe('ChildrenOverview Turkish locale', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('tr');
  });

  it('renders Turkish translations for child cards', () => {
    store.state = {
      familyMembers: [
        { id: 'c-1', role: 'child', displayName: 'Ali' },
      ],
      childWallets: [{ id: 'c-1', balance: 1000 }],
      tasks: [],
      taskCompletions: [],
      gamificationSummaries: [
        {
          schemaVersion: 1,
          familyId: 'f-1',
          childId: 'c-1',
          xpTotal: 1000,
          level: 2,
          currentStreak: 1,
          bestStreak: 3,
          perfectDayCount: 0,
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
      bootstrapStatus: { wallets: 'ready', gamificationSummaries: 'ready' },
    } as any;

    render(withRouter(<ChildrenOverview />));

    expect(screen.getByText('Ali')).toBeInTheDocument();
    expect(screen.getByText('Seviye 2')).toBeInTheDocument();
    expect(screen.getByText('Toplam XP')).toBeInTheDocument();
  });
});