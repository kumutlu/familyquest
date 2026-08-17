import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../src/i18n/config';

/**
 * Success-button accessibility — dedicated contrast regression test.
 *
 * Production defect: solid success *action* buttons (Approve / Accept / the
 * positive behaviour "Log event" / the wallet "Add" confirm) were painted with
 * `bg-success-500` and white text. White on `#22c55e` (success-500) only reaches
 * ~2.28:1 — far below WCAG AA (4.5:1) for normal text — so the labels were
 * effectively unreadable for low-vision users.
 *
 * The dark-theme regression scan (`darkSemanticSurfaces.test.ts`) deliberately
 * excludes intentional solid brand fills, so this dedicated test owns the
 * solid-success-button contrast contract (per the approved separation of
 * concerns). It proves two things:
 *
 *   1. White text on the *final* solid-success background (`success-700`) clears
 *      WCAG AA (≥ 4.5:1) in BOTH light and dark themes, and the hover shade
 *      (`success-800`) is at least as readable.
 *   2. The real Approve / Accept components actually render with the accessible
 *      `bg-success-700 text-white` style (and no longer `bg-success-500`).
 */

const api = vi.hoisted(() => ({
  approveTaskCompletion: vi.fn(),
  rejectTaskCompletion: vi.fn(),
  approveTransferRequest: vi.fn(),
  rejectTransferRequest: vi.fn(),
  approveMoneyRequest: vi.fn(),
  rejectMoneyRequest: vi.fn(),
  acceptMoneyRequest: vi.fn(),
  approvePetBoxDonation: vi.fn(),
  rejectPetBoxDonation: vi.fn(),
  approveProfileUpdateRequest: vi.fn(),
  rejectProfileUpdateRequest: vi.fn(),
  cancelPendingApproval: vi.fn(),
  mapApprovalError: vi.fn((err: any) => ({ message: err?.message ?? 'error', code: err?.code })),
}));

const state = vi.hoisted(() => ({ current: {} as any }));

vi.mock('../../src/lib/api', () => api);
vi.mock('../../src/store/useStore', () => ({
  useStore: (selector?: any) => (typeof selector === 'function' ? selector(state.current) : state.current),
}));

import { ApprovalCenter } from '../../src/components/parent/ApprovalCenter';
import { RequestDetailProvider } from '../../src/components/requests/RequestDetailContext';
import { contrastRatio, resolveToken, type Rgb } from './themeTokens';

const WHITE: Rgb = [255, 255, 255];
/** WCAG AA contrast for normal-size text. */
const MIN_TEXT_CONTRAST = 4.5;

const moneyRequestPendingAcceptance = {
  id: 'mr-1',
  category: 'money_request',
  requesterId: 'child-1',
  requesterName: 'Mnalium',
  requestedFromId: 'owner-1',
  requestedFromName: 'Kemal',
  requestedFromRole: 'parent',
  amountPence: 556,
  message: 'Can I put this on my card',
  status: 'pending_acceptance',
  createdAt: { toDate: () => new Date('2026-07-15T14:24:00Z') },
};

function renderApprovalCenter() {
  return render(
    <RequestDetailProvider>
      <ApprovalCenter />
    </RequestDetailProvider>,
  );
}

describe('success-button contrast (WCAG AA)', () => {
  it('white text on the solid-success background clears AA in light and dark', () => {
    for (const mode of ['light', 'dark'] as const) {
      const resting = resolveToken('success-700', mode);
      const hover = resolveToken('success-800', mode);
      expect(resting, `success-700 missing for ${mode} mode`).not.toBeNull();
      expect(hover, `success-800 missing for ${mode} mode`).not.toBeNull();
      expect(
        contrastRatio(WHITE, resting as Rgb),
        `white on success-700 in ${mode} mode`,
      ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      expect(
        contrastRatio(WHITE, hover as Rgb),
        `white on success-800 (hover) in ${mode} mode`,
      ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    }
  });

  it('regression guard: the old success-500 / success-600 shades were NOT accessible', () => {
    // Documents *why* we moved to success-700 and prevents a future "simplify to
    // success-600" change from silently reintroducing the defect.
    expect(contrastRatio(WHITE, resolveToken('success-500', 'light') as Rgb)).toBeLessThan(
      MIN_TEXT_CONTRAST,
    );
    expect(contrastRatio(WHITE, resolveToken('success-600', 'light') as Rgb)).toBeLessThan(
      MIN_TEXT_CONTRAST,
    );
  });
});

describe('ApprovalCenter — Approve / Accept use the accessible success style', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.loadNamespaces(['approvals', 'requests', 'common']);
    await i18n.changeLanguage('en');
    state.current = {
      currentUser: { id: 'owner-1', familyId: 'family-1', role: 'owner' },
      tasks: [{ id: 'task-1', title: 'Tidy room', pointsReward: 10 }],
      familyMembers: [{ id: 'child-1', displayName: 'Ada' }],
      taskCompletions: [{ id: 'tc-1', taskId: 'task-1', assigneeId: 'child-1', status: 'pending_approval' }],
      transferRequests: [],
      moneyRequests: [moneyRequestPendingAcceptance],
      petboxRequests: [],
      profileUpdateRequests: [],
      familyData: { currency: '£' },
      rewards: [],
    };
  });

  it('renders Approve and Accept with bg-success-700 text-white (never bg-success-500)', () => {
    renderApprovalCenter();

    const approve = screen.getByRole('button', { name: 'Approve' });
    const accept = screen.getByRole('button', { name: 'Accept' });

    for (const button of [approve, accept]) {
      expect(button.className, `button className: ${button.className}`).toContain('bg-success-700');
      expect(button.className, `button className: ${button.className}`).toContain('text-white');
      expect(button.className, `button className: ${button.className}`).not.toContain('bg-success-500');
      // Hover/active hierarchy preserved on the same token scale.
      expect(button.className).toContain('hover:bg-success-800');
      expect(button.className).toContain('active:bg-success-900');
    }
  });
});
