# Parent Invite + Onboarding Design

**Status:** Approved for implementation planning
**Date:** 2026-08-25
**Production recovery baseline:** `c64c97a3d76c9a139dbdc49f935a02c5616c75cd`

## 1. Problem statement / production incident

An existing parent used Settings → Family → Members → Add parent to invite her husband. That surface exposed the reusable family code and instructed the recipient to sign up normally. The recipient authenticated with Google, but no parent-invitation intent existed for the application to resume. The new Google profile therefore had the normal default `parent` role and no `familyId`; global routing sent it into creation onboarding. Post-auth onboarding then automatically created a new family. Production recovery was required to remove that accidental family and restore the intended account state.

The defect is architectural rather than a single missing redirect. The repository currently has two adult invitation experiences: Family Hub creates a server-owned six-character role-bound invitation, while Settings still exposes `families/{familyId}.inviteCode`. Auth routing treats every authenticated no-family account alike, creation onboarding does not require a fresh explicit Create Family choice, and a valid legacy invitation acceptance only creates a pending approval request before routing the still-no-family recipient back toward onboarding.

## 2. Goals

- Make a private, high-entropy, server-authoritative parent/adult invitation link the canonical adult join path.
- Preserve invitation intent through Google popup, Google redirect, email signup/login, refresh, browser restart, PWA/service-worker reload, and Signup → Login switching.
- Grant v2 parent/adult membership immediately after explicit recipient confirmation, without a second owner approval.
- Derive `familyId` and role exclusively from server records.
- Ensure Google authentication alone can never create a family.
- Require a visible, explicit Create Family choice before creation onboarding can perform any family write.
- Give authenticated no-family users without an invite a Create/Join choice.
- Preserve all existing child join, managed-child, and child login behavior.
- Support existing six-character role-bound invitations for no longer than their existing seven-day lifetime.
- Provide safe expiry, revocation, idempotency, conflict handling, observability, deployment, and rollback.

## 3. Explicit non-goals

- Supporting multiple simultaneous family memberships for one account.
- Email-binding invitations.
- Inviting or transferring the `owner` role.
- Replacing the family code used by child/manual join and managed-child login.
- Redesigning child approval, claiming, login, or password-change flows.
- Automatically migrating production families, memberships, or pending legacy join requests.
- Building a scheduler to mark invitations expired; expiry is derived from `expiresAt`.
- General auth-provider redesign beyond the errors and return-intent behavior required here.
- Removing legacy invitation records before their compatibility window ends.

## 4. Approved product decisions

1. A valid v2 parent/adult invitation grants membership immediately after recipient confirmation.
2. Only the family owner may create or revoke parent/adult invitations.
3. `parent` and `adult` remain distinct roles; Parent is the P0 default.
4. An account belongs to at most one family.
5. Invitations are not email-bound.
6. New invitations use at least 128 bits of cryptographic randomness, are single-use, expire after seven days, are revocable, store only a SHA-256 token hash, and never store the raw bearer token.
7. Existing six-character role-bound invitation links are supported only through their current seven-day TTL. `families.inviteCode` remains child/manual-only and never grants adult authority.
8. Google authentication success never creates a family.
9. Family creation starts only after an explicit user action.
10. Routing priority is pending invite, valid existing membership, pending/recovery membership state, no-family choice, then explicitly selected creation onboarding.
11. Settings and Family Hub use one canonical v2 owner invitation component and API.
12. Onboarding must stop building a parent link from `familyData.inviteCode`.
13. Membership authority is server-derived; the client never assigns family or role.
14. Acceptance is atomic, server-authoritative, and idempotent.
15. Same-family recipients receive harmless already-member success; other-family recipients receive a conflict.
16. The URL token is the source of truth; storage contains only minimal untrusted resume intent.
17. Raw Firebase errors never render to users.

## 5. Current architecture and defects

### Current routes and auth

- `/` is protected by `AppLayout`; logged-out root traffic is redirected to `/onboarding`.
- `/login`, `/signup`, `/join-family`, `/join`, and `/onboarding` are public routes.
- Email and Google signup create `users/{uid}` with `role: "parent"` and no `familyId`.
- `AppLayout` routes every authenticated profile without `familyId` to `/onboarding`.
- `OnboardingFlow` advances a no-family authenticated draft into `p1`.
- `FamilyComposition` automatically calls `createFamilyAndParent` from an effect when `p1` renders.

