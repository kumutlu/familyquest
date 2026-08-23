import { useTranslation } from 'react-i18next';
import { Gamepad2, Gift, Pizza, Ticket } from 'lucide-react';
import { cn } from '../../lib/utils';
import { formatNumber } from '../../i18n/format';
import type { ShopReward } from '../../lib/rewards/shop';

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
 * RewardCard — Queki v2 Wave 3 shop tile.
 *
 * Visual identity first: a coral icon tile, short title and point cost.
 * Real product states only (mirroring the redemption domain):
 *  - available + affordable → full-colour tactile card;
 *  - unaffordable → slightly dimmed with "Need N more" (no fake lock);
 *  - out of stock → greyscale "All gone";
 *  - inactive → not rendered in the child shop at all.
 */
export function RewardCard({ reward, onOpen }: RewardCardProps) {
  const { t } = useTranslation('rewards');

  return (
    <button
      type="button"
      data-testid="reward-card"
      data-reward-id={reward.id}
      data-affordable={reward.affordable ? 'true' : 'false'}
      onClick={() => onOpen(reward)}
      className={cn(
        'group relative flex min-h-44 flex-col items-center justify-between gap-3 rounded-card',
        'qk-bg-card qk-border-subtle qk-shadow-card border p-4 text-center select-none',
        'transition-transform duration-[var(--animate-duration-tap)] ease-tap',
        'hover:-translate-y-0.5 active:translate-y-px active:scale-[0.98]',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-coral-500 focus-visible:ring-offset-2',
        reward.availability === 'out_of_stock' && 'opacity-60 grayscale',
        !reward.affordable && reward.availability === 'available' && 'opacity-80',
      )}
    >
      <span
        aria-hidden="true"
        className="flex h-16 w-16 items-center justify-center rounded-2xl bg-coral-50 text-coral-500 transition-transform duration-[var(--animate-duration-card)] group-hover:scale-105 dark:bg-coral-100"
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
            reward.affordable
              ? 'bg-coral-500 text-white'
              : 'bg-coral-50 text-coral-600 dark:bg-coral-100 dark:text-coral-600',
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
