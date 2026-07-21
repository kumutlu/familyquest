# Parent-Created Child Login — Architecture Analysis & Recommended Design

> Read-only analysis. No code was modified, committed, or deployed.
> Scope: how a parent creates login credentials (family code + username + password)
> for a child with no email, and how the child signs in on their own tablet.

---

## 1. Current Architecture (as built)

### 1.1 How parents currently sign in
- Parents register with **email + password** via [`signUp()`](src/lib/api.ts:75) or **Google** via [`signInWithGoogle()`](src/lib/api.ts:96).
- [`Login.tsx`](src/pages/Login.tsx) only offers email/password and Google; there is **no username/family-code path**.
- On first auth, a `users/{uid}` doc is created with `role: 'parent'` (hard-coded default in [`signUp()`](src/lib/api.ts:80) and [`signInWithGoogle()`](src/lib/api.ts:107)).
- [`Signup.tsx`](src/pages/Signup.tsx) is explicitly a "Create Parent Account" screen.

### 1.2 How children currently join / sign in
There are **two distinct child models** today, and neither gives a child an independent login:

1. **Managed members** (the dominant model for young children) — created by a parent during onboarding via [`createManagedMember()`](src/lib/api.ts:328). This writes a `users/{docId}` doc with `isManaged: true`, `familyId`, `role`, `displayName`, and a wallet doc. **The `uid` field is just the Firestore doc id, NOT a Firebase Auth UID.** These children share the parent's device and have no credentials.
2. **Join-request members** — a person with their *own* Google/email Auth account uses an **invite code** via [`requestToJoinFamily()`](src/lib/api.ts:238), the owner approves via [`approveJoinRequest()`](src/lib/api.ts:256), and their real Auth `uid` becomes the `users/{uid}` doc id. This is for co-parents/older children who already have an email.

There is also a **claim-code** flow ([`generateClaimCode()`](src/lib/api.ts:357) / [`submitClaimRequest()`](src/lib/api.ts:373)) intended to link a managed member to a real account, but see §1.7 — it is currently non-functional under deployed rules.

### 1.3 Do child profiles have Auth UIDs?
- **Managed children: NO.** Their `uid` is a synthetic doc id, not a Firebase Auth user. They cannot authenticate.
- **Join-request children: YES** (real Auth `uid`).
- The new feature must give managed children real Auth accounts without disturbing their existing `users/{docId}` profile, wallet, points, or task ownership (see §8 Migration).

### 1.4 How `familyId`, `role`, and `childId` are resolved
- All three live in the `users/{uid}` document.
- The client bootstrap ([`onAuthStateChanged`](src/store/useStore.ts:223) → profile read at [`useStore.ts:274`](src/store/useStore.ts:274)) reads `users/{auth.uid}`, sets `currentUser.id = profileSnapshot.id` ([`useStore.ts:291`](src/store/useStore.ts:291)), and `currentUser.familyId`/`role` from that doc.
- Firestore Rules resolve authorization by reading the caller's user doc on every request: [`isParent()`](firestore.rules:18), [`isOwner()`](firestore.rules:11), [`isFamilyMember()`](firestore.rules:32), [`isChildInFamily()`](firestore.rules:25). `childId` in subcollections is the `users` doc id.
- **No custom claims are used anywhere.** Role is purely a Firestore document field.

### 1.5 Where custom claims are assigned
- **Nowhere.** A repo-wide search for `setCustomUserClaims` / `customClaims` / `getIdTokenResult` returned no backend usage. The only `getIdToken()` call is a token refresh in the store ([`useStore.ts:271`](src/store/useStore.ts:271)).
- This is a key gap: the recommended model introduces `role`, `familyId`, and `childId` as **custom claims** (see §2).

### 1.6 Cloud Functions
- Only two triggers exist in [`functions/src/index.ts`](functions/src/index.ts): `onNotificationCreated` (push delivery) and `onUserWritten` (push-token cleanup). **No auth, account-provisioning, or lookup functions exist.**
- There are **no HTTPS callable functions** anywhere in the repo (search for `onCall`/`httpsCallable` returned 0 results). The trusted backend must be built from scratch.

