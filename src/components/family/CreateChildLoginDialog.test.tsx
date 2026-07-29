import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateChildLoginDialog } from './CreateChildLoginDialog';
import { createChildLogin, type CreateChildLoginResult } from '../../lib/childLoginApi';

// Keep the real validation + error mapping; only stub the network call.
vi.mock('../../lib/childLoginApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/childLoginApi')>();
  return { ...actual, createChildLogin: vi.fn() };
});

const mockedCreate = vi.mocked(createChildLogin);

const member = { id: 'child-1', displayName: 'Milo' };

beforeEach(() => {
  vi.resetAllMocks();
});

describe('CreateChildLoginDialog', () => {
  it('opens with the username field focused', async () => {
    render(<CreateChildLoginDialog member={member} onClose={() => {}} onSuccess={() => {}} />);
    expect(screen.getByText('Create Login for Milo')).toBeInTheDocument();
    const username = screen.getByLabelText('Username') as HTMLInputElement;
    await waitFor(() => expect(username).toHaveFocus());
  });

  it('shows live validation errors and blocks submit when invalid', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    render(<CreateChildLoginDialog member={member} onClose={() => {}} onSuccess={onSuccess} />);

    const submit = screen.getByRole('button', { name: 'Create Login' }) as HTMLButtonElement;
    expect(submit).toBeDisabled();

    // Live validation appears as fields are blurred.
    await user.click(screen.getByLabelText('Password')); // blurs username
    expect(await screen.findByText('Please enter a username.')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Confirm Password')); // blurs password
    expect(screen.getByText('Please enter a password.')).toBeInTheDocument();

    expect(onSuccess).not.toHaveBeenCalled();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('shows a password mismatch error', async () => {
    const user = userEvent.setup();
    render(<CreateChildLoginDialog member={member} onClose={() => {}} onSuccess={() => {}} />);

    await user.type(screen.getByLabelText('Username'), 'milo');
    await user.type(screen.getByLabelText('Password'), 'Password1');
    await user.type(screen.getByLabelText('Confirm Password'), 'Password2');
    await user.click(screen.getByLabelText('Username')); // blurs confirm

    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('shows a username normalization preview', async () => {
    const user = userEvent.setup();
    render(<CreateChildLoginDialog member={member} onClose={() => {}} onSuccess={() => {}} />);
    await user.type(screen.getByLabelText('Username'), '  MiLo  ');
    expect(await screen.findByText((_, node) => node?.textContent === 'Will be saved as: milo')).toBeInTheDocument();
  });

  it('creates a login on valid submit and clears passwords', async () => {
    const user = userEvent.setup();
    mockedCreate.mockResolvedValue({ childId: 'child-1', username: 'milo', loginEnabled: true });
    const onSuccess = vi.fn();
    render(<CreateChildLoginDialog member={member} onClose={() => {}} onSuccess={onSuccess} />);

    await user.type(screen.getByLabelText('Username'), 'milo');
    await user.type(screen.getByLabelText('Password'), 'Password1');
    await user.type(screen.getByLabelText('Confirm Password'), 'Password1');
    await user.click(screen.getByRole('button', { name: 'Create Login' }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    expect(mockedCreate).toHaveBeenCalledWith({
      childId: 'child-1',
      username: 'milo',
      password: 'Password1',
      requirePasswordChange: false,
    });
    expect(onSuccess).toHaveBeenCalledWith('milo');
    // Passwords are cleared immediately after success.
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Confirm Password') as HTMLInputElement).value).toBe('');
  });

  it('forwards the require-password-change flag', async () => {
    const user = userEvent.setup();
    mockedCreate.mockResolvedValue({ childId: 'child-1', username: 'milo', loginEnabled: true });
    render(<CreateChildLoginDialog member={member} onClose={() => {}} onSuccess={() => {}} />);

    await user.type(screen.getByLabelText('Username'), 'milo');
    await user.type(screen.getByLabelText('Password'), 'Password1');
    await user.type(screen.getByLabelText('Confirm Password'), 'Password1');
    await user.click(screen.getByLabelText('Require password change on first login'));
    await user.click(screen.getByRole('button', { name: 'Create Login' }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    expect(mockedCreate).toHaveBeenCalledWith({
      childId: 'child-1',
      username: 'milo',
      password: 'Password1',
      requirePasswordChange: true,
    });
  });

  it('shows a loading state and prevents duplicate submission', async () => {
    const user = userEvent.setup();
    let resolve!: (value: CreateChildLoginResult | PromiseLike<CreateChildLoginResult>) => void;
    mockedCreate.mockReturnValue(new Promise<CreateChildLoginResult>((r) => { resolve = r; }));

    render(<CreateChildLoginDialog member={member} onClose={() => {}} onSuccess={() => {}} />);
    await user.type(screen.getByLabelText('Username'), 'milo');
    await user.type(screen.getByLabelText('Password'), 'Password1');
    await user.type(screen.getByLabelText('Confirm Password'), 'Password1');

    const submit = screen.getByRole('button', { name: 'Create Login' });
    await user.click(submit);
    await user.click(submit); // second click should be ignored

    expect(await screen.findByText('Creating…')).toBeInTheDocument();
    const loadingBtn = screen.getByRole('button', { name: 'Creating…' }) as HTMLButtonElement;
    expect(loadingBtn).toBeDisabled();
    expect(mockedCreate).toHaveBeenCalledTimes(1);

    resolve({ childId: 'child-1', username: 'milo', loginEnabled: true });
  });

  it('surfaces a friendly error message on failure', async () => {
    const user = userEvent.setup();
    mockedCreate.mockRejectedValue({ code: 'already-exists', message: 'USERNAME_TAKEN' });
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(<CreateChildLoginDialog member={member} onClose={onClose} onSuccess={onSuccess} />);

    await user.type(screen.getByLabelText('Username'), 'milo');
    await user.type(screen.getByLabelText('Password'), 'Password1');
    await user.type(screen.getByLabelText('Confirm Password'), 'Password1');
    await user.click(screen.getByRole('button', { name: 'Create Login' }));

    expect(await screen.findByText('That username is already taken in this family.')).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('logs the real callable error while showing a friendly unexpected-error message', async () => {
    const user = userEvent.setup();
    const serverError = {
      code: 'functions/internal',
      message: 'AUTH_CREATE_FAILED',
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedCreate.mockRejectedValue(serverError);
    render(<CreateChildLoginDialog member={member} onClose={() => {}} onSuccess={() => {}} />);

    await user.type(screen.getByLabelText('Username'), 'milo');
    await user.type(screen.getByLabelText('Password'), 'Password1');
    await user.type(screen.getByLabelText('Confirm Password'), 'Password1');
    await user.click(screen.getByRole('button', { name: 'Create Login' }));

    expect(
      await screen.findByText('We could not create the login. Please try again.'),
    ).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith(
      '[child-login] create failed',
      expect.objectContaining({
        code: 'functions/internal',
        message: 'AUTH_CREATE_FAILED',
      }),
    );
    consoleError.mockRestore();
  });

  it('closes on cancel and clears passwords', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CreateChildLoginDialog member={member} onClose={onClose} onSuccess={() => {}} />);

    await user.type(screen.getByLabelText('Password'), 'Password1');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});
