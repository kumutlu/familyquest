import { describe, it, expect } from 'vitest';
import { findLegacyPetboxRequest, logLegacyMatchDiagnostics } from './legacyPetboxMatcher';

describe('legacyPetboxMatcher', () => {
  const timestamp = (offset = 0) => new Date(1000000000 + offset * 1000);

  it('matches exactly one approved petbox_request with all fields matching', () => {
    const petboxRequests = [
      {
        id: 'pet-1',
        familyId: 'family-1',
        fundId: 'fund-1',
        childId: 'child-1',
        amountPence: 500,
        status: 'approved',
        createdAt: timestamp(0),
      }
    ];

    const result = findLegacyPetboxRequest(
      {
        fundTxId: 'tx-1',
        familyId: 'family-1',
        fundId: 'fund-1',
        fromUserId: 'child-1',
        amount: 500,
        createdAt: timestamp(10),
      },
      petboxRequests
    );

    expect(result.matched).toBe(true);
    expect(result.petboxRequestId).toBe('pet-1');
    expect(result.matchCount).toBe(1);
  });

  it('returns no match when familyId differs', () => {
    const petboxRequests = [
      {
        id: 'pet-1',
        familyId: 'family-2',
        fundId: 'fund-1',
        childId: 'child-1',
        amountPence: 500,
        status: 'approved',
        createdAt: timestamp(0),
      }
    ];

    const result = findLegacyPetboxRequest(
      {
        fundTxId: 'tx-1',
        familyId: 'family-1',
        fundId: 'fund-1',
        fromUserId: 'child-1',
        amount: 500,
        createdAt: timestamp(10),
      },
      petboxRequests
    );

    expect(result.matched).toBe(false);
    expect(result.matchCount).toBe(0);
    expect(result.reason).toContain('No approved');
  });

  it('returns no match when fundId differs', () => {
    const petboxRequests = [
      {
        id: 'pet-1',
        familyId: 'family-1',
        fundId: 'fund-2',
        childId: 'child-1',
        amountPence: 500,
        status: 'approved',
        createdAt: timestamp(0),
      }
    ];

    const result = findLegacyPetboxRequest(
      {
        fundTxId: 'tx-1',
        familyId: 'family-1',
        fundId: 'fund-1',
        fromUserId: 'child-1',
        amount: 500,
        createdAt: timestamp(10),
      },
      petboxRequests
    );

    expect(result.matched).toBe(false);
    expect(result.matchCount).toBe(0);
  });

  it('returns no match when childId differs', () => {
    const petboxRequests = [
      {
        id: 'pet-1',
        familyId: 'family-1',
        fundId: 'fund-1',
        childId: 'child-2',
        amountPence: 500,
        status: 'approved',
        createdAt: timestamp(0),
      }
    ];

    const result = findLegacyPetboxRequest(
      {
        fundTxId: 'tx-1',
        familyId: 'family-1',
        fundId: 'fund-1',
        fromUserId: 'child-1',
        amount: 500,
        createdAt: timestamp(10),
      },
      petboxRequests
    );

    expect(result.matched).toBe(false);
    expect(result.matchCount).toBe(0);
  });

  it('returns no match when amount differs', () => {
    const petboxRequests = [
      {
        id: 'pet-1',
        familyId: 'family-1',
        fundId: 'fund-1',
        childId: 'child-1',
        amountPence: 600,
        status: 'approved',
        createdAt: timestamp(0),
      }
    ];

    const result = findLegacyPetboxRequest(
      {
        fundTxId: 'tx-1',
        familyId: 'family-1',
        fundId: 'fund-1',
        fromUserId: 'child-1',
        amount: 500,
        createdAt: timestamp(10),
      },
      petboxRequests
    );

    expect(result.matched).toBe(false);
    expect(result.matchCount).toBe(0);
  });

  it('returns no match when status is not approved', () => {
    const petboxRequests = [
      {
        id: 'pet-1',
        familyId: 'family-1',
        fundId: 'fund-1',
        childId: 'child-1',
        amountPence: 500,
        status: 'pending',
        createdAt: timestamp(0),
      }
    ];

    const result = findLegacyPetboxRequest(
      {
        fundTxId: 'tx-1',
        familyId: 'family-1',
        fundId: 'fund-1',
        fromUserId: 'child-1',
        amount: 500,
        createdAt: timestamp(10),
      },
      petboxRequests
    );

    expect(result.matched).toBe(false);
    expect(result.matchCount).toBe(0);
  });

  it('returns no match when fund_transaction timestamp is before petbox_request', () => {
    const petboxRequests = [
      {
        id: 'pet-1',
        familyId: 'family-1',
        fundId: 'fund-1',
        childId: 'child-1',
        amountPence: 500,
        status: 'approved',
        createdAt: timestamp(100),
      }
    ];

    const result = findLegacyPetboxRequest(
      {
        fundTxId: 'tx-1',
        familyId: 'family-1',
        fundId: 'fund-1',
        fromUserId: 'child-1',
        amount: 500,
        createdAt: timestamp(50),
      },
      petboxRequests
    );

    expect(result.matched).toBe(false);
    expect(result.matchCount).toBe(0);
  });

  it('returns no match when fund_transaction timestamp is too far after petbox_request (>5 min)', () => {
    const petboxRequests = [
      {
        id: 'pet-1',
        familyId: 'family-1',
        fundId: 'fund-1',
        childId: 'child-1',
        amountPence: 500,
        status: 'approved',
        createdAt: timestamp(0),
      }
    ];

    const result = findLegacyPetboxRequest(
      {
        fundTxId: 'tx-1',
        familyId: 'family-1',
        fundId: 'fund-1',
        fromUserId: 'child-1',
        amount: 500,
        createdAt: timestamp(400), // 400 seconds = 6.67 minutes
      },
      petboxRequests
    );

    expect(result.matched).toBe(false);
    expect(result.matchCount).toBe(0);
  });

  it('matches when fund_transaction timestamp is within 5 minutes of petbox_request', () => {
    const petboxRequests = [
      {
        id: 'pet-1',
        familyId: 'family-1',
        fundId: 'fund-1',
        childId: 'child-1',
        amountPence: 500,
        status: 'approved',
        createdAt: timestamp(0),
      }
    ];

    const result = findLegacyPetboxRequest(
      {
        fundTxId: 'tx-1',
        familyId: 'family-1',
        fundId: 'fund-1',
        fromUserId: 'child-1',
        amount: 500,
        createdAt: timestamp(200), // 200 seconds = 3.33 minutes (within 5 min)
      },
      petboxRequests
    );

    expect(result.matched).toBe(true);
    expect(result.petboxRequestId).toBe('pet-1');
  });

  it('returns multiple matches when more than one petbox_request matches', () => {
    const petboxRequests = [
      {
        id: 'pet-1',
        familyId: 'family-1',
        fundId: 'fund-1',
        childId: 'child-1',
        amountPence: 500,
        status: 'approved',
        createdAt: timestamp(0),
      },
      {
        id: 'pet-2',
        familyId: 'family-1',
        fundId: 'fund-1',
        childId: 'child-1',
        amountPence: 500,
        status: 'approved',
        createdAt: timestamp(50),
      }
    ];

    const result = findLegacyPetboxRequest(
      {
        fundTxId: 'tx-1',
        familyId: 'family-1',
        fundId: 'fund-1',
        fromUserId: 'child-1',
        amount: 500,
        createdAt: timestamp(100),
      },
      petboxRequests
    );

    expect(result.matched).toBe(false);
    expect(result.matchCount).toBe(2);
    expect(result.reason).toContain('Multiple');
    expect(result.diagnostics.matchedIds).toEqual(['pet-1', 'pet-2']);
  });

  it('handles Firestore Timestamp objects', () => {
    const firestoreTimestamp = {
      toDate: () => new Date(1000000000 * 1000 + 10000),
    };

    const petboxRequests = [
      {
        id: 'pet-1',
        familyId: 'family-1',
        fundId: 'fund-1',
        childId: 'child-1',
        amountPence: 500,
        status: 'approved',
        createdAt: firestoreTimestamp,
      }
    ];

    const result = findLegacyPetboxRequest(
      {
        fundTxId: 'tx-1',
        familyId: 'family-1',
        fundId: 'fund-1',
        fromUserId: 'child-1',
        amount: 500,
        createdAt: {
          toDate: () => new Date(1000000000 * 1000 + 20000),
        },
      },
      petboxRequests
    );

    expect(result.matched).toBe(true);
    expect(result.petboxRequestId).toBe('pet-1');
  });

  it('prefers amountPence over amount field', () => {
    const petboxRequests = [
      {
        id: 'pet-1',
        familyId: 'family-1',
        fundId: 'fund-1',
        childId: 'child-1',
        amountPence: 500,
        amount: 5,
        status: 'approved',
        createdAt: timestamp(0),
      }
    ];

    const result = findLegacyPetboxRequest(
      {
        fundTxId: 'tx-1',
        familyId: 'family-1',
        fundId: 'fund-1',
        fromUserId: 'child-1',
        amount: 500,
        createdAt: timestamp(10),
      },
      petboxRequests
    );

    expect(result.matched).toBe(true);
    expect(result.petboxRequestId).toBe('pet-1');
  });

  it('logs diagnostic output without throwing', () => {
    const result = findLegacyPetboxRequest(
      {
        fundTxId: 'tx-1',
        familyId: 'family-1',
        fundId: 'fund-1',
        fromUserId: 'child-1',
        amount: 500,
        createdAt: timestamp(10),
      },
      []
    );

    expect(() => logLegacyMatchDiagnostics(result, true)).not.toThrow();
    expect(result.matched).toBe(false);
  });
});
