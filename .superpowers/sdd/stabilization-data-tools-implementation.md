# Stabilization data tools implementation

Date: 2026-07-13  
Implementation commit: `575165f` (`feat: add safe family data reset tools`)

## Status

Implemented family-scoped export and reset tooling without changing `package.json` and without running an actual reset.

Files:

- `scripts/export-family-data.ts`
- `scripts/reset-family-data.ts`
- `scripts/lib/family-data-tools.ts`
- `scripts/lib/firebase-admin-data-tools.ts`
- `tests/scripts/resetFamilyData.test.ts`
- `.gitignore` excludes `family-data-exports/`

The tools use Firebase Admin with Application Default Credentials and an explicitly supplied project ID. No Firebase Auth API is imported or called.

## Safety contract

- Reset requires `--project`, `--family-id`, `--confirm-family-name`, and exactly one of `--dry-run` or `--execute`.
- Project and family identifiers cannot be path-like values.
- Family-name confirmation is an exact, case-sensitive comparison against the selected family document.
- Dry-run performs reads only, prints every selected operational collection count, and reports wallet/child-profile reset counts.
- Execute exports a timestamped JSON backup before the first mutation. If backup creation fails, no reset write is attempted.
- Backup files use exclusive creation (`wx`) and mode `0600`; existing files are never overwritten.
- All deletion paths are constructed below `families/{selectedFamilyId}` and operational document trees are enumerated recursively.
- Writes are committed in chunks of at most 400 operations, below Firestore's 500-write batch limit.
- Existing wallet balances are reset to zero and stale transaction-pointer fields are removed.
- A missing child wallet is created at zero rather than copying or guessing a legacy balance.
- Child operational counters are reset; parent/owner profiles are not modified.
- The family document is never updated or deleted.
- No Firebase Auth users are deleted.

## Preserved/deleted matrix

| Data | Reset behavior |
|---|---|
| `families/{familyId}` | Preserved unchanged |
| Family name, invite code, currency and embedded settings | Preserved unchanged |
| Non-operational family subcollections, including a future `settings` subcollection | Preserved unchanged |
| Owner/parent user profiles | Preserved unchanged |
| Child user profiles and family membership | Preserved; profile document remains |
| Child `walletBalance` legacy field | Set to `0` only when the field already exists |
| Child `rewardPoints`, `lifetimeXP`, `currentStreak`, `longestStreak` | Set to `0` |
| Existing `wallets` documents | Preserved; `balance` set to `0`; known stale ledger-pointer fields removed |
| Missing child wallet documents | Created with zero balance and migration metadata |
| Firebase Auth users | Never read, updated or deleted |
| `tasks` | Deleted recursively |
| `task_completions` | Deleted recursively |
| `rewards` | Deleted recursively |
| `redemptions` | Deleted recursively |
| `feed` | Deleted recursively |
| `wallet_transactions` | Deleted recursively |
| `behaviour_events` | Deleted recursively |
| `challenges` | Deleted recursively |
| `funds` | Deleted recursively |
| `fund_transactions` | Deleted recursively |
| `transfer_requests` | Deleted recursively |
| `money_requests` | Deleted recursively |
| `petbox_requests` | Deleted recursively |
| `reversals` | Deleted recursively |
| `approvals`, `approval_history` | Deleted recursively |
| `savings_goals` | Deleted recursively |
| `join_requests` | Deleted recursively; existing member profiles/membership remain |

The pre-reset export includes the family document, all recursively discovered family subcollections (including preserved and deleted data), and all `users` documents whose `familyId` matches the selected family.

## TDD evidence

RED was observed before implementation:

1. Initial focused suite failed because `scripts/lib/family-data-tools` did not exist.
2. The identifier-safety test failed because `../fam-1` was initially accepted.
3. The missing-wallet test failed because reset initially did not create a canonical wallet for a child without one.

GREEN:

```text
npx vitest run tests/scripts/resetFamilyData.test.ts
Test Files  1 passed (1)
Tests       13 passed (13)
```

Focused TypeScript verification:

```text
npx tsc --ignoreConfig --noEmit --target es2023 --module esnext \
  --moduleResolution bundler --types node --skipLibCheck \
  scripts/lib/family-data-tools.ts \
  scripts/lib/firebase-admin-data-tools.ts \
  scripts/export-family-data.ts \
  scripts/reset-family-data.ts
```

Exit code: 0.

Build verification:

```text
npm run build
```

Exit code: 0. Vite emitted existing bundle-size/dynamic-import warnings but completed the production build.

Full `npm run test` remains red outside this scope: 8 test files pass and 75 tests pass, while four Firestore suites fail because they are executed without the emulator and `tests/firestore/isolate.rules.test.ts` imports missing `./setup`. The focused data-tool suite is green.

## Commands

Read-only export:

```bash
npx tsx scripts/export-family-data.ts \
  --project familyquest-beta-402cb \
  --family-id FAMILY_ID
```

Safe dry-run (required before considering execute):

```bash
npx tsx scripts/reset-family-data.ts \
  --project familyquest-beta-402cb \
  --family-id FAMILY_ID \
  --confirm-family-name "EXACT FAMILY NAME" \
  --dry-run
```

Destructive command (documented only; **not run**):

```bash
npx tsx scripts/reset-family-data.ts \
  --project familyquest-beta-402cb \
  --family-id FAMILY_ID \
  --confirm-family-name "EXACT FAMILY NAME" \
  --execute
```

## Package scripts to add later

These were intentionally not added to avoid shared-file conflicts:

```json
{
  "data:export": "tsx scripts/export-family-data.ts",
  "data:reset:dry-run": "tsx scripts/reset-family-data.ts --dry-run",
  "data:reset": "tsx scripts/reset-family-data.ts --execute"
}
```

Usage after those entries are added:

```bash
npm run data:export -- --project PROJECT --family-id FAMILY_ID
npm run data:reset:dry-run -- --project PROJECT --family-id FAMILY_ID --confirm-family-name "EXACT FAMILY NAME"
npm run data:reset -- --project PROJECT --family-id FAMILY_ID --confirm-family-name "EXACT FAMILY NAME"
```
