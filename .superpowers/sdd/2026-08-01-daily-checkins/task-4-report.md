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

---

## Fix round 1

### Findings verified

- The family bootstrap short-circuit compared only `activeFamilyId` and listener count. Its closures retained the prior role, so a same-family parent-to-child change kept parent history alive, while child-to-parent never created history.
- Current-document and history error handlers unsubscribed without changing their callback generation. A callback already queued by Firestore therefore remained eligible to write state after the error.
- Replacement listeners reset data/resolution fields but preserved their prior `featureErrors` entries indefinitely.

### Role-identity RED/GREEN

Added same-family parent-to-child and child-to-parent transition tests, then ran:

```text
npx vitest run src/store/useStore.dailyCheckins.test.tsx -t "same-family"
```

RED before production changes:

```text
Test Files  1 failed (1)
Tests       2 failed | 6 skipped (8)
```

The parent history unsubscribe had zero calls, and the promoted child had zero active history queries. After keying the active subscription by family ID, profile ID, and role, and adding the identity to live callback guards:

```text
Test Files  1 passed (1)
Tests       2 passed | 6 skipped (8)
```

### Post-error callback RED/GREEN

Added tests that manually deliver queued current-document and history callbacks after their listener error:

```text
npx vitest run src/store/useStore.dailyCheckins.test.tsx -t "queued"
```

RED before generation invalidation:

```text
Test Files  1 failed (1)
Tests       2 failed | 8 skipped (10)
```

The late check-in populated `todayDailyCheckin`, and the late history row repopulated `dailyCheckinHistory`. Incrementing the corresponding generation before unsubscribe produced:

```text
Test Files  1 passed (1)
Tests       2 passed | 8 skipped (10)
```

### Recovery-error RED/GREEN

Added recovery tests for both deterministic listener names and history:

```text
npx vitest run src/store/useStore.dailyCheckins.test.tsx -t "feature error"
```

RED before replacement-error clearing:

```text
Test Files  1 failed (1)
Tests       3 failed | 10 skipped (13)
```

All three prior error strings remained after replacement. Clearing the relevant feature-error keys atomically when replacement starts produced:

```text
Test Files  1 passed (1)
Tests       3 passed | 10 skipped (13)
```

### Fix-round final verification

```text
npx vitest run src/store/useStore.dailyCheckins.test.tsx src/store/authBootstrap.test.tsx src/store/retryBootstrap.test.ts && npm run typecheck

Test Files  3 passed (3)
Tests       26 passed (26)
tsc --noEmit: exit 0
```

### Fix-round self-review

- Same-family bootstrap reuse now requires exact `{ familyId, profileId, role }` identity; any identity change tears down listeners and resets family-scoped state before rebuilding the role-specific query plan.
- Every family callback also verifies the live profile ID and role. History adds an explicit live parent/owner check, so demotion prevents writes even before teardown completes.
- A current-document error invalidates the shared two-document generation, preventing either queued document callback from satisfying the resolution barrier.
- A history error invalidates its generation before unsubscribe, preventing queued history callbacks from restoring cleared data.
- Replacement start clears both current-document feature errors together, and history replacement clears its own error, while retaining unrelated feature errors.
- Changes remain limited to the store slice, its focused tests, and this report.

### Fix-round concerns

None.
