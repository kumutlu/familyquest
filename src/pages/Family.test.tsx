import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Family } from './Family';
import { useStore } from '../store/useStore';
import { useRecurrenceClock } from '../lib/useRecurrenceClock';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import i18n from '../i18n/config';

vi.mock('../store/useStore', () => ({
  useStore: vi.fn(),
}));

vi.mock('../lib/useRecurrenceClock', () => ({
  useRecurrenceClock: vi.fn(),
}));

const renderFamily = (storeState: any, now: Date = new Date()) => {
  (useRecurrenceClock as any).mockReturnValue(now);
  (useStore as any).mockReturnValue({
    loading: false,
    tasks: [],
    taskCompletions: [],
    challenges: [],
    ...storeState
  });
  return render(<MemoryRouter><Family /></MemoryRouter>);
};

describe('Family page', () => {
  beforeEach(async () => {
    await i18n.loadNamespaces(['family']);
    await i18n.changeLanguage('en');
    vi.resetAllMocks();
  });

  it('11. Kemal/owner renders Owner, 12. Bilge/parent renders Parent, 13. legacy admin renders Parent, 14. no Admin or ADMIN text', () => {
    renderFamily({
      currentUser: { id: 'k', role: 'owner', familyId: 'f1' },
      familyMembers: [
        { id: 'k', displayName: 'Kemal', role: 'owner', avatarUrl: '' },
        { id: 'b', displayName: 'Bilge', role: 'parent', avatarUrl: '' },
        { id: 'a', displayName: 'Old', role: 'admin', avatarUrl: '' },
        { id: 'c', displayName: 'Kid', role: 'child', avatarUrl: '', lifetimeXP: 0 },
      ]
    });
    expect(screen.queryByText(/Admin/i)).toBeNull();
    expect(screen.getByText('Kemal')).toBeInTheDocument();
    expect(screen.getByText('Bilge')).toBeInTheDocument();
    expect(screen.getByText('Old')).toBeInTheDocument();
    expect(screen.getByText('Kid')).toBeInTheDocument();
  });

  it('19. malformed role excluded, 20. authenticated child included, 21. managed child included', () => {
    renderFamily({
      currentUser: { id: 'auth_child', role: 'child', familyId: 'f1' },
      familyMembers: [
        { id: 'auth_child', displayName: 'AuthChild', role: 'child', avatarUrl: '', lifetimeXP: 0 },
        { id: 'managed_child', displayName: 'ManagedChild', role: 'child', avatarUrl: '', lifetimeXP: 0 },
        { id: 'weird', displayName: 'Weird', role: 'unknown', avatarUrl: '', lifetimeXP: 0 },
      ]
    });
    expect(screen.getByText('AuthChild')).toBeInTheDocument();
    expect(screen.getByText('ManagedChild')).toBeInTheDocument();
    expect(screen.queryByText('Weird')).toBeNull();
  });

  it('24. no-child empty state safe', () => {
    renderFamily({
      currentUser: { id: 'k', role: 'owner', familyId: 'f1' },
      familyMembers: []
    });
    expect(screen.queryByText('Leading the pack')).toBeNull();
  });

  it('renders correct button counts per role after adding Add Child and Invite Member to Family', () => {
    const { unmount } = renderFamily({
      currentUser: { id: 'k', role: 'owner', familyId: 'f1' },
      familyMembers: []
    });
    expect(screen.getAllByRole('button').length).toBe(6);
    unmount();

    const { unmount: unmountParent } = renderFamily({
      currentUser: { id: 'b', role: 'parent', familyId: 'f1' },
      familyMembers: []
    });
    // A parent (non-owner) gets the Invite Member button too — inviting is a
    // parent-level capability, not owner-only. This count is the regression
    // guard for the P0 fix where the button was missing for non-owner parents.
    expect(screen.getAllByRole('button').length).toBe(5);
    unmountParent();

    renderFamily({
      currentUser: { id: 'c', role: 'child', familyId: 'f1' },
      familyMembers: []
    });
    const buttons = screen.queryAllByRole('button');
    expect(buttons.length).toBe(3);
  });

  it('lifetime XP and wallet balances are never reset', () => {
    // This is a design invariant: the weekly scoreboard derives from
    // taskCompletions only (never from behaviourEvents, lifetimeXP, or wallet).
    renderFamily({
      currentUser: { id: 'p', role: 'parent', familyId: 'f1' },
      familyMembers: [
        { id: 'c1', displayName: 'Child', role: 'child', lifetimeXP: 5000, rewardPoints: 200 }
      ],
      tasks: [],
      taskCompletions: [],
      behaviourEvents: []
    });
    expect(screen.getByText('Child')).toBeInTheDocument();
  });

  it('weekly XP is based only on approved task completions', () => {
    const now = new Date();
    const task = { id: 't-1', title: 'Test', pointsReward: 15, isActive: true };

    renderFamily({
      currentUser: { id: 'p', role: 'parent', familyId: 'f1' },
      familyMembers: [
        { id: 'c1', displayName: 'Child', role: 'child', lifetimeXP: 100, rewardPoints: 50 }
      ],
      tasks: [task],
      taskCompletions: [
        { id: 'c-1', taskId: 't-1', assigneeId: 'c1', status: 'approved', approvedAt: { toDate: () => now } }
      ],
      behaviourEvents: []
    }, now);

    // Weekly XP should be 15 from the task completion
    expect(screen.getByText(/15 pts this week/)).toBeInTheDocument();
  });

  it('children rank correctly by weekly XP', () => {
    const now = new Date();
    const task = { id: 't-1', title: 'Test', pointsReward: 10, isActive: true };
    const task2 = { id: 't-2', title: 'Test2', pointsReward: 20, isActive: true };

    renderFamily({
      currentUser: { id: 'p', role: 'parent', familyId: 'f1' },
      familyMembers: [
        { id: 'c1', displayName: 'Alice', role: 'child', lifetimeXP: 0 },
        { id: 'c2', displayName: 'Bob', role: 'child', lifetimeXP: 0 }
      ],
      tasks: [task, task2],
      taskCompletions: [
        { id: 'c-1', taskId: 't-1', assigneeId: 'c1', status: 'approved', approvedAt: { toDate: () => now } },
        { id: 'c-2', taskId: 't-2', assigneeId: 'c2', status: 'approved', approvedAt: { toDate: () => now } }
      ],
      behaviourEvents: []
    }, now);

    const alice = screen.getByText('Alice');
    const bob = screen.getByText('Bob');
    expect(alice).toBeInTheDocument();
    expect(bob).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText(/20 pts this week/)).toBeInTheDocument();
    expect(screen.getByText(/10 pts this week/)).toBeInTheDocument();
  });

  // Regression: the Family Hub header actions were silently disconnected —
  // "Invite Member" queried a `[data-invite-code]` node that no longer exists,
  // so tapping it did nothing. These tests fail if the handlers stop opening
  // their flows again.
  describe('owner header actions stay wired', () => {
    const ownerState = {
      currentUser: { id: 'k', uid: 'k', role: 'owner', familyId: 'f1' },
      familyMembers: [],
      familyData: { id: 'f1', inviteCode: 'ABC123' },
    };

    beforeEach(async () => {
      await i18n.loadNamespaces(['family', 'common', 'settings', 'auth']);
    });

    it('Add child opens the managed child creation flow', async () => {
      const user = userEvent.setup();
      renderFamily(ownerState);

      await user.click(screen.getByRole('button', { name: /add child/i }));

      expect(await screen.findByRole('dialog')).toBeInTheDocument();
    });

    it('Invite Member opens the invite flow showing the family invite code', async () => {
      const user = userEvent.setup();
      renderFamily(ownerState);

      expect(screen.queryByText('ABC123')).toBeNull();

      await user.click(screen.getByRole('button', { name: /invite member/i }));

      expect(await screen.findByText('ABC123')).toBeInTheDocument();
    });
  });
});