### Current invitation primitives

- `createFamilyInvitation`, `previewInvitation`, and `acceptInvitation` use server-owned `families/{familyId}/invitations/{sixCharacterCode}` records.
- The role is stored on the invitation and cannot be changed by the client.
- Acceptance consumes the invitation but creates a pending `join_requests/{uid}` record; owner approval later performs membership writes.
- Pending invite persistence uses `queki.pendingInviteCode` in session and local storage.
- `/join?code=...` is the current legacy role-bound link.

### Defects to remove

- Settings Add parent exposes only `families.inviteCode` and no real adult invitation.
- Family Hub and Settings do not share one invitation implementation.
- The reusable family code is ambiguous and has no adult role authority.
- The authenticated no-family route has no Create/Join choice.
- Creation onboarding can resume a stale draft and create a family without a fresh explicit choice.
- Google success can indirectly trigger family creation by advancing the draft.
- Login/Signup generate or receive return parameters inconsistently and rely primarily on Web Storage.
- Login/Signup render raw Firebase `err.message` values.
- Current six-character invitation codes are not high-entropy bearer credentials.
- Preview has no invitation-specific abuse limit and App Check is not enforced.
- Invitation creation, preview, and acceptance do not consistently reject deleting families.
- Revocation is represented in data but has no owner callable/UI.
- Valid legacy acceptance leaves the recipient with no membership and can route them into creation onboarding.
- `FamilyComposition` calls `buildJoinUrl(familyData.inviteCode)`, producing a URL that the role-invitation preview cannot normally resolve.

## 6. Target architecture

### Server boundary

New v2 invitation callables own the complete adult invitation lifecycle. A raw token is returned once to the authorized owner; the server stores only its SHA-256 hash. Preview performs a minimal, rate-limited lookup. Acceptance runs one transaction that validates the bearer credential, family lifecycle, recipient profile, and conflicting membership; derives the role; writes canonical membership/profile state; consumes the invitation; and records idempotency/audit data.

V2 acceptance does **not** create or use the legacy pending join-request approval path. Legacy six-character invitation acceptance continues its existing pending-request behavior only during the compatibility window. Existing pending legacy requests remain reviewable.

### Client boundary

The canonical route is `/invite/:token`. It captures the token before generic auth/onboarding routing and stores only a minimal resume envelope. The invite route owns preview, invite-aware authentication actions, authenticated confirmation, acceptance, terminal errors, and cleanup. A focused `AuthRoutingGate` establishes global priority without expanding `AppLayout` conditionals.

### Creation boundary

Authenticated no-family users with no pending/recovery state render `/no-family`, containing Create a family and Join an existing family. Create writes an explicit, short-lived `create-family` intent and then enters creation onboarding. `FamilyComposition` may retain its idempotent setup effect, but that effect is inert unless the explicit creation intent is present and bound to the authenticated UID.

## 7. Invitation v2 data model

### Authoritative record

Path:

```text
familyInvitations/{sha256(rawToken)}
```

Shape:

```ts
type AdultInvitationV2 = {
  version: 2
  familyId: string
  intendedRole: 'parent' | 'adult'
  status: 'active' | 'accepted' | 'revoked'
  createdBy: string
  createdAt: FirebaseFirestore.Timestamp
  expiresAt: FirebaseFirestore.Timestamp
  acceptedBy?: string
  acceptedAt?: FirebaseFirestore.Timestamp
  revokedBy?: string
  revokedAt?: FirebaseFirestore.Timestamp
  clientReqId: string
}
```

Expiry is always computed as `expiresAt <= now`; no stored `expired` status or scheduler is required.

### Token contract

- Generate 32 random bytes with Node `crypto.randomBytes(32)`, providing 256 bits of entropy and exceeding the 128-bit minimum.
- Encode with unpadded base64url.
- Validate the encoded syntax and decoded byte length before hashing.
- Compute `sha256(rawToken)` server-side and use its lowercase hexadecimal digest as the document ID.
- Return the raw token only from the first successful creation response.
- Because idempotent replay cannot recover a raw token from a hash-only invitation record, the server stores the raw token only in a separately protected, short-lived creation-idempotency record encrypted at rest or, preferably for P0, treats a replay after the first successful response as `INVITATION_ALREADY_CREATED` and lets the owner generate a replacement. The selected P0 contract is the latter: a repeated `clientReqId` returns the original safe `invitationId` and expiry but does not return a token again. The client must retain the first successful response in memory long enough to share/copy it.
- No token, token prefix, email, display name, family name, or preview payload appears in logs.

