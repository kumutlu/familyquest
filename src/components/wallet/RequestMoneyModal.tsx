import { useState } from 'react';
import { Button } from '../ui/Button';
import { createMoneyRequest } from '../../lib/api';
import { useStore } from '../../store/useStore';
import { HandCoins } from 'lucide-react';

interface RequestMoneyModalProps {
  onClose: () => void;
  onSuccess?: () => void;
}

export function RequestMoneyModal({ onClose, onSuccess }: RequestMoneyModalProps) {
  const { currentUser, familyMembers } = useStore();
  const [requestedFromId, setRequestedFromId] = useState('');
  const [amountGBP, setAmountGBP] = useState('');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const candidates = (familyMembers || [])
    .filter(m => m.id !== currentUser?.id)
    .sort((a, b) => {
      const aParent = a.role === 'parent' || a.role === 'owner' ? 0 : 1;
      const bParent = b.role === 'parent' || b.role === 'owner' ? 0 : 1;
      if (aParent !== bParent) return aParent - bParent;
      return (a.displayName || '').localeCompare(b.displayName || '');
    });

  const requestedFrom = candidates.find(c => c.id === requestedFromId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    if (!requestedFromId) {
      setError('Please choose who to request money from.');
      return;
    }
    const amountFloat = parseFloat(amountGBP);
    if (!Number.isFinite(amountFloat) || amountFloat <= 0) {
      setError('Please enter an amount greater than zero.');
      return;
    }
    const amountPence = Math.round(amountFloat * 100);
    if (!Number.isInteger(amountPence)) {
      setError('Amount must be a whole number of pence.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await createMoneyRequest(currentUser.familyId, requestedFromId, amountPence, note.trim());
      setSuccess(true);
      window.setTimeout(() => {
        onSuccess?.();
        onClose();
      }, 1400);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Failed to request money.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-sm rounded-3xl shadow-xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
          <h3 className="text-xl font-bold text-gray-900">Request Money</h3>
          <button onClick={onClose} className="p-2 -mr-2 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-500 transition-colors">
            ✕
          </button>
        </div>
        <div className="p-6">
          {success ? (
            <div className="py-8 text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-success-50 text-success-600 flex items-center justify-center mb-3">
                <HandCoins size={22} />
              </div>
              <p className="font-semibold text-gray-900">Request sent!</p>
              <p className="text-sm text-gray-500 mt-1">
                {requestedFrom ? `To ${requestedFrom.displayName}. ` : ''}
                Awaiting approval.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm font-medium">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Request from</label>
                <select
                  required
                  value={requestedFromId}
                  onChange={e => setRequestedFromId(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                >
                  <option value="" disabled>Select a parent or sibling…</option>
                  {candidates.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.displayName}{c.role === 'parent' || c.role === 'owner' ? ' (Parent)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount (£)</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold">£</span>
                  <input
                    type="number"
                    required
                    min="0.01"
                    step="0.01"
                    value={amountGBP}
                    onChange={e => setAmountGBP(e.target.value)}
                    className="w-full pl-8 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all font-bold text-lg"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Note (Optional)</label>
                <input
                  type="text"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                  placeholder="e.g. For a school trip"
                />
              </div>

              <div className="pt-4 flex gap-3">
                <Button type="button" variant="outline" fullWidth onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" fullWidth disabled={isSubmitting || candidates.length === 0} className="bg-primary-600 hover:bg-primary-700">
                  {isSubmitting ? 'Sending…' : 'Send Request'}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
