import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import i18n from '../../i18n/config';
import '@testing-library/jest-dom/vitest';
import { FamilyWorld } from './FamilyWorld';
import type { FamilyWorldViewModel } from '../../lib/familyWorld/types';
import { BrowserRouter } from 'react-router-dom';
import { MoneyPrivacyProvider } from '../privacy/MoneyPrivacyContext';
import { MoneyPrivacyToggle } from '../privacy/MoneyPrivacyToggle';

describe('FamilyWorld Component', () => {
  beforeEach(async () => {
    await i18n.loadNamespaces(['familyWorld', 'common', 'family']);
    await i18n.changeLanguage('en');
    sessionStorage.clear();
  });

  const baseViewModel: FamilyWorldViewModel = {
    familyIdentity: { id: 'f1', name: 'The Incredibles' },
    viewerRole: 'parent',
    members: [
      {
        id: 'p1',
        displayName: 'Bob (Parent)',
        role: 'parent',
        level: 5,
        xp: 1200,
        points: 0,
        streakDays: 4,
        canViewWallet: true,
        isSelf: true,
        canSendMoney: false,
        canViewQuests: true,
        canManage: false,
      },
      {
        id: 'c1',
        displayName: 'Dash',
        role: 'child',
        level: 3,
        xp: 350,
        points: 50,
        streakDays: 7,
        walletBalanceFormatted: '£43.21',
        canViewWallet: true,
        isSelf: false,
        canSendMoney: true,
        canViewQuests: true,
        canManage: true,
      },
    ],
    activeChildren: [
      {
        id: 'c1',
        displayName: 'Dash',
        role: 'child',
        level: 3,
        xp: 350,
        points: 50,
        streakDays: 7,
        walletBalanceFormatted: '£43.21',
        canViewWallet: true,
        isSelf: false,
        canSendMoney: true,
        canViewQuests: true,
        canManage: true,
      },
    ],
    isSingleChild: true,
    activeFamilyQuest: {
      id: 'quest-1',
      title: 'Save the City',
      target: 200,
      current: 150,
      percentage: 75,
      isCompleted: false,
      isClaimed: false,
      daysRemaining: 3,
      rewardXp: 100,
      points: 50,
      contributions: [{ memberId: 'c1', displayName: 'Dash', count: 150 }],
      canClaim: false,
    },
    sharedProgression: {
      title: 'Family Progress',
      subtitle: 'Our collective achievements and momentum',
      totalCompletedTasks: 14,
      completedChallengesCount: 2,
      activeStreaksCount: 2,
    },
    recentMoments: [
      {
        id: 'm1',
        type: 'quest_approved',
        title: 'Dash completed "Speed Run"',
        description: 'Quest confirmed and rewards granted.',
        primaryActorName: 'Dash',
        priority: 80,
      },
    ],
    sharedAchievements: [
      {
        id: 'ach-1',
        title: 'Super Family',
        category: 'family',
        isUnlocked: true,
      },
    ],
  };

  const renderComponent = (vm: FamilyWorldViewModel = baseViewModel, onClaimQuest = vi.fn()) => {
    return render(
      <BrowserRouter>
        <MoneyPrivacyProvider>
          <MoneyPrivacyToggle />
          <FamilyWorld viewModel={vm} onClaimQuest={onClaimQuest} />
        </MoneyPrivacyProvider>
      </BrowserRouter>
    );
  };

  it('renders single-child layout without empty sibling slots or comparisons', async () => {
    await act(async () => {
      renderComponent();
    });

    expect(screen.getByText('The Incredibles')).toBeInTheDocument();
    expect(screen.getAllByText('Dash').length).toBeGreaterThan(0);
    expect(screen.getByText('Save the City')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('14')).toBeInTheDocument(); // totalCompletedTasks
  });

  it('opens member detail bottom sheet when child avatar is clicked', async () => {
    await act(async () => {
      renderComponent();
    });

    const memberButton = screen.getByLabelText(/View Dash/i);
    await act(async () => {
      fireEvent.click(memberButton);
    });

    // Detail sheet displays stats
    expect(screen.getAllByText('Dash').length).toBeGreaterThan(0);
    expect(screen.getByText(/Send money/i)).toBeInTheDocument();
    expect(screen.getByText(/View quests/i)).toBeInTheDocument();
  });

  it('masks the exact source-wallet balance in the real member detail sheet', async () => {
    await act(async () => {
      renderComponent();
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText(/View Dash/i));
    });
    expect(screen.getByText('£43.21')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Hide money amounts' }));
    });
    expect(screen.queryByText('£43.21')).not.toBeInTheDocument();
    expect(screen.getByText('£••••')).toBeInTheDocument();
  });

  it('renders multi-child layout with natural spacing', async () => {
    const multiChildViewModel: FamilyWorldViewModel = {
      ...baseViewModel,
      isSingleChild: false,
      activeChildren: [
        baseViewModel.activeChildren[0],
        {
          id: 'c2',
          displayName: 'Violet',
          role: 'child',
          level: 4,
          xp: 600,
          points: 80,
          streakDays: 10,
          walletBalanceFormatted: '80 pts',
          canViewWallet: true,
          isSelf: false,
          canSendMoney: true,
          canViewQuests: true,
          canManage: true,
        },
      ],
    };

    await act(async () => {
      renderComponent(multiChildViewModel);
    });

    expect(screen.getAllByText('Dash').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Violet').length).toBeGreaterThan(0);
  });

  it('allows parent to claim completed Family Quest', async () => {
    const claimableViewModel: FamilyWorldViewModel = {
      ...baseViewModel,
      activeFamilyQuest: {
        ...baseViewModel.activeFamilyQuest!,
        isCompleted: true,
        percentage: 100,
        canClaim: true,
      },
    };

    const handleClaim = vi.fn();
    await act(async () => {
      renderComponent(claimableViewModel, handleClaim);
    });

    // Dismiss celebration modal if open
    const dismissButton = screen.queryByRole('button', { name: /Tap to continue/i });
    if (dismissButton) {
      await act(async () => {
        fireEvent.click(dismissButton);
      });
    }

    const claimButton = screen.getByRole('button', { name: /Claim reward/i });
    expect(claimButton).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(claimButton);
    });
    expect(handleClaim).toHaveBeenCalledWith('quest-1');
  });

  it('renders recent family moments', async () => {
    await act(async () => {
      renderComponent();
    });
    expect(screen.getByText('Dash completed "Speed Run"')).toBeInTheDocument();
  });

  it('renders shared achievements', async () => {
    await act(async () => {
      renderComponent();
    });
    expect(screen.getByText('Super Family')).toBeInTheDocument();
  });
});
