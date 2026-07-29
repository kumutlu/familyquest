import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { FamilySettings } from './FamilySettings';
import { useStore } from '../../store/useStore';
import i18n from '../../i18n/config';

const clipboardWriteText = vi.fn(async () => {});

// Mock the API functions
const mockUpdateFamilySettings = vi.fn();
const mockRegenerateInviteCode = vi.fn();
const mockApproveJoinRequest = vi.fn();
const mockRejectJoinRequest = vi.fn();

vi.mock('../../lib/api', () => ({
  updateFamilySettings: (...args: any[]) => mockUpdateFamilySettings(...args),
  regenerateInviteCode: (...args: any[]) => mockRegenerateInviteCode(...args),
  approveJoinRequest: (...args: any[]) => mockApproveJoinRequest(...args),
  rejectJoinRequest: (...args: any[]) => mockRejectJoinRequest(...args),
}));

// Mock the clipboard API
beforeEach(async () => {
  await act(async () => {
    await i18n.changeLanguage('en');
  });
  clipboardWriteText.mockClear();
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(clipboardWriteText);
  }
  // Reset all mock functions
  mockUpdateFamilySettings.mockReset();
  mockRegenerateInviteCode.mockReset();
  mockApproveJoinRequest.mockReset();
  mockRejectJoinRequest.mockReset();
  // Set default implementations
  mockUpdateFamilySettings.mockImplementation(async (familyId: string, updates: any) => {
    act(() => {
      const current = useStore.getState();
      if (current.familyData?.id === familyId) {
        useStore.setState({
          familyData: {
            ...current.familyData,
            ...updates,
          },
        });
      }
    });
  });
  mockRegenerateInviteCode.mockResolvedValue({ inviteCode: 'NEW456' });
  mockApproveJoinRequest.mockResolvedValue(undefined);
  mockRejectJoinRequest.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  useStore.setState({ currentUser: null, familyData: null, familyMembers: [], joinRequests: [] });
});

function seedStore(role: string, options: { joinRequests?: any[]; familyData?: Record<string, unknown> } = {}) {
  act(() => {
    useStore.setState({
      currentUser: {
        id: 'u1',
        displayName: 'Test User',
        email: 'test@example.com',
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
        ...options.familyData,
      },
      familyMembers: [
        { id: 'u1', displayName: 'Test User', role },
        { id: 'u2', displayName: 'Kid One', role: 'child' },
        { id: 'u3', displayName: 'Parent Two', role: 'parent' },
      ],
      joinRequests: options.joinRequests || [],
      familyLoading: false,
    });
  });
}

function renderFamilySettings(role: string, options: { joinRequests?: any[]; familyData?: Record<string, unknown> } = {}) {
  seedStore(role, options);
  return render(
    <MemoryRouter>
      <FamilySettings />
    </MemoryRouter>,
  );
}

