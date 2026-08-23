import { useTranslation } from 'react-i18next';
import { Edit, Trash2 } from 'lucide-react';
import { formatNumber } from '../../i18n/format';
import { BottomSheet } from '../queki/BottomSheet';
import { TactileButton } from '../queki/TactileButton';
import { RewardIcon } from './RewardCard';
import type { ShopReward } from '../../lib/rewards/shop';

interface RewardDetailSheetProps {
  reward: ShopReward | null;
  childPoints: number;
  isParent: boolean;
  isRedeeming: boolean;
  error: string | null;
  onClose: () => void;
  onRedeem: (reward: ShopReward) => void;
  onEdit: (reward: ShopReward) => void;
  onArchive: (rewardId: string) => void;
}

/**
 * RewardDetailSheet — Queki v2 Wave 3 focused reward surface.
 *
 * Shows only what matters: visual, title, cost, the child's live points and
 * one large tactile CTA. Redemption is deliberate — "GET IT" is a strong,
 * explicit confirmation (never an accidental single tap; the card tap only
 * opens this sheet). The domain deducts points inside `redeemReward`'s
 * transaction; nothing here mutates balances locally.
 */
export function RewardDetailSheet({
  reward,
  childPoints,
  isParent,
  isRedeeming,
  error,
  onClose,
  onRedeem,
  onEdit,
  onArchive,
}: RewardDetailSheetProps) {
  const { t } = useTranslation('rewards');
  if (!reward) return null;

  const outOfStock = reward.availability === 'out_of_stock';
  const inactive = reward.availability === 'inactive';
  const canRedeem = !isParent && !outOfStock && !inactive && reward.affordable && !isRedeeming;

  return (
    <BottomSheet open onClose={onClose} aria-label={reward.title} title={reward.title}>
      <div className="flex flex-col items-center gap-4 pb-6 text-center" data-testid="reward-detail">
        <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-coral-50 text-coral-500 dark:bg-coral-100">
          <RewardIcon icon={reward.icon} size={44} />
        </div>

        <div>
          <p className="text-card-title font-extrabold qk-text-primary">{reward.title}</p>
          <p className="mt-1 text-body font-bold text-coral-600" data-testid="reward-detail-cost">
            ★ {formatNumber(reward.cost)} · {t('details.points', { value: formatNumber(reward.cost) })}
          </p>
          {reward.inventory !== null && (
            <p className="mt-1 text-meta qk-text-secondary">
              {t('details.inStock', { value: formatNumber(reward.inventory) })}
            </p>
          )}
        </div>

        {!isParent && (
          <p className="text-meta font-semibold qk-text-secondary" data-testid="reward-detail-points">
            {t('confirm.yourPoints', { value: formatNumber(childPoints) })}
          </p>
        )}

        {(outOfStock || inactive) && (
          <p role="status" className="w-full rounded-xl bg-coral-50 p-3 text-body font-semibold text-coral-700 dark:bg-coral-100" data-testid="reward-detail-unavailable">
            {outOfStock ? t('details.outOfStock') : t('shop.emptyTitle')}
          </p>
        )}

        {!canRedeem && !isParent && !outOfStock && !inactive && !reward.affordable && (
          <p role="status" className="w-full rounded-xl bg-coral-50 p-3 text-body font-semibold text-coral-700 dark:bg-coral-100" data-testid="reward-detail-not-enough">
            {t('details.notEnoughPoints')}
          </p>
        )}

        {error && (
          <div role="alert" className="w-full rounded-xl bg-coral-50 p-3 text-body font-semibold text-coral-700 dark:bg-coral-100">
            {error}
          </div>
        )}

        {/* Parent management actions */}
        {isParent && (
          <div className="flex w-full gap-3 pt-2">
            <TactileButton variant="secondary" fullWidth onClick={() => onEdit(reward)}>
              <Edit size={16} aria-hidden="true" />
              {t('details.edit')}
            </TactileButton>
            <TactileButton variant="danger" fullWidth onClick={() => onArchive(reward.id)}>
              <Trash2 size={16} aria-hidden="true" />
              {t('details.archive')}
            </TactileButton>
          </div>
        )}

        {/* Child redemption — deliberate, large, tactile */}
        {!isParent && (
          <>
            <TactileButton
              variant="coral"
              size="lg"
              fullWidth
              disabled={!canRedeem}
              loading={isRedeeming}
              onClick={() => onRedeem(reward)}
              data-testid="reward-redeem"
              className="min-h-14 text-lg"
            >
              {isRedeeming ? t('confirm.getting') : t('confirm.getIt')}
            </TactileButton>
            {reward.affordable && !outOfStock && !inactive && (
              <p className="text-meta qk-text-secondary">{t('confirm.parentNote')}</p>
            )}
          </>
        )}
      </div>
    </BottomSheet>
  );
}
