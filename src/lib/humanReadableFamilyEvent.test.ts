import { describe, expect, it } from 'vitest';
import {
  adaptHumanReadableFamilyEvents,
  humanReadableFamilyEventHeadline,
  humanReadableFamilyEventMetadata,
} from './humanReadableFamilyEvent';

const TS = new Date('2026-08-25T10:00:00.000Z').getTime();

const names: Record<string, string> = {
  'parent-ada': 'Ada',
  'parent-bob': 'Bob',
  alisya: 'Alisya',
  mnalium: 'Mnalium',
  mostium: 'Mostium',
};

const events = () => adaptHumanReadableFamilyEvents({
  walletTransactions: [
    { id: 'A', type: 'deposit', amountPence: 9000, childId: 'mnalium', parentRef: 'parent-ada', status: 'completed', createdAt: TS + 9 },
    { id: 'B', type: 'withdrawal', amountPence: 255, childId: 'alisya', parentRef: 'parent-ada', status: 'completed', createdAt: TS + 8 },
    { id: 'C', type: 'transfer_out', amountPence: 300, childId: 'alisya', counterpartyChildId: 'mnalium', transferRequestId: 'transfer-al-mn', actorId: 'parent-ada', status: 'completed', createdAt: TS + 7 },
    { id: 'D', type: 'transfer_in', amountPence: 130, childId: 'mostium', counterpartyChildId: 'mnalium', transferRequestId: 'transfer-mn-mo', actorId: 'parent-bob', status: 'completed', createdAt: TS + 6 },
    { id: 'G', type: 'deposit', amountPence: 450, childId: 'alisya', parentRef: 'parent-ada', status: 'completed', createdAt: TS + 3 },
    { id: 'H', type: 'deposit', amountPence: 100, childId: 'mostium', parentRef: 'parent-ada', note: 'veciiz', status: 'completed', createdAt: TS + 2 },
    { id: 'I', type: 'withdrawal', amountPence: 255, status: 'completed', createdAt: TS + 1, note: 'Chestnut' },
    { id: 'parent-funded-request', type: 'request_payment', amountPence: 425, childId: 'alisya', moneyRequestId: 'money-parent-funded', status: 'completed', createdAt: TS + 10 },
  ],
  transferRequests: [
    { id: 'transfer-al-mn', fromChildId: 'alisya', toChildId: 'mnalium', amountPence: 300, status: 'approved', createdAt: TS + 7 },
    { id: 'transfer-mn-mo', fromChildId: 'mnalium', toChildId: 'mostium', amountPence: 130, status: 'approved', createdAt: TS + 6 },
    { id: 'reviewed-transfer', fromChildId: 'alisya', toChildId: 'mnalium', amountPence: 500, status: 'approved', reviewedBy: 'parent-bob', reviewedByName: 'Bob', reviewedAt: TS + 12, createdAt: TS + 11 },
  ],
  moneyRequests: [
    { id: 'money-parent-funded', requesterId: 'alisya', requestedFromId: 'parent-ada', amountPence: 425, status: 'approved', reviewedBy: 'parent-ada', reviewedByName: 'Ada', reviewedAt: TS + 10, createdAt: TS + 9 },
    { id: 'reviewed-money', requesterId: 'mnalium', requestedFromId: 'parent-ada', amountPence: 250, status: 'rejected', reviewedBy: 'parent-bob', reviewedByName: 'Bob', reviewedAt: TS + 13, createdAt: TS + 12 },
  ],
  redemptions: [
    { id: 'E', rewardId: 'reward-1', userId: 'mostium', costPaid: 500, status: 'completed', createdAt: TS + 5 },
    { id: 'F', rewardId: 'reward-2', userId: 'alisya', costPaid: 100, status: 'completed', createdAt: TS + 4 },
  ],
  reversals: [
    { id: 'reversal-F', sourceKind: 'reward_redemption', sourceId: 'F', actorId: 'parent-bob', actorName: 'Bob', reason: 'No longer available', completedAt: TS + 40 },
    { id: 'reversal-G', sourceKind: 'wallet_transaction', sourceId: 'G', actorId: 'parent-bob', actorName: 'Bob', reason: 'Duplicate', completedAt: TS + 30 },
  ],
  opts: {
    currency: '£',
    nameResolver: id => names[id],
    rewardResolver: id => ({ 'reward-1': { title: 'Movie night' }, 'reward-2': { title: 'Extra screen time' } })[id],
  },
});

