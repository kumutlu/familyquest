export type RewardVisualVariant = 'violet' | 'blue' | 'mint' | 'gold';

const KNOWN_ICON_VARIANTS: Record<string, RewardVisualVariant> = {
  Gamepad2: 'blue',
  Pizza: 'gold',
  Gift: 'violet',
  Ticket: 'mint',
};

const VARIANT_CYCLE: readonly RewardVisualVariant[] = ['violet', 'blue', 'mint', 'gold'];

/** Simple string hash function to deterministically assign accent variants. */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Derives a deterministic positive presentation variant from existing reward data.
 * Does not mutate or require persisted category metadata.
 */
export function getRewardVisualVariant(reward: {
  id?: string;
  icon?: string;
  title?: string;
}): RewardVisualVariant {
  if (reward.icon && KNOWN_ICON_VARIANTS[reward.icon]) {
    return KNOWN_ICON_VARIANTS[reward.icon];
  }
  const key = reward.id || reward.title || reward.icon || 'default';
  const index = hashString(key) % VARIANT_CYCLE.length;
  return VARIANT_CYCLE[index];
}

export const REWARD_ACCENT_STYLES: Record<
  RewardVisualVariant,
  {
    iconBg: string;
  }
> = {
  violet: {
    iconBg: 'bg-primary-50 text-primary-600 dark:bg-primary-100 dark:text-primary-400',
  },
  blue: {
    iconBg: 'bg-family-50 text-family-600 dark:bg-family-100 dark:text-family-400',
  },
  mint: {
    iconBg: 'bg-mint-50 text-mint-600 dark:bg-mint-100 dark:text-mint-400',
  },
  gold: {
    iconBg: 'bg-xp-50 text-xp-600 dark:bg-xp-100 dark:text-xp-400',
  },
};
