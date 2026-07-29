# Onboarding and Family Join Redesign

## Goal

Reduce new-parent onboarding to account creation, family creation/naming, and entry to Home. Move child creation and family-member acquisition into optional, secure in-app flows that reuse the existing managed-child and join-approval architecture.

## Current Architecture and Root Causes

- `Onboarding` creates the family atomically, but then requires at least one locally staged member and an invite-code step before navigation. This is the direct cause of child questions blocking onboarding.
- `ChildOnboarding` and `AddChildModal` duplicate the same six-step child/profile/login/task/reward sequence. The standalone route is no longer automatically entered, while `AddChildModal` is used by the setup prompt and Settings.
- `FamilySetupPrompt` already uses authoritative family/member bootstrap state, but it is mounted by `AppLayout`, so it can interrupt every authenticated route instead of Home only.
- `requestToJoinFamily` queries protected family documents from an unaffiliated client. Firestore correctly denies that lookup, so self-join needs a trusted callable boundary.
- Join approval already uses an owner-selected `child | parent` value, atomic profile/request/wallet/feed writes, and Firestore pending/owner checks. The dashboard and Settings duplicate its UI.
- Invite-code regeneration exists, but uses client-side `Math.random`, lacks collision handling, lacks confirmation, and is not rate-limited or audited server-side.

## Role Model

The only roles remain:

- `owner`
- `parent`
- `child`

There is no `adult` role. User-facing “parent or adult” maps exactly to internal role `parent`. Join requesters never select or control a role. New requests do not store `requestedRole`; legacy `requestedRole` data is ignored. Approval accepts only `child` or `parent`, and can never create `owner`.

The existing authorization model remains owner-only for join approval. The UI may describe `parent` as “Parent or adult,” but this does not create a new permission matrix.

## Parent Onboarding

The create-family path has one family step:

1. Enter the family name.
2. Run the existing atomic `createFamilyAndParent`.
3. Refresh the authoritative owner profile and navigate directly to Home.

It does not ask for members, child details, invite code, tasks, rewards, or regional settings. The self-join choice remains available to authenticated users without a family.

## Empty-Family Home Experience

The existing `shouldShowFamilySetupPrompt` eligibility function remains the authority. It requires:

- `appReady`
- loaded family document
- loaded family members
- no critical family/member bootstrap error
- owner role
- zero child-role members
- incomplete `setup.welcomePromptCompleted`

The prompt moves from global `AppLayout` mounting to the parent Home dashboard. It offers:

- Add a child
- Let them join
- Not now

“Let them join” reveals and copies the current family code and explains approval. “Not now” persists the existing audited setup completion object. A persistent Home/Family action remains available after dismissal. If a child arrives through the live member subscription, the prompt closes immediately.

## Unified Parent-Managed Child Flow

`AddChildModal` becomes the single shared implementation used by Home, Settings, and Family:

1. Collect display name and avatar only.
2. Create the managed child profile and wallet through `createManagedMember`.
3. Ask whether the child should sign in:
   - Not now: finish with a profile-only child.
   - Create login: open the existing `CreateChildLoginDialog`.

Date of birth, colour, task setup, reward setup, and the duplicate standalone child-onboarding route are removed from this flow.

The created child ID is retained after profile creation. If login provisioning fails, the modal reports that the profile exists, keeps the same child ID, and offers retry or later management. It never calls `createManagedMember` again during login retry.

## Self-Join

A new callable owns family-code lookup and join-request creation. Input contains only profile information, the code, and a stable request ID—never a role.

The callable:

- authenticates the caller;
- verifies the caller has no family;
- normalizes and validates the family code;
- resolves the matching family using Admin Firestore access;
- validates the caller’s authoritative user profile;
- prevents another active pending request;
- applies server-side per-user/IP abuse controls using existing callable patterns;
- writes a pending request with identity snapshot and timestamps;
- returns only pending-state confirmation, without family data.

Invalid, expired, and unknown codes use the same safe error. Before approval, rules allow the requester to read only their own join request, not the family document or family subcollections.

## Approval

Both current approval surfaces reuse a shared role selector/confirmation component and the same API. Options are:

- Approve as child → `child`
- Approve as parent or adult → `parent`
- Reject

The confirmation warns that a parent can help manage the family. Approval ignores any legacy `requestedRole`. The final role is supplied only by the authorized reviewer and is validated as `child | parent` by both server/rules boundaries. Existing owner-only review authorization, same-family validation, pending-state validation, and one-time processing remain enforced.

## Family-Code Regeneration

A trusted callable generates a cryptographically random six-character code, checks uniqueness, updates the family atomically, and records non-secret audit metadata. Only the owner can regenerate under the current model.

The UI requires confirmation:

> Generate a new family code?
>
> The current code will stop accepting new join requests.

The old code immediately stops creating new requests. Existing members are unchanged. Existing pending requests remain reviewable because approval is tied to the stored family/request, not the current code.

## Localization and Error Handling

All new English and Turkish strings live in existing namespaces. Components explicitly load every namespace they use and provide friendly fallbacks where errors are mapped synchronously. Raw i18n keys, Firebase errors, codes, family existence, and internal paths are never shown to users. Safe technical details are logged without passwords or secret invite codes.

## Security Boundaries

- No requester-selected role.
- No `adult` role or new permission matrix.
- No unaffiliated family reads.
- No family access before approval.
- No client write to managed-child authentication lifecycle fields.
- No plaintext password persistence or logging.
- No approval to `owner`.
- No cross-family or repeated approval.
- No client-generated authoritative family code.
- Pending requests created before regeneration remain valid for review; the old code cannot create new requests.

## Testing

Tests cover shortened onboarding, authoritative Home prompt behavior, unified child creation and login retry, callable region preservation, localized failures, self-join privacy/duplicates/rate limits, authoritative approval roles, legacy role ignoring, rejection/pending isolation, secure code regeneration, pending-request compatibility, Firestore rules, full unit suites, build, and diff checks.

