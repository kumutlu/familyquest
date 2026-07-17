import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useStore } from '../../store/useStore';
import { addParentGoalContribution } from '../../lib/api';
import { normalizeGoalDoc, type Goal } from '../../lib/goalContracts';

/**
 * Parent contribution flow: external parent money added directly to the goal
 * (no wallet debit). Uses `addParentGoalContribution`.
 */
export function ParentContributionModal({ goal, isOpen, onClose, onDone }: {
  goal: any;
  isOpen: boolean;
  onClose: () => void;
  onDone?: () => void;
}) {
  const { currentUser, familyData } = useStore();
  const g: Goal = normalizeGoalDoc(goal);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const amountPence = Math.round((parseFloat(amount) || 0) * 100);
  const valid = amountPence > 0;

  const handleSubmit = async () => {
    if (!currentUser || !familyData) return;
    if (!valid) {
      setError('Enter an amount greater than zero.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await addParentGoalContribution(familyData.id, g.goalId!, amountPence, `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      setAmount('');
      onDone?.();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not add contribution.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Add to ${g.title}`}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" fullWidth onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button fullWidth onClick={handleSubmit} disabled={!valid || submitting}>
            {submitting ? 'Adding…' : 'Add Contribution'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          This adds money from a parent (e.g. cash, bank transfer) directly to the goal. It is not
          taken from any child wallet.
        </p>
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
        {error && <p className="text-sm text-danger-600 font-medium">{error}</p>}
      </div>
    </Modal>
  );
}
