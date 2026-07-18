import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';

// Mutable store + API mock shared across tests.
const { mockStore, createTransferRequest } = vi.hoisted(() => ({
  mockStore: {
    currentUser: { id: 'child-1', familyId: 'family-1', role: 'child', displayName: 'Child One' },
    familyMembers: [] as any[],
    myWallet: { balance: 1000 }, // £10.00
  },
  createTransferRequest: vi.fn(),
}));

vi.mock('../../store/useStore', () => ({
  useStore: () => mockStore,
}));
vi.mock('../../lib/api', () => ({
  createTransferRequest: (...args: any[]) => createTransferRequest(...args),
}));

import { SendMoneyModal } from './SendMoneyModal';

function renderModal(props: any = {}) {
  const onClose = vi.fn();
  const onSuccess = vi.fn();
  const utils = render(<SendMoneyModal onClose={onClose} onSuccess={onSuccess} {...props} />);
  return { onClose, onSuccess, ...utils };
}

function setChildContext(overrides: any = {}) {
  mockStore.currentUser = {
    id: 'child-1',
    familyId: 'family-1',
    role: 'child',
    displayName: 'Child One',
    ...overrides,
  };
}

function fillForm(recipientValue: string, amountValue: string, noteValue = '') {
  fireEvent.change(screen.getByLabelText('To'), { target: { value: recipientValue } });
  fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: amountValue } });
  if (noteValue) fireEvent.change(screen.getByLabelText(/note/i), { target: { value: noteValue } });
}

function submitForm() {
  fireEvent.submit(screen.getByTestId('send-money-form'));
}

beforeEach(() => {
  createTransferRequest.mockReset();
  setChildContext();
  mockStore.familyMembers = [];
  mockStore.myWallet = { balance: 1000 };
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
});

describe('SendMoneyModal — recipient list', () => {
  it('excludes the current child from recipients', () => {
    mockStore.familyMembers = [
      { id: 'child-1', familyId: 'family-1', role: 'child', displayName: 'Child One' },
      { id: 'child-2', familyId: 'family-1', role: 'child', displayName: 'Child Two' },
    ];
    renderModal();
    const select = screen.getByLabelText('To') as HTMLSelectElement;
    const values = Array.from(select.options).map(o => o.value);
    expect(values).toContain('child-2');
    expect(values).not.toContain('child-1');
  });

  it('excludes parent and owner accounts', () => {
    mockStore.familyMembers = [
      { id: 'child-2', familyId: 'family-1', role: 'child', displayName: 'Child Two' },
      { id: 'parent-1', familyId: 'family-1', role: 'parent', displayName: 'Parent' },
      { id: 'owner-1', familyId: 'family-1', role: 'owner', displayName: 'Owner' },
    ];
    renderModal();
    const select = screen.getByLabelText('To') as HTMLSelectElement;
    const names = Array.from(select.options).map(o => o.textContent);
    expect(names).toContain('Child Two');
    expect(names).not.toContain('Parent');
    expect(names).not.toContain('Owner');
  });

  it('lists only active children in the same family', () => {
    mockStore.familyMembers = [
      { id: 'child-2', familyId: 'family-1', role: 'child', displayName: 'Same Family Active' },
      { id: 'child-3', familyId: 'family-2', role: 'child', displayName: 'Other Family' },
      { id: 'child-4', familyId: 'family-1', role: 'child', displayName: 'Inactive', isActive: false },
    ];
    renderModal();
    const select = screen.getByLabelText('To') as HTMLSelectElement;
    const names = Array.from(select.options).map(o => o.textContent);
    expect(names).toContain('Same Family Active');
    expect(names).not.toContain('Other Family');
    expect(names).not.toContain('Inactive');
  });

  it('shows a friendly empty state when there is no eligible recipient', () => {
    mockStore.familyMembers = [{ id: 'child-1', familyId: 'family-1', role: 'child', displayName: 'Child One' }];
    renderModal();
    expect(screen.getByText('No other children in this family yet.')).toBeInTheDocument();
    expect(screen.getByTestId('send-money-submit')).toBeDisabled();
  });
});

