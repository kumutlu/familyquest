import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, PartyPopper } from 'lucide-react';
import { CharacterFrame } from '../queki/CharacterFrame';
import { BottomSheet } from '../queki/BottomSheet';
import { TactileButton } from '../queki/TactileButton';
import { QuekiMascot } from '../queki/QuekiMascot';
import { createTransferRequest } from '../../lib/api';
import { useStore } from '../../store/useStore';
import {
  eligibleRecipients,
  quickAmountsForBalance,
  validateAmountPence,
  type TransferMemberLike,
} from '../../lib/wallet/transferFlow';
import { currencySymbolFromCode, formatPence, type SupportedCurrencyCode } from '../../i18n/format';
import { WalletMoneyText } from '../privacy/WalletMoneyText';
import type { TFunction } from 'i18next';
import { cn } from '../../lib/utils';
import { triggerHaptic } from '../../lib/interaction/haptics';
import { playCue } from '../../lib/interaction/sound';
import { useMoneyPrivacy } from '../privacy/MoneyPrivacyContext';

interface SendFlowSheetProps {
  onClose: () => void;
  currencyCode?: SupportedCurrencyCode;
}

type Stage = 'who' | 'amount' | 'review' | 'sent';

const AMOUNT_ERROR_KEYS = {
  empty: 'send.enterAmount',
  invalid: 'send.validAmount',
  too_small: 'send.greaterThanZero',
  precision: 'send.twoDecimals',
  insufficient: 'send.notEnough',
} as const;

function friendlyError(err: any, t: TFunction<'wallet'>): string {
  const code = err?.code;
  const message = typeof err?.message === 'string' ? err.message : '';
  const lowered = message.toLowerCase();
  if (code === 'WALLET_NOT_FOUND') return t('send.walletNotFound');
  if (lowered.includes('insufficient')) return t('send.notEnough');
  if (lowered.includes('not authenticated') || code === 'unauthenticated') return t('send.signedOut');
  if (lowered.includes('must differ')) return t('send.selfTransfer');
  if (lowered.includes('same family')) return t('send.sameFamily');
  if (lowered.includes('must be children')) return t('send.childrenOnly');
  return t('send.generic');
}

/**
 * SendFlowSheet — Queki v2 Wave 3 staged send-money flow.
 *
 * WHO? → AMOUNT → REVIEW → SENT. One obvious action per stage; never a dense
 * banking form. The underlying mutation is the SAME authoritative
 * `createTransferRequest` transaction as before — this flow only reshapes the
 * interaction. Money moves ONLY when a parent approves; the final stage is an
 * honest "sent for approval" moment, never a fake "money moved" state.
 */
