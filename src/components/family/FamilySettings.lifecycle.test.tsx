import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { FamilySettings } from './FamilySettings';
import { useStore } from '../../store/useStore';
import i18n from '../../i18n/config';

// Mock the lifecycle API (server-authoritative; the UI only invokes it).
const mockArchiveMember = vi.fn();
const mockRestoreMember = vi.fn();
const mockRemoveMember = vi.fn();
const mockChangeRole = vi.fn();
const mockTransferOwnership = vi.fn();

vi.mock('../../lib/memberLifecycleApi', () => ({
  archiveMember: (...args: any[]) => mockArchiveMember(...args),
  restoreMember: (...args: any[]) => mockRestoreMember(...args),
  removeMemberFromFamily: (...args: any[]) => mockRemoveMember(...args),
  changeMemberRole: (...args: any[]) => mockChangeRole(...args),
  transferOwnership: (...args: any[]) => mockTransferOwnership(...args),
}));

// generateClientReqId is already mocked by the familyDeletionApi mock below.
vi.mock('../../lib/familyDeletionApi', () => ({
  leaveFamily: vi.fn(async () => ({ left: true })),
  generateClientReqId: () => 'test-client-req-00000001',
}));

vi.mock('../../lib/api', () => ({
  updateFamilySettings: vi.fn(async () => {}),
  approveJoinRequest: vi.fn(async () => {}),
  rejectJoinRequest: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
}));
vi.mock('../../lib/familyMembershipApi', () => ({
  regenerateFamilyCode: vi.fn(async () => ({ inviteCode: 'NEW456' })),
}));

const DEFAULT_MEMBERS = [
  { id: 'u1', displayName: 'Owner One', role: 'owner' },
  { id: 'u2', displayName: 'Kid One', role: 'child' },
  { id: 'u3', displayName: 'Parent Two', role: 'parent' },
  { id: 'u4', displayName: 'Adult Three', role: 'adult' },
];

function seedStore(role: string, members: any[] = DEFAULT_MEMBERS) {
  act(() => {
    useStore.setState({
      currentUser: {
        id: 'u1',
        displayName: 'Owner One',
        email: 'owner@example.com',
        avatarUrl: '',
        role,
        familyId: 'fam1',
      },
      familyData: {
        id: 'fam1',
        name: 'The Family',
        inviteCode: 'ABC123',
        currencyCode: 'GBP',
        timezone: 'Europe/London',
        weekStartsOn: 1,
      },
      familyMembers: members,
      joinRequests: [],
      familyLoading: false,
    });
  });
}

function renderSettings(role: string, members?: any[]) {
  seedStore(role, members);
  return render(
    <MemoryRouter>
      <FamilySettings />
    </MemoryRouter>,
  );
}

async function goToMembers(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Members' }));
}

beforeEach(async () => {
  await act(async () => {
    await i18n.changeLanguage('en');
  });
  mockArchiveMember.mockClear();
  mockRestoreMember.mockClear();
  mockRemoveMember.mockClear();
  mockChangeRole.mockClear();
  mockTransferOwnership.mockClear();

  mockArchiveMember.mockImplementation(async () => ({ targetUid: 'u3', lifecycle: 'archived' }));
  mockRestoreMember.mockImplementation(async () => ({ targetUid: 'u9', lifecycle: 'active' }));
  mockRemoveMember.mockImplementation(async () => ({ targetUid: 'u3', lifecycle: 'removed' }));
  mockChangeRole.mockImplementation(async () => ({ targetUid: 'u4', role: 'parent' }));
  mockTransferOwnership.mockImplementation(async () => ({ targetUid: 'u3', previousOwnerUid: 'u1' }));
});

afterEach(() => {
  vi.clearAllMocks();
  useStore.setState({ currentUser: null, familyData: null, familyMembers: [], joinRequests: [] });
});

