# Bootstrap/auth/listener stabilization implementation

## Root cause

The attempted bootstrap declared readiness after only four listeners while the dashboard and Approval Center rendered data from additional unresolved listeners. `appReady` was not consumed by the layout, cached empty snapshots were treated as authoritative, missing family documents counted as ready, auth/profile errors were masked by route-guard order, and asynchronous auth/listener callbacks had no generation identity after logout, retry, or family change.

## Implementation

- `src/store/useStore.ts`
  - Replaced the numeric counter with explicit `idle | loading | ready | error` status for all 18 family resources.
  - Added auth and family generations so obsolete token continuations and queued listener callbacks cannot mutate current state.
  - Made auth, profile, family change, logout, retry, and cleanup tear down the correct subscriptions and reset family-scoped data.
  - Waits for token, authoritative profile, validated non-empty `familyId`, and authoritative resource snapshots in order.
  - Ignores cache-only snapshots for bootstrap readiness, while authoritative empty collections resolve normally.
  - Treats a missing family document and any listener failure as recoverable errors; retry starts a fresh family or auth/profile generation.
- `src/components/layout/AppLayout.tsx`
  - Reads all store selectors before conditional returns, shows errors before the missing-profile placeholder, gates family routes on `appReady`, and uses the store retry action.
- `tests/store/useStore.test.ts`
  - Added permanent state-machine coverage; no tracked historical copy existed to restore.
- `tests/components/bootstrap.test.tsx`
  - Added rendered loading-to-real-data, no-zero-flash, error precedence, and onboarding routing coverage.

## TDD evidence

Initial focused RED:

```text
npx vitest run tests/store/useStore.test.ts tests/components/bootstrap.test.tsx --reporter=verbose
Test Files: 2 failed
Tests: 12 failed, 7 passed
```

Failures were specifically caused by absent resource status/retry, stale callbacks surviving family/auth changes, missing-family success behavior, stale family data on onboarding, layout zero rendering, and masked bootstrap errors.

An additional cache-authority regression was captured RED before correction:

```text
npx vitest run tests/store/useStore.test.ts -t 'missing family in cache' --reporter=verbose
Tests: 1 failed
```

Focused GREEN after implementation:

```text
npx vitest run tests/store/useStore.test.ts tests/components/bootstrap.test.tsx --reporter=verbose
Test Files: 2 passed
Tests: 21 passed
```

Production build:

```text
npm run build
Exit: 0
Vite: 1843 modules transformed; PWA service worker generated
```

The unfiltered `npm test` command is not the repository's valid rules-test entry point: it ran 74 unit tests successfully but also collected Firestore rules suites without an emulator, producing emulator connection failures plus the pre-existing missing `tests/firestore/setup` import in `isolate.rules.test.ts`. Rules are intentionally outside this implementation scope and use `npm run test:rules`.

## Commit

The implementation and permanent tests were committed as `b224c48` (`docs: record bootstrap stabilization evidence`).

## Concerns

- Bootstrap deliberately waits for server-authoritative snapshots. Offline cache-only startup remains loading rather than showing potentially false zeros; terminal listener failures expose retry. A separate product decision would be needed for a trusted offline mode.
- Readiness currently gates on all resources already subscribed by the application. This is conservative and prevents partial sections; future route-level performance work can derive section selectors from the same status map without weakening correctness.
- The existing production bundle remains above Vite's 500 kB advisory threshold; that warning predates and is unrelated to bootstrap correctness.

## Independent-review corrections

The Critical and Important client findings in `stabilization-bootstrap-review.md` were addressed without modifying `firestore.rules`:

- Readiness is role-aware. Parent and owner sessions retain collection-wide Approval Center/history listeners; child sessions do not subscribe to parent-only join requests and are not gated on them.
- Child history listeners now use least-privilege production query shapes: task completions by `assigneeId`, redemptions and savings goals by `userId`, wallet transactions and Pet Box requests by `childId`, and transfer requests by `fromChildId`.
- Child money requests use two constrained queries (`requesterId` and `requestedFromId`), merge by document ID, and become ready only after both branches resolve.
- Every listener has a deterministic server-source initial read. Cache-only snapshots cannot falsely resolve readiness, and a rejected server read reaches the recoverable error/retry state without a timer.
- The profile listener survives a transient authoritative missing profile and automatically recovers when signup provisioning produces the document. Server-read/listener races cannot overwrite newer resolved data.
- `familyId` must be a non-empty, already-trimmed string before any family listener attaches.
- Auth observer failures reach the same recoverable error UI, and retry reattaches the auth observer.
- The rendered integration test now drives persisted auth, token acquisition, profile resolution, every parent resource listener, and the final real dashboard values. It proves no temporary zero summaries appear before readiness.

