# Approval Center stabilization audit

Date: 2026-07-13
Scope: read-only audit of Approval Center UI, client APIs, Firestore rules, focused tests, and git history against Phase 3 of `pasted-text.txt`. No product code was changed.

## Executive result

Approval Center is **not production-ready**. Eight actions are displayed in the extracted `ApprovalCenter`, join approve/reject is displayed separately in `ParentDashboard`, and reward redemption is immediate (there is no reward-approval workflow). The focused emulator run failed **10/33 tests**. Most importantly, `firestore.rules:512` currently says `allow update: if true` for wallets, so any client, including a child and potentially an unauthenticated caller, can arbitrarily change any existing wallet it can address. The focused tests reproduced four such unauthorized writes succeeding.

The current Approval Center and its focused tests are untracked, while `firestore.rules` and `src/lib/api.ts` contain large uncommitted changes. Historical commit `501b74f` introduced task-only approval/rejection inside `ParentDashboard`; the current multi-type center is not present in git history and therefore has no committed provenance.

## Focused reproduction

Command:

```sh
firebase emulators:exec --only firestore 'npx vitest run tests/firestore/approvalCenter.rules.test.ts tests/firestore/transfers.rules.test.ts'
```

Result: exit 1; 2 test files failed; **10 failed, 23 passed, 33 total**.

- `approvalCenter.rules.test.ts`: transfer approval and money-request approval expected-success cases were denied.
- `transfers.rules.test.ts`: four direct-wallet denial tests failed because the writes succeeded; four transfer approval/linkage success cases were denied.
- Emulator errors point to the wallet update branch at rule line 512, wallet-ledger creates at 517, transfer update at 580, money-request update at 601, and feed create at 540.

## Required action matrix

| Required action | UI/API status | Rule/test status | Audit conclusion |
|---|---|---|---|
| Task approve | Present: `ApprovalCenter.tsx:72-77`; `api.ts:393-434` | Happy-path test passes only because task completion and child-user updates are broadly allowed (`rules:442-450,478-482`) | **Unsafe/replayable.** API never reads the completion or checks pending status, taskId, assigneeId, or family linkage. A repeated/concurrent approval can award points/XP again; a caller can pair a completion with an arbitrary task and child. No strict fields/timestamp/atomic rule. |
| Task reject | Present: UI `100-104`; API `436-461` | Happy-path test passes under unrestricted parent update | **Unsafe transition.** No pending-status check or completion/task linkage. An approved completion can be rewritten rejected. Rejection itself does not alter balances/points, but rules do not enforce that invariant. |
| Transfer approve | Present: UI `78-80`; API `1124-1237` | Focused success test fails. Rule update allows `paymentTransferId`, but API writes `approvalTxId` (`api.ts:1193-1199` vs `rules:588-591`). Strict helper `isValidTransferApproval` exists at `rules:329-360` but is never called. | **Broken in production.** Even after renaming the field, wallet updates are open and request-to-ledger atomic linkage is not enforced by the active update rule. |
| Transfer reject | Present: UI `104-106`; API `1239-1273` | Focused happy path passes; rule checks parent/owner, pending transition, reviewer UID/time, and exact changed request fields (`rules:580-592`) | **Closest to correct**, but no UI/API regression test, no owner/child/wrong-family matrix in the Approval Center suite, and feed creation is not required by the request rule. |
| Money request approve | Present: UI `80-83`; API `1374-1485` | Focused expected-success payload fails; test is not production-shaped. `money_requests` permits any family member to update any fields (`rules:596-602`). | **Broken/insecure.** Parent-funded branch writes ledger type `request_payment` (`api.ts:1414-1423`), which is not allowed by `wallet_transactions` (`rules:517-525`), so it is denied. Sibling branch is only able to mutate wallets because wallet updates are open; it omits `lastTransferReqId`, so the intended `isValidLedgerSync` would reject it. Reviewer family is not checked in API (rules currently supply only broad family membership). |
| Money request reject | Present: UI `105-108`; API `1487-1519` | Happy path passes under `allow update: if isFamilyMember` | **Insecure/replayable.** Any child in the family can directly forge rejection/reviewer fields. API does not require current status `pending`, so approved requests can be rewritten rejected. No exact field/timestamp/status rule. |
| Pet Box approve | Present: UI `83-85`; API `940-1044` | Happy path passes with an existing wallet. Rules allow parent request/fund changes broadly and any family member can create arbitrary fund transactions (`rules:555-563,605-612`) | **Not rule-atomic.** API status and balance checks are useful, and reviewer UID derives from auth, but rules do not tie request, wallet, fund, ledgers, and feed. Missing wallet works only when legacy `users.walletBalance` is an integer; a new child with neither wallet nor legacy field throws (`api.ts:733-759`). |
| Pet Box reject | Present: UI `108-110`; API `1046-1070` | Happy path passes under unrestricted parent update | **Unsafe transition.** API does not require pending status; rules accept arbitrary parent field/status/timestamp changes. Rejection API does not touch balances, but rules do not enforce that. |
| Reward redemption approve | Absent | `redeemReward` is immediate (`api.ts:636-670`); no pending/redemption approval API or UI | **N/A in current product model, incomplete if approval is required.** Separate bug: redemption API writes `redeemedAt`, while `isValidRedemptionDeduction` requires linked redemption `createdAt == request.time` (`rules:259-275`), so direct redemption is likely denied. |
| Reward redemption reject | Absent | No pending redemption workflow | **N/A/incomplete** as above. |
| Join approve | Displayed outside Approval Center for owner only (`ParentDashboard.tsx:113-148`); API `119-146` | No permanent focused rule test | **Broken and non-atomic.** New wallet create writes only `{balance: 0}`, but rules require `balance`, `createdAt`, and `migratedFromLegacy` and require the pre-write user already be a child (`rules:503-511`). The post-transaction feed uses `actorId: 'system'`, while feed rules require auth UID (`api.ts:139-145`; `rules:540-546`); if the core transaction succeeds, feed failure makes the promise reject after partial success. Request is deleted, so there is no approval history. |
| Join reject | Displayed outside Approval Center; API `148-150` | Owner delete is permitted (`rules:466-470`); no focused test | **Functionally minimal but UX/audit-incomplete.** No loading, double-submit guard, error display, reason, feed, or retained status/history; it deletes the request. |

