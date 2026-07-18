import { useState } from 'react';
import { Button } from '../ui/Button';
import { CurrencyDisplay } from '../ui/CurrencyDisplay';
import { useStore } from '../../store/useStore';

interface PetBoxConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  amountPence: number;
  fundName: string;
}

export function PetBoxConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  amountPence,
  fundName
}: PetBoxConfirmationModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const myWallet = useStore(state => state.myWallet);

  if (!isOpen) return null;

  const currentBalance = myWallet?.balance || 0;
  const newBalance = currentBalance - amountPence;
  const isInsufficient = newBalance < 0;

  const handleConfirm = async () => {
    if (isInsufficient || isProcessing) return;
    setIsProcessing(true);
    try {
      await onConfirm();
    } finally {
      setIsProcessing(false);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-2">Request Donation</h2>
          <p className="text-gray-500 mb-6 text-sm">
            You are asking to donate to <span className="font-bold text-gray-900">{fundName}</span>. This requires <span className="font-bold text-warning-600">parent approval</span>. Your money will not be deducted until approved.
          </p>

          <div className="space-y-3 mb-6 bg-gray-50 p-4 rounded-xl border border-gray-100">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Current Balance:</span>
              <span className="font-bold text-gray-900"><CurrencyDisplay amountPence={currentBalance} /></span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Donation Amount:</span>
              <span className="font-bold text-danger-600">-<CurrencyDisplay amountPence={amountPence} /></span>
            </div>
            <div className="pt-3 mt-3 border-t border-gray-200 flex justify-between">
              <span className="font-bold text-gray-700">New Balance:</span>
              <span className={`font-bold ${isInsufficient ? 'text-danger-600' : 'text-success-600'}`}>
                <CurrencyDisplay amountPence={newBalance} />
              </span>
            </div>
          </div>

          {isInsufficient && (
            <div className="mb-6 p-3 bg-danger-50 border border-danger-100 rounded-lg text-danger-700 text-sm font-medium">
              You don't have enough money in your wallet for this donation.
            </div>
          )}

          <div className="flex gap-3">
            <Button variant="secondary" fullWidth onClick={onClose} disabled={isProcessing}>
              Cancel
            </Button>
            <Button
              fullWidth
              onClick={handleConfirm}
              disabled={isInsufficient || isProcessing}
              className={isProcessing ? 'opacity-70' : ''}
            >
              {isProcessing ? 'Requesting...' : 'Request Donation'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
