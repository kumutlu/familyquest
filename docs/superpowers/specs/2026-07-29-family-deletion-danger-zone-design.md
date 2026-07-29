# Family Danger Zone: Resumable Deletion and Safe Leave Design

**Status:** Approved design specification

**Date:** 2026-07-29

**Scope:** Secure family deletion and self-registered member departure only. This document does not authorize implementation or deployment.

## Goals

The existing Danger Zone must become a server-authoritative production feature:

- An owner can irreversibly delete a family only after entering the exact family name.
- A non-owner, self-registered member can leave without changing the rest of the family.
- Managed-child identities owned by a deleted family are fully removed.
- Self-registered identities survive deletion or departure, but lose every family relationship, family role, gamification value, and family custom claim.
- Family deletion remains correct across retries, concurrent processors, large data sets, browser closure, and partial external-service failures.
- No client receives privileged deletion capability.

The implementation must not delete or modify any production data until the separate implementation plan is approved and executed.

## Repository Data Inventory

The inventory was derived from `firestore.rules`, Functions source, client API paths, index definitions, and cleanup utilities. The implementation must encode this list as a reviewed registry for tests and observability, then also enumerate actual subcollections dynamically at runtime. The registry is a regression guard; dynamic enumeration is the future-proof cleanup mechanism.

### Root documents

| Path | Ownership and deletion rule |
| --- | --- |
| `families/{familyId}` | Family aggregate. Marked `deleting` first and deleted last. |
| `users/{uid}` | Identity profile. Delete only for an authoritatively verified managed child. For self-registered users, preserve the profile and clear family-specific fields. |
| `familyMembershipIdempotency/{uid_clientReqId}` | Operational record containing `familyId`. Delete records whose stored `familyId` matches the deleted family. |
| `familyJoinAttempts/{uid_clientReqId}` | Requester-scoped abuse-control record with no family identifier or code. Not family-owned; retain under its ordinary retention policy. |
| `familyJoinRateLimits/{uid}` | Requester-scoped abuse-control record with no family identifier or code. Not family-owned; retain under its ordinary retention policy. |
| `familyDeletionJobs/{familyId}` | New server-only operational job described below. Deleted after successful finalization. |
| `familyDeletionReceipts/{familyId}` | New minimal, server-only completion receipt retained for 30 days. |

No family code, family name, password, synthetic child-login identifier, username, password-derived value, or private login credential may be copied into a deletion job, log, metric label, error, or receipt.

### Direct subcollections of `families/{familyId}`

The current family tree contains:

1. `join_requests`
2. `announcements`
3. `announcement_reads`
4. `tasks`
5. `task_completions`
6. `behaviour_events`
7. `rewards`
8. `redemptions`
9. `wallets`
10. `wallet_transactions`
11. `savings_goals`
12. `goal_requests`
13. `idempotency`
14. `feed`
15. `notifications`
16. `notification_deliveries`
17. `notification_reads`
18. `challenges`
19. `funds`
20. `fund_transactions`
21. `reversal_events`
22. `reversals`
23. `transfer_requests`
24. `money_requests`
25. `petbox_requests`
26. `profile_update_requests`
27. `users`
28. `childLoginIndex`
29. `childLogins`
30. `childLoginAudit`
31. `childLoginIdempotency`
32. `task_occurrences`
33. `gamification_events`
34. `daily_eligibility`
35. `daily_progress`
36. `gamification_summaries`
37. `gamification_checkpoints`

Known nested subcollections are:

- `families/{familyId}/users/{userId}/avatar_unlocks`
- `families/{familyId}/users/{userId}/push_tokens`
- `families/{familyId}/savings_goals/{goalId}/contributions`
- `families/{familyId}/savings_goals/{goalId}/goal_ledger`
- `families/{familyId}/savings_goals/{goalId}/match_proposals`

Runtime cleanup must call the Admin SDK to list every actual direct subcollection beneath the family document and recursively delete each discovered tree. It must not rely only on the names above. The family document itself must not be passed to a recursive-delete operation because that could delete it before verification and finalization.

### Legacy root namespaces

