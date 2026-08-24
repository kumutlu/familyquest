import { useTranslation } from 'react-i18next';
import { Gamepad2, Gift, Pizza, Ticket } from 'lucide-react';
import { cn } from '../../lib/utils';
import { formatNumber } from '../../i18n/format';
import type { ShopReward } from '../../lib/rewards/shop';
import { getRewardVisualVariant, REWARD_ACCENT_STYLES } from '../../lib/rewards/visualVariants';

const REWARD_ICON_MAP = {
  Gift,
  Gamepad2,
  Pizza,
  Ticket,
} as const;

export function RewardIcon({ icon, size = 28 }: { icon: string; size?: number }) {
  const IconComp = REWARD_ICON_MAP[icon as keyof typeof REWARD_ICON_MAP] ?? Gift;
  return <IconComp size={size} aria-hidden="true" />;
}

interface RewardCardProps {
  reward: ShopReward;
  onOpen: (reward: ShopReward) => void;
}

/**
 * RewardCard — Queki v2 Wave 4.2 shop tile.
 *
 * Visual identity: positive accent tile (violet, blue, mint, gold), short title
 * and warm gold point cost. No destructive red/coral semantics.
 * Real product states only (mirroring the redemption domain):
 *  - available + affordable → vibrant tactile card with gold cost pill;
 *  - unaffordable → slightly muted card with soft gold cost and "Need N more";
 *  - out of stock → greyscale "All gone";
 *  - inactive → not rendered in the child shop at all.
 */
export function RewardCard({ reward, onOpen }: RewardCardProps) {
  const { t } = useTranslation('rewards');
  const variant = getRewardVisualVariant(reward);
  const accentStyles = REWARD_ACCENT_STYLES[variant];

  return (
    <button
      type="button"
      data-testid="reward-card"
      data-reward-id={reward.id}
      data-affordable={reward.affordable ? 'true' : 'false'}
      data-variant={variant}
      onClick={() => onOpen(reward)}
      className={cn(
        'group relative flex min-h-44 flex-col items-center justify-between gap-3 rounded-card',
        'qk-bg-card qk-border-subtle qk-shadow-card border p-4 text-center select-none',
        'transition-transform duration-[var(--animate-duration-tap)] ease-tap',
        'hover:-translate-y-0.5 active:translate-y-px active:scale-[0.98]',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
        reward.availability === 'out_of_stock' && 'opacity-60 grayscale',
        !reward.affordable && reward.availability === 'available' && 'opacity-85',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex h-16 w-16 items-center justify-center rounded-2xl transition-transform duration-[var(--animate-duration-card)] group-hover:scale-105',
          accentStyles.iconBg,
        )}
      >
        <RewardIcon icon={reward.icon} size={30} />
      </span>

      <span className="line-clamp-2 min-h-[2.5rem] text-body font-extrabold leading-snug qk-text-primary">
        {reward.title}
      </span>

      <span className="flex flex-col items-center gap-1">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-3 py-1 text-meta font-bold',
            reward.availability === 'out_of_stock'
              ? 'qk-bg-inset qk-text-secondary'
              : reward.affordable
                ? 'bg-xp-500 text-white dark:bg-xp-600 dark:text-white shadow-sm'
                : 'bg-xp-50 text-xp-700 border border-xp-200/70 dark:bg-xp-100 dark:text-xp-300 dark:border-xp-500/30',
          )}
        >
          ★ {formatNumber(reward.cost)}
        </span>
        {!reward.affordable && reward.availability === 'available' && (
          <span className="text-meta font-semibold qk-text-secondary" data-testid="reward-need-more">
            {t('shop.needMore', { value: formatNumber(reward.missingPoints) })}
          </span>
        )}
        {reward.availability === 'out_of_stock' && (
          <span className="text-meta font-semibold qk-text-secondary" data-testid="reward-out-of-stock">
            {t('shop.outOfStock')}
          </span>
        )}
      </span>
    </button>
  );
}