export function SendFlowSheet({ onClose, currencyCode = 'GBP' }: SendFlowSheetProps) {
  const { t } = useTranslation('wallet');
  const { currentUser, familyMembers, myWallet } = useStore();
  const { isMoneyHidden } = useMoneyPrivacy();

  const [stage, setStage] = useState<Stage>('who');
  const [recipientId, setRecipientId] = useState<string | null>(null);
  const [amountRaw, setAmountRaw] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentInfo, setSentInfo] = useState<{ amountPence: number; name: string } | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const inFlightRef = useRef(false);
  const currency = currencySymbolFromCode(currencyCode);

  // Canonical balance source: families/{familyId}/wallets/{childId}.balance
  const balance = myWallet?.balance || 0;
  const quickAmounts = isMoneyHidden ? [] : quickAmountsForBalance(balance);

  const recipients = useMemo(
    () =>
      eligibleRecipients(
        (familyMembers || []) as TransferMemberLike[],
        currentUser?.id ?? '',
        currentUser?.familyId ?? '',
      ),
    [familyMembers, currentUser],
  );

  const recipient = recipients.find(r => r.id === recipientId) ?? null;

  useEffect(() => {
    panelRef.current?.focus();
  }, [stage]);

  const amountValidation = validateAmountPence(amountRaw, balance);

  const proceedToReview = () => {
    if (!recipient) {
      setError(t('send.chooseRecipient'));
      return;
    }
    const { error: amountError } = amountValidation;
    if (amountError) {
      setError(t(AMOUNT_ERROR_KEYS[amountError]));
      return;
    }
    setError(null);
    triggerHaptic('tap');
    setStage('review');
  };

  const handleSend = async () => {
    // Exactly-once guard: double tap / pointer race can never duplicate the
    // ledger-side request.
    if (!currentUser || !recipient || inFlightRef.current) return;
    const { pence, error: amountError } = validateAmountPence(amountRaw, balance);
    if (amountError) {
      setError(t(AMOUNT_ERROR_KEYS[amountError]));
      return;
    }

    inFlightRef.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      await createTransferRequest(currentUser.familyId, recipient.id, pence, '');
      triggerHaptic('transferSent');
      playCue('transferSent');
      setSentInfo({ amountPence: pence, name: recipient.displayName || '' });
      setStage('sent');
    } catch (err: any) {
      // Failure restores the review stage with actionable copy — never a
      // false success.
      setError(friendlyError(err, t));
    } finally {
      inFlightRef.current = false;
      setIsSubmitting(false);
    }
  };

  const close = () => {
    if (isSubmitting) return; // never close mid-mutation
    onClose();
  };

  const stageTitle =
    stage === 'who'
      ? t('send.stageWho')
      : stage === 'amount'
        ? t('send.stageAmount')
        : stage === 'review'
          ? t('send.stageReview')
          : t('send.success');

  return (
    <BottomSheet open onClose={close} aria-label={t('send.title')} title={stageTitle}>
      <div ref={panelRef} tabIndex={-1} className="outline-none" data-testid="send-flow" data-stage={stage}>
        {/* ---------------------------------------------------------------- */}
        {/* WHO? */}
        {stage === 'who' && (
          <div className="pb-6">
            {recipients.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center" data-testid="send-no-recipients">
                <QuekiMascot state="happy" size={100} />
                <p className="text-body font-bold qk-text-primary">{t('send.noSiblings')}</p>
                <TactileButton variant="secondary" onClick={close}>{t('send.cancel')}</TactileButton>
              </div>
            ) : (
              <>
                <div
                  className={
                    recipients.length > 4
                      ? 'grid grid-cols-4 gap-3'
                      : recipients.length > 2
                        ? 'grid grid-cols-3 gap-3'
                        : 'grid grid-cols-2 gap-3'
                  }
                  role="radiogroup"
                  aria-label={t('send.to')}
                >
                  {recipients.map(member => (
                    <button
                      key={member.id}
                      type="button"
                      role="radio"
                      aria-checked={recipientId === member.id}
                      onClick={() => {
                        setRecipientId(member.id);
                        setError(null);
                        triggerHaptic('tap');
                        setStage('amount');
                      }}
                      className={cn(
                        'flex flex-col items-center gap-2 rounded-card border p-3 transition-transform duration-[var(--animate-duration-tap)] ease-tap',
                        'active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                        recipientId === member.id
                          ? 'border-mint-500 bg-mint-50 dark:bg-mint-100'
                          : 'qk-border-subtle qk-bg-card',
                      )}
                      data-testid="send-recipient"
                    >
                      <CharacterFrame src={member.avatarUrl} fallback={member.displayName || '?'} size={56} />
                      <span className="w-full truncate text-center text-meta font-bold qk-text-primary">
                        {member.displayName}
                      </span>
                    </button>
                  ))}
                </div>
                {error && <p role="alert" className="mt-3 text-body font-semibold text-coral-600">{error}</p>}
              </>
            )}
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* AMOUNT */}
        {stage === 'amount' && recipient && (
          <div className="pb-6">
            <div className="flex items-center justify-center gap-2 text-meta font-bold qk-text-secondary">
              <span>{t('send.sendingTo', { name: recipient.displayName })}</span>
              <button
                type="button"
                onClick={() => setStage('who')}
                className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-primary-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                {t('send.stageChange')}
              </button>
            </div>

            <div className="mt-5 text-center">
              <label htmlFor="send-amount-input" className="text-meta font-semibold qk-text-secondary">
                {t('send.amount', { currency })}
              </label>
              <div className="mt-2 flex items-center justify-center gap-2">
                <span aria-hidden="true" className="text-3xl font-extrabold qk-text-secondary">{currency}</span>
                <input
                  id="send-amount-input"
                  data-testid="send-amount-input"
                  inputMode="decimal"
                  autoComplete="off"
                  autoFocus
                  value={amountRaw}
                  onChange={e => {
                    setAmountRaw(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      proceedToReview();
                    }
                  }}
                  className="w-40 rounded-xl border qk-border-subtle qk-bg-inset p-3 text-center text-4xl font-extrabold tabular-nums qk-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-mint-500"
                  aria-describedby="send-balance-hint"
                />
              </div>
              <p id="send-balance-hint" className="mt-2 text-meta qk-text-secondary" data-testid="send-balance-hint">
                <WalletMoneyText>
                  {t('send.availableBalance', { amount: formatPence(balance, currencyCode) })}
                </WalletMoneyText>
              </p>
            </div>

            {quickAmounts.length > 0 && (
              <div className="mt-4 flex flex-wrap justify-center gap-2" role="group" aria-label={t('send.quickAmounts')}>
                {quickAmounts.map(pence => (
                  <button
                    key={pence}
                    type="button"
                    onClick={() => {
                      setAmountRaw((pence / 100).toFixed(2));
                      setError(null);
                      triggerHaptic('tap');
                    }}
                    className="rounded-full border qk-border-subtle qk-bg-card px-4 py-2 text-body font-bold text-mint-700 transition-transform duration-[var(--animate-duration-tap)] ease-tap active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-mint-500"
                    data-testid="send-quick-amount"
                  >
                    {formatPence(pence, currencyCode)}
                  </button>
                ))}
              </div>
            )}

            {error && <p role="alert" className="mt-3 text-center text-body font-semibold text-coral-600">{error}</p>}

            <div className="mt-5">
              <TactileButton variant="mint" size="lg" fullWidth onClick={proceedToReview} data-testid="send-review-continue">
                {t('send.stageReviewCta')}
                <ArrowRight size={18} aria-hidden="true" />
              </TactileButton>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* REVIEW */}
        {stage === 'review' && recipient && (
          <div className="pb-6 text-center">
            <p className="text-title font-extrabold qk-text-primary" data-testid="send-review-title">
              {t('send.reviewTitle', {
                amount: formatPence(amountValidation.pence, currencyCode),
                name: recipient.displayName,
              })}
            </p>
            <div className="mt-5 flex items-center justify-center gap-4">
              <CharacterFrame src={currentUser?.avatarUrl} fallback={currentUser?.displayName || '?'} size={56} />
              <span aria-hidden="true" className="text-2xl font-extrabold text-mint-600">→</span>
              <CharacterFrame src={recipient.avatarUrl} fallback={recipient.displayName || '?'} size={56} />
            </div>
            <p className="mt-4 text-4xl font-extrabold tabular-nums text-mint-700" data-testid="send-review-amount">
              {formatPence(amountValidation.pence, currencyCode)}
            </p>
            <p className="mx-auto mt-2 max-w-xs text-meta qk-text-secondary">{t('send.balanceStays')}</p>

            {error && <p role="alert" className="mt-3 text-body font-semibold text-coral-600">{error}</p>}

            <div className="mt-5 flex flex-col gap-3">
              <TactileButton
                variant="mint"
                size="lg"
                fullWidth
                loading={isSubmitting}
                disabled={isSubmitting}
                onClick={handleSend}
                data-testid="send-confirm"
                className="min-h-14 text-lg"
              >
                {isSubmitting ? t('send.sending') : t('send.submit')}
              </TactileButton>
              <TactileButton variant="ghost" fullWidth disabled={isSubmitting} onClick={() => setStage('amount')}>
                {t('send.stageBack')}
              </TactileButton>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* SENT (honest state: awaiting parent approval) */}
        {stage === 'sent' && sentInfo && (
          <div className="flex flex-col items-center gap-3 pb-8 pt-2 text-center" role="status" data-testid="send-sent">
            <PartyPopper size={40} aria-hidden="true" className="text-mint-600" />
            <p className="text-title font-extrabold qk-text-primary">{t('send.success')}</p>
            <p className="text-body qk-text-secondary">
              {t('send.successDetail', {
                amount: formatPence(sentInfo.amountPence, currencyCode),
                name: sentInfo.name,
              })}
            </p>
            <TactileButton variant="mint" onClick={close} data-testid="send-sent-done">
              {t('send.sentDone')}
            </TactileButton>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
