import { currencyCodeFromSymbol, formatPence } from '../i18n/format';
import {
  adaptAllTransactions,
  type AdaptAllTransactionsParams,
  type TransactionAdapterOptions,
} from './transactionAdapter';
import type {
  NormalizedTransaction,
  TransactionSource,
  TransactionStatus,
  TransactionType,
  TransactionUnit,
} from './transactionModel';

export interface EventParty {
  id: string;
  name?: string;
}

export interface HumanReadableFamilyEvent {
  transaction: NormalizedTransaction;
  eventKind: TransactionType;
  subject?: EventParty;
  actor?: EventParty;
  approver?: EventParty;
  reverser?: EventParty;
  from?: EventParty;
  to?: EventParty;
  amountPence: number;
  unit: TransactionUnit;
  currency: string;
  note?: string;
  timestamp?: number;
  reversalOccurredAt?: number;
  status: TransactionStatus;
  rewardTitle?: string;
  goalTitle?: string;
  fundName?: string;
  sourceType: TransactionSource;
  sourceId: string;
  headline: string;
  metadata: readonly string[];
}

type RawRecord = Record<string, unknown>;

function record(value: unknown): RawRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as RawRecord
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function party(id: unknown, opts: TransactionAdapterOptions, storedName?: unknown): EventParty | undefined {
  const partyId = stringValue(id);
  if (!partyId) return undefined;
  return { id: partyId, name: stringValue(storedName) ?? opts.nameResolver?.(partyId) };
}

function displayName(party: EventParty | undefined): string | undefined {
  return party?.name;
}

function partyById(recordValue: RawRecord | undefined, key: string, nameKey: string | undefined, opts: TransactionAdapterOptions): EventParty | undefined {
  return party(recordValue?.[key], opts, nameKey ? recordValue?.[nameKey] : undefined);
}

function byId(records: readonly unknown[] | undefined): Map<string, RawRecord> {
  const result = new Map<string, RawRecord>();
  for (const value of records ?? []) {
    const source = record(value);
    const id = stringValue(source?.id);
    if (source && id) result.set(id, source);
  }
  return result;
}

function money(amountPence: number, currency: string): string {
  return formatPence(Math.abs(amountPence), currencyCodeFromSymbol(currency));
}

function possessive(name: string): string {
  return `${name}’s`;
}

function translatedHeadline(
  t: TransactionAdapterOptions['t'],
  key: string,
  fallback: string,
  values: Readonly<Record<string, string>>,
): string {
  if (!t) return fallback;
  const value = t(key as never, { ...values, defaultValue: fallback });
  return typeof value === 'string' ? value : fallback;
}

/** Generates a semantic headline solely from structured event fields. */
export function humanReadableFamilyEventHeadline(event: Pick<HumanReadableFamilyEvent,
  'eventKind' | 'amountPence' | 'unit' | 'currency' | 'subject' | 'from' | 'to' | 'actor'>, t?: TransactionAdapterOptions['t']): string {
  const amount = event.unit === 'points'
    ? `${Math.abs(event.amountPence)} points`
    : money(event.amountPence, event.currency);
  const subject = displayName(event.subject);
  const from = displayName(event.from);
  const to = displayName(event.to);
  const actor = displayName(event.actor);

  if (event.eventKind === 'deposit') return subject
    ? translatedHeadline(t, 'ledger.activity.depositHeadline', `${amount} added to ${possessive(subject)} wallet`, { amount, child: subject })
    : `${amount} added`;
  if (event.eventKind === 'withdrawal') return subject
    ? translatedHeadline(t, 'ledger.activity.withdrawalHeadline', `${amount} withdrawn from ${possessive(subject)} wallet`, { amount, child: subject })
    : `${amount} withdrawn`;
  if (event.eventKind === 'reward_redemption') return actor
    ? translatedHeadline(t, 'ledger.activity.rewardRedemptionHeadline', `${amount} redeemed by ${actor}`, { amount, child: actor })
    : `${amount} redeemed`;
  if (event.eventKind === 'transfer' || event.eventKind === 'transfer_in' || event.eventKind === 'transfer_out' || event.eventKind === 'request_payment' || event.eventKind === 'transfer_request') {
    if (from && to) return translatedHeadline(t, 'ledger.activity.transferHeadline', `${amount} sent from ${from} to ${to}`, { amount, from, to });
    if (from) return `${amount} sent from ${from}`;
    if (to) return `${amount} sent to ${to}`;
    return `${amount} transferred`;
  }
  if (event.eventKind === 'money_request') return actor
    ? `${amount} requested by ${actor}`
    : `${amount} requested`;
  if (event.eventKind === 'financial_penalty') return subject
    ? `${amount} deducted from ${possessive(subject)} wallet`
    : `${amount} deducted`;
  return event.eventKind === 'goal_contribution' && subject
    ? `${amount} contributed by ${subject}`
    : event.eventKind.replaceAll('_', ' ');
}

/** Labels only semantic roles that have stored attribution evidence. */
export function humanReadableFamilyEventMetadata(event: Pick<HumanReadableFamilyEvent,
  'actor' | 'approver' | 'reverser'>): string[] {
  const metadata: string[] = [];
  const actor = displayName(event.actor);
  const approver = displayName(event.approver);
  const reverser = displayName(event.reverser);
  if (actor) metadata.push(`Performed by: ${actor}`);
  if (approver) metadata.push(`Approved by: ${approver}`);
  if (reverser) metadata.push(`Reversed by: ${reverser}`);
  return metadata;
}

