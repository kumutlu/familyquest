import {
  ArrowDownRight,
  ArrowRightLeft,
  ArrowUpRight,
  Ban,
  CircleDollarSign,
  Flag,
  Gift,
  PiggyBank,
  Settings,
  Sparkles,
  Star,
  Target,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';

const TRANSACTION_ICON_COMPONENTS: Readonly<Record<string, LucideIcon>> = {
  ArrowDownRight,
  ArrowRightLeft,
  ArrowUpRight,
  Ban,
  Flag,
  Gift,
  PiggyBank,
  Settings,
  Sparkles,
  Star,
  Target,
  Transaction: CircleDollarSign,
  UserPlus,
};

interface TransactionIconProps {
  iconName: string;
  size?: number;
}

export function TransactionIcon({ iconName, size = 20 }: TransactionIconProps) {
  const Icon = TRANSACTION_ICON_COMPONENTS[iconName] ?? CircleDollarSign;
  return <Icon size={size} aria-hidden="true" focusable="false" />;
}