### Safe identifier

`invitationId` is the SHA-256 document ID. It is returned to the owner on creation and used for revocation. It is not sufficient to accept or preview an invitation because those callables require the raw token.

## 8. Server API contracts

All callables use region `europe-west1`. Inputs reject unknown/invalid values. Error details expose stable reason codes, never internal record contents.

### `createAdultInvitation`

```ts
createAdultInvitation({
  intendedRole: 'parent' | 'adult',
  clientReqId: string,
}) => {
  invitationId: string,
  token: string,
  intendedRole: 'parent' | 'adult',
  expiresAt: string, // ISO-8601 UTC
}
```

- Authentication required.
- Caller profile must be active owner of an active family.
- `owner` and `child` are rejected.
- Creates exactly one v2 record.
- A replayed `clientReqId` never mints a second invitation; because raw tokens are not stored, it returns `INVITATION_ALREADY_CREATED` with safe invitation metadata rather than the raw token.

### `previewAdultInvitation`

```ts
previewAdultInvitation({ token: string }) => {
  familyDisplayName: string,
  intendedRole: 'parent' | 'adult',
  expiresAt: string,
  status: 'active',
}
```

- Authentication is not required.
- Subject to an invitation-specific rate limit using hashed request/app identity where available; no raw token is stored in rate-limit records.
- Resolves only v2 token hashes.
- Rejects malformed, unknown, accepted, revoked, expired, deleted, or deleting-family invitations with categorized errors.
- Returns no `familyId`, owner identity, member list, or other family data.

### `acceptAdultInvitation`

```ts
acceptAdultInvitation({
  token: string,
  clientReqId: string,
}) => {
  result: 'joined' | 'already_member',
  familyId: string,
  role: 'parent' | 'adult',
  destination: '/',
}
```

- Authentication required.
- Revalidates the token and family inside the acceptance transaction.
- Requires an existing minimally complete user profile.
- Same-family active member returns `already_member` and may consume an active invitation for that same account.
- Other-family member returns `ALREADY_IN_ANOTHER_FAMILY` without changing either family or invitation.
- Derives role and family only from the invitation.
- Atomically writes:
  - `users/{uid}.familyId`, `role`, `lifecycle: 'active'`, and acceptance audit fields;
  - `families/{familyId}/users/{uid}` canonical membership projection;
  - invitation `status: 'accepted'`, `acceptedBy`, and `acceptedAt`;
  - `adultInvitationAcceptanceIdempotency/{uid}_{clientReqId}`;
  - a sanitized family audit/feed event if the existing membership contract requires it.
- Same-user replay returns the original result. A different user cannot replay an accepted token.
- The client refreshes the ID token/profile after success before navigating.

### `revokeAdultInvitation`

```ts
revokeAdultInvitation({
  invitationId: string,
  clientReqId: string,
}) => { success: true }
```

- Authentication required.
- Caller must be the active family owner of the invitation family.
- Active invitation becomes revoked with `revokedBy` and `revokedAt`.
- Repeated owner revocation is idempotent.
- Accepted invitations cannot undo membership and return `INVITATION_ALREADY_ACCEPTED`.

### Legacy callables

Existing `createFamilyInvitation`, `previewInvitation`, and `acceptInvitation` remain temporarily available for already-issued six-character links. The frontend stops creating new adult invitations through them. Legacy acceptance continues creating a pending join request and never receives v2 immediate-acceptance semantics.

## 9. Client pending-intent contract

Create `src/auth/pendingInviteIntent.ts`:

```ts
type PendingInviteIntent = {
  version: 2
  token: string
  capturedAt: number
  authUid?: string
}
```

Storage key: `queki.pendingAdultInvite.v2`.

Contract:

- The route token is the source of truth and replaces an older stored token after user-visible validation.
- Write the envelope to session storage and mirror it to local storage for redirects/reloads.
- Treat all storage as untrusted: validate version, token syntax, freshness, and UID binding before use; always preview again server-side.
- Store no family ID/name, intended role, invitation ID, email, or preview result.
- Default local freshness is seven days from capture, bounded by the server expiry returned from preview.
- Bind `authUid` after successful authentication.
- If a different UID authenticates, show an account-mismatch choice before rebinding or clearing; never silently accept for the wrong account.
- Clear after joined/already-member success, explicit decline/leave, confirmed terminal invalid/expired/revoked/used state, or local staleness.
- Popup auth retains the current route and envelope.
- Redirect/email auth uses an internal validated return path plus the envelope; it does not rely on storage alone.
- Version or clear legacy `queki.pendingInviteCode` only after first checking whether it is a six-character legacy role invitation that should resume through `/join` during the compatibility window.

