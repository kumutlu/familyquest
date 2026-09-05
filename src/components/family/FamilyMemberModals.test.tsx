import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useStore } from '../../store/useStore';
import i18n from '../../i18n/config';
import { AddChildModal } from './AddChildModal';
import { EditMemberModal } from './EditMemberModal';

const createManagedMember = vi.fn();
const updateDoc = vi.fn();

vi.mock('../../lib/api', () => ({
  createManagedMember: (...args: unknown[]) => createManagedMember(...args),
}));

vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => ({ args }),
  updateDoc: (...args: unknown[]) => updateDoc(...args),
}));

vi.mock('../../lib/firebase', () => ({ db: { name: 'test-db' } }));

vi.mock('../profile/AvatarPicker', () => ({
  AvatarPicker: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button type="button" onClick={() => onSelect('starter-cat')}>Choose cat</button>
  ),
}));

function renderFromTrigger(ui: React.ReactNode) {
  const trigger = document.createElement('button');
  trigger.textContent = 'Open';
  document.body.appendChild(trigger);
  trigger.focus();
  const result = render(<MemoryRouter>{ui}</MemoryRouter>);
  return { ...result, trigger };
}

beforeEach(async () => {
  cleanup();
  await i18n.loadNamespaces(['auth', 'common', 'family']);
  await i18n.changeLanguage('en');
  document.querySelectorAll('body > button').forEach(element => element.remove());
  createManagedMember.mockReset();
  createManagedMember.mockResolvedValue('new-child');
  updateDoc.mockReset();
  updateDoc.mockResolvedValue(undefined);
  act(() => {
    useStore.setState({
      familyMembers: [{ id: 'existing-child', role: 'child', displayName: 'First Child' }],
    });
  });
});

describe('AddChildModal', () => {
  it('stays open when the family already contains a child', () => {
    const onClose = vi.fn();
    render(<MemoryRouter><AddChildModal familyId="family-1" onClose={onClose} /></MemoryRouter>);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('is labelled, traps focus, closes on Escape, and restores trigger focus', async () => {
    const onClose = vi.fn();
    const { trigger, unmount } = renderFromTrigger(
      <AddChildModal familyId="family-1" onClose={onClose} startAtForm />,
    );
    const dialog = screen.getByRole('dialog', { name: /childOnboarding\.createTitle|Add your child/i });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveFocus();

    const last = screen.getByRole('button', { name: /childOnboarding\.createChild|Create child/i });
    const first = screen.getByRole('textbox', { name: /childOnboarding\.displayNameLabel|Display name/i });
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(first).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    unmount();
    await waitFor(() => expect(trigger).toHaveFocus());
    trigger.remove();
  });

  it('keeps the wizard open when Escape closes the nested child-login dialog', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<MemoryRouter><AddChildModal familyId="family-1" onClose={onClose} startAtForm /></MemoryRouter>);

    let wizard = screen.getByRole('dialog');
    await user.click(within(wizard).getAllByRole('button')[0]);
    await user.type(screen.getByRole('textbox'), 'Second Child');
    const submit = wizard.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(submit).not.toBeNull();
    await user.click(submit!);
    expect(await screen.findByText(/Second Child.*profile has been created/i)).toBeInTheDocument();
    wizard = screen.getByRole('dialog');
    const openLogin = within(wizard).getAllByRole('button')[0];
    await user.click(openLogin);

    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    const nestedDialog = screen.getByRole('dialog');
    const nestedFocusable = nestedDialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
    );
    const nestedFirst = nestedFocusable[0];
    const nestedLast = nestedFocusable[nestedFocusable.length - 1];
    nestedLast.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(nestedFirst).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
      expect(screen.getByRole('dialog')).toHaveTextContent('Second Child');
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(openLogin).toHaveFocus();
  });
});

describe('EditMemberModal', () => {
  const member = {
    id: 'child-1',
    role: 'child',
    displayName: 'Old Name',
    avatarId: null,
    avatarUrl: 'https://legacy.example/avatar',
    colour: '#ef4444',
  };

  it('writes only rule-permitted child profile fields', async () => {
    const user = userEvent.setup();
    render(<EditMemberModal member={member} onClose={vi.fn()} />);

    await user.clear(screen.getByRole('textbox', { name: /display name/i }));
    await user.type(screen.getByRole('textbox', { name: /display name/i }), 'New Name');
    await user.click(screen.getByRole('button', { name: 'Choose cat' }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(updateDoc).toHaveBeenCalledOnce());
    expect(updateDoc.mock.calls[0][1]).toEqual({
      displayName: 'New Name',
      avatarUrl: expect.any(String),
    });
    expect(updateDoc.mock.calls[0][1]).not.toHaveProperty('avatarId');
    expect(updateDoc.mock.calls[0][1]).not.toHaveProperty('colour');
  });

  it('is labelled, traps focus, closes on Escape, and restores trigger focus', async () => {
    const onClose = vi.fn();
    const { trigger, unmount } = renderFromTrigger(
      <EditMemberModal member={member} onClose={onClose} />,
    );
    const dialog = screen.getByRole('dialog', { name: /edit member/i });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveFocus();

    const save = screen.getByRole('button', { name: /^save$/i });
    const close = screen.getByRole('button', { name: /close dialog/i });
    save.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(close).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    unmount();
    await waitFor(() => expect(trigger).toHaveFocus());
    trigger.remove();
  });
});
