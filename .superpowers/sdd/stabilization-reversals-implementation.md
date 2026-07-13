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

## Task C — strict Firestore reversal authorization

- Extracted `buildReversalPayloads` as the single production/test contract for deterministic reversal records, events, wallet ledgers, and fund ledgers. Every artifact now snapshots both authenticated actor UID and stored actor display name.
- Reversal records accept only same-family parent/owner creates, exact keys, request-time timestamps, deterministic `<sourceKind>__<sourceId>` linkage, supported source kinds, the stored immutable source snapshot, and the mathematically exact inverse snapshot.
- Reversal records, events, and inverse ledgers are append-only. Reusing a deterministic record ID is denied, making duplicate financial application impossible at the rules boundary.
- Wallet, counter-wallet, fund, and point mutations require the matching after-state reversal record and deterministic inverse ledger. Wallet balances enforce the family debt limit; funds and points cannot become negative. Lifetime XP is excluded from the allowed point mutation and both evidence documents retain `xpAdjustment: 0` / `xpReversed: false`.
- Rule dependencies are intentionally one-directional: effect subwrites read the terminal reversal record, while the record validates the immutable original and inverse contract without reading subwrites. This avoids circular `getAfter` evaluation and remained below Firestore access/expression limits in the complete suite.
- Emulator coverage exercises exact production payloads for wallet transactions, fund transactions, behaviour events, task completions, reward redemptions, transfer requests, money requests, and Pet Box requests. Negative coverage includes child/wrong-family actors, forged UID/name, altered amount, extra keys, wrong timestamp/source, duplicates, immutable artifacts, legacy missing snapshots, wallet debt, and fund insufficiency.

Task C evidence:

- Focused reversal rules: 20 passed.
- Full Firestore rules suite on JDK 21: 124 passed.
- Non-emulator unit/component suite: 121 passed.
- Scoped Oxlint: passed.
- Production build: passed.

## Task D — live normalized history and reversal controls

- Added a single normalized `HistoryAction` resolver for wallet transactions, fund transactions, behaviour events, task completions, reward redemptions, transfer requests, money requests, and Pet Box requests. It joins deterministic reversal records, derives signed original effects and predicted post-action balances from live state, and hides controls for children, legacy/missing snapshots, insufficient balance linkage, reversal ledgers, unsupported sources, and already-reversed records.
- Added `reversals` to the role-aware bootstrap query plan and Zustand family state. All family members receive immutable reversal snapshots, cleanup clears them, and the parent history reconciles without a refresh.
- Added parent/owner controls to the existing Parent Console wallet history, wallet transaction details, fund history, member behaviour history, Approval Center pending/history cards, and reward redemption history, plus a consolidated `Reversible history` panel. Canonical request/event sources suppress duplicate approval wallet/fund-leg controls.
- Hardened canonical-source normalization so derived behaviour, transfer, money-request, and Pet Box wallet/fund ledger legs never expose a second reversal control. A request-linked snapshot is actionable only on its canonical request ID, while ordinary manual wallet transfers remain reversible.
- Mounted wallet transaction details from the wallet history and mounted the fund cards through the `/pet-box` dashboard route, with integration tests covering both consumers.
- Added a reusable confirmation modal with source summary, affected targets, signed original effect, predicted balance/points, a trimmed three-character reason, synchronous duplicate-submit protection, action-specific loading, exact errors without closing, success reconciliation, and the exact warning: “This creates a linked reversal record. The original action will remain in history.”
- Successful submission immediately replaces the control with a `Reversed` badge plus reason, actor name, and time while the Firestore listener reconciles the immutable stored record. Persisted audit time is normalized from `completedAt` (with `createdAt` compatibility). Failure retains both modal and reason; reopening a different action resets stale modal state.
- The live reversal query orders by the persisted `completedAt` field, so completed reversal records are included in listener results and reconcile without refresh.
- Parent/owner cancellation is now authorized by both the production API and exact pending-only Firestore transitions, while the existing originator cancellation remains valid. Cancellation performs no balance mutation and reconciles to `Cancelled` immediately.

Task D action matrix:

| Source | Pending action | Completed action | Canonical UI source |
|---|---|---|---|
| Manual wallet deposit | N/A | Reverse | `wallet_transaction` |
| Manual wallet withdrawal | N/A | Refund | `wallet_transaction` |
| Manual parent transfer | N/A | Reverse/Refund preview for both wallets | `wallet_transaction` |
| Fund expense | N/A | Refund | `fund_transaction` |
| Behaviour event / financial penalty | N/A | Reverse/Refund | `behaviour_event` |
| Task completion | Parent/owner or stored originator can Cancel | Reverse | `task_completion` |
| Reward redemption | N/A | Refund | `reward_redemption` |
| Transfer request | Parent/owner or `fromChildId` can Cancel | Reverse | `transfer_request` |
| Money request | Parent/owner or `requesterId` can Cancel | Reverse/Refund | `money_request` |
| Pet Box request | Parent/owner or `childId` can Cancel | Refund | `petbox_request` |
| Approval wallet/fund legs, reversal ledgers, legacy/unsupported records | Hidden | Hidden | Canonical request/event is used instead |

Task D evidence:

- Focused final security and route integration regression tests: 22 passed across 5 files.
- Non-emulator unit/component suite: 158 passed across 24 files.
- Full Firestore rules suite on JDK 21: 128 passed across 6 files.
- Repository-wide Oxlint: passed (warnings only in unrelated utility scripts).
- Production build: passed with the existing advisory dynamic-import and chunk-size warnings.
