/**
 * Staged send-money flow logic — Queki v2 Wave 3.
 *
 * PURE + deterministic. Wraps the authoritative `createTransferRequest`
 * contract (child → child sibling transfer, parent-approved):
 *  - amounts are INTEGER PENCE end-to-end; no floating-point money ever;
 *  - eligible recipients mirror the API's own validation exactly
 *    (both children, same family, sender ≠ recipient, active members);
 *  - validation errors are typed so the UI can show specific, safe messages.
 */

import { isChildRole } from '../roles';

export interface TransferMemberLike {
  id: string;
  role?: string;
  familyId?: string;
  displayName?: string;
  avatarUrl?: string;
  isActive?: boolean;
}

export type AmountError =
  | 'empty'
  | 'invalid'
  | 'too_small'
  | 'precision'
  | 'insufficient';

/**
 * Validate a user-entered amount against the AUTHORITATIVE balance.
 * Returns integer pence on success. Mirrors the existing SendMoneyModal rules:
 * > 0, at most 2 decimal places, ≤ balance. No new money semantics introduced.
 */
export function validateAmountPence(
  raw: string,
  balancePence: number,
): { pence: number; error: AmountError | null } {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return { pence: 0, error: 'empty' };
  const value = Number(trimmed);
  if (!Number.isFinite(value) || Number.isNaN(value)) {
    return { pence: 0, error: 'invalid' };
  }
  if (value <= 0) return { pence: 0, error: 'too_small' };
  const pence = Math.round(value * 100);
  if (Math.abs(value * 100 - pence) > 1e-6) {
    return { pence: 0, error: 'precision' };
  }
  if (pence > balancePence) return { pence: 0, error: 'insufficient' };
  return { pence, error: null };
}

/**
 * Eligible send recipients: active children in the sender's family, excluding
 * the sender. Single-child families yield an empty list — the UI must degrade
 * honestly instead of rendering a broken send experience.
 */
export function eligibleRecipients(
  members: TransferMemberLike[],
  senderId: string,
  familyId: string,
): TransferMemberLike[] {
  return (members || [])
    .filter(
      m =>
        m.id !== senderId &&
        isChildRole(m.role) &&
        m.familyId === familyId &&
        m.isActive !== false,
    )
    .sort((a, b) => String(a.displayName ?? '').localeCompare(String(b.displayName ?? '')));
}

/** Convenience chips — currency-agnostic minor-unit values, never business rules. */
export const QUICK_AMOUNTS_PENCE = [100, 200, 500, 1000] as const;

/** A chip is only offered when the balance can actually cover it. */
export function quickAmountsForBalance(balancePence: number): number[] {
  return QUICK_AMOUNTS_PENCE.filter(pence => pence <= balancePence);
}