The matching rules/read coverage from Critical finding C1 was coordinated with the Approval Center stabilization work and is intentionally not duplicated in this scoped client commit. `firestore.rules` was not edited here.

### Review-fix TDD evidence

The new regressions were observed failing before implementation:

```text
Initial expanded store RED: 6 failed
Server/listener race RED: 2 failed
Rendered auth-error precedence RED: 1 failed
Auth-observer retry RED: 1 failed
```

Focused bootstrap verification after the fixes:

```text
npx vitest run tests/store/useStore.test.ts tests/components/bootstrap.test.tsx --reporter=verbose
Test Files: 2 passed
Tests: 34 passed
```

Tracked non-rules verification:

```text
tracked_tests=(${(f)"$(git ls-files '*test.ts' '*test.tsx' | rg -v '^tests/firestore/')"}); npx vitest run ${tracked_tests[@]} --reporter=dot
Test Files: 9 passed
Tests: 102 passed
```

The unfiltered non-rules run also collected a concurrent untracked `src/lib/api.traceability.test.ts`: 104 tests passed and 3 unrelated transaction/reversal tests failed. On the final requested `npm run build`, TypeScript was blocked by the concurrent untracked `src/lib/reversalContracts.test.ts` (`type` is not accepted by its in-progress contract), not by a bootstrap file. These shared-worktree files were left untouched.

## Production query-plan closure

The final bootstrap review identified two production query mismatches that snapshot mocks could not detect. They are now fixed through a single query-plan factory consumed by both `useStore` and the Firestore emulator tests:

- Child savings goals query `childId == uid`, matching the production savings-goal schema.
- Child feed query `visibleTo array-contains uid`, which is provably compatible with the existing per-document visibility rule. Parent and owner feeds remain collection-wide. The child feed contract is deliberately explicit: family-wide feed items must list the child in `visibleTo`; legacy/unscoped records remain visible to parent/owner bootstrap but are not leaked through a child collection query.
- Parent, owner, and child readiness resource sets and all query targets are constructed by `src/lib/bootstrapQueries.ts`. The store no longer maintains an independent query shape that can drift from the rules test.
- The child money-request plan retains both constrained branches and the store retains its deterministic merge/readiness barrier.

TDD RED for the two incorrect child query shapes:

```text
npx vitest run tests/store/useStore.test.ts -t 'least-privilege child queries' --reporter=verbose
Test Files: 1 failed
Tests: 1 failed (savings_goals used userId; feed lacked visibleTo array-contains)
```

TDD RED for production-plan rules coverage:

```text
npx firebase emulators:exec --only firestore "npx vitest run tests/firestore/bootstrapQueries.rules.test.ts --reporter=verbose"
Test Files: 1 failed (shared production query-plan module did not yet exist)
```

Focused unit GREEN after production adopted the shared plan:

```text
npx vitest run tests/store/useStore.test.ts tests/components/bootstrap.test.tsx --reporter=verbose
Test Files: 2 passed
Tests: 34 passed
```

Rules-backed query-plan GREEN:

```text
npx firebase emulators:exec --only firestore "npx vitest run tests/firestore/bootstrapQueries.rules.test.ts --reporter=verbose"
Test Files: 1 passed
Tests: 3 passed
```

The emulator fixtures execute every required initial parent, owner, and child document/query read through production `firestore.rules`. They include family-wide, child-visible, sibling-only, and parent-only feed records, assert child sibling privacy, verify the `childId` savings result, and execute both child money-request branches. No rule was broadened for this fix.

The requested build was attempted after focused verification but is temporarily blocked by concurrent reversal TDD work:

```text
npm run build
src/lib/reversalApi.test.ts(13,57): error TS2307: Cannot find module './reversalApi'
```

The missing reversal module is outside this bootstrap change. Build verification will be rerun once that concurrent RED cycle turns green.
