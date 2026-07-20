import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// --- Mock the auth API surface used by the Parent tab ---
const apiMocks = vi.hoisted(() => ({
  signIn: vi.fn(async () => ({ user: {} })),
  signInWithGoogle: vi.fn(async () => ({ user: {} })),
}));
vi.mock('../lib/api', () => ({
  signIn: apiMocks.signIn,
  signInWithGoogle: apiMocks.signInWithGoogle,
}));

// --- Mock the child login API surface used by the Child tab ---
const childApiMocks = vi.hoisted(() => ({
  signInChild: vi.fn(async () => ({ customToken: 'tok-123' })),
  mapSignInChildError: vi.fn(() => 'We could not sign you in. Please check your Family Code, username, and password, then try again.'),
}));
vi.mock('../lib/childLoginApi', () => ({
  signInChild: childApiMocks.signInChild,
  mapSignInChildError: childApiMocks.mapSignInChildError,
  // Real normalization so the component's username normalization is exercised.
  normalizeUsernamePreview: (raw: string) => raw.trim().toLowerCase().replace(/\s+/g, ' '),
}));

// --- Mock firebase/auth so signInWithCustomToken is observable & harmless ---
const authMocks = vi.hoisted(() => ({
  signInWithCustomToken: vi.fn(async () => ({ user: {} })),
}));
vi.mock('firebase/auth', () => ({
  signInWithCustomToken: authMocks.signInWithCustomToken,
}));

// --- Mock the firebase module so importing `auth` does not initialize SDK ---
vi.mock('../lib/firebase', () => ({
  auth: {},
  db: {},
  functions: {},
  googleProvider: {},
  app: {},
}));

// --- Mock the store so the page renders (unauthenticated) ---
vi.mock('../store/useStore', () => ({
  useStore: (selector: any) => selector({ authStatus: 'unauthenticated' }),
}));

import { Login } from './Login';
import i18n from '../i18n/config';

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  );
}

const GENERIC_ERROR = 'We could not sign you in. Please check your Family Code, username, and password, then try again.';

beforeEach(() => {
  apiMocks.signIn.mockClear();
  apiMocks.signInWithGoogle.mockClear();
  childApiMocks.signInChild.mockClear();
  childApiMocks.mapSignInChildError.mockClear();
  authMocks.signInWithCustomToken.mockClear();
  // Default: success path.
  childApiMocks.signInChild.mockResolvedValue({ customToken: 'tok-123' });
  authMocks.signInWithCustomToken.mockResolvedValue({ user: {} });
});

// Ensure the `auth` namespace is loaded and the language is English before each
// test so the migrated strings render synchronously (matching prior behaviour).
beforeEach(async () => {
  await i18n.loadNamespaces(['auth']);
  await act(async () => { await i18n.changeLanguage('en'); });
});

afterEach(async () => {
  await act(async () => { await i18n.changeLanguage('en'); });
});

describe('Login — Parent tab unchanged', () => {
  it('renders the Parent tab by default with email, password, and Google', () => {
    renderLogin();
    expect(screen.getByRole('tab', { name: 'Parent' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument();
    // Child-only fields are NOT present until the Child tab is selected.
    expect(screen.queryByLabelText(/family code/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^username$/i)).not.toBeInTheDocument();
  });

  it('parent sign-in still calls signIn with email + password', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText(/email address/i), 'parent@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    await waitFor(() => expect(apiMocks.signIn).toHaveBeenCalledWith('parent@example.com', 'secret123'));
    // Child path must NOT be used.
    expect(childApiMocks.signInChild).not.toHaveBeenCalled();
    expect(authMocks.signInWithCustomToken).not.toHaveBeenCalled();
  });

  it('google sign-in still calls signInWithGoogle', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('button', { name: /sign in with google/i }));
    await waitFor(() => expect(apiMocks.signInWithGoogle).toHaveBeenCalled());
  });
});

describe('Login — Child tab renders correctly', () => {
  it('shows Family Code, Username, Password and Sign In (no email)', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('tab', { name: 'Child' }));
    expect(screen.getByRole('tab', { name: 'Child' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText(/family code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^username$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
    // No email field on the child form.
    expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
  });

  it('focuses the Family Code field when the Child tab is shown', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('tab', { name: 'Child' }));
    await waitFor(() =>
      expect(screen.getByLabelText(/family code/i)).toHaveFocus(),
    );
  });
});

describe('Login — Child validation', () => {
  it('shows a friendly error when required fields are empty', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('tab', { name: 'Child' }));
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/please enter your family code, username, and password/i);
    expect(childApiMocks.signInChild).not.toHaveBeenCalled();
  });

  it('shows a friendly error when only password is missing', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('tab', { name: 'Child' }));
    await user.type(screen.getByLabelText(/family code/i), 'FAM123');
    await user.type(screen.getByLabelText(/^username$/i), 'alex');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/please enter your family code, username, and password/i);
    expect(childApiMocks.signInChild).not.toHaveBeenCalled();
  });
});

describe('Login — Child loading state', () => {
  it('disables the submit button and shows a loading label while signing in', async () => {
    const user = userEvent.setup();
    let resolveSignIn!: (v: any) => void;
    childApiMocks.signInChild.mockImplementation(
      () => new Promise(resolve => { resolveSignIn = resolve; }),
    );
    renderLogin();
    await user.click(screen.getByRole('tab', { name: 'Child' }));
    await user.type(screen.getByLabelText(/family code/i), 'FAM123');
    await user.type(screen.getByLabelText(/^username$/i), 'alex');
    await user.type(screen.getByLabelText(/^password$/i), 'password1');

    const submit = screen.getByRole('button', { name: /^sign in$/i });
    const click = user.click(submit);
    await waitFor(() => expect(submit).toBeDisabled());
    expect(submit).toHaveTextContent(/signing in/i);

    resolveSignIn({ customToken: 'tok-123' });
    await click;
  });
});

