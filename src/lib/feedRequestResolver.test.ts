import { describe, it, expect } from 'vitest';
import { resolveFeedRequest, ENTITY_TYPE_TO_CATEGORY } from './feedRequestResolver';

const moneyRequest = { id: 'mr-1', requesterName: 'Mnalium', status: 'pending_acceptance' };
const pools = {
  moneyRequests: [moneyRequest],
  transferRequests: [],
  profileUpdateRequests: [],
  redemptions: [],
  taskCompletions: [],
  petboxRequests: [],
};

describe('resolveFeedRequest', () => {
  it('resolves a request by entityType + entityId and attaches a category', () => {
    const item = { entityType: 'money_request', entityId: 'mr-1' };
    const resolved = resolveFeedRequest(item, pools);
    expect(resolved).not.toBeNull();
    expect(resolved.id).toBe('mr-1');
    expect(resolved.category).toBe('money_request');
  });

  it('maps entity types to categories', () => {
    expect(ENTITY_TYPE_TO_CATEGORY.money_request).toBe('money_request');
    expect(ENTITY_TYPE_TO_CATEGORY.transfer_request).toBe('transfer');
    expect(ENTITY_TYPE_TO_CATEGORY.profile_update_request).toBe('profile_update');
    expect(ENTITY_TYPE_TO_CATEGORY.redemption).toBe('reward');
    expect(ENTITY_TYPE_TO_CATEGORY.task_completion).toBe('task');
  });

  it('does NOT identify a request by parsing the human-readable text', () => {
    const item = { text: 'Mnalium requested £5.56 from Kemal.' };
    expect(resolveFeedRequest(item, pools)).toBeNull();
  });

  it('returns null for legacy activity without entityId', () => {
    const item = { entityType: 'money_request' }; // no entityId
    expect(resolveFeedRequest(item, pools)).toBeNull();
  });

  it('returns null when the referenced request no longer exists', () => {
    const item = { entityType: 'money_request', entityId: 'deleted' };
    expect(resolveFeedRequest(item, pools)).toBeNull();
  });

  it('returns null for an unknown entity type', () => {
    const item = { entityType: 'mystery', entityId: 'x' };
    expect(resolveFeedRequest(item, pools)).toBeNull();
  });
});
