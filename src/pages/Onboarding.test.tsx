import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../i18n/config';

// Mock the API functions used by Onboarding
const apiMocks = vi.hoisted(() => ({
  createFamilyAndParent: vi.fn(async () => ({
    familyId: 'fam-123',
    inviteCode: 'ABC123',
    user: { id: 'user-123', uid: 'user-123', familyId: 'fam-123', role: 'owner', displayName: 'Test User' },
  })),
  createManagedMember: vi.fn(async () => 'member-123'),
  signOut: vi.fn(async () => {}),
}));
vi.mock('../lib/api', () => ({
  createFamilyAndParent: apiMocks.createFamilyAndParent,
  createManagedMember: apiMocks.createManagedMember,
  signOut: apiMocks.signOut,
}));

// Mock navigate at the top level
const navigateMock = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: () => navigateMock,
}));

// Mock the store with a parent user (no familyId)
const storeMocks = vi.hoisted(() => ({
  refreshCurrentUser: vi.fn(),
  currentUser: { uid: 'user-123', displayName: 'Test User', role: 'parent' },
  authStatus: 'authenticated',
}));
vi.mock('../store/useStore', () => ({
  useStore: (selector: any) => selector(storeMocks),
}));

import { Onboarding } from './Onboarding';

function renderOnboarding() {
  return render(
    <MemoryRouter>
      <Onboarding />
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  apiMocks.createFamilyAndParent.mockReset().mockResolvedValue({
    familyId: 'fam-123',
    inviteCode: 'ABC123',
    user: { id: 'user-123', uid: 'user-123', familyId: 'fam-123', role: 'owner', displayName: 'Test User' },
  });
  apiMocks.createManagedMember.mockReset().mockResolvedValue('member-123');
  apiMocks.signOut.mockClear();
  storeMocks.refreshCurrentUser.mockClear();
  navigateMock.mockClear();
  await i18n.loadNamespaces(['auth', 'common']);
  await act(async () => { await i18n.changeLanguage('en'); });
});

afterEach(async () => {
  await act(async () => { await i18n.changeLanguage('en'); });
});