## 10. Auth/routing state machine

The focused `AuthRoutingGate` receives resolved auth/profile state and derives one route outcome:

```text
auth initializing/profile unresolved
  → bounded startup state

pending v2 or resumable legacy invite
  → canonical invite route

valid active family membership
  → requested app route/dashboard

pending/recovery membership state
  → dedicated pending or recovery route

authenticated, no family, no invite
  → /no-family

explicit create-family intent bound to current uid
  → /onboarding?mode=create

unauthenticated root
  → public onboarding

unauthenticated protected route
  → /login with validated internal return path
```

Rules:

- Invite intent outranks the no-family choice and creation draft.
- Existing active membership outranks stale creation state.
- A stale/deleted `familyId` enters recovery rather than creation.
- A pending legacy join request enters a waiting state rather than creation.
- `OnboardingFlow` may render creation post-auth steps only when an explicit create intent is present and UID-bound.
- Google auth state changes profile/auth state only; they never set create intent or call family creation.
- Managed-child password-change and identity checks remain unchanged after membership resolution.

## 11. No-family choice flow

Route: `/no-family`.

Copy:

> What would you like to do?

- **Create a family** — records an explicit create intent bound to the current UID, clears incompatible stale creation drafts, and navigates to `/onboarding?mode=create`.
- **Join an existing family** — opens the authenticated manual adult join entry. In P0 this may accept a family code only to create the existing pending request without choosing a role; the owner assigns `parent` or `adult` through the legacy manual approval flow. A family code never immediately grants parent/adult membership.

No family document may be created merely by rendering this route, authenticating, refreshing, or selecting Join.

## 12. Parent/adult invite UX

### Owner creation

Settings and Family Hub render the same canonical component and owner-only authorization state:

> Invite another parent or adult
>
> Send this private link to the person you want to add. It expires in 7 days and can be used once.

Role selector:

- Parent (default)
- Adult

Actions:

- Create private invitation
- Share invitation
- Copy private link
- Revoke invitation, while the creating session still holds its safe invitation ID

The reusable family code appears only in a secondary child/manual section and is never described as a parent invitation.

### Recipient

Before auth, preview displays:

> You’ve been invited to join [Family Name]
>
> Role: Parent

Actions: Continue with Google, Continue with email, Leave invitation.

After auth, the same route revalidates and displays:

> Join [Family Name] as a parent?

Actions: Join family, Decline.

Join is the only action that invokes acceptance. On success, refresh profile/token and navigate to the returned destination.

### Onboarding family composition

“Invite another parent” uses the same `createAdultInvitation({ intendedRole: 'parent' })` primitive or opens the canonical component. It never calls `buildJoinUrl(familyData.inviteCode)`.

## 13. Error states

| Condition | Stable code | User behavior |
|---|---|---|
| Malformed/unknown token | `INVALID_INVITATION` | Explain invalid link; manual join or leave |
| Expired | `INVITATION_EXPIRED` | Ask for a new invitation; clear after acknowledgement |
| Revoked | `INVITATION_REVOKED` | Explain no longer active |
| Accepted by another account | `INVITATION_ALREADY_USED` | Explain already used |
| Same-family account | success `already_member` | Clear intent and open dashboard |
| Other-family account | `ALREADY_IN_ANOTHER_FAMILY` | Preserve both memberships; explain conflict |
| Family deleting/deleted | `FAMILY_UNAVAILABLE` | Do not reveal lifecycle details; leave invite flow |
| Incomplete profile | `PROFILE_REQUIRED` | Complete minimal profile inside invite journey |
| Preview rate limit | `TOO_MANY_ATTEMPTS` | Retry-later copy |
| Email already used | Firebase mapping | “This email already has an account. Sign in to continue your invitation.” |
| Invalid credential | Firebase mapping | Friendly sign-in mismatch copy |
| Popup closed | Firebase mapping | Keep invite and show cancellation copy |
| Different credential | Firebase mapping | Explain sign-in method without exposing raw error |
| V2 callable unavailable | client availability state | Retry; never fall back to family-code adult authority |

