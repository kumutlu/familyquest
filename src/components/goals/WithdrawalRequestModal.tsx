import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { CurrencyDisplay } from '../ui/CurrencyDisplay';
import { useStore } from '../../store/useStore';
import { currencySymbolFromCode, formatPence, resolveFamilyCurrencyCode } from '../../i18n/format';
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
  const { t } = useTranslation('goals');
  const currencyCode = resolveFamilyCurrencyCode(familyData);
  const currency = currencySymbolFromCode(currencyCode);
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
      setError(t('withdrawal.errorUpToNet', { amount: formatPence(netChild, currencyCode) }));
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
      setError(t('withdrawal.errorGeneric'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('withdrawal.title', { title: g.title })}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" fullWidth onClick={onClose} disabled={submitting}>{t('withdrawal.cancel')}</Button>
          <Button fullWidth onClick={handleSubmit} disabled={!valid || submitting || netChild <= 0}>
            {submitting ? t('withdrawal.requesting') : t('withdrawal.request')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="bg-gray-50 rounded-xl p-4 flex items-center justify-between">
          <span className="text-sm text-gray-500 font-medium">{t('withdrawal.yourNet')}</span>
          <span className="font-bold text-gray-900"><CurrencyDisplay amountPence={netChild} forceColor={false} /></span>
        </div>
        {netChild <= 0 && (
          <p className="text-sm text-gray-500">{t('withdrawal.noWithdrawable')}</p>
        )}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">{t('withdrawal.amountToWithdraw')}</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">{currency}</span>
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
