# Password Email Verification Gate Implementation Plan

## Phase 1: RED client tests

- Add provider-aware authority-helper tests.
- Add signup validation and verification-email action URL tests.
- Add verification-page refresh/resend/error/cooldown tests.
- Add auth-routing tests for unverified password, verified password, trusted federated, managed child, direct URL, create intent, invite precedence, and wrong-UID intent.
- Run focused tests and retain the expected failures before runtime changes.

## Phase 2: RED server tests

- Add Firestore emulator cases for unverified/verified password family creation and owner bootstrap, plus unaffected provider paths.
- Add Function unit tests for unverified/verified password and unaffected-provider adult invitation, legacy invitation, and family join calls.
- Run focused suites and retain the expected failures before server changes.

## Phase 3: Client implementation

- Add a central provider-aware verification authority module.
- Validate and normalize signup email locally.
- Send verification email with the exact production continuation URL.
- Add `/verify-email` and its UI/actions/error handling.
- Apply the verification decision in the central routing gate before family authority routes.
- Preserve existing intent storage, UID binding, invite priority, and sign-out cleanup.
- Run focused client tests to GREEN.

## Phase 4: Server implementation

- Add a narrowly scoped Rules token helper.
- Gate family create and owner bootstrap without changing minimal profile creation.
- Add a shared callable auth-token helper.
- Gate the three authoritative membership entry points before data mutation.
- Run Rules and Function suites to GREEN.

## Phase 5: Emulator E2E

- Add exact password signup, verification, and onboarding-intent-resume flow.
- Add existing-unverified-login and direct-route checks.
- Add no-intent and invite-precedence checks.
- Add provider and managed-child regression coverage supported by the emulator harness.

## Phase 6: Full verification

- Focused auth/onboarding/routing tests.
- Focused Function tests.
- Full Firestore Rules suite.
- Exact relevant E2E suites.
- Full normalized frontend suite and baseline comparison.
- `npm run typecheck`.
- `npm run lint`.
- `npm run build`.
- `npm run verify:parent-invite-v2`.
- Deployment guard tests.
- `git diff --check` and clean-worktree verification after commit.

## Release boundary

Do not deploy Hosting, Functions, Rules, indexes, or Storage. Report implementation and verification evidence first.
