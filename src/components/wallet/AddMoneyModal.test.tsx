import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mockUser = { id: 'parent-1', familyId: 'fam-1', role: 'owner' };
const mockChild = { id: 'child-1', displayName: 'Alin Asya', walletBalance: 0 };

const { depositToWallet, withdrawFromWallet } = vi.hoisted(() => ({
  depositToWallet: vi.fn(),
  withdrawFromWallet: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  depositToWallet: (...args: any[]) => depositToWallet(...args),
  withdrawFromWallet: (...args: any[]) => withdrawFromWallet(...args),
}));

vi.mock('../../store/useStore', () => ({
  useStore: () => ({ currentUser: mockUser }),
}));

import { AddMoneyModal } from './AddMoneyModal';

function renderModal(props: any = {}) {
  const onClose = vi.fn();
  const utils = render(<AddMoneyModal child={mockChild} onClose={onClose} {...props} />);
  return { onClose, ...utils };
}

function getSubmitButton() {
  return screen.getByTestId('manage-wallet-submit') as HTMLButtonElement;
}

beforeEach(() => {
  depositToWallet.mockReset();
  withdrawFromWallet.mockReset();
  depositToWallet.mockResolvedValue(undefined);
  withdrawFromWallet.mockResolvedValue(undefined);
});

describe('AddMoneyModal — Manage Wallet modal', () => {
  it('1. renders the modal title as "Manage <name>\'s Wallet" (not "Add Money")', () => {
    renderModal();
    const heading = screen.getByRole('heading', { name: /Manage Alin Asya's Wallet/ });
    expect(heading).toBeInTheDocument();
    // The misleading "Wallet: <name>" / "Add Money" action label must not be present.
    expect(screen.queryByText(/^Wallet: /)).not.toBeInTheDocument();
  });

  it('3. Add Money tab renders and is selected by default', () => {
    renderModal();
    const addTab = screen.getByRole('tab', { name: 'Add Money' });
    const withdrawTab = screen.getByRole('tab', { name: 'Withdraw' });
    expect(addTab).toHaveAttribute('aria-selected', 'true');
    expect(withdrawTab).toHaveAttribute('aria-selected', 'false');
  });

  it('4. Withdraw tab renders and becomes selected when clicked', () => {
    renderModal();
    const withdrawTab = screen.getByRole('tab', { name: 'Withdraw' });
    fireEvent.click(withdrawTab);
    expect(withdrawTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Add Money' })).toHaveAttribute('aria-selected', 'false');
  });

  it('5. submit button always has visible text (never blank)', () => {
    renderModal();
    const submit = getSubmitButton();
    expect(submit.textContent).toBeTruthy();
    expect(submit.textContent!.trim().length).toBeGreaterThan(0);
    expect(submit).toHaveAccessibleName();
  });

  it('6. submit button never renders an empty accessible name', () => {
    renderModal();
    const submit = getSubmitButton();
    expect(submit).toHaveAccessibleName();
    const name = (submit.getAttribute('aria-label') ?? submit.textContent ?? '').trim();
    expect(name.length).toBeGreaterThan(0);
  });

  it('7. Add mode shows "Add Money" then "Add £<amount>"', () => {
    renderModal();
    const submit = getSubmitButton();
    expect(submit.textContent).toBe('Add Money');

    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '10' } });
    expect(submit.textContent).toBe('Add £10.00');

    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '5.5' } });
    expect(submit.textContent).toBe('Add £5.50');
  });

  it('8. Withdraw mode shows "Withdraw Money" then "Withdraw £<amount>"', () => {
    renderModal();
    fireEvent.click(screen.getByRole('tab', { name: 'Withdraw' }));
    const submit = getSubmitButton();
    expect(submit.textContent).toBe('Withdraw Money');

    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '5' } });
    expect(submit.textContent).toBe('Withdraw £5.00');
  });

  it('9. disabled (submitting) button keeps a visible label', async () => {
    depositToWallet.mockImplementation(() => new Promise(() => {}));
    renderModal();
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '10' } });
    fireEvent.click(getSubmitButton());

    const submit = getSubmitButton();
    await waitFor(() => expect(submit).toBeDisabled());
    // Must not look like an empty white box — label remains visible.
    expect(submit.textContent).toBe('Adding...');
    expect(submit).toHaveAccessibleName();
  });

  it('10. loading state shows "Adding..." in add mode and "Withdrawing..." in withdraw mode', async () => {
    depositToWallet.mockImplementation(() => new Promise(() => {}));
    withdrawFromWallet.mockImplementation(() => new Promise(() => {}));

    // Add mode
    const { unmount } = renderModal();
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '10' } });
    fireEvent.click(getSubmitButton());
    await waitFor(() => expect(getSubmitButton().textContent).toBe('Adding...'));
    unmount();

    // Withdraw mode
    renderModal();
    fireEvent.click(screen.getByRole('tab', { name: 'Withdraw' }));
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '5' } });
    fireEvent.click(getSubmitButton());
    await waitFor(() => expect(getSubmitButton().textContent).toBe('Withdrawing...'));
  });

  it('11. existing deposit handler is invoked unchanged with correct args', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/Note/), { target: { value: 'Pocket money' } });
    fireEvent.click(getSubmitButton());

    await waitFor(() => expect(depositToWallet).toHaveBeenCalledTimes(1));
    expect(depositToWallet).toHaveBeenCalledWith('fam-1', 'child-1', 'parent-1', 1000, 'Pocket money');
  });

  it('12. existing withdrawal handler is invoked unchanged with correct args', async () => {
    renderModal();
    fireEvent.click(screen.getByRole('tab', { name: 'Withdraw' }));
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(/Note/), { target: { value: 'Cash' } });
    fireEvent.click(getSubmitButton());

    await waitFor(() => expect(withdrawFromWallet).toHaveBeenCalledTimes(1));
    expect(withdrawFromWallet).toHaveBeenCalledWith('fam-1', 'child-1', 'parent-1', 500, 'Cash');
  });

  it('13. mobile layout: bottom-sheet overlay, capped height, and visible footer actions', () => {
    renderModal();
    const overlay = screen.getByTestId('manage-wallet-overlay');
    const dialog = screen.getByTestId('manage-wallet-dialog');
    const footer = screen.getByTestId('manage-wallet-footer');

    // Mobile: anchored to the bottom; desktop: centred (sm:items-center).
    expect(overlay.className).toContain('items-end');
    expect(overlay.className).toContain('sm:items-center');
    // Height is capped to the viewport so the footer never overflows off-screen.
    expect(dialog.className).toContain('max-h-[90dvh]');
    // Footer actions remain present and visible.
    expect(footer).toBeInTheDocument();
    expect(within(footer).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(within(footer).getByTestId('manage-wallet-submit')).toBeInTheDocument();
  });
});
