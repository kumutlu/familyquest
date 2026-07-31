import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Any accidental backend usage must be observable.
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

beforeEach(async () => {
  apiMocks.signIn.mockClear();
  childApiMocks.signInChild.mockClear();
  fetchSpy.mockClear();
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

describe('JoinFamily — child join page', () => {
  it('renders heading, description and all four fields', () => {
    renderJoin();
    expect(screen.getByRole('heading', { name: /join your family/i })).toBeInTheDocument();
    expect(screen.getByText(/enter the family code your parent gave you/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/family code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^username$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/create password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).toBeInTheDocument();
  });

  it('validates required fields', async () => {
    const user = userEvent.setup();
    renderJoin();
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/fill in all the fields/i);
  });

  it('shows an error when the password confirmation does not match', async () => {
    const user = userEvent.setup();
    renderJoin();
    await fillForm(user, 'secret123', 'different');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/passwords do not match/i);
    expect(screen.queryByText(/parent approval required/i)).not.toBeInTheDocument();
  });

  it('Continue shows the parent-approval informational screen', async () => {
    const user = userEvent.setup();
    renderJoin();
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(await screen.findByRole('heading', { name: /parent approval required/i })).toBeInTheDocument();
    expect(
      screen.getByText(/a parent will need to approve your request before you can join the family/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back to sign in/i })).toBeInTheDocument();
  });

  it('performs no backend request or membership write', async () => {
    const user = userEvent.setup();
    renderJoin();
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(await screen.findByRole('heading', { name: /parent approval required/i })).toBeInTheDocument();
    expect(childApiMocks.signInChild).not.toHaveBeenCalled();
    expect(apiMocks.signIn).not.toHaveBeenCalled();
    expect(apiMocks.signInWithGoogle).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Back to sign in returns to the login page', async () => {
    const user = userEvent.setup();
    renderJoin();
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(await screen.findByRole('button', { name: /back to sign in/i }));
    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });

  it('renders Turkish copy when the language is Turkish', async () => {
    await act(async () => { await i18n.changeLanguage('tr'); });
    renderJoin();
    expect(screen.getByRole('heading', { name: 'Ailene katıl' })).toBeInTheDocument();
    expect(screen.getByText('Ebeveyninin sana verdiği Aile Kodunu gir.')).toBeInTheDocument();
    expect(screen.getByLabelText('Aile Kodu')).toBeInTheDocument();
    expect(screen.getByLabelText('Şifre Oluştur')).toBeInTheDocument();
    expect(screen.getByLabelText('Şifreyi Onayla')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Devam et' })).toBeInTheDocument();
  });
});
