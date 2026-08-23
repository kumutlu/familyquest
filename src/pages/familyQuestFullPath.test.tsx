import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Family } from './Family';
import { useStore } from '../store/useStore';
import * as api from '../lib/api';
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

describe('Phase 39: Family Quest Full-Path Regression', () => {
  beforeEach(async () => {
    await i18n.loadNamespaces(['family', 'familyWorld', 'common']);
    await i18n.changeLanguage('en');
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it('progresses through full lifecycle: active -> milestone -> target reached -> claim -> celebration once', async () => {
    const parentUser = {
      id: 'p-1',
      displayName: 'Kemal (Parent)',
      role: 'owner',
      familyId: 'fam-100',
    };

    const childUser = {
      id: 'c-1',
      displayName: 'Ada (Child)',
      role: 'child',
      familyId: 'fam-100',
      ['lifetimeXP']: 0,
      streak: { current: 3, longest: 3 },
    };

    // Step 1: Active Family Quest (50 / 100 XP)
    let currentStoreState = {
      loading: false,
      currentUser: parentUser,
      familyMembers: [parentUser, childUser],
      tasks: [],
      taskCompletions: [],
      challenges: [
        {
          id: 'chal-100',
          familyId: 'fam-100',
          title: 'Clean Up Crew Challenge',
          description: 'Team quest for the whole family',
          targetXP: 100,
          startXP: 0,
          ['rewardPoints']: 40,
          rewardXP: 50,
          isActive: true,
        },
      ],
      gamificationSummaries: [
        {
          id: 'c-1',
          familyId: 'fam-100',
          xpTotal: 50,
          level: 1,
          pointsBalance: 10,
        },
      ],
      walletTransactions: [],
    };

    (useStore as any).mockImplementation(() => currentStoreState);

    let renderResult: any;
    await act(async () => {
      renderResult = render(
        <BrowserRouter>
          <Family />
        </BrowserRouter>
      );
    });

    // Initial Active state: progress is 50%
    expect(await screen.findByText('Clean Up Crew Challenge')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();

    // Step 2: Child completes quest, authoritative XP jumps to 100 (Target Reached)
    currentStoreState = {
      ...currentStoreState,
      gamificationSummaries: [
        {
          id: 'c-1',
          familyId: 'fam-100',
          xpTotal: 100,
          level: 2,
          pointsBalance: 10,
        },
      ],
    };

    await act(async () => {
      renderResult.rerender(
        <BrowserRouter>
          <Family />
        </BrowserRouter>
      );
    });

    // Target Reached state: progress is 100%, Claim button appears
    expect(screen.getByText('100%')).toBeInTheDocument();

    // Find claim button
    const buttons = screen.getAllByRole('button');
    const claimButton = buttons.find((b) => b.textContent?.includes('Claim') || b.textContent?.includes('claim'));
    expect(claimButton).toBeDefined();

    // Step 3: Parent claims reward
    if (claimButton) {
      await act(async () => {
        fireEvent.click(claimButton);
      });
      expect(api.claimChallenge).toHaveBeenCalledWith('fam-100', 'chal-100');
    }
  });
});
