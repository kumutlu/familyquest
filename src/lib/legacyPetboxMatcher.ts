/**
 * Safe matching strategy for legacy pet box donations without sourceId links.
 * 
 * Rules:
 * 1. Never match only by amount.
 * 2. Require enough fields to identify exactly one request.
 * 3. If exactly one safe match exists, allow refund through that petbox_request.
 * 4. If zero or multiple matches exist, show "Legacy donation — refund unavailable"
 */

export interface LegacyMatchResult {
  matched: boolean;
  petboxRequestId?: string;
  reason: string;
  matchCount: number;
  diagnostics: {
    fundTxId: string;
    searchCriteria: Record<string, any>;
    matchedIds: string[];
  };
}

export interface LegacyMatchInput {
  fundTxId: string;
  familyId: string;
  fundId: string;
  fromUserId: string;
  amount: number; // in pence
  createdAt: Date | { toDate?: () => Date } | number;
}

/**
 * Normalize a date-like value to Date
 */
function toDate(value: any): Date {
  if (!value) return new Date(0);
  if (value.toDate && typeof value.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  return new Date(value);
}

/**
 * Try to find exactly one approved petbox_request matching the fund_transaction.
 * 
 * Matching criteria (all must match):
 * - familyId
 * - fundId
 * - childId === fromUserId
 * - amountPence === amount (in pence)
 * - status === 'approved'
 * - createdAt within 5 minutes (handles async processing delay)
 * 
 * Returns matched petbox_request only if exactly one match found.
 */
export function findLegacyPetboxRequest(
  input: LegacyMatchInput,
  petboxRequests: any[]
): LegacyMatchResult {
  const fundTxCreatedAt = toDate(input.createdAt);
  
  // Filter candidates: must match familyId, fundId, childId, amount, status, recent timestamp
  const candidates = petboxRequests.filter(req => {
    // 1. Must match familyId exactly
    if (req.familyId !== input.familyId) return false;
    
    // 2. Must match fundId exactly
    if (req.fundId !== input.fundId) return false;
    
    // 3. Must match childId exactly
    if (req.childId !== input.fromUserId) return false;
    
    // 4. Must match amount exactly (convert to pence if needed)
    const reqAmount = typeof req.amountPence === 'number' ? req.amountPence : req.amount;
    if (reqAmount !== input.amount) return false;
    
    // 5. Must be approved
    if (req.status !== 'approved') return false;
    
    // 6. Timestamps should be close (fund_transaction created after petbox_request approval)
    // Allow up to 5 minutes difference to account for async processing
    const reqCreatedAt = toDate(req.createdAt);
    const timeDiff = fundTxCreatedAt.getTime() - reqCreatedAt.getTime();
    if (timeDiff < 0 || timeDiff > 5 * 60 * 1000) return false;
    
    return true;
  });

  const diagnostics = {
    fundTxId: input.fundTxId,
    searchCriteria: {
      familyId: input.familyId,
      fundId: input.fundId,
      fromUserId: input.fromUserId,
      amountPence: input.amount,
      status: 'approved',
      timeTolerance: '5 minutes',
    },
    matchedIds: candidates.map(c => c.id),
  };

  if (candidates.length === 0) {
    return {
      matched: false,
      reason: 'No approved petbox_request found matching familyId, fundId, childId, and amount',
      matchCount: 0,
      diagnostics,
    };
  }

  if (candidates.length > 1) {
    return {
      matched: false,
      reason: `Multiple approved petbox_requests match (${candidates.length}). Cannot safely determine which to refund. Requires manual intervention.`,
      matchCount: candidates.length,
      diagnostics,
    };
  }

  // Exactly one match found
  const matched = candidates[0];
  return {
    matched: true,
    petboxRequestId: matched.id,
    reason: 'Exactly one matching approved petbox_request found',
    matchCount: 1,
    diagnostics,
  };
}

/**
 * Log matching diagnostics for debugging
 */
export function logLegacyMatchDiagnostics(result: LegacyMatchResult, verbose = false): void {
  const prefix = `[LegacyPetboxMatcher] TX ${result.diagnostics.fundTxId}`;
  
  if (result.matched) {
    console.log(`${prefix} ✓ MATCHED petbox_request ${result.petboxRequestId}`);
    if (verbose) {
      console.log(`  Reason: ${result.reason}`);
      console.log(`  Criteria:`, result.diagnostics.searchCriteria);
    }
  } else {
    console.warn(`${prefix} ✗ UNMATCHED (${result.matchCount} candidates found)`);
    console.warn(`  Reason: ${result.reason}`);
    if (verbose) {
      console.warn(`  Criteria:`, result.diagnostics.searchCriteria);
      if (result.diagnostics.matchedIds.length > 0) {
        console.warn(`  Candidate IDs: ${result.diagnostics.matchedIds.join(', ')}`);
      }
    }
  }
}
