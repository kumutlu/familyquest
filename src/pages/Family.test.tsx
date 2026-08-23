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

vi.mock('../lib/api', () => ({
  createChallenge: vi.fn().mockResolvedValue({}),
  claimChallenge: vi.fn().mockResolvedValue({}),
}));

describe('Family Page (Wave 4 Queki v2 Living Family World)', () => {
  const mockParentUser = {
    id: 'parent-1',
    familyId: 'family-1',
    displayName: 'Super Parent',
    role: 'owner',
  };

  const mockChildUser = {
    id: 'child-1',
    familyId: 'family-1',
    displayName: 'Little Explorer',
    role: 'child',
    level: 2,
    ['lifetimeXP']: 180,
    streak: { current: 4, longest: 4 },
  };

  beforeEach(async () => {
    await i18n.loadNamespaces(['family', 'familyWorld', 'common']);
    await i18n.changeLanguage('en');
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it('renders loading state when store is loading', async () => {
    (useStore as any).mockReturnValue({
      loading: true,
      currentUser: null,
      familyMembers: [],
    });

    await act(async () => {
      render(
        <BrowserRouter>
          <Family />
        </BrowserRouter>
      );
    });

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders Family World for parent with active challenge and action triggers', async () => {
    (useStore as any).mockReturnValue({
      loading: false,
      currentUser: mockParentUser,
      familyMembers: [mockParentUser, mockChildUser],
      tasks: [],
      taskCompletions: [],
      challenges: [
        {
          id: 'chal-101',
          familyId: 'family-1',
          title: 'Clean Up Crew',
          targetXP: 200,
          startXP: 0,
          ['rewardPoints']: 50,
          isActive: true,
        },
      ],
      gamificationSummaries: [
        {
          id: 'child-1',
          familyId: 'family-1',
          xpTotal: 180,
          level: 2,
          pointsBalance: 30,
        },
      ],
      walletTransactions: [],
    });

    await act(async () => {
      render(
        <BrowserRouter>
          <Family />
        </BrowserRouter>
      );
    });

    expect(await screen.findAllByText(/Our Family/i)).toBeDefined();
    expect(screen.getByText('Clean Up Crew')).toBeInTheDocument();
    expect(screen.getAllByText('Little Explorer').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Add child/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Invite/i })).toBeInTheDocument();
  });

  it('renders child view without parent management controls', async () => {
    (useStore as any).mockReturnValue({
      loading: false,
      currentUser: mockChildUser,
      familyMembers: [mockParentUser, mockChildUser],
      tasks: [],
      taskCompletions: [],
      challenges: [],
      gamificationSummaries: [],
      walletTransactions: [],
    });

    await act(async () => {
      render(
        <BrowserRouter>
          <Family />
        </BrowserRouter>
      );
    });

    expect(await screen.findAllByText(/Our Family/i)).toBeDefined();
    expect(screen.queryByRole('button', { name: /Add child/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Invite/i })).not.toBeInTheDocument();
  });
});
