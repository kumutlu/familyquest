import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { Avatar } from '../ui/Avatar';
import { createTransferRequest } from '../../lib/api';
import { useStore } from '../../store/useStore';
import { isChildRole } from '../../lib/roles';
import { Send } from 'lucide-react';

interface SendMoneyModalProps {
  onClose: () => void;
  onSuccess?: () => void;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Map raw API / Firebase errors to friendly, non-technical messages.
 * Raw Firebase error text must never reach the UI.
 */
function friendlyError(err: any): string {
  const code = err?.code;
  const message = typeof err?.message === 'string' ? err.message : '';
  const lowered = message.toLowerCase();

  if (code === 'WALLET_NOT_FOUND') {
    return 'We could not find your wallet. Please refresh and try again.';
  }
  if (lowered.includes('insufficient')) {
    return 'You do not have enough money for this transfer.';
  }
  if (lowered.includes('not authenticated') || code === 'unauthenticated') {
    return 'You have been signed out. Please sign in again.';
  }
  if (lowered.includes('recipient must differ') || lowered.includes('sender and recipient must differ')) {
    return 'You cannot send money to yourself.';
  }
  if (lowered.includes('same family')) {
    return 'You can only send money to another child in your family.';
  }
  if (lowered.includes('both participants must be children')) {
    return 'Transfers can only be sent between children.';
  }
  // Never surface raw Firebase error text.
  return 'Something went wrong. Please try again.';
}

export function SendMoneyModal({ onClose, onSuccess }: SendMoneyModalProps) {
  const { currentUser, familyMembers, myWallet } = useStore();
  const [recipientId, setRecipientId] = useState('');
  const [amountGBP, setAmountGBP] = useState('');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submittedAmountPence, setSubmittedAmountPence] = useState(0);

  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Canonical balance source: families/{familyId}/wallets/{childId}.balance
  const canonicalBalance = myWallet?.balance || 0;