Rules explicitly deny legacy root-level family data paths such as `task_occurrences`, `gamification_events`, `daily_eligibility`, and `gamification_checkpoints`. Before finalization, the orphan scanner must query each known legacy root namespace for documents with `familyId == targetFamilyId` and delete only those matches. Missing collections or documents are success. This does not authorize a broad delete of a shared root collection.

## Architecture

There are four server-authoritative entry points:

1. `deleteFamily` callable validates the authenticated owner and exact family-name confirmation, atomically freezes the family and creates or returns its deletion job, then dispatches the job.
2. `processFamilyDeletion` is a Cloud Tasks task-queue Function in `europe-west1`. It claims a lease and advances one or more bounded, idempotent phases.
3. `recoverFamilyDeletionJobs` is a scheduled Function that finds queued jobs, retry-wait jobs whose delay elapsed, and running jobs with expired leases, then enqueues them. It closes the transaction-to-queue dispatch gap and makes progress independent of the browser.
4. `leaveFamily` is a callable for a non-owner self-registered member. It removes only that caller's membership projection and family-specific identity state.

`getFamilyDeletionStatus` is a read-only callable used by the initiating owner. Direct client reads and writes to jobs and receipts are denied.

The client supplies only:

- `familyId`
- the typed family name to `deleteFamily`
- a stable `clientReqId`

The typed family name is compared server-side using an exact, case-sensitive string comparison against the current stored family name. It is never persisted in operational records. The callable rejects leading/trailing differences rather than normalizing them.

## Atomic Freeze

`deleteFamily` runs a Firestore transaction that:

1. Reads the caller's `users/{uid}` profile and `families/{familyId}`.
2. Requires the caller to be the current `owner` of the same family.
3. Requires the submitted family name to exactly equal the stored family name.
4. If no active job exists, updates the family with:
   - `lifecycleState: "deleting"`
   - `deletionJobId: familyId`
   - `deletionRequestedAt: serverTimestamp()`
   - `deletionRequestedBy: uid`
5. Creates `familyDeletionJobs/{familyId}` in `queued` state.

The family freeze and job creation are one transaction. A family can never be marked deleting without a durable job, and a job can never begin against an active family.

The family cannot be unfrozen through the client or ordinary settings APIs. Once accepted, deletion is irreversible. A dispatch failure leaves the durable job queued; the recovery scheduler will dispatch it.

## Deletion Job Schema

`familyDeletionJobs/{familyId}` is server-only and contains:

```text
schemaVersion: 1
familyId: string
clientReqId: string
requestedBy: uid
state: "queued" | "running" | "retry_wait" | "failed" | "completed"
phase:
  "inventory_members"
  | "revoke_member_access"
  | "delete_managed_identities"
  | "clear_self_registered_profiles"
  | "delete_external_references"
  | "delete_family_subcollections"
  | "verify_orphans"
  | "finalize"
attemptCount: integer
phaseAttemptCount: integer
leaseOwner: string | null
leaseExpiresAt: timestamp | null
nextAttemptAt: timestamp | null
createdAt: timestamp
startedAt: timestamp | null
updatedAt: timestamp
lastErrorCode: allowlisted non-sensitive code | null
lastErrorAt: timestamp | null
progress:
  processedMembers: integer
  deletedManagedIdentities: integer
  clearedSelfRegisteredProfiles: integer
  deletedExternalRecords: integer
  deletedFamilyDocuments: integer
```

The job stores no member inventory, UID list, document cursor, document path, family name, code, username, Auth email, login identifier, or secret. Each phase repeatedly queries the first remaining eligible records; deleting or clearing their family marker naturally advances the query. Collection names used during recursive cleanup may be held only in process memory, not persisted in the job.

`clientReqId` is accepted only if it matches the repository's non-secret request-ID format. Reuse with incompatible non-secret metadata is rejected. Because there can be only one job document per family, the family ID is the idempotency boundary.

## States, Phases, and Transitions

Allowed state transitions are:

```text
queued -> running
running -> running                 (phase or bounded progress advanced)
running -> retry_wait              (transient failure)
retry_wait -> running
running -> failed                  (non-retryable invariant or exhausted retry budget)
failed -> queued                   (authenticated owner retry)
running -> completed
completed -> job deleted           (after receipt is durable)
```

