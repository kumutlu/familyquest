import { useStore } from '../../store/useStore';
import { cn } from '../../lib/utils';
import { formatPence, currencyCodeFromSymbol } from '../../i18n/format';

interface CurrencyDisplayProps {
  amountPence: number;
  className?: string;
  forceColor?: boolean; // Whether to force red text on negative values
}

export function CurrencyDisplay({ amountPence, className, forceColor = true }: CurrencyDisplayProps) {
  const familyData = useStore(state => state.familyData);
  const currencySymbol = familyData?.currency || '£';

  const isNegative = amountPence < 0;

  // Locale-aware currency formatting via Intl (no manual string building).
  // Amounts are stored in pence; formatPence converts to major units.
  const formatted = formatPence(amountPence, currencyCodeFromSymbol(currencySymbol));

  const finalClassName = cn(
    className,
    isNegative && forceColor && "text-danger-600"
  );

  return (
    <span className={finalClassName}>{formatted}</span>
  );
}
