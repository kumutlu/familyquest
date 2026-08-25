/**
 * Transaction History v2 - Normalized Transaction Model
 * =======================================================
 * Single canonical transaction model that consolidates all transaction sources:
 * - wallet_transactions (deposits, withdrawals, transfers, request payments)
 * - reversals (reversed transactions)
 * - goal contributions/withdrawals
 * - reward redemptions
 * - behaviour events (penalties)
 * - pet box donations
 * - manual adjustments
 */

import { formatPence, currencyCodeFromSymbol } from '../i18n/format';
import { formatDate } from '../i18n/format';

// ---------------------------------------------------------------------------
// Transaction Types
// ---------------------------------------------------------------------------

export type TransactionType =
  | 'deposit'
  | 'withdrawal'
  | 'transfer_in'
  | 'transfer_out'
  | 'request_payment'
  | 'financial_penalty'
  | 'petbox_donation'
  | 'transfer'
  | 'goal_contribution'
  | 'child_contribution'
  | 'parent_contribution'
  | 'auto_match'
  | 'manual_match'
  | 'goal_withdrawal'
  | 'goal_return'
  | 'goal_closure'
  | 'reward_redemption'
  | 'manual_adjustment'
  | 'transfer_request'
  | 'money_request'
  | 'unknown';

export type TransactionDirection = 'in' | 'out' | 'neutral';

export type TransactionUnit = 'money' | 'points';

export type TransactionStatus = 'completed' | 'pending' | 'pending_approval' | 'pending_acceptance' | 'rejected' | 'cancelled' | 'reversed';

export type TransactionCategory = 'income' | 'expense' | 'reward' | 'allowance' | 'goal' | 'adjustment';

export type TransactionSource =
  | 'wallet_transaction'
  | 'reversal'
  | 'goal_ledger'
  | 'redemption'
  | 'behaviour_event'
  | 'petbox_request'
  | 'transfer_request'
  | 'money_request'
  | 'manual';

// ---------------------------------------------------------------------------
// Normalized Transaction Model
// ---------------------------------------------------------------------------

export interface NormalizedTransaction {
  /** Unique identifier */
  id: string;

  /** ISO timestamp for sorting and grouping */
  timestamp: number;

  /** Transaction type */
  type: TransactionType;

  /** Signed amount: minor currency units for money, or whole reward points. */
  amountPence: number;

  /** Currency symbol from Family Settings */
  currency: string;

  /** Denomination required to interpret and render amountPence safely. */
  unit: TransactionUnit;

  /** Direction derived from amount */
  direction: TransactionDirection;

  /** Transaction status */
  status: TransactionStatus;

  /** Display title */
  title: string;

  /** Display subtitle with context */
  subtitle: string;

  /** Icon component name */
  icon: string;

  /** Icon background color class */
  iconBg: string;

  /** Icon color class */
  iconColor: string;

  /** Balance after this transaction (if available) */
  balanceAfter?: number;

  /** Source document ID for linking */
  sourceId?: string;

  /** Source collection for linking */
  source?: TransactionSource;

  /** Related child ID (if applicable) */
  childId?: string;

  /** Related parent ID (if applicable) */
  parentRef?: string;

  /** Stored actor ID when it has a distinct semantic role from parentRef. */
  actorId?: string;

  /** Stored reviewer ID for a resolved request. */
  reviewerId?: string;

  /** Stored reviewer name snapshot for a resolved request. */
  reviewerName?: string;

  /** Related transfer sender ID (if applicable). */
  fromChildId?: string;

  /** Related transfer counterparty ID (if applicable). */
  counterpartyChildId?: string;

  /** Related goal ID (if applicable) */
  goalId?: string;

  /** Related reward ID (if applicable) */
  rewardId?: string;

  /** Related task ID (if applicable) */
  taskId?: string;

  /** Related transfer request ID (if applicable) */
  transferRequestId?: string;

  /** Related money request ID (if applicable) */
  moneyRequestId?: string;

  /** Related fund ID (if applicable) */
  fundId?: string;

  /** Related Pet Box name (if applicable) */
  fundName?: string;

  /** Reversal ID (if this transaction was reversed) */
  reversalId?: string;

  /** Reversal reason (if reversed) */
  reversalReason?: string;

  /** Reversal actor name */
  reversalActorName?: string;

  /** Stored ID of the actor that reversed this transaction. */
  reversalActorId?: string;

  /** Reversal timestamp */
  reversalOccurredAt?: number;

  /** Free-text note */
  note?: string;

  /** Whether this transaction can be reversed */
  reversible: boolean;

  /** Search text for filtering */
  searchText: string;

