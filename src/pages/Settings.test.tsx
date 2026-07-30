import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Settings } from './Settings';
import { useStore } from '../store/useStore';
import { FAMILYQUEST_BUILD } from '../buildInfo';
import type { PushState } from '../lib/pushNotifications';
import i18n from '../i18n';

const clipboardWriteText = vi.fn(async () => {});

// --- Mock firebase/firestore updateDoc so profile saves don't hit the network ---
const { updateDocMock } = vi.hoisted(() => ({
  updateDocMock: vi.fn(async (_ref: unknown, _data: unknown) => {}),
}));
vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return { ...actual, updateDoc: updateDocMock };
});

// --- Mock the auth-related API surface used by Settings ---
const apiMocks = vi.hoisted(() => ({
  getAuthProviderInfo: vi.fn(() => ({
    isEmailPassword: true,
    isOAuth: false,
    providers: ['password'],
    primaryProviderLabel: 'Email & Password',
  })),
  sendPasswordReset: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
  updateLanguagePreference: vi.fn(async () => {}),
}));
vi.mock('../lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    getAuthProviderInfo: apiMocks.getAuthProviderInfo,
    sendPasswordReset: apiMocks.sendPasswordReset,
    signOut: apiMocks.signOut,
    updateLanguagePreference: apiMocks.updateLanguagePreference,
  };
});

// --- Mock the account/family deletion client APIs ---
const deletionMocks = vi.hoisted(() => ({
  requestAccountDeletion: vi.fn(async (_input: unknown) => ({ status: 'completed' as const })),
  getReauthMethod: vi.fn(() => 'password' as 'password' | 'google' | null),
  reauthenticateWithPassword: vi.fn(async (_password: string) => {}),
  reauthenticateWithGoogle: vi.fn(async () => {}),
  fetchFamilyDeletionStatus: vi.fn(async (_familyId: string) => ({ state: 'none' as const })),
}));
vi.mock('../lib/accountDeletionApi', () => ({
  requestAccountDeletion: deletionMocks.requestAccountDeletion,
  getReauthMethod: deletionMocks.getReauthMethod,
  reauthenticateWithPassword: deletionMocks.reauthenticateWithPassword,
  reauthenticateWithGoogle: deletionMocks.reauthenticateWithGoogle,
}));
vi.mock('../lib/familyDeletionApi', () => ({
  fetchFamilyDeletionStatus: deletionMocks.fetchFamilyDeletionStatus,
  requestFamilyDeletion: vi.fn(),
  leaveFamily: vi.fn(),
  generateClientReqId: () => 'test-client-req-00000001',
}));

// Mock the notification connection hook so the Settings UI can be exercised
// without opening real Firestore listeners. The connection state is driven by
// `notifState` so individual tests can assert each status label.
const notifState = vi.hoisted(() => ({
  connectionState: 'connected' as string,
  retry: vi.fn(),
}));
vi.mock('../lib/useNotifications', () => ({
  useNotifications: () => ({ connectionState: notifState.connectionState, retry: notifState.retry }),
}));

// Mock the push-notifications client module so the dynamic Settings section can
// be exercised without real FCM / service-worker / Firestore access. The state
// is driven by `pushState` so individual tests can assert each UI branch.
const pushMocks = vi.hoisted(() => ({
  loadPushState: vi.fn(async (): Promise<PushState> => ({
    support: 'supported',
    permission: 'default',
    status: 'not_enabled',
    lastRegisteredAt: null,
    error: null,
  })),
  registerCurrentDevice: vi.fn(async (): Promise<PushState> => ({
    support: 'supported',
    permission: 'granted',
    status: 'enabled',
    lastRegisteredAt: Date.now(),
    error: null,
  })),
  unregisterCurrentDevice: vi.fn(async () => {}),
}));
vi.mock('../lib/pushNotifications', () => ({
  loadPushState: pushMocks.loadPushState,
  registerCurrentDevice: pushMocks.registerCurrentDevice,
  unregisterCurrentDevice: pushMocks.unregisterCurrentDevice,
}));

