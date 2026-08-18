import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../i18n/config';
import { useStore } from '../store/useStore';
import type { OnboardingDraft } from './lib/onboardingDraft';
import { FamilyComposition } from './postauth/FamilyComposition';
import { FirstTask } from './postauth/FirstTask';
import { Step7Account } from './steps/Step7Account';

// Keep the heavy setup/invite helpers out of the unit test surface.
vi.mock('./lib/onboardingSetup', () => ({
  ensureFamily: vi.fn(),
  ensureFirstChild: vi.fn(),
}));
vi.mock('../lib/inviteLink', () => ({ buildJoinUrl: vi.fn(() => 'https://example.com/join/ABC') }));

const noop = vi.fn();

function baseDraft(overrides: Partial<OnboardingDraft> = {}): OnboardingDraft {
  return {
    version: 1,
    step: 'p1',
    parentFirstName: 'Kemal',
    parentRoleDisplay: 'parent',
    childFirstName: 'Osman',
    familyName: 'Umutlu Family',
    familyId: 'family-1',
    childId: 'child-1',
    authProvider: 'google',
    firstTaskId: null,
    updatedAt: Date.now(),
    ...overrides,
  } as OnboardingDraft;
}

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('en');
  useStore.setState({
    currentUser: { id: 'u1', displayName: 'Kemal', role: 'owner', familyId: 'family-1' },
    profileServerConfirmed: true,
    profileLoading: false,
    familyData: { inviteCode: 'ABC123' },
  });
});

describe('FamilyComposition — member row role labels', () => {
  it('shows "Child" (no stray separator) and "Parent"', async () => {
    render(
      <FamilyComposition draft={baseDraft()} patch={noop} goNext={noop} deps={{} as never} />,
    );

    const childRow = (await screen.findByText('Osman')).closest('li')!;
    expect(childRow.textContent).toContain('Child');
    expect(childRow.textContent).not.toContain('·');

    const parentRow = (await screen.findByText('Kemal')).closest('li')!;
    expect(parentRow.textContent).toContain('Parent');
  });
});

describe('Step7Account — Google action matches the app Google control', () => {
  it('renders a Google-branded button (logo + neutral treatment)', () => {
    render(
      <Step7Account
        draft={baseDraft({ step: 's7' })}
        onGoogle={noop}
        onEmail={noop}
        authError={null}
        onStartOver={noop}
        onBack={noop}
      />,
    );

    const googleBtn = screen.getByRole('button', { name: /continue with google/i });
    const svg = googleBtn.querySelector('svg');
    expect(svg).toBeTruthy();
    const fills = [...(svg?.querySelectorAll('path') ?? [])].map((p) => p.getAttribute('fill'));
    expect(fills).toEqual(expect.arrayContaining(['#4285F4', '#34A853', '#FBBC05', '#EA4335']));
    // Neutral white/border treatment, not a primary-colour button.
    expect(googleBtn.className).toMatch(/bg-white/);
    expect(googleBtn.className).not.toMatch(/bg-primary-500/);
  });
});

describe('Action rows — responsive (no overflow/clipping on small viewports)', () => {
  it('P2 stacks then goes side-by-side from 400px (min-[400px]:flex-row)', () => {
    render(
      <FirstTask draft={baseDraft({ step: 'p2' })} patch={noop} goNext={noop} goBack={noop} deps={{} as never} />,
    );

    const continueBtn = screen.getByRole('button', { name: /add task & continue/i });
    const actionRow = continueBtn.closest('div')!;
    expect(actionRow.className).toMatch(/min-\[400px\]:flex-row/);
    expect(actionRow.className).toMatch(/flex-col/);
    // Both actions remain present and reachable.
    expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument();
  });

  it('P1 action row is responsive too', async () => {
    render(
      <FamilyComposition draft={baseDraft()} patch={noop} goNext={noop} deps={{} as never} />,
    );
    const skipBtn = await screen.findByRole('button', { name: /skip for now/i });
    const actionRow = skipBtn.closest('div')!;
    expect(actionRow.className).toMatch(/min-\[400px\]:flex-row/);
  });
});
