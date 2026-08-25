import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n/config';
import { ChildrenOverview } from './ChildrenOverview';
import { MoneyPrivacyProvider } from '../../privacy/MoneyPrivacyContext';

const withRouter = (ui: React.ReactNode) => (
  <MoneyPrivacyProvider><MemoryRouter>{ui}</MemoryRouter></MoneyPrivacyProvider>
);

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
    it('falls back to lifetimeXP so a missing projection never hides valid progression', () => {
      store.state = {
        familyMembers: [
          { id: 'c-1', role: 'child', displayName: 'Alice', lifetimeXP: 2500 },
        ],
        childWallets: [{ id: 'c-1', balance: 1000 }],
        tasks: [],
        taskCompletions: [],
        gamificationSummaries: [], // No summary document
        dailyProgress: [],
        bootstrapStatus: { wallets: 'ready', gamificationSummaries: 'ready' },
      } as any;

      render(withRouter(<ChildrenOverview />));

      // The child's valid progression (derived from lifetimeXP = 2500 -> Level 3)
      // is shown instead of "Updating…".
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.queryByText('Updating…')).not.toBeInTheDocument();
      expect(screen.getByText('Level 3')).toBeInTheDocument();
    });
  });

  describe('rebuilding/dirty state', () => {
    it('keeps the dirty projection own values (priority 2), never lifetimeXP', () => {
      store.state = {
        familyMembers: [
          { id: 'c-1', role: 'child', displayName: 'Alice', lifetimeXP: 4200 },
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

      // The dirty projection is authoritative: its own Level 2 (xpTotal 1000)
      // is shown, NOT the lifetimeXP-derived Level 5 (4200).
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Level 2')).toBeInTheDocument();
      expect(screen.queryByText('Level 5')).not.toBeInTheDocument();
      // A present summary (even dirty) never shows "Updating…" — its own
      // values are displayed.
      expect(screen.queryByText('Updating…')).not.toBeInTheDocument();
    });

    it('REQUIRED: dirty summary xpTotal=420 with lifetimeXP=400 shows 420 (not 400)', () => {
      store.state = {
        familyMembers: [
          { id: 'c-1', role: 'child', displayName: 'Alice', lifetimeXP: 400 },
        ],
        childWallets: [{ id: 'c-1', balance: 1000 }],
        tasks: [],
        taskCompletions: [],
        gamificationSummaries: [
          {
            schemaVersion: 1,
            familyId: 'f-1',
            childId: 'c-1',
            xpTotal: 420,
            level: 1,
            currentStreak: 0,
            bestStreak: 0,
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

      // xpTotal 420 -> "580 XP to Level 2". The lifetimeXP=400 would render
      // "600 XP to Level 2", which must NOT appear.
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('580 XP to Level 2')).toBeInTheDocument();
      expect(screen.queryByText('600 XP to Level 2')).not.toBeInTheDocument();
    });
  });

  describe('fallback priority (required proofs)', () => {
    it('REQUIRED: ready summary xpTotal=420 is authoritative (shows 420-derived progress)', () => {
      store.state = {
        familyMembers: [
          { id: 'c-1', role: 'child', displayName: 'Alice', lifetimeXP: 400 },
        ],
        childWallets: [{ id: 'c-1', balance: 1000 }],
        tasks: [],
        taskCompletions: [],
        gamificationSummaries: [
          {
            schemaVersion: 1,
            familyId: 'f-1',
            childId: 'c-1',
            xpTotal: 420,
            level: 1,
            currentStreak: 0,
            bestStreak: 0,
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

      // xpTotal 420 -> "580 XP to Level 2" (NOT the lifetimeXP=400 "600 XP to Level 2").
      expect(screen.getByText('580 XP to Level 2')).toBeInTheDocument();
      expect(screen.queryByText('600 XP to Level 2')).not.toBeInTheDocument();
    });

    it('REQUIRED: missing summary and no lifetimeXP renders unavailable', () => {
      store.state = {
        familyMembers: [
          { id: 'c-1', role: 'child', displayName: 'Alice' },
        ],
        childWallets: [{ id: 'c-1', balance: 1000 }],
        tasks: [],
        taskCompletions: [],
        gamificationSummaries: [], // no projection document
        dailyProgress: [],
        bootstrapStatus: { wallets: 'ready', gamificationSummaries: 'ready' },
      } as any;

      render(withRouter(<ChildrenOverview />));

      // No projection AND no lifetimeXP -> genuinely unavailable.
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Unavailable')).toBeInTheDocument();
    });

    it('REQUIRED: no child receives another child summary (per-card isolation)', () => {
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
            xpTotal: 420,
            level: 1,
            currentStreak: 0,
            bestStreak: 0,
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
            xpTotal: 2500,
            level: 3,
            currentStreak: 0,
            bestStreak: 0,
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

      const aliceCard = screen.getByLabelText("View Alice's profile");
      const bobCard = screen.getByLabelText("View Bob's profile");
      // Alice's card shows her own Level 1 (xpTotal 420), never Bob's Level 3.
      expect(within(aliceCard).getByText('Level 1')).toBeInTheDocument();
      expect(within(aliceCard).queryByText('Level 3')).not.toBeInTheDocument();
      // Bob's card shows his own Level 3 (xpTotal 2500), never Alice's Level 1.
      expect(within(bobCard).getByText('Level 3')).toBeInTheDocument();
      expect(within(bobCard).queryByText('Level 1')).not.toBeInTheDocument();
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

  describe('summary lookup by document id', () => {
    it('resolves a summary whose childId field is missing using the document id', () => {
      store.state = {
        familyMembers: [
          { id: 'c-1', role: 'child', displayName: 'Alisya' },
        ],
        childWallets: [{ id: 'c-1', balance: 1000 }],
        tasks: [],
        taskCompletions: [],
        gamificationSummaries: [
          {
            id: 'c-1', // document id only, no childId field
            schemaVersion: 1,
            familyId: 'f-1',
            xpTotal: 86,
            level: 1,
            currentStreak: 0,
            bestStreak: 0,
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

      expect(screen.getByText('Alisya')).toBeInTheDocument();
      expect(screen.getByText('Level 1')).toBeInTheDocument();
      expect(screen.queryByText('Updating…')).not.toBeInTheDocument();
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

describe('P0 shared resolver consistency (ChildrenOverview card)', () => {
  const makeSummary = (overrides: any = {}) => ({
    schemaVersion: 1,
    familyId: 'f-1',
    childId: 'c-1',
    xpTotal: 361,
    level: 1,
    currentStreak: 1,
    bestStreak: 1,
    perfectDayCount: 0,
    lastQualifiedDayKey: null,
    projectionRevision: 1,
    foldedThrough: null,
    rebuildRequired: true,
    earliestDirtyCursor: null,
    projectionStatus: 'ready',
    updatedAt: Date.now(),
    ...overrides,
  });

  it('REQUIRED: dirty summary (xpTotal=361) wins over member lifetimeXP=86 — no Updating…', () => {
    store.state = {
      familyMembers: [
        { id: 'c-1', role: 'child', displayName: 'Alice', lifetimeXP: 86, currentStreak: 2, longestStreak: 2 },
      ],
      childWallets: [{ id: 'c-1', balance: 1000 }],
      tasks: [],
      taskCompletions: [],
      gamificationSummaries: [makeSummary()],
      dailyProgress: [],
      bootstrapStatus: { wallets: 'ready', gamificationSummaries: 'ready' },
    } as any;

    render(withRouter(<ChildrenOverview />));

    // xpTotal 361 -> "639 XP to Level 2". The member fallback (lifetimeXP=86)
    // would render "914 XP to Level 2", which must NOT appear.
    expect(screen.getByText('639 XP to Level 2')).toBeInTheDocument();
    expect(screen.queryByText('914 XP to Level 2')).not.toBeInTheDocument();
    // bestStreak comes from the summary (1), never the member's longestStreak (2).
    expect(screen.queryByText('2')).not.toBeInTheDocument();
    // A present summary never shows "Updating…".
    expect(screen.queryByText('Updating…')).not.toBeInTheDocument();
  });

  it('REQUIRED: missing summary falls back to member values (lifetimeXP=86)', () => {
    store.state = {
      familyMembers: [
        { id: 'c-1', role: 'child', displayName: 'Alice', lifetimeXP: 86, currentStreak: 2, longestStreak: 2 },
      ],
      childWallets: [{ id: 'c-1', balance: 1000 }],
      tasks: [],
      taskCompletions: [],
      gamificationSummaries: [],
      dailyProgress: [],
      bootstrapStatus: { wallets: 'ready', gamificationSummaries: 'ready' },
    } as any;

    render(withRouter(<ChildrenOverview />));

    // Fallback derives level from lifetimeXP=86 -> "914 XP to Level 2".
    expect(screen.getByText('914 XP to Level 2')).toBeInTheDocument();
    expect(screen.queryByText('639 XP to Level 2')).not.toBeInTheDocument();
  });

  it('REQUIRED: another child’s summary is never used for this child', () => {
    store.state = {
      familyMembers: [
        { id: 'c-1', role: 'child', displayName: 'Alice', lifetimeXP: 86 },
        { id: 'c-2', role: 'child', displayName: 'Bob', lifetimeXP: 50 },
      ],
      childWallets: [{ id: 'c-1', balance: 1000 }, { id: 'c-2', balance: 500 }],
      tasks: [],
      taskCompletions: [],
      // Only c-2 has a summary; c-1 must NOT pick it up.
      gamificationSummaries: [makeSummary({ childId: 'c-2', id: 'c-2', xpTotal: 9999, bestStreak: 9 })],
      dailyProgress: [],
      bootstrapStatus: { wallets: 'ready', gamificationSummaries: 'ready' },
    } as any;

    render(withRouter(<ChildrenOverview />));

    // Alice (c-1) has no summary -> falls back to her lifetimeXP=86 ("914 XP to Level 2"),
    // never Bob's 9999 summary.
    const aliceCard = screen.getByText('Alice').closest('a') as HTMLElement;
    expect(within(aliceCard).getByText('914 XP to Level 2')).toBeInTheDocument();
    expect(within(aliceCard).queryByText('1 XP to Level 2')).not.toBeInTheDocument();
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