const EMAIL = 'test@example.com';

function seedStore(role: string) {
  act(() => {
    useStore.setState({
      currentUser: {
        id: 'u1',
        displayName: 'Test User',
        email: EMAIL,
        avatarUrl: '',
        role,
        familyId: 'fam1',
        language: 'en',
      },
      authUser: { email: EMAIL, uid: 'u1' },
      familyData: { id: 'fam1', name: 'The Family', inviteCode: 'ABC123' },
      familyMembers: [
        { id: 'u1', displayName: 'Test User', role },
        { id: 'u2', displayName: 'Kid One', role: 'child' },
        { id: 'u3', displayName: 'Parent Two', role: 'parent' },
      ],
      joinRequests: [],
      familyLoading: false,
    });
  });
}

function renderSettings(role: string) {
  seedStore(role);
  return render(
    <MemoryRouter>
      <Settings />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  clipboardWriteText.mockClear();
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(clipboardWriteText);
  }
  apiMocks.getAuthProviderInfo.mockReturnValue({
    isEmailPassword: true,
    isOAuth: false,
    providers: ['password'],
    primaryProviderLabel: 'Email & Password',
  });
  apiMocks.sendPasswordReset.mockResolvedValue(undefined);
  apiMocks.signOut.mockResolvedValue(undefined);
  apiMocks.updateLanguagePreference.mockResolvedValue(undefined);
  updateDocMock.mockResolvedValue(undefined);
  pushMocks.loadPushState.mockImplementation(() => new Promise<PushState>(() => {}));
  notifState.connectionState = 'connected';
  deletionMocks.requestAccountDeletion.mockResolvedValue({ status: 'completed' });
  deletionMocks.getReauthMethod.mockReturnValue('password');
  deletionMocks.reauthenticateWithPassword.mockResolvedValue(undefined);
  deletionMocks.reauthenticateWithGoogle.mockResolvedValue(undefined);
  deletionMocks.fetchFamilyDeletionStatus.mockResolvedValue({ state: 'none' });
});

