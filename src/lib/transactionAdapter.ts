/**
 * Transaction History v2 - Transaction Adapter
 * =============================================
 * Pure adapters for the heterogeneous history records stored by FamilyQuest.
 */

import type { TFunction } from 'i18next';
import {
  TRANSACTION_CATEGORIES,
  TRANSACTION_COLORS,
  TRANSACTION_ICONS,
  isCompletedStatus,
  isPendingStatus,
  isReversibleType,
  type NormalizedTransaction,
  type TransactionCategory,
  type TransactionDirection,
  type TransactionSource,
  type TransactionStatus,
  type TransactionType,
  type TransactionUnit,
} from './transactionModel';

export type { NormalizedTransaction } from './transactionModel';

// ---------------------------------------------------------------------------
// Adapter Options
// ---------------------------------------------------------------------------

export interface TransactionAdapterOptions {
  t?: TFunction<'wallet' | 'goals' | 'rewards' | 'reversals'>;
  currency?: string;
  nameResolver?: (id: string) => string | undefined;
  taskResolver?: (id: string) => { title?: string; pointsReward?: number } | undefined;
  rewardResolver?: (id: string) => { title?: string } | undefined;
  fundResolver?: (id: string) => { name?: string } | undefined;
  currentUserId?: string;
  familyId?: string;
  goalResolver?: (id: string) => { title?: string; targetAmountPence?: number; currentAmountPence?: number } | undefined;
}

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

export type TransactionFilter =
  | 'all'
  | 'income'
  | 'expense'
  | 'reward'
  | 'allowance'
  | 'goal'
  | 'adjustment'
  | 'pending'
  | 'completed'
  | 'reversed';

export type DateGroupKey = 'today' | 'yesterday' | 'earlierThisWeek' | 'older';

export interface TransactionGroup {
  key: DateGroupKey;
  label: string;
  items: NormalizedTransaction[];
}

export interface WeekGroup {
  label: string;
  items: NormalizedTransaction[];
}

export interface MonthGroup {
  label: string;
  items: NormalizedTransaction[];
}

export interface AdaptAllTransactionsParams {
  walletTransactions?: readonly unknown[];
  reversals?: readonly unknown[];
  goalLedger?: readonly unknown[];
  redemptions?: readonly unknown[];
  behaviourEvents?: readonly unknown[];
  petboxRequests?: readonly unknown[];
  transferRequests?: readonly unknown[];
  moneyRequests?: readonly unknown[];
  opts: TransactionAdapterOptions;
}

// ---------------------------------------------------------------------------
// Source Records and Guards
// ---------------------------------------------------------------------------

type SourceRecord = Record<string, unknown>;

interface WalletRecord extends SourceRecord {
  id: string;
  type: string;
}

interface GoalLedgerRecord extends SourceRecord {
  goalId: string;
  type: string;
  amountPence: number;
}

interface RedemptionRecord extends SourceRecord {
  id: string;
  rewardId: string;
  userId: string;
  costPaid: number;
}

interface BehaviourRecord extends SourceRecord {
  id: string;
  childId: string;
  type: 'financial';
  walletDelta: number;
}

interface PetboxRequestRecord extends SourceRecord {
  id: string;
  fundId: string;
  childId: string;
  amountPence: number;
}

interface TransferRequestRecord extends SourceRecord {
  id: string;
  fromChildId: string;
  toChildId: string;
  amountPence: number;
}

interface MoneyRequestRecord extends SourceRecord {
  id: string;
  requesterId: string;
  requestedFromId: string;
  amountPence: number;
}

interface ReversalRecord extends SourceRecord {
  id: string;
  sourceKind: string;
  sourceId: string;
}

const walletTypes = new Set<TransactionType>([
  'deposit',
  'withdrawal',
  'transfer_in',
  'transfer_out',
  'request_payment',
  'financial_penalty',
  'petbox_donation',
  'transfer',
  'goal_contribution',
  'goal_withdrawal',
  'goal_return',
  'manual_adjustment',
]);

const goalLedgerTypes = new Set([
  'child_contribution',
  'parent_contribution',
  'auto_match',
  'manual_match',
  'child_withdrawal',
  'completion_refund',
  'external_closure',
]);

function isRecord(value: unknown): value is SourceRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonZeroSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value !== 0;
}

function isPositivePence(value: unknown): value is number {
  return isNonZeroSafeInteger(value) && value > 0;
}

