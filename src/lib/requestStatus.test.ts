import { describe, it, expect } from 'vitest';
import {
  isPendingApprovalStatus,
  isApprovedStatus,
  isRejectedStatus,
  isCancelledStatus,
  isResolvedStatus,
} from './requestStatus';

describe('central request status classification', () => {
  it('classifies pending_acceptance as a pending approval status', () => {
    expect(isPendingApprovalStatus('pending_acceptance')).toBe(true);
  });

  it('classifies pending and pending_approval as pending', () => {
    expect(isPendingApprovalStatus('pending')).toBe(true);
    expect(isPendingApprovalStatus('pending_approval')).toBe(true);
  });

  it('does not classify resolved statuses as pending', () => {
    expect(isPendingApprovalStatus('approved')).toBe(false);
    expect(isPendingApprovalStatus('rejected')).toBe(false);
    expect(isPendingApprovalStatus('cancelled')).toBe(false);
    expect(isPendingApprovalStatus(undefined)).toBe(false);
    expect(isPendingApprovalStatus(null)).toBe(false);
  });

  it('classifies approved / completed as approved', () => {
    expect(isApprovedStatus('approved')).toBe(true);
    expect(isApprovedStatus('completed')).toBe(true);
    expect(isApprovedStatus('pending')).toBe(false);
  });

  it('classifies rejected', () => {
    expect(isRejectedStatus('rejected')).toBe(true);
    expect(isRejectedStatus('approved')).toBe(false);
  });

  it('classifies cancelled', () => {
    expect(isCancelledStatus('cancelled')).toBe(true);
    expect(isCancelledStatus('pending')).toBe(false);
  });

  it('classifies resolved (approved, rejected, cancelled)', () => {
    expect(isResolvedStatus('approved')).toBe(true);
    expect(isResolvedStatus('rejected')).toBe(true);
    expect(isResolvedStatus('cancelled')).toBe(true);
    expect(isResolvedStatus('pending_acceptance')).toBe(false);
  });
});