describe('FamilySettings — basic rendering', () => {
  it('1. Renders all four sections for owner', () => {
    renderFamilySettings('owner');
    // Use getAllByText since "Family" appears multiple times
    expect(screen.getAllByText('Family').length).toBeGreaterThan(0);
    expect(screen.getByText('Members')).toBeInTheDocument();
    expect(screen.getByText('Regional')).toBeInTheDocument();
    expect(screen.getByText('Danger Zone')).toBeInTheDocument();
  });

  it('2. Shows section navigation', () => {
    renderFamilySettings('owner');
    // Navigation buttons are the primary way to identify sections
    expect(screen.getByRole('button', { name: 'Family' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Members' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Regional' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Danger Zone' })).toBeInTheDocument();
  });

  it('3. Family section shows family name and invite code for owner', () => {
    renderFamilySettings('owner');
    expect(screen.getByText('The Family')).toBeInTheDocument();
    expect(screen.getByText('ABC123')).toBeInTheDocument();
    expect(screen.getByLabelText('Copy invite code')).toBeInTheDocument();
  });

  it('4. Family section shows family name only for child', () => {
    renderFamilySettings('child');
    expect(screen.getByText('The Family')).toBeInTheDocument();
    expect(screen.queryByText('ABC123')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Copy invite code')).not.toBeInTheDocument();
  });

  it('5. Members section shows parents and children', async () => {
    const user = userEvent.setup();
    renderFamilySettings('owner');
    // Navigate to Members section first
    await user.click(screen.getByRole('button', { name: 'Members' }));
    // Use a function matcher for text that might be in multiple elements
    expect(screen.getByText(/Test User/)).toBeInTheDocument();
    expect(screen.getByText('Parent Two')).toBeInTheDocument();
    expect(screen.getByText('Kid One')).toBeInTheDocument();
  });

  it('6. Regional section shows currency, timezone, week starts', async () => {
    const user = userEvent.setup();
    renderFamilySettings('owner');
    // Navigate to Regional section first
    await user.click(screen.getByRole('button', { name: 'Regional' }));
    expect(screen.getByText('British Pound (£)')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /London/ })).toHaveValue('Europe/London');
    expect(screen.getByRole('option', { name: /Istanbul/ })).toHaveValue('Europe/Istanbul');
    expect(screen.getByText('Monday')).toBeInTheDocument();
  });

  it('7. Danger Zone shows placeholder with coming soon', async () => {
    const user = userEvent.setup();
    renderFamilySettings('owner');
    // Navigate to Danger Zone section
    await user.click(screen.getByRole('button', { name: 'Danger Zone' }));
    // Use getAllByText since "Danger Zone" appears multiple times
    expect(screen.getAllByText('Danger Zone').length).toBeGreaterThan(0);
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
  });

  it('lets only an owner persist the family Pet Box feature setting', async () => {
    const user = userEvent.setup();
    renderFamilySettings('owner');
    await user.click(screen.getByRole('button', { name: 'Gamification' }));
    const toggle = screen.getByRole('checkbox', { name: /Enable Pet Box/i });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockUpdateFamilySettings).toHaveBeenCalledWith(
      'fam1',
      expect.objectContaining({ petBoxEnabled: false }),
    ));
  });
});

describe('FamilySettings — family name editing', () => {
  it('8. Owner can edit family name', async () => {
    const user = userEvent.setup();
    renderFamilySettings('owner');
    await user.click(screen.getByRole('button', { name: 'Edit family name' }));
    const nameInput = screen.getByPlaceholderText('Enter family name');
    await user.clear(nameInput);
    await user.type(nameInput, 'New Family Name');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    // Wait for the success toast to appear
    expect(await screen.findByText('Family name updated successfully')).toBeInTheDocument();
  });

  it('9. Child cannot edit family name', () => {
    renderFamilySettings('child');
    expect(screen.queryByRole('button', { name: 'Edit family name' })).not.toBeInTheDocument();
  });

  it('10. Family name edit validates empty input', async () => {
    const user = userEvent.setup();
    renderFamilySettings('owner');
    await user.click(screen.getByRole('button', { name: 'Edit family name' }));
    const nameInput = screen.getByPlaceholderText('Enter family name');
    await user.clear(nameInput);
    await user.type(nameInput, '   '); // Only spaces
    // Button should be disabled when input is empty (after trimming)
    const saveButton = screen.getByRole('button', { name: 'Save' });
    expect(saveButton).toBeDisabled();
  });
});

describe('FamilySettings — invite code copy', () => {
  it('11. Copy invite code works for owner', async () => {
    const user = userEvent.setup();
    renderFamilySettings('owner');
    await user.click(screen.getByRole('button', { name: 'Copy invite code' }));
    expect(clipboardWriteText).toHaveBeenCalledWith('ABC123');
    expect(await screen.findByText('Invite code copied to clipboard.')).toBeInTheDocument();
  });

  it('12. Copy invite code works for parent', async () => {
    const user = userEvent.setup();
    renderFamilySettings('parent');
    await user.click(screen.getByRole('button', { name: 'Copy invite code' }));
    expect(clipboardWriteText).toHaveBeenCalledWith('ABC123');
    expect(await screen.findByText('Invite code copied to clipboard.')).toBeInTheDocument();
  });

  it('13. Child cannot copy invite code', () => {
    renderFamilySettings('child');
    expect(screen.queryByRole('button', { name: 'Copy invite code' })).not.toBeInTheDocument();
  });
});