Raw Firebase error codes/messages are logged only through sanitized category mapping in development diagnostics and never rendered.

## 14. Security invariants

- Only an authenticated active family owner creates or revokes v2 invitations.
- Invitation records, idempotency records, rate limits, and membership projections are server-only to clients.
- Tokens contain at least 128 bits of cryptographic entropy; P0 uses 256 bits.
- Firestore stores only SHA-256 token hashes, never raw tokens or recoverable prefixes.
- Preview is minimal, unauthenticated, rate-limited, and revalidates family lifecycle.
- Acceptance is authenticated and revalidates every condition in one transaction.
- Client input cannot select `familyId`, `role`, owner status, lifecycle, or membership path.
- `owner` is never an invitation role.
- `families.inviteCode` cannot grant `parent` or `adult` authority.
- One account cannot gain a second family membership.
- Deleting/deleted families cannot create, preview, accept, or revoke active invitations except idempotent safe cleanup.
- Invitation consumption and membership writes are atomic.
- Same-user retries are idempotent; different-user replay fails.
- Stored pending intent is untrusted and never supplies display or authority fields.
- Logs and analytics contain no token, hash, email, display name, or family name.

## 15. Legacy compatibility / migration

### Compatibility window

- Already-issued `/join?code=<legacy-role-invitation>` links continue through the current legacy preview/accept callables for at most their original seven-day TTL.
- No new parent/adult UI calls `createFamilyInvitation` after frontend rollout.
- Legacy acceptance continues creating a pending owner-approval request. It does not receive v2 immediate membership semantics.
- Existing pending legacy join requests remain reviewable through the current approval UI/rules.
- After the maximum TTL plus an operational safety margin, remove legacy adult invitation creation and public preview/accept support in a later change.

### Family code

- `families.inviteCode` remains unchanged for child login/manual flows.
- An authenticated adult may use it only to create the existing role-less pending manual join request.
- Neither client nor server may translate it into immediate `parent` or `adult` authority.

### Storage migration

- New v2 intent uses `queki.pendingAdultInvite.v2`.
- Existing `queki.pendingInviteCode` is read only for a six-character legacy invitation resume and is cleared on terminal completion/expiry or after the compatibility window.
- Creation drafts are versioned or cleared when `/no-family` renders; they cannot create without a new UID-bound create intent.

### No production-data migration

Initial rollout is additive. Existing records remain readable by legacy functions, pending requests remain operable, and new v2 records use a separate collection. No batch production write is required.

## 16. Child-flow compatibility requirements

- `/join-family` continues the current child request flow with family code, username, password, status handle, and parent approval.
- Managed-child creation remains owner/parent scoped as currently defined.
- Managed-child custom-token login, claim, password reset, and mandatory password-change behavior remain unchanged.
- Child family-code login continues resolving `families.inviteCode`.
- The v2 role allowlist excludes `child` and `owner`.
- V2 changes do not modify child join secrets, request lookup, rate limits, reservations, or callable payloads.
- Regression tests prove both family-code child use and legacy pending request approval remain functional.

## 17. Observability / sanitized logging

Emit structured events with request correlation IDs and categorical outcomes:

- `invitation_created`
- `invitation_preview_failed` with reason category
- `invitation_accepted`
- `invitation_conflict`
- `invitation_expired`
- `invite_auth_resumed`
- `no_family_choice_rendered`
- `family_creation_explicitly_started`

Allowed fields: event name, invitation version, intended role, auth provider category, outcome category, callable latency bucket, build SHA, and a server-generated correlation ID.

Forbidden fields: raw token, token hash, invitation ID, email, display name, family name, full UID, family ID, credential details, or raw Firebase error message. If operational aggregation requires family/account uniqueness, use an environment-secret keyed HMAC with documented rotation rather than storing raw identifiers; this is not required for P0.

Monitor:

- invitation create/preview/accept/revoke success rates;
- categorized preview and acceptance failures;
- no-family choice views versus explicit creation starts;
- family creation immediately following auth, which should be zero without the explicit event;
- legacy invitation use during the compatibility window.

## 18. Testing requirements

Implementation follows strict RED → GREEN TDD. Required layers:

