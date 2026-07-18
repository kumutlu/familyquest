import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { CurrencyDisplay } from '../ui/CurrencyDisplay';
import { useStore } from '../../store/useStore';
import { requestGoalWithdrawal } from '../../lib/api';
import { normalizeGoalDoc, computeNetChild, type Goal, type ContributionLeg } from '../../lib/goalContracts';

/**
 * Child withdrawal request flow: requests a return of their own net
 * child-owned contribution. Capped at the child's net contribution derived
 * from the immutable `contributions` ledger (design §7).
 */
export function WithdrawalRequestModal({ goal, contributions, isOpen, onClose, onDone }: {
  goal: any;
  contributions: ContributionLeg[];
  isOpen: boolean;
  onClose: () => void;
  onDone?: () => void;
}) {
  const { currentUser, familyData } = useStore();
  const g: Goal = normalizeGoalDoc(goal);
  const childId = currentUser?.id ?? g.childId ?? '';
  const netChild = computeNetChild(contributions, childId);

  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const amountPence = Math.round((parseFloat(amount) || 0) * 100);
  const valid = amountPence > 0 && amountPence <= netChild;

  const handleSubmit = async () => {
    if (!currentUser || !familyData) return;
    if (!valid) {
      setError(`Enter an amount up to your net contribution of ${netChild / 100}.`);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await requestGoalWithdrawal(familyData.id, g.goalId!, childId, amountPence, `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      setAmount('');
      onDone?.();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not request withdrawal.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Withdraw from ${g.title}`}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" fullWidth onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button fullWidth onClick={handleSubmit} disabled={!valid || submitting || netChild <= 0}>
            {submitting ? 'Requesting…' : 'Request Withdrawal'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="bg-gray-50 rounded-xl p-4 flex items-center justify-between">
          <span className="text-sm text-gray-500 font-medium">Your net contribution</span>
          <span className="font-bold text-gray-900"><CurrencyDisplay amountPence={netChild} forceColor={false} /></span>
        </div>
        {netChild <= 0 && (
          <p className="text-sm text-gray-500">You have no withdrawable balance in this goal yet.</p>
        )}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Amount to withdraw</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">{familyData?.currency || '£'}</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full pl-8 pr-3 py-3 border-2 border-gray-200 rounded-xl focus:border-primary-500 focus:outline-none font-bold"
              placeholder="0.00"
              autoFocus
            />
          </div>
        </div>
        {error && <p className="text-sm text-danger-600 font-medium">{error}</p>}
      </div>
    </Modal>
  );
}