describe('SendMoneyModal — submission', () => {
  it('calls the existing transfer request API with the canonical shape on valid submission', async () => {
    createTransferRequest.mockResolvedValueOnce(undefined);
    mockStore.familyMembers = [{ id: 'child-2', familyId: 'family-1', role: 'child', displayName: 'Child Two' }];
    const { onSuccess } = renderModal();

    fillForm('child-2', '5.00', 'Thanks');
    submitForm();

    await waitFor(() => expect(createTransferRequest).toHaveBeenCalledTimes(1));
    // Reuses the same API Approval Center already supports: (familyId, toChildId, amountPence, message)
    expect(createTransferRequest).toHaveBeenCalledWith('family-1', 'child-2', 500, 'Thanks');
    expect(onSuccess).not.toHaveBeenCalled(); // only after the success delay
  });

  it('does not change the canonical balance on request creation', async () => {
    createTransferRequest.mockResolvedValueOnce(undefined);
    mockStore.myWallet = { balance: 1000 };
    mockStore.familyMembers = [{ id: 'child-2', familyId: 'family-1', role: 'child', displayName: 'Child Two' }];
    renderModal();

    fillForm('child-2', '5.00');
    submitForm();

    await waitFor(() => expect(createTransferRequest).toHaveBeenCalledTimes(1));
    // The store balance is never mutated by the request.
    expect(mockStore.myWallet.balance).toBe(1000);
  });

  it('blocks an amount that exceeds the canonical balance', async () => {
    mockStore.myWallet = { balance: 500 }; // £5.00
    mockStore.familyMembers = [{ id: 'child-2', familyId: 'family-1', role: 'child', displayName: 'Child Two' }];
    renderModal();

    fillForm('child-2', '10.00');
    submitForm();

    expect(await screen.findByText('You do not have enough money for this transfer.')).toBeInTheDocument();
    expect(createTransferRequest).not.toHaveBeenCalled();
  });

  it('blocks a zero amount', async () => {
    mockStore.familyMembers = [{ id: 'child-2', familyId: 'family-1', role: 'child', displayName: 'Child Two' }];
    renderModal();

    fillForm('child-2', '0');
    submitForm();

    expect(await screen.findByText('Please enter an amount greater than zero.')).toBeInTheDocument();
    expect(createTransferRequest).not.toHaveBeenCalled();
  });

  it('blocks a negative amount', async () => {
    mockStore.familyMembers = [{ id: 'child-2', familyId: 'family-1', role: 'child', displayName: 'Child Two' }];
    renderModal();

    fillForm('child-2', '-5');
    submitForm();

    expect(await screen.findByText('Please enter an amount greater than zero.')).toBeInTheDocument();
    expect(createTransferRequest).not.toHaveBeenCalled();
  });

  it('blocks an amount with more than two decimal places', async () => {
    mockStore.familyMembers = [{ id: 'child-2', familyId: 'family-1', role: 'child', displayName: 'Child Two' }];
    renderModal();

    fillForm('child-2', '1.234');
    submitForm();

    expect(await screen.findByText('Amount can have at most two decimal places.')).toBeInTheDocument();
    expect(createTransferRequest).not.toHaveBeenCalled();
  });

  it('prevents duplicate submission', async () => {
    // Never-resolving promise keeps isSubmitting true so the button stays disabled.
    createTransferRequest.mockReturnValue(new Promise(() => {}));
    mockStore.familyMembers = [{ id: 'child-2', familyId: 'family-1', role: 'child', displayName: 'Child Two' }];
    renderModal();

    fillForm('child-2', '5.00');
    const submit = screen.getByTestId('send-money-submit');
    fireEvent.click(submit);
    await waitFor(() => expect(submit).toBeDisabled());
    fireEvent.click(submit); // second attempt must be ignored
    expect(createTransferRequest).toHaveBeenCalledTimes(1);
  });

  it('shows a success message and then closes the modal', async () => {
    createTransferRequest.mockResolvedValueOnce(undefined);
    mockStore.familyMembers = [{ id: 'child-2', familyId: 'family-1', role: 'child', displayName: 'Child Two' }];
    const { onClose } = renderModal();

    fillForm('child-2', '5.00');
    submitForm();

    expect(await screen.findByText('Request sent!')).toBeInTheDocument();
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 2500 });
  });

  it('replaces raw Firebase errors with a friendly message', async () => {
    createTransferRequest.mockRejectedValueOnce({
      code: 'permission-denied',
      message: 'The caller does not have permission to execute the specified operation.',
    });
    mockStore.familyMembers = [{ id: 'child-2', familyId: 'family-1', role: 'child', displayName: 'Child Two' }];
    renderModal();

    fillForm('child-2', '5.00');
    submitForm();

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText('The caller does not have permission')).not.toBeInTheDocument();
  });
});

describe('SendMoneyModal — layout & accessibility', () => {
  it('uses a mobile bottom-sheet layout with sticky header/footer and safe-area padding', () => {
    renderModal();
    const overlay = screen.getByTestId('send-money-overlay');
    const dialog = screen.getByTestId('send-money-dialog');

    expect(overlay.className).toContain('items-end');
    expect(overlay.className).toContain('sm:items-center');
    expect(dialog.className).toContain('max-h-[90dvh]');
    expect(dialog.className).toContain('rounded-t-3xl');
    expect(dialog.className).toContain('sm:rounded-3xl');

    expect(screen.getByTestId('send-money-header').className).toContain('shrink-0');
    const footer = screen.getByTestId('send-money-footer') as HTMLElement;
    expect(footer.className).toContain('sticky');
    expect(footer.style.paddingBottom).toContain('env(safe-area-inset-bottom)');
  });

  it('exposes dialog semantics and closes on Escape', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    const dialog = screen.getByTestId('send-money-dialog');
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'send-money-title');

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('returns focus to the Send Money trigger on close', () => {
    const TriggerWrapper = ({ show }: { show: boolean }) => (
      <>
        <button data-testid="send-money-trigger" type="button">Send Money</button>
        {show && <SendMoneyModal onClose={() => {}} />}
      </>
    );

    const { rerender } = render(<TriggerWrapper show={false} />);
    const trigger = screen.getByTestId('send-money-trigger') as HTMLButtonElement;
    trigger.focus();
    expect(trigger).toHaveFocus();

    rerender(<TriggerWrapper show={true} />);
    expect(screen.getByTestId('send-money-dialog')).toHaveFocus();

    rerender(<TriggerWrapper show={false} />);
    expect(trigger).toHaveFocus();
  });

  it('never renders a blank submit button label', () => {
    renderModal();
    const submit = screen.getByTestId('send-money-submit');
    expect(submit.textContent).toBe('Send Request');
  });
});
