import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Family } from './Family';
import { useStore } from '../store/useStore';
import i18n from '../i18n/config';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../store/useStore', () => ({
  useStore: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  createChallenge: vi.fn().mockResolvedValue({}),
  claimChallenge: vi.fn().mockResolvedValue({}),
}));

vi.mock('../components/family/ManageChildDialog', () => ({
  ManageChildDialog: ({ member, onClose }: any) => (
    <div data-testid="manage-child-dialog" data-child-id={member.id}>
      <span>Managing {member.displayName}</span>
      <button onClick={onClose}>Close Dialog</button>
    </div>
  ),
}));

describe('Family Page Manage Child Integration', () => {
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
    lifetimeXP: 180,
    isManaged: true,
  };

  beforeEach(async () => {
    await i18n.loadNamespaces(['family', 'familyWorld', 'common']);
    await i18n.changeLanguage('en');
    vi.clearAllMocks();
    (useStore as any).mockReturnValue({
      loading: false,
      currentUser: mockParentUser,
      familyMembers: [mockParentUser, mockChildUser],
      tasks: [],
      taskCompletions: [],
      challenges: [],
      gamificationSummaries: [],
      walletTransactions: [],
      childWallets: [],
    });
  });

  it('clicking child avatar opens MemberDetailSheet and tapping Manage Member opens ManageChildDialog without navigating away', async () => {
    const user = userEvent.setup();
    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/family']}>
          <Family />
        </MemoryRouter>,
      );
    });

    // Click child in family world
    const childButton = await screen.findByRole('button', { name: /View Little Explorer/i });
    await user.click(childButton);

    // MemberDetailSheet opens
    const manageButton = screen.getByRole('button', { name: /Manage child/i });
    expect(manageButton).toBeInTheDocument();

    await user.click(manageButton);

    // ManageChildDialog opens directly with the child
    const dialog = screen.getByTestId('manage-child-dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('data-child-id', 'child-1');
  });
});
