import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { CurrencyDisplay } from '../ui/CurrencyDisplay';
import { useStore } from '../../store/useStore';
import { contributeToGoal } from '../../lib/api';
import { normalizeGoalDoc, type Goal } from '../../lib/goalContracts';
import { currencySymbolFromCode, resolveFamilyCurrencyCode } from '../../i18n/format';

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
  const { t } = useTranslation('goals');
  const g: Goal = normalizeGoalDoc(goal);
  const currencySymbol = currencySymbolFromCode(resolveFamilyCurrencyCode(familyData));
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
      setError(t('contribution.errorUpToBalance'));
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
      setError(t('contribution.errorGeneric'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('contribution.title', { title: g.title })}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" fullWidth onClick={onClose} disabled={submitting}>{t('contribution.cancel')}</Button>
          <Button fullWidth onClick={handleSubmit} disabled={!valid || submitting}>
            {submitting ? t('contribution.contributing') : approvalRequired ? t('contribution.request') : t('contribution.contribute')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="bg-gray-50 rounded-xl p-4 flex items-center justify-between">
          <span className="text-sm text-gray-500 font-medium">{t('contribution.yourBalance')}</span>
          <span className="font-bold text-gray-900"><CurrencyDisplay amountPence={balance} forceColor={false} /></span>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">{t('contribution.amount')}</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">{currencySymbol}</span>
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
          {t('contribution.requireApproval')}
        </label>

        {error && <p className="text-sm text-danger-600 font-medium">{error}</p>}
      </div>
    </Modal>
  );
}