No other transition is valid. A transaction validates every transition.

Phases run in this exact order:

1. `inventory_members`
2. `revoke_member_access`
3. `delete_managed_identities`
4. `clear_self_registered_profiles`
5. `delete_external_references`
6. `delete_family_subcollections`
7. `verify_orphans`
8. `finalize`

Each phase is idempotent. Missing Auth users, profiles, documents, or subcollections mean that item is already clean. A later phase cannot run until the current phase's completion query returns no remaining work.

## Lease, Concurrency, and Retry Behaviour

Each task invocation claims the job in a Firestore transaction:

- `leaseOwner` is a random non-secret processor invocation ID.
- The lease lasts five minutes.
- The processor renews it after every bounded batch and before external Auth operations expected to take material time.
- A processor may mutate the job only while its lease owner matches and the lease is unexpired.
- A duplicate task exits successfully when another unexpired lease exists.
- An expired lease may be taken over transactionally.

Firestore work uses bounded batches below the 500-write platform limit; the implementation target is at most 400 writes per commit. Auth operations run with bounded concurrency and record progress only as aggregate counts. The task handler has a bounded execution window and yields by enqueueing the same family ID again before its deadline.

Transient failures use exponential backoff with jitter through Cloud Tasks and set `retry_wait`. The scheduled recovery function also re-enqueues eligible jobs. Missing-resource responses are treated as success. Permission, linkage, or identity-classification contradictions are non-retryable safety failures and set `failed` without unfreezing the family.

After the configured automatic retry budget is exhausted, the job remains `failed`. The initiating owner sees a friendly failure state and may choose **Retry deletion**, which calls `deleteFamily` again with exact name confirmation and a new `clientReqId`; the server returns the same job to `queued`, clears only its sanitized error fields, and resumes the current phase. Before member cleanup, retry authorization uses the current owner profile. After the job has cleared the owner's family relationship, retry authorization uses the immutable `requestedBy` value on the existing job plus the authenticated UID; this exception can resume only that already-frozen job and cannot start, redirect, or unfreeze a deletion. Exact-name confirmation is still checked against the frozen family document. Operational alerts use only family ID, job state, phase, attempt count, and allowlisted error code.

## Duplicate Delete Requests

- If the family is active and no job exists, the request freezes it and creates the job.
- If the family is already deleting and its job is queued, running, retrying, or failed, the server requires the current owner before owner-profile cleanup or the same authenticated `requestedBy` afterward, rechecks the exact family name, rejects incompatible requester metadata, and returns the same job. A failed job is requeued only through the explicit retry action.
- Concurrent first requests serialize on the family/job transaction; exactly one creates the job.
- A repeated `clientReqId` with the same requester, operation, and family returns the existing job.
- A repeated `clientReqId` with incompatible non-secret metadata returns `already-exists`.
- A completed request is represented by the minimal receipt. Processor retries use the job/receipt state and do not require an owner profile or family document.

## Authoritative Identity Classification

Classification is based on server-side records, never on client input:

### Managed child

An identity is managed only when the following authoritative links agree:

- `users/{childId}.isManaged == true`
- role is `child`
- profile `familyId` equals the deleting family
- a profile with `hasLogin == true` has both a private `families/{familyId}/childLogins/{childId}` linkage and a public `authUid`; neither link is optional for a provisioned login
- Firebase Auth custom claims for that provisioned login contain `managedChild: true`, the same `childId`, the same `familyId`, and role `child`
- the public profile's `authUid`, private linkage Auth UID, and Firebase Auth UID all match

A profile-only managed child must have `hasLogin != true`, no public `authUid`, and no private login linkage. It is deleted as an unprovisioned managed identity. Any mixed state between these two complete shapes is an invariant failure.

If records disagree, the processor must not guess and must not delete an ambiguous Auth account. It disables/revokes a positively linked managed Auth user when safe, marks the job `failed` with a sanitized identity-linkage error, and requires operator correction before retry.

### Self-registered user

Every family member not authoritatively proven to be managed is treated as self-registered for deletion safety. Their Firebase Auth account and `users/{uid}` profile are preserved. The Auth UID is the authenticated profile identity; no managed-private linkage may point to it.

