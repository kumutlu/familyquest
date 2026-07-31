# Family Deletion — Audit and Remediation Plan

**Status:** Remediation **complete**. Family Deletion is **already implemented** and shipped in the repository; this document supersedes the earlier greenfield implementation plan and records the completed R1–R9 remediation.
**Source specification:** `docs/superpowers/specs/2026-07-29-family-deletion-danger-zone-design.md` (commit `18f00e6`, "docs(family): specify resumable family deletion").
**Scope:** Close the remaining gaps between the approved specification and the existing implementation. No re-implementation, no redesign, no spec changes.
**Out of scope:** onboarding, rebranding, Help Center, unrelated cleanup.

---

## 1. Audit — when and how Family Deletion was implemented

Family Deletion was implemented on **2026-07-30**, one day after the specification was approved, across six commits:

| SHA | Date | Commit | Contribution |
| --- | --- | --- | --- |
| `18f00e6` | 2026-07-29 | `docs(family): specify resumable family deletion` | Approved specification (reference only) |
| `f48a434` | 2026-07-30 | `feat(rules): family deleting freeze and server-only deletion collections` | `familyNotDeleting()` freeze in [`firestore.rules`](firestore.rules); server-only `familyDeletionJobs` / `familyDeletionReceipts` / `accountDeletionJobs`; [`tests/firestore/familyDeletion.rules.test.ts`](tests/firestore/familyDeletion.rules.test.ts) |
| `8de22d6` | 2026-07-30 | `feat(functions): deleteFamily freeze callable + deletion job schema + registry (TDD)` | `deleteFamilyImpl`, job schema, subcollection registry, [`functions/src/familyDeletion.test.ts`](functions/src/familyDeletion.test.ts) |
| `69c5edc` | 2026-07-30 | `feat(functions): processFamilyDeletion phase runner, leases, recovery scheduler, receipts` | Eight-phase runner, leases, recovery scheduler, receipt write, [`functions/src/familyDeletionWorker.test.ts`](functions/src/familyDeletionWorker.test.ts) |
| `5c47ef6` | 2026-07-30 | `test(functions): leaveFamily callable coverage (owner/managed refusals, freeze, idempotency)` | [`functions/src/leaveFamily.test.ts`](functions/src/leaveFamily.test.ts) |
| `f9ccb54` | 2026-07-30 | `feat(client): Danger Zone Delete Family + Leave Family flows replacing Coming soon` | [`src/components/family/DeleteFamilyDialog.tsx`](src/components/family/DeleteFamilyDialog.tsx), [`src/lib/familyDeletionApi.ts`](src/lib/familyDeletionApi.ts), Danger Zone in [`src/components/family/FamilySettings.tsx`](src/components/family/FamilySettings.tsx) |
| `2de3156` | 2026-07-30 | `feat(functions): deleteAccount callable — ... family-deletion ride ...` | `accountDeletionJobs` ride purged in `finalize` |
| `a96c08c` | 2026-07-30 | `test: tighten deletion test mock typings for the strict build` | Test typing hardening |

**Overall state: fully implemented end to end, with specification deviations.** It is not scaffolding: all eight phases, the lease protocol, the recovery scheduler, the receipt, the callables, the rules freeze, and the client Danger Zone exist and are covered by tests.

### Current architecture and entry points

[`functions/src/familyDeletion.ts`](functions/src/familyDeletion.ts) (888 lines), exported through [`functions/src/index.ts:155`](functions/src/index.ts:155):

| Entry point | Kind | Implementation |
| --- | --- | --- |
| `deleteFamily` | callable | [`deleteFamilyImpl`](functions/src/familyDeletion.ts:180) — transactional freeze + durable job, exact-name confirmation, clientReqId reuse handling, failed-job retry |
| `getFamilyDeletionStatus` | callable | [`getFamilyDeletionStatusImpl`](functions/src/familyDeletion.ts:310) — sanitized status for owner or original requester |
| `leaveFamily` | callable | [`leaveFamilyImpl`](functions/src/familyDeletion.ts:782) — non-owner self-registered departure, owner/managed refusals, freeze check |
| `processFamilyDeletion` | Cloud Tasks worker | [`processFamilyDeletionImpl`](functions/src/familyDeletion.ts:416) + [`runPhaseOnce`](functions/src/familyDeletion.ts:512) — eight phases, 5-minute lease, backoff, sanitized error codes |
| `recoverFamilyDeletionJobs` | scheduler (10 min) | [`recoverFamilyDeletionJobsImpl`](functions/src/familyDeletion.ts:757) — dispatch-gap closure |

