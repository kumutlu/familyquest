import { describe, expect, it } from 'vitest';
import {
  eligibleRecipients,
  quickAmountsForBalance,
  validateAmountPence,
  type TransferMemberLike,
} from './transferFlow';

const member = (overrides: Partial<TransferMemberLike> & { id: string }): TransferMemberLike => ({
  role: 'child',
  familyId: 'f1',
  displayName: overrides.id,
  isActive: true,
  ...overrides,
});

describe('amount validation (integer pence, no floating-point money)', () => {
  it('accepts whole and 2-decimal amounts', () => {
    expect(validateAmountPence('2', 500)).toEqual({ pence: 200, error: null });
    expect(validateAmountPence('1.50', 500)).toEqual({ pence: 150, error: null });
    expect(validateAmountPence('0.10', 500)).toEqual({ pence: 10, error: null });
  });

  it('rejects empty, invalid, zero and negative input', () => {
    expect(validateAmountPence('', 500).error).toBe('empty');
    expect(validateAmountPence('   ', 500).error).toBe('empty');
    expect(validateAmountPence('abc', 500).error).toBe('invalid');
    expect(validateAmountPence('0', 500).error).toBe('too_small');
    expect(validateAmountPence('-2', 500).error).toBe('too_small');
  });

  it('rejects more than two decimal places', () => {
    expect(validateAmountPence('1.999', 500).error).toBe('precision');
  });

  it('rejects amounts above the authoritative balance', () => {
    const result = validateAmountPence('6', 500);
    expect(result.error).toBe('insufficient');
    expect(result.pence).toBe(0);
  });

  it('allows the exact balance', () => {
    expect(validateAmountPence('5', 500)).toEqual({ pence: 500, error: null });
  });
});

describe('eligible recipient filtering (actual transfer permissions)', () => {
  it('keeps only active same-family children excluding the sender', () => {
    const members = [
      member({ id: 'me' }),
      member({ id: 'sib', displayName: 'Zed' }),
      member({ id: 'parent', role: 'parent' }),
      member({ id: 'other-family', familyId: 'f2' }),
      member({ id: 'inactive', isActive: false }),
    ];
    expect(eligibleRecipients(members, 'me', 'f1').map(m => m.id)).toEqual(['sib']);
  });

  it('returns an empty list for a single-child family (no fake send UI)', () => {
    const members = [member({ id: 'only-child' }), member({ id: 'dad', role: 'parent' })];
    expect(eligibleRecipients(members, 'only-child', 'f1')).toEqual([]);
  });

  it('sorts recipients by display name deterministically', () => {
    const members = [member({ id: 'b', displayName: 'Burak' }), member({ id: 'a', displayName: 'Ali' })];
    expect(eligibleRecipients(members, 'me', 'f1').map(m => m.displayName)).toEqual(['Ali', 'Burak']);
  });
});

describe('quick amount chips', () => {
  it('offers only chips the balance can cover', () => {
    expect(quickAmountsForBalance(250)).toEqual([100, 200]);
    expect(quickAmountsForBalance(1000)).toEqual([100, 200, 500, 1000]);
  });

  it('offers nothing on an empty wallet instead of inviting failure', () => {
    expect(quickAmountsForBalance(0)).toEqual([]);
  });
});
