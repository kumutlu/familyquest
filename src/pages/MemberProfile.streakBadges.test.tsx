import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n/config';

const store = vi.hoisted(() => ({ state: {} as any }));

vi.mock('../store/useStore', () => ({ useStore: () => store.state }));
vi.mock('../components/reversals/HistoryActionControl', () => ({ HistoryActionControl: () => null }));

import { MemberProfile } from './MemberProfile';

function readySummary(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    familyId: 'family-1',
    childId: 'child-1',
    xpTotal: 0,
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
    ...overrides,
  };
}

function renderProfile(memberId = 'child-1') {
  render(
    <MemoryRouter initialEntries={[`/family/${memberId}`]}>
      <Routes>
        <Route path="/family/:id" element={<MemberProfile />} />
      </Routes>
    </MemoryRouter>,
  );
}

function badgeLocked(name: string): boolean {
  const card = screen.getByText(name).closest('.transition-all');
  expect(card).not.toBeNull();
  return card!.className.includes('grayscale');
}

describe('MemberProfile streak display and streak badges share one source', () => {
  beforeEach(async () => {
    await i18n.loadNamespaces(['profile', 'dashboard']);
    await i18n.changeLanguage('en');
  });

  it('keeps the streak badge locked when a ready projection shows 0 despite legacy longestStreak 3', () => {
    store.state = {
      familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Mnalium', rewardPoints: 350, longestStreak: 3, currentStreak: 3 }],
      loading: false,
      behaviourEvents: [],
      gamificationSummaries: [readySummary()],
      dailyProgress: [],
    };
    renderProfile();
    expect(screen.getByTestId('profile-current-streak')).toHaveTextContent('0');
    expect(screen.getByTestId('profile-best-streak')).toHaveTextContent('0');
    expect(badgeLocked('On Fire')).toBe(true);
  });

  it('unlocks the streak badge when the ready projection reports a 3-day best streak', () => {
    store.state = {
      familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Mnalium', rewardPoints: 0, longestStreak: 0 }],
      loading: false,
      behaviourEvents: [],
      gamificationSummaries: [readySummary({ currentStreak: 3, bestStreak: 3 })],
      dailyProgress: [],
    };
    renderProfile();
    expect(screen.getByTestId('profile-best-streak')).toHaveTextContent('3');
    expect(badgeLocked('On Fire')).toBe(false);
  });

  it('falls back to the legacy counters only when no projection is available', () => {
    store.state = {
      familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Mnalium', rewardPoints: 0, longestStreak: 3, currentStreak: 1 }],
      loading: false,
      behaviourEvents: [],
      gamificationSummaries: [],
      dailyProgress: [],
    };
    renderProfile();
    expect(screen.getByTestId('profile-current-streak')).toHaveTextContent('1');
    expect(screen.getByTestId('profile-best-streak')).toHaveTextContent('3');
    expect(badgeLocked('On Fire')).toBe(false);
  });

  it('uses the viewed child projection when a parent opens the profile (no cross-member leakage)', () => {
    store.state = {
      familyMembers: [
        { id: 'child-1', role: 'child', displayName: 'Mnalium', rewardPoints: 0, longestStreak: 0 },
        { id: 'child-2', role: 'child', displayName: 'Ali', rewardPoints: 0, longestStreak: 0 },
      ],
      loading: false,
      behaviourEvents: [],
      gamificationSummaries: [
        readySummary({ childId: 'child-1', currentStreak: 7, bestStreak: 9 }),
        readySummary({ childId: 'child-2', currentStreak: 1, bestStreak: 2 }),
      ],
      currentUser: { id: 'parent-1', role: 'parent', displayName: 'Kemal', longestStreak: 11 },
      myGamificationSummary: readySummary({ childId: 'parent-1', currentStreak: 11, bestStreak: 12 }),
      dailyProgress: [],
    };
    renderProfile('child-2');
    expect(screen.getByTestId('profile-current-streak')).toHaveTextContent('1');
    expect(screen.getByTestId('profile-best-streak')).toHaveTextContent('2');
    expect(badgeLocked('On Fire')).toBe(true);
  });
});