The processor removes family-specific custom claims (`familyId`, `role`, `childId`, and `managedChild`) while preserving unrelated claims. It never replaces the entire claims map blindly.

## Claims, Sessions, and Profile Ordering

The family is frozen before any identity changes, so Rules block normal data access immediately.

For each self-registered member:

1. Read and validate the current Auth user when it exists.
2. Remove only family-related custom claims.
3. Persist the updated claims successfully.
4. Revoke refresh tokens successfully.
5. Clear family-specific fields from `users/{uid}`.

For each authoritatively verified managed child with Auth:

1. Disable the Auth user.
2. Revoke refresh tokens.
3. Delete the Auth user.
4. Delete `users/{childId}` only after Auth deletion succeeds or returns `user-not-found`.

For a profile-only managed child, delete `users/{childId}` directly after authoritative classification.

A transient claim, revocation, or Auth deletion failure stops that item before its profile is cleared or deleted. Therefore a retry can rediscover it by `familyId`. The client is signed out only after the server operation succeeds; server token revocation independently prevents old sessions from regaining family access.

### Self-registered profile fields to clear

The server removes every family-scoped field present, including:

- `familyId`
- `role`
- `joinRequestId`
- `rewardPoints`
- `lifetimeXP`
- `walletBalance`
- `balance`
- `currentStreak`
- `longestStreak`
- `lastActiveDate`
- family transaction linkage fields such as `lastFundTxId`, `lastRedemptionId`, `lastTaskCompletionId`, `lastBehaviourEventId`, `lastReversalId`, `lastManualTxId`, `lastPenaltyTxId`, `lastTransferTxId`, `lastTransferReqId`, and `lastGoalTxId`
- family-scoped membership/departure markers introduced by this feature

Identity-owned fields such as display name, avatar selection, email metadata, and language remain. Managed-child-only login fields must not exist on a self-registered profile; finding them is an invariant failure rather than permission to delete the identity.

## Family Data Cleanup

After every member's access is revoked and identity treatment is complete:

1. Delete `familyMembershipIdempotency` records where `familyId` equals the target.
2. Delete matching documents in the explicitly inventoried legacy root namespaces.
3. List every direct subcollection under `families/{familyId}` using the Admin SDK.
4. Recursively delete each returned subcollection tree with throttled BulkWriter semantics.
5. Repeat dynamic listing until it returns no subcollections.

Recursive deletion is safely repeatable. A timeout may leave a partially deleted subcollection; the next task invocation lists it again and continues. Existing Pet Box data, wallet history, audits, bulletin data, and every other family-owned record are included in a full family deletion.

## Immutable History and Privacy Rule

Full family deletion is a privacy-erasure boundary. All family-owned immutable history and audit documents, including `childLoginAudit`, financial ledgers, reversals, task history, approvals, notification delivery history, feed entries, and bulletin history, are deleted rather than anonymized or retained.

The only retained artifact is the minimal server-only completion receipt described below.

When a member merely leaves, family-owned immutable history remains unchanged, including historical UID references. It remains accessible only to active family members under existing authorization. Departure does not rewrite financial, task, approval, or audit history.

## Orphan Verification

Before the family document is deleted, the processor must prove:

- no `users` profile still has `familyId == targetFamilyId`
- no `familyMembershipIdempotency` record still has that `familyId`
- no known legacy root document still has that `familyId`
- dynamic `listCollections()` beneath the family returns empty
- the family document still exists and has `lifecycleState == "deleting"`
- every managed profile was removed only after its positively linked Auth identity was deleted or confirmed absent
- every remaining self-registered profile selected by the family query has its Auth access cleaned before its family-specific fields are cleared

The implementation test harness retains seeded Auth identifiers outside production storage so integration tests can assert that all managed Auth users are gone and self-registered Auth users remain. Production does not persist an Auth-UID inventory in the job. Safety comes from the per-profile ordering: a managed profile is never deleted until its Auth deletion is confirmed.

If an orphan query finds work, the processor returns to the corresponding cleanup phase instead of finalizing. If the finding is contradictory rather than cleanable, the job becomes `failed`.

