# Stabilization temporary-artifact cleanup report

Date: 2026-07-13

Scope: Phase 0 temporary artifacts plus current repository-root clutter

Safety constraint: no live, migration, reset, production-evidence, browser, or mutation script was executed.

## Result

Disposable repair machinery, redundant unsafe migrations, live probes, generated outputs, backups, coverage output, Firebase deploy cache, screenshots, and captured diffs were removed. Permanent application code, tests, reviewed data tools, source documentation, and unrelated in-progress work were preserved.

`tests/store/useStore.test.ts` is tracked and present. No useful test under `tests/` or `src/**/*.test.*` was deleted.

## Removed/retained matrix

| Category | Removed | Retained | Reason |
|---|---|---|---|
| Mechanical repair scripts | Root `apply_*`, `break_*`, `fix_*`, `force_true.py`, `opt_users.py`, `patch_*`, `update_*`, `use_*`, `replay.py`, `debug_rules.js`, and `remove_old_tests.js` | None | One-off source/rules rewriters are not maintainable tooling; the test-deletion script is explicitly unsafe. |
| Root integration/live probes | `test_browser.mjs`, `test_chain.py`, `test_double_join.ts`, `test_edit.ts`, `test_flows.ts`, `test_isolate.py`, `test_isparent.py`, `test_join.ts`, `test_managed.ts`, `test_managed_ui.mjs`, `test_owner_flow.mjs`, `test_prod_evidence.mjs` | Permanent suites under `tests/` and tracked `src/**/*.test.*` | Ad hoc scripts bypass the permanent test harness and some target browser/production state. Equivalent useful coverage belongs in tracked suites. |
| Live diagnostics and mutations | `fetch_bilge.mjs`, `migrate_owners.mjs`, `run_client_migration.mjs`, `scripts/investigate_live.cjs` | Reviewed export/reset CLIs | Removed scripts contain hard-coded project targets or direct writes and lack the reviewed safety contract. |
| Duplicate wallet migration tools | `scripts/migrate_wallets.js`, `scripts/migrate_wallets.ts`, `scripts/verify_wallets.js` | `scripts/export-family-data.ts`, `scripts/reset-family-data.ts`, `scripts/lib/family-data-tools.ts`, `scripts/lib/firebase-admin-data-tools.ts` | The three wallet scripts disagree on project/mode/behavior and are superseded by scoped, tested, documented Admin tooling. |
| Misnamed emulator probes | `scripts/test_live_transfer.ts`, `scripts/test_live_petbox_approval.ts` | `tests/firestore/transfers.rules.test.ts`, `tests/firestore/approvalCenter.rules.test.ts`, `tests/firestore/reversal.rules.test.ts` | They are standalone emulator experiments, not live-safe tools or permanent tests. The maintained suites cover these domains. |
| Rules backups and captured state | `firestore.rules.backup`, `firestore.rules.bak2`, `firestore.rules.recovered`, `ruleset_name`, `latest_ruleset_name` | `firestore.rules` and Git history | Backups/ruleset IDs are generated evidence and can expose environment state; Git is the source of truth. |
| Logs and intermediate output | `build_output.txt`, `diff_output*.txt`, `migrate_output.txt`, `part1.txt`–`part3.txt`, `test_output.txt`, `test_rules_output.txt`, `verify_output.txt`, `transfer_checkpoint.md` | Reviewed reports in `.superpowers/sdd/` | Captured output is stale and reproducible; durable conclusions remain in review/implementation reports. |
| Generated review diffs | `.superpowers/sdd/review-*.diff` | Audit, implementation, review, brief, and progress documents | Large diff captures are reproducible from Git; human-authored review evidence remains useful. |
| Generated directories/caches | `coverage/`, `dist/`, `.firebase/hosting.ZGlzdA.cache`, `firestore-debug.log`, root and `src` `.DS_Store` | Public source assets remain tracked | Build, coverage, emulator, deploy, and editor caches are reproducible and not source. The Firebase cache was removed from tracking. |
| Screenshot artifact | `rewards.png` | Product images under `public/` and `src/assets/` | Root screenshot was unreferenced generated evidence. |
| Environment and exports | No local secret/export was read, staged, or deleted | Local `.env`; any `family-data-exports/` output | These must remain local and untracked. `.gitignore` now covers `.env`, `.env.*` (except `.env.example`), and the existing export directory rule. The already-versioned `.env.production` contains the established client-side Vite Firebase configuration and was not changed by this cleanup. |
| Application work | None | Untracked `ActionMenu.tsx`, `RequestMoneyModal.tsx`, `SendMoneyModal.tsx`, and all unrelated modified source/package files | These are plausible product work, not cleanup artifacts, and ownership/scope was not inferred. |
| Permanent tests | None | In particular `tests/store/useStore.test.ts`, all `tests/**`, and tracked component/unit tests | The cleanup does not trade away useful regression coverage. |

## Ignore-policy changes

`.gitignore` now excludes local environment variants, Firebase deployment cache, coverage output, family exports, generated rule backups/IDs, and common captured output names. It deliberately does not ignore repair/debug/live-probe script naming patterns: a future reintroduction should remain visible in `git status` and receive review rather than silently accumulating.

## Permanent tool policy

- `scripts/export-family-data.ts` is the supported scoped export path.
- `scripts/reset-family-data.ts` is the supported dry-run-first reset path; execute mode requires explicit selection and exact family-name confirmation.
- Their shared libraries and permanent tests remain tracked.
- `scripts/seed.ts` remains as an existing tracked mock/demo seed source; it has no package command, uses mock Firebase configuration, and does not execute unless its commented invocation is deliberately enabled.
- The README now documents the supported export and dry-run commands and warns against ad hoc repair/migration/live probes.

## Verification performed

- Confirmed `tests/store/useStore.test.ts` with `git ls-files` and filesystem inspection.
- Confirmed the retained export/reset tools, libraries, package commands, and data-tool tests are tracked.
- Confirmed local `.env` and family export paths are ignored after the policy update.
- Reviewed the post-cleanup status to separate the cleanup patch from unrelated pre-existing work.
- Did not execute tests because the changes are documentation/ignore policy plus artifact deletion, and did not run any live or mutation script.