function isNegativePence(value: unknown): value is number {
  return isNonZeroSafeInteger(value) && value < 0;
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isWalletRecord(value: unknown): value is WalletRecord {
  return isRecord(value)
    && isString(value.id)
    && isString(value.type)
    && walletTypes.has(value.type as TransactionType)
    && (isNonZeroSafeInteger(value.amountPence) || isNonZeroSafeInteger(value.amount));
}

function isGoalLedgerRecord(value: unknown): value is GoalLedgerRecord {
  return isRecord(value)
    && (isString(value.entryId) || isString(value.id))
    && isString(value.goalId)
    && isString(value.type)
    && goalLedgerTypes.has(value.type)
    && (['child_withdrawal', 'completion_refund', 'external_closure'].includes(value.type)
      ? isNegativePence(value.amountPence)
      : isPositivePence(value.amountPence));
}

function isRedemptionRecord(value: unknown): value is RedemptionRecord {
  return isRecord(value)
    && isString(value.id)
    && isString(value.rewardId)
    && isString(value.userId)
    && isPositivePence(value.costPaid);
}

function isBehaviourRecord(value: unknown): value is BehaviourRecord {
  return isRecord(value)
    && isString(value.id)
    && isString(value.childId)
    && value.type === 'financial'
    && isNegativePence(value.walletDelta);
}

function isPetboxRequestRecord(value: unknown): value is PetboxRequestRecord {
  return isRecord(value)
    && isString(value.id)
    && isString(value.fundId)
    && isString(value.childId)
    && isPositivePence(value.amountPence);
}

function isTransferRequestRecord(value: unknown): value is TransferRequestRecord {
  return isRecord(value)
    && isString(value.id)
    && isString(value.fromChildId)
    && isString(value.toChildId)
    && isPositivePence(value.amountPence);
}

function isMoneyRequestRecord(value: unknown): value is MoneyRequestRecord {
  return isRecord(value)
    && isString(value.id)
    && isString(value.requesterId)
    && isString(value.requestedFromId)
    && isPositivePence(value.amountPence);
}

function isReversalRecord(value: unknown): value is ReversalRecord {
  return isRecord(value)
    && (isString(value.id) || isString(value.reversalId))
    && isString(value.sourceKind)
    && isString(value.sourceId);
}

// ---------------------------------------------------------------------------
// Shared Normalization Helpers
// ---------------------------------------------------------------------------

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return isFiniteNumber(value) ? value : undefined;
}

function toEpochMillis(value: unknown): number {
  if (isFiniteNumber(value)) return value;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;
  if (!isRecord(value)) return 0;

  try {
    if (typeof value.toMillis === 'function') {
      const millis = value.toMillis();
      return isFiniteNumber(millis) ? millis : 0;
    }
    if (typeof value.toDate === 'function') {
      const date = value.toDate();
      return date instanceof Date && Number.isFinite(date.getTime()) ? date.getTime() : 0;
    }
  } catch {
    return 0;
  }

  if (isFiniteNumber(value.seconds)) {
    const nanoseconds = isFiniteNumber(value.nanoseconds) ? value.nanoseconds : 0;
    return value.seconds * 1000 + Math.floor(nanoseconds / 1_000_000);
  }
  return 0;
}

function timestampFrom(...values: unknown[]): number {
  for (const value of values) {
    const timestamp = toEpochMillis(value);
    if (timestamp !== 0) return timestamp;
  }
  return 0;
}

function statusFrom(value: unknown, fallback: TransactionStatus = 'completed'): TransactionStatus {
  if (value === 'approved') return 'completed';
  if (
    value === 'completed'
    || value === 'pending'
    || value === 'pending_approval'
    || value === 'pending_acceptance'
    || value === 'rejected'
    || value === 'cancelled'
    || value === 'reversed'
  ) return value;
  return fallback;
}

function directionFromAmount(amountPence: number): TransactionDirection {
  if (amountPence > 0) return 'in';
  if (amountPence < 0) return 'out';
  return 'neutral';
}

function translate<Namespace extends 'wallet' | 'goals' | 'rewards' | 'reversals'>(
  t: TFunction<Namespace> | undefined,
  key: string,
  fallback: string,
  values: Readonly<Record<string, string | number>> = {},
): string {
  if (!t) return fallback;
  const translated = t(key as never, { ...values, defaultValue: fallback });
  return typeof translated === 'string' ? translated : fallback;
}

interface TransactionSeed {
  id: string;
  timestamp: number;
  type: TransactionType;
  amountPence: number;
  unit?: TransactionUnit;
  status: TransactionStatus;
  title: string;
  subtitle: string;
  source: TransactionSource;
  sourceId?: string;
  direction?: TransactionDirection;
  category?: TransactionCategory;
  childId?: string;
  parentRef?: string;
  goalId?: string;
  rewardId?: string;
  transferRequestId?: string;
  moneyRequestId?: string;
  fundId?: string;
  fundName?: string;
  note?: string;
  balanceAfter?: number;
  searchTerms?: readonly (string | undefined)[];
}