## Finalization and Retry After Family Removal

Finalization uses a Firestore transaction that:

1. Reads the deletion job, family document, and any existing receipt.
2. If the receipt already records success and the family is absent, marks the retry as successful.
3. Otherwise requires the leased job to be in `finalize`, the family to exist in `deleting`, and all prior verification markers to be current.
4. Deletes `families/{familyId}`.
5. Creates `familyDeletionReceipts/{familyId}`.
6. Marks the job `completed`.

The family document is the last family-owned document deleted. A later cleanup invocation that finds the family already absent must not recreate it or fail merely because it is missing: a valid success receipt makes the operation complete. If both family and receipt are missing, the processor marks an invariant failure because it cannot prove authorized completion.

After the receipt is durable, a separate best-effort write deletes the completed job. A retry that sees only the receipt exits successfully.

## Completion Receipt and Retention

`familyDeletionReceipts/{familyId}` contains only:

```text
schemaVersion: 1
familyId: string
requestedBy: uid
startedAt: timestamp
completedAt: timestamp
outcome: "deleted"
expiresAt: timestamp
```

No counts, names, roles, codes, usernames, Auth identifiers, paths, error messages, or family content are retained. `expiresAt` is exactly 30 days after completion. Firestore TTL is configured on this field; a scheduled safety cleanup also removes expired receipts because TTL timing is not immediate. Receipts are denied to clients.

## Frozen-Family Firestore Rules

Rules introduce `familyIsActive(familyId)`, which returns true only when the family exists and `lifecycleState` is absent or equals `active`. Absence remains backward-compatible for current family documents.

Every normal read or write path under `families/{familyId}` must require `familyIsActive(familyId)`, including paths that currently authorize requesters, notification recipients, managed children, or public-profile linkage without calling `isFamilyMember`. Updating only `isOwner`, `isParent`, and `isFamilyMember` is insufficient because Firestore allow expressions are additive and there is no overriding deny rule.

Root `users/{uid}` same-family reads and all family-scoped client mutations must also require an active family when authorization depends on a family relationship. Clients cannot set or clear `lifecycleState`, `deletionJobId`, or deletion audit fields. Direct client access to deletion jobs and receipts is denied.

Rules tests must enumerate every known family match block and prove that owner, parent, child, managed child, pending requester, and notification recipient lose normal access while deleting. Server Functions use Admin SDK authorization checks and remain able to process the frozen family.

## Failure Reporting and Progress UI

The owner-only Danger Zone shows **Delete family**. The dialog:

- states that deletion is irreversible
- requires the exact family name
- disables submission until the value exactly matches
- submits once with a stable request ID

After acceptance, the authenticated app enters a blocking deletion-progress screen and stops normal family subscriptions. It calls `getFamilyDeletionStatus` with exponential polling backoff. The callable allows only `requestedBy` to inspect the active job or its receipt and returns only state, phase, aggregate progress, and a localized-safe error code.

Transient retries display non-blocking progress such as “Deletion is taking longer than expected; it will continue automatically.” A failed job shows a friendly explanation, a retry action, and a support reference derived from the non-secret job/family ID. Raw exceptions never reach the UI.

When status is complete, the client clears Zustand/subscription state, signs out, and returns to login/registration. If the browser closes, Cloud Tasks and the recovery scheduler continue. On the next visit, revoked tokens or the preserved self-registered profile without a family route the former owner to authentication/onboarding; the browser is not required for completion.

## Leave Family

The UI shows **Leave family** only to non-owner self-registered members. It shows **Delete family** only to the owner. Managed children cannot leave independently.

`leaveFamily`:

1. Authenticates the caller and reads their authoritative profile and family.
2. Rejects an owner with `failed-precondition`; ownership must first be transferred or the family deleted.
3. Rejects a managed identity.
4. Verifies the family is active and the caller belongs to it.
5. Uses a server-only, idempotent departure marker to block that caller's family access during processing.
6. Removes only the caller's family-related custom claims and successfully revokes their sessions.
7. Recursively deletes only `families/{familyId}/users/{uid}` and its nested membership projections.
8. Clears the same family-specific root-profile fields listed above.
9. Leaves every other member, family setting, wallet, task, reward, pending request, approval, bulletin item, and historical family record unchanged.

