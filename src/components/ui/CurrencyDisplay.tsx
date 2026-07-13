import { useStore } from '../../store/useStore';
import { cn } from '../../lib/utils';

interface CurrencyDisplayProps {
  amountPence: number;
  className?: string;
  forceColor?: boolean; // Whether to force red text on negative values
}

export function CurrencyDisplay({ amountPence, className, forceColor = true }: CurrencyDisplayProps) {
  const familyData = useStore(state => state.familyData);
  const currencySymbol = familyData?.currency || '£';

  const isNegative = amountPence < 0;
  const absoluteAmount = Math.abs(amountPence) / 100;

  // Format exactly like: -£5.00 or £5.00
  const formatted = `${isNegative ? '-' : ''}${currencySymbol}${absoluteAmount.toFixed(2)}`;

  const finalClassName = cn(
    className,
    isNegative && forceColor && "text-danger-600"
  );

  return (
    <span className={finalClassName}>{formatted}</span>
  );
}