function buildTransaction(
  seed: TransactionSeed,
  opts: TransactionAdapterOptions,
  reversal?: ReversalRecord,
): NormalizedTransaction {
  const status: TransactionStatus = reversal ? 'reversed' : seed.status;
  const direction = seed.direction ?? directionFromAmount(seed.amountPence);
  const category = seed.category
    ?? (seed.type === 'transfer' || seed.type === 'transfer_request' || seed.type === 'money_request'
      ? direction === 'out' ? 'expense' : direction === 'in' ? 'income' : 'adjustment'
      : TRANSACTION_CATEGORIES[seed.type]);
  const isReversed = status === 'reversed';
  const colors = TRANSACTION_COLORS[seed.type];
  const reversalId = reversal ? stringValue(reversal.reversalId) ?? reversal.id : undefined;
  const reversalOccurredAt = reversal
    ? timestampFrom(reversal.completedAt, reversal.createdAt)
    : undefined;
  const transaction: NormalizedTransaction = {
    id: seed.id,
    timestamp: seed.timestamp,
    type: seed.type,
    amountPence: seed.amountPence,
    currency: opts.currency ?? '£',
    unit: seed.unit ?? 'money',
    direction,
    status,
    title: seed.title,
    subtitle: seed.subtitle,
    icon: TRANSACTION_ICONS[seed.type],
    iconBg: colors.bg,
    iconColor: colors.text,
    balanceAfter: seed.balanceAfter,
    sourceId: seed.sourceId ?? seed.id,
    source: seed.source,
    childId: seed.childId,
    parentRef: seed.parentRef,
    goalId: seed.goalId,
    rewardId: seed.rewardId,
    transferRequestId: seed.transferRequestId,
    moneyRequestId: seed.moneyRequestId,
    fundId: seed.fundId,
    fundName: seed.fundName,
    reversalId,
    reversalReason: reversal ? stringValue(reversal.reason) : undefined,
    reversalActorName: reversal ? stringValue(reversal.actorName) : undefined,
    reversalOccurredAt,
    note: seed.note,
    reversible: isReversibleType(seed.type) && isCompletedStatus(status) && !isReversed,
    searchText: '',
    category,
    isPending: isPendingStatus(status),
    isCompleted: isCompletedStatus(status),
    isReversed,
  };
  transaction.searchText = [
    seed.title,
    seed.subtitle,
    seed.note,
    seed.childId,
    seed.parentRef,
    seed.goalId,
    seed.rewardId,
    seed.transferRequestId,
    seed.moneyRequestId,
    seed.fundId,
    seed.fundName,
    ...(seed.searchTerms ?? []),
  ].filter(isString).join(' ').toLocaleLowerCase();
  return transaction;
}

function reversalIndex(records: readonly unknown[]): Map<string, ReversalRecord> {
  const result = new Map<string, ReversalRecord>();
  for (const value of records) {
    if (!isReversalRecord(value)) continue;
    result.set(`${value.sourceKind}:${value.sourceId}`, value);
  }
  return result;
}

function getReversal(index: Map<string, ReversalRecord>, source: string, id: string): ReversalRecord | undefined {
  return index.get(`${source}:${id}`);
}

function getWalletReversal(index: Map<string, ReversalRecord>, record: WalletRecord): ReversalRecord | undefined {
  const direct = getReversal(index, 'wallet_transaction', record.id);
  if (direct) return direct;
  const sourceId = stringValue(record.sourceId) ?? stringValue(record.eventId);
  if (record.type === 'financial_penalty' && sourceId) return getReversal(index, 'behaviour_event', sourceId);
  if (record.type === 'petbox_donation' && sourceId) return getReversal(index, 'petbox_request', sourceId);
  const transferRequestId = stringValue(record.transferRequestId);
  if (transferRequestId) return getReversal(index, 'transfer_request', transferRequestId);
  const moneyRequestId = stringValue(record.moneyRequestId);
  if (moneyRequestId) return getReversal(index, 'money_request', moneyRequestId);
  return undefined;
}

