import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { CurrencyDisplay } from '../ui/CurrencyDisplay';
import { useStore } from '../../store/useStore';
import { createMatchProposal } from '../../lib/api';
import { normalizeGoalDoc, type Goal, type ContributionLeg } from '../../lib/goalContracts';

/**
 * Parent match proposal flow: proposes a manual match for a specific child
 * contribution. Uses `createMatchProposal` (design §2.7). The proposal is then
 * approved/rejected in the Approval Center.
 */
export function MatchProposalModal({ goal, contributions, isOpen, onClose, onDone }: {
  goal: any;
  contributions: ContributionLeg[];
  isOpen: boolean;
  onClose: () => void;
  onDone?: () => void;
}) {
  const { currentUser, familyData, familyMembers } = useStore();
  const g: Goal = normalizeGoalDoc(goal);

  const childContribs = contributions.filter(
    c => c.type === 'child_contribution' && (!c.status || c.status === 'applied'),
  );

  const [sourceId, setSourceId] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const selected = childContribs.find(c => c.contribId === sourceId);
  const amountPence = Math.round((parseFloat(amount) || 0) * 100);
  const valid = Boolean(sourceId) && amountPence > 0;

  const handleSubmit = async () => {
    if (!currentUser || !familyData || !selected) return;
    if (!valid) {
      setError('Pick a contribution and enter a match amount greater than zero.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await createMatchProposal(
        familyData.id,
        g.goalId!,
        selected.contribId!,
        amountPence,
        `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      setSourceId('');
      setAmount('');
      onDone?.();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not create match proposal.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Propose Match · ${g.title}`}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" fullWidth onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button fullWidth onClick={handleSubmit} disabled={!valid || submitting}>
            {submitting ? 'Proposing…' : 'Propose Match'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Propose a parent match for a child contribution. The proposal is sent to the Approval
          Center for a parent to approve.
        </p>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Child contribution</label>
          <select
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            className="w-full px-3 py-3 border-2 border-gray-200 rounded-xl focus:border-primary-500 focus:outline-none font-medium bg-white"
          >
            <option value="">Select a contribution…</option>
            {childContribs.map(c => {
              const child = familyMembers.find(m => m.id === c.ownerId);
              return (
                <option key={c.contribId} value={c.contribId}>
                  {child?.displayName ?? 'Child'} · <CurrencyDisplay amountPence={c.amountPence} forceColor={false} />
                </option>
              );
            })}
          </select>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Match amount</label>
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
            />
          </div>
        </div>

        {error && <p className="text-sm text-danger-600 font-medium">{error}</p>}
      </div>
    </Modal>
  );
}