describe('Settings — permanent account deletion', () => {
  async function openDialog() {
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-delete-account'));
    return user;
  }

  it('offers an in-app permanent deletion entry point that is distinct from Sign Out', () => {
    renderSettings('parent');
    const button = screen.getByTestId('open-delete-account');
    expect(button).toHaveAccessibleName('Delete my account permanently');
    expect(screen.getByLabelText('Sign out')).not.toBe(button);
  });

  it('hides the action from managed child accounts', () => {
    seedStore('child');
    act(() => {
      useStore.setState({
        currentUser: { ...useStore.getState().currentUser, isManaged: true },
      });
    });
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('open-delete-account')).not.toBeInTheDocument();
  });

  it('requires two explicit confirmations before calling the server, then signs out', async () => {
    renderSettings('parent');
    const user = await openDialog();

    // Stage 1: full scope explanation, nothing called yet.
    expect(screen.getByTestId('delete-account-dialog')).toBeInTheDocument();
    expect(screen.getByText('This action is irreversible and cannot be undone.')).toBeInTheDocument();
    expect(screen.getByText('This is not the same as signing out.')).toBeInTheDocument();
    expect(deletionMocks.requestAccountDeletion).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete my account' }));

    await waitFor(() => expect(deletionMocks.requestAccountDeletion).toHaveBeenCalledTimes(1));
    expect(deletionMocks.requestAccountDeletion).toHaveBeenCalledWith({});
    await waitFor(() => expect(apiMocks.signOut).toHaveBeenCalledTimes(1));
  });

  it('asks an owner to nominate a successor and resubmits with the chosen uid', async () => {
    deletionMocks.requestAccountDeletion
      .mockRejectedValueOnce(new Error('SUCCESSOR_REQUIRED'))
      .mockResolvedValueOnce({ status: 'completed' });
    renderSettings('owner');
    const user = await openDialog();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete my account' }));

    const select = await screen.findByLabelText('New family owner');
    // Only non-managed parents are offered.
    expect(within(select).queryByText('Kid One')).not.toBeInTheDocument();
    await user.selectOptions(select, 'u3');
    await user.click(screen.getByRole('button', { name: 'Transfer ownership and delete my account' }));

    await waitFor(() => expect(deletionMocks.requestAccountDeletion).toHaveBeenLastCalledWith({ successorUid: 'u3' }));
    await waitFor(() => expect(apiMocks.signOut).toHaveBeenCalled());
  });

  it('reauthenticates when the login is not recent and resumes the same request', async () => {
    deletionMocks.requestAccountDeletion
      .mockRejectedValueOnce(new Error('RECENT_LOGIN_REQUIRED'))
      .mockResolvedValueOnce({ status: 'completed' });
    renderSettings('parent');
    const user = await openDialog();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete my account' }));

    const password = await screen.findByLabelText('Password');
    await user.type(password, 'hunter2hunter2');
    await user.click(screen.getByRole('button', { name: 'Confirm identity' }));

    await waitFor(() => expect(deletionMocks.reauthenticateWithPassword).toHaveBeenCalledWith('hunter2hunter2'));
    await waitFor(() => expect(deletionMocks.requestAccountDeletion).toHaveBeenCalledTimes(2));
    expect(deletionMocks.requestAccountDeletion).toHaveBeenLastCalledWith({});
    await waitFor(() => expect(apiMocks.signOut).toHaveBeenCalled());
  });

  it('requires the exact family name when a sole owner triggers the family cascade', async () => {
    deletionMocks.requestAccountDeletion
      .mockRejectedValueOnce(new Error('FAMILY_DELETION_CONFIRMATION_REQUIRED'))
      .mockResolvedValueOnce({ status: 'pending_family_deletion' });
    renderSettings('owner');
    const user = await openDialog();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete my account' }));

    const input = await screen.findByLabelText('Family name');
    expect(screen.getByText(/also permanently delete this family/i)).toBeInTheDocument();
    await user.type(input, 'The Family');
    await user.click(screen.getByRole('button', { name: 'Delete family and my account permanently' }));

    await waitFor(() => expect(deletionMocks.requestAccountDeletion)
      .toHaveBeenLastCalledWith({ familyNameConfirmation: 'The Family' }));
    expect(await screen.findByTestId('delete-account-progress')).toBeInTheDocument();
    expect(apiMocks.signOut).not.toHaveBeenCalled();
  });

  it('surfaces a friendly error when the server refuses without deleting anything', async () => {
    deletionMocks.requestAccountDeletion.mockRejectedValueOnce(new Error('INTERNAL'));
    renderSettings('parent');
    const user = await openDialog();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete my account' }));

    expect(await screen.findByRole('alert'))
      .toHaveTextContent('We could not delete your account. Please try again.');
    expect(apiMocks.signOut).not.toHaveBeenCalled();
  });
});

