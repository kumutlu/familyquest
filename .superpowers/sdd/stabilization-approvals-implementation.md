# Approval Center stabilization implementation

Date: 2026-07-13

## Status

Implemented the displayed Approval Center actions and equivalent join safeguards. Reward redemption remains immediate (there is no reward approval UI), but its direct transaction/rule timestamp contract is stabilized. Approval-focused unit/component tests, all Firestore rule tests, scoped lint, and production build pass.

## Action matrix

| Action | Implementation status |
|---|---|
| Task approve | Transaction now reads the completion first, requires `pending_approval`, derives task and assignee from stored data, derives reviewer from `auth.currentUser`, validates reviewer/assignee family roles, writes reviewer/time/awarded points, and updates points/XP atomically. |
| Task reject | Same stored-identity and reviewer checks; pending-only; exact rule diff; no points/wallet mutation. |
| Transfer approve | Canonical `approvalTxId` shared builder; pending-only API; strict request-to-wallet-to-ledger linkage; sender/recipient family/role and balance checks; legacy and missing wallet paths retained; no wallet open-write bypass. |
| Transfer reject | Pending-only; parent/owner and family validated; auth-derived reviewer; exact request diff/time. |
| Money approve | Reviewer family/role check; parent-funded `request_payment` ledger is now explicitly validated; both parent and sibling branches write `lastTransferReqId`; sibling branch remains balanced and atomic. |
| Money reject | Pending-only API and rule; parent/owner only; exact diff/time and auth reviewer. |
| Pet Box approve | Pending-only; auth reviewer; request links wallet/fund transaction IDs; rule verifies request, wallet ledger, fund ledger, participant, amount, and timestamps. Missing new-account wallets initialize from zero; legacy balances remain supported. |
| Pet Box reject | Pending-only API/rule; exact rejection diff; no balance mutation. |
| Reward approve/reject | N/A: no approval-backed reward flow exists. Direct redemption now writes both `createdAt` and `redeemedAt`, `status: completed`, and strict create rules bind the redemption to the authenticated user and request time. |
| Join approve | Owner-only pending transition; profile, child wallet, retained request history, and feed are in one transaction; feed actor is auth UID rather than `system`. |
| Join reject | Owner-only pending transition retained as history instead of deletion; auth reviewer; guarded UI with loading, exact error, and duplicate prevention. |

## Root causes corrected

- Removed critical `allow update: if true` from wallets. Wallet updates now require a typed ledger validator.
- Activated transfer atomic validation and aligned `approvalTxId`; the former validator was dead while the active rule expected `paymentTransferId`.
- Replaced broad money/Pet Box/task terminal updates with pending-only, exact-field, request-time, auth-reviewer transitions.
- Changed task APIs from UI-supplied task/child identity to completion-derived identity and added replay prevention.
- Added `request_payment` and money request linkage contracts for parent-funded approvals.
- Added Pet Box request-to-wallet/fund ledger linkage fields and validation.
- Made missing wallet initialization compatible with new accounts (zero) and legacy integer `walletBalance`.
- Made join core writes and feed atomic, preserved terminal request history, and fixed wallet create validation to use the post-transaction child profile.
- Replaced the broken `tests/firestore/isolate.rules.test.ts` dependency on a missing `./setup` with a permanent unauthenticated wallet-bypass regression test.

## UI behavior

- Approval IDs use `${type}:${id}` via `approvalKey`.
- A synchronous ref-backed in-flight set prevents double submits before React rerenders.
- Only the selected type-qualified card is disabled.
- Approve and reject have action-specific loading labels.
- Cards are optimistically removed only after the promise resolves; failures retain cards and display exact Firebase `code: message`.
- Optimistic keys reconcile/clear after pending snapshots change.
- Join controls have the same duplicate, loading, and exact-error safeguards and render only pending requests.

## TDD evidence

RED:

- Initial `approvalContracts`/Approval Center run: missing contract module plus two UI failures (raw-ID collision/loading and missing Firebase code).
- Initial approval API run: 3/3 task transaction tests failed because APIs trusted supplied task/user IDs and did not read completion status.
- Initial focused emulator baseline: 10/33 failed, including four unauthorized direct wallet writes succeeding.

GREEN:

```text
npx vitest run src tests/components
Test Files  6 passed (6)
Tests       46 passed (46)
```

```text
JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:rules
Test Files  4 passed (4)
Tests       90 passed (90)
```

```text
npx oxlint [scoped approval implementation/test files]
exit 0, no output
```

```text
npm run build
exit 0; TypeScript and Vite production build succeeded
```

The build retains pre-existing advisory warnings about ineffective dynamic imports and a >500 kB chunk.

`npm test` without an emulator is not a valid aggregate command in this repository because it includes Firestore suites that require emulator discovery/port 8080. It produced 77 passing unit tests before failing on missing emulator connectivity. The correct split commands above both pass.

## Files

- `src/lib/approvalContracts.ts` (new shared keys/payload contract)
- `src/lib/approvalContracts.test.ts`
- `src/lib/api.approvals.test.ts`
- `src/lib/api.ts`
- `src/components/parent/ApprovalCenter.tsx`
- `src/components/parent/ApprovalCenter.test.tsx`
- `src/components/parent/ParentDashboard.tsx`
- `firestore.rules`
- `tests/firestore/approvalCenter.rules.test.ts`
- `tests/firestore/transfers.rules.test.ts`
- `tests/firestore/isolate.rules.test.ts`

## Commit and concerns

Commit: coordinated aggregate commit approved by the root stabilization task. Because `firestore.rules`, `src/lib/api.ts`, and `ParentDashboard.tsx` already contained prerequisite uncommitted behaviour/onboarding work, the aggregate includes their matching behaviour tests plus the directly imported form, currency/stat, template, and onboarding dependencies. It excludes `.env`, Firebase caches, generated output, repair scripts, backups, unrelated pages/assets, and other audit streams. Verification ran from a detached temporary worktree created from the exact staged tree (`0ea2be85360ab9d3c4f9bf2cf120b4ad32c9000b`), not from the broader dirty working directory.

Remaining architectural concern: parent updates to child user point fields are still broadly allowed by the pre-existing user rule because behaviour/task/reward features share that write path. Task approval itself is now replay-safe and rule-transition-safe, but fully proving point-ledger atomicity against a malicious parent client requires a typed user-point mutation ledger across all point-producing features, which is broader than Approval Center scope.