## Cross-cutting UI findings

`src/components/parent/ApprovalCenter.tsx`:

- Uses raw `item.id` for `processingItemId` and `optimisticallyRemovedIds` (`24-25,67,72,93,99,118`). IDs from different collections collide, despite the render key being composite. One success can hide another type's card; one in-flight item disables same-ID cards.
- State is not a synchronous double-submit lock. Two clicks before React commits `processingItemId` can launch duplicate transactions. This is especially severe for replayable task approvals.
- Reject has no rejecting label. During rejection, the approve button says `Approving...` and reject is merely disabled (`186-189`).
- Approve success always alerts “Transfer approved successfully” even for task, money, and Pet Box (`94`).
- Approve errors show Firebase code and message; reject errors show message only (`95-116`).
- Cards are removed only after a resolved promise and failures keep them visible, which is correct. Pending count updates with the optimistic set. However, optimistic keys are never reconciled/cleared after snapshots, and there are no tests for history appearing exactly once.
- Reject comments are hard-coded only for tasks (`'Rejected by parent'`); other types have no reason/comment. This is inconsistent with the historical task review modal added in commit `501b74f`.
- No component tests reference Approval Center. Listener readiness also does not wait for `task_completions`, `transfer_requests`, `money_requests`, or `petbox_requests` (`useStore.ts:240-253`), so the center can briefly show “all caught up” before approval snapshots resolve.

Join controls in `ParentDashboard.tsx:113-148` have no loading/error handling or duplicate-submit protection, and all join requests are rendered without filtering `status == pending`.

## Security and payload root causes

1. **Critical wallet authorization bypass:** `firestore.rules:512` is literal `allow update: if true`. The emulator proved parent direct mutation, child self mutation, child recipient mutation, and unrelated-field mutation all succeed. This bypasses every intended ledger-sync helper (`isValidDepositCredit`, `isValidWithdrawalDeduction`, `isValidLedgerSync`, `isValidPetBoxDonationDeduction`, etc.).
2. **Dead validation code:** `isValidTransferApproval` is defined but never referenced. The active transfer update branch uses a different identifier field (`paymentTransferId`) from both the helper and production API (`approvalTxId`).
3. **Money/Pet Box/task rules are authorization-only or broader, not invariant rules:** money requests are writable by any family member; Pet Box requests by any parent; task completions by any parent. None enforce exact allowed fields, pending-only transitions, timestamps, linked ledgers/feed, or no balance/points mutation on rejection.
4. **Client checks are mistaken for security:** API role/status checks help UI behavior but are bypassable by direct SDK calls. The rules permit forged money request reviewers and direct wallet values.
5. **Task identity is client-selected:** `approveTaskCompletion` trusts `taskId` and `userId` parameters rather than deriving them from the completion document. `reviewedBy` is not written at all for task approvals/rejections.
6. **Join is split across two commits:** core transaction and feed are separate; a feed denial can report failure after membership mutation. Wallet create payload/rule requirements also disagree.
7. **Legacy/new wallet behavior is asymmetric:** `ensureWalletDocument` refuses a missing wallet unless `walletBalance` exists and is an integer. New-account missing-wallet coverage is absent.

## Test audit