### 1.7 Firestore Rules — relevant gaps
- `users/{uid}` read rule ([`firestore.rules:1452`](firestore.rules:1452)) allows any authenticated user in the same family to read a member — fine for parents, but a child login must not be able to read other children's `username`/`authUid` mapping.
- The **`claim_codes` collection has NO rule** (search returned 0 matches). Under deployed rules the default is **deny**, so [`generateClaimCode()`](src/lib/api.ts:357) and [`submitClaimRequest()`](src/lib/api.ts:373) would fail. This is a latent bug and a reason to replace the claim-code approach with callable functions.
- Invite codes are weak: [`createFamilyAndParent()`](src/lib/api.ts:218) generates a 6-char base36 string (`Math.random().toString(36).substring(2,8)`), and [`requestToJoinFamily()`](src/lib/api.ts:240) queries `where('inviteCode','==', code)` — **enumerable** by any authenticated client.
- A useful existing primitive: the [`idempotency`](firestore.rules:1684) collection with [`isValidIdempotencyOperation()`](firestore.rules:1438) — we can reuse this pattern for replay protection on the new callables.

### 1.8 Parent Family / member management UI
- [`Onboarding.tsx`](src/pages/Onboarding.tsx) calls [`createManagedMember()`](src/pages/Onboarding.tsx:50) to add children (no credentials).
- [`Family.tsx`](src/pages/Family.tsx) lists members and shows a "Managed" badge for `member.isManaged` ([`Family.tsx:227`](src/pages/Family.tsx:227)).
- [`EditMemberModal.tsx`](src/components/family/EditMemberModal.tsx) lets a parent edit display name / avatar only — **no login management**.
- There is currently **no UI** to create a username/password for a managed child.

---

## 2. Recommended Authentication Model

Use a **trusted backend** (Firebase HTTPS Callable Functions with the Admin SDK). The client never touches Auth user creation, email synthesis, or claims.

### 2.1 Preferred flow
Parent (authenticated, `role ∈ {owner, parent}`) calls:

```
createChildLogin({ childId, username, password })
```

### 2.2 Backend responsibilities (all server-side, Admin SDK)
1. **Authenticate & authorize caller** — verify `request.auth` exists and the caller's `users/{uid}` has `familyId` and `role ∈ {owner, parent}` (reuse the same logic as `isParent`).
2. **Verify child belongs to same family** — load `users/{childId}`; assert `data.familyId === caller.familyId` and `data.role === 'child'`. Reject otherwise (prevents cross-family account creation — §5).
3. **Normalize username** — `toLowerCase().trim()`, allow `[a-z0-9_.-]` only, length 3–20. Reject invalid.
4. **Enforce uniqueness within the family** — check the `child_logins` (username index) collection for `{familyId, username}`; reject duplicates. (Uniqueness is scoped to the family, not global, so two families can both have "emma".)
5. **Generate a synthetic internal email** — e.g. `${familyId}.${username}@child.familyquest.app`. This is **server-only** and never returned to the client.
6. **Create or link the Firebase Auth user** — `admin.auth().createUser({ email, password, emailVerified: false, displayName })`. If a login already exists for this child, link instead of create (idempotency — §5).
7. **Assign custom claims** — `admin.auth().setCustomUserClaims(uid, { role: 'child', familyId, childId })`.
8. **Link `authUid` to the child profile** — write `authUid`, `username`, `loginEnabled: true`, `loginCreatedAt` onto `users/{childId}` (server-only fields).
9. **Write an immutable audit record** — `audit/child_login_events/{autoId}` (see §6).
10. **Never return the synthetic email** — response contains only `{ ok: true, username, requiresPasswordChange }`.

### 2.3 Why custom claims
Moving `role`/`familyId`/`childId` into claims lets Firestore Rules authorize with `request.auth.token.role` instead of a `get()` per request, reducing reads and closing the window where a stale doc could disagree with auth state. The doc remains the source of truth for display/ownership; claims are a fast, tamper-resistant mirror.

---

## 3. Child Login Resolution (family code + username + password)

### 3.1 Problem
The child UI has only **family code, username, password**. The Firebase Auth `signInWithEmailAndPassword` needs an *email*. We must resolve `(familyCode, username) → syntheticEmail` **without** letting unauthenticated clients enumerate families or usernames.

### 3.2 Recommended: non-enumerable callable `resolveChildLogin`
```
resolveChildLogin({ familyCode, username }) -> { email }   // returns ONLY the email
```
Server steps:
1. Validate `familyCode` format; load `families` where `familyCode === code` (server-side query, not client-enumerable). If not found → generic error.
2. Normalize `username`; look up `child_logins` where `familyId === family.familyId && username === username`. If not found → generic error.
3. Return the synthetic `email` **only**. The client then calls standard `signInWithEmailAndPassword(email, password)`.

