import { cn } from '../../lib/utils';
import { useMoneyPrivacy } from './MoneyPrivacyContext';

export function MoneyValue({ children, className }: { children: string; className?: string }) {
  const { isMoneyHidden, maskFormattedMoney } = useMoneyPrivacy();

  return <span className={cn(className)}>{isMoneyHidden ? maskFormattedMoney(children) : children}</span>;
}
