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

The implementation and this report were committed as `0e326bf` (`docs: record family data tool evidence`) because a concurrent worker committed the shared staged index after bootstrap verification and before the bootstrap-specific commit command ran. The commit contains the intended bootstrap files unchanged; the commit subject is not bootstrap-specific.

## Concerns

- Bootstrap deliberately waits for server-authoritative snapshots. Offline cache-only startup remains loading rather than showing potentially false zeros; terminal listener failures expose retry. A separate product decision would be needed for a trusted offline mode.
- Readiness currently gates on all resources already subscribed by the application. This is conservative and prevents partial sections; future route-level performance work can derive section selectors from the same status map without weakening correctness.
- The existing production bundle remains above Vite's 500 kB advisory threshold; that warning predates and is unrelated to bootstrap correctness.
