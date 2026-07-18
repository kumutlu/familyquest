import { useState } from 'react';
import { Button } from '../ui/Button';
import { depositToWallet, withdrawFromWallet } from '../../lib/api';
import { useStore } from '../../store/useStore';

interface AddMoneyModalProps {
  child: any;
  onClose: () => void;
}

export function AddMoneyModal({ child, onClose }: AddMoneyModalProps) {
  const { currentUser } = useStore();
  const [amountGBP, setAmountGBP] = useState('');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'add' | 'withdraw'>('add');

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    const amountFloat = parseFloat(amountGBP);
    if (isNaN(amountFloat) || amountFloat <= 0) {
      setError('Please enter a valid amount.');
      return;
    }

    const amountPence = Math.round(amountFloat * 100);

    setIsSubmitting(true);
    setError(null);
    try {
      if (mode === 'add') {
        await depositToWallet(currentUser.familyId, child.id, currentUser.id, amountPence, note.trim());
      } else {
        await withdrawFromWallet(currentUser.familyId, child.id, currentUser.id, amountPence, note.trim());
      }
      onClose();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to update wallet.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Context-sensitive submit label.
  // - While submitting: "Adding..." / "Withdrawing..." (label is never removed).
  // - With a valid amount: "Add £<amount>" / "Withdraw £<amount>".
  // - Otherwise: "Add Money" / "Withdraw Money" (never an empty string).
  const amountFloat = parseFloat(amountGBP);
  const hasValidAmount = !isNaN(amountFloat) && amountFloat > 0;
  const formattedAmount = hasValidAmount ? amountFloat.toFixed(2) : '';

  const submitLabel = isSubmitting
    ? mode === 'add'
      ? 'Adding...'
      : 'Withdrawing...'
    : hasValidAmount
      ? mode === 'add'
        ? `Add £${formattedAmount}`
        : `Withdraw £${formattedAmount}`
      : mode === 'add'
        ? 'Add Money'
        : 'Withdraw Money';

  return (
    <div
      data-testid="manage-wallet-overlay"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-gray-900/40 backdrop-blur-sm p-0 sm:p-4"
    >
      <div
        data-testid="manage-wallet-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manage-wallet-title"
        className="bg-white w-full sm:w-auto sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-xl overflow-hidden flex flex-col max-h-[90dvh] animate-in slide-in-from-bottom sm:slide-in-from-bottom-10 duration-200"
      >
        <div className="shrink-0 px-6 py-4 border-b border-gray-100 flex justify-between items-start gap-3">
          <h3
            id="manage-wallet-title"
            className="text-xl font-bold text-gray-900 leading-tight break-words min-w-0"
          >
            Manage {child.displayName}'s Wallet
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 p-2 -mr-2 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-500 transition-colors"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSave} className="flex flex-col flex-1 min-h-0">
          <div data-testid="manage-wallet-content" className="flex-1 overflow-y-auto p-6 space-y-4">
            <div role="tablist" aria-label="Wallet action" className="flex bg-gray-100 p-1 rounded-lg">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'add'}
                onClick={() => setMode('add')}
                className={`flex-1 py-2 text-sm font-bold rounded-md transition-colors border ${
                  mode === 'add'
                    ? 'bg-white shadow-sm text-gray-900 border-gray-200'
                    : 'text-gray-500 hover:text-gray-700 border-transparent'
                }`}
              >
                Add Money
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'withdraw'}
                onClick={() => setMode('withdraw')}
                className={`flex-1 py-2 text-sm font-bold rounded-md transition-colors border ${
                  mode === 'withdraw'
                    ? 'bg-white shadow-sm text-gray-900 border-gray-200'
                    : 'text-gray-500 hover:text-gray-700 border-transparent'
                }`}
              >
                Withdraw
              </button>
            </div>

            {error && (
              <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm font-medium">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="manage-wallet-amount" className="block text-sm font-medium text-gray-700 mb-1">
                Amount (£)
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold">£</span>
                <input
                  id="manage-wallet-amount"
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
              <label htmlFor="manage-wallet-note" className="block text-sm font-medium text-gray-700 mb-1">
                Note (Optional)
              </label>
              <input
                id="manage-wallet-note"
                type="text"
                value={note}
                onChange={e => setNote(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                placeholder="e.g. Pocket money"
              />
            </div>
          </div>

          <div
            data-testid="manage-wallet-footer"
            className="shrink-0 px-6 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-gray-100 bg-white flex gap-3"
          >
            <Button type="button" variant="outline" fullWidth onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              fullWidth
              disabled={isSubmitting}
              aria-busy={isSubmitting}
              data-testid="manage-wallet-submit"
              className={`text-white ${
                mode === 'add' ? 'bg-success-500 hover:opacity-90' : 'bg-warning-500 hover:opacity-90'
              }`}
            >
              {submitLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
