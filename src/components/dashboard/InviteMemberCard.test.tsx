import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const state = vi.hoisted(() => ({
  familyData: { id: 'f1', inviteCode: '7ZXWRZ' } as any,
}));
const navigate = vi.hoisted(() => vi.fn());
const invitationApi = vi.hoisted(() => ({
  createFamilyInvitation: vi.fn(),
}));

vi.mock('../../store/useStore', () => ({
  useStore: (selector: any) => (typeof selector === 'function' ? selector(state) : state),
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<any>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('../../lib/familyInvitationApi', () => invitationApi);

import { InviteMemberCard } from './InviteMemberCard';

const renderCard = (props: any = {}) =>
  render(
    <MemoryRouter>
      <InviteMemberCard {...props} />
    </MemoryRouter>,
  );

let writeText: ReturnType<typeof vi.fn>;

/**
 * `userEvent.setup()` installs its own clipboard stub, so the assertable one
 * is (re)attached afterwards.
 */
const setupUser = () => {
  const user = userEvent.setup();
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  });
  return user;
};

beforeEach(() => {
  vi.clearAllMocks();
  state.familyData = { id: 'f1', inviteCode: '7ZXWRZ' };
  invitationApi.createFamilyInvitation.mockResolvedValue({
    code: 'ABC123',
    intendedRole: 'parent',
    expiresAtMs: Date.now() + 1000,
  });
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  });
  // navigator.share is opt-in per test.
  delete (navigator as any).share;
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------
describe('Invite flow — initial state', () => {
  it('shows the title, subtitle and exactly three choices', () => {
    renderCard();
    expect(screen.getByRole('heading', { name: 'Invite someone' })).toBeInTheDocument();
    expect(screen.getByText('Who would you like to add?')).toBeInTheDocument();
    expect(screen.getByText('Another Parent')).toBeInTheDocument();
    expect(screen.getByText('Child with their own device')).toBeInTheDocument();
    expect(screen.getByText('Managed Child')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('shows nothing about codes, URLs, sharing or settings up front', () => {
    renderCard();
    expect(screen.queryByText('7ZXWRZ')).not.toBeInTheDocument();
    expect(screen.queryByText(/\/join\?code=/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share invitation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit invite/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Need another way to join\?/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Parent flow
// ---------------------------------------------------------------------------
describe('Invite flow — parent', () => {
  it('creates a parent invitation and replaces the dialog with the ready screen', async () => {
    const user = setupUser();
    renderCard();
    await user.click(screen.getByRole('button', { name: /Another Parent/ }));

    expect(await screen.findByText('Parent invitation ready')).toBeInTheDocument();
    expect(invitationApi.createFamilyInvitation).toHaveBeenCalledWith('parent');
    expect(
      screen.getByText('Share this invitation with the parent you want to add.'),
    ).toBeInTheDocument();
    // The role selector is gone.
    expect(screen.queryByText('Managed Child')).not.toBeInTheDocument();
    // No raw URL, no visible token, no family code.
    expect(screen.queryByText(/\/join\?code=/)).not.toBeInTheDocument();
    expect(screen.queryByText('ABC123')).not.toBeInTheDocument();
    expect(screen.queryByText('7ZXWRZ')).not.toBeInTheDocument();
  });

  it('announces success and moves focus to the success title', async () => {
    const user = setupUser();
    renderCard();
    await user.click(screen.getByRole('button', { name: /Another Parent/ }));
    const title = await screen.findByText('Parent invitation ready');
    await waitFor(() => expect(title).toHaveFocus());
    expect(screen.getByText('Invitation ready ✓')).toBeInTheDocument();
  });

  it('offers exactly two buttons plus the invite-someone-else link', async () => {
    const user = setupUser();
    renderCard();
    await user.click(screen.getByRole('button', { name: /Another Parent/ }));
    await screen.findByText('Parent invitation ready');
    expect(screen.getByRole('button', { name: 'Share invitation' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Invite someone else' })).toBeInTheDocument();
  });

  it('returns to the chooser from "Invite someone else"', async () => {
    const user = setupUser();
    renderCard();
    await user.click(screen.getByRole('button', { name: /Another Parent/ }));
    await screen.findByText('Parent invitation ready');
    await user.click(screen.getByRole('button', { name: 'Invite someone else' }));
    expect(screen.getByRole('heading', { name: 'Invite someone' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Child flow
// ---------------------------------------------------------------------------
describe('Invite flow — child', () => {
  it('creates a child invitation with child wording', async () => {
    const user = setupUser();
    renderCard();
    await user.click(screen.getByRole('button', { name: /Child with their own device/ }));

    expect(await screen.findByText('Child invitation ready')).toBeInTheDocument();
    expect(invitationApi.createFamilyInvitation).toHaveBeenCalledWith('child');
    expect(screen.getByText('Share this invitation with your child.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Managed child
// ---------------------------------------------------------------------------
describe('Invite flow — managed child', () => {
  it('never generates a link and opens the managed child creation flow', async () => {
    const onAddChild = vi.fn();
    const user = setupUser();
    renderCard({ onAddChild });
    await user.click(screen.getByRole('button', { name: /Create managed child/ }));
    expect(onAddChild).toHaveBeenCalledTimes(1);
    expect(invitationApi.createFamilyInvitation).not.toHaveBeenCalled();
  });

  it('falls back to the family page when no handler is supplied', async () => {
    const user = setupUser();
    renderCard();
    await user.click(screen.getByRole('button', { name: /Create managed child/ }));
    expect(navigate).toHaveBeenCalledWith('/family');
    expect(invitationApi.createFamilyInvitation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------
describe('Invite flow — copy', () => {
  it('copies the full role-specific URL and confirms', async () => {
    const user = setupUser();
    renderCard();
    await user.click(screen.getByRole('button', { name: /Another Parent/ }));
    await screen.findByText('Parent invitation ready');
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/join?code=ABC123`);
    expect(await screen.findByText('Copied!')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Share
// ---------------------------------------------------------------------------
describe('Invite flow — share', () => {
  it('opens the share sheet with the parent message and the role-specific URL', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    (navigator as any).share = share;
    const user = setupUser();
    renderCard();
    await user.click(screen.getByRole('button', { name: /Another Parent/ }));
    await screen.findByText('Parent invitation ready');
    await user.click(screen.getByRole('button', { name: 'Share invitation' }));
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "You've been invited to help manage a family on Queki.\nOpen the link below to join.",
        url: `${window.location.origin}/join?code=ABC123`,
      }),
    );
  });

  it('uses the child message for a child invitation', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    (navigator as any).share = share;
    const user = setupUser();
    renderCard();
    await user.click(screen.getByRole('button', { name: /Child with their own device/ }));
    await screen.findByText('Child invitation ready');
    await user.click(screen.getByRole('button', { name: 'Share invitation' }));
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "You've been invited to join your family's Queki adventure!\nOpen the link below to continue.",
      }),
    );
  });

  it('falls back to the clipboard when the platform cannot share', async () => {
    const user = setupUser();
    renderCard();
    await user.click(screen.getByRole('button', { name: /Another Parent/ }));
    await screen.findByText('Parent invitation ready');
    await user.click(screen.getByRole('button', { name: 'Share invitation' }));
    expect(writeText).toHaveBeenCalledWith(
      `You've been invited to help manage a family on Queki.\nOpen the link below to join.\n${window.location.origin}/join?code=ABC123`,
    );
  });
});

// ---------------------------------------------------------------------------
// Manual code disclosure
// ---------------------------------------------------------------------------
describe('Invite flow — manual code fallback', () => {
  it('is collapsed by default and reveals the family code when expanded', async () => {
    const user = setupUser();
    renderCard();
    await user.click(screen.getByRole('button', { name: /Another Parent/ }));
    await screen.findByText('Parent invitation ready');

    const disclosure = screen.getByRole('button', { name: 'Need another way to join?' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('7ZXWRZ')).not.toBeInTheDocument();

    await user.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Manual family code')).toBeInTheDocument();
    expect(screen.getByText('7ZXWRZ')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(writeText).toHaveBeenCalledWith('7ZXWRZ');
  });
});

// ---------------------------------------------------------------------------
// Loading + retry
// ---------------------------------------------------------------------------
describe('Invite flow — loading and retry', () => {
  it('shows a loading state while the invitation is being created', async () => {
    let resolve: (value: any) => void = () => {};
    invitationApi.createFamilyInvitation.mockImplementation(
      () => new Promise(r => { resolve = r; }),
    );
    const user = setupUser();
    renderCard();
    await user.click(screen.getByRole('button', { name: /Another Parent/ }));
    expect(await screen.findByText('Creating invitation…')).toBeInTheDocument();

    resolve({ code: 'ABC123', intendedRole: 'parent', expiresAtMs: Date.now() });
    expect(await screen.findByText('Parent invitation ready')).toBeInTheDocument();
  });

  it('reports a failure and retries the same role', async () => {
    invitationApi.createFamilyInvitation.mockRejectedValueOnce(new Error('offline'));
    const user = setupUser();
    renderCard();
    await user.click(screen.getByRole('button', { name: /Another Parent/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not create the invite link',
    );

    invitationApi.createFamilyInvitation.mockResolvedValueOnce({
      code: 'ABC123',
      intendedRole: 'parent',
      expiresAtMs: Date.now(),
    });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Parent invitation ready')).toBeInTheDocument();
    expect(invitationApi.createFamilyInvitation).toHaveBeenLastCalledWith('parent');
  });

  it('reuses the existing invitation instead of creating a second one', async () => {
    const user = setupUser();
    renderCard();
    await user.click(screen.getByRole('button', { name: /Another Parent/ }));
    await screen.findByText('Parent invitation ready');
    await user.click(screen.getByRole('button', { name: 'Invite someone else' }));
    await user.click(screen.getByRole('button', { name: /Another Parent/ }));
    await screen.findByText('Parent invitation ready');
    expect(invitationApi.createFamilyInvitation).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Mobile layout
// ---------------------------------------------------------------------------
describe('Invite flow — mobile layout', () => {
  it('stacks choices in a single column with large touch targets', () => {
    const { container } = renderCard();
    const list = container.querySelector('[data-testid="invite-choices"]')!;
    expect(list).toHaveClass('flex-col');
    for (const button of screen.getAllByRole('button')) {
      expect(button.className).toMatch(/min-h-\[44px\]/);
    }
  });

  it('keeps at most two buttons on the ready screen', async () => {
    const user = setupUser();
    renderCard();
    await user.click(screen.getByRole('button', { name: /Another Parent/ }));
    await screen.findByText('Parent invitation ready');
    const primaryActions = screen
      .getAllByRole('button')
      .filter(button => button.dataset.inviteAction === 'primary');
    expect(primaryActions).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------
describe('Invite flow — accessibility', () => {
  it('exposes the choices as keyboard-reachable buttons with descriptive labels', async () => {
    const user = setupUser();
    renderCard();
    await user.tab();
    const parent = screen.getByRole('button', { name: /Another Parent/ });
    expect(parent).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Parent invitation ready')).toBeInTheDocument();
  });

  it('announces status changes politely', async () => {
    const user = setupUser();
    renderCard();
    await user.click(screen.getByRole('button', { name: /Another Parent/ }));
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Invitation ready ✓');
  });
});

// ---------------------------------------------------------------------------
// Role integrity + join compatibility
// ---------------------------------------------------------------------------
describe('Invite flow — role integrity', () => {
  it('never encodes the role in the shared URL', async () => {
    const user = setupUser();
    renderCard();
    await user.click(screen.getByRole('button', { name: /Child with their own device/ }));
    await screen.findByText('Child invitation ready');
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    const url = writeText.mock.calls[0][0] as string;
    expect(url).toBe(`${window.location.origin}/join?code=ABC123`);
    expect(url).not.toMatch(/role/i);
  });

  it('produces a URL the existing /join route can consume', async () => {
    const user = setupUser();
    renderCard();
    await user.click(screen.getByRole('button', { name: /Another Parent/ }));
    await screen.findByText('Parent invitation ready');
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    const url = new URL(writeText.mock.calls[0][0] as string);
    expect(url.pathname).toBe('/join');
    expect(url.searchParams.get('code')).toBe('ABC123');
  });
});
