import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n/config';

const api = vi.hoisted(() => ({
  createFamilyAndParent: vi.fn(),
  requestToJoinFamily: vi.fn(),
  signOut: vi.fn(),
}));
const navigate = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => ({
  currentUser: { uid: 'user-1', displayName: 'Test Parent', role: 'parent' },
  refreshCurrentUser: vi.fn(),
}));

vi.mock('../lib/api', () => api);
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: () => navigate,
}));
vi.mock('../store/useStore', () => ({
  useStore: (selector: (state: typeof store) => unknown) => selector(store),
}));

import { Onboarding } from './Onboarding';

const renderPage = () => render(<MemoryRouter><Onboarding /></MemoryRouter>);

beforeEach(async () => {
  vi.clearAllMocks();
  api.createFamilyAndParent.mockResolvedValue({
    familyId: 'family-1',
    inviteCode: 'ABC123',
    user: { uid: 'user-1', familyId: 'family-1', role: 'owner' },
  });
  api.requestToJoinFamily.mockResolvedValue('family-1');
  await i18n.loadNamespaces(['auth', 'common']);
  await act(async () => { await i18n.changeLanguage('en'); });
});

describe('Onboarding', () => {
  it('offers create-family and join-family paths', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /create family/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /invite.*code/i })).toBeInTheDocument();
  });

  it('completes family creation and enters Home without asking about children', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /create family/i }));
    await user.type(screen.getByPlaceholderText(/the smiths/i), 'Test Family');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }));
    expect(store.refreshCurrentUser).toHaveBeenCalledWith(
      'user-1',
      { familyId: 'family-1', role: 'owner' },
    );
    expect(screen.queryByText(/add family members/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/child/i)).not.toBeInTheDocument();
  });

  it('does not ask child count, child details, or member roles', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /create family/i }));

    expect(screen.queryByRole('option', { name: /child/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/date of birth/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/add family members/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/invite others/i)).not.toBeInTheDocument();
  });

  it('keeps the create screen usable when family creation fails', async () => {
    const user = userEvent.setup();
    api.createFamilyAndParent.mockRejectedValue(new Error('Family creation failed'));
    renderPage();

    await user.click(screen.getByRole('button', { name: /create family/i }));
    await user.type(screen.getByPlaceholderText(/the smiths/i), 'Test Family');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Family creation failed');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('submits a family-code join request and shows pending approval', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /invite.*code/i }));
    await user.type(screen.getByLabelText(/invite code/i), 'ABC123');
    await user.click(screen.getByRole('button', { name: /request to join/i }));

    expect(api.requestToJoinFamily).toHaveBeenCalledWith('user-1', 'Test Parent', 'ABC123');
    expect(await screen.findByText(/request.*sent/i)).toBeInTheDocument();
  });
});