`tests/firestore/approvalCenter.rules.test.ts` is a useful smoke test but does not meet the spec:

- It calls hand-written `writeBatch` payloads, not production APIs or shared builders.
- It contains only eight parent happy-path `assertSucceeds` cases. There are no owner successes, child/wrong-family/forged reviewer denials, exact field/timestamp failures, post-state assertions, missing data/wallet variants, legacy/new account matrix, double-submit/replay tests, or UI behavior tests.
- Transfer expected-success fixture writes `lastTransferReqId: 'money1'` while approving `trans1` (`lines 166-174`), and request payload uses `approvalTxId` while rules require `paymentTransferId` (`200-206`).
- Money request fixture includes extra `amount` fields on transfer ledgers (`250-275`) that production API does not send and strict rules reject.
- Task fixture uses `childId`, while production completion shape uses `assigneeId`; feed fixtures include `actorName` though task/Pet Box production APIs do not. Passing therefore does not establish production payload compatibility.
- It imports `assertFails` but never uses it.

`tests/firestore/transfers.rules.test.ts` has more negative coverage but also contains incorrect expectations/fixtures:

- Test named “mismatched approvalTxId: denied” calls `assertSucceeds` (`217-227`).
- Several object literals repeat `lastTransferReqId`, obscuring intended payloads.
- It never invokes `approveTransferRequest`, so drift between API and rules was not prevented.

There are no Approval Center component tests. The untracked `scripts/test_live_transfer.ts` and `scripts/test_live_petbox_approval.ts` are diagnostics, not automated production-shape regression tests, and should not be treated as evidence of live verification.

## Git/history evidence

- Worktree is heavily dirty. Relevant untracked files: `src/components/parent/ApprovalCenter.tsx`, `tests/firestore/approvalCenter.rules.test.ts`, `tests/firestore/transfers.rules.test.ts`, `scripts/test_live_transfer.ts`, and `scripts/test_live_petbox_approval.ts`.
- Relevant tracked files with uncommitted changes: `firestore.rules`, `src/lib/api.ts`, `src/components/parent/ParentDashboard.tsx`, and `src/store/useStore.ts`.
- Commit `501b74f` (“implement Approval Center with rejection and commenting”) added task-only approval UI and task rejection. It used the assignee as feed `actorId`; current uncommitted API changed feed actor to `auth.currentUser.uid`, which is the correct identity direction.
- Current `HEAD` rules did not include the new transfer/money/Pet Box rule system. The failing and insecure state is in the uncommitted rules rewrite, so prior commit/deploy claims do not establish the state audited here.

## Proposed implementation and test scope

Product files:

1. `firestore.rules`: replace open wallet update; activate one coherent typed validator per approval; enforce parent/owner, auth-derived reviewer, pending-only transition, exact diff, request/participant/family validation, timestamp equality, ledger/wallet/fund linkage, and immutable history. Remove dead/duplicate rule paths only after focused tests prove equivalence.
2. `src/lib/api.ts`: derive task identity from the completion document; add idempotency/status guards to every action; align transfer identifier naming; implement allowed parent-funded money ledger; add `lastTransferReqId` linkage; make join transaction/feed atomic with a valid wallet payload; define missing-wallet behavior for new accounts; add reward approval only if product policy requires it.
3. `src/components/parent/ApprovalCenter.tsx`: use `${type}:${id}` for both processing and optimistic state, enforce a synchronous in-flight lock, show action-specific loading/error text, collect consistent rejection reasons, and clear optimistic state on snapshot reconciliation.
4. `src/components/parent/ParentDashboard.tsx`: either move join actions into the same typed center or give them equivalent loading/error/history semantics.
5. `src/store/useStore.ts`: expose per-approval-resource readiness so “all caught up” is not rendered until all four approval listeners have resolved.

Tests:

1. Rebuild `tests/firestore/approvalCenter.rules.test.ts` around exported/shared production payload builders (or invoke API against emulator with auth injection). For each action: parent and owner success; child/wrong-family/forged reviewer denial; pending-only transition; exact fields/time; feed; atomic failure; missing data; existing/missing/legacy/new wallets; no cyclic/expression-limit errors.
2. Correct `tests/firestore/transfers.rules.test.ts` fixture IDs and the inverted `assertSucceeds`; add explicit unauthenticated wallet mutation denial and mismatched approval/ledger ID denials.
3. Add `tests/components/ApprovalCenter.test.tsx`: cross-type ID collision, double click, approve/reject loading labels, exact error retention, success-only removal, immediate pending count, snapshot history reconciliation, and optimistic-key cleanup.
4. Add join and reward/redemption focused rule/API tests. Reward tests should first document whether redemption is immediate or approval-backed.

Do not deploy until the critical wallet rule is closed and the focused emulator command exits zero using production-shaped payloads.
