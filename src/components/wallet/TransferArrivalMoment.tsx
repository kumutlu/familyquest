import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FullScreenMoment } from '../queki/FullScreenMoment';
import { CharacterFrame } from '../queki/CharacterFrame';
import { TactileButton } from '../queki/TactileButton';
import { triggerHaptic } from '../../lib/interaction/haptics';
import { playCue } from '../../lib/interaction/sound';
import { formatPence, resolveFamilyCurrencyCode, type SupportedCurrencyCode } from '../../i18n/format';
import { WalletMoneyText } from '../privacy/WalletMoneyText';

interface ArrivalTransactionLike {
  id?: string;
  type?: string;
  childId?: string;
  counterpartyChildId?: string;
  amountPence?: number;
  amount?: number;
  note?: string;
}

interface TransferArrivalMomentProps {
  transactions: ArrivalTransactionLike[];
  currentUserId: string;
  familyMembers: Array<{ id: string; displayName?: string; avatarUrl?: string }>;
  familyData: any;
  currencyCode?: SupportedCurrencyCode;
}

/**
 * TransferArrivalMoment — Queki v2 Wave 3 "Ali sent you £2" moment.
 *
 * Derives ENTIRELY from the authoritative wallet_transactions stream (types
 * `transfer_in` / `request_payment`). Deterministic seen-behaviour without any
 * backend change: on mount, every transaction already in the snapshot is
 * baseline-marked (never celebrated); only documents that APPEAR while the app
 * is open — including ones written offline and synced later — trigger the
 * moment, exactly once per document id. Reloads therefore never replay old
 * celebrations.
 */
export function TransferArrivalMoment({
  transactions,
  currentUserId,
  familyMembers,
  familyData,
  currencyCode,
}: TransferArrivalMomentProps) {
  const { t } = useTranslation('wallet');
  const [arrival, setArrival] = useState<{
    id: string;
    amountPence: number;
    fromName: string;
    avatarUrl?: string;
  } | null>(null);

  const seenIdsRef = useRef<Set<string> | null>(null);
  const code = currencyCode ?? resolveFamilyCurrencyCode(familyData);

  useEffect(() => {
    // First pass: baseline. Never celebrate history on load/reload.
    if (seenIdsRef.current === null) {
      seenIdsRef.current = new Set(
        transactions.map(tx => String(tx.id)).filter(Boolean),
      );
      return;
    }

    const incoming = transactions.find(
      tx =>
        tx.id &&
        !seenIdsRef.current!.has(String(tx.id)) &&
        (tx.type === 'transfer_in' || tx.type === 'request_payment') &&
        tx.childId === currentUserId,
    );
    if (!incoming) return;

    seenIdsRef.current.add(String(incoming.id));
    const counterparty =
      familyMembers.find(m => m.id === incoming.counterpartyChildId) ?? null;
    setArrival({
      id: String(incoming.id),
      amountPence: Number(incoming.amountPence ?? incoming.amount ?? 0),
      fromName: counterparty?.displayName || t('arrival.someone'),
      avatarUrl: counterparty?.avatarUrl,
    });
    triggerHaptic('transferReceived');
    playCue('transferReceived');
  }, [transactions, currentUserId, familyMembers, t]);

  if (!arrival) return null;

  return (
    <div data-testid="transfer-arrival-moment">
    <FullScreenMoment tone="mint">
      <p className="text-meta font-bold uppercase tracking-widest text-white/80">
        {t('arrival.title')}
      </p>
      <CharacterFrame src={arrival.avatarUrl} fallback={arrival.fromName} size={88} hero />
      <p className="text-center text-2xl font-extrabold" data-testid="transfer-arrival-text">
        <WalletMoneyText>
          {t('arrival.received', {
            name: arrival.fromName,
            amount: formatPence(arrival.amountPence, code),
          })}
        </WalletMoneyText>
      </p>
      <TactileButton variant="secondary" onClick={() => setArrival(null)} data-testid="transfer-arrival-dismiss">
        {t('arrival.dismiss')}
      </TactileButton>
    </FullScreenMoment>
    </div>
  );
}
