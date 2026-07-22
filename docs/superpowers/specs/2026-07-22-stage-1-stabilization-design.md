# FamilyQuest Stage 1 Stabilization Design

## Scope

Stage 1 preserves and stabilizes the existing uncommitted Family Settings,
regional settings, locale, and Transaction History work on branch `todo-theme`.
It does not deploy and it does not begin Gamification Phase 1.

Starting revision: `10ab47bfefc4296dbc113e08867d4165168c8e79`.

## Recorded baseline

Before Stage 1 changes:

- `git diff --check` passed.
- TypeScript and `npm run build` failed because the uncommitted Family Settings
  code referenced missing API exports and invalid translation keys, while the
  uncommitted Transaction History UI referenced a missing `EmptyState`, used
  incomplete types, and contained unused values.
- The focused Family Settings suite passed, while the Transaction Adapter suite
  failed 25 of 27 tests because `transactionAdapter.ts` was an intentional TODO
  skeleton returning empty arrays.
- The full unit suite had 78 failures, 1019 passes, and 3 skips across 102 test
  files. These failures are the baseline, not regressions introduced by Stage 1.

The complete command logs are retained for the working session at
`/tmp/fq-stage1-unit.log` and `/tmp/fq-stage1-build.log`.

## Locale stabilization

English and Turkish keys in every changed namespace must have exact recursive
key parity. Turkish text is translated rather than relying on English fallback.
Duplicate JSON keys and only proven-unused legacy copy-status keys are removed.
An automated test compares flattened keys for all supported namespaces.

The two known Turkish typos use `ailede`, never `aidede`.

## Shared child colour options

The colour swatches used by `EditMemberModal`, `AddChildModal`, and
`ChildOnboarding` move to one framework-neutral typed configuration module.
Components import that shared value and do not keep local copies.

## Family and regional settings

Before adding writes, existing client transactions, callable functions, and
Firestore rules are inspected. The implementation reuses the current API and
transaction conventions and does not create a parallel write architecture.

Only owner users may change family-level settings under the existing owner-only
family-document rule. Settings writes use an explicit allowlist and write:

- `name` for a family-name change;
- `currencyCode` for currency;
- `timezone` for timezone;
- `weekStartsOn` for week start;
- minimal audit metadata when supported by the existing schema.

Currency resolution is deterministic:

1. use a valid ISO 4217 `family.currencyCode`;
2. otherwise normalize the legacy `family.currency` symbol/value;
3. otherwise use `GBP`.

New writes persist `currencyCode` only. The legacy `currency` field is read-only
compatibility data and is not rewritten. Stored monetary values remain integer
minor units and historical amounts are not migrated.

The existing invite-code and join-request flow is the supported Add Parent
mechanism. The owner button opens an accurate translated explanation and copy
action for that flow. It does not create a second invitation backend.

## Transaction History isolation and completion gate

Transaction History never shares a Family Settings commit. The adapter/model
foundation is tested and committed independently.

The UI may be committed only if all of these are true:

- the adapter is implemented and its meaningful tests pass;
- `EmptyState` resolves to a real shared component;
- no `window.__REWARDS__` or other browser global is a data source;
- reward, member, goal, and related resolvers use typed store/adapter inputs;
- one shared `TransactionIcon` replaces duplicated icon renderers;
- imports and source types are coherent and contain no feature-level `any`;
- a real route and navigation entry make the screen reachable;
- screen tests, typecheck, and production build pass.

If any gate cannot be completed safely, the UI files are preserved in a named
stash or isolated branch/worktree and removed from the production-ready working
tree. Valid model/adapter/test foundations may still be committed.

## Commit and verification discipline

Commits are small and independently coherent. No commit imports an uncommitted
file or relies on a later commit to compile. Each commit runs `git diff --check`,
TypeScript, relevant tests, and a build where its scope can affect production.
Baseline failures are reported separately from new regressions. No deployment
occurs during this work.