Phases (implemented): `inventory_members` → `revoke_member_access` → `delete_managed_identities` → `clear_self_registered_profiles` → `delete_external_references` → `delete_family_subcollections` → `verify_orphans` → `finalize`.

Rules: [`firestore.rules:56`](firestore.rules:56) `familyNotDeleting()`, applied in `isOwner`, `isParent`, `isFamilyMember` and at statement level in the heavy validator chains; server-only deletion collections at [`firestore.rules:1627`](firestore.rules:1627); lifecycle field mutation blocked at [`firestore.rules:1644`](firestore.rules:1644).

Client: [`DeleteFamilyDialog.tsx`](src/components/family/DeleteFamilyDialog.tsx) (two-stage warning → exact-name confirm → polling → sign-out), Danger Zone + Leave in [`FamilySettings.tsx:951`](src/components/family/FamilySettings.tsx:951), API wrapper [`src/lib/familyDeletionApi.ts`](src/lib/familyDeletionApi.ts).

### Existing tests

| File | Tests | Coverage |
| --- | --- | --- |
| [`functions/src/familyDeletion.test.ts`](functions/src/familyDeletion.test.ts) | 17 | freeze atomicity, name confirmation (incl. case/whitespace), cross-family, idempotent duplicate, clientReqId conflict, failed-job retry, receipt recognition, dispatch failure, status sanitization/authz |
| [`functions/src/familyDeletionWorker.test.ts`](functions/src/familyDeletionWorker.test.ts) | 13 | full phase run with family deleted last, idempotency, lease held/expired, retry_wait, failed job, linkage hard-fail, backoff, attempt exhaustion, recovery scheduler |
| [`functions/src/leaveFamily.test.ts`](functions/src/leaveFamily.test.ts) | 10 | owner refusal, managed-child refusal, freeze refusal, idempotency |
| [`functions/src/accountDeletion.test.ts`](functions/src/accountDeletion.test.ts) | 19 | account-deletion ride via `accountDeletionJobs` |
| [`tests/firestore/familyDeletion.rules.test.ts`](tests/firestore/familyDeletion.rules.test.ts) | 6 | legacy-active access, frozen reads/writes, lifecycle-field tampering, server-only collections |
| [`src/components/family/FamilySettings.test.tsx`](src/components/family/FamilySettings.test.tsx) | 3 relevant | owner sees Delete family, two-stage dialog, non-owner sees Leave family |

No Firestore/Auth **emulator integration** test exists for the worker (unit tests use an in-memory Firestore mock, which cannot prove real Auth deletion/survival).

---

## 2. Classification of the previously planned LC1–LC10

| Planned item | Classification | Verdict |
| --- | --- | --- |
| LC1 rules `familyIsActive` | **Partially implemented** — freeze exists as `familyNotDeleting`, but non-existent-family semantics differ and `isChildInFamily` / notification-recipient / managed-child-identity paths omit it | **Keep, narrowed** → R1 |
| LC2 profile field clearing | **Implemented but non-compliant** — clears non-existent fields (`points`,`xp`,`level`,`streak`,`familyJoinedAt`) instead of the real schema fields | **Keep** → R2 (highest priority) |
| LC3 receipt schema | **Implemented but non-compliant** — writes `expiresAtMs` + `progress`; missing `requestedBy`, `startedAt`, `outcome` | **Keep** → R3 |
| LC4 transactional finalize | **Partially implemented** — finalize exists but is sequential, non-transactional, no re-check, no "both missing" invariant path | **Keep, narrowed** → R4 |
| LC5 lease renewal | **Partially implemented** — lease renewed only at phase boundaries via `setPhase` | **Keep, narrowed** → R5 |
| LC6 orphan Auth verification | **Partially implemented** — `verify_orphans` checks Firestore residue only, not Auth linkage/claims | **Keep, narrowed** → R6 |
| LC7 receipt TTL + cleanup | **Genuinely missing** — no TTL config, no scheduled cleanup | **Keep** → R7 |
| LC8 exhaustive rules tests | **Partially implemented** — 6 tests exist | **Merge into R1** (do not create a second rules commit); remaining assertions become R1 tests |
| LC9 client Delete/Leave UI | **Implemented, mostly compliant** — two-stage dialog, exact-name confirmation, polling, friendly errors, sign-out all exist | **Mostly duplicate; reduce** → R8 covers only the residual gaps (resume after remount, explicit `retry_wait` presentation) |
| LC10 emulator integration | **Genuinely missing** | **Keep** → R9 |

**Removed as duplicate work:** LC8 as a standalone commit (folded into R1) and the bulk of LC9 (dialog, confirmation, copy, error mapping, sign-out already shipped in `f9ccb54`). The earlier plan also referenced a non-existent file `functions/src/leave_family.test.ts`; the real file is [`functions/src/leaveFamily.test.ts`](functions/src/leaveFamily.test.ts).

