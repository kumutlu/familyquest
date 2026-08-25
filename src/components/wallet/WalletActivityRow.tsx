import { useTranslation } from 'react-i18next';
import { currencyCodeFromSymbol, formatDate, formatPence } from '../../i18n/format';
import type { HumanReadableFamilyEvent } from '../../lib/humanReadableFamilyEvent';
import { MoneyValue } from '../privacy/MoneyValue';
import { WalletMoneyText } from '../privacy/WalletMoneyText';

interface WalletActivityRowProps {
  event: WalletActivityEvent;
}

export type WalletActivityEvent = Omit<HumanReadableFamilyEvent, 'timestamp'> & {
  timestamp?: number;
};

function signedAmount(event: Pick<WalletActivityEvent, 'amountPence' | 'unit' | 'currency'>, points: string): string {
  const prefix = event.amountPence > 0 ? '+' : event.amountPence < 0 ? '-' : '';
  const amount = event.unit === 'points'
    ? points
    : formatPence(Math.abs(event.amountPence), currencyCodeFromSymbol(event.currency));
  return `${prefix}${amount}`;
}

export function WalletActivityRow({ event }: WalletActivityRowProps) {
  const { t } = useTranslation('wallet');
  const amount = signedAmount(event, t('ledger.points', { count: Math.abs(event.amountPence) }));
  const headline = (
    (event.eventKind === 'transfer_in' || event.eventKind === 'transfer_out')
    && !event.from?.name
    && !event.to?.name
    && event.transaction.title
  ) ? event.transaction.title : event.headline;
  const status = t(`allowance.activity.status.${event.status}`, {
    defaultValue: event.status.replaceAll('_', ' '),
  });
  const metadata = [
    event.actor?.name && t('ledger.activity.performedBy', { name: event.actor.name }),
    event.approver?.name && t('ledger.activity.approvedBy', { name: event.approver.name }),
    event.reverser?.name && t('ledger.activity.reversedBy', { name: event.reverser.name }),
  ].filter((line): line is string => Boolean(line));
  const date = typeof event.timestamp === 'number' && Number.isFinite(event.timestamp)
    ? formatDate(event.timestamp, undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : undefined;
  const amountColor = event.amountPence > 0
    ? 'text-success-600'
    : event.amountPence < 0
      ? 'qk-text-primary'
      : 'qk-text-secondary';

  return (
    <article className="rounded-xl qk-bg-card border qk-border-subtle p-2.5 text-sm min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1 min-w-0">
        <p className="min-w-0 flex-1 font-medium qk-text-primary break-words">
          {event.unit === 'money' ? <WalletMoneyText>{headline}</WalletMoneyText> : headline}
        </p>
        <span className={`shrink-0 font-bold tabular-nums ${amountColor}`}>
          {event.unit === 'money' ? <MoneyValue>{amount}</MoneyValue> : amount}
        </span>
      </div>

      {(metadata.length > 0 ? metadata : event.metadata).map(metadata => (
        <p key={metadata} className="mt-1 text-xs qk-text-secondary break-words">
          {event.unit === 'money' ? <WalletMoneyText>{metadata}</WalletMoneyText> : metadata}
        </p>
      ))}

      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs qk-text-secondary min-w-0">
        {event.note && (
          <p className="min-w-0 break-words">
            <span>{t('allowance.activity.note')}: </span>
            <span>{event.unit === 'money' ? <WalletMoneyText>{event.note}</WalletMoneyText> : event.note}</span>
          </p>
        )}
        {!event.note && event.transaction.subtitle && (
          <span className="min-w-0 break-words">
            {event.unit === 'money' ? <WalletMoneyText>{event.transaction.subtitle}</WalletMoneyText> : event.transaction.subtitle}
          </span>
        )}
        {date && <span className="break-words">{date}</span>}
        <span className="break-words">{t('allowance.activity.statusLabel')}: {status}</span>
      </div>
    </article>
  );
}
