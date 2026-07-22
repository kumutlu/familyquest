import type { ReversalSourceKind } from '../../lib/reversalApi';
import type { NormalizedTransaction } from '../../lib/transactionModel';

export type HistoryRawSource = Record<string, unknown> & { id: string };

export interface HistoryActionSource {
  sourceKind: ReversalSourceKind;
  source: HistoryRawSource;
}

export interface HistorySourceCollections {
  walletTransactions?: readonly unknown[];
  redemptions?: readonly unknown[];
  behaviourEvents?: readonly unknown[];
  petboxRequests?: readonly unknown[];
  transferRequests?: readonly unknown[];
  moneyRequests?: readonly unknown[];
}

function rawSource(value: unknown): HistoryRawSource | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && record.id.length > 0
    ? record as HistoryRawSource
    : undefined;
}

function sourceMap(values: readonly unknown[] | undefined): Map<string, HistoryRawSource> {
  const map = new Map<string, HistoryRawSource>();
  for (const value of values ?? []) {
    const source = rawSource(value);
    if (source) map.set(source.id, source);
  }
  return map;
}

/**
 * Resolves a display row back to the exact source document used by reversal
 * and cancellation logic. Wallet rows deliberately prefer their own row id:
 * a canonical wallet leg may carry an upstream request id for deduplication,
 * but it must not be reclassified as that request.
 */
export function buildHistoryActionSourceResolver(collections: HistorySourceCollections) {
  const sources: Partial<Record<ReversalSourceKind, Map<string, HistoryRawSource>>> = {
    wallet_transaction: sourceMap(collections.walletTransactions),
    reward_redemption: sourceMap(collections.redemptions),
    behaviour_event: sourceMap(collections.behaviourEvents),
    petbox_request: sourceMap(collections.petboxRequests),
    transfer_request: sourceMap(collections.transferRequests),
    money_request: sourceMap(collections.moneyRequests),
  };

  return (transaction: NormalizedTransaction | null): HistoryActionSource | null => {
    if (!transaction?.source) return null;

    let sourceKind: ReversalSourceKind | undefined;
    switch (transaction.source) {
      case 'wallet_transaction':
        sourceKind = 'wallet_transaction';
        break;
      case 'redemption':
        sourceKind = 'reward_redemption';
        break;
      case 'behaviour_event':
        sourceKind = 'behaviour_event';
        break;
      case 'petbox_request':
        sourceKind = 'petbox_request';
        break;
      case 'transfer_request':
        sourceKind = 'transfer_request';
        break;
      case 'money_request':
        sourceKind = 'money_request';
        break;
      default:
        return null;
    }

    const map = sources[sourceKind];
    const source = map?.get(transaction.id) ?? (
      transaction.sourceId ? map?.get(transaction.sourceId) : undefined
    );
    return source ? { sourceKind, source } : null;
  };
}
