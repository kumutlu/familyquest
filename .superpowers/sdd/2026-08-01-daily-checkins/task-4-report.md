# Task 4 report: Role-aware store subscriptions and rollover

## Outcome

Implemented the daily check-in Zustand slice in `src/store/useStore.ts`:

- deterministic current-day check-in and skip listeners start only after the active profile and authoritative family document are available;
- `dailyCheckinStateResolved` remains false until both active-day document listeners emit;
- `refreshDailyCheckinDay(now?)` recomputes the family-local day and replaces both listeners only when the day changes;
- parent and owner history subscribes only while `historyVisibleToParents` resolves true, using `createdAt desc` and `limit(100)`;
- child/disabled history never queries, resolves immediately to an empty list, and visibility-off clears loaded rows before stale callbacks can land;
- auth/family teardown resets all six fields, unsubscribes all three named optional listeners, clears the rollover callback, and generation/day/profile guards reject stale callbacks.

No UI, API, rules, index, or later-task code was changed.

## TDD evidence

### Current-day RED

Command:

```text
npx vitest run src/store/useStore.dailyCheckins.test.tsx src/store/authBootstrap.test.tsx
```

Observed before production changes:

```text
Test Files  1 failed | 1 passed (2)
Tests       2 failed | 10 passed (12)
```

The failures were the intended missing behavior: the deterministic check-in path had zero listeners, and `refreshDailyCheckinDay` was not a function.

### Current-day GREEN

The same command after the minimal current-day implementation produced:

```text
Test Files  2 passed (2)
Tests       12 passed (12)
```

### Conditional-history RED

After adding the parent/owner, child/disabled, and visibility-off tests, before history production code:

```text
Test Files  1 failed | 1 passed (2)
Tests       4 failed | 12 passed (16)
```

The failures showed no parent/owner query, unresolved child/disabled state, and no history listener from which to test clearing.

### Conditional-history GREEN

Command:

```text
npx vitest run src/store/useStore.dailyCheckins.test.tsx src/store/authBootstrap.test.tsx src/store/retryBootstrap.test.ts
```

Observed after implementation:

```text
Test Files  3 passed (3)
Tests       19 passed (19)
```

### Race mutation check

I temporarily removed the active listener-generation/day checks and ran:

```text
npx vitest run src/store/useStore.dailyCheckins.test.tsx -t "switches both deterministic listeners"
```

It failed as intended because an unsubscribed August 1 callback populated August 2 state:

```text
Test Files  1 failed (1)
Tests       1 failed | 5 skipped (6)
AssertionError: expected { id: 'child-1_2026-08-01', ... } to be null
```

Restoring the guard returned the suite to GREEN.

## Final verification

```text
npx vitest run src/store/useStore.dailyCheckins.test.tsx src/store/authBootstrap.test.tsx src/store/retryBootstrap.test.ts && npm run typecheck

Test Files  3 passed (3)
Tests       19 passed (19)
tsc --noEmit: exit 0
```

`git diff --check` also completed with no output.

## Self-review

- Current-day document IDs come from `dailyCheckinDocumentId`, and days come from the family-aware `familyDayKey` helper.
- Both current listeners are optional/non-critical entries in the existing family listener registry; neither affects bootstrap readiness.
- Current-day resolution has a two-callback barrier and resets to unresolved/null before rollover subscriptions are created.
- Listener callbacks require the active auth/family generation, profile ID, local day, and per-listener generation.
- Parent/owner history is bounded and ordered at the Firestore query boundary; children and disabled families do not create the collection query.
- Turning history visibility off increments its listener generation before clearing state, so queued callbacks cannot restore stale rows.
- `emptyFamilyState()` owns all new defaults, covering sign-out, family replacement, no-family profiles, password-change gating, and explicit cleanup.
- Focused store tests cover deterministic paths, the two-listener barrier, rollover replacement, stale rollover callbacks, both adult roles, child/disabled gates, query shape, history resolution, visibility-off clearing, and stale history callbacks.

## Concerns

None within Task 4 scope.
