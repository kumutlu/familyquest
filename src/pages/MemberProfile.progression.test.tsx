import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n/config';

const store = vi.hoisted(() => ({ state: {} as any }));

vi.mock('../store/useStore', () => ({ useStore: () => store.state }));
vi.mock('../components/reversals/HistoryActionControl', () => ({ HistoryActionControl: () => null }));

import { MemberProfile } from './MemberProfile';

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
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/family/:id" element={<MemberProfile />} />
      </Routes>
    </MemoryRouter>,
  );

describe('MemberProfile progression section', () => {
  beforeEach(async () => {
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
