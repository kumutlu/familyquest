import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../i18n/config';

const TOKEN = 'CwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCws';
const navigate = vi.hoisted(() => vi.fn());
const storeState = vi.hoisted(() => ({
  authStatus: 'unauthenticated' as 'unauthenticated' | 'authenticated',
  authUser: null as { uid: string } | null,
}));

vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

const apiMocks = vi.hoisted(() => ({
  signUp: vi.fn(async () => ({ user: {} })),
  signInWithGoogle: vi.fn(async () => ({ user: {} })),
}));
vi.mock('../lib/api', () => ({
  signUp: apiMocks.signUp,
  signInWithGoogle: apiMocks.signInWithGoogle,
}));
vi.mock('firebase/auth', () => ({}));
vi.mock('firebase/firestore', () => ({}));
vi.mock('../lib/firebase', () => ({
  auth: {},
  db: {},
  googleProvider: {},
}));

// Mock the store so the page renders (unauthenticated)
vi.mock('../store/useStore', () => ({
  useStore: (selector: any) => selector(storeState),
}));

import { Signup } from './Signup';
import { capturePendingInvite, readPendingInvite } from '../auth/pendingInviteIntent';

function renderSignup(path = '/signup') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Signup />
    </MemoryRouter>,
  );
}

// The Signup form labels are not programmatically associated with their inputs
// (no htmlFor/id), so we reach the inputs through the form element. The inputs
// appear in DOM order: [name, email, password].
function getSignupInputs(): HTMLInputElement[] {
  const label = screen.getByText(/display name/i);
  const form = label.closest('form') as HTMLFormElement;
  return Array.from(form.querySelectorAll('input'));
}

beforeEach(async () => {
  navigate.mockClear();
  sessionStorage.clear();
  localStorage.clear();
  storeState.authStatus = 'unauthenticated';
  storeState.authUser = null;
  apiMocks.signUp.mockClear();
  apiMocks.signInWithGoogle.mockClear();
  await i18n.loadNamespaces(['auth']);
  await act(async () => { await i18n.changeLanguage('en'); });
});