function linkedTransferParties(
  transaction: NormalizedTransaction,
  transferRequests: Map<string, RawRecord>,
  moneyRequests: Map<string, RawRecord>,
  opts: TransactionAdapterOptions,
): Pick<HumanReadableFamilyEvent, 'actor' | 'approver' | 'from' | 'to'> {
  const transfer = transaction.transferRequestId ? transferRequests.get(transaction.transferRequestId) : undefined;
  if (transfer) {
    const from = partyById(transfer, 'fromChildId', 'fromChildName', opts);
    return {
      from,
      to: partyById(transfer, 'toChildId', 'toChildName', opts),
      actor: from,
      approver: party(transaction.actorId, opts),
    };
  }
  const moneyRequest = transaction.moneyRequestId ? moneyRequests.get(transaction.moneyRequestId) : undefined;
  if (!moneyRequest) return {};
  return {
    from: partyById(moneyRequest, 'requestedFromId', 'requestedFromName', opts),
    to: partyById(moneyRequest, 'requesterId', 'requesterName', opts),
    actor: partyById(moneyRequest, 'requesterId', 'requesterName', opts),
    approver: party(transaction.actorId, opts) ?? partyById(moneyRequest, 'reviewedBy', 'reviewedByName', opts),
  };
}

function eventRoles(
  transaction: NormalizedTransaction,
  transferRequests: Map<string, RawRecord>,
  moneyRequests: Map<string, RawRecord>,
  opts: TransactionAdapterOptions,
): Pick<HumanReadableFamilyEvent, 'subject' | 'actor' | 'approver' | 'reverser' | 'from' | 'to'> {
  const subject = party(transaction.childId, opts);
  const reverser = party(transaction.reversalActorId, opts, transaction.reversalActorName);
  if (transaction.type === 'transfer_in' || transaction.type === 'transfer_out') {
    return { subject, reverser, ...linkedTransferParties(transaction, transferRequests, moneyRequests, opts) };
  }
  if (transaction.type === 'request_payment' && transaction.moneyRequestId) {
    const linked = linkedTransferParties(transaction, transferRequests, moneyRequests, opts);
    return {
      subject: linked.to ?? subject,
      reverser,
      ...linked,
    };
  }
  if (transaction.type === 'transfer') {
    const from = party(transaction.fromChildId, opts);
    const to = party(transaction.childId, opts);
    return { subject, from, to, reverser };
  }
  if (transaction.type === 'transfer_request') {
    const source = transaction.transferRequestId ? transferRequests.get(transaction.transferRequestId) : undefined;
    const from = partyById(source, 'fromChildId', 'fromChildName', opts) ?? subject;
    const to = partyById(source, 'toChildId', 'toChildName', opts);
    return { subject, from, to, actor: from, approver: party(transaction.reviewerId, opts, transaction.reviewerName), reverser };
  }
  if (transaction.type === 'money_request') {
    const source = transaction.moneyRequestId ? moneyRequests.get(transaction.moneyRequestId) : undefined;
    const actor = partyById(source, 'requesterId', 'requesterName', opts) ?? subject;
    return {
      subject,
      actor,
      approver: party(transaction.reviewerId, opts, transaction.reviewerName),
      from: partyById(source, 'requestedFromId', 'requestedFromName', opts),
      to: actor,
      reverser,
    };
  }
  if (transaction.type === 'reward_redemption') return { subject, actor: subject, reverser };
  if (transaction.type === 'deposit' || transaction.type === 'withdrawal' || transaction.type === 'financial_penalty') {
    return { subject, actor: party(transaction.parentRef, opts), reverser };
  }
  return { subject, actor: party(transaction.parentRef ?? transaction.actorId, opts), reverser };
}

/** Adapts the same accepted sources as transaction history into a factual presentation model. */
export function adaptHumanReadableFamilyEvents(params: AdaptAllTransactionsParams): HumanReadableFamilyEvent[] {
  const transferRequests = byId(params.transferRequests);
  const moneyRequests = byId(params.moneyRequests);
  return adaptAllTransactions(params).map(transaction => {
    const roles = eventRoles(transaction, transferRequests, moneyRequests, params.opts);
    const event: HumanReadableFamilyEvent = {
      transaction,
      eventKind: transaction.type,
      ...roles,
      amountPence: transaction.amountPence,
      unit: transaction.unit,
      currency: transaction.currency,
      note: transaction.note,
      timestamp: transaction.timestamp > 0 ? transaction.timestamp : undefined,
      reversalOccurredAt: transaction.reversalOccurredAt,
      status: transaction.status,
      rewardTitle: transaction.rewardId ? params.opts.rewardResolver?.(transaction.rewardId)?.title : undefined,
      goalTitle: transaction.goalId ? params.opts.goalResolver?.(transaction.goalId)?.title : undefined,
      fundName: transaction.fundName,
      sourceType: transaction.source ?? 'manual',
      sourceId: transaction.sourceId ?? transaction.id,
      headline: '',
      metadata: [],
    };
    event.headline = humanReadableFamilyEventHeadline(event, params.opts.t);
    event.metadata = humanReadableFamilyEventMetadata(event);
    return event;
  });
}
