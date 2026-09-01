# Queki-Branded Email Verification Design

## Goal

Replace the default Firebase verification-email experience with a Queki-branded email and public action handler while preserving the existing verified-authority, invitation, join, and onboarding guarantees.

## Architecture

Firebase Authentication remains responsible for sending the verification email, issuing the one-time action code, and validating that code. Firebase's supported custom email domain and verification template features will later configure `Queki <noreply@queki.app>`, the subject `Verify your email for Queki`, branded HTML, and an action URL at `https://queki.app/auth/verify`.

The application adds a public `/auth/verify` route. It validates `mode=verifyEmail`, requires an `oobCode`, applies the code through the initialized Firebase client, and displays Queki success or recoverable error UI. It never creates a family, grants family authority, reconstructs onboarding state, or transfers tab-scoped intent.

Successful verification canonicalizes navigation to `/verify-email`. Caller-controlled `continueUrl` values never determine navigation. `/verify-email` remains the sole authority-resume boundary and performs the existing authoritative sequence: `reload()` → forced `getIdTokenResult(true)` → require `emailVerified=true` and `email_verified=true` → resume the existing invitation, legacy join, or UID-bound create intent.

## Handler Contract

- Accept Firebase parameters `mode`, `oobCode`, `continueUrl`, and optional `lang`.
- Permit only `mode=verifyEmail` and a non-empty `oobCode`.
- Use the application's configured Firebase Auth instance; never accept caller-selected Firebase configuration.
- Apply the code once and classify expired, invalid/already-used, and network failures into safe Queki copy.
- Show “already verified” only when the current authenticated user confirms it authoritatively; otherwise use non-assertive invalid/used copy.
- Retry may redeem the same action code again but cannot alter continuation or authority.
- Continue always targets the relative canonical route `/verify-email`.
- If no authenticated session exists in the email-link browser, report successful verification without rebuilding intent and offer the safe canonical continuation/sign-in path.
- Restrict localization to Queki-supported locales; an arbitrary `lang` value falls back safely.

## Security Invariants

- `/auth/verify` does not grant family authority.
- Firestore Rules and callable Functions continue requiring verified password authority.
- Google/federated and managed-child/custom-token identities remain unaffected.
- Authentication alone never creates a family.
- Pending invitation precedence, legacy join state, UID-bound create intent, and the one-family invariant remain unchanged.
- Cross-origin, credential-bearing, protocol-relative, encoded, or otherwise hostile `continueUrl` values cannot influence navigation.

## User Experience

Success:

- Queki branding.
- Heading: `Email verified ✓`.
- Body: `Your email is verified. Let's finish setting up your family.`
- Primary action: `Continue`.

Errors distinguish expired, invalid/no-longer-valid, already-verified when authoritative, and network failure. Recoverable errors offer Retry; signed-in users retain the existing resend path on `/verify-email`.

## Firebase Configuration Requiring Separate Approval

No configuration is changed by this implementation. A later approved console/DNS operation must:

1. Open Firebase Console → Authentication → Templates → Email address verification.
2. Customize the sender domain to `queki.app` and copy Firebase's generated TXT/CNAME records verbatim into the authoritative DNS provider.
3. Wait for Firebase domain verification, then apply the custom domain.
4. Set sender display name `Queki`, sender local part `noreply`, subject `Verify your email for Queki`, and the reviewed branded HTML template containing `%LINK%`.
5. Set the custom action URL to `https://queki.app/auth/verify`.
6. Preserve the current authorized-domain allowlist, including localhost and preview domains.

Firebase's generated DNS values are environment-specific and must not be guessed or committed.

## Verification

Strict RED→GREEN tests cover parsing, successful redemption, expired/invalid/already-used codes, hostile continuation values, forced-token authority refresh, create/invite/join continuation, provider non-regression, and exactly-once family behavior. Production-shaped email round trips run in Chromium and WebKit. Relevant Rules and Functions authority suites, typecheck, lint, build, `git diff --check`, and full frontend baseline comparison are required before completion.