describe('Signup — validated authentication return', () => {
  it('preserves next and token when switching Signup to Login after an email error', async () => {
    apiMocks.signUp.mockRejectedValueOnce(new Error('signup failed'));
    const next = `/invite/${TOKEN}`;
    const user = userEvent.setup();
    renderSignup(`/signup?next=${encodeURIComponent(next)}`);
    const [nameInput, emailInput, passwordInput] = getSignupInputs();
    await user.type(nameInput, 'Jane Doe');
    await user.type(emailInput, 'jane@example.com');
    await user.type(passwordInput, 'secret123');
    await user.click(screen.getByRole('button', { name: /^sign up$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('We could not complete sign-in. Please try again.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('signup failed');
    expect(screen.getByRole('link', { name: /already have an account\? sign in/i })).toHaveAttribute(
      'href',
      `/login?next=${encodeURIComponent(next)}`,
    );
  });

  it('binds and resumes a fresh pending invite after successful email authentication', async () => {
    capturePendingInvite(TOKEN);
    const path = `/signup?next=${encodeURIComponent(`/invite/${TOKEN}`)}`;
    const view = renderSignup(path);

    storeState.authStatus = 'authenticated';
    storeState.authUser = { uid: 'uid-1' };
    view.rerender(
      <MemoryRouter initialEntries={[path]}>
        <Signup />
      </MemoryRouter>,
    );

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/invite/${TOKEN}`, { replace: true }));
    expect(readPendingInvite()).toMatchObject({ token: TOKEN, authUid: 'uid-1' });
  });

  it('does not preserve or navigate to an external next value', async () => {
    const path = '/signup?next=%2F%2Fevil.example%2Fsteal';
    const view = renderSignup(path);
    expect(screen.getByRole('link', { name: /already have an account\? sign in/i })).toHaveAttribute('href', '/login');

    storeState.authStatus = 'authenticated';
    storeState.authUser = { uid: 'uid-1' };
    view.rerender(
      <MemoryRouter initialEntries={[path]}>
        <Signup />
      </MemoryRouter>,
    );

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }));
  });

  it('clears malformed legacy state before using the safe fallback', async () => {
    localStorage.setItem('queki.pendingInviteCode', 'TOO-LONG');
    const view = renderSignup();

    storeState.authStatus = 'authenticated';
    storeState.authUser = { uid: 'uid-1' };
    view.rerender(
      <MemoryRouter initialEntries={['/signup']}>
        <Signup />
      </MemoryRouter>,
    );

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }));
    expect(localStorage.getItem('queki.pendingInviteCode')).toBeNull();
  });

  it('renders invite-aware email-already-used guidance without raw Firebase text', async () => {
    capturePendingInvite(TOKEN);
    const raw = 'Firebase: Error (auth/email-already-in-use).';
    apiMocks.signUp.mockRejectedValueOnce({ code: 'auth/email-already-in-use', message: raw });
    const user = userEvent.setup();
    const next = `/invite/${TOKEN}`;
    renderSignup(`/signup?next=${encodeURIComponent(next)}`);
    const [nameInput, emailInput, passwordInput] = getSignupInputs();
    await user.type(nameInput, 'Jane Doe');
    await user.type(emailInput, 'jane@example.com');
    await user.type(passwordInput, 'secret123');
    await user.click(screen.getByRole('button', { name: /^sign up$/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'This email already has an account. Sign in to continue your invitation.',
    );
    expect(alert).not.toHaveTextContent(raw);
    expect(alert).not.toHaveTextContent('auth/');
    expect(readPendingInvite()?.token).toBe(TOKEN);
    expect(screen.getByRole('link', { name: /already have an account\? sign in/i })).toHaveAttribute(
      'href',
      `/login?next=${encodeURIComponent(next)}`,
    );
  });

  it('renders localized Turkish popup-cancel copy without raw Firebase text', async () => {
    capturePendingInvite(TOKEN);
    const raw = 'Firebase raw auth/popup-closed-by-user';
    apiMocks.signInWithGoogle.mockRejectedValueOnce({
      code: 'auth/popup-closed-by-user',
      message: raw,
    });
    await act(async () => { await i18n.changeLanguage('tr'); });
    const user = userEvent.setup();
    renderSignup(`/signup?next=${encodeURIComponent(`/invite/${TOKEN}`)}`);

    await user.click(screen.getByRole('button', { name: /google ile devam et/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Google ile giriş iptal edildi. Davetiniz hâlâ burada.');
    expect(alert).not.toHaveTextContent(raw);
    expect(readPendingInvite()?.token).toBe(TOKEN);
  });
});

afterEach(async () => {
  await act(async () => { await i18n.changeLanguage('en'); });
});

describe('Signup — English rendering', () => {
  it('renders all fields and actions in English', () => {
    renderSignup();
    expect(screen.getByRole('heading', { name: /create parent account/i })).toBeInTheDocument();
    expect(screen.getByText(/display name/i)).toBeInTheDocument();
    expect(screen.getByText(/email address/i)).toBeInTheDocument();
    expect(screen.getByText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sign up$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /already have an account\? sign in/i })).toBeInTheDocument();
  });

  it('calls signUp with the entered name, email and password', async () => {
    const user = userEvent.setup();
    renderSignup();
    const [nameInput, emailInput, passwordInput] = getSignupInputs();
    await user.type(nameInput, 'Jane Doe');
    await user.type(emailInput, 'jane@example.com');
    await user.type(passwordInput, 'secret123');
    await user.click(screen.getByRole('button', { name: /^sign up$/i }));
    expect(apiMocks.signUp).toHaveBeenCalledWith('jane@example.com', 'secret123', 'Jane Doe');
  });
});

describe('Signup — Google authentication', () => {
  it('renders Google button on signup page', () => {
    renderSignup();
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign in with google/i })).not.toBeInTheDocument();
  });

  it('clicking Google button calls the shared signInWithGoogle handler', async () => {
    const user = userEvent.setup();
    renderSignup();
    await user.click(screen.getByRole('button', { name: /continue with google/i }));
    await waitFor(() => expect(apiMocks.signInWithGoogle).toHaveBeenCalled());
  });

  it('Google button is disabled while signing in', async () => {
    const user = userEvent.setup();
    let resolveGoogle!: (v: any) => void;
    apiMocks.signInWithGoogle.mockImplementation(
      () => new Promise(resolve => { resolveGoogle = resolve; }),
    );
    renderSignup();
    const googleButton = screen.getByRole('button', { name: /continue with google/i });
    await user.click(googleButton);
    await waitFor(() => expect(googleButton).toBeDisabled());
    resolveGoogle({ user: {} });
  });

  it('shows friendly generic feedback when Google sign-in fails', async () => {
    const user = userEvent.setup();
    apiMocks.signInWithGoogle.mockRejectedValue(new Error('Google sign-in failed'));
    renderSignup();
    await user.click(screen.getByRole('button', { name: /continue with google/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('We could not complete sign-in. Please try again.'));
    expect(screen.getByRole('alert')).not.toHaveTextContent('Google sign-in failed');
  });
});

describe('Signup — Turkish rendering', () => {
  it('renders all fields and actions in Turkish', async () => {
    await act(async () => { await i18n.changeLanguage('tr'); });
    renderSignup();
    expect(screen.getByRole('heading', { name: /ebeveyn hesabı oluştur/i })).toBeInTheDocument();
    expect(screen.getByText(/görünen ad/i)).toBeInTheDocument();
    expect(screen.getByText(/e-posta adresi/i)).toBeInTheDocument();
    expect(screen.getByText(/^şifre$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^kaydol$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /zaten hesabınız var mı\? giriş yap/i })).toBeInTheDocument();
  });

  it('renders Google button text in Turkish', async () => {
    await act(async () => { await i18n.changeLanguage('tr'); });
    renderSignup();
    expect(screen.getByRole('button', { name: /google ile devam et/i })).toBeInTheDocument();
  });
});

describe('Signup — language switching', () => {
  it('switches from English to Turkish on an already-mounted instance', async () => {
    const { rerender } = renderSignup();
    expect(screen.getByRole('heading', { name: /create parent account/i })).toBeInTheDocument();
    await i18n.changeLanguage('tr');
    rerender(
      <MemoryRouter>
        <Signup />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: /ebeveyn hesabı oluştur/i })).toBeInTheDocument();
  });
});