function walletAmount(record: WalletRecord, type: TransactionType, currentUserId?: string): number {
  const raw = numberValue(record.amountPence) ?? numberValue(record.amount) ?? 0;
  const amount = Math.abs(raw);
  switch (type) {
    case 'deposit':
    case 'transfer_in':
    case 'request_payment':
    case 'goal_return':
      return amount;
    case 'withdrawal':
    case 'transfer_out':
    case 'financial_penalty':
    case 'petbox_donation':
    case 'goal_contribution':
    case 'goal_withdrawal':
      return -amount;
    case 'transfer':
      return currentUserId && currentUserId === record.fromChildId ? -amount : amount;
    default:
      return raw;
  }
}

function walletTitle(type: TransactionType, opts: TransactionAdapterOptions): string {
  const titles: Partial<Record<TransactionType, [string, string]>> = {
    deposit: ['tx.deposit', 'Money added'],
    withdrawal: ['tx.withdrawn', 'Money withdrawn'],
    transfer_in: ['tx.received', 'Received'],
    transfer_out: ['tx.sent', 'Sent'],
    request_payment: ['tx.moneyReceived', 'Money received'],
    financial_penalty: ['tx.penalty', 'Penalty'],
    petbox_donation: ['tx.petBoxDonation', 'Pet Box donation'],
    transfer: ['tx.transfer', 'Transfer'],
    goal_contribution: ['goals:contribution', 'Goal contribution'],
    goal_withdrawal: ['goals:withdrawal', 'Goal withdrawal'],
    goal_return: ['goals:return', 'Goal return'],
    manual_adjustment: ['tx.adjustment', 'Adjustment'],
  };
  const [key, fallback] = titles[type] ?? ['tx.transaction', 'Transaction'];
  return translate(opts.t, key, fallback);
}

function normalizeWallet(
  record: WalletRecord,
  opts: TransactionAdapterOptions,
  reversals: Map<string, ReversalRecord>,
): NormalizedTransaction {
  const type = record.type as TransactionType;
  const amountPence = walletAmount(record, type, opts.currentUserId);
  const childId = stringValue(record.childId);
  const parentRef = stringValue(record.parentRef) ?? stringValue(record.createdBy);
  const counterpartyId = stringValue(record.counterpartyChildId);
  const fromChildId = stringValue(record.fromChildId);
  const goalId = stringValue(record.goalId);
  const fundId = stringValue(record.fundId);
  const actorName = parentRef ? opts.nameResolver?.(parentRef) : stringValue(record.createdByName);
  const childName = childId ? opts.nameResolver?.(childId) : undefined;
  const counterpartyName = counterpartyId ? opts.nameResolver?.(counterpartyId) : undefined;
  const fromName = fromChildId ? opts.nameResolver?.(fromChildId) : undefined;
  const goalName = goalId ? opts.goalResolver?.(goalId)?.title : undefined;
  const fundName = stringValue(record.fundName) ?? (fundId ? opts.fundResolver?.(fundId)?.name : undefined);
  let subtitle = stringValue(record.description) ?? '';
  if (!subtitle) {
    if (type === 'deposit') subtitle = actorName
      ? translate(opts.t, 'tx.depositFrom', actorName, { actor: actorName })
      : childName ?? '';
    else if (type === 'withdrawal') subtitle = actorName
      ? translate(opts.t, 'tx.withdrawnBy', actorName, { actor: actorName })
      : childName ?? '';
    else if (type === 'transfer_in') subtitle = counterpartyName
      ? translate(opts.t, 'tx.from', counterpartyName, { name: counterpartyName })
      : '';
    else if (type === 'transfer_out') subtitle = counterpartyName
      ? translate(opts.t, 'tx.to', counterpartyName, { name: counterpartyName })
      : '';
    else if (type === 'transfer') subtitle = fromName && childName
      ? translate(opts.t, 'tx.transferBetween', `${fromName} → ${childName}`, {
        from: fromName,
        to: childName,
      })
      : fromName ?? childName ?? '';
    else if (goalName) subtitle = goalName;
    else if (fundName) subtitle = fundName;
    else subtitle = actorName ?? childName ?? '';
  }
  const sourceId = stringValue(record.sourceId) ?? record.id;
  const transferRequestId = stringValue(record.transferRequestId);
  const moneyRequestId = stringValue(record.moneyRequestId);
  const direction: TransactionDirection | undefined = type === 'transfer'
    ? opts.currentUserId === fromChildId
      ? 'out'
      : opts.currentUserId === childId
        ? 'in'
        : 'neutral'
    : undefined;
  const note = stringValue(record.note) ?? stringValue(record.reason);
  const category = type === 'deposit' && note && /\ballowance\b/i.test(note)
    ? 'allowance'
    : undefined;
  return buildTransaction({
    id: record.id,
    timestamp: timestampFrom(record.timestamp, record.createdAt),
    type,
    amountPence,
    direction,
    status: statusFrom(record.status),
    title: walletTitle(type, opts),
    subtitle,
    source: 'wallet_transaction',
    sourceId,
    category,
    childId,
    parentRef,
    goalId,
    transferRequestId,
    moneyRequestId,
    fundId,
    fundName,
    note,
    balanceAfter: numberValue(record.balanceAfter),
    searchTerms: [actorName, childName, counterpartyName, fromName, goalName, fundName],
  }, opts, getWalletReversal(reversals, record));
}

