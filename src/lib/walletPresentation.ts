import {
  ArrowDownRight,
  ArrowUpRight,
  ArrowRightLeft,
  PiggyBank,
  Ban,
  Clock,
  type LucideIcon,
} from 'lucide-react';
import { isPendingTransferStatus } from './requestStatus';

// ---------------------------------------------------------------------------
// Signed amount + period helpers (canonical ledger maths)
// ---------------------------------------------------------------------------

// Signed amount in pence for a single wallet transaction.
// Incoming transactions (deposit / transfer_in / request_payment) are positive;
// outgoing transactions (withdrawal / transfer_out / financial_penalty / petbox_donation) are negative.
// wallet_transactions carry a signed `amountPence` for transfers; deposit/withdrawal carry an
// unsigned `amount`, so the sign is derived from the transaction type.
export function signedTransactionAmount(tx: any): number {
  if (typeof tx?.amountPence === 'number') return tx.amountPence;
  if (typeof tx?.amount === 'number') {
    const incoming = tx.type === 'deposit' || tx.type === 'request_payment';
    return incoming ? tx.amount : -tx.amount;
  }
  return 0;
}

// True when the transaction occurred in the same calendar month as `now`.
export function isSameMonth(tx: any, now: Date = new Date()): boolean {
  const date = transactionTimestamp(tx);
  if (!date) return false;
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

// Resolve a Firestore Timestamp / Date / number into a Date, or null when unknown.
// Supports both `toMillis()` and `toDate()` shapes (real Firestore Timestamps expose both).
export function transactionTimestamp(tx: any): Date | null {
  const value = tx?.timestamp ?? tx?.createdAt;
  if (!value) return null;
  if (typeof value?.toMillis === 'function') return new Date(value.toMillis());
  if (typeof value?.toDate === 'function') return value.toDate();
  if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000);
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  return null;
}

// Milliseconds representation of a Firestore Timestamp / Date / number, for sorting.
export function requestTime(value: any): number {
  if (!value) return 0;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return 0;
}

