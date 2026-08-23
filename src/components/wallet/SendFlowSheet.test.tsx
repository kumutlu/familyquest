import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n/config';

const api = vi.hoisted(() => ({
  createTransferRequest: vi.fn(),
}));
vi.mock('../../lib/api', () => api);

const useStoreMock = vi.fn();
vi.mock('../../store/useStore', () => ({ useStore: (...args: any[]) => useStoreMock(...args) }));

import { SendFlowSheet } from './SendFlowSheet';

function member(overrides: Record<string, unknown> & { id: string }) {
  return {
    role: 'child',
    familyId: 'fam',
    displayName: overrides.id,
    isActive: true,
    ...overrides,
  };
}

function makeStore(overrides: any = {}) {
  return {
    currentUser: { id: 'me', familyId: 'fam', role: 'child', displayName: 'Ada' },
    familyMembers: [
      member({ id: 'me' }),
      member({ id: 'sib1', displayName: 'Ali' }),
      member({ id: 'sib2', displayName: 'Zeynep' }),
      member({ id: 'dad', role: 'parent', displayName: 'Dad' }),
    ],
    myWallet: { balance: 500 },
    ...overrides,
  };
}

describe('SendFlowSheet (Wave 3 staged send)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.loadNamespaces(['wallet']);
    api.createTransferRequest.mockResolvedValue(undefined);
  });

  it('offers only eligible child recipients (no parents, no self)', () => {
    useStoreMock.mockReturnValue(makeStore());
    render(<SendFlowSheet onClose={() => {}} />);
    const recipients = screen.getAllByTestId('send-recipient');
    expect(recipients).toHaveLength(2);
    expect(screen.getByText('Ali')).toBeInTheDocument();
    expect(screen.getByText('Zeynep')).toBeInTheDocument();
    expect(screen.queryByText('Dad')).not.toBeInTheDocument();
  });

  it('shows an honest empty state for single-child families instead of a broken send flow', () => {
    useStoreMock.mockReturnValue(
      makeStore({ familyMembers: [member({ id: 'me' }), member({ id: 'dad', role: 'parent', displayName: 'Dad' })] }),
    );
    render(<SendFlowSheet onClose={() => {}} />);
    expect(screen.getByTestId('send-no-recipients')).toBeInTheDocument();
    expect(api.createTransferRequest).not.toHaveBeenCalled();
  });

  it('validates amounts against the authoritative balance with specific errors', () => {
    useStoreMock.mockReturnValue(makeStore());
    render(<SendFlowSheet onClose={() => {}} />);
    fireEvent.click(screen.getByText('Ali'));
    const input = screen.getByTestId('send-amount-input');
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.click(screen.getByTestId('send-review-continue'));
    // £5.00 balance — specific insufficient-funds message, never a generic error.
    expect(screen.getByRole('alert')).toHaveTextContent(/enough money/i);
    expect(screen.queryByTestId('send-review-title')).not.toBeInTheDocument();
  });

  it('rejects more than two decimal places before any mutation', () => {
    useStoreMock.mockReturnValue(makeStore());
    render(<SendFlowSheet onClose={() => {}} />);
    fireEvent.click(screen.getByText('Ali'));
    fireEvent.change(screen.getByTestId('send-amount-input'), { target: { value: '1.999' } });
    fireEvent.click(screen.getByTestId('send-review-continue'));
    expect(screen.getByRole('alert')).toHaveTextContent(/two decimal/i);
    expect(api.createTransferRequest).not.toHaveBeenCalled();
  });

  it('surfaces quick amount chips only up to the available balance', () => {
    useStoreMock.mockReturnValue(makeStore());
    render(<SendFlowSheet onClose={() => {}} />);
    fireEvent.click(screen.getByText('Ali'));
    const chips = screen.getAllByTestId('send-quick-amount').map(c => c.textContent);
    expect(chips).toEqual(['£1.00', '£2.00', '£5.00']);
  });

  it('shows a human review summary and sends exactly once (double tap safe)', async () => {
    useStoreMock.mockReturnValue(makeStore());
    let resolveSend: () => void = () => {};
    api.createTransferRequest.mockImplementation(
      () => new Promise<void>(resolve => { resolveSend = resolve; }),
    );
    render(<SendFlowSheet onClose={() => {}} />);
    fireEvent.click(screen.getByText('Zeynep'));
    fireEvent.change(screen.getByTestId('send-amount-input'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('send-review-continue'));

    expect(screen.getByTestId('send-review-title')).toHaveTextContent(/£2\.00/);
    expect(screen.getByTestId('send-review-title')).toHaveTextContent('Zeynep');

    const confirm = screen.getByTestId('send-confirm');
    fireEvent.click(confirm);
    fireEvent.click(confirm); // double tap / pointer race
    await waitFor(() => expect(api.createTransferRequest).toHaveBeenCalledTimes(1));
    expect(api.createTransferRequest).toHaveBeenCalledWith('fam', 'sib2', 200, '');

    resolveSend();
    await waitFor(() => expect(screen.getByTestId('send-sent')).toBeInTheDocument());
    // Honest state: awaiting parent approval, NOT "money moved".
    expect(screen.getByTestId('send-sent')).toHaveTextContent(/awaiting parent approval/i);
  });

  it('restores the review stage with actionable copy when the domain rejects the send', async () => {
    useStoreMock.mockReturnValue(makeStore());
    api.createTransferRequest.mockRejectedValue(new Error('Insufficient funds'));
    render(<SendFlowSheet onClose={() => {}} />);
    fireEvent.click(screen.getByText('Ali'));
    fireEvent.change(screen.getByTestId('send-amount-input'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('send-review-continue'));
    fireEvent.click(screen.getByTestId('send-confirm'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    // No false success state.
    expect(screen.queryByTestId('send-sent')).not.toBeInTheDocument();
    expect(screen.getByTestId('send-confirm')).toBeInTheDocument();
  });
});
