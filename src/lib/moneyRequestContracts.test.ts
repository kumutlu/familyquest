import { describe, it, expect } from 'vitest';
import {
  canApproveMoneyRequest,
  canRejectMoneyRequest,
  canAcceptMoneyRequest,
  canParentManageMoneyRequest,
} from './moneyRequestContracts';

const parent = { id: 'p1', role: 'parent', familyId: 'fam' };
const owner = { id: 'o1', role: 'owner', familyId: 'fam' };
const child = { id: 'c1', role: 'child', familyId: 'fam' };
const otherParent = { id: 'p2', role: 'parent', familyId: 'other' };

describe('moneyRequestContracts', () => {
  it('parent can approve a pending request', () => {
    expect(canApproveMoneyRequest({ familyId: 'fam', requesterId: 'c1', requestedFromId: 'p1', amountPence: 100, status: 'pending' }, parent)).toBe(true);
  });

  it('parent cannot approve a pending_acceptance request', () => {
    expect(canApproveMoneyRequest({ familyId: 'fam', requesterId: 'c1', requestedFromId: 'c2', amountPence: 100, status: 'pending_acceptance' }, parent)).toBe(false);
  });

  it('parent can reject pending or pending_acceptance', () => {
    expect(canRejectMoneyRequest({ familyId: 'fam', requesterId: 'c1', requestedFromId: 'p1', amountPence: 100, status: 'pending' }, parent)).toBe(true);
    expect(canRejectMoneyRequest({ familyId: 'fam', requesterId: 'c1', requestedFromId: 'c2', amountPence: 100, status: 'pending_acceptance' }, parent)).toBe(true);
  });

  it('owner is treated like a parent', () => {
    expect(canApproveMoneyRequest({ familyId: 'fam', requesterId: 'c1', requestedFromId: 'o1', amountPence: 100, status: 'pending' }, owner)).toBe(true);
  });

  it('child cannot approve or reject', () => {
    expect(canApproveMoneyRequest({ familyId: 'fam', requesterId: 'c1', requestedFromId: 'p1', amountPence: 100, status: 'pending' }, child)).toBe(false);
    expect(canRejectMoneyRequest({ familyId: 'fam', requesterId: 'c1', requestedFromId: 'p1', amountPence: 100, status: 'pending' }, child)).toBe(false);
  });

  it('wrong-family parent is denied', () => {
    expect(canApproveMoneyRequest({ familyId: 'fam', requesterId: 'c1', requestedFromId: 'p1', amountPence: 100, status: 'pending' }, otherParent)).toBe(false);
  });

  it('requested-from person can accept a pending_acceptance request', () => {
    expect(canAcceptMoneyRequest({ familyId: 'fam', requesterId: 'c1', requestedFromId: 'c2', amountPence: 100, status: 'pending_acceptance' }, { id: 'c2', role: 'child', familyId: 'fam' })).toBe(true);
  });

  it('a different person cannot accept', () => {
    expect(canAcceptMoneyRequest({ familyId: 'fam', requesterId: 'c1', requestedFromId: 'c2', amountPence: 100, status: 'pending_acceptance' }, parent)).toBe(false);
  });

  it('canParentManageMoneyRequest is false for resolved statuses', () => {
    expect(canParentManageMoneyRequest({ familyId: 'fam', status: 'approved' }, parent)).toBe(false);
    expect(canParentManageMoneyRequest({ familyId: 'fam', status: 'rejected' }, parent)).toBe(false);
  });
});
