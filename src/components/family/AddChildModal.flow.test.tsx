import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n/config';

const createManagedMember = vi.fn();
const loginState = vi.hoisted(() => ({ fail: false }));

vi.mock('../../lib/api', () => ({
  createManagedMember: (...args: unknown[]) => createManagedMember(...args),
}));
vi.mock('../profile/AvatarPicker', () => ({
  AvatarPicker: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button type="button" onClick={() => onSelect('starter-cat')}>Choose cat</button>
  ),
}));
vi.mock('./CreateChildLoginDialog', () => ({
  CreateChildLoginDialog: ({
    member,
    onSuccess,
  }: {
    member: { id: string; displayName: string } | null;
    onSuccess: (username: string) => void;
  }) => member ? (
    <div role="dialog" aria-label="Child login">
      <p>{member.id}</p>
      {loginState.fail ? <p role="alert">Profile created, but login failed.</p> : null}
      <button onClick={() => onSuccess('child-user')}>Provision login</button>
    </div>
  ) : null,
}));

import { AddChildModal } from './AddChildModal';

const renderFlow = (props: Partial<React.ComponentProps<typeof AddChildModal>> = {}) => {
  const onClose = vi.fn();
  const onChildAdded = vi.fn();
  render(
    <MemoryRouter>
      <AddChildModal
        familyId="family-1"
        onClose={onClose}
        onChildAdded={onChildAdded}
        startAtForm
        {...props}
      />
    </MemoryRouter>,
  );
  return { onClose, onChildAdded };
};

const createProfile = async () => {
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox', { name: /display name/i }), 'Milo');
  await user.click(screen.getByRole('button', { name: 'Choose cat' }));
  await user.click(screen.getByRole('button', { name: /create child/i }));
  return user;
};

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.loadNamespaces(['auth', 'common']);
  await i18n.changeLanguage('en');
  loginState.fail = false;
  createManagedMember.mockResolvedValue('child-1');
});

describe('unified managed-child flow', () => {
  it('creates a profile-only child when Not now is selected', async () => {
    const { onClose, onChildAdded } = renderFlow();
    const user = await createProfile();

    expect(await screen.findByText('Should this child be able to sign in?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Not now' }));

    expect(createManagedMember).toHaveBeenCalledTimes(1);
    expect(createManagedMember).toHaveBeenCalledWith(
      'family-1',
      'child',
      'Milo',
      { avatarId: 'starter-cat' },
    );
    expect(onChildAdded).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('creates one profile and provisions login for that same child', async () => {
    const { onClose } = renderFlow();
    const user = await createProfile();
    await user.click(screen.getByRole('button', { name: 'Create login' }));

    expect(await screen.findByRole('dialog', { name: 'Child login' })).toHaveTextContent('child-1');
    await user.click(screen.getByRole('button', { name: 'Provision login' }));

    expect(createManagedMember).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('retains the created profile for login retry without creating a duplicate', async () => {
    loginState.fail = true;
    renderFlow();
    const user = await createProfile();
    await user.click(screen.getByRole('button', { name: 'Create login' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Profile created, but login failed.');
    await user.click(screen.getByRole('button', { name: 'Provision login' }));

    await waitFor(() => expect(createManagedMember).toHaveBeenCalledTimes(1));
  });

  it('does not ask for date of birth, colour, tasks, or rewards', () => {
    renderFlow();
    expect(screen.queryByLabelText(/date of birth/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/colour/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/task/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/reward/i)).not.toBeInTheDocument();
  });
});