- Function unit tests for token generation/hash, owner authorization, role allowlist, expiry, revocation, family lifecycle, conflict, same-family behavior, idempotency, and atomic write shape.
- Functions-emulator integration tests for real Firestore transactions and concurrent/same-token acceptance.
- Firestore Rules tests proving every invitation/idempotency/rate-limit/membership authority record is client-inaccessible and direct `familyId`/role forgery is denied.
- Pending-intent unit tests for URL capture, session/local fallback, freshness, UID binding, account switching, terminal cleanup, and absence of preview metadata.
- Route/component tests for preview-before-auth, confirmation, terminal errors, auth return paths, no-family choice, explicit creation gating, and legacy compatibility.
- Auth tests for popup, redirect, email signup/login switch, friendly errors, and intent survival.
- Browser E2E for Settings and Family Hub creation, recipient auth/acceptance, refresh, account switching, same/different family, expired/revoked/used tokens, mobile redirect, and SW-controlled reload.
- Regression tests for child join, managed-child login, family code behavior, and pending legacy approvals.
- A datastore assertion proving Google auth alone creates zero family documents.

## 19. Deployment and rollback strategy

### Deployment

1. Deploy additive v2 backend callables and server-only collections.
2. Deploy rules changes required to deny v2 records and any obsolete client membership-authority writes; preserve legacy approval rules during compatibility.
3. Verify callable contracts in emulator and a preview project.
4. Deploy frontend routing gate, canonical invite route, no-family choice, explicit creation gate, and unified owner UI.
5. Run desktop, mobile redirect, refresh, and SW-controlled smoke tests.
6. Observe sanitized metrics and family-creation-after-auth alarms.
7. After the compatibility window, separately remove legacy parent invitation creation and later retire legacy preview/accept.

### Mixed-version compatibility

- New backend with old frontend is safe: old clients continue using legacy callables; v2 records are additive.
- New frontend with temporarily unavailable v2 backend shows a retryable unavailable state. It never falls back to the reusable family code for parent/adult authority.
- New frontend continues resolving already-issued legacy `/join?code=` links through the legacy route.
- V2 backend does not alter child or legacy pending-request contracts.

### Rollback

- Frontend rollback returns users to the old frontend while the additive v2 backend remains deployed. Previously created v2 links may not be consumable by the rolled-back UI, so the backend and canonical `/invite/:token` route should remain available through a minimal compatibility shell or hosting rollback must preserve that route chunk.
- Backend rollback must not occur while active v2 links exist unless a compatibility implementation of preview/accept remains deployed. Disabling v2 creation is safe; disabling acceptance is not.
- Rules rollback must continue denying direct client access to `familyInvitations` and membership-authority collections.
- No rollback path may treat `families.inviteCode` as parent/adult authority.
- Because initial rollout is additive and requires no production-data migration, rollback does not rewrite existing family or user documents.

## 20. Acceptance criteria

1. Only an owner can create/revoke a v2 parent/adult invitation.
2. A created token contains at least 128 bits of entropy, is returned only at creation, and does not appear in Firestore or logs.
3. The Firestore invitation key is the SHA-256 token hash.
4. Preview returns only family display name, intended role, active status, and expiry.
5. Expired, revoked, accepted, invalid, deleted-family, and deleting-family invitations cannot be joined.
6. Acceptance atomically derives and writes parent/adult membership and consumes the invitation.
7. A client-supplied family or role, including `owner`, has no effect and cannot be written directly.
8. Same-family acceptance returns `already_member`; other-family acceptance changes nothing and shows conflict UX.
9. Invite intent survives popup, redirect, email signup/login, refresh, browser/PWA reload, and Signup → Login.
10. An authenticated no-family invite recipient never renders creation onboarding.
11. An authenticated no-family user without invite sees Create/Join choice.
12. Google auth alone creates zero family documents.
13. Family creation begins only after explicit Create Family and a UID-bound create intent.
14. Stale onboarding drafts cannot bypass the explicit creation gate.
15. Settings, Family Hub, and post-auth onboarding use the same v2 owner invitation primitive.
16. `FamilyComposition` no longer creates a parent link from `familyData.inviteCode`.
17. Raw Firebase errors never render.
18. Legacy role-bound links work only through their remaining TTL and retain pending approval behavior.
19. `families.inviteCode` cannot confer immediate parent/adult authority.
20. Existing pending legacy requests remain operable.
21. Child join, managed-child, child login, and family-code child behavior remain unchanged.
22. Deployment and rollback preserve mixed-version safety and never downgrade parent authority to family-code trust.
