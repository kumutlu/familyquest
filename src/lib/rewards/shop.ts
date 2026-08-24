/**
 * Reward Shop domain logic — Queki v2 Wave 3.
 *
 * PURE + deterministic. Mirrors the authoritative `redeemReward` transaction
 * contract in `src/lib/api.ts`:
 *  - a reward is purchasable when active AND (unlimited stock OR inventory > 0)
 *    AND the child's points cover the cost;
 *  - points are deducted IMMEDIATELY by the transaction — there is no pending
 *    approval state in this domain, so none is modelled here;
 *  - ordering is deterministic (documented below) and unit-tested separately
 *    from any UI.
 */

export interface ShopRewardLike {
  id: string;
  title?: string;
  cost?: number;
  icon?: string;
  isActive?: boolean;
  /** Finite number = limited stock; null/undefined = unlimited. */
  inventory?: number | null;
  createdAt?: unknown;
}

export type RewardAvailability = 'available' | 'out_of_stock' | 'inactive';

export interface ShopReward {
  id: string;
  title: string;
  cost: number;
  icon: string;
  inventory: number | null;
  availability: RewardAvailability;
  affordable: boolean;
  /** Points still missing when unaffordable; 0 otherwise. */
  missingPoints: number;
}

export function isOutOfStock(reward: ShopRewardLike): boolean {
  return (
    typeof reward.inventory === 'number' &&
    Number.isFinite(reward.inventory) &&
    reward.inventory <= 0
  );
}

/**
 * Deterministic shop ordering:
 *   1. available rewards before unavailable ones;
 *   2. affordable before unaffordable (within available);
 *   3. cheaper first;
 *   4. title (localeCompare) then id — total, stable tie-break.
 */
export function orderShopRewards(rewards: ShopReward[]): ShopReward[] {
  return [...rewards].sort((a, b) => {
    const availDiff = rankAvailability(a) - rankAvailability(b);
    if (availDiff !== 0) return availDiff;
    const affordDiff = Number(a.affordable === false) - Number(b.affordable === false);
    if (affordDiff !== 0) return affordDiff;
    if (a.cost !== b.cost) return a.cost - b.cost;
    const titleDiff = a.title.localeCompare(b.title);
    if (titleDiff !== 0) return titleDiff;
    return a.id.localeCompare(b.id);
  });
}

function rankAvailability(reward: ShopReward): number {
  return reward.availability === 'available' ? 0 : 1;
}

/**
 * Build the full shop view-model for one child's point balance.
 * Inactive rewards are included (so parents still see them contextually) but
 * ranked last and flagged `inactive`; child UIs may filter them out entirely.
 */
export function buildRewardShop(
  rewards: ShopRewardLike[],
  childPoints: number,
): ShopReward[] {
  return orderShopRewards(
    rewards.map(reward => {
      const availability: RewardAvailability =
        reward.isActive === false ? 'inactive' : isOutOfStock(reward) ? 'out_of_stock' : 'available';
      const cost = Number(reward.cost ?? 0);
      const affordable = availability === 'available' && childPoints >= cost;
      return {
        id: String(reward.id),
        title: String(reward.title ?? ''),
        cost,
        icon: String((reward as { icon?: string }).icon ?? 'Gift'),
        inventory:
          typeof reward.inventory === 'number' && Number.isFinite(reward.inventory)
            ? reward.inventory
            : null,
        availability,
        affordable,
        missingPoints: affordable || availability !== 'available' ? 0 : Math.max(0, cost - childPoints),
      } satisfies ShopReward;
    }),
  );
}

/** Child-facing shop list: archived rewards never render for children. */
export function childVisibleShop(shop: ShopReward[]): ShopReward[] {
  return shop.filter(reward => reward.availability !== 'inactive');
}
