import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import { ProfileDropdown } from './ProfileDropdown';

const { mockSignOut } = vi.hoisted(() => ({ mockSignOut: vi.fn(async () => {}) }));
const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));

vi.mock('../../lib/api', () => ({ signOut: mockSignOut }));
vi.mock('../../store/useStore', () => ({
  useStore: vi.fn((selector: any) =>
    selector
      ? selector({
          currentUser: { id: 'u1', displayName: 'Kemal', role: 'parent', avatarUrl: null },
        })
      : {},
  ),
}));
// The `settings` namespace is not bundled in the test i18n seed, so provide a
// deterministic translation function (returns the key) for stable queries.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { changeLanguage: () => {} } }),
}));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock('../profile/ProfileEditorModal', () => ({ ProfileEditorModal: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProfileDropdown — sign out', () => {
  it('navigates to /login (replace) after a successful sign-out', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ProfileDropdown />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /profileMenuAria/i }));
    await user.click(screen.getByRole('menuitem', { name: /signOut/i }));

    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
    expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
  });

  it('does not strand the user: still attempts sign-out and does not navigate on failure', async () => {
    mockSignOut.mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ProfileDropdown />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /profileMenuAria/i }));
    await user.click(screen.getByRole('menuitem', { name: /signOut/i }));

    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
    // On failure we must NOT navigate (the session is still alive); the error
    // is logged and the menu simply closes.
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
