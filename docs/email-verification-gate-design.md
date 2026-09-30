# Password Email Verification Authority Gate

## Objective

Prevent an email/password identity whose email is not verified from acquiring family authority. The gate covers family creation, owner bootstrap, authenticated family join requests, legacy invitation acceptance, and adult invitation acceptance. It preserves existing Google/trusted-federated behavior, managed-child/custom-token behavior, onboarding intent semantics, and invite precedence.

No deployment or Firebase Auth configuration mutation is part of this change.

## Existing security gap

Password signup currently creates a Firebase Authentication identity and a minimal parent profile, then routing may continue directly into family onboarding. Firestore Rules authorize family creation and owner bootstrap for any authenticated caller, while the invitation and join callables check only for an authenticated UID. Consequently, an unverified password identity can reach family authority through direct SDK or callable requests even if the UI is gated.

## Authority rule

An identity requires email verification when its current authentication provider is `password`. It has family authority only when the authoritative Firebase identity/token reports `email_verified == true`.

- Password provider, unverified: pending-account access only; no family authority.
- Password provider, verified: existing behavior.
- Trusted federated provider: existing behavior.
- Managed child/custom token: existing behavior.

Client state is advisory. Firestore Rules and callable Functions enforce the authority boundary independently from the Firebase ID token.

## Client flow

Signup normalizes and validates the email address before calling Firebase. After password-account creation it creates only the existing minimal no-family profile, sends a verification email with the explicit continuation URL `https://queki.app/verify-email`, and routes to `/verify-email`.

The verification page provides:

- the account email and explanatory copy;
- `I've verified` to reload the Firebase user and force-refresh the ID token;
- `Resend email` with a client cooldown;
- friendly mappings for invalid email, duplicate account, weak password, rate limiting, network failure, and an email that remains unverified;
- sign-out/change-account access without granting family authority.

The central auth routing gate sends an existing unverified password login to `/verify-email` before any family, invite-acceptance, join, or onboarding-finalization route. An authenticated `/verify-email` route remains on that page even after the user record first reports verified, allowing the page to complete the authoritative refresh and resume itself.

Every client family-authority boundary uses the same ordered operation: `reload()`, forced `getIdTokenResult(true)`, then an explicit `email_verified === true` claim check for password identities. Family bootstrap and all three join/invite acceptance wrappers fail closed unless that operation succeeds.

The create-family intent and pending invitation remain in their existing tab-scoped storage and retain their UID binding. Verification neither clears nor recreates them. Sign-out continues to clear dangerous UID-bound create authority. A stale or wrong-UID intent remains invalid.

## Server enforcement

Firestore Rules add a narrowly scoped provider/token helper and require it for:

- direct family document creation;
- the matching owner-bootstrap user update.

The existing minimal self-signup profile remains permitted because it grants no family membership.

Callable Functions add a shared token-authority helper and invoke it before authoritative work in:

- adult invitation acceptance;
- legacy invitation acceptance;
- authenticated family join requests.

Adult invitation profile completion may continue to repair only a missing display name because it does not grant membership; acceptance remains blocked until verification.

## Configuration

Verification emails always specify `https://queki.app/verify-email` as their continuation URL. The existing Firebase Auth authorized-domain allowlist, including localhost and preview domains, is intentionally unchanged. That broader allowlist is an accepted non-P0 exposure needed by current development and preview workflows.

## Failure and recovery behavior

Unknown or stale client verification state fails closed at routing. Server enforcement uses only the verified Firebase token claims. After the user verifies, the client reloads the Firebase user and force-refreshes the ID token before retrying routing. A failed family bootstrap retains the valid UID-bound create intent; Retry repeats the same idempotent finalization instead of falling back to Create/Join.

## Test strategy

RED tests first prove the current bypasses:

1. invalid email rejected before Firebase;
2. password signup sends the production verification action URL;
3. unverified password signup/login routes to verification;
4. verified password routing preserves create intent;
5. verified password routing preserves invite precedence;
6. trusted federated and managed-child/custom identities are not incorrectly gated;
7. refresh/direct protected routes cannot bypass the gate;
8. wrong-UID/stale create intent remains invalid;
9. Firestore denies unverified password family create and owner bootstrap;
10. Firestore permits verified password and unaffected provider paths;
11. Functions deny unverified password adult invite acceptance;
12. Functions deny unverified password legacy invite acceptance;
13. Functions deny unverified password authenticated join requests;
14. Functions preserve verified/federated paths;
15. resend, refresh, cooldown, and friendly error behavior.

Emulator E2E covers password signup through verification and exact-intent resume, existing unverified login, no-intent fail-closed behavior, invite precedence, and the trusted-provider/managed-child regressions supported by the repository harness.