function normalizeGoalLedger(record: GoalLedgerRecord, opts: TransactionAdapterOptions): NormalizedTransaction {
  const mapping: Record<string, TransactionType> = {
    child_contribution: 'child_contribution',
    parent_contribution: 'parent_contribution',
    auto_match: 'auto_match',
    manual_match: 'manual_match',
    child_withdrawal: 'goal_withdrawal',
    completion_refund: 'goal_return',
    external_closure: 'goal_closure',
  };
  const type = mapping[record.type] ?? 'unknown';
  const amount = Math.abs(record.amountPence);
  const amountPence = record.type === 'child_contribution' || record.type === 'external_closure'
    ? -amount
    : amount;
  const ownerId = stringValue(record.ownerId);
  const ownerName = ownerId ? opts.nameResolver?.(ownerId) : undefined;
  const goalName = opts.goalResolver?.(record.goalId)?.title;
  const title = goalLedgerTitle(type, opts);
  const id = stringValue(record.entryId) ?? stringValue(record.id) ?? `${record.goalId}:${record.type}`;
  return buildTransaction({
    id,
    timestamp: timestampFrom(record.createdAt),
    type,
    amountPence,
    status: 'completed',
    title,
    subtitle: [goalName, ownerName].filter(isString).join(' · '),
    source: 'goal_ledger',
    sourceId: id,
    category: 'goal',
    childId: record.type === 'child_contribution' || record.type === 'child_withdrawal' ? ownerId : undefined,
    parentRef: record.type === 'parent_contribution' || record.type.includes('match') ? ownerId : undefined,
    goalId: record.goalId,
    note: stringValue(record.note),
    searchTerms: [goalName, ownerName],
  }, opts);
}

function goalLedgerTitle(type: TransactionType, opts: TransactionAdapterOptions): string {
  const titles: Partial<Record<TransactionType, [string, string]>> = {
    child_contribution: ['goals:contribution', 'Goal contribution'],
    parent_contribution: ['goals:parentContribution', 'Parent contribution'],
    auto_match: ['goals:autoMatch', 'Automatic match'],
    manual_match: ['goals:manualMatch', 'Manual match'],
    goal_withdrawal: ['goals:withdrawal', 'Goal withdrawal'],
    goal_return: ['goals:return', 'Goal return'],
    goal_closure: ['goals:closure', 'Goal closure'],
  };
  const [key, fallback] = titles[type] ?? ['tx.transaction', 'Transaction'];
  return translate(opts.t, key, fallback);
}

function normalizeRedemption(
  record: RedemptionRecord,
  opts: TransactionAdapterOptions,
  reversals: Map<string, ReversalRecord>,
): NormalizedTransaction {
  const rewardName = opts.rewardResolver?.(record.rewardId)?.title;
  const childName = opts.nameResolver?.(record.userId);
  return buildTransaction({
    id: record.id,
    timestamp: timestampFrom(record.redeemedAt, record.createdAt),
    type: 'reward_redemption',
    amountPence: -Math.abs(record.costPaid),
    unit: 'points',
    status: statusFrom(record.status),
    title: translate(opts.t, 'rewards:redemption', 'Reward redeemed'),
    subtitle: rewardName ?? childName ?? '',
    source: 'redemption',
    sourceId: stringValue(record.sourceId) ?? record.id,
    category: 'reward',
    childId: record.userId,
    rewardId: record.rewardId,
    note: stringValue(record.message),
    searchTerms: [rewardName, childName],
  }, opts, getReversal(reversals, 'reward_redemption', record.id));
}

