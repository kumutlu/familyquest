import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChildLoginSection, type ChildLoginMember } from './ChildLoginSection';

const lifecycle = vi.hoisted(() => ({
  reset: vi.fn(),
  disable: vi.fn(),
  enable: vi.fn(),
}));

vi.mock('../../lib/childLoginApi', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/childLoginApi')>();
  return {
    ...actual,
    resetChildPassword: lifecycle.reset,
    disableChildLogin: lifecycle.disable,
    enableChildLogin: lifecycle.enable,
  };
});

describe('ChildLoginSection', () => {
  beforeEach(() => vi.clearAllMocks());
  it('renders a Create Login action for a managed child without a login', () => {
    const member: ChildLoginMember = { id: 'c1', displayName: 'Milo', hasLogin: false };
    const onRequestCreate = vi.fn();
    render(<ChildLoginSection member={member} onRequestCreate={onRequestCreate} />);

    expect(screen.getByText('Login')).toBeInTheDocument();
    expect(screen.getByText('No login created')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Create Login' });
    expect(btn).toBeInTheDocument();
  });

  it('requests creation when the Create Login button is clicked', async () => {
    const user = userEvent.setup();
    const member: ChildLoginMember = { id: 'c1', displayName: 'Milo', hasLogin: false };
    const onRequestCreate = vi.fn();
    render(<ChildLoginSection member={member} onRequestCreate={onRequestCreate} />);

    await user.click(screen.getByRole('button', { name: 'Create Login' }));
    expect(onRequestCreate).toHaveBeenCalledWith(member);
  });

  it('renders login details for a managed child with a login', () => {
    const member: ChildLoginMember = {
      id: 'c1',
      displayName: 'Milo',
      hasLogin: true,
      username: 'milo',
      loginEnabled: true,
      requiresPasswordChange: true,
    };
    render(<ChildLoginSection member={member} onRequestCreate={() => {}} />);

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

  it('exposes working Reset/Disable actions without a Coming soon placeholder', () => {
    const member: ChildLoginMember = {
      id: 'c1',
      displayName: 'Milo',
      hasLogin: true,
      username: 'milo',
      loginEnabled: true,
    };
    render(<ChildLoginSection member={member} onRequestCreate={() => {}} />);

    const reset = screen.getByRole('button', { name: 'Reset Password' }) as HTMLButtonElement;
    const disable = screen.getByRole('button', { name: 'Disable Login' }) as HTMLButtonElement;
    expect(reset).toBeEnabled();
    expect(disable).toBeEnabled();
    expect(screen.queryByText('Coming soon')).not.toBeInTheDocument();
  });

  it('shows the Enable Login action when the login is disabled', () => {
    const member: ChildLoginMember = {
      id: 'c1',
      displayName: 'Milo',
      hasLogin: true,
      username: 'milo',
      loginEnabled: false,
      requiresPasswordChange: false,
    };
    render(<ChildLoginSection member={member} onRequestCreate={() => {}} />);

    expect(screen.getByText('Disabled')).toBeInTheDocument();
    const enable = screen.getByRole('button', { name: 'Enable Login' }) as HTMLButtonElement;
    expect(enable).toBeEnabled();
    // Disable button must not be present in the disabled state.
    expect(screen.queryByRole('button', { name: 'Disable Login' })).toBeNull();
  });

  it('resets with the parent-entered temporary password and explains the forced change', async () => {
    lifecycle.reset.mockResolvedValue({ childId: 'c1', loginEnabled: true, requiresPasswordChange: true });
    const user = userEvent.setup();
    render(<ChildLoginSection
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
    const { rerender } = render(<ChildLoginSection
      member={{ id: 'c1', displayName: 'Milo', hasLogin: true, username: 'milo', loginEnabled: true }}
      onRequestCreate={() => {}}
    />);
    await user.click(screen.getByRole('button', { name: 'Disable Login' }));
    expect(lifecycle.disable).toHaveBeenCalledWith('c1');
    rerender(<ChildLoginSection
      member={{ id: 'c1', displayName: 'Milo', hasLogin: true, username: 'milo', loginEnabled: false }}
      onRequestCreate={() => {}}
    />);
    await user.click(screen.getByRole('button', { name: 'Enable Login' }));
    expect(lifecycle.enable).toHaveBeenCalledWith('c1');
  });

  it('never renders authUid, synthetic email, or internal ids', () => {
    const member: ChildLoginMember = {
      id: 'c1',
      displayName: 'Milo',
      hasLogin: true,
      username: 'milo',
      loginEnabled: true,
    };
    const { container } = render(<ChildLoginSection member={member} onRequestCreate={() => {}} />);
    expect(container.textContent).not.toMatch(/authUid|@managed\.familyquest\.app|synthetic/i);
  });
});