describe('Onboarding — Finish Setup flow', () => {
  it('successful Finish Setup updates the parent user to owner', async () => {
    const user = userEvent.setup();
    renderOnboarding();

    // Step 1: Create family
    await user.click(screen.getByRole('button', { name: /i'm a parent \(create family\)/i }));
    const familyNameInput = screen.getByPlaceholderText(/e\.g\., the smiths/i);
    await user.type(familyNameInput, 'Test Family');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => expect(apiMocks.createFamilyAndParent).toHaveBeenCalled());

    // Step 2: Add a member
    const memberNameInput = screen.getByPlaceholderText(/name/i);
    await user.type(memberNameInput, 'Child One');
    await user.click(screen.getByRole('button', { name: '' })); // Plus button

    // Step 3: Continue to invite code
    await user.click(screen.getByRole('button', { name: /continue to invite code/i }));

    // Step 3: Finish Setup
    await user.click(screen.getByRole('button', { name: /finish setup/i }));

    await waitFor(() => expect(storeMocks.refreshCurrentUser).toHaveBeenCalledWith(
      'user-123',
      { familyId: 'fam-123', role: 'owner' },
    ));
  });

  it('successful Finish Setup navigates to dashboard', async () => {
    const user = userEvent.setup();
    renderOnboarding();

    // Step 1: Create family
    await user.click(screen.getByRole('button', { name: /i'm a parent \(create family\)/i }));
    const familyNameInput = screen.getByPlaceholderText(/e\.g\., the smiths/i);
    await user.type(familyNameInput, 'Test Family');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Step 2: Add a member
    const memberNameInput = screen.getByPlaceholderText(/name/i);
    await user.type(memberNameInput, 'Child One');
    await user.click(screen.getByRole('button', { name: '' })); // Plus button

    // Step 3: Continue to invite code
    await user.click(screen.getByRole('button', { name: /continue to invite code/i }));

    // Step 3: Finish Setup
    await user.click(screen.getByRole('button', { name: /finish setup/i }));

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/'));
  });

  it('failed Finish Setup preserves the current wizard state and shows the error', async () => {
    const user = userEvent.setup();
    apiMocks.createManagedMember.mockRejectedValue(new Error('Failed to create member'));

    renderOnboarding();

    // Step 1: Create family
    await user.click(screen.getByRole('button', { name: /i'm a parent \(create family\)/i }));
    const familyNameInput = screen.getByPlaceholderText(/e\.g\., the smiths/i);
    await user.type(familyNameInput, 'Test Family');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Step 2: Add a member
    const memberNameInput = screen.getByPlaceholderText(/name/i);
    await user.type(memberNameInput, 'Child One');
    await user.click(screen.getByRole('button', { name: '' })); // Plus button

    // Step 3: Continue to invite code
    await user.click(screen.getByRole('button', { name: /continue to invite code/i }));

    // Step 3: Finish Setup (should fail)
    await user.click(screen.getByRole('button', { name: /finish setup/i }));

    // Error should be shown
    await waitFor(() => expect(screen.getByText(/failed to create member/i)).toBeInTheDocument());

    // Should still be on step 3 (invite code screen)
    expect(screen.getByRole('heading', { name: /invite others to join/i })).toBeInTheDocument();
    expect(screen.getByText(/your invite code/i)).toBeInTheDocument();
  });

  it('Finish Setup creates managed members after family ownership is established', async () => {
    const user = userEvent.setup();
    renderOnboarding();

    // Step 1: Create family
    await user.click(screen.getByRole('button', { name: /i'm a parent \(create family\)/i }));
    const familyNameInput = screen.getByPlaceholderText(/e\.g\., the smiths/i);
    await user.type(familyNameInput, 'Test Family');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Step 2: Add two members
    const memberNameInput = screen.getByPlaceholderText(/name/i);
    await user.type(memberNameInput, 'Child One');
    await user.click(screen.getByRole('button', { name: '' })); // Plus button

    await user.type(memberNameInput, 'Child Two');
    await user.click(screen.getByRole('button', { name: '' })); // Plus button

    // Step 3: Continue to invite code
    await user.click(screen.getByRole('button', { name: /continue to invite code/i }));

    // Step 3: Finish Setup
    await user.click(screen.getByRole('button', { name: /finish setup/i }));

    await waitFor(() => {
      expect(apiMocks.createManagedMember).toHaveBeenCalledTimes(2);
      expect(apiMocks.createManagedMember).toHaveBeenCalledWith('fam-123', 'child', 'Child One');
      expect(apiMocks.createManagedMember).toHaveBeenCalledWith('fam-123', 'child', 'Child Two');
    });
  });

  it('family creation refreshes the store with the authoritative owner profile before Finish Setup', async () => {
    const user = userEvent.setup();
    renderOnboarding();

    // Step 1: Create family
    await user.click(screen.getByRole('button', { name: /i'm a parent \(create family\)/i }));
    const familyNameInput = screen.getByPlaceholderText(/e\.g\., the smiths/i);
    await user.type(familyNameInput, 'Test Family');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => {
      expect(storeMocks.refreshCurrentUser).toHaveBeenCalledWith(
        'user-123',
        { familyId: 'fam-123', role: 'owner' },
      );
    });

    // Step 2: Add a member
    const memberNameInput = screen.getByPlaceholderText(/name/i);
    await user.type(memberNameInput, 'Child One');
    await user.click(screen.getByRole('button', { name: '' })); // Plus button

    // Step 3: Continue to invite code
    await user.click(screen.getByRole('button', { name: /continue to invite code/i }));

    // Step 3: Finish Setup
    await user.click(screen.getByRole('button', { name: /finish setup/i }));

    await waitFor(() => {
      expect(storeMocks.refreshCurrentUser).toHaveBeenCalledWith('user-123', { familyId: 'fam-123', role: 'owner' });
    });
  });
});

describe('Onboarding — Create flow', () => {
  it('renders the select screen with create and join options', () => {
    renderOnboarding();
    expect(screen.getByRole('heading', { name: /welcome to familyquest/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /i'm a parent \(create family\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /i have an invite \/ claim code/i })).toBeInTheDocument();
  });

  it('shows step 1 when create family is selected', async () => {
    const user = userEvent.setup();
    renderOnboarding();
    await user.click(screen.getByRole('button', { name: /i'm a parent \(create family\)/i }));
    expect(screen.getByRole('heading', { name: /name your family/i })).toBeInTheDocument();
    expect(screen.getByText(/step 1 of 3/i)).toBeInTheDocument();
  });

  it('shows step 2 after family is created', async () => {
    const user = userEvent.setup();
    renderOnboarding();
    await user.click(screen.getByRole('button', { name: /i'm a parent \(create family\)/i }));
    const familyNameInput = screen.getByPlaceholderText(/e\.g\., the smiths/i);
    await user.type(familyNameInput, 'Test Family');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => expect(screen.getByRole('heading', { name: /add family members/i })).toBeInTheDocument());
    expect(screen.getByText(/step 2 of 3/i)).toBeInTheDocument();
  });

  it('shows step 3 after adding members', async () => {
    const user = userEvent.setup();
    renderOnboarding();
    await user.click(screen.getByRole('button', { name: /i'm a parent \(create family\)/i }));
    const familyNameInput = screen.getByPlaceholderText(/e\.g\., the smiths/i);
    await user.type(familyNameInput, 'Test Family');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    const memberNameInput = screen.getByPlaceholderText(/name/i);
    await user.type(memberNameInput, 'Child One');
    await user.click(screen.getByRole('button', { name: '' })); // Plus button

    await user.click(screen.getByRole('button', { name: /continue to invite code/i }));

    expect(screen.getByRole('heading', { name: /invite others to join/i })).toBeInTheDocument();
    expect(screen.getByText(/step 3 of 3/i)).toBeInTheDocument();
  });
});

describe('Onboarding — Join flow', () => {
  it('shows join form when join option is selected', async () => {
    const user = userEvent.setup();
    renderOnboarding();
    await user.click(screen.getByRole('button', { name: /i have an invite \/ claim code/i }));
    // Use placeholder text since the label is not properly associated with the input
    expect(screen.getByPlaceholderText(/e\.g\., a1b2c3/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /request to join/i })).toBeInTheDocument();
  });
});

describe('Onboarding — i18n', () => {
  it('renders Turkish strings when language is switched', async () => {
    await act(async () => { await i18n.changeLanguage('tr'); });
    renderOnboarding();
    expect(screen.getByRole('heading', { name: /familyquest'e hoş geldiniz/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ebeveynim \(aile oluştur\)/i })).toBeInTheDocument();
  });
});
