# Reversal Stabilization Implementation

## Task A — immutable source/effect contracts

Implemented the source-side prerequisites for a later reversal dispatcher. No reversal dispatcher or UI is included in this phase.

- Added a versioned `effectSnapshot` contract with signed wallet, fund, and points deltas, immutable source/request IDs, family/subject IDs, authenticated actor IDs, and an explicit zero XP reversal adjustment.
- Manual deposits, withdrawals, and parent transfers now derive the actor from Firebase Auth and write completed, self-linked ledger sources.
- Behaviour events/financial ledgers, approved task completions, reward redemptions, fund expenses, Pet Box approvals, child transfers, and money-request approvals now persist traceable effect snapshots and existing linked transaction IDs.
- Fund expenses now reject an insufficient balance before any write and persist an authenticated actor.
- Pending task, transfer, money, and Pet Box requests have a pending-only `cancelled` transition. Only the authenticated originator may cancel; cancellation performs no balance write.
- Firestore rules accept canonical snapshots while retaining compatibility with already-valid legacy records, and explicitly authorize originator-only cancellation transitions.
- Legacy records without a snapshot are rejected by the source contract with the exact error: `This legacy transaction cannot be reversed automatically. Missing effectSnapshot.`
- Direct fund contributions and allowance actions are not present in the application and are therefore N/A for Task A.

Evidence:

- Contract/API tests: 19 passed across reversal, traceability, approval, and behaviour suites.
- Unit/component suite excluding emulator-only rule files: 110 passed.
- Firestore rules suite on JDK 21: 95 passed (including two cancellation rule tests).
- Production build: passed.

## Task B — typed atomic reversal dispatcher

- Added a typed dispatcher for every traceable action family present in the application: wallet transactions (deposit, withdrawal, manual/approved transfers, money and Pet Box wallet effects), fund transactions (expense and Pet Box), behaviour events, approved task completions, reward redemptions, transfer requests, money requests, and Pet Box requests.
- Each source kind resolves through a closed collection map. Unsupported kinds are rejected before a transaction starts.
- Reversal IDs are deterministic (`<sourceKind>__<encodedSourceId>`). The transaction reads that record before applying effects, so retries return `already_reversed` without a second inverse.
- The transaction authenticates a current family parent/owner, reads the immutable source snapshot and every affected balance before writing, validates the family/version/XP contract, then applies the exact signed inverse atomically.
- Wallet reversals enforce the family debt limit; fund and points reversals enforce non-negative sufficiency. Lifetime XP is never updated. Both reversal records and events explicitly persist `xpAdjustment: 0` and `xpReversed: false`.
- Every affected wallet/fund receives a deterministic immutable inverse ledger record. Every action also receives a deterministic reversal event and completed reversal record containing original and inverse snapshots.
- Legacy sources retain the exact failure: `This legacy transaction cannot be reversed automatically. Missing effectSnapshot.`
- Allowance and direct fund contribution remain N/A because those actions do not exist in the application.

Task B evidence:

- Reversal domain/API tests: 7 passed, including multi-account exact inversion, debt/fund/points sufficiency, deterministic IDs, all source mappings, atomic evidence, retry idempotency, and exact legacy rejection.
- Non-emulator unit/component suite: 117 passed.
- Scoped Oxlint: passed.
- Production build: passed.
