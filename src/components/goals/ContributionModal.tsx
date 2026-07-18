import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { CurrencyDisplay } from '../ui/CurrencyDisplay';
import { useStore } from '../../store/useStore';
import { contributeToGoal } from '../../lib/api';
import { normalizeGoalDoc, type Goal } from '../../lib/goalContracts';

/**
 * Child contribution flow: wallet -> goal. Optionally approval-gated
 * (creates a pending goal_request instead of applying immediately).
 */
export function ContributionModal({ goal, isOpen, onClose, onDone }: {
  goal: any;
  isOpen: boolean;
  onClose: () => void;
  onDone?: () => void;
}) {
  const { currentUser, myWallet, familyData } = useStore();
  const g: Goal = normalizeGoalDoc(goal);
  const [amount, setAmount] = useState('');
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const balance = myWallet?.balance || 0;
  const amountPence = Math.round((parseFloat(amount) || 0) * 100);
  const valid = amountPence > 0 && amountPence <= balance;

  const handleSubmit = async () => {
    if (!currentUser || !familyData) return;
    if (!valid) {
      setError('Enter an amount up to your available balance.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await contributeToGoal(familyData.id, g.goalId!, currentUser.id, amountPence, {
        clientReqId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        approvalRequired,
      });
      setAmount('');
      onDone?.();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not contribute.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Contribute to ${g.title}`}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" fullWidth onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button fullWidth onClick={handleSubmit} disabled={!valid || submitting}>
            {submitting ? 'Contributing…' : approvalRequired ? 'Request' : 'Contribute'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="bg-gray-50 rounded-xl p-4 flex items-center justify-between">
          <span className="text-sm text-gray-500 font-medium">Your balance</span>
          <span className="font-bold text-gray-900"><CurrencyDisplay amountPence={balance} forceColor={false} /></span>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Amount</label>
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

        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={approvalRequired}
            onChange={(e) => setApprovalRequired(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-primary-600"
          />
          Require parent approval before contributing
        </label>

        {error && <p className="text-sm text-danger-600 font-medium">{error}</p>}
      </div>
    </Modal>
  );
}