---

## 3. Exact remaining defects

1. **D1 (privacy, severity: high)** — [`familyDeletion.ts:596`](functions/src/familyDeletion.ts:596) and [`familyDeletion.ts:805`](functions/src/familyDeletion.ts:805) delete fields that do not exist in the data model, so `rewardPoints`, `lifetimeXP`, `currentStreak`, `longestStreak`, `lastActiveDate`, `walletBalance`, `joinRequestId` and every `last*TxId` survive on self-registered profiles after both leave and family deletion.
2. **D2 (retention/schema)** — receipt at [`familyDeletion.ts:711`](functions/src/familyDeletion.ts:711) retains `progress` counts, uses numeric `expiresAtMs`, and omits `requestedBy` / `startedAt` / `outcome`.
3. **D3 (atomicity)** — finalize at [`familyDeletion.ts:693`](functions/src/familyDeletion.ts:693) is a sequence of unprotected writes; no re-read of family/receipt state, no "family and receipt both missing → `INVARIANT_VIOLATION`" path, job deleted inline rather than as a separate best-effort write.
4. **D4 (rules coverage)** — `familyNotDeleting` permits writes under a non-existent family document; `isChildInFamily` ([`firestore.rules:84`](firestore.rules:84)), notification-recipient reads, and managed-child identity reads do not apply the freeze.
5. **D5 (concurrency)** — lease renewed only in `setPhase` ([`familyDeletion.ts:500`](functions/src/familyDeletion.ts:500)); long batches and Auth loops can exceed the 5-minute lease.
6. **D6 (safety gate)** — `verify_orphans` ([`familyDeletion.ts:664`](functions/src/familyDeletion.ts:664)) does not re-verify managed-child Auth deletion or self-registered claim stripping.
7. **D7 (retention)** — no Firestore TTL policy on `familyDeletionReceipts.expiresAt` and no scheduled cleanup fallback.
8. **D8 (cross-spec, documentation only)** — the `accountDeletionJobs` purge in finalize is required by the account-deletion contract ([`docs/account-and-family-deletion.md:28`](docs/account-and-family-deletion.md:28)) but is absent from the family-deletion spec narrative. Behaviour is preserved and must be documented in code comments/tests; the spec is not edited.
9. **D9 (minor)** — failed-job retry at [`familyDeletion.ts:238`](functions/src/familyDeletion.ts:238) resets `attemptCount`/`phaseAttemptCount`; the spec permits clearing only sanitized error fields.
10. **D10 (client, minor)** — the delete dialog does not query existing job status on mount, so a remount during deletion returns to stage `warning`; `retry_wait` is presented identically to `running` with no distinct messaging.
11. **D11 (test depth)** — no Auth+Firestore emulator test proving managed-child Auth deletion, self-registered Auth survival, dynamic subcollection discovery, abuse-control retention, or large-family batching.

---

## 4. Remediation commits (replaces LC1–LC10)

Each remediation commit was TDD: failing test first, minimum change, passing test, then the relevant suite.