function event(id: string) {
  const result = events().find(candidate => candidate.transaction.id === id);
  if (!result) throw new Error(`Missing fixture ${id}`);
  return result;
}

describe('human-readable family events', () => {
  it.each([
    ['A: parent deposit', 'A', {
      subject: { id: 'mnalium', name: 'Mnalium' }, actor: { id: 'parent-ada', name: 'Ada' }, amountPence: 9000,
      status: 'completed', headline: '£90.00 added to Mnalium’s wallet', metadata: ['Performed by: Ada'],
    }],
    ['B: parent withdrawal', 'B', {
      subject: { id: 'alisya', name: 'Alisya' }, actor: { id: 'parent-ada', name: 'Ada' }, amountPence: -255,
      status: 'completed', headline: '£2.55 withdrawn from Alisya’s wallet', metadata: ['Performed by: Ada'],
    }],
    ['C: Alisya to Mnalium transfer', 'C', {
      subject: { id: 'alisya', name: 'Alisya' }, actor: { id: 'alisya', name: 'Alisya' }, approver: { id: 'parent-ada', name: 'Ada' },
      from: { id: 'alisya', name: 'Alisya' }, to: { id: 'mnalium', name: 'Mnalium' }, amountPence: -300,
      status: 'completed', headline: '£3.00 sent from Alisya to Mnalium', metadata: ['Performed by: Alisya', 'Approved by: Ada'],
    }],
    ['D: Mnalium to Mostium transfer', 'D', {
      subject: { id: 'mostium', name: 'Mostium' }, actor: { id: 'mnalium', name: 'Mnalium' }, approver: { id: 'parent-bob', name: 'Bob' },
      from: { id: 'mnalium', name: 'Mnalium' }, to: { id: 'mostium', name: 'Mostium' }, amountPence: 130,
      status: 'completed', headline: '£1.30 sent from Mnalium to Mostium', metadata: ['Performed by: Mnalium', 'Approved by: Bob'],
    }],
    ['E: child reward redemption', 'E', {
      subject: { id: 'mostium', name: 'Mostium' }, actor: { id: 'mostium', name: 'Mostium' }, amountPence: -500,
      status: 'completed', headline: '500 points redeemed by Mostium', metadata: ['Performed by: Mostium'],
    }],
    ['F: reversed reward redemption', 'F', {
      subject: { id: 'alisya', name: 'Alisya' }, actor: { id: 'alisya', name: 'Alisya' }, reverser: { id: 'parent-bob', name: 'Bob' }, amountPence: -100,
      status: 'reversed', headline: '100 points redeemed by Alisya', metadata: ['Performed by: Alisya', 'Reversed by: Bob'],
    }],
    ['G: wallet reversal', 'G', {
      subject: { id: 'alisya', name: 'Alisya' }, actor: { id: 'parent-ada', name: 'Ada' }, reverser: { id: 'parent-bob', name: 'Bob' }, reversalOccurredAt: TS + 30, amountPence: 450,
      status: 'reversed', headline: '£4.50 added to Alisya’s wallet', metadata: ['Performed by: Ada', 'Reversed by: Bob'],
    }],
  ] as const)('%s preserves factual roles and semantic copy', (_label, id, expected) => {
    const actual = event(id);
    expect(actual).toMatchObject(expected);
    expect(humanReadableFamilyEventHeadline(actual)).toBe(expected.headline);
    expect(humanReadableFamilyEventMetadata(actual)).toEqual(expected.metadata);
  });

  it('H: keeps note veciiz separate from semantic copy', () => {
    const actual = event('H');
    expect(actual.note).toBe('veciiz');
    expect(humanReadableFamilyEventHeadline(actual)).toBe('£1.00 added to Mostium’s wallet');
    expect(humanReadableFamilyEventMetadata(actual)).toEqual(['Performed by: Ada']);
  });

  it('I: omits missing legacy attribution without fabricating a party', () => {
    const actual = event('I');
    expect(actual).toMatchObject({ amountPence: -255, note: 'Chestnut', status: 'completed' });
    expect(actual.subject).toBeUndefined();
    expect(actual.actor).toBeUndefined();
    expect(actual.approver).toBeUndefined();
    expect(actual.reverser).toBeUndefined();
    expect(humanReadableFamilyEventHeadline(actual)).toBe('£2.55 withdrawn');
    expect(humanReadableFamilyEventMetadata(actual)).toEqual([]);
    expect(humanReadableFamilyEventHeadline(actual)).not.toContain('Unknown');
  });

  it('joins a money-request-backed transfer wallet leg through moneyRequestId', () => {
    const [actual] = adaptHumanReadableFamilyEvents({
      walletTransactions: [{
        id: 'money-leg', type: 'transfer_in', amountPence: 425, childId: 'alisya', moneyRequestId: 'money-1',
        actorId: 'parent-bob', status: 'completed', createdAt: TS,
      }],
      moneyRequests: [{
        id: 'money-1', requesterId: 'alisya', requestedFromId: 'parent-ada', amountPence: 425,
        status: 'approved', createdAt: TS,
      }],
      opts: { currency: '£', nameResolver: id => names[id] },
    });

    expect(actual).toMatchObject({
      from: { id: 'parent-ada', name: 'Ada' }, to: { id: 'alisya', name: 'Alisya' },
      actor: { id: 'alisya', name: 'Alisya' }, approver: { id: 'parent-bob', name: 'Bob' },
      headline: '£4.25 sent from Ada to Alisya', metadata: ['Performed by: Alisya', 'Approved by: Bob'],
    });
  });

  it('treats the child requester as the initiator of a parent-funded request payment', () => {
    const actual = event('parent-funded-request');

    expect(actual).toMatchObject({
      subject: { id: 'alisya', name: 'Alisya' },
      actor: { id: 'alisya', name: 'Alisya' },
      approver: { id: 'parent-ada', name: 'Ada' },
      from: { id: 'parent-ada', name: 'Ada' },
      to: { id: 'alisya', name: 'Alisya' },
      headline: '£4.25 sent from Ada to Alisya',
      metadata: ['Performed by: Alisya', 'Approved by: Ada'],
    });
    expect(actual.metadata).not.toContain('Performed by: Ada');
  });

  it.each([
    ['reviewed transfer request', 'reviewed-transfer', 'transfer_request', {
      actor: { id: 'alisya', name: 'Alisya' },
      approver: { id: 'parent-bob', name: 'Bob' },
      from: { id: 'alisya', name: 'Alisya' },
      to: { id: 'mnalium', name: 'Mnalium' },
      metadata: ['Performed by: Alisya', 'Approved by: Bob'],
    }],
    ['reviewed rejected money request', 'reviewed-money', 'money_request', {
      actor: { id: 'mnalium', name: 'Mnalium' },
      approver: { id: 'parent-bob', name: 'Bob' },
      from: { id: 'parent-ada', name: 'Ada' },
      to: { id: 'mnalium', name: 'Mnalium' },
      metadata: ['Performed by: Mnalium', 'Approved by: Bob'],
    }],
  ] as const)('retains stored reviewer attribution for a standalone %s', (_label, id, _kind, expected) => {
    const actual = event(id);
    expect(actual).toMatchObject(expected);
    expect(actual.transaction.reviewerId).toBe('parent-bob');
    expect(actual.transaction.reviewerName).toBe('Bob');
  });

  it('omits an unavailable original event time instead of synthesizing an epoch timestamp', () => {
    const [actual] = adaptHumanReadableFamilyEvents({
      walletTransactions: [{ id: 'missing-time', type: 'withdrawal', amountPence: 250, childId: 'alisya', status: 'completed' }],
      opts: { currency: '£', nameResolver: id => names[id] },
    });

    expect(actual.timestamp).toBeUndefined();
  });

  it('keeps endpoints but omits unsupported initiation and approval for a legacy generic transfer', () => {
    const [actual] = adaptHumanReadableFamilyEvents({
      walletTransactions: [{
        id: 'legacy-transfer', type: 'transfer', amountPence: 200, fromChildId: 'alisya', childId: 'mnalium',
        parentRef: 'parent-ada', status: 'completed', createdAt: TS,
      }],
      opts: { currency: '£', nameResolver: id => names[id] },
    });

    expect(actual).toMatchObject({
      from: { id: 'alisya', name: 'Alisya' }, to: { id: 'mnalium', name: 'Mnalium' },
      headline: '£2.00 sent from Alisya to Mnalium',
    });
    expect(actual.actor).toBeUndefined();
    expect(actual.approver).toBeUndefined();
    expect(actual.metadata).toEqual([]);
  });
});
