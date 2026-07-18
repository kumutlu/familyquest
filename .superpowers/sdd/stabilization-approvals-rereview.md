# Approval Center remediation re-review

Reviewed against every Critical and Important finding in `stabilization-approvals-review.md`.

## Verdict: READY

- **C1 closed:** Task approval and reward redemption are bidirectionally value-bound to their stored task/reward, exact user mutation, immutable terminal record, and canonical effect snapshot. Broad parent/owner child-profile mutation branches are gone.
- **C2 closed:** Transfer, money, and Pet Box ledger validators require the matching request to become approved in the same transaction. Terminal validators require exact paired wallets/ledgers/fund effects. Partial transfer and Pet Box batches are denied in emulator tests.
- **C3 closed:** Standalone wallet creation cannot choose an arbitrary balance. Exact zero/legacy initialization and linked operation creation are supported. Parent-funded money succeeds for existing, zero-new, and integer-legacy wallets.
- **C4 closed:** The broken claim-approval action and API are removed. Normal joins derive identity from the pending request and rules require the request, profile, child wallet, and deterministic feed together. Join history cannot be deleted.
- **I1 closed for the corrected matrix:** Coverage includes production API payload tests for task, join, and existing-wallet parent money; rules-backed task/reward/join/transfer/money/Pet contracts; partial effects; replay/identity denials; and exact wallet post-states.
- **I2 closed:** Processing is stored per composite key and explicit non-empty rejection reasons are collected, sent, rule-validated, and retained.
- **I3 closed:** Reviewer identity comes from Auth; join target identity/name and financial amounts/linkage come from stored request documents inside transactions.

Verification observed after remediation:

- Focused API/UI: 18 passed.
- Firestore emulator: 104 passed.
- Production build: passed.

## Follow-up after independent review blockers

The subsequent independent review identified approved-request wallet replay, standalone Pet Box wallet ledgers, Firestore read-after-write ordering for missing wallets, and single-slot join loading. The follow-up closes each boundary:

- Wallet creation now has exact migration, manual, transfer, money, and Pet Box branches. Operation branches require the stored request to move from pending to approved in the same transaction, bind the affected child and canonical transaction ID, and enforce the exact legacy-plus-delta balance.
- Pet Box wallet ledgers require the pending-to-approved request transition, canonical approval ID, authenticated actor, family/child/fund/source linkage, exact signed amount, timestamp, terminal status, and effect snapshot.
- Transfer and money approval APIs preload every user and wallet snapshot before queuing any write. Production-path tests use a transaction mock that rejects reads after writes and cover both transfer wallets missing plus a missing sibling-money requester wallet.
- Join processing is a composite-keyed map, with a concurrent two-card component regression.

Final verification after this follow-up:

- Focused API/UI: 8 passed.
- Firestore emulator: 127 passed, including the additional typed-transfer missing-wallet success regression.
- Non-emulator unit/component: 124 passed.
- Scoped oxlint: clean.
- Production build: passed (advisory chunk-size/dynamic-import warnings only).