### 3.3 Why this is safe
- The lookup is behind an authenticated-or-anonymous **callable with strict rate limiting** and **generic errors** ("Invalid family code or username"). It never reveals whether a family code or username exists, nor lists members.
- The `child_logins` / `users` collections are **not** readable by unauthenticated clients (rules: `allow read: if false` for the login mapping; family doc read restricted to members). The client cannot run arbitrary `where('username','==', x)` queries.
- Family code is a **separate, higher-entropy secret** (see §5) distinct from the legacy 6-char `inviteCode`, and is not the same as the family doc id.

### 3.4 Alternative (no email leaves backend at all)
For maximum privacy, the callable could itself perform the sign-in using Admin SDK + create a custom token or session, but Firebase Auth client SDK sign-in is simpler and keeps password verification in Auth. Returning only the synthesized email to the client is acceptable because the email is non-guessable and meaningless outside Auth.

---

## 4. Account Lifecycle

All operations are Admin-SDK callables invoked by an authorized parent (or the child themselves for password change where allowed).

| Operation | Callable | Notes |
|---|---|---|
| **Create login** | `createChildLogin({childId, username, password})` | §2.2. Idempotent per child. |
| **Reset password** | `resetChildPassword({childId, newPassword, requireChange})` | Parent-initiated; sets `password` + `requiresPasswordChange`. Optionally force email-less reset via Admin `updateUser`. |
| **Change username** | `changeChildUsername({childId, newUsername})` | Re-normalize, re-check family-scoped uniqueness, update synthetic email + `child_logins` index (delete old, write new atomically). |
| **Disable login** | `setChildLoginEnabled({childId, enabled:false})` | `admin.auth().updateUser(uid,{disabled:true})` + `loginEnabled:false` on profile. Revokes sessions (see below). |
| **Re-enable login** | `setChildLoginEnabled({childId, enabled:true})` | Re-enable Auth user; keep same `authUid`/username. |
| **Revoke all sessions** | `revokeChildSessions({childId})` | `admin.auth().revokeRefreshTokens(uid)`; also bump a `tokenVersion` claim so existing ID tokens are rejected by rules. |
| **First-login password change** | client `updatePassword` + callable `clearPasswordChangeFlag({childId})` | If `requiresPasswordChange`, child must change before app use. |
| **Delete / unlink** | `unlinkChildLogin({childId})` | `admin.auth().deleteUser(uid)`; clear `authUid`/`username`/`loginEnabled` on profile; mark `child_logins` entry `status: 'unlinked'` (immutable history retained). **Do not delete the `users` profile, wallet, or task ownership.** |

---

## 5. Security Risks (Threat Model)

| # | Risk | Current state | Mitigation in design |
|---|---|---|---|
| 1 | **Username enumeration** | N/A today | `resolveChildLogin` returns identical generic error for bad family code *or* bad username; strict rate limit; no list queries exposed to clients. |
| 2 | **Family-code brute force** | Legacy `inviteCode` is 6-char base36 (~2×10⁹) and enumerable via client query. | New `familyCode` = 12+ char URL-safe random (CSPRNG) stored on family doc; lookup only via rate-limited callable; lockout after N failures per IP/code. |
| 3 | **Weak child passwords** | N/A | Enforce minimum length (≥8) + zxcvbn-style strength check server-side; reject common passwords; parent-set or generated. |
| 4 | **Parent creates account for another family** | N/A | Backend asserts `child.familyId === caller.familyId` before any write (§2.2.2). |
| 5 | **Role escalation** | Role is doc-only; a malicious client could try writing `role:'owner'`. | Rules already restrict `role` writes ([`firestore.rules`](firestore.rules:1452)); with claims, `role` is also set by Admin only and rules can prefer `request.auth.token.role`. Client can never set claims. |
| 6 | **Duplicate Auth users** | N/A | `child_logins` uniqueness + idempotency key `{familyId}:{childId}`; if login exists, link, don't create. |
| 7 | **Replay / idempotency** | Existing `idempotency` collection pattern ([`firestore.rules:1684`](firestore.rules:1684)). | Reuse: each callable accepts/derives an idempotency key; duplicate calls return original result, no double side-effects. |
| 8 | **One Auth UID linked to multiple children** | N/A | `authUid` is written only on `users/{childId}`; the `child_logins` doc is keyed by `childId` (1:1). Linking asserts no existing `authUid` on the profile. |
| 9 | **Disabled / deleted child profiles** | N/A | `resolveChildLogin` checks `loginEnabled` and profile `status !== 'deleted'`; disabled Auth user + `loginEnabled:false` both block sign-in. |
| 10 | **Custom-claims refresh** | N/A (no claims today) | After `setCustomUserClaims`, force `revokeRefreshTokens` so the next `getIdToken(true)` picks up new claims; client already calls `getIdToken()` on auth ([`useStore.ts:271`](src/store/useStore.ts:271)). |
| 11 | **Rate limiting** | None on join/claim. | Callable layer: per-caller and per-family quotas; Google Cloud Armor / Firebase App Check on callables; exponential backoff messaging via [`mapAuthErrorMessage`](src/lib/api.ts:187) pattern. |
| 12 | **Audit history** | None for logins. | Immutable `audit/child_login_events` written by every lifecycle op (§6); append-only, server-only. |