describe('Login — Child generic errors', () => {
  it('shows a generic message and never reveals which field failed', async () => {
    const user = userEvent.setup();
    childApiMocks.signInChild.mockRejectedValue(new Error('INVALID_CREDENTIALS'));
    renderLogin();
    await user.click(screen.getByRole('tab', { name: 'Child' }));
    await user.type(screen.getByLabelText(/family code/i), 'FAM123');
    await user.type(screen.getByLabelText(/^username$/i), 'alex');
    await user.type(screen.getByLabelText(/^password$/i), 'wrongpass');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(GENERIC_ERROR);
    // The raw backend code must never leak through. The generic message may
    // name the fields as a prompt, but it must never single out which one was
    // wrong (e.g. "family does not exist" / "incorrect password").
    expect(alert).not.toHaveTextContent('INVALID_CREDENTIALS');
    expect(alert).not.toHaveTextContent(/does not exist/i);
    expect(alert).not.toHaveTextContent(/incorrect/i);
    expect(alert).not.toHaveTextContent(/wrong/i);
    expect(childApiMocks.mapSignInChildError).toHaveBeenCalled();
  });
});

describe('Login — Child successful sign-in', () => {
  it('calls signInChild then signInWithCustomToken with the returned token', async () => {
    const user = userEvent.setup();
    childApiMocks.signInChild.mockResolvedValue({ customToken: 'custom-token-xyz' });
    renderLogin();
    await user.click(screen.getByRole('tab', { name: 'Child' }));
    await user.type(screen.getByLabelText(/family code/i), '  FAM123  ');
    await user.type(screen.getByLabelText(/^username$/i), '  Alex  ');
    await user.type(screen.getByLabelText(/^password$/i), 'password1');

    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => expect(childApiMocks.signInChild).toHaveBeenCalledTimes(1));
    // Inputs are trimmed/normalized consistently with the backend.
    expect(childApiMocks.signInChild).toHaveBeenCalledWith({
      familyCode: 'FAM123',
      username: 'alex',
      password: 'password1',
    });
    expect(authMocks.signInWithCustomToken).toHaveBeenCalledWith({}, 'custom-token-xyz');
  });

  it('clears the password after a successful sign-in', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('tab', { name: 'Child' }));
    const passwordInput = screen.getByLabelText(/^password$/i) as HTMLInputElement;
    await user.type(screen.getByLabelText(/family code/i), 'FAM123');
    await user.type(screen.getByLabelText(/^username$/i), 'alex');
    await user.type(passwordInput, 'password1');

    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    await waitFor(() => expect(authMocks.signInWithCustomToken).toHaveBeenCalled());
    // Password is cleared from the input immediately after success.
    expect(passwordInput.value).toBe('');
  });
});

describe('Login — Child password cleared after failure', () => {
  it('clears the password after a failed sign-in attempt', async () => {
    const user = userEvent.setup();
    childApiMocks.signInChild.mockRejectedValue(new Error('INVALID_CREDENTIALS'));
    renderLogin();
    await user.click(screen.getByRole('tab', { name: 'Child' }));
    const passwordInput = screen.getByLabelText(/^password$/i) as HTMLInputElement;
    await user.type(screen.getByLabelText(/family code/i), 'FAM123');
    await user.type(screen.getByLabelText(/^username$/i), 'alex');
    await user.type(passwordInput, 'wrongpass');

    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(GENERIC_ERROR));
    // Password is cleared after failure (never cached).
    expect(passwordInput.value).toBe('');
  });
});

describe('Login — Parent login unaffected by child flow', () => {
  it('child sign-in does not invoke the parent email/password signIn', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('tab', { name: 'Child' }));
    await user.type(screen.getByLabelText(/family code/i), 'FAM123');
    await user.type(screen.getByLabelText(/^username$/i), 'alex');
    await user.type(screen.getByLabelText(/^password$/i), 'password1');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    await waitFor(() => expect(childApiMocks.signInChild).toHaveBeenCalled());
    expect(apiMocks.signIn).not.toHaveBeenCalled();
  });
});

describe('Login — i18n (English + Turkish + switching)', () => {
  it('renders English strings by default', () => {
    renderLogin();
    expect(screen.getByRole('heading', { name: /sign in to familyquest/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Parent' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Child' })).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument();
  });

  it('renders Turkish strings when the language is switched to tr', async () => {
    await act(async () => { await i18n.changeLanguage('tr'); });
    renderLogin();
    expect(screen.getByRole('heading', { name: /familyquest'e giriş yap/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Ebeveyn' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Çocuk' })).toBeInTheDocument();
    expect(screen.getByLabelText(/e-posta adresi/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /google ile giriş yap/i })).toBeInTheDocument();
  });

  it('switches from English to Turkish on an already-mounted instance', async () => {
    const { rerender } = renderLogin();
    expect(screen.getByRole('tab', { name: 'Parent' })).toBeInTheDocument();
    await act(async () => {
      await i18n.changeLanguage('tr');
      rerender(
        <MemoryRouter>
          <Login />
        </MemoryRouter>,
      );
    });
    expect(screen.getByRole('tab', { name: 'Ebeveyn' })).toBeInTheDocument();
  });
});
