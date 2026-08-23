import { Send, HandCoins } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TactileButton } from '../queki/TactileButton';

interface QuickActionsProps {
  onSend: () => void;
  onRequest: () => void;
  requestDisabled?: boolean;
  requestHint?: string;
}

/**
 * Queki v2 Wave 3 primary child actions, directly under the balance hero.
 *
 * ROLE-AWARE by construction: children can SEND (parent-approved transfer) and
 * REQUEST money; they cannot ADD money, so no fake Add action is rendered.
 * Two natural actions beat three fake ones.
 */
export function QuickActions({ onSend, onRequest, requestDisabled, requestHint }: QuickActionsProps) {
  const { t } = useTranslation('wallet');
  return (
    <div className="grid grid-cols-2 gap-3" data-testid="wallet-quick-actions">
      <TactileButton
        variant="mint"
        size="lg"
        onClick={onSend}
        aria-label={t('quickActions.send')}
        data-testid="wallet-action-send"
        className="flex-col gap-2 py-5"
      >
        <Send size={22} aria-hidden="true" />
        <span className="text-sm font-bold">{t('quickActions.send')}</span>
      </TactileButton>
      <TactileButton
        variant="secondary"
        size="lg"
        onClick={onRequest}
        disabled={requestDisabled}
        aria-label={t('quickActions.request')}
        data-testid="wallet-action-request"
        className="flex-col gap-2 py-5"
      >
        <HandCoins size={22} aria-hidden="true" />
        <span className="text-sm font-bold">{t('quickActions.request')}</span>
      </TactileButton>
      {requestHint && (
        <p className="col-span-2 text-xs text-gray-400">{requestHint}</p>
      )}
    </div>
  );
}
