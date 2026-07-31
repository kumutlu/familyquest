import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Parent/Google auth must never be reachable from this page.
const apiMocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signInWithGoogle: vi.fn(),
}));
vi.mock('../lib/api', () => apiMocks);

const childApiMocks = vi.hoisted(() => ({
  signInChild: vi.fn(),
  mapSignInChildError: vi.fn(() => 'error'),
  normalizeUsernamePreview: (raw: string) => raw,
}));
vi.mock('../lib/childLoginApi', () => childApiMocks);

const joinApiMocks = vi.hoisted(() => ({
  submitChildJoinRequest: vi.fn(),
  getChildJoinRequestStatus: vi.fn(),
  cancelChildJoinRequest: vi.fn(),
  mapChildJoinErrorKey: vi.fn(() => 'auth:childJoin.errors.generic'),
  storeJoinRequestHandle: vi.fn(),
  readJoinRequestHandle: vi.fn(() => null),
  clearJoinRequestHandle: vi.fn(),
}));
vi.mock('../lib/childJoinApi', () => joinApiMocks);

vi.mock('../lib/firebase', () => ({ auth: {}, db: {}, functions: {}, googleProvider: {}, app: {} }));

import { JoinFamily } from './JoinFamily';
import i18n from '../i18n/config';

function renderJoin() {
  return render(
    <MemoryRouter initialEntries={['/join-family']}>
      <Routes>
        <Route path="/join-family" element={<JoinFamily />} />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const fetchSpy = vi.fn();
globalThis.fetch = fetchSpy as unknown as typeof fetch;

const PENDING_RESULT = {
  requestId: 'joinreq-1',
  requestSecret: 'request-secret-1',
  username: 'alex',
  status: 'pending' as const,
  expiresAt: Date.now() + 604800000,
};

beforeEach(async () => {
  apiMocks.signIn.mockClear();
  childApiMocks.signInChild.mockClear();
  fetchSpy.mockClear();
  Object.values(joinApiMocks).forEach(mock => (mock as ReturnType<typeof vi.fn>).mockClear?.());
  joinApiMocks.submitChildJoinRequest.mockResolvedValue(PENDING_RESULT);
  joinApiMocks.readJoinRequestHandle.mockReturnValue(null);
  joinApiMocks.mapChildJoinErrorKey.mockReturnValue('auth:childJoin.errors.generic');
  await i18n.loadNamespaces(['auth']);
  await act(async () => { await i18n.changeLanguage('en'); });
});

afterEach(async () => {
  await act(async () => { await i18n.changeLanguage('en'); });
});

async function fillForm(user: ReturnType<typeof userEvent.setup>, pw = 'secret123', confirm = 'secret123') {
  await user.type(screen.getByLabelText(/family code/i), 'FAM123');
  await user.type(screen.getByLabelText(/^username$/i), 'alex');
  await user.type(screen.getByLabelText(/create password/i), pw);
  await user.type(screen.getByLabelText(/confirm password/i), confirm);
}

const submitButton = () => screen.getByRole('button', { name: /send join request/i });

describe('JoinFamily — form', () => {
  it('renders heading, description and all four fields', () => {
    renderJoin();
    expect(screen.getByRole('heading', { name: /join your family/i })).toBeInTheDocument();
    expect(screen.getByText(/enter the family code your parent gave you/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/family code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^username$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/create password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(submitButton()).toBeInTheDocument();
  });

  it('validates required fields without calling the backend', async () => {
    const user = userEvent.setup();
    renderJoin();
    await user.click(submitButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(/fill in all the fields/i);
    expect(joinApiMocks.submitChildJoinRequest).not.toHaveBeenCalled();
  });

  it('shows an error when the password confirmation does not match', async () => {
    const user = userEvent.setup();
    renderJoin();
    await fillForm(user, 'secret123', 'different');
    await user.click(submitButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(/passwords do not match/i);
    expect(joinApiMocks.submitChildJoinRequest).not.toHaveBeenCalled();
  });
});

describe('JoinFamily — submission', () => {
  it('submits the request through the trusted callable', async () => {
    const user = userEvent.setup();
    renderJoin();
    await fillForm(user);
    await user.click(submitButton());

    await waitFor(() => expect(joinApiMocks.submitChildJoinRequest).toHaveBeenCalledTimes(1));
    expect(joinApiMocks.submitChildJoinRequest).toHaveBeenCalledWith({
      familyCode: 'FAM123',
      username: 'alex',
      password: 'secret123',
    });
  });

  it('never signs the child in and never touches parent auth', async () => {
    const user = userEvent.setup();
    renderJoin();
    await fillForm(user);
    await user.click(submitButton());

    expect(await screen.findByRole('heading', { name: /request sent/i })).toBeInTheDocument();
    expect(childApiMocks.signInChild).not.toHaveBeenCalled();
    expect(apiMocks.signIn).not.toHaveBeenCalled();
    expect(apiMocks.signInWithGoogle).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('clears the password fields from component state after submitting', async () => {
    const user = userEvent.setup();
    renderJoin();
    await fillForm(user);
    await user.click(submitButton());
    await screen.findByRole('heading', { name: /request sent/i });
    // The form (and therefore every password input) is unmounted.
    expect(screen.queryByLabelText(/create password/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/confirm password/i)).not.toBeInTheDocument();
  });

  it('stores only the opaque request handle', async () => {
    const user = userEvent.setup();
    renderJoin();
    await fillForm(user);
    await user.click(submitButton());
    await waitFor(() => expect(joinApiMocks.storeJoinRequestHandle).toHaveBeenCalled());
    const handle = joinApiMocks.storeJoinRequestHandle.mock.calls[0][0];
    expect(handle).toEqual({
      requestId: 'joinreq-1',
      requestSecret: 'request-secret-1',
      username: 'alex',
    });
    expect(JSON.stringify(handle)).not.toContain('secret123');
    expect(JSON.stringify(handle)).not.toContain('FAM123');
  });

  it('shows a generic error when the family cannot be resolved', async () => {
    joinApiMocks.submitChildJoinRequest.mockRejectedValueOnce(new Error('JOIN_REQUEST_FAILED'));
    joinApiMocks.mapChildJoinErrorKey.mockReturnValueOnce('auth:childJoin.errors.invalidRequest');
    const user = userEvent.setup();
    renderJoin();
    await fillForm(user);
    await user.click(submitButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /couldn't send that request\. check your family code/i,
    );
    expect(screen.queryByRole('heading', { name: /request sent/i })).not.toBeInTheDocument();
  });

  it('shows the duplicate-username error', async () => {
    joinApiMocks.submitChildJoinRequest.mockRejectedValueOnce(new Error('USERNAME_TAKEN'));
    joinApiMocks.mapChildJoinErrorKey.mockReturnValueOnce('auth:childJoin.errors.usernameTaken');
    const user = userEvent.setup();
    renderJoin();
    await fillForm(user);
    await user.click(submitButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(/username is already taken/i);
  });

  it('shows the rate-limit error', async () => {
    joinApiMocks.submitChildJoinRequest.mockRejectedValueOnce(new Error('TOO_MANY_JOIN_REQUESTS'));
    joinApiMocks.mapChildJoinErrorKey.mockReturnValueOnce('auth:childJoin.errors.rateLimited');
    const user = userEvent.setup();
    renderJoin();
    await fillForm(user);
    await user.click(submitButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(/too many tries/i);
  });

  it('shows the network error', async () => {
    joinApiMocks.submitChildJoinRequest.mockRejectedValueOnce(new Error('unavailable'));
    joinApiMocks.mapChildJoinErrorKey.mockReturnValueOnce('auth:childJoin.errors.network');
    const user = userEvent.setup();
    renderJoin();
    await fillForm(user);
    await user.click(submitButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't reach the app/i);
  });
});

describe('JoinFamily — pending screen', () => {
  async function submitAndWait() {
    const user = userEvent.setup();
    renderJoin();
    await fillForm(user);
    await user.click(submitButton());
    await screen.findByRole('heading', { name: /request sent/i });
    return user;
  }

  it('shows the approval-required message, username, status and actions', async () => {
    await submitAndWait();
    expect(
      screen.getByText('A parent must approve your request before you can join the family.'),
    ).toBeInTheDocument();
    expect(screen.getByText('alex')).toBeInTheDocument();
    expect(screen.getByText(/waiting for a parent/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh status/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back to sign in/i })).toBeInTheDocument();
  });

  it('does not display any family information', async () => {
    await submitAndWait();
    expect(screen.queryByText(/FAM123/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/family code/i)).not.toBeInTheDocument();
  });

  it('Refresh status re-reads the status from the backend', async () => {
    joinApiMocks.getChildJoinRequestStatus.mockResolvedValue({
      requestId: 'joinreq-1',
      username: 'alex',
      status: 'pending',
      expiresAt: PENDING_RESULT.expiresAt,
    });
    const user = await submitAndWait();
    await user.click(screen.getByRole('button', { name: /refresh status/i }));
    await waitFor(() => expect(joinApiMocks.getChildJoinRequestStatus).toHaveBeenCalledWith({
      requestId: 'joinreq-1',
      requestSecret: 'request-secret-1',
    }));
  });

  it('renders the approved state', async () => {
    joinApiMocks.getChildJoinRequestStatus.mockResolvedValue({
      requestId: 'joinreq-1',
      username: 'alex',
      status: 'approved',
      expiresAt: PENDING_RESULT.expiresAt,
    });
    const user = await submitAndWait();
    await user.click(screen.getByRole('button', { name: /refresh status/i }));
    expect(await screen.findByText('Approved')).toBeInTheDocument();
    expect(screen.getByText(/you're in!/i)).toBeInTheDocument();
  });

  it('renders the rejected state', async () => {
    joinApiMocks.getChildJoinRequestStatus.mockResolvedValue({
      requestId: 'joinreq-1',
      username: 'alex',
      status: 'rejected',
      expiresAt: PENDING_RESULT.expiresAt,
    });
    const user = await submitAndWait();
    await user.click(screen.getByRole('button', { name: /refresh status/i }));
    expect(await screen.findByText('Not approved')).toBeInTheDocument();
    expect(screen.getByText(/did not approve this request/i)).toBeInTheDocument();
  });

  it('renders the expired state', async () => {
    joinApiMocks.getChildJoinRequestStatus.mockResolvedValue({
      requestId: 'joinreq-1',
      username: 'alex',
      status: 'expired',
      expiresAt: PENDING_RESULT.expiresAt,
    });
    const user = await submitAndWait();
    await user.click(screen.getByRole('button', { name: /refresh status/i }));
    expect(await screen.findByText('Expired')).toBeInTheDocument();
    expect(screen.getByText(/waited too long and has expired/i)).toBeInTheDocument();
  });

  it('lets the child cancel a pending request', async () => {
    joinApiMocks.cancelChildJoinRequest.mockResolvedValue({
      requestId: 'joinreq-1',
      status: 'cancelled',
    });
    const user = await submitAndWait();
    await user.click(screen.getByRole('button', { name: /cancel my request/i }));
    await waitFor(() => expect(joinApiMocks.cancelChildJoinRequest).toHaveBeenCalledWith({
      requestId: 'joinreq-1',
      requestSecret: 'request-secret-1',
    }));
    expect(await screen.findByText('Cancelled')).toBeInTheDocument();
  });

  it('Back to sign in returns to the login page', async () => {
    const user = await submitAndWait();
    await user.click(screen.getByRole('button', { name: /back to sign in/i }));
    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });

  it('restores a stored pending request on mount', async () => {
    joinApiMocks.readJoinRequestHandle.mockReturnValue({
      requestId: 'joinreq-9',
      requestSecret: 'request-secret-9',
      username: 'sam',
    });
    joinApiMocks.getChildJoinRequestStatus.mockResolvedValue({
      requestId: 'joinreq-9',
      username: 'sam',
      status: 'pending',
      expiresAt: PENDING_RESULT.expiresAt,
    });
    renderJoin();
    expect(await screen.findByRole('heading', { name: /request sent/i })).toBeInTheDocument();
    expect(screen.getByText('sam')).toBeInTheDocument();
  });
});

describe('JoinFamily — i18n', () => {
  it('renders Turkish copy when the language is Turkish', async () => {
    await act(async () => { await i18n.changeLanguage('tr'); });
    renderJoin();
    expect(screen.getByRole('heading', { name: 'Ailene katıl' })).toBeInTheDocument();
    expect(screen.getByText('Ebeveyninin sana verdiği Aile Kodunu gir.')).toBeInTheDocument();
    expect(screen.getByLabelText('Aile Kodu')).toBeInTheDocument();
    expect(screen.getByLabelText('Şifre Oluştur')).toBeInTheDocument();
    expect(screen.getByLabelText('Şifreyi Onayla')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Katılma isteği gönder' })).toBeInTheDocument();
  });

  it('renders the Turkish pending screen', async () => {
    await act(async () => { await i18n.changeLanguage('tr'); });
    const user = userEvent.setup();
    renderJoin();
    await user.type(screen.getByLabelText('Aile Kodu'), 'FAM123');
    await user.type(screen.getByLabelText('Kullanıcı adı'), 'alex');
    await user.type(screen.getByLabelText('Şifre Oluştur'), 'secret123');
    await user.type(screen.getByLabelText('Şifreyi Onayla'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Katılma isteği gönder' }));

    expect(await screen.findByRole('heading', { name: 'İstek gönderildi' })).toBeInTheDocument();
    expect(
      screen.getByText('Aileye katılabilmen için bir ebeveynin isteğini onaylaması gerekiyor.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Durumu yenile' })).toBeInTheDocument();
  });
});
