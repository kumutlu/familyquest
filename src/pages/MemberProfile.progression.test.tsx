import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n/config';

const store = vi.hoisted(() => ({ state: {} as any }));

vi.mock('../store/useStore', () => ({
  useStore: (selector?: (state: any) => unknown) => selector ? selector(store.state) : store.state,
}));
vi.mock('../components/reversals/HistoryActionControl', () => ({ HistoryActionControl: () => null }));

import { MemberProfile } from './MemberProfile';
import { MoneyPrivacyProvider } from '../components/privacy/MoneyPrivacyContext';

const readyProjection = (childId: string, xpTotal: number, level: number) => ({
  schemaVersion: 1,
  familyId: 'family-1',
  childId,
  xpTotal,
  level,
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
});

const renderProfile = (path = '/family/child-1') =>
  render(
    <MoneyPrivacyProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/family/:id" element={<MemberProfile />} />
        </Routes>
      </MemoryRouter>
    </MoneyPrivacyProvider>,
  );

describe('MemberProfile progression section', () => {
  beforeEach(async () => {
    localStorage.clear();
    await i18n.loadNamespaces(['profile', 'dashboard']);
    await i18n.changeLanguage('en');
    store.state = {
      currentUser: { id: 'parent-1', role: 'owner' },
      familyMembers: [
        { id: 'child-1', role: 'child', displayName: 'Test Child', rewardPoints: 100, lifetimeXP: 2500 },
      ],
      loading: false,
      behaviourEvents: [],
      gamificationSummaries: [],
      dailyProgress: [],
      myGamificationSummary: null,
    };
  });

  it('always renders progression values derived from lifetime XP when the projection is missing', () => {
    renderProfile();

    const section = screen.getByTestId('profile-progression');
    expect(section).toBeInTheDocument();
    expect(screen.getByTestId('profile-level')).toHaveTextContent('Level 3');
    expect(screen.getByTestId('profile-current-xp')).toHaveTextContent('500');
    expect(screen.getByTestId('profile-next-level-xp')).toHaveTextContent('500');
    expect(screen.getByTestId('profile-reward-points')).toHaveTextContent('100');
    expect(screen.getByTestId('profile-lifetime-xp')).toHaveTextContent('2500');

    const bar = screen.getByTestId('profile-progress-bar');
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(bar).toHaveStyle({ width: '50%' });
  });

  it('prefers the gamification projection when it is available', () => {
    store.state.gamificationSummaries = [readyProjection('child-1', 1250, 2)];
    renderProfile();

    expect(screen.getByTestId('profile-level')).toHaveTextContent('Level 2');
    expect(screen.getByTestId('profile-current-xp')).toHaveTextContent('250');
    expect(screen.getByTestId('profile-next-level-xp')).toHaveTextContent('750');
    expect(screen.getByTestId('profile-progress-bar')).toHaveAttribute('aria-valuenow', '25');
  });

  it('uses the child own-summary document when a child views their own profile', () => {
    store.state.currentUser = { id: 'child-1', role: 'child' };
    store.state.gamificationSummaries = [];
    store.state.myGamificationSummary = readyProjection('child-1', 4100, 5);
    renderProfile();

    expect(screen.getByTestId('profile-level')).toHaveTextContent('Level 5');
    expect(screen.getByTestId('profile-current-xp')).toHaveTextContent('100');
    expect(screen.getByTestId('profile-next-level-xp')).toHaveTextContent('900');
    expect(screen.getByTestId('profile-lifetime-xp')).toHaveTextContent('4100');
  });

  it('never renders the placeholder question-mark avatar badge', () => {
    renderProfile();
    expect(screen.queryByText('?')).not.toBeInTheDocument();
    expect(screen.getByTestId('profile-avatar-level-badge')).toHaveTextContent('3');
  });

  it('does not leave a permanent loading skeleton when the projection is missing', () => {
    renderProfile();
    expect(screen.queryByTestId('gamification-summary-skeleton')).not.toBeInTheDocument();
  });
});

