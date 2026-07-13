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