function normalizeBehaviour(
  record: BehaviourRecord,
  opts: TransactionAdapterOptions,
  reversals: Map<string, ReversalRecord>,
): NormalizedTransaction {
  const creatorId = stringValue(record.createdBy);
  const creatorName = stringValue(record.createdByName) ?? (creatorId ? opts.nameResolver?.(creatorId) : undefined);
  const childName = opts.nameResolver?.(record.childId);
  const reason = stringValue(record.reason);
  const generatedSubtitle = childName && creatorName
    ? translate(opts.t, 'tx.behaviourBy', `${childName} · ${creatorName}`, {
      child: childName,
      actor: creatorName,
    })
    : childName ?? creatorName ?? '';
  return buildTransaction({
    id: record.id,
    timestamp: timestampFrom(record.createdAt, record.timestamp),
    type: 'financial_penalty',
    amountPence: -Math.abs(record.walletDelta),
    status: 'completed',
    title: translate(opts.t, 'tx.penalty', 'Penalty'),
    subtitle: reason ?? generatedSubtitle,
    source: 'behaviour_event',
    sourceId: record.id,
    childId: record.childId,
    parentRef: creatorId,
    note: reason,
    searchTerms: [creatorName, childName],
  }, opts, getReversal(reversals, 'behaviour_event', record.id));
}

function normalizePetbox(
  record: PetboxRequestRecord,
  opts: TransactionAdapterOptions,
  reversals: Map<string, ReversalRecord>,
): NormalizedTransaction {
  const fundName = stringValue(record.fundName) ?? opts.fundResolver?.(record.fundId)?.name;
  const childName = stringValue(record.childName) ?? opts.nameResolver?.(record.childId);
  return buildTransaction({
    id: record.id,
    timestamp: timestampFrom(record.createdAt, record.reviewedAt),
    type: 'petbox_donation',
    amountPence: -Math.abs(record.amountPence),
    status: statusFrom(record.status, 'pending'),
    title: translate(opts.t, 'tx.petBoxDonation', 'Pet Box donation'),
    subtitle: fundName ?? '',
    source: 'petbox_request',
    sourceId: record.id,
    childId: record.childId,
    fundId: record.fundId,
    fundName,
    note: stringValue(record.message) ?? stringValue(record.rejectionReason),
    searchTerms: [childName, fundName],
  }, opts, getReversal(reversals, 'petbox_request', record.id));
}

function normalizeTransferRequest(
  record: TransferRequestRecord,
  opts: TransactionAdapterOptions,
  reversals: Map<string, ReversalRecord>,
): NormalizedTransaction {
  const fromName = stringValue(record.fromChildName) ?? opts.nameResolver?.(record.fromChildId);
  const toName = stringValue(record.toChildName) ?? opts.nameResolver?.(record.toChildId);
  const isRecipient = opts.currentUserId === record.toChildId;
  const isSender = opts.currentUserId === record.fromChildId;
  const direction: TransactionDirection = isRecipient ? 'in' : isSender ? 'out' : 'neutral';
  const amountPence = isSender ? -Math.abs(record.amountPence) : Math.abs(record.amountPence);
  return buildTransaction({
    id: record.id,
    timestamp: timestampFrom(record.createdAt, record.reviewedAt),
    type: 'transfer_request',
    amountPence,
    direction,
    status: statusFrom(record.status, 'pending'),
    title: translate(opts.t, 'tx.transfer', 'Transfer request'),
    subtitle: fromName && toName
      ? translate(opts.t, 'tx.transferBetween', `${fromName} → ${toName}`, {
        from: fromName,
        to: toName,
      })
      : fromName ?? toName ?? '',
    source: 'transfer_request',
    sourceId: record.id,
    childId: record.fromChildId,
    transferRequestId: record.id,
    note: stringValue(record.message) ?? stringValue(record.rejectionReason),
    searchTerms: [fromName, toName],
  }, opts, getReversal(reversals, 'transfer_request', record.id));
}

function normalizeMoneyRequest(
  record: MoneyRequestRecord,
  opts: TransactionAdapterOptions,
  reversals: Map<string, ReversalRecord>,
): NormalizedTransaction {
  const requesterName = stringValue(record.requesterName) ?? opts.nameResolver?.(record.requesterId);
  const requestedFromName = stringValue(record.requestedFromName) ?? opts.nameResolver?.(record.requestedFromId);
  const isRequester = opts.currentUserId === record.requesterId;
  const isPayer = opts.currentUserId === record.requestedFromId;
  const direction: TransactionDirection = isRequester ? 'in' : isPayer ? 'out' : 'neutral';
  const amountPence = isPayer ? -Math.abs(record.amountPence) : Math.abs(record.amountPence);
  return buildTransaction({
    id: record.id,
    timestamp: timestampFrom(record.createdAt, record.reviewedAt),
    type: 'money_request',
    amountPence,
    direction,
    status: statusFrom(record.status, 'pending'),
    title: translate(opts.t, 'tx.moneyReceived', 'Money request'),
    subtitle: requesterName && requestedFromName
      ? translate(opts.t, 'tx.moneyRequestBetween', `${requesterName} ← ${requestedFromName}`, {
        requester: requesterName,
        requestedFrom: requestedFromName,
      })
      : requesterName ?? requestedFromName ?? '',
    source: 'money_request',
    sourceId: record.id,
    childId: record.requesterId,
    moneyRequestId: record.id,
    note: stringValue(record.message) ?? stringValue(record.rejectionReason),
    searchTerms: [requesterName, requestedFromName],
  }, opts, getReversal(reversals, 'money_request', record.id));
}