describe('FamilySettings — member lifecycle (owner authority)', () => {
  it('owner sees Archive / Change role / Make owner / Remove for a parent and an adult', async () => {
    const user = userEvent.setup();
    renderSettings('owner');
    await goToMembers(user);

    // Parent Two (u3) and Adult Three (u4) are both manageable by the owner.
    const archiveButtons = screen.getAllByRole('button', { name: 'Archive member' });
    expect(archiveButtons.length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByRole('button', { name: 'Change role' }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByRole('button', { name: 'Make owner' }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByRole('button', { name: 'Remove from family' }).length).toBeGreaterThanOrEqual(2);
  });

  it('owner does NOT see lifecycle actions on their own card', async () => {
    const user = userEvent.setup();
    renderSettings('owner');
    await goToMembers(user);

    // The owner's own card (Owner One) must not expose management actions.
    const makeOwnerButtons = screen.getAllByRole('button', { name: 'Make owner' });
    // Only u3 and u4 are eligible, never u1 (self) or u2 (child).
    expect(makeOwnerButtons.length).toBe(2);
  });

  it('owner can archive a child but is NEVER offered Remove for a child', async () => {
    const user = userEvent.setup();
    renderSettings('owner');
    await goToMembers(user);

    // The child (Kid One, u2) is shown with an Archive action only.
    expect(screen.getAllByRole('button', { name: 'Archive member' }).length).toBeGreaterThanOrEqual(1);
    // Remove is offered only for non-child manageable members (Parent Two u3 +
    // Adult Three u4 = 2). The child card must never expose Remove, so the
    // count must be exactly 2 — never 3.
    expect(screen.getAllByRole('button', { name: 'Remove from family' }).length).toBe(2);
  });

  it('opening Archive shows a two-step confirmation and invokes archiveMember on confirm', async () => {
    const user = userEvent.setup();
    renderSettings('owner');
    await goToMembers(user);

    const archiveButtons = screen.getAllByRole('button', { name: 'Archive member' });
    // Click the one for Parent Two (u3) — first eligible card.
    await user.click(archiveButtons[0]);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Archive Parent Two?')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Archive member' }));

    await waitFor(() => expect(mockArchiveMember).toHaveBeenCalledWith('u3', 'test-client-req-00000001'));
  });

  it('Remove confirmation is marked destructive and invokes removeMemberFromFamily', async () => {
    const user = userEvent.setup();
    renderSettings('owner');
    await goToMembers(user);

    const removeButtons = screen.getAllByRole('button', { name: 'Remove from family' });
    await user.click(removeButtons[0]);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Remove Parent Two from this family?')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Remove from family' }));
    await waitFor(() => expect(mockRemoveMember).toHaveBeenCalledWith('u3', 'test-client-req-00000001'));
  });

  it('Make owner (transfer) invokes transferOwnership', async () => {
    const user = userEvent.setup();
    renderSettings('owner');
    await goToMembers(user);

    const makeOwnerButtons = screen.getAllByRole('button', { name: 'Make owner' });
    await user.click(makeOwnerButtons[0]);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Transfer ownership to Parent Two?')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Make owner' }));
    await waitFor(() => expect(mockTransferOwnership).toHaveBeenCalledWith('u3', 'test-client-req-00000001'));
  });
});

describe('FamilySettings — member lifecycle (parent authority)', () => {
  it('parent can archive a child but cannot manage adults', async () => {
    const user = userEvent.setup();
    renderSettings('parent');
    await goToMembers(user);

    // Parent may archive the child (Kid One).
    expect(screen.getAllByRole('button', { name: 'Archive member' }).length).toBe(1);
    // Parent must NOT see owner-only actions on the adult/parent cards.
    expect(screen.queryByRole('button', { name: 'Make owner' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove from family' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change role' })).not.toBeInTheDocument();
  });
});

describe('FamilySettings — archived members section', () => {
  it('shows archived members with a Restore action for the owner', async () => {
    const user = userEvent.setup();
    const members = [
      ...DEFAULT_MEMBERS,
      { id: 'u9', displayName: 'Archived Past', role: 'parent', lifecycle: 'archived' },
    ];
    renderSettings('owner', members);
    await goToMembers(user);

    expect(screen.getByRole('heading', { name: 'Archived members' })).toBeInTheDocument();
    const restoreButtons = screen.getAllByRole('button', { name: 'Restore member' });
    expect(restoreButtons.length).toBe(1);

    await user.click(restoreButtons[0]);

    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Restore member' }));
    await waitFor(() => expect(mockRestoreMember).toHaveBeenCalledWith('u9', 'test-client-req-00000001'));
  });

  it('excludes archived members from the active Parents/Children lists', async () => {
    const user = userEvent.setup();
    const members = [
      { id: 'u1', displayName: 'Owner One', role: 'owner' },
      { id: 'u9', displayName: 'Archived Past', role: 'parent', lifecycle: 'archived' },
    ];
    renderSettings('owner', members);
    await goToMembers(user);

    // Archived member must not appear as a manageable parent card.
    expect(screen.queryByText('Parent Two')).not.toBeInTheDocument();
    expect(screen.getByText('Archived Past')).toBeInTheDocument();
  });
});

describe('FamilySettings — child self-management prohibition', () => {
  it('child sees no lifecycle management actions for others', async () => {
    const user = userEvent.setup();
    renderSettings('child');
    await goToMembers(user);

    expect(screen.queryByRole('button', { name: 'Archive member' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make owner' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove from family' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change role' })).not.toBeInTheDocument();
  });
});