// Format integer pence as a GBP-style string, e.g. 2450 -> "£24.50".
export function formatMoney(pence: number, symbol = '£'): string {
  const safe = Number.isFinite(pence) ? pence : 0;
  return `${symbol}${(safe / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Money insights (current month, from the wallet_transactions ledger only)
// ---------------------------------------------------------------------------

export interface MoneyInsights {
  moneyIn: number; // approved deposits + incoming approved transfers (pence)
  moneyOut: number; // withdrawals + outgoing approved transfers (pence)
}

// Money In / Money Out are derived strictly from the wallet_transactions ledger for the
// selected month. Pending transfer requests are NOT included here (see pendingOutgoingPence).
export function computeMoneyInsights(transactions: any[], now: Date = new Date()): MoneyInsights {
  let moneyIn = 0;
  let moneyOut = 0;
  for (const tx of transactions || []) {
    if (!isSameMonth(tx, now)) continue;
    const amount = signedTransactionAmount(tx);
    if (amount > 0) moneyIn += amount;
    else if (amount < 0) moneyOut += -amount;
  }
  return { moneyIn, moneyOut };
}

// Pending = outgoing transfer requests awaiting parent approval, initiated by this child.
// These are NOT wallet transactions and must never affect balance or Money Out.
// We classify "pending" via the centralised helper so every unresolved transfer
// status genuinely used by production is supported in one place.
export function pendingOutgoingPence(transferRequests: any[], childId: string): number {
  if (!childId) return 0;
  return (transferRequests || [])
    .filter(r => r?.fromChildId === childId && isPendingTransferStatus(r?.status))
    .reduce((sum, r) => sum + (Number.isInteger(r.amountPence) ? r.amountPence : 0), 0);
}

// ---------------------------------------------------------------------------
// Transaction presentation (icon / title / subtitle / direction)
// ---------------------------------------------------------------------------

export type TxDirection = 'in' | 'out' | 'neutral';

export interface TxPresentation {
  direction: TxDirection;
  title: string;
  subtitle: string;
  statusLabel: string | null;
  icon: LucideIcon;
  iconBg: string;
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export interface PresentationOptions {
  // Resolves a user id to a display name (e.g. from familyMembers + current user).
  nameResolver?: (id: string) => string | undefined;
  // The viewing child's id, used to decide direction for the legacy `transfer` type.
  currentUserId?: string;
}

// Build a display model for a single ledger transaction. Pure + safe: missing fields
// never throw, they degrade to neutral labels.
export function transactionPresentation(tx: any, opts: PresentationOptions = {}): TxPresentation {
  const { nameResolver, currentUserId } = opts;
  const amount = signedTransactionAmount(tx);
  const status = tx?.status;
  const statusLabel = status && status !== 'completed' ? capitalize(String(status)) : null;

  let direction: TxDirection = amount > 0 ? 'in' : amount < 0 ? 'out' : 'neutral';
  let title = tx?.description || '';
  let subtitle = '';
  let icon: LucideIcon = ArrowRightLeft;
  let iconBg = 'bg-gray-100 text-gray-600';

  switch (tx?.type) {
    case 'deposit': {
      const actor = nameResolver?.(tx?.parentRef) || 'Parent';
      title = tx?.description || tx?.note || 'Money added';
      subtitle = `From ${actor}`;
      icon = ArrowDownRight;
      iconBg = 'bg-success-50 text-success-600';
      break;
    }
    case 'withdrawal': {
      const actor = nameResolver?.(tx?.parentRef) || 'Parent';
      title = tx?.description || tx?.note || 'Money withdrawn';
      subtitle = `By ${actor}`;
      icon = ArrowUpRight;
      iconBg = 'bg-gray-100 text-gray-600';
      break;
    }
    case 'transfer_in': {
      const name = nameResolver?.(tx?.counterpartyChildId) || 'another child';
      title = tx?.description || 'Received';
      subtitle = status === 'completed' ? 'Approved' : statusLabel || `From ${name}`;
      icon = ArrowDownRight;
      iconBg = 'bg-success-50 text-success-600';
      break;
    }
    case 'transfer_out': {
      const name = nameResolver?.(tx?.counterpartyChildId) || 'another child';
      title = tx?.description || 'Sent';
      subtitle = status === 'completed' ? 'Approved' : statusLabel || `To ${name}`;
      icon = ArrowUpRight;
      iconBg = 'bg-gray-100 text-gray-600';
      break;
    }
    case 'request_payment': {
      title = tx?.note || 'Money received';
      subtitle = status === 'completed' ? 'Request approved' : statusLabel || 'Request';
      icon = ArrowDownRight;
      iconBg = 'bg-success-50 text-success-600';
      break;
    }
    case 'financial_penalty': {
      title = tx?.reason ? `Penalty: ${tx.reason}` : 'Penalty';
      subtitle = `By ${tx?.createdByName || 'Parent'}`;
      icon = Ban;
      iconBg = 'bg-danger-50 text-danger-600';
      break;
    }
    case 'petbox_donation': {
      title = tx?.note || 'Pet Box donation';
      subtitle = 'Pet Box';
      icon = PiggyBank;
      iconBg = 'bg-gray-100 text-gray-600';
      break;
    }
    case 'transfer': {
      // Legacy parent-initiated direct transfer. Direction depends on the viewing child.
      const isRecipient = currentUserId ? tx?.childId === currentUserId : amount > 0;
      direction = isRecipient ? 'in' : 'out';
      title = tx?.description || (isRecipient ? 'Received' : 'Sent');
      subtitle = status === 'completed' ? 'Approved' : statusLabel || '';
      icon = ArrowRightLeft;
      iconBg = direction === 'in' ? 'bg-success-50 text-success-600' : 'bg-gray-100 text-gray-600';
      break;
    }
    default: {
      title = title || tx?.type || 'Transaction';
      subtitle = statusLabel || '';
    }
  }

  return { direction, title, subtitle, statusLabel, icon, iconBg };
}

// Short, human date label for a transaction row (e.g. "15 Jul" or "14:32" for today).
export function transactionRowDate(tx: any, now: Date = new Date()): string {
  const date = transactionTimestamp(tx);
  if (!date) return '';
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfTx = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayMs = 86_400_000;
  const diffDays = Math.round((startOfToday - startOfTx) / dayMs);
  if (diffDays <= 0) {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// ---------------------------------------------------------------------------
// Date grouping for the statement view
// ---------------------------------------------------------------------------

export interface TxGroup {
  label: string;
  items: any[];
}

const GROUP_ORDER = ['Today', 'Yesterday', 'Earlier this week', 'Older'];

// Group transactions into banking-statement buckets, newest first. Transactions
// without a parseable date are placed in "Older" so they are never silently dropped.
export function groupTransactionsByDate(transactions: any[], now: Date = new Date()): TxGroup[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 86_400_000;
  const buckets: Record<string, any[]> = {};
  const seen: string[] = [];

  for (const tx of transactions || []) {
    const date = transactionTimestamp(tx);
    let label: string;
    if (!date) {
      label = 'Older';
    } else {
      const startOfTx = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
      const diffDays = Math.floor((startOfToday - startOfTx) / dayMs);
      if (diffDays <= 0) label = 'Today';
      else if (diffDays === 1) label = 'Yesterday';
      else if (diffDays <= 7) label = 'Earlier this week';
      else label = 'Older';
    }

    if (!buckets[label]) {
      buckets[label] = [];
      seen.push(label);
    }
    buckets[label].push(tx);
  }

  seen.sort((a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b));
  return seen.map(label => ({ label, items: buckets[label] }));
}

// Sort a list of transactions newest-first (defensive; the store already normalises).
export function sortTransactionsNewestFirst(transactions: any[]): any[] {
  return [...(transactions || [])].sort((a, b) => {
    const ta = transactionTimestamp(a)?.getTime() || 0;
    const tb = transactionTimestamp(b)?.getTime() || 0;
    return tb - ta || String(a?.id).localeCompare(String(b?.id));
  });
}

export { Clock };
