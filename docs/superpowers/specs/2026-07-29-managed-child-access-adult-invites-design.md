# Managed-Child Access and Adult Invitations Design

## Scope

Phase one completes the existing managed-child authentication lifecycle and the existing family invitation flow. It does not introduce PIN authentication, a second invitation model, or Family Bulletin.

## Existing managed-child model

A managed child is an existing `users/{childId}` profile with `role: child` and `isManaged: true`. Login setup creates a distinct synthetic Firebase Auth user and links it to the existing profile:

- Public status on `users/{childId}`: `hasLogin`, `username`, `loginEnabled`, `requiresPasswordChange`.
- Private server-only record: `families/{familyId}/childLogins/{childId}`.
- Family-scoped username index: `families/{familyId}/childLoginIndex/{normalizedUsername}`.
- Immutable operational audit: `families/{familyId}/childLoginAudit/{auditId}`.
- Idempotency state: `families/{familyId}/childLoginIdempotency/{clientReqId}`.
- Firebase custom claims: `role: child`, `managedChild: true`, `familyId`, and `childId`.

Synthetic email, Auth UID, and credential material remain server-only. Passwords are held only by Firebase Authentication and are never persisted or logged.

The existing child login page already exchanges family code, family-scoped username, and password through `signInChild`, then signs into Firebase with a custom token. This flow remains authoritative.

## Existing gaps

- The frontend exposes only create/sign-in wrappers. Deployed reset, enable, disable, session-revocation, and password-change callables are not wired.
- Member cards render reset/enable/disable as disabled “Coming soon” controls.
- There is no mandatory password-change screen or route gate.
- Parent reset accepts `requirePasswordChange: false` and treats refresh-token revocation as best-effort.
- Auth bootstrap subscribes to `users/{request.auth.uid}` even though managed-child Auth UID is distinct from `childId`; it must resolve the trusted `childId` claim before profile hydration.
- Firestore authorization does not centrally restrict a managed child whose profile requires a password change.
- Both join-approval UIs hard-code ordinary join requests to the `child` role even though the existing transaction and rules support `parent`.
- The current adult invite copy is secondary explanatory text rather than a clear primary action and panel.

## Child identity and bootstrap

After Firebase authentication resolves, bootstrap reads the signed token claims already required for authentication:

1. For a normal user, profile ID is the Auth UID.
2. For a managed child, claims must contain exactly `managedChild: true`, `role: child`, a non-empty `childId`, and a non-empty `familyId`.
3. Bootstrap subscribes to `users/{childId}` using that trusted claim, verifies the profile is a managed child in the claimed family, and retains the Firebase Auth UID only as authentication identity.
4. The authenticated layout remains gated until the authoritative profile snapshot and language hydration finish.
5. Invalid or inconsistent claims/linkage fail closed with a recoverable authentication error.

No additional Firestore listener is introduced.

## Parent lifecycle UI

Managed-child cards show one accurate state:

- Not configured: “Child login is not set up” and a primary “Set up child login” action.
- Enabled: username, enabled status, password-change requirement, last login when available, “Reset password,” and “Disable login.”
- Disabled: username, disabled status, “Reset password,” and “Enable login.”
- Restricted recovery: clear wording that password setup/reset is incomplete and the child remains blocked; safe retry is available.

Setup and member-card help text explains that the child signs in with the family code, family-scoped username, and password.

Reset opens a focused dialog. The parent enters and confirms a temporary password and sees:

> Set a temporary password. The child will be signed out on all devices and must create a new private password the next time they sign in.

Passwords are cleared from component memory on completion, cancellation, and failure. No UI can reveal the child’s eventual private password.

Enable and disable use explicit confirmation. Disable revokes active sessions. Every action prevents duplicate submission and uses a stable request ID for retries.

## Mandatory password replacement

Every parent reset forces `requiresPasswordChange: true`; callers cannot opt out.

Reset is fail-closed:

1. Authenticate and authorize the parent/owner.
2. Verify same-family active managed-child profile, private linkage, and Auth UID.
3. Reserve the idempotency key and mark the login as restricted/recovery pending.
4. Write the temporary Firebase Auth password.
5. Revoke all refresh tokens as a required operation.
6. Persist the completed restricted state and audit success.

An external failure is not marked successful. The profile stays restricted, idempotency records the recoverable phase, and an audit entry records the failure without secrets. A retry with compatible non-secret operation metadata resumes safely.

No plaintext password, password hash, password digest, or password-derived value is written to Firestore, audit, logs, idempotency records, analytics, or responses. Idempotency uses only `clientReqId`, operation type, child ID, requester UID, operation phase, server timestamps, and a non-secret request fingerprint that excludes all password material. Reusing a request ID with incompatible non-secret metadata is rejected.