describe('MemberProfile progression for a parent viewing another member', () => {
  beforeEach(async () => {
    localStorage.clear();
    await i18n.loadNamespaces(['profile', 'dashboard']);
    await i18n.changeLanguage('en');
    store.state = {
      currentUser: { id: 'parent-1', role: 'owner', lifetimeXP: 9000, rewardPoints: 999 },
      familyMembers: [
        { id: 'parent-1', role: 'owner', displayName: 'Parent One', rewardPoints: 999, lifetimeXP: 9000 },
        { id: 'parent-2', role: 'parent', displayName: 'Parent Two', rewardPoints: 12, lifetimeXP: 3200 },
        { id: 'child-1', role: 'child', displayName: 'Mnalium', rewardPoints: 100, lifetimeXP: 2500 },
        { id: 'child-2', role: 'child', displayName: 'Alisya', rewardPoints: 40, lifetimeXP: 1250 },
      ],
      loading: false,
      behaviourEvents: [],
      gamificationSummaries: [],
      dailyProgress: [],
      // The signed-in parent's own projection must never leak into a child view.
      myGamificationSummary: readyProjection('parent-1', 9000, 10),
    };
  });

  it('renders the child values when no projection exists (regression)', () => {
    renderProfile('/family/child-1');

    expect(screen.getByText('Mnalium')).toBeInTheDocument();
    expect(screen.getByTestId('profile-level')).toHaveTextContent('Level 3');
    expect(screen.getByTestId('profile-lifetime-xp')).toHaveTextContent('2500');
    expect(screen.getByTestId('profile-reward-points')).toHaveTextContent('100');
    expect(screen.getByTestId('profile-progress-bar')).toHaveAttribute('aria-valuenow', '50');
    expect(screen.queryByTestId('profile-lifetime-xp')).not.toHaveTextContent('9000');
    expect(screen.queryByTestId('gamification-summary-skeleton')).not.toBeInTheDocument();
  });

  it('resolves a projection stored only under the document id', () => {
    // Production projections are keyed by child id; the `childId` field may be
    // absent on legacy documents.
    const { childId: _childId, ...withoutChildId } = readyProjection('child-1', 4100, 5);
    store.state.gamificationSummaries = [{ id: 'child-1', ...withoutChildId }];
    renderProfile('/family/child-1');

    expect(screen.getByTestId('profile-level')).toHaveTextContent('Level 5');
    expect(screen.getByTestId('profile-lifetime-xp')).toHaveTextContent('4100');
  });

  it('uses the target child projection when it is ready', () => {
    store.state.gamificationSummaries = [
      readyProjection('child-1', 2500, 3),
      readyProjection('child-2', 1250, 2),
    ];
    renderProfile('/family/child-2');

    expect(screen.getByTestId('profile-level')).toHaveTextContent('Level 2');
    expect(screen.getByTestId('profile-lifetime-xp')).toHaveTextContent('1250');
  });

  it('matches the same authoritative level fixture used by the Home crew cards', () => {
    const crew = [
      { id: 'child-2', displayName: 'Level Two', xpTotal: 1_250, level: 2 },
      { id: 'child-3', displayName: 'Level Three', xpTotal: 2_500, level: 3 },
      { id: 'child-5', displayName: 'Level Five', xpTotal: 4_100, level: 5 },
    ];
    store.state.familyMembers = crew.map(({ id, displayName }) => (
      { id, role: 'child', displayName, level: 1 }
    ));
    store.state.gamificationSummaries = crew.map(({ id, xpTotal, level }) => readyProjection(id, xpTotal, level));

    for (const { id, level } of crew) {
      const page = renderProfile(`/family/${id}`);
      expect(screen.getByTestId('profile-level')).toHaveTextContent(`Level ${level}`);
      page.unmount();
    }
  });

  it('renders the parent own progression when viewing self', () => {
    renderProfile('/family/parent-1');

    expect(screen.getByTestId('profile-level')).toHaveTextContent('Level 10');
    expect(screen.getByTestId('profile-lifetime-xp')).toHaveTextContent('9000');
  });

  it('renders another parent progression from their lifetime XP', () => {
    renderProfile('/family/parent-2');

    expect(screen.getByTestId('profile-lifetime-xp')).toHaveTextContent('3200');
    expect(screen.getByTestId('profile-level')).toHaveTextContent('Level 4');
  });

  it('renders distinct values when the route changes between children', () => {
    const first = renderProfile('/family/child-1');
    expect(screen.getByTestId('profile-lifetime-xp')).toHaveTextContent('2500');
    first.unmount();

    renderProfile('/family/child-2');
    expect(screen.getByTestId('profile-lifetime-xp')).toHaveTextContent('1250');
  });

  it('shows a not-found state for an unknown member', () => {
    renderProfile('/family/ghost');

    expect(screen.queryByTestId('profile-progression')).not.toBeInTheDocument();
    expect(screen.getByTestId('profile-not-found')).toBeInTheDocument();
  });
});
