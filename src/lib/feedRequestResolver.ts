/**
 * Feed → Request resolver
 * -----------------------
 * Recent-activity / notification entries reference the request they relate to
 * through structured `entityType` + `entityId` fields (never by parsing the
 * human-readable activity text). This module turns a feed item into the raw
 * request document (with a `category` attached) that the universal
 * RequestDetailSheet can render.
 *
 * Legacy feed records that predate `entityType`/`entityId` simply resolve to
 * `null` and remain non-crashing — the UI treats them as plain, non-tappable
 * rows.
 */

import type { RequestCategory } from './requestModel';

export const ENTITY_TYPE_TO_CATEGORY: Record<string, RequestCategory> = {
  transfer_request: 'transfer',
  money_request: 'money_request',
  profile_update_request: 'profile_update',
  redemption: 'reward',
  task_completion: 'task',
  petbox_request: 'petbox',
};

export interface FeedRequestPools {
  moneyRequests?: any[];
  transferRequests?: any[];
  profileUpdateRequests?: any[];
  redemptions?: any[];
  taskCompletions?: any[];
  petboxRequests?: any[];
}

/**
 * Resolve a feed/notification item to its underlying raw request document
 * (augmented with a `category`). Returns `null` when the item carries no
 * resolvable entity or the referenced request no longer exists.
 */
export function resolveFeedRequest(feedItem: any, pools: FeedRequestPools): any | null {
  const entityType = feedItem?.entityType;
  const entityId = feedItem?.entityId;
  if (!entityType || !entityId) return null;

  const category = ENTITY_TYPE_TO_CATEGORY[entityType];
  if (!category) return null;

  const pool = ({
    transfer: pools.transferRequests,
    money_request: pools.moneyRequests,
    profile_update: pools.profileUpdateRequests,
    reward: pools.redemptions,
    task: pools.taskCompletions,
    petbox: pools.petboxRequests,
  } as Record<string, any[]>)[category];

  const match = (pool || []).find(r => r.id === entityId);
  return match ? { ...match, category } : null;
}