After temporary-password authentication, only these capabilities are available:

- authoritative profile hydration needed to establish the restriction;
- the `completeChildPasswordChange` callable;
- sign-out.

`AppLayout` always renders the mandatory password-change screen when the authoritative managed-child profile has `requiresPasswordChange: true`, regardless of URL. Navigation and protected content are not mounted.

Firestore rules deny restricted managed children all family reads and writes except the minimum profile read required for hydration. Callable backend entry points reject restricted managed-child callers except password replacement and sign-out-related token handling. This is defense in depth, not a UI-only redirect.

Password replacement:

1. Verifies the managed-child custom claims, Auth UID caller, `childId`, family ID, public profile, and private linkage all agree.
2. Requires the private/public restriction to be active.
3. Relies on the already-authenticated Firebase caller and a recent/valid token as appropriate; it does not accept or re-verify the temporary password.
4. Accepts only the new private password and stable request ID.
5. Validates and writes the new private Firebase Auth password.
6. Requires successful refresh-token revocation.
7. Only then clears public/private `requiresPasswordChange`.
8. Completes idempotency and writes the audit event.

Failure never clears the flag. On success, the old temporary credential no longer authenticates and the profile subscription unlocks the normal child experience.

## Adult invitation and approval

Family members and settings expose a visible “Add parent or adult” action separate from “Add child.” It opens a reusable invitation panel showing:

- the existing family invite code;
- a copy action;
- an explanation that the adult creates or signs into their own account, submits the existing join request, and must be approved.

Opening or copying the invite does not create a user, promote a role, or complete family setup.

The invite code and join-request schema remain unchanged. Role is selected only during approval:

- Default: child.
- Owner: may select child or parent/adult.
- Non-owner authorized parent: may approve child only if the existing rules permit child approval; parent/adult is never available.
- Parent/adult selection shows a privilege warning.
- A final confirmation displays the selected role.

Both current approval surfaces use the same approval component and transaction. The API validates the role allowlist (`child` or `parent`), authenticates the reviewer, verifies the pending same-family request, and enforces owner-only parent approval. Firestore rules independently enforce the same boundary. Existing requests need no migration. Processed requests cannot be approved again.

Approval records reviewer, approved UID, selected role, and server timestamp in the existing request/audit data. Rejection is unchanged.

## Authorization boundaries

- Parents/owners may manage login only for active managed children in their family.
- Children cannot create, reset, enable, disable, rename, or inspect private login records.
- Restricted children cannot use normal Firestore or callable application operations.
- Cross-family lifecycle and approval operations are denied server-side.
- Parent approval is owner-only; child approval follows the existing authorized-reviewer policy.
- Client writes remain unable to change roles, family IDs, balances, reward points, lifetime XP, gamification fields, or login-link fields.
- Server-owned login index, private records, audits, and idempotency documents remain unreadable and unwritable by clients.

## Backward compatibility

- Existing managed children without login fields remain valid and show setup status.
- Existing configured logins continue using their current private linkage and Firebase Auth account.
- Existing join requests without role metadata default to child at approval.
- No document migration is required.
- No existing Pet Box, wallet, task, reward, or gamification data is changed.

## Error handling

- Lifecycle errors use friendly localized messages and log only non-secret operational context.
- Failed reset/replacement remains visibly restricted and retryable without blocking parent access to the app.
- Duplicate clicks are suppressed.
- Idempotency replays with different payloads are rejected.
- Repeated blocking dialogs are not used.

## Testing and verification

Tests cover:

- managed child without login configuration;
- setup explanation and successful login creation;
- valid and invalid child sign-in and cross-family rejection;
- claim-based profile hydration;
- reset always sets the restriction and requires successful session revocation;
- partial reset failure remains restricted and retryable;
- restricted UI routes and Firestore/backend operations are denied;
- mandatory screen cannot be dismissed or bypassed;
- replacement claim/linkage/family validation;
- failed replacement preserves restriction;
- successful replacement clears the flag and invalidates the temporary password;
- passwords never appear in Firestore, logs, responses, or parent UI;
- enable/disable state and session revocation;
- lifecycle idempotency and audit records;
- adult invite panel behavior;
- viewing/copying invite causes no account or setup mutation;
- default child approval, owner parent approval, non-owner denial, cross-family denial, processed-request denial, and correct resulting role;
- localization reacts without remounting.

Verification runs focused auth, managed-child, Family, Functions, and rules tests; the complete Firestore predeploy suite; `npm test`; `npm run build`; and `git diff --check`. Because Functions and rules change, deployment is:

`firebase deploy --only functions,firestore:rules,hosting`

Target project: `familyquest-beta-402cb`.
