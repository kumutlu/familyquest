# Child Join Request — Implementation Plan

Commit base: `9933ea0` (`feat(auth): clarify child sign-in and join flow`)

## 1. Existing architecture reused (inspection results)

| Area | Existing asset | Reuse decision |
| --- | --- | --- |
| Managed-child identity | `users/{childId}` profile with `role: 'child'`, `isManaged: true`, `authUid`, `hasLogin`, `username`, `loginEnabled`, `requiresPasswordChange` | Reused verbatim. **No second child identity model.** |
| Child auth | Synthetic email Auth user + custom claims `{ role, familyId, childId, managedChild }` (`functions/src/childLogin.ts`) | Reused. Approval provisions exactly the same shape as `createChildLoginImpl`. |
| Username normalization | `normalizeUsername()` in `childLogin.ts` (lowercase, collapse whitespace, `[a-z0-9_ ]`, 3–32) | Imported, not re-implemented. |
| Password policy | `validatePasswordStrength()` | Imported. |
| Username uniqueness | `families/{familyId}/childLoginIndex/{normalizedUsername}` | Reused as the **single** reservation namespace, so a pending request and a live login can never collide. |
| Private login record | `families/{familyId}/childLogins/{childId}` (synthetic email, authUid) | Written on approval, identical to `createChildLogin`. |
| Audit | `families/{familyId}/childLoginAudit` | Reused for join-request events. |
| Family code resolution | `families.where('inviteCode','==',CODE)` server-side only | Reused. |
| Rate limiting | `familyJoinRateLimits/{key}` transactional counter (`familyMembership.ts`) + in-memory limiter (`childLogin.ts`) | Reused pattern, Firestore-backed for the unauthenticated path. |
| Approval Center | `src/components/parent/ApprovalCenter.tsx` timeline categories + `bootstrapQueries.ts` query plan + `useStore` subscription | New `child_join` category added alongside existing ones. |
| Family deletion | `FAMILY_SUBCOLLECTION_REGISTRY` + dynamic `listCollections()` cleanup | New subcollections registered; runtime cleanup already dynamic. |

## 2. Password handling decision (critical)

The child is **unauthenticated** at submission time, so the password cannot be
held anywhere in Firestore. We reuse the only approved secure mechanism already
in the codebase: **Firebase Auth itself**.

At submission the backend creates the synthetic Auth user
(`generateSyntheticEmail(familyId, normalizedUsername)`) with the supplied
password and:

* `disabled: true`
* **no custom claims** (so the account cannot mint a usable session),
* **no** Firestore profile, membership, or claim link.

Firebase Auth stores only a salted hash. The plaintext password exists solely
for the duration of the callable invocation. Nothing is written to Firestore,
logs, analytics or error payloads.

On approval the same Auth uid is enabled and linked — this is exactly the
identity-link invariant used by `createChildLoginImpl`.
On rejection / expiry / cancellation the Auth user is deleted.

## 3. Data model

### `families/{familyId}/child_join_requests/{requestId}` (parent-readable projection)

Contains **no** family code, **no** credential material.

| Field | Type | Notes |
| --- | --- | --- |
| `requestId` | string | doc id (random 20-char) |
| `familyId` | string | server-set |
| `normalizedUsername` | string | reservation key |
| `displayUsername` | string | as typed (trimmed) |
| `status` | `pending \| approved \| rejected \| expired \| cancelled` | |
| `createdAt` | Timestamp | server |
| `expiresAt` | Timestamp | `createdAt + 7 days` |
| `resolvedAt` | Timestamp \| null | |
| `resolvedBy` | string \| null | approving/rejecting parent uid |
| `childId` | string \| null | set on approval only |

Rules: `allow read: if isParent(familyId)`; `write: if false` (server-only).

### `families/{familyId}/childJoinSecrets/{requestId}` (server-only, `read, write: if false`)

| Field | Notes |
| --- | --- |
| `pendingAuthUid` | Auth uid created disabled at submission |
| `syntheticEmail` | never leaves the server |
| `requestSecretHash` | SHA-256 of the one-time secret handed to the child |
| `familyId`, `normalizedUsername`, `expiresAtMs` | |

### `childJoinRequestLookup/{requestId}` (root, server-only)

Maps an opaque `requestId` → `familyId` so the unauthenticated child can poll
status/cancel without ever learning or transmitting the family code again.

### Reservation

`families/{familyId}/childLoginIndex/{normalizedUsername}` gains
`{ reservedByRequestId, status: 'reserved' }` while pending; approval rewrites it
to the canonical `{ childId, normalizedUsername }` form; rejection / expiry /
cancellation deletes it **only if** `reservedByRequestId` still matches.

### Rate limiting

`childJoinRateLimits/{sha256(familyCode)}` and `childJoinRateLimits/{ip}` —
15-minute window, 10 attempts, same transactional shape as
`enforceJoinRateLimit`.

### Indexes / cleanup

No composite index required (single-field `status` + `expiresAt` queries are
served by automatic single-field indexes; the scheduled purge uses
`collectionGroup('child_join_requests').where('status','==','pending').where('expiresAt','<=',now)`
which needs one composite index — added to `firestore.indexes.json`).
A scheduled function `purgeExpiredChildJoinRequests` (hourly) expires stale
requests, deletes the disabled Auth user, and releases reservations.

## 4. Server operations (`functions/src/childJoinRequest.ts`)

| Callable | Auth | Purpose |
| --- | --- | --- |
| `submitChildJoinRequest` | unauthenticated | validate → rate-limit → resolve family → reserve username → create disabled Auth user → write request. Returns `{ requestId, requestSecret, username, status, expiresAt }`. Generic `JOIN_REQUEST_FAILED` for every resolution failure. |
| `getChildJoinRequestStatus` | unauthenticated + `requestSecret` | returns `{ status, username, expiresAt }` only. |
| `cancelChildJoinRequest` | unauthenticated + `requestSecret` | pending → cancelled, releases reservation, deletes Auth user. |
| `approveChildJoinRequest` | parent/owner of target family | transactional; creates managed child + claims + login records. |
| `rejectChildJoinRequest` | parent/owner of target family | transactional; releases reservation, deletes Auth user. |
| `purgeExpiredChildJoinRequests` | scheduler | hourly expiry sweep. |

**Expiry period: 7 days**, matching the project's other user-facing grace
windows and long enough for a parent who checks the app weekly.

**Cancellation is supported** via the one-time `requestSecret` (returned once,
held only in `sessionStorage`, compared against a stored SHA-256 hash). This
adds no read surface and no weakening of the security model.

## 5. Client

* `src/lib/childJoinApi.ts` — callable wrappers + error mapping + secret storage.
* `src/pages/JoinFamily.tsx` — real submission, `Request sent` pending screen,
  `Refresh status`, approved / rejected / expired / cancelled states.
* `src/lib/bootstrapQueries.ts` + `useStore` — parent-only
  `childJoinRequests` subscription.
* `ApprovalCenter` — `child_join` category card with Approve / Reject.
* i18n: full EN + TR copy in `auth.json` and `approvals.json`.

## 6. Commit sequence

1. `test(auth): define child join request security behaviour`
2. `feat(auth): add secure child join request backend`
3. `feat(auth): connect child join status flow`
4. `feat(approvals): add parent child-join approval`
5. `test(auth): add child join emulator regressions`
