import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Family } from './Family';
import { useStore } from '../store/useStore';
import i18n from '../i18n/config';
import '@testing-library/jest-dom/vitest';
import { BrowserRouter } from 'react-router-dom';

vi.mock('../store/useStore', () => ({
  useStore: vi.fn(),
}));

describe('Phase 40: Family Moment Full-Path Regression', () => {
  beforeEach(async () => {
    await i18n.loadNamespaces(['family', 'familyWorld', 'common']);
    await i18n.changeLanguage('en');
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it('renders cross-feature moments from authoritative transactions and approved quests', async () => {
    const parentUser = {
      id: 'p-1',
      displayName: 'Dad',
      role: 'owner',
      familyId: 'fam-200',
    };

    const childUserA = {
      id: 'c-1',
      displayName: 'Ada',
      role: 'child',
      familyId: 'fam-200',
    };

    const childUserB = {
      id: 'c-2',
      displayName: 'Ali',
      role: 'child',
      familyId: 'fam-200',
    };

    // Live update with cross-feature events
    (useStore as any).mockReturnValue({
      loading: false,
      currentUser: parentUser,
      familyMembers: [parentUser, childUserA, childUserB],
      tasks: [
        {
          id: 'task-approved-1',
          title: 'Math Homework',
          status: 'approved',
          approvalStatus: 'approved',
          completedBy: 'c-1',
          familyId: 'fam-200',
          updatedAt: { toDate: () => new Date('2026-08-23T12:00:00Z') },
        },
      ],
      taskCompletions: [],
      challenges: [],
      gamificationSummaries: [],
      walletTransactions: [
        {
          id: 'tx-100',
          type: 'transfer',
          amount: 250,
          fromUserId: 'p-1',
          toUserId: 'c-2',
          fromUserName: 'Dad',
          toUserName: 'Ali',
          timestamp: { toDate: () => new Date('2026-08-23T12:05:00Z') },
        },
      ],
    });

    await act(async () => {
      render(
        <BrowserRouter>
          <Family />
        </BrowserRouter>
      );
    });

    // Moments section displays curated meaningful events
    expect(await screen.findByText('Family Moments')).toBeInTheDocument();
    expect(screen.getByText('Dad sent money')).toBeInTheDocument();
    expect(screen.getByText('Ada completed "Math Homework"')).toBeInTheDocument();
  });
});