interface WalletLinks {
  behaviourIds: Set<string>;
  petboxIds: Set<string>;
  transferIds: Set<string>;
  moneyRequestIds: Set<string>;
}

function collectWalletLinks(records: readonly WalletRecord[]): WalletLinks {
  const links: WalletLinks = {
    behaviourIds: new Set(),
    petboxIds: new Set(),
    transferIds: new Set(),
    moneyRequestIds: new Set(),
  };
  for (const record of records) {
    const sourceId = stringValue(record.sourceId) ?? stringValue(record.eventId);
    if (record.type === 'financial_penalty' && sourceId) links.behaviourIds.add(sourceId);
    if (record.type === 'petbox_donation' && sourceId) links.petboxIds.add(sourceId);
    const transferRequestId = stringValue(record.transferRequestId);
    if (transferRequestId) links.transferIds.add(transferRequestId);
    const moneyRequestId = stringValue(record.moneyRequestId);
    if (moneyRequestId) links.moneyRequestIds.add(moneyRequestId);
  }
  return links;
}

function hasCanonicalGoalWalletRow(record: GoalLedgerRecord, walletRecords: readonly WalletRecord[]): boolean {
  const expectedWalletType = record.type === 'child_contribution'
    ? 'goal_contribution'
    : record.type === 'child_withdrawal' || record.type === 'completion_refund'
      ? 'goal_return'
      : undefined;
  if (!expectedWalletType) return false;
  const ledgerTimestamp = timestampFrom(record.createdAt);
  if (ledgerTimestamp === 0) return false;
  return walletRecords.some(wallet => wallet.type === expectedWalletType
    && wallet.goalId === record.goalId
    && wallet.childId === record.ownerId
    && Math.abs(numberValue(wallet.amountPence) ?? numberValue(wallet.amount) ?? 0) === Math.abs(record.amountPence)
    && timestampFrom(wallet.timestamp, wallet.createdAt) === ledgerTimestamp);
}

// ---------------------------------------------------------------------------
// Main Adapter Function
// ---------------------------------------------------------------------------

/** Adapt every valid source record into a stable, newest-first list. */
export function adaptAllTransactions(params: AdaptAllTransactionsParams): NormalizedTransaction[] {
  const reversals = reversalIndex(params.reversals ?? []);
  const transactions: NormalizedTransaction[] = [];
  const walletRecords = (params.walletTransactions ?? []).filter(isWalletRecord);
  const walletLinks = collectWalletLinks(walletRecords);

  for (const value of walletRecords) {
    transactions.push(normalizeWallet(value, params.opts, reversals));
  }
  for (const value of params.goalLedger ?? []) {
    if (isGoalLedgerRecord(value) && !hasCanonicalGoalWalletRow(value, walletRecords)) {
      transactions.push(normalizeGoalLedger(value, params.opts));
    }
  }
  for (const value of params.redemptions ?? []) {
    if (isRedemptionRecord(value)) transactions.push(normalizeRedemption(value, params.opts, reversals));
  }
  for (const value of params.behaviourEvents ?? []) {
    if (isBehaviourRecord(value) && !walletLinks.behaviourIds.has(value.id)) {
      transactions.push(normalizeBehaviour(value, params.opts, reversals));
    }
  }
  for (const value of params.petboxRequests ?? []) {
    if (isPetboxRequestRecord(value) && !walletLinks.petboxIds.has(value.id)) {
      transactions.push(normalizePetbox(value, params.opts, reversals));
    }
  }
  for (const value of params.transferRequests ?? []) {
    if (isTransferRequestRecord(value) && !walletLinks.transferIds.has(value.id)) {
      transactions.push(normalizeTransferRequest(value, params.opts, reversals));
    }
  }
  for (const value of params.moneyRequests ?? []) {
    if (isMoneyRequestRecord(value) && !walletLinks.moneyRequestIds.has(value.id)) {
      transactions.push(normalizeMoneyRequest(value, params.opts, reversals));
    }
  }

  return stableNewestFirst(transactions);
}