---

## 6. Data Model

### 6.1 Child profile — `users/{childId}` (existing doc, extended)
| Field | Visibility | Mutability | Notes |
|---|---|---|---|
| `uid` | client-readable | immutable | existing doc id |
| `familyId` | client-readable | immutable | existing |
| `role` | client-readable | immutable (server-enforced) | `'child'` |
| `displayName` | client-readable | parent-editable | existing |
| `authUid` | **server-only** | immutable once set | links to Firebase Auth user |
| `username` | **server-only** (do not expose to other members) | server-only update | normalized |
| `loginEnabled` | **server-only** | server-only | boolean |
| `requiresPasswordChange` | **server-only** | server-only | first-login flag |
| `loginCreatedAt` | **server-only** | immutable | |
| `status` | client-readable | server-only | `'active' \| 'deleted'` |

> The `username`/`authUid` must NOT be readable by other family members (a child should not see siblings' usernames). Tighten the `users/{uid}` read rule so non-owners cannot read the `username`/`authUid` fields (use a field-filtered read or a separate mapping collection).

### 6.2 Child login mapping — `families/{familyId}/child_logins/{loginId}`
| Field | Visibility | Mutability | Notes |
|---|---|---|---|
| `childId` | **server-only** | immutable | 1:1 with profile |
| `username` | **server-only** | immutable (rewrite on change) | normalized, family-unique |
| `familyId` | **server-only** | immutable | denormalized for query |
| `authUid` | **server-only** | immutable | Firebase Auth uid |
| `status` | **server-only** | server-only | `'active' \| 'disabled' \| 'unlinked'` |
| `createdAt` | **server-only** | immutable | |
| `createdBy` | **server-only** | immutable | parent uid |

> This is the **username index** used by `resolveChildLogin`. `allow read/write: if false` for clients; only the backend reads/writes it. Uniqueness enforced by a composite `familyId+username` query or a doc id of `familyId:username`.

### 6.3 Username index (alternative keying)
Use doc id `child_logins/{familyId.toLowerCase()}::${username.toLowerCase()}` so uniqueness is atomic and the lookup is O(1). Contents same as §6.2.

### 6.4 Audit records — `audit/child_login_events/{autoId}` (top-level, server-only)
| Field | Visibility | Mutability | Notes |
|---|---|---|---|
| `familyId` | **server-only** | immutable | |
| `childId` | **server-only** | immutable | |
| `actorUid` | **server-only** | immutable | parent who acted (or 'system'/'child') |
| `action` | **server-only** | immutable | `create \| reset_password \| change_username \| disable \| enable \| revoke_sessions \| unlink` |
| `details` | **server-only** | immutable | e.g. old→new username, `requiresPasswordChange` |
| `idempotencyKey` | **server-only** | immutable | dedup |
| `timestamp` | **server-only** | immutable | `serverTimestamp()` |

> `allow read, write: if false` for all clients. Readable only by Admin/backend and (optionally) owners via a separate owner-scoped view callable.

---

## 7. UX

### 7.1 Parent
- **Create login** — In the member management UI (extend [`Family.tsx`](src/pages/Family.tsx) / [`EditMemberModal.tsx`](src/components/family/EditMemberModal.tsx)), for a `role==='child'` member show a "Create login" action → modal with username + password (with strength meter) → calls `createChildLogin`.
- **Display username** — show the chosen username (read from a parent-scoped callable, never from the `users` doc directly).
- **Password confirmation / reset** — "Reset password" action → `resetChildPassword` → show a one-time generated password or let parent set one; offer "require change on next login".
- **Disable access** — toggle → `setChildLoginEnabled(false)` + revoke sessions; show "Disabled" status.
- **Login status** — badge: `No login` / `Active` / `Disabled` / `Needs password change`.

### 7.2 Child
- **Family code + username + password** screen — new [`Login.tsx`](src/pages/Login.tsx) variant (or a `ChildLogin` page) with three fields, no email.
- **Friendly errors** — reuse [`mapAuthErrorMessage()`](src/lib/api.ts:187) style: "We couldn't find that family code or username", "Incorrect password", "This login has been disabled". Never reveal which field was wrong.
- **First-login password change** — if `requiresPasswordChange`, force a password-change step before entering the app.

---

## 8. Migration (existing child profiles without Auth)

Goal: give managed children logins **without** creating duplicate `users` records or disturbing wallet/points/task ownership.

1. **Identify candidates** — `users` docs with `role==='child'`, `isManaged===true`, and no `authUid`. These already own wallets, tasks, completions, goals (all keyed by the same `users` doc id = `childId`).
2. **Do NOT create a new `users` doc.** Reuse the existing doc as the profile. The new Auth user's `uid` becomes the `authUid` field; the doc id remains the `childId` used everywhere in subcollections.
3. **Backfill username** — if the parent hasn't chosen one, default to a normalized `displayName` (e.g. `emma.smith`) and let them rename via `changeChildUsername`. Ensure family-scoped uniqueness; on collision append a number.
4. **Synthetic email** — derived from `familyId + username`; no collision with existing parent emails (different domain/format).
5. **Claims** — set `role:'child'`, `familyId`, `childId` (= doc id) as custom claims so all existing ownership queries (which use `childId`/`request.auth.uid`) keep working. Note: today child actions are authorized via `isChildInFamily` using the doc, so adding claims is additive and safe.
6. **No balance/points change** — we only add `authUid`/`username`/`loginEnabled` fields; wallet, `rewardPoints`, `lifetimeXP`, task assignments are untouched.
7. **Audit** — write a `create` audit event with `actorUid: 'migration'` for traceability.
8. **Rollout** — migrate per-family behind a flag; existing shared-device usage (parent-signed-in) continues to work because the profile doc is unchanged.

---

## 9. Small Implementation Phases

- **Phase 1 — Backend account creation + tests**
  - Add `functions/src/childAuth.ts` with `createChildLogin`, `resolveChildLogin` callables (Admin SDK).
  - Enforce authz, family-scoped uniqueness, normalization, synthetic email, custom claims, `child_logins` write, immutable audit.
  - Unit + emulator tests for: cross-family rejection, duplicate username, idempotency, no email leakage.
  - Add `audit/child_login_events` + `child_logins` rules (`allow read,write: if false`).

- **Phase 2 — Parent "Create Login" UI**
  - Extend [`Family.tsx`](src/pages/Family.tsx) / [`EditMemberModal.tsx`](src/components/family/EditMemberModal.tsx) with create-login modal, username/password strength, status badge.
  - Parent-scoped callable to read login status/username (server-only fields).

- **Phase 3 — Child username login screen**
  - New child login route: family code + username + password → `resolveChildLogin` → `signInWithEmailAndPassword`.
  - Friendly errors via [`mapAuthErrorMessage`](src/lib/api.ts:187) pattern; first-login password change flow.

- **Phase 4 — Reset / disable / session revocation**
  - `resetChildPassword`, `setChildLoginEnabled`, `revokeChildSessions`, `changeChildUsername`, `unlinkChildLogin` callables + parent UI controls.
  - `revokeRefreshTokens` + `tokenVersion` claim bump.

- **Phase 5 — Production migration & smoke tests**
  - Backfill script for existing managed children (§8) using Admin SDK.
  - End-to-end smoke tests: create → child login → disable → re-enable → reset → unlink.
  - Enable App Check + rate limiting on callables; verify no `username`/`authUid` leakage in `users` reads.

---

## Deliverables Summary
- **Findings:** Parents use email/Google; children are managed (no Auth UID) or join-request (real Auth). No custom claims, no callable functions, `claim_codes` has no rule (broken), invite codes are weak/enumerable.
- **Recommended architecture:** Admin-SDK HTTPS callables (`createChildLogin`, `resolveChildLogin`, lifecycle ops); synthetic server-only emails; `role`/`familyId`/`childId` as custom claims; non-enumerable login resolution.
- **Data model:** extended `users` profile (server-only `authUid`/`username`/`loginEnabled`), `child_logins` mapping (username index, server-only), immutable `audit/child_login_events`.
- **Threat model:** 12 risks mapped with mitigations (enumeration, brute force, weak passwords, cross-family, escalation, duplicates, replay, multi-link, disabled profiles, claims refresh, rate limiting, audit).
- **Phased plan:** 5 narrow phases from backend+tests through production migration.
