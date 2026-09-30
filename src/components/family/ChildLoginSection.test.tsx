import { beforeEach, describe, it, expect, vi } from 'vitest';
import { act, render as rtlRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChildLoginSection, type ChildLoginMember } from './ChildLoginSection';

const lifecycle = vi.hoisted(() => ({
  status: vi.fn(),
  reset: vi.fn(),
  disable: vi.fn(),
  enable: vi.fn(),
  deleteChild: vi.fn(),
}));

vi.mock('../../lib/childLoginApi', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/childLoginApi')>();
  return {
    ...actual,
    getChildCredentialStatus: lifecycle.status,
    resetChildPassword: lifecycle.reset,
    disableChildLogin: lifecycle.disable,
    enableChildLogin: lifecycle.enable,
    deleteChild: lifecycle.deleteChild,
  };
});

async function renderReady(element: Parameters<typeof rtlRender>[0]) {
  let result!: ReturnType<typeof rtlRender>;
  await act(async () => { result = rtlRender(element); });
  return result;
}

describe('ChildLoginSection', () => {
  it.each(['unavailable', 'network-error'])('never falls back to public credentials when authority is %s', async state => {
    if (state === 'network-error') lifecycle.status.mockRejectedValueOnce(new Error('offline'));
    else lifecycle.status.mockResolvedValueOnce({ state: 'unavailable', identityConnected: false, credentialsExist: false });
    await renderReady(<ChildLoginSection member={{ id: 'c1', displayName: 'Alex', hasLogin: true, username: 'Alex', loginEnabled: true }} onRequestCreate={vi.fn()} />);
    expect(screen.getByText(/Credential status unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset Password' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create Login' })).not.toBeInTheDocument();
  });
  it('does not expose credential actions for the legacy QR-only Alex profile (physical QA regression)', async () => {
    // Sanitized production structure: private linkage has no username/email,
    // username index is absent, and Auth has no password provider. Legacy QR
    // provisioning incorrectly advertised credentials on this public profile.
    await renderReady(<ChildLoginSection member={{
      id: 'qr-child-fixture', displayName: 'Alex', authUid: 'qr-child-fixture',
      isManaged: true, hasLogin: true, username: 'Alex', loginEnabled: true,
    }} onRequestCreate={vi.fn()} />);
    expect.soft(screen.queryByRole('button', { name: 'Reset Password' })).not.toBeInTheDocument();
    expect.soft(screen.queryByRole('button', { name: 'Disable Login' })).not.toBeInTheDocument();
    expect.soft(screen.queryByText('Username:')).not.toBeInTheDocument();
    expect.soft(screen.queryByText('Connected via personal device')).toBeInTheDocument();
    expect.soft(screen.queryByRole('button', { name: 'Create Login' })).toBeInTheDocument();
  });
  beforeEach(({ task }) => {
    vi.clearAllMocks();
    const name = task.name;
    const noCredentials = /legacy QR-only|without a login|requests creation|without username/.test(name);
    lifecycle.status.mockResolvedValue({ state: 'available', identityConnected: /QR|personal device/.test(name) || !noCredentials, credentialsExist: !noCredentials, username: 'milo', loginEnabled: !/disabled/.test(name), requiresPasswordChange: true });
  });
  it('renders a Create Login action for a managed child without a login', async () => {
    const member: ChildLoginMember = { id: 'c1', displayName: 'Milo', hasLogin: false };
    const onRequestCreate = vi.fn();
    await renderReady(<ChildLoginSection member={member} onRequestCreate={onRequestCreate} />);

    expect(screen.getByText('Login')).toBeInTheDocument();
    expect(screen.getByText('No login created')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Create Login' });
    expect(btn).toBeInTheDocument();
  });

  it('requests creation when the Create Login button is clicked', async () => {
    const user = userEvent.setup();
    const member: ChildLoginMember = { id: 'c1', displayName: 'Milo', hasLogin: false };
    const onRequestCreate = vi.fn();
    await renderReady(<ChildLoginSection member={member} onRequestCreate={onRequestCreate} />);

    await user.click(screen.getByRole('button', { name: 'Create Login' }));
    expect(onRequestCreate).toHaveBeenCalledWith(member);
  });

  it('renders Connected via personal device with guidance for QR child without username/password', async () => {
    const member: ChildLoginMember = {
      id: 'c1',
      displayName: 'Alex',
      hasLogin: false,
      authUid: 'child_qr_req1',
    };
    const onRequestCreate = vi.fn();
    await renderReady(<ChildLoginSection member={member} onRequestCreate={onRequestCreate} />);

    expect(screen.getByText('Login')).toBeInTheDocument();
    expect(screen.getByText('Connected via personal device')).toBeInTheDocument();
    expect(
      screen.getByText('Create a username and password so they can sign in again after signing out.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Login' })).toBeInTheDocument();
  });

  it('renders login details for a managed child with a login', async () => {
    const member: ChildLoginMember = {
      id: 'c1',
      displayName: 'Milo',
      hasLogin: true,
      username: 'milo',
      loginEnabled: true,
      requiresPasswordChange: true,
    };
    await renderReady(<ChildLoginSection member={member} onRequestCreate={() => {}} />);

    expect(screen.getByText('Username:')).toBeInTheDocument();
    expect(screen.getByText('milo')).toBeInTheDocument();
    expect(screen.getByText('Status:')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText('Requires password change:')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('Last login:')).toBeInTheDocument();
    // No last-login timestamp => "Never"
    expect(screen.getByText('Never')).toBeInTheDocument();
  });

  it('exposes working Reset/Disable actions without a Coming soon placeholder', async () => {
    const member: ChildLoginMember = {
      id: 'c1',
      displayName: 'Milo',
      hasLogin: true,
      username: 'milo',
      loginEnabled: true,
    };
    await renderReady(<ChildLoginSection member={member} onRequestCreate={() => {}} />);

    const reset = screen.getByRole('button', { name: 'Reset Password' }) as HTMLButtonElement;
    const disable = screen.getByRole('button', { name: 'Disable Login' }) as HTMLButtonElement;
    expect(reset).toBeEnabled();
    expect(disable).toBeEnabled();
    expect(screen.queryByText('Coming soon')).not.toBeInTheDocument();
  });

  it('shows the Enable Login action when the login is disabled', async () => {
    const member: ChildLoginMember = {
      id: 'c1',
      displayName: 'Milo',
      hasLogin: true,
      username: 'milo',
      loginEnabled: false,
      requiresPasswordChange: false,
    };
    await renderReady(<ChildLoginSection member={member} onRequestCreate={() => {}} />);

    expect(screen.getByText('Disabled')).toBeInTheDocument();
    const enable = screen.getByRole('button', { name: 'Enable Login' }) as HTMLButtonElement;
    expect(enable).toBeEnabled();
    // Disable button must not be present in the disabled state.
    expect(screen.queryByRole('button', { name: 'Disable Login' })).toBeNull();
  });

  it('resets with the parent-entered temporary password and explains the forced change', async () => {
    lifecycle.reset.mockResolvedValue({ childId: 'c1', loginEnabled: true, requiresPasswordChange: true });
    const user = userEvent.setup();
    await renderReady(<ChildLoginSection
      member={{ id: 'c1', displayName: 'Milo', hasLogin: true, username: 'milo', loginEnabled: true }}
      onRequestCreate={() => {}}
    />);
    await user.click(screen.getByRole('button', { name: 'Reset Password' }));
    expect(screen.getByText(/signed out on all devices/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Temporary password'), 'T3mpPass!');
    await user.click(screen.getByRole('button', { name: 'Set temporary password' }));
    expect(lifecycle.reset).toHaveBeenCalledWith('c1', 'T3mpPass!');
    expect(await screen.findByText(/must create a new private password/i)).toBeInTheDocument();
  });

  it('calls the secure enable and disable lifecycle actions', async () => {
    lifecycle.disable.mockResolvedValue({});
    lifecycle.enable.mockResolvedValue({});
    const user = userEvent.setup();
    const { rerender } = await renderReady(<ChildLoginSection
      member={{ id: 'c1', displayName: 'Milo', hasLogin: true, username: 'milo', loginEnabled: true }}
      onRequestCreate={() => {}}
    />);
    await user.click(screen.getByRole('button', { name: 'Disable Login' }));
    expect(lifecycle.disable).toHaveBeenCalledWith('c1');
    lifecycle.status.mockResolvedValue({ state: 'available', identityConnected: true, credentialsExist: true, username: 'milo', loginEnabled: false });
    rerender(<ChildLoginSection
      refreshKey={1}
      member={{ id: 'c1', displayName: 'Milo', hasLogin: true, username: 'milo', loginEnabled: false }}
      onRequestCreate={() => {}}
    />);
    await user.click(await screen.findByRole('button', { name: 'Enable Login' }));
    expect(lifecycle.enable).toHaveBeenCalledWith('c1');
  });

  it('never renders authUid, synthetic email, or internal ids', async () => {
    const member: ChildLoginMember = {
      id: 'c1',
      displayName: 'Milo',
      hasLogin: true,
      username: 'milo',
      loginEnabled: true,
    };
    const { container } = await renderReady(<ChildLoginSection member={member} onRequestCreate={() => {}} />);
    expect(container.textContent).not.toMatch(/authUid|@managed\.familyquest\.app|synthetic/i);
  });

  describe('Delete Child dialog', async () => {
    const member: ChildLoginMember = {
      id: 'c1',
      displayName: 'Alisya',
      hasLogin: true,
      username: 'alisya',
      loginEnabled: true,
      isManaged: true,
    };

    const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole('button', { name: 'Delete child' }));
      return screen.getByRole('dialog');
    };

    it('shows visible Cancel and Delete labels with a validation hint, delete disabled initially', async () => {
      const user = userEvent.setup();
      await renderReady(<ChildLoginSection member={member} onRequestCreate={() => {}} />);
      const dialog = await openDialog(user);

      const cancel = screen.getByRole('button', { name: 'Cancel' });
      expect(cancel).toBeEnabled();
      expect(cancel.textContent).toContain('Cancel');

      // Confirm button lives inside the dialog and carries the destructive label.
      const buttons = screen.getAllByRole('button', { name: 'Delete child' });
      const confirm = buttons.find(b => dialog.contains(b) && b !== cancel) as HTMLButtonElement;
      expect(confirm).toBeDefined();
      expect(confirm.textContent).toContain('Delete child');
      expect(confirm).toBeDisabled();

      // Validation hint shown before the name matches.
      expect(screen.getByText("Type 'Alisya' to continue.")).toBeInTheDocument();
    });

    it('trims whitespace, enables delete on exact name, and calls deleteChild', async () => {
      lifecycle.deleteChild.mockResolvedValue({});
      const user = userEvent.setup();
      await renderReady(<ChildLoginSection member={member} onRequestCreate={() => {}} />);
      const dialog = await openDialog(user);

      const input = screen.getByLabelText(/full name to confirm/i);
      await user.type(input, '  Alisya  ');

      // Hint disappears once the trimmed name matches.
      expect(screen.queryByText("Type 'Alisya' to continue.")).not.toBeInTheDocument();

      const confirm = screen
        .getAllByRole('button', { name: 'Delete child' })
        .find(b => dialog.contains(b)) as HTMLButtonElement;
      expect(confirm).toBeEnabled();

      await user.click(confirm);
      expect(lifecycle.deleteChild).toHaveBeenCalledWith('c1', 'Alisya');
    });

    it('collapses a synchronous double tap into a single deleteChild call', async () => {
      let resolveDelete: (value: unknown) => void = () => {};
      lifecycle.deleteChild.mockImplementation(
        () => new Promise(resolve => { resolveDelete = resolve; }),
      );
      const user = userEvent.setup();
      await renderReady(<ChildLoginSection member={member} onRequestCreate={() => {}} />);
      const dialog = await openDialog(user);

      await user.type(screen.getByLabelText(/full name to confirm/i), 'Alisya');
      const confirm = screen
        .getAllByRole('button', { name: 'Delete child' })
        .find(b => dialog.contains(b)) as HTMLButtonElement;

      // Two activations dispatched in the same task, as a real double tap does.
      await act(async () => {
        confirm.click();
        confirm.click();
      });

      expect(lifecycle.deleteChild).toHaveBeenCalledTimes(1);
      await act(async () => { resolveDelete({}); });
    });

    it('closes the dialog via Cancel without deleting', async () => {
      const user = userEvent.setup();
      await renderReady(<ChildLoginSection member={member} onRequestCreate={() => {}} />);
      await openDialog(user);

      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(lifecycle.deleteChild).not.toHaveBeenCalled();
    });
  });
});
