import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n/config';
import enAuth from '../i18n/locales/en/auth.json';
import trAuth from '../i18n/locales/tr/auth.json';

const mockNavigate = vi.fn();
const mockCreateManagedMember = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

// Fully mock the api module so we never load firebase.ts in the test env.
vi.mock('../lib/api', () => ({
  createManagedMember: (...args: any[]) => mockCreateManagedMember(...args),
}));

// Reuse the real child-login dialog contract but stub the firebase callable so
// the flow can be exercised without a backend.
vi.mock('../components/family/CreateChildLoginDialog', () => ({
  CreateChildLoginDialog: ({ member, onClose, onSuccess }: any) => (
    <div>
      <span>login-dialog-for-{member?.displayName}</span>
      <button type="button" onClick={() => onSuccess(member?.displayName)}>success</button>
      <button type="button" onClick={onClose}>close</button>
    </div>
  ),
}));

const storeState = {
  currentUser: { uid: 'p1', familyId: 'fam1', role: 'parent' },
  familyMembers: [] as any[],
  appReady: true,
};

vi.mock('../store/useStore', () => ({
  useStore: (selector: any) => selector(storeState),
}));

import { ChildOnboarding } from './ChildOnboarding';

// The production app loads the `auth` namespace lazily; load it for this test
// only and clean it up afterwards so we don't affect the global i18n singleton
// (e.g. the "auth is not preloaded" assertion in i18n.test.ts).
beforeAll(() => {
  i18n.addResourceBundle('en', 'auth', enAuth as object, true, true);
  i18n.addResourceBundle('tr', 'auth', trAuth as object, true, true);
});

afterAll(() => {
  i18n.removeResourceBundle('en', 'auth');
  i18n.removeResourceBundle('tr', 'auth');
});

const FAMILY_ID = 'fam1';

async function createFirstChild(user: ReturnType<typeof userEvent.setup>, name = 'Milo') {
  await user.click(screen.getByText('Add my first child'));
  const nameInput = screen.getByLabelText('Name');
  await user.type(nameInput, name);
  await user.click(screen.getByText('Create child'));
  // Wait for the success step.
  await screen.findByText('Child created!');
}

beforeEach(() => {
  localStorage.clear();
  mockNavigate.mockReset();
  mockCreateManagedMember.mockReset();
  mockCreateManagedMember.mockResolvedValue('child-1');
});

describe('ChildOnboarding flow', () => {
  it('shows the welcome screen on first login with zero children', () => {
    render(<ChildOnboarding />);
    expect(screen.getByText('Welcome to FamilyQuest')).toBeInTheDocument();
    expect(screen.getByText('Add my first child')).toBeInTheDocument();
  });

  it('advances from welcome to the create-child form', async () => {
    const user = userEvent.setup();
    render(<ChildOnboarding />);
    await user.click(screen.getByText('Add my first child'));
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByText('Add your child')).toBeInTheDocument();
  });

  it('validates that a name is required (no duplicate child records)', async () => {
    const user = userEvent.setup();
    render(<ChildOnboarding />);
    await user.click(screen.getByText('Add my first child'));
    const nameInput = screen.getByLabelText('Name');
    // Whitespace-only satisfies the native `required` check, so the form submits
    // and our JS validation (trim) catches the empty name.
    await user.type(nameInput, '   ');
    await user.click(screen.getByText('Create child'));
    expect(await screen.findByText('Please enter a name.')).toBeInTheDocument();
    expect(mockCreateManagedMember).not.toHaveBeenCalled();
  });

  it('creates a child and reuses the existing creation model', async () => {
    const user = userEvent.setup();
    render(<ChildOnboarding />);
    await createFirstChild(user);
    expect(mockCreateManagedMember).toHaveBeenCalledTimes(1);
    expect(mockCreateManagedMember).toHaveBeenCalledWith('fam1', 'child', 'Milo', {
      dob: null,
      avatarId: null,
      colour: null,
    });
    expect(screen.getByText("Milo has been added to your family.")).toBeInTheDocument();
  });

  it('skips login and continues to the quick-start step', async () => {
    const user = userEvent.setup();
    render(<ChildOnboarding />);
    await createFirstChild(user);
    await user.click(screen.getByText('Skip for now'));
    expect(await screen.findByText('Create your first task')).toBeInTheDocument();
  });

  it('creates a login by reusing the existing Child Login dialog', async () => {
    const user = userEvent.setup();
    render(<ChildOnboarding />);
    await createFirstChild(user);
    await user.click(screen.getByText('Create Login'));
    expect(await screen.findByText('login-dialog-for-Milo')).toBeInTheDocument();
    await user.click(screen.getByText('success'));
    expect(await screen.findByText('Create your first task')).toBeInTheDocument();
  });

  it('skips the task step and offers rewards', async () => {
    const user = userEvent.setup();
    render(<ChildOnboarding />);
    await createFirstChild(user);
    await user.click(screen.getByText('Skip for now'));
    await user.click(screen.getByText('Skip'));
    expect(await screen.findByText('Create your first reward')).toBeInTheDocument();
  });

  it('skips the reward step and reaches the finish screen', async () => {
    const user = userEvent.setup();
    render(<ChildOnboarding />);
    await createFirstChild(user);
    await user.click(screen.getByText('Skip for now'));
    await user.click(screen.getByText('Skip'));
    await user.click(screen.getByText('Skip'));
    expect(await screen.findByText("You're ready to start using FamilyQuest")).toBeInTheDocument();
  });

  it('finishes onboarding and navigates to the dashboard', async () => {
    const user = userEvent.setup();
    render(<ChildOnboarding />);
    await createFirstChild(user);
    await user.click(screen.getByText('Skip for now'));
    await user.click(screen.getByText('Skip'));
    await user.click(screen.getByText('Skip'));
    await user.click(screen.getByText('Go to Dashboard'));
    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('offers to create the first task and navigates to /tasks', async () => {
    const user = userEvent.setup();
    render(<ChildOnboarding />);
    await createFirstChild(user);
    await user.click(screen.getByText('Skip for now'));
    await user.click(screen.getByText('Create first task'));
    expect(mockNavigate).toHaveBeenCalledWith('/tasks');
  });

  it('offers to create the first reward and navigates to /rewards', async () => {
    const user = userEvent.setup();
    render(<ChildOnboarding />);
    await createFirstChild(user);
    await user.click(screen.getByText('Skip for now'));
    await user.click(screen.getByText('Skip'));
    await user.click(screen.getByText('Create first reward'));
    expect(mockNavigate).toHaveBeenCalledWith('/rewards');
  });

  it('resumes at the persisted step after a refresh', () => {
    localStorage.setItem(`fq:childOnboarding:${FAMILY_ID}:step`, '2');
    render(<ChildOnboarding />);
    // Resumes directly on the create-child form (step 2), not the welcome screen.
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.queryByText('Add my first child')).not.toBeInTheDocument();
  });

  it('renders a responsive, mobile-friendly centered card', () => {
    const { container } = render(<ChildOnboarding />);
    expect(container.querySelector('[class*="min-h-screen"]')).toBeInTheDocument();
    expect(container.querySelector('[class*="max-w-md"]')).toBeInTheDocument();
  });
});