  // Recipients: only active children in the same family, excluding the sender.
  // UI filtering is a convenience only — the backend/rules re-validate everything.
  const recipients = (familyMembers || [])
    .filter(
      m =>
        m.id !== currentUser?.id &&
        isChildRole(m.role) &&
        m.familyId === currentUser?.familyId &&
        m.isActive !== false
    )
    .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));

  const recipient = recipients.find(r => r.id === recipientId);

  // Lock background scroll, capture the trigger element, move focus into the
  // dialog, and restore everything when the modal closes.
  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    dialogRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, []);

  // Escape closes the dialog; Tab is trapped within it.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        );

        if (focusable.length === 0) {
          e.preventDefault();
          dialogRef.current.focus();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement;

        if (e.shiftKey && (active === first || active === dialogRef.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Penny-based validation. Returns integer pence or a friendly error.
  const validateAmount = (raw: string): { pence: number; error: string | null } => {
    const trimmed = (raw ?? '').trim();
    if (trimmed === '') return { pence: 0, error: 'Please enter an amount.' };
    const value = Number(trimmed);
    if (!Number.isFinite(value) || Number.isNaN(value)) {
      return { pence: 0, error: 'Please enter a valid amount.' };
    }
    if (value <= 0) {
      return { pence: 0, error: 'Please enter an amount greater than zero.' };
    }
    // Reject more than two decimal places.
    const pence = Math.round(value * 100);
    if (Math.abs(value * 100 - pence) > 1e-6) {
      return { pence: 0, error: 'Amount can have at most two decimal places.' };
    }
    if (pence > canonicalBalance) {
      return { pence: 0, error: 'You do not have enough money for this transfer.' };
    }
    return { pence, error: null };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Guard against duplicate submission.
    if (!currentUser || isSubmitting) return;

    if (!recipientId) {
      setError('Please choose who to send money to.');
      return;
    }
    const { pence, error: amountError } = validateAmount(amountGBP);
    if (amountError) {
      setError(amountError);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await createTransferRequest(currentUser.familyId, recipientId, pence, note.trim());
      setSubmittedAmountPence(pence);
      setSuccess(true);
      // Show a clear success message, then close and reset the modal.
      window.setTimeout(() => {
        onSuccess?.();
        onClose();
      }, 1400);
    } catch (err: any) {
      console.error(err);
      setError(friendlyError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitLabel = isSubmitting ? 'Sending...' : 'Send Request';

  return (
    <div
      data-testid="send-money-overlay"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-gray-900/40 backdrop-blur-sm p-0 sm:p-4"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="send-money-title"
        tabIndex={-1}
        data-testid="send-money-dialog"
        className="bg-white w-full sm:w-auto sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-xl overflow-hidden flex flex-col max-h-[90dvh] animate-in slide-in-from-bottom sm:slide-in-from-bottom-10 duration-200 outline-none"
      >
        {/* Sticky header — always visible */}
        <header
          data-testid="send-money-header"
          className="shrink-0 px-6 py-4 border-b border-gray-100 flex justify-between items-start gap-3 bg-white"
        >
          <h3
            id="send-money-title"
            className="text-xl font-bold text-gray-900 leading-tight break-words min-w-0"
          >
            Send Money
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 p-2 -mr-2 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-500 transition-colors"
          >
            ✕
          </button>
        </header>

        {success ? (
          <div data-testid="send-money-content" className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className="py-8 text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-success-50 text-success-600 flex items-center justify-center mb-3">
                <Send size={22} />
              </div>
              <p className="font-semibold text-gray-900">Request sent!</p>
              <p className="text-sm text-gray-500 mt-1">
                {recipient
                  ? `£${(submittedAmountPence / 100).toFixed(2)} to ${recipient.displayName}. `
                  : ''}
                Awaiting parent approval.
              </p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} data-testid="send-money-form" className="flex flex-col flex-1 min-h-0">
            {/* Scrollable content — only this area scrolls */}
            <div data-testid="send-money-content" className="min-h-0 flex-1 overflow-y-auto p-6 space-y-4">
              {error && (
                <div role="alert" className="p-3 bg-red-50 text-red-600 rounded-lg text-sm font-medium">
                  {error}
                </div>
              )}

              <div>
                <label htmlFor="send-money-recipient" className="block text-sm font-medium text-gray-700 mb-1">
                  To
                </label>
                <select
                  id="send-money-recipient"
                  required
                  value={recipientId}
                  onChange={e => setRecipientId(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                >
                  <option value="" disabled>Select a sibling…</option>
                  {recipients.map(r => (
                    <option key={r.id} value={r.id}>{r.displayName}</option>
                  ))}
                </select>
                {recipients.length === 0 && (
                  <p className="text-xs text-gray-400 mt-1">No other children in this family yet.</p>
                )}
                {recipient && (
                  <div className="mt-2 flex items-center gap-2 text-sm text-gray-600">
                    <Avatar src={recipient.avatarUrl} fallback={(recipient.displayName || '?')[0]} size="sm" />
                    <span>Sending to {recipient.displayName}</span>
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="send-money-amount" className="block text-sm font-medium text-gray-700 mb-1">
                  Amount (£)
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold">£</span>
                  <input
                    id="send-money-amount"
                    type="number"
                    required
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    value={amountGBP}
                    onChange={e => setAmountGBP(e.target.value)}
                    className="w-full pl-8 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all font-bold text-lg"
                    placeholder="0.00"
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Your balance stays the same until a parent approves.
                </p>
              </div>

              <div>
                <label htmlFor="send-money-note" className="block text-sm font-medium text-gray-700 mb-1">
                  Note (Optional)
                </label>
                <input
                  id="send-money-note"
                  type="text"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                  placeholder="e.g. Thanks for the book!"
                />
              </div>
            </div>

            {/* Sticky footer — always visible, safe-area padded */}
            <footer
              data-testid="send-money-footer"
              style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
              className="shrink-0 sticky bottom-0 px-6 pt-4 border-t border-gray-100 bg-white flex gap-3"
            >
              <Button type="button" variant="outline" fullWidth onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                fullWidth
                disabled={isSubmitting || recipients.length === 0}
                aria-busy={isSubmitting}
                data-testid="send-money-submit"
                className="bg-primary-600 hover:bg-primary-700"
              >
                {submitLabel}
              </Button>
            </footer>
          </form>
        )}
      </div>
    </div>
  );
}