function stableNewestFirst(transactions: readonly NormalizedTransaction[]): NormalizedTransaction[] {
  return transactions
    .map((transaction, index) => ({ transaction, index }))
    .sort((left, right) => right.transaction.timestamp - left.transaction.timestamp || left.index - right.index)
    .map(({ transaction }) => transaction);
}

// ---------------------------------------------------------------------------
// Filter and Search
// ---------------------------------------------------------------------------

export function filterTransactions(
  transactions: readonly NormalizedTransaction[],
  filters: readonly TransactionFilter[],
): NormalizedTransaction[] {
  if (filters.length === 0 || filters.includes('all')) return [...transactions];
  return transactions.filter(transaction => filters.some(filter => {
    if (filter === 'pending') return transaction.isPending;
    if (filter === 'completed') return transaction.isCompleted;
    if (filter === 'reversed') return transaction.isReversed;
    return transaction.category === filter;
  }));
}

export function searchTransactions(
  transactions: readonly NormalizedTransaction[],
  query: string,
): NormalizedTransaction[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...transactions];
  return transactions.filter(transaction => [
    transaction.searchText,
    transaction.title,
    transaction.subtitle,
    transaction.note,
  ].filter(isString).join(' ').toLocaleLowerCase().includes(normalizedQuery));
}

// ---------------------------------------------------------------------------
// Group Functions
// ---------------------------------------------------------------------------

const dateGroupOrder: readonly DateGroupKey[] = ['today', 'yesterday', 'earlierThisWeek', 'older'];

function calendarDayNumber(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

export function groupTransactionsByDate(
  transactions: readonly NormalizedTransaction[],
  now: Date = new Date(),
  t?: TFunction<'wallet'>,
): TransactionGroup[] {
  const groups = new Map<DateGroupKey, NormalizedTransaction[]>();
  const today = calendarDayNumber(now);
  const thisWeekStart = startOfWeek(now);
  for (const transaction of stableNewestFirst(transactions)) {
    const daysAgo = today - calendarDayNumber(new Date(transaction.timestamp));
    const key: DateGroupKey = daysAgo <= 0
      ? 'today'
      : daysAgo === 1
        ? 'yesterday'
        : transaction.timestamp >= thisWeekStart
          ? 'earlierThisWeek'
          : 'older';
    const items = groups.get(key) ?? [];
    items.push(transaction);
    groups.set(key, items);
  }
  const labels: Record<DateGroupKey, string> = {
    today: translate(t, 'ledger.groups.today', 'Today'),
    yesterday: translate(t, 'ledger.groups.yesterday', 'Yesterday'),
    earlierThisWeek: translate(t, 'ledger.groups.earlierThisWeek', 'Earlier this week'),
    older: translate(t, 'ledger.groups.older', 'Older'),
  };
  return dateGroupOrder.flatMap(key => {
    const items = groups.get(key);
    return items ? [{ key, label: labels[key], items }] : [];
  });
}

function startOfWeek(date: Date): number {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return start.getTime();
}

export function groupTransactionsByWeek(
  transactions: readonly NormalizedTransaction[],
  now: Date = new Date(),
  t?: TFunction<'wallet'>,
): WeekGroup[] {
  const thisWeekStart = startOfWeek(now);
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  const groups = new Map<'thisWeek' | 'lastWeek' | 'older', NormalizedTransaction[]>();
  for (const transaction of stableNewestFirst(transactions)) {
    const key = transaction.timestamp >= thisWeekStart
      ? 'thisWeek'
      : transaction.timestamp >= lastWeekStart.getTime()
        ? 'lastWeek'
        : 'older';
    const items = groups.get(key) ?? [];
    items.push(transaction);
    groups.set(key, items);
  }
  const definitions: readonly [key: 'thisWeek' | 'lastWeek' | 'older', label: string][] = [
    ['thisWeek', translate(t, 'ledger.groups.thisWeek', 'This Week')],
    ['lastWeek', translate(t, 'ledger.groups.lastWeek', 'Last Week')],
    ['older', translate(t, 'ledger.groups.older', 'Older')],
  ];
  return definitions.flatMap(([key, label]) => {
    const items = groups.get(key);
    return items ? [{ label, items }] : [];
  });
}

export function groupTransactionsByMonth(
  transactions: readonly NormalizedTransaction[],
): MonthGroup[] {
  const groups = new Map<string, MonthGroup>();
  const formatter = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' });
  for (const transaction of stableNewestFirst(transactions)) {
    const date = new Date(transaction.timestamp);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const existing = groups.get(key);
    if (existing) existing.items.push(transaction);
    else groups.set(key, { label: formatter.format(date), items: [transaction] });
  }
  return [...groups.values()];
}
