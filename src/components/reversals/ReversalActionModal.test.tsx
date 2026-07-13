import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryAction } from '../../lib/reversalHistory';

const api = vi.hoisted(() => ({ reverseTransaction: vi.fn() }));
vi.mock('../../lib/reversalApi', () => api);

import { ReversalActionModal } from './ReversalActionModal';

const action: HistoryAction = {
  sourceKind: 'wallet_transaction', sourceId: 'tx-1', source: {}, summary: 'Pocket money',
  action: 'reverse', actionLabel: 'Reverse', targets: [{ id: 'child-1', label: 'Alex wallet', originalDelta: 300, predictedBalance: 200, unit: 'money' }],
};

describe('ReversalActionModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the exact warning, signed original effect, target, and prediction', () => {
    render(<ReversalActionModal open familyId="family-1" historyAction={action} onClose={vi.fn()} />);
    expect(screen.getByText('This creates a linked reversal record. The original action will remain in history.')).toBeInTheDocument();
    expect(screen.getByText('Alex wallet')).toBeInTheDocument();
    expect(screen.getByText('Original: +£3.00')).toBeInTheDocument();
    expect(screen.getByText('Predicted balance: £2.00')).toBeInTheDocument();
  });

  it('requires a trimmed reason of at least three characters', async () => {
    render(<ReversalActionModal open familyId="family-1" historyAction={action} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: ' x ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reverse' }));
    expect(await screen.findByText('Reason must be at least 3 characters.')).toBeInTheDocument();
    expect(api.reverseTransaction).not.toHaveBeenCalled();
  });

  it('blocks double submit synchronously and closes only after success', async () => {
    let resolve!: (value: unknown) => void;
    api.reverseTransaction.mockReturnValue(new Promise(value => { resolve = value; }));
    const onClose = vi.fn();
    render(<ReversalActionModal open familyId="family-1" historyAction={action} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Duplicate' } });
    const submit = screen.getByRole('button', { name: 'Reverse' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(api.reverseTransaction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Reversing…' })).toBeDisabled();
    resolve({ status: 'completed' });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('retains the modal and reason while displaying the exact failed-action error', async () => {
    api.reverseTransaction.mockRejectedValue(Object.assign(new Error('Insufficient fund balance to reverse'), { code: 'failed-precondition' }));
    const onClose = vi.fn();
    render(<ReversalActionModal open familyId="family-1" historyAction={action} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Duplicate' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reverse' }));
    expect(await screen.findByText('failed-precondition: Insufficient fund balance to reverse')).toBeInTheDocument();
    expect(screen.getByLabelText('Reason')).toHaveValue('Duplicate');
    expect(onClose).not.toHaveBeenCalled();
  });
});