describe('FamilySettings — section navigation', () => {
  it('14. Can navigate between sections', async () => {
    const user = userEvent.setup();
    renderFamilySettings('owner');
    expect(screen.getByText('The Family')).toBeInTheDocument(); // Family section
    await user.click(screen.getByRole('button', { name: 'Members' }));
    expect(screen.getByText(/Test User/)).toBeInTheDocument(); // Members section
    await user.click(screen.getByRole('button', { name: 'Regional' }));
    expect(screen.getByText('British Pound (£)')).toBeInTheDocument(); // Regional section
    await user.click(screen.getByRole('button', { name: 'Danger Zone' }));
    expect(screen.getByText('Coming soon')).toBeInTheDocument(); // Danger Zone section
  });
});

describe('FamilySettings — role-based visibility', () => {
  it('15. Owner sees the existing invite-code action and active add child control', async () => {
    const user = userEvent.setup();
    renderFamilySettings('owner');
    // Navigate to Members section to see the buttons
    await user.click(screen.getByRole('button', { name: 'Members' }));
    const inviteAction = screen.getByRole('button', { name: 'Add parent or adult' });
    expect(inviteAction).toBeEnabled();
    await user.click(inviteAction);
    expect(screen.getByText('ABC123')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(clipboardWriteText).toHaveBeenCalledWith('ABC123');
    expect(screen.getByRole('button', { name: '+ Add child' })).toBeInTheDocument();
  });

  it('16. Parent sees neither owner-only add control', async () => {
    const user = userEvent.setup();
    renderFamilySettings('parent');
    // Navigate to Members section to see the buttons
    await user.click(screen.getByRole('button', { name: 'Members' }));
    expect(screen.queryByRole('button', { name: '+ Add parent' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Add child' })).not.toBeInTheDocument();
  });

  it('17. Child sees no add buttons', async () => {
    const user = userEvent.setup();
    renderFamilySettings('child');
    // Navigate to Members section to see the buttons
    await user.click(screen.getByRole('button', { name: 'Members' }));
    expect(screen.queryByRole('button', { name: '+ Add parent' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Add child' })).not.toBeInTheDocument();
  });
});

describe('FamilySettings — loading state', () => {
  it('18. Shows loading spinner when familyLoading is true', () => {
    act(() => {
      useStore.setState({
        currentUser: {
          id: 'u1',
          displayName: 'Test User',
          email: 'test@example.com',
          avatarUrl: '',
          role: 'owner',
          familyId: 'fam1',
        },
        familyData: { id: 'fam1', name: 'The Family', inviteCode: 'ABC123' },
        familyMembers: [],
        joinRequests: [],
        familyLoading: true,
      });
    });
    render(
      <MemoryRouter>
        <FamilySettings />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
  });
});

describe('FamilySettings — regional settings editing', () => {
  it('19. Owner can edit the labelled currency control', async () => {
    const user = userEvent.setup();
    renderFamilySettings('owner');
    await user.click(screen.getByRole('button', { name: 'Regional' }));
    const currencySelect = screen.getByRole('combobox', { name: 'Currency' });
    await user.selectOptions(currencySelect, 'EUR');
    expect(currencySelect).toHaveValue('EUR');
  });

  it('20. Owner can edit the labelled timezone control', async () => {
    const user = userEvent.setup();
    renderFamilySettings('owner');
    await user.click(screen.getByRole('button', { name: 'Regional' }));
    const timezoneSelect = screen.getByRole('combobox', { name: 'Timezone' });
    await user.selectOptions(timezoneSelect, 'America/New_York');
    expect(timezoneSelect).toHaveValue('America/New_York');
  });

  it('21. Owner can edit week start with exposed selected state', async () => {
    const user = userEvent.setup();
    renderFamilySettings('owner');
    await user.click(screen.getByRole('button', { name: 'Regional' }));
    expect(screen.getByRole('radio', { name: 'Monday' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Sunday' })).toHaveAttribute('aria-checked', 'false');
    await user.click(screen.getByRole('radio', { name: 'Sunday' }));
    expect(screen.getByRole('radio', { name: 'Sunday' })).toHaveAttribute('aria-checked', 'true');
  });

  it('22. Child cannot edit regional settings', async () => {
    const user = userEvent.setup();
    renderFamilySettings('child');
    await user.click(screen.getByRole('button', { name: 'Regional' }));
    // Currency should be displayed but not editable
    expect(screen.getByText('British Pound (£)')).toBeInTheDocument();
    // Child sees the currency as text, not as a select
    expect(screen.queryByDisplayValue('British Pound (£)')).not.toBeInTheDocument();
  });

  it('23. Parent cannot edit regional settings', async () => {
    const user = userEvent.setup();
    renderFamilySettings('parent');
    await user.click(screen.getByRole('button', { name: 'Regional' }));
    // Currency should be displayed but not editable
    expect(screen.getByText('British Pound (£)')).toBeInTheDocument();
    // Parent sees the currency as text, not as a select
    expect(screen.queryByDisplayValue('British Pound (£)')).not.toBeInTheDocument();
  });

  it('normalizes a legacy family currency symbol on first render', async () => {
    const user = userEvent.setup();
    renderFamilySettings('owner', { familyData: { currencyCode: undefined, currency: '₺' } });

    await user.click(screen.getByRole('button', { name: 'Regional' }));

    expect(screen.getByDisplayValue('Turkish Lira (₺)')).toHaveValue('TRY');
  });

  it('persists TRY as currencyCode only', async () => {
    const user = userEvent.setup();
    renderFamilySettings('owner');
    await user.click(screen.getByRole('button', { name: 'Regional' }));
    await user.selectOptions(screen.getByDisplayValue('British Pound (£)'), 'TRY');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockUpdateFamilySettings).toHaveBeenCalledWith('fam1', {
      currencyCode: 'TRY',
      timezone: 'Europe/London',
      weekStartsOn: 1,
    }));
    expect(mockUpdateFamilySettings.mock.calls.at(-1)?.[1]).not.toHaveProperty('currency');
  });

  it('resets unsaved regional state from a new live family snapshot', async () => {
    const user = userEvent.setup();
    renderFamilySettings('owner');
    await user.click(screen.getByRole('button', { name: 'Regional' }));
    await user.selectOptions(screen.getByDisplayValue('British Pound (£)'), 'TRY');

    act(() => {
      useStore.setState(state => ({
        familyData: { ...state.familyData, currencyCode: 'USD' },
      }));
    });

    expect(await screen.findByDisplayValue('US Dollar ($)')).toHaveValue('USD');
  });
});

describe('FamilySettings — add parent flow', () => {
  it('accurately explains the limitation and reuses the existing invite-code copy path', async () => {
    const user = userEvent.setup();
    renderFamilySettings('owner');
    await user.click(screen.getByRole('button', { name: 'Members' }));

    expect(screen.getByText(/invite another adult with the existing family code/i)).toBeInTheDocument();
    const copyInvite = screen.getByRole('button', { name: 'Add parent or adult' });
    expect(copyInvite).toBeEnabled();
    await user.click(copyInvite);
    await user.click(screen.getByRole('button', { name: 'Copy' }));

    expect(clipboardWriteText).toHaveBeenCalledWith('ABC123');
    expect(await screen.findByText('Invite code copied to clipboard.')).toBeInTheDocument();
  });
});

describe('FamilySettings — localization and accessibility', () => {
  it('renders regional options and pending-request actions naturally in Turkish', async () => {
    await act(async () => {
      await i18n.changeLanguage('tr');
    });
    const user = userEvent.setup();
    renderFamilySettings('owner', {
      joinRequests: [
        { id: 'req1', displayName: 'Yeni Çocuk', status: 'pending', createdAt: { toDate: () => new Date(2026, 0, 2) } },
      ],
    });

    await user.click(screen.getByRole('button', { name: 'Üyeler' }));
    expect(screen.getByText(/Mevcut aile koduyla başka bir yetişkini davet edin/)).toBeInTheDocument();
    expect(screen.getByText('1 istek onay bekliyor')).toBeInTheDocument();
    expect(screen.getByText('Bu isteği çocuk veya ebeveyn/yetişkin olarak onaylamayı seçin.')).toBeInTheDocument();
    expect(screen.getByText(/İstek tarihi:/)).toHaveTextContent('02.01.2026');
    expect(screen.getByRole('button', { name: 'Çocuk rolünü onayla' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reddet' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Bölgesel' }));
    expect(screen.getByRole('combobox', { name: 'Para birimi' })).toHaveDisplayValue('İngiliz sterlini (£)');
    expect(screen.getByRole('radio', { name: 'Pazartesi' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Pazar' })).toHaveAttribute('aria-checked', 'false');
  });

  it('uses the localized regional fallback error', async () => {
    await act(async () => {
      await i18n.changeLanguage('tr');
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockUpdateFamilySettings.mockRejectedValueOnce({});
    const user = userEvent.setup();
    renderFamilySettings('owner');

    await user.click(screen.getByRole('button', { name: 'Bölgesel' }));
    await user.click(screen.getByRole('button', { name: 'Kaydet' }));

    expect(await screen.findByText('Bölgesel ayarlar güncellenemedi.')).toBeInTheDocument();
    consoleError.mockRestore();
  });
});

describe('FamilySettings — pending join requests', () => {
  it('24. Owner sees pending join requests', async () => {
    const user = userEvent.setup();
    renderFamilySettings('owner', {
      joinRequests: [
        { id: 'req1', displayName: 'Joining Child', status: 'pending', createdAt: { toDate: () => new Date() } },
      ],
    });
    await user.click(screen.getByRole('button', { name: 'Members' }));
    expect(screen.getByText('Pending Approvals')).toBeInTheDocument();
    const childrenSection = screen.getByRole('region', { name: 'Children' });
    expect(within(childrenSection).getByText('Joining Child')).toBeInTheDocument();
    expect(within(childrenSection).getByText('Choose whether to approve this request as a child or a parent/adult.')).toBeInTheDocument();
  });

  it('25. Owner can approve join request', async () => {
    const user = userEvent.setup();
    renderFamilySettings('owner', {
      joinRequests: [
        { id: 'req1', displayName: 'Joining Child', status: 'pending', createdAt: { toDate: () => new Date() } },
      ],
    });
    await user.click(screen.getByRole('button', { name: 'Members' }));
    await user.click(screen.getByRole('button', { name: 'Confirm child' }));
    expect(await screen.findByText('Join request approved')).toBeInTheDocument();
    expect(mockApproveJoinRequest).toHaveBeenCalledWith('fam1', 'req1', 'child');
  });

  it('26. Owner can reject join request', async () => {
    const user = userEvent.setup();
    renderFamilySettings('owner', {
      joinRequests: [
        { id: 'req1', displayName: 'Joining Child', status: 'pending', createdAt: { toDate: () => new Date() } },
      ],
    });
    await user.click(screen.getByRole('button', { name: 'Members' }));
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(await screen.findByText('Join request rejected')).toBeInTheDocument();
    expect(mockRejectJoinRequest).toHaveBeenCalledWith('fam1', 'req1', 'Not approved');
  });

  it('27. Child does not see pending join requests', () => {
    renderFamilySettings('child', {
      joinRequests: [
        { id: 'req1', displayName: 'Joining Child', status: 'pending', createdAt: { toDate: () => new Date() } },
      ],
    });
    expect(screen.queryByText('Pending Approvals')).not.toBeInTheDocument();
  });
});