| ID | SHA | Commit | Defects | Files | Tests | Status |
| --- | --- | --- | --- | --- | --- | --- |
| **R1** | `3a4165a` | `fix(rules): apply familyIsActive freeze to remaining family paths` | D4 | [`firestore.rules`](firestore.rules), [`tests/firestore/familyDeletion.rules.test.ts`](tests/firestore/familyDeletion.rules.test.ts) | add `familyIsActive`, freeze `isChildInFamily`, notification-recipient and managed-child identity reads; extend rules tests for those paths, pending requesters, and legacy-active regression | **Implemented** |
| **R2** | `18ae093` | `fix(functions): clear real family-scoped profile fields on leave and deletion` | D1 | [`functions/src/familyDeletion.ts`](functions/src/familyDeletion.ts) | worker + leaveFamily tests asserting the exact spec field set is deleted and identity fields survive | **Implemented** |
| **R3** | `4928652` | `fix(functions): write spec-compliant family-deletion receipt` | D2 | [`functions/src/familyDeletion.ts`](functions/src/familyDeletion.ts) | receipt contains only `schemaVersion`, `familyId`, `requestedBy`, `startedAt`, `completedAt`, `outcome`, `expiresAt` (Timestamp, +30d) | **Implemented** |
| **R4** | `b35a146` | `fix(functions): make finalize transactional with separate job deletion` | D3, D8, D9 | [`functions/src/familyDeletion.ts`](functions/src/familyDeletion.ts) | transactional finalize; receipt-exists → success; both-missing → `INVARIANT_VIOLATION`; best-effort job delete; `accountDeletionJobs` purge retained with a compatibility comment; retry clears only sanitized error fields | **Implemented** |
| **R5** | `f2a301e` | `fix(functions): renew deletion lease within long phases` | D5 | [`functions/src/familyDeletion.ts`](functions/src/familyDeletion.ts) | `leaseExpiresAt` advances between batches and before Auth calls; takeover/exclusion still hold | **Implemented** |
| **R6** | `d18a8b4` | `fix(functions): re-verify Auth linkage during orphan scan` | D6 | [`functions/src/familyDeletion.ts`](functions/src/familyDeletion.ts) | orphan scan returns to cleanup when managed Auth survives or claims persist; contradictory state → `IDENTITY_LINKAGE_ERROR` without finalizing | **Implemented** |
| **R7** | `a285c4f` | `feat(functions): receipt TTL policy and scheduled expiry cleanup` | D7 | `firebase.json`, [`functions/src/index.ts`](functions/src/index.ts), new scheduled function | cleanup deletes receipts with `expiresAt < now`; idempotent, best-effort | **Implemented** |
| **R8** | `75d3174` | `fix(client): resume delete-family progress after remount` | D10 | [`src/components/family/DeleteFamilyDialog.tsx`](src/components/family/DeleteFamilyDialog.tsx) | on mount, an in-flight job restores the `deleting` stage; `retry_wait` shows retry messaging without raw server data | **Implemented** |
| **R9** | `7654ed3` | `test(functions): emulator integration coverage for family deletion` | D11 | new [`functions/src/familyDeletion.integration.test.ts`](functions/src/familyDeletion.integration.test.ts) | Auth+Firestore emulator: managed-child Auth removed, self-registered Auth/profile survive with claims stripped, dynamic subcollections deleted, abuse-control records retained, large family across batches | **Implemented** |

**Order (as executed):** R2 → R3 → R4 → R5 → R6 → R1 → R7 → R8 → R9.
Rationale: R2 is the live privacy defect and is independent; R3 must precede R4 (transaction writes the receipt) and R7 (TTL needs the timestamp); R1 is rules-only and independent; R9 is the capstone.

**Dependencies:** R3 → R4, R3 → R7. All others independent, though R2–R6 touch the same file and must stay separate commits for reviewability.

---

## 5. Requirement traceability (remediation only)

| Spec requirement | Status before | Remediation |
| --- | --- | --- |
| Owner + exact name freeze, authz, idempotency, clientReqId | Compliant (`8de22d6`) | none |
| Leave family refusals and idempotency | Compliant (`5c47ef6`) | none |
| Self-registered field erasure | Non-compliant | R2 |
| Receipt schema and 30-day expiry | Non-compliant | R3, R7 |
| Atomic finalize, family doc last, invariant failure | Partial | R4 |
| Lease and concurrency | Partial | R5 |
| Orphan verification incl. Auth linkage | Partial | R6 |
| Frozen-family rules on every path | Partial | R1 |
| Client Danger Zone, confirmation, progress, sign-out | Compliant (`f9ccb54`) | R8 (remount/retry only) |
| Emulator end-to-end proof | Missing | R9 |

---

## 6. Final verification results

All nine remediation commits (R1–R9) are merged and the working tree is clean apart from this document. Verification was run on 2026-07-31 (UTC) and passed:

| Check | Command | Result |
| --- | --- | --- |
| Functions unit tests | `npm --prefix functions test` | 197 passed, 6 skipped (emulator-only suites) |
| Web app tests | `npm test` | 121 passed |
| Firestore rules tests | `npm run test:rules` (Firestore + Auth emulators) | 29 files, 490 passed |
| Family-deletion emulator integration (R9) | `firebase emulators:exec --only firestore,auth 'cd functions && npx vitest run src/familyDeletion.integration.test.ts'` | 4 passed |
| Type check | `npx tsc --noEmit` | 0 errors |
| Lint | `npx oxlint` | 0 errors (86 pre-existing warnings, unrelated to remediation) |
| Whitespace check | `git diff --check` | clean |

R9 requires the Firestore **and** Auth emulators; the emulator connection was live and the suite passed (no connection-failure fallback). The 6 skipped functions tests are the emulator-only suites (`childLogin.emulator.test.ts`, `familyDeletion.integration.test.ts`), which are covered by the emulator runs above.

---

## 7. Non-goals

- No re-implementation of already-compliant behaviour (freeze callable, job schema, phase runner, recovery scheduler, leave callable, client dialog).
- No change to the approved specification text, including the D8 cross-spec gap.
- No onboarding, rebranding, Help Center, or unrelated cleanup work.
