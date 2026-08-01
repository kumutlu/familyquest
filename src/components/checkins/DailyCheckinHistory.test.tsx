import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n/config';
import type { DailyCheckinRecord } from '../../lib/dailyCheckins';
import { DailyCheckinHistory } from './DailyCheckinHistory';

const store = vi.hoisted(() => ({ state: {} as any }));

vi.mock('../../store/useStore', () => ({ useStore: () => store.state }));

const alexRecord: DailyCheckinRecord = {
  id: 'alex-2026-07-30', familyId: 'family-1', userId: 'alex', localDate: '2026-07-30',
  animal: 'cheetah', catalogVersion: 1, createdAt: {}, updatedAt: {},
};
const samRecord: DailyCheckinRecord = {
  id: 'sam-2026-08-01', familyId: 'family-1', userId: 'sam', localDate: '2026-08-01',
  animal: 'owl', catalogVersion: 1, createdAt: {}, updatedAt: {},
};

function renderHistory(overrides: Record<string, unknown> = {}) {
  store.state = {
    currentUser: { id: 'parent-1', familyId: 'family-1', role: 'parent' },
    familyData: {
      id: 'family-1',
      timezone: 'Europe/London',
      dailyCheckins: { historyVisibleToParents: true },
    },
    familyMembers: [
      { id: 'alex', familyId: 'family-1', displayName: 'Alex' },
      { id: 'sam', familyId: 'family-1', displayName: 'Sam' },
    ],
    dailyCheckinDay: '2026-08-01',
    dailyCheckinHistoryResolved: true,
    dailyCheckinHistory: [],
    ...overrides,
  };
  const user = userEvent.setup();
  render(<DailyCheckinHistory />);
  return user;
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  await i18n.loadNamespaces(['checkins']);
});

describe('DailyCheckinHistory', () => {
  it('withholds entries when family history is disabled', () => {
    renderHistory({
      familyData: {
        id: 'family-1',
        dailyCheckins: { historyVisibleToParents: false },
      },
      dailyCheckinHistory: [alexRecord],
    });

    expect(screen.getByText(/history is turned off/i)).toBeVisible();
    expect(screen.queryByText('Alex')).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('shows loading until the history listener is resolved', () => {
    renderHistory({ dailyCheckinHistoryResolved: false, dailyCheckinHistory: [alexRecord] });

    expect(screen.getByText(/loading check-in history/i)).toBeVisible();
    expect(screen.queryByText('Alex')).not.toBeInTheDocument();
  });

  it('shows an explicit empty state once history resolves without records', () => {
    renderHistory();

    expect(screen.getByText(/no check-ins to show yet/i)).toBeVisible();
  });

  it('filters the newest-first history list by family member', async () => {
    const user = renderHistory({ dailyCheckinHistory: [alexRecord, samRecord] });

    const recent = screen.getByRole('list', { name: /recent selections/i });
    expect(within(recent).getAllByRole('listitem').map(item => item.textContent))
      .toEqual([expect.stringContaining('Sam'), expect.stringContaining('Alex')]);
    expect(within(recent).getByText('Aug 1, 2026')).toBeVisible();
    expect(within(recent).getByLabelText('Owl')).toBeVisible();
    expect(within(recent).getByText('Ready to learn')).toBeVisible();

    await user.selectOptions(screen.getByRole('combobox', { name: /family member/i }), 'alex');

    expect(within(recent).getByText('Alex')).toBeVisible();
    expect(within(recent).queryByText('Sam')).not.toBeInTheDocument();
  });

  it('reports only explicit seven-day selections with neutral wording', () => {
    renderHistory({
      dailyCheckinHistory: [
        { ...samRecord, id: 'alex-1', userId: 'alex', localDate: '2026-08-01', animal: 'sloth' },
        { ...samRecord, id: 'alex-2', userId: 'alex', localDate: '2026-07-30', animal: 'sloth' },
        { ...samRecord, id: 'alex-3', userId: 'alex', localDate: '2026-07-27', animal: 'sloth' },
      ],
    });

    expect(screen.getByText("Alex selected ‘Tired’ three times in the last seven days.")).toBeVisible();
    expect(document.body).not.toHaveTextContent(/depress|anxious|risk|abnormal/i);
  });

  it('uses the localized unknown-member fallback and ignores non-selection records', () => {
    renderHistory({
      familyMembers: [],
      dailyCheckinHistory: [
        { ...samRecord, userId: 'unknown-member' },
        { id: 'skip', familyId: 'family-1', userId: 'alex', localDate: '2026-08-01' } as DailyCheckinRecord,
      ],
    });

    expect(within(screen.getByRole('list', { name: /recent selections/i })).getByText('Family member')).toBeVisible();
    expect(screen.queryByText('skip')).not.toBeInTheDocument();
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });
});
