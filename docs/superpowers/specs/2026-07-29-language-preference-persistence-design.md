# Language Preference Persistence Design

## Problem

The mounted application reacts correctly to `i18n.changeLanguage`, but Settings stores the selection only in `localStorage`. The authenticated profile has no language write path, `getUserLanguagePreference()` is a stub, and profile hydration never applies a language. Refreshing therefore resolves the browser language again.

## Authoritative model

`users/{uid}.language` is the single authenticated source of truth. Supported values are `en` and `tr`. The field is optional for existing users, so no migration is required.

- A valid saved value is applied.
- A missing value resolves from the supported browser language, then English.
- An invalid present value resolves directly to English.
- Browser language never overrides a valid saved value.

No family-level field, secondary preferences document, authenticated local-storage source, read, or listener is added.

## Runtime flow

Settings validates a selection, captures the authoritative previous value, updates `currentUser.language`, changes i18n and document direction immediately, and writes the new value through a dedicated profile API. If the write fails, it restores the previous store value and resolved language, reports friendly feedback, and logs the failure.

The existing `users/{uid}` profile subscription validates and applies the profile language before it marks profile hydration complete or begins rendering the authenticated layout. The listener also reconciles later authoritative profile changes. Sign-out clears the user profile; signing in on any session/device repeats the same profile hydration.

## Security

Firestore rules add a narrow self-update branch for `language`. It permits only the authenticated user to update their own field to `en` or `tr`. Existing protected profile, role, family, balances, reward points, lifetime XP, and gamification fields remain immutable. Unsupported values and cross-user writes are denied.

## Testing

Regression tests cover resolution semantics, immediate Settings/store/i18n behavior, persistence and rollback, auth hydration across refresh and sign-in cycles, saved-versus-browser precedence, missing and invalid values, and Firestore supported-value, ownership, and protected-field boundaries. Verification includes the focused suites, complete Firestore predeploy command, full unit suite, production build, and diff checks.