describe('Settings — authoritative language preference', () => {
  it('updates the store and mounted i18n immediately, then persists users/{uid}.language', async () => {
    let resolveWrite!: () => void;
    apiMocks.updateLanguagePreference.mockImplementation(() => new Promise<void>(resolve => {
      resolveWrite = resolve;
    }));
    const user = userEvent.setup();
    renderSettings('owner');

    await user.click(screen.getByDisplayValue('tr'));

    expect(useStore.getState().currentUser.language).toBe('tr');
    await waitFor(() => expect(i18n.language).toBe('tr'));
    expect(await screen.findByRole('heading', { name: 'Ayarlar' })).toBeInTheDocument();
    expect(apiMocks.updateLanguagePreference).toHaveBeenCalledWith('tr');

    resolveWrite();
    expect(await screen.findByText('Dil güncellendi.')).toBeInTheDocument();
  });

  it('rolls back store and i18n when persistence fails and shows friendly feedback', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    apiMocks.updateLanguagePreference.mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    renderSettings('owner');

    await user.click(screen.getByDisplayValue('tr'));

    await waitFor(() => {
      expect(useStore.getState().currentUser.language).toBe('en');
      expect(i18n.language).toBe('en');
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save your language. Please try again.');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

afterEach(async () => {
  vi.clearAllMocks();
  act(() => {
    useStore.setState({ currentUser: null, authUser: undefined, familyData: null, familyMembers: [] });
  });
  await i18n.changeLanguage('en');
});

describe('Settings — role visibility', () => {
  it('does not render duplicate family section IDs when FamilySettings is embedded', () => {
    renderSettings('owner');

    expect(document.querySelectorAll('#family-section')).toHaveLength(1);
  });

  it('1. Owner sees all permitted Settings sections', () => {
    renderSettings('owner');
    for (const heading of ['Profile', 'Family', 'Notifications', 'Security', 'About']) {
      expect(screen.getAllByRole('heading', { name: heading }).length).toBeGreaterThan(0);
    }
    expect(screen.getByLabelText('Copy invite code')).toBeInTheDocument();
    expect(screen.getByLabelText('Regenerate invite code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send password reset email/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign out/i })).toBeInTheDocument();
  });

  it('2. Parent does not see owner-only controls', () => {
    renderSettings('parent');
    // Owner-only regenerate must be absent for parent.
    expect(screen.queryByLabelText('Regenerate invite code')).not.toBeInTheDocument();
    // Parent still sees family management it is allowed.
    expect(screen.getByLabelText('Copy invite code')).toBeInTheDocument();
    expect(screen.getByText('Member count')).toBeInTheDocument();
  });

  it('3. Child does not see management controls', () => {
    renderSettings('child');
    expect(screen.queryByLabelText('Copy invite code')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Regenerate invite code')).not.toBeInTheDocument();
    // Child can open the read-only family members list.
    fireEvent.click(screen.getByRole('button', { name: 'Members' }));
    expect(screen.getByText('Kid One')).toBeInTheDocument();
    expect(screen.getByText('Parent Two')).toBeInTheDocument();
    // Child can still open the (read-only) profile editor.
    expect(screen.getByRole('button', { name: 'Edit Profile' })).toBeInTheDocument();
  });
});

describe('Settings — profile editor entry point', () => {
  it('4. Edit Profile uses the shared editor entry point', async () => {
    const user = userEvent.setup();
    renderSettings('owner');
    await user.click(screen.getByRole('button', { name: 'Edit Profile' }));
    // The shared ProfileEditorModal opens (dialog with the same title).
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Edit Profile' })).toBeInTheDocument();
    // It exposes the shared display-name field.
    expect(within(dialog).getByLabelText('Display Name')).toHaveValue('Test User');
  });

  it('5. Owner/parent profile update applies immediately', async () => {
    const user = userEvent.setup();
    renderSettings('owner');
    await user.click(screen.getByRole('button', { name: 'Edit Profile' }));
    const nameInput = screen.getByLabelText('Display Name');
    await user.clear(nameInput);
    await user.type(nameInput, 'New Name');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateDocMock).toHaveBeenCalled());
    const call = updateDocMock.mock.calls[0];
    expect((call[1] as Record<string, unknown>)).toMatchObject({ displayName: 'New Name' });
  });

  it('5b. Child profile editor submits changes for parent approval', async () => {
    const user = userEvent.setup();
    renderSettings('child');
    await user.click(screen.getByRole('button', { name: 'Edit Profile' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/parent for approval/i)).toBeInTheDocument();
    // Children have no immediate "Save" button; they submit for approval instead.
    expect(within(dialog).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Submit for approval' })).toBeInTheDocument();
    // The child can edit the fields before submitting for approval.
    expect(within(dialog).getByLabelText('Display Name')).not.toBeDisabled();
  });
});

describe('Settings — dead controls', () => {
  it('6. Dead controls are removed or disabled', () => {
    renderSettings('owner');
    // Old placeholder controls from the previous Settings page are gone.
    for (const dead of ['Manage Members', 'Permissions', 'Theme', 'Sound Effects']) {
      expect(screen.queryByText(dead)).not.toBeInTheDocument();
    }
    // Invite regeneration is a real owner-only action, not a dead placeholder.
    const regenerate = screen.getByLabelText('Regenerate invite code') as HTMLButtonElement;
    expect(regenerate).toBeEnabled();
  });
});

describe('Settings — family invite code', () => {
  it('7. Invite code copy works', async () => {
    const user = userEvent.setup();
    renderSettings('owner');
    await user.click(screen.getByRole('button', { name: 'Copy invite code' }));
    expect(clipboardWriteText).toHaveBeenCalledWith('ABC123');
    expect(await screen.findByText(/copied to clipboard/i)).toBeInTheDocument();
  });

  it('8. Regenerate invite code respects role and is active for owners', () => {
    // Owner sees the active action.
    const { unmount } = renderSettings('owner');
    const ownerRegenerate = screen.getByLabelText('Regenerate invite code') as HTMLButtonElement;
    expect(ownerRegenerate).toBeEnabled();
    expect(screen.queryByText(/Regenerating the invite code is not available yet/i)).not.toBeInTheDocument();
    unmount();

    // Parent must not see the owner-only control at all.
    renderSettings('parent');
    expect(screen.queryByLabelText('Regenerate invite code')).not.toBeInTheDocument();
  });
});

describe('Settings — notifications', () => {
  it('shows In-app notifications as Active with no fake toggles', () => {
    notifState.connectionState = 'connected';
    renderSettings('owner');
    const section = screen.getByRole('region', { name: /Notifications/i });
    expect(within(section).getByText('Active')).toBeInTheDocument();
    // No interactive switches/toggles should exist.
    expect(within(section).queryByRole('switch')).not.toBeInTheDocument();
    expect(within(section).queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('shows Push notifications as Not enabled with an Enable action when no device is registered', async () => {
    pushMocks.loadPushState.mockResolvedValue({
      support: 'supported',
      permission: 'default',
      status: 'not_enabled',
      lastRegisteredAt: null,
      error: null,
    });
    renderSettings('owner');
    const section = screen.getByRole('region', { name: /Notifications/i });
    expect(await within(section).findByText('Not enabled')).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: /Enable push notifications/i })).toBeInTheDocument();
  });

  it('shows Push notifications as Enabled on this device with a Disable action', async () => {
    pushMocks.loadPushState.mockResolvedValue({
      support: 'supported',
      permission: 'granted',
      status: 'enabled',
      lastRegisteredAt: Date.now(),
      error: null,
    });
    renderSettings('owner');
    const section = screen.getByRole('region', { name: /Notifications/i });
    expect(await within(section).findByText('Enabled on this device')).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: /Disable on this device/i })).toBeInTheDocument();
  });

  it('shows Push notifications as Not supported when the browser lacks push support', async () => {
    pushMocks.loadPushState.mockResolvedValue({
      support: 'unsupported',
      permission: 'unsupported',
      status: 'unsupported',
      lastRegisteredAt: null,
      error: null,
    });
    renderSettings('owner');
    const section = screen.getByRole('region', { name: /Notifications/i });
    expect(await within(section).findByText('Not supported on this browser')).toBeInTheDocument();
  });

  it('lists the supported notification categories', () => {
    renderSettings('owner');
    const section = screen.getByRole('region', { name: /Notifications/i });
    for (const c of [
      'Task updates', 'Reward requests', 'Wallet updates', 'Transfer updates', 'Behaviour updates', 'Pet Box updates',
    ]) {
      expect(within(section).getByText(c)).toBeInTheDocument();
    }
  });

  it('owner/parent see approval-request copy', () => {
    renderSettings('owner');
    expect(screen.getByText(/Approval requests — tasks, reward requests, and transfers/i)).toBeInTheDocument();
  });

  it('child sees task/wallet/transfer/behaviour copy and not approval copy', () => {
    renderSettings('child');
    expect(screen.getByText(/Task results, wallet changes, transfers, and behaviour updates/i)).toBeInTheDocument();
    expect(screen.queryByText(/Approval requests — tasks/i)).not.toBeInTheDocument();
  });

  it('shows Connecting, Connected, and Temporarily unavailable correctly', () => {
    notifState.connectionState = 'connecting';
    const view = renderSettings('owner');
    expect(screen.getAllByText('Connecting…').length).toBeGreaterThan(0);

    notifState.connectionState = 'connected';
    view.rerender(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );
    expect(screen.getAllByText('Connected').length).toBeGreaterThan(0);

    notifState.connectionState = 'unavailable';
    view.rerender(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );
    expect(screen.getAllByText('Temporarily unavailable').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Retry connection/i })).toBeInTheDocument();
  });

  it('does not expose a Retry button when connected', () => {
    notifState.connectionState = 'connected';
    renderSettings('owner');
    expect(screen.queryByRole('button', { name: /Retry connection/i })).not.toBeInTheDocument();
  });
});

describe('Settings — security', () => {
  it('10. Password reset flow works for supported (email/password) accounts', async () => {
    const user = userEvent.setup();
    renderSettings('owner');
    await user.click(screen.getByRole('button', { name: /Send password reset email/i }));
    expect(apiMocks.sendPasswordReset).toHaveBeenCalledWith(EMAIL);
    expect(await screen.findByText(/password reset link/i)).toBeInTheDocument();
  });

  it('10b. OAuth users see a provider message instead of a reset button', () => {
    apiMocks.getAuthProviderInfo.mockReturnValue({
      isEmailPassword: false,
      isOAuth: true,
      providers: ['google.com'],
      primaryProviderLabel: 'Google',
    });
    renderSettings('owner');
    expect(screen.queryByRole('button', { name: /Send password reset email/i })).not.toBeInTheDocument();
    expect(screen.getByText(/sign in with Google/i)).toBeInTheDocument();
  });

  it('12. Raw Firebase errors are mapped to friendly messages', async () => {
    const user = userEvent.setup();
    apiMocks.sendPasswordReset.mockRejectedValueOnce({ code: 'auth/user-not-found' });
    renderSettings('owner');
    await user.click(screen.getByRole('button', { name: /Send password reset email/i }));
    const msg = await screen.findByText(/could not find an account/i);
    expect(msg).toBeInTheDocument();
    expect(msg.textContent).not.toContain('auth/user-not-found');
  });
});

describe('Settings — about / build info', () => {
  it('11. About section uses real build info', () => {
    renderSettings('owner');
    const section = screen.getByRole('region', { name: /About/i });
    expect(within(section).getByText(FAMILYQUEST_BUILD.version)).toBeInTheDocument();
    expect(within(section).getByText(FAMILYQUEST_BUILD.sha.slice(0, 7))).toBeInTheDocument();
    expect(within(section).getByText('familyquest-beta-402cb')).toBeInTheDocument();
  });
});

describe('Settings — layout & role helpers', () => {
  it('13. Mobile layout remains usable (centred, single-column cards)', () => {
    const { container } = renderSettings('owner');
    const root = container.querySelector('.max-w-2xl');
    expect(root).not.toBeNull();
    expect(root?.className).toContain('mx-auto');
    // All five sections render as stacked cards.
    for (const heading of ['Profile', 'Family', 'Notifications', 'Security', 'About']) {
      expect(screen.getAllByRole('heading', { name: heading }).length).toBeGreaterThan(0);
    }
  });

  it('14. No strict role === "parent" regression (legacy "admin" sees parent controls)', () => {
    // 'admin' normalises to parent via isParentRole; a strict `=== 'parent'` check
    // would hide these controls. They must be visible.
    renderSettings('admin');
    expect(screen.getByLabelText('Copy invite code')).toBeInTheDocument();
    expect(screen.getByText('Member count')).toBeInTheDocument();
    // Owner-only regenerate must still be hidden for the admin/parent role.
    expect(screen.queryByLabelText('Regenerate invite code')).not.toBeInTheDocument();
  });
});
