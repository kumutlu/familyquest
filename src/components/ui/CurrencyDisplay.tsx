import { useStore } from '../../store/useStore';
import { cn } from '../../lib/utils';
import { formatPence, resolveFamilyCurrencyCode } from '../../i18n/format';
import { MoneyValue } from '../privacy/MoneyValue';

export interface CurrencyDisplayProps {
  amountPence: number;
  className?: string;
  forceColor?: boolean; // Whether to force red text on negative values
  privacy?: 'wallet';
}

export function CurrencyDisplay({ amountPence, className, forceColor = true, privacy }: CurrencyDisplayProps) {
  const familyData = useStore(state => state.familyData);
  const currencyCode = resolveFamilyCurrencyCode(familyData);

  const isNegative = amountPence < 0;

  // Locale-aware currency formatting via Intl (no manual string building).
  // Amounts are stored in pence; formatPence converts to major units.
  const formatted = formatPence(amountPence, currencyCode);

  const finalClassName = cn(
    className,
    isNegative && forceColor && "text-danger-600"
  );

  return (
    <span className={finalClassName}>
      {privacy === 'wallet' ? <MoneyValue>{formatted}</MoneyValue> : formatted}
    </span>
  );
}