  /** Category for filtering */
  category: TransactionCategory;

  /** Whether this is pending */
  isPending: boolean;

  /** Whether this is completed */
  isCompleted: boolean;

  /** Whether this is reversed */
  isReversed: boolean;
}

// ---------------------------------------------------------------------------
// Transaction Type Icons
// ---------------------------------------------------------------------------

export const TRANSACTION_ICONS: Record<TransactionType, string> = {
  deposit: 'ArrowDownRight',
  withdrawal: 'ArrowUpRight',
  transfer_in: 'ArrowDownRight',
  transfer_out: 'ArrowUpRight',
  request_payment: 'ArrowDownRight',
  financial_penalty: 'Ban',
  petbox_donation: 'PiggyBank',
  transfer: 'ArrowRightLeft',
  goal_contribution: 'Target',
  child_contribution: 'Target',
  parent_contribution: 'UserPlus',
  auto_match: 'Sparkles',
  manual_match: 'Star',
  goal_withdrawal: 'Target',
  goal_return: 'Target',
  goal_closure: 'Flag',
  reward_redemption: 'Gift',
  manual_adjustment: 'Settings',
  transfer_request: 'ArrowRightLeft',
  money_request: 'ArrowDownRight',
  unknown: 'Transaction',
};

// ---------------------------------------------------------------------------
// Transaction Type Colors
// ---------------------------------------------------------------------------

export const TRANSACTION_COLORS: Record<TransactionType, { bg: string; text: string }> = {
  deposit: { bg: 'bg-success-50', text: 'text-success-600' },
  withdrawal: { bg: 'bg-gray-100', text: 'text-gray-900' },
  transfer_in: { bg: 'bg-success-50', text: 'text-success-600' },
  transfer_out: { bg: 'bg-gray-100', text: 'text-gray-900' },
  request_payment: { bg: 'bg-success-50', text: 'text-success-600' },
  financial_penalty: { bg: 'bg-danger-50', text: 'text-danger-600' },
  petbox_donation: { bg: 'bg-gray-100', text: 'text-gray-600' },
  transfer: { bg: 'bg-gray-100', text: 'text-gray-900' },
  goal_contribution: { bg: 'bg-primary-50', text: 'text-primary-600' },
  child_contribution: { bg: 'bg-primary-50', text: 'text-primary-600' },
  parent_contribution: { bg: 'bg-primary-50', text: 'text-primary-600' },
  auto_match: { bg: 'bg-purple-50', text: 'text-purple-600' },
  manual_match: { bg: 'bg-yellow-50', text: 'text-yellow-600' },
  goal_withdrawal: { bg: 'bg-primary-50', text: 'text-primary-600' },
  goal_return: { bg: 'bg-success-50', text: 'text-success-600' },
  goal_closure: { bg: 'bg-primary-50', text: 'text-primary-600' },
  reward_redemption: { bg: 'bg-reward-50', text: 'text-reward-600' },
  manual_adjustment: { bg: 'bg-gray-100', text: 'text-gray-600' },
  transfer_request: { bg: 'bg-gray-100', text: 'text-gray-900' },
  money_request: { bg: 'bg-success-50', text: 'text-success-600' },
  unknown: { bg: 'bg-gray-100', text: 'text-gray-600' },
};

// ---------------------------------------------------------------------------
// Category Mapping
// ---------------------------------------------------------------------------

export const TRANSACTION_CATEGORIES: Record<TransactionType, TransactionCategory> = {
  deposit: 'income',
  withdrawal: 'expense',
  transfer_in: 'income',
  transfer_out: 'expense',
  request_payment: 'income',
  financial_penalty: 'expense',
  petbox_donation: 'expense',
  transfer: 'income', // direction-dependent
  goal_contribution: 'goal',
  child_contribution: 'goal',
  parent_contribution: 'goal',
  auto_match: 'goal',
  manual_match: 'goal',
  goal_withdrawal: 'goal',
  goal_return: 'income',
  goal_closure: 'goal',
  reward_redemption: 'reward',
  manual_adjustment: 'adjustment',
  transfer_request: 'income', // direction-dependent
  money_request: 'income', // direction-dependent
  unknown: 'adjustment',
};

// ---------------------------------------------------------------------------
// Status Helpers
// ---------------------------------------------------------------------------

export function isPendingStatus(status: TransactionStatus): boolean {
  return status === 'pending' || status === 'pending_approval' || status === 'pending_acceptance';
}

export function isCompletedStatus(status: TransactionStatus): boolean {
  return status === 'completed';
}

export function isReversedStatus(status: TransactionStatus): boolean {
  return status === 'reversed';
}

