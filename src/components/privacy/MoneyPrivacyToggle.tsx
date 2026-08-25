import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { useMoneyPrivacy } from './MoneyPrivacyContext';

export function MoneyPrivacyToggle({ className }: { className?: string }) {
  const { t } = useTranslation('common');
  const { isMoneyHidden, toggleMoneyPrivacy } = useMoneyPrivacy();
  const label = isMoneyHidden ? t('moneyPrivacy.show') : t('moneyPrivacy.hide');

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={isMoneyHidden}
      onClick={toggleMoneyPrivacy}
      className={cn(
        'inline-flex size-10 items-center justify-center rounded-xl text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2',
        className,
      )}
    >
      {isMoneyHidden ? <Eye aria-hidden="true" size={20} /> : <EyeOff aria-hidden="true" size={20} />}
    </button>
  );
}
