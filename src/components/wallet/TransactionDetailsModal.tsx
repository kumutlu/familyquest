
import { CurrencyDisplay } from '../ui/CurrencyDisplay';
import { ArrowDownRight, ArrowUpRight, ArrowRightLeft } from 'lucide-react';
import { HistoryActionControl } from '../reversals/HistoryActionControl';
import type { ReversalSourceKind } from '../../lib/reversalApi';

interface TransactionDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: any;
}

export function TransactionDetailsModal({ isOpen, onClose, transaction }: TransactionDetailsModalProps) {
  if (!isOpen || !transaction) return null;

  const txAmount = Math.abs(transaction.amountPence || transaction.amount || 0);
  const isCredit = transaction.type === 'deposit' || transaction.type === 'transfer_in' || transaction.type === 'credit' || transaction.type === 'request_payment' || (transaction.type === 'transfer' && transaction.amount > 0 && !transaction.fromChildId);
  const isTransfer = transaction.type === 'transfer' || transaction.type === 'transfer_in' || transaction.type === 'transfer_out';

  const date = transaction.timestamp?.toDate ? transaction.timestamp.toDate().toLocaleString() : (transaction.createdAt?.toDate ? transaction.createdAt.toDate().toLocaleString() : '');
  const sourceKind: ReversalSourceKind = transaction.type === 'transfer_request_out' ? 'transfer_request'
    : transaction.type === 'money_request' ? 'money_request'
      : transaction.type === 'petbox_donation_request' ? 'petbox_request' : 'wallet_transaction';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 flex justify-between items-center border-b border-gray-100">
          <h3 className="text-xl font-bold text-gray-900">Transaction Details</h3>
          <button onClick={onClose} className="p-2 -mr-2 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-500">✕</button>
        </div>
        <div className="p-6 overflow-y-auto space-y-4">
          <div className="flex flex-col items-center justify-center py-4">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center shrink-0 mb-4 ${isCredit ? 'bg-success-50 text-success-600' : 'bg-danger-50 text-danger-600'}`}>
              {isTransfer ? <ArrowRightLeft size={32} /> : (isCredit ? <ArrowUpRight size={32} /> : <ArrowDownRight size={32} />)}
            </div>
            <h2 className={`text-4xl font-extrabold ${isCredit ? 'text-success-600' : 'text-danger-600'}`}>
              {isCredit ? '+' : '-'}<CurrencyDisplay amountPence={txAmount} forceColor={false} />
            </h2>
            <p className="text-gray-500 font-medium mt-1 uppercase tracking-wider text-xs">{transaction.type.replace('_', ' ')}</p>
          </div>

          <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-500 text-sm">Status</span>
              <span className="font-bold text-gray-900 text-sm capitalize">{transaction.status || 'Completed'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 text-sm">Date</span>
              <span className="font-medium text-gray-900 text-sm">{date}</span>
            </div>
            {(transaction.note || transaction.message) && (
              <div className="flex justify-between">
                <span className="text-gray-500 text-sm">Note</span>
                <span className="font-medium text-gray-900 text-sm text-right">{transaction.note || transaction.message}</span>
              </div>
            )}
            {transaction.reviewedByName && (
              <div className="flex justify-between">
                <span className="text-gray-500 text-sm">Reviewed By</span>
                <span className="font-medium text-gray-900 text-sm">{transaction.reviewedByName}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-gray-200 pt-3 mt-3">
              <span className="text-gray-400 text-xs">Reference ID</span>
              <span className="font-mono text-gray-400 text-xs">{transaction.id.slice(-6).toUpperCase()}</span>
            </div>
          </div>
          <div className="flex justify-end">
            <HistoryActionControl sourceKind={sourceKind} source={transaction} />
          </div>
        </div>
      </div>
    </div>
  );
}