Retrying after claim removal or missing membership projection is success when the preserved profile no longer has the family relationship. A caller cannot leave a deleting family; the deletion job owns cleanup. After success, the client clears local state, signs out, and returns to login/registration.

## Large-Family and Platform Limits

- Firestore commits use no more than 400 writes.
- Auth calls use small bounded concurrency to avoid quota spikes.
- Each task checks its remaining deadline and re-enqueues itself before timeout.
- No task assumes it can finish an entire phase in one invocation.
- Dynamic recursive deletion is throttled. A deadline or transient BulkWriter failure is retryable; already deleted documents are success.
- Queries use stable limits and select the first records that still carry the target `familyId`, avoiding a persisted identity cursor.
- Aggregate progress is monotonic but informational; correctness comes from absence queries.
- Cloud Tasks retry policy and the recovery scheduler together tolerate lost delivery, duplicate delivery, process termination, and long outages.

## Security and Privacy Logging

Structured logs and metrics may contain only:

- job/family ID
- processor invocation ID
- phase and state
- attempt number
- aggregate counts
- duration
- an allowlisted sanitized error code

They must never contain family names, family codes, usernames, emails, passwords, password-derived material, synthetic login identifiers, private child-login data, document bodies, callable request payloads, or raw Auth/Firestore exceptions. Raw exceptions are converted at the boundary and sensitive fields are not interpolated.

## Test Requirements

### Function and emulator integration tests

- owner with exact family name starts deletion
- wrong name, non-owner, unauthenticated, and cross-family requests are rejected
- owner cannot leave
- non-owner self-registered parent/child departure preserves Auth and profile while clearing family state
- managed child cannot call leave
- duplicate and concurrent delete requests return one job
- incompatible request-ID reuse is rejected
- family freeze and job creation are atomic
- normal family access is denied while deleting
- every phase is idempotent under repeated and out-of-order task delivery
- expired lease takeover works and an active lease prevents concurrent mutation
- transient failure resumes from the current phase
- missing records are accepted as already cleaned
- managed-child Auth, profile, login metadata, username index, membership, and sessions are removed
- self-registered Auth/profile survive and their family claims, sessions, role, membership, balances, XP, points, streaks, and transaction links are cleared
- ambiguous managed linkage stops safely without deleting an Auth account
- pending requests, tasks, rewards, wallets, bulletin documents, approvals, histories, nested subcollections, and dynamically discovered unknown subcollections are deleted
- external family membership idempotency and matching legacy root documents are deleted
- requester abuse-control records without family identifiers remain
- orphan scans block finalization until clean
- family document is deleted last
- retry after family deletion recognizes the receipt
- missing family plus missing receipt fails safely
- the receipt has only approved fields and a 30-day expiry
- a simulated large family crosses multiple batches/invocations without exceeding limits

### Rules tests

- every family path denies normal reads and writes in `deleting`
- pending requesters and special-case recipients cannot bypass the freeze
- clients cannot create/update jobs or receipts
- clients cannot set or clear family lifecycle/deletion fields
- active legacy families with no `lifecycleState` retain existing access

### Client tests

- role-appropriate Danger Zone action is visible
- exact-name confirmation is required
- irreversible copy is displayed
- client calls only server-authoritative APIs
- progress survives component remount and handles queued, running, retrying, failed, and complete states
- friendly errors appear without raw server data
- completion clears local state, signs out, and navigates to authentication
- leave affects only the caller's local session

## Acceptance Criteria

The feature is ready for deployment only when:

- the repository inventory and dynamic-discovery tests pass
- all required Function, emulator, Rules, and client tests pass
- the complete Firestore predeploy suite exits zero if Rules change
- the full unit suite, production build, and `git diff --check` pass
- Functions and Hosting deploy successfully to `familyquest-beta-402cb`
- a production owner deletion walkthrough confirms re-registration, invalidation of the old family code, managed-child Auth cleanup, preservation of self-registered accounts, and no Firestore orphans

That deployment and production deletion are explicitly outside this specification-only change.