// ---------------------------------------------------------------------------
// Amount Helpers
// ---------------------------------------------------------------------------

export function getTransactionAmountPence(tx: NormalizedTransaction): number {
  return tx.amountPence;
}

export type TransactionPointsFormatter = (points: number) => string;

export function getTransactionDisplayAmount(
  tx: NormalizedTransaction,
  formatPoints: TransactionPointsFormatter = points => `${points} points`,
): string {
  if (tx.unit === 'points') return formatPoints(Math.abs(tx.amountPence));
  return formatPence(Math.abs(tx.amountPence), currencyCodeFromSymbol(tx.currency));
}

export function getTransactionAmountPrefix(tx: NormalizedTransaction): string {
  if (tx.direction === 'in') return '+';
  if (tx.direction === 'out') return '-';
  return '';
}

// ---------------------------------------------------------------------------
// Date Helpers
// ---------------------------------------------------------------------------

export function getTransactionTimestamp(tx: NormalizedTransaction): number {
  return tx.timestamp;
}

export function formatTransactionTime(tx: NormalizedTransaction, locale?: string): string {
  const date = new Date(tx.timestamp);
  return formatDate(date, locale, { hour: '2-digit', minute: '2-digit' });
}

export function formatTransactionDate(tx: NormalizedTransaction, locale?: string): string {
  const date = new Date(tx.timestamp);
  return formatDate(date, locale, { day: 'numeric', month: 'short' });
}

// ---------------------------------------------------------------------------
// Search Text Builder
// ---------------------------------------------------------------------------

export function buildSearchText(tx: NormalizedTransaction): string {
  const parts: string[] = [];

  if (tx.title) parts.push(tx.title);
  if (tx.subtitle) parts.push(tx.subtitle);
  if (tx.note) parts.push(tx.note);
  if (tx.childId) parts.push(tx.childId);
  if (tx.taskId) parts.push(tx.taskId);
  if (tx.rewardId) parts.push(tx.rewardId);

  return parts.join(' ').toLowerCase();
}

// ---------------------------------------------------------------------------
// Category Determination
// ---------------------------------------------------------------------------

export function determineCategory(tx: NormalizedTransaction): TransactionCategory {
  // If reversed, use the original category
  if (tx.isReversed) {
    return tx.category;
  }

  // Direction-based for income/expense
  if (tx.direction === 'in') {
    if (tx.type === 'reward_redemption') return 'reward';
    if (tx.type.startsWith('goal_') || tx.type === 'child_contribution') return 'goal';
    return 'income';
  }

  if (tx.direction === 'out') {
    if (tx.type === 'reward_redemption') return 'reward';
    if (tx.type.startsWith('goal_') || tx.type === 'child_contribution') return 'goal';
    return 'expense';
  }

  return 'adjustment';
}

// ---------------------------------------------------------------------------
// Reversible Check
// ---------------------------------------------------------------------------

export function isReversibleType(type: TransactionType): boolean {
  return [
    'deposit',
    'withdrawal',
    'transfer_in',
    'transfer_out',
    'request_payment',
    'transfer',
    'financial_penalty',
    'petbox_donation',
    'goal_contribution',
    'child_contribution',
    'goal_withdrawal',
    'reward_redemption',
  ].includes(type);
}

// ---------------------------------------------------------------------------
// Translation Keys
// ---------------------------------------------------------------------------

export const TRANSACTION_TRANSLATION_KEYS = {
  type: {
    deposit: 'tx.deposit',
    withdrawal: 'tx.withdrawn',
    transfer_in: 'tx.received',
    transfer_out: 'tx.sent',
    request_payment: 'tx.moneyReceived',
    financial_penalty: 'tx.penalty',
    petbox_donation: 'tx.petBoxDonation',
    transfer: 'tx.transfer',
    goal_contribution: 'goals:contribution',
    child_contribution: 'goals:contribution',
    parent_contribution: 'goals:parentContribution',
    auto_match: 'goals:autoMatch',
    manual_match: 'goals:manualMatch',
    goal_withdrawal: 'goals:withdrawal',
    goal_return: 'goals:return',
    goal_closure: 'goals:closure',
    reward_redemption: 'rewards:redemption',
    manual_adjustment: 'tx.adjustment',
    transfer_request: 'tx.transfer',
    money_request: 'tx.moneyReceived',
    unknown: 'tx.transaction',
  },
  category: {
    income: 'history:income',
    expense: 'history:expense',
    reward: 'history:rewards',
    allowance: 'history:allowances',
    goal: 'history:goals',
    adjustment: 'history:adjustments',
  },
} as const;
