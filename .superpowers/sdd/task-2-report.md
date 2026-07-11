# Task 2 Report — Atomic Behaviour Transaction Service and Settings Audit

## Status

Complete. Phase 2 is implemented and committed without staging unrelated dirty-worktree changes.

## Transaction flow

1. Normalize the canonical V2 input (or the temporary legacy dashboard overload).
2. Preallocate the behaviour-event ref, the financial-only wallet-ledger ref, and the feed ref.
3. Invoke exactly one Firestore `runTransaction` for the behaviour event.
4. Inside its callback, read the family, target child, and creator documents before writes.
5. Validate document existence, child/creator family membership, child target role, parent/owner creator role, domain input, and the family debt limit (with the `-5000` compatibility default).
6. Update only the affected child fields: points and XP for positive, points only for negative, or wallet only for financial.
7. Inside the same callback, write the V2 behaviour event, optional immutable financial ledger entry, and compatibility feed entry (`createdAt` and `timestamp`).
8. Return the preallocated `eventRef.id` after the transaction succeeds.

`updateDebtLimit` validates negative integer pence and writes `debtLimitPence`, `updatedBy`, and server-timestamp `updatedAt` to the family document.

## Files changed

- `src/lib/api.ts` — V2 behaviour transaction service, debt-limit audit update, and temporary typed compatibility overload for the existing dashboard caller.
- `src/lib/api.behaviour.test.ts` — Firestore-boundary transaction contract tests.

## Tests added

- Financial penalty child update, V2 event shape, ledger shape, and event/ledger ID linkage.
- Exactly one `runTransaction` call for a financial event.
- Negative point clamping and storage of only the applied delta.
- No ledger creation for point events.
- Rejection before writes for a cross-family child, non-child target, cross-family creator, and child creator.
- Debt-limit audit write shape.
- Migration compatibility from the existing five-argument dashboard call to a V2 event.

## RED evidence

Initial command:

`npm test -- src/lib/api.behaviour.test.ts`

Result: exit 1; 1 file failed, 7 tests failed. Failures showed the legacy service updating old point fields for financial/negative inputs, no membership or role rejection, and `updateDebtLimit is not a function`.

Compatibility RED command after the initial GREEN exposed the current dashboard build mismatch:

`npm test -- src/lib/api.behaviour.test.ts`

Result: exit 1; 1 test failed and 7 passed. The new legacy-call test failed with `Invalid behaviour event type.` before the compatibility overload was added.

## GREEN evidence

Focused post-implementation command:

`npm test -- src/lib/api.behaviour.test.ts`

Result: exit 0; 1 file passed, 7 tests passed.

Required combined verification:

`npm test -- src/lib/behaviour.test.ts src/lib/api.behaviour.test.ts && npm run build`

Result: exit 0; 2 files passed, 34 tests passed; TypeScript and Vite production build succeeded.

## Build result

PASS. Vite transformed 1,835 modules and completed the production build. Existing informational warnings remain for mixed static/dynamic imports of `src/lib/api.ts` and a JavaScript chunk larger than 500 kB.

## Atomicity analysis

Each call to `addBehaviourEvent` makes exactly one `runTransaction` call. No child update, event creation, ledger creation, or feed creation occurs outside its callback. Validation precedes all writes. Firestore therefore commits the child update, behaviour event, optional ledger entry, and feed entry together or commits none of them. Document references are allocated before `runTransaction`, which is safe because allocation is local and does not write a document.

## `behaviourEventId` evidence

The financial ledger write uses `behaviourEventId: eventRef.id`, where `eventRef` is allocated before the transaction. The contract test captures the returned event ID (`generated-1`) and asserts the ledger entry contains the identical ID. This provides the required stable audit link.

## Commits

- `6cdcd13` — `feat: add atomic behaviour v2 transactions`
- Evidence report commit: the commit containing this report.

## Self-review

- Confirmed the canonical exported overload is `addBehaviourEvent(familyId, childId, createdBy, input): Promise<string>`.
- Confirmed family, child, and creator reads all occur inside the transaction and before writes.
- Confirmed only financial events allocate/write a ledger document.
- Confirmed negative events preserve lifetime XP and persist the applied rather than requested delta.
- Confirmed financial events use positive ledger `amount` and signed negative event `walletDelta`.
- Confirmed feed compatibility writes both date fields.
- Confirmed only Phase 2 hunks in `src/lib/api.ts` were staged; unrelated working-tree edits remain unstaged.

## Concerns

- A deprecated overload remains temporarily because the current dashboard still uses the V1 five-argument call; it converts that call to the same V2 transaction. A later UI phase should migrate the caller and remove the overload.
- Owner authorization for `updateDebtLimit` is ultimately enforced by Firestore rules; this client helper records the supplied owner ID and validates the numeric debt-limit shape but cannot independently prove identity.
- The build warnings noted above predate and are unrelated to Phase 2 correctness.
