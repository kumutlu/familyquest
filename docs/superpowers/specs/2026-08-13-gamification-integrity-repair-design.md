# Gamification Integrity Repair Design

## Goal

Make XP rebuilds complete, deterministic, race-safe, and operationally recoverable while preserving the recovered server-authoritative challenge implementation. Clarify the two misleading UI labels and prevent unreviewed Functions deployments. Production remains read-only until a separately approved mutation.

## Proven canonical results

- Alisya: 866 XP.
- Mostium: 595 XP.
- Mnalium: 797 XP.
- The existing Family Challenge award is included exactly once in each total and must not be awarded again.

## Architecture

Historical XP documents are read without ordering on optional event fields. A pure normalization boundary validates every XP-bearing document, derives deterministic ordering fields for known legacy shapes, preserves canonical events unchanged, and rejects unknown shapes. Rebuild folds only normalized input.

Rebuild state distinguishes `rebuild_required`, actively owned `rebuilding`, `failed`, and healthy `ready`. A server/admin executor acquires a generation, checkpoints work, and publishes only if the generation and source watermark remain current. Publication updates the canonical summary and `users.lifetimeXP` compatibility mirror together. A completed clean rebuild is idempotent.

Challenge closure requires a confirmed result for every child captured in the initial eligible set. `ignored`, missing, failed, and unverified results leave the challenge active and suppress success side effects. Existing deterministic event identities make retry convergent.

Firestore serialization omits or defaults undefined legacy projection fields at the trusted write boundary without changing streak calculations.

The parent dashboard displays total XP and progress-to-next-level as separate values from the authoritative resolved summary. Family ranking retains its current calculation and is relabelled as approved task points for the current week.

Functions production deployment uses the same fail-closed provenance constraints as Hosting: clean worktree, explicit approved branch, HEAD reachable from its remote tracking branch, and build-SHA verification.

## Safety and error handling

- Unknown XP-bearing documents stop a rebuild with document-scoped diagnostics.
- Immutable ledger documents and IDs are never rewritten.
- A stale rebuild generation cannot publish over newer live activity.
- No client callable or client balance writer is added.
- Production dry runs perform reads only and are executed twice for deterministic evidence.
- Production writes, deployment, and rebuild execution remain outside this change's approval.

## Verification

Each slice follows red-green-refactor and is committed independently. Final gates cover Functions/domain/rebuild/challenge/finalizer/UI/architecture tests, both TypeScript projects, both builds, relevant Firestore rules tests, and two identical read-only production dry runs.

## Explicitly deferred

- Server-authoritative migration of remaining reward-point writers.
- Safari WebChannel 400 changes absent evidence of data loss.
- Any production repair, deployment, or challenge re-award.
