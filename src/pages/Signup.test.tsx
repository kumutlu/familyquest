import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../i18n/config';

const apiMocks = vi.hoisted(() => ({
  signUp: vi.fn(async () => ({ user: {} })),
}));
vi.mock('../lib/api', () => ({
  signUp: apiMocks.signUp,
}));

import { Signup } from './Signup';

function renderSignup() {
  return render(
    <MemoryRouter>
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
  apiMocks.signUp.mockClear();
  await i18n.loadNamespaces(['auth']);
  await act(async () => { await i18n.changeLanguage('en'); });
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
