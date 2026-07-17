import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Settings } from './Settings';
import { useStore } from '../store/useStore';
import { FAMILYQUEST_BUILD } from '../buildInfo';
import type { PushState } from '../lib/pushNotifications';

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
}));
vi.mock('../lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    getAuthProviderInfo: apiMocks.getAuthProviderInfo,
    sendPasswordReset: apiMocks.sendPasswordReset,
    signOut: apiMocks.signOut,
  };
});

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
      },
      authUser: { email: EMAIL, uid: 'u1' },
      familyData: { id: 'fam1', name: 'The Family', inviteCode: 'ABC123' },
      familyMembers: [
        { id: 'u1', displayName: 'Test User', role },
        { id: 'u2', displayName: 'Kid One', role: 'child' },
        { id: 'u3', displayName: 'Parent Two', role: 'parent' },
      ],
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
  updateDocMock.mockResolvedValue(undefined);
  notifState.connectionState = 'connected';
});

afterEach(() => {
  vi.clearAllMocks();
  useStore.setState({ currentUser: null, authUser: undefined, familyData: null, familyMembers: [] });
});

describe('Settings — role visibility', () => {
  it('1. Owner sees all permitted Settings sections', () => {
    renderSettings('owner');
    for (const heading of ['Profile', 'Family', 'Notifications', 'Security', 'About']) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    }
    expect(screen.getByLabelText('Copy invite code')).toBeInTheDocument();
    expect(screen.getByLabelText('Regenerate invite code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send password reset email/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign Out' })).toBeInTheDocument();
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
    // Child sees the family members list instead of management actions.
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
    // The deferred regenerate control is present but disabled.
    const regenerate = screen.getByLabelText('Regenerate invite code') as HTMLButtonElement;
    expect(regenerate).toBeDisabled();
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

  it('8. Regenerate invite code respects role and is deferred', () => {
    // Owner sees a disabled, explained regenerate control.
    const { unmount } = renderSettings('owner');
    const ownerRegenerate = screen.getByLabelText('Regenerate invite code') as HTMLButtonElement;
    expect(ownerRegenerate).toBeDisabled();
    expect(screen.getByText(/Regenerating the invite code is not available yet/i)).toBeInTheDocument();
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
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
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
