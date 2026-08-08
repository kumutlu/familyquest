import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, Link } from 'react-router-dom';
import { ChildLoginSection, type ChildLoginMember } from './ChildLoginSection';

const lifecycle = vi.hoisted(() => ({
  reset: vi.fn(),
  disable: vi.fn(),
  enable: vi.fn(),
  deleteChild: vi.fn(),
}));

vi.mock('../../lib/childLoginApi', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/childLoginApi')>();
  return {
    ...actual,
    resetChildPassword: lifecycle.reset,
    disableChildLogin: lifecycle.disable,
    enableChildLogin: lifecycle.enable,
    deleteChild: lifecycle.deleteChild,
  };
});

const member: ChildLoginMember = {
  id: 'c1',
  displayName: 'Alisya',
  hasLogin: true,
  username: 'alisya',
  loginEnabled: true,
  isManaged: true,
};

/** Reproduces the Family page structure: the whole card is a router <Link>. */
function renderInsideMemberLink() {
  return render(
    <MemoryRouter initialEntries={['/family']}>
      <Routes>
        <Route
          path="/family"
          element={
            <Link to={`/family/${member.id}`} className="block">
              <div>
                <span>Alisya row</span>
                <ChildLoginSection member={member} onRequestCreate={() => {}} />
              </div>
            </Link>
          }
        />
        <Route path="/family/:id" element={<div>MEMBER PROFILE PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('managed child actions nested inside the member link', () => {
  beforeEach(() => vi.clearAllMocks());

  it('navigates to the profile when the row itself is clicked', async () => {
    const user = userEvent.setup();
    renderInsideMemberLink();
    await user.click(screen.getByText('Alisya row'));
    expect(screen.getByText('MEMBER PROFILE PAGE')).toBeInTheDocument();
  });

  it('does not navigate when Reset password is clicked, and opens the reset flow', async () => {
    const user = userEvent.setup();
    renderInsideMemberLink();
    await user.click(screen.getByTestId('reset-password-button'));
    expect(screen.queryByText('MEMBER PROFILE PAGE')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Temporary password')).toBeInTheDocument();
  });

  it('does not navigate when Delete child is clicked, and opens the confirmation dialog', async () => {
    const user = userEvent.setup();
    renderInsideMemberLink();
    await user.click(screen.getByTestId('delete-child-button'));
    expect(screen.queryByText('MEMBER PROFILE PAGE')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('keyboard activation of Reset password does not navigate', async () => {
    const user = userEvent.setup();
    renderInsideMemberLink();
    screen.getByTestId('reset-password-button').focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByText('MEMBER PROFILE PAGE')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Temporary password')).toBeInTheDocument();
  });

  it('prevents duplicate delete requests while one is in flight', async () => {
    let resolveDelete: (value?: unknown) => void = () => {};
    lifecycle.deleteChild.mockImplementation(
      () => new Promise(resolve => { resolveDelete = resolve; }),
    );
    const user = userEvent.setup();
    renderInsideMemberLink();
    await user.click(screen.getByTestId('delete-child-button'));
    await user.type(screen.getByLabelText(/name/i), 'Alisya');

    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getAllByRole('button').find(b => b.textContent?.match(/delete/i))!;
    await user.click(confirm);
    await user.click(confirm);
    expect(lifecycle.deleteChild).toHaveBeenCalledTimes(1);
    resolveDelete({});
  });

  it('renders the delete dialog in a portal on document.body', async () => {
    const user = userEvent.setup();
    const { container } = renderInsideMemberLink();
    await user.click(screen.getByTestId('delete-child-button'));
    const dialog = screen.getByRole('dialog');
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });
});
