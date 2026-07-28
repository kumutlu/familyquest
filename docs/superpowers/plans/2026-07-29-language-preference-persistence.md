# Language Preference Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist each authenticated user's supported language preference and restore it during profile bootstrap without duplicate state or reads.

**Architecture:** `users/{uid}.language` is authoritative. Pure i18n resolvers validate saved values, the existing profile listener hydrates i18n before authenticated readiness, and a Zustand action performs an optimistic Settings update with rollback around a narrow API write.

**Tech Stack:** React, Zustand, i18next, Firebase Auth/Firestore, Vitest, Firestore emulator rules tests.

## Global Constraints

- Supported language values are exactly `en` and `tr`.
- Do not use localStorage as an authenticated language source.
- Reuse the existing `users/{uid}` listener; add no reads or listeners.
- Missing preference uses supported browser language then English; invalid present preference uses English directly.
- Preserve every protected profile, family, balance, XP, and gamification boundary.

---

### Task 1: Language resolution

**Files:**
- Modify: `src/i18n/index.ts`
- Test: `src/i18n/i18n.test.ts`

**Interfaces:**
- Produces: `isSupportedLanguage(value): value is SupportedLanguage`
- Produces: `resolveProfileLanguage(value): SupportedLanguage`
- Produces: `applyLanguage(language): Promise<void>`

- [ ] Add failing tests for valid saved preference precedence, missing-value browser fallback, invalid-value English fallback, and document direction.
- [ ] Run `npx vitest run src/i18n/i18n.test.ts` and confirm the new assertions fail because profile resolution is absent.
- [ ] Replace the preference stub with pure validation/resolution and a centralized i18n application helper.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Profile persistence and optimistic Settings behavior

**Files:**
- Modify: `src/lib/api.ts`
- Modify: `src/store/useStore.ts`
- Modify: `src/pages/Settings.tsx`
- Modify: `src/i18n/locales/en/settings.json`
- Modify: `src/i18n/locales/tr/settings.json`
- Test: `src/pages/Settings.test.tsx`
- Test: `src/store/authBootstrap.test.tsx`
- Test: `src/lib/api.profileUpdate.test.ts`

**Interfaces:**
- Produces: `updateLanguagePreference(language: SupportedLanguage): Promise<void>`
- Produces: Zustand `setLanguagePreference(language: SupportedLanguage): Promise<void>`
- Consumes: Task 1 language validation, resolution, and application helpers.

- [ ] Add failing API and Settings tests proving the exact `users/{uid}.language` write, immediate store/i18n update, and rollback with friendly feedback.
- [ ] Add failing auth tests proving valid, missing, and invalid profile language hydration occurs before readiness and repeats after sign-out/sign-in.
- [ ] Run the three focused test files and confirm failures are caused by the missing API/action/hydration.
- [ ] Implement the allowlisted API, optimistic Zustand action, Settings integration, failure copy, and profile-listener hydration.
- [ ] Remove all `familyquest.language` localStorage reads/writes and the component-local authoritative language state.
- [ ] Re-run focused Settings, API, auth/store, and i18n tests until green.

### Task 3: Firestore enforcement

**Files:**
- Modify: `firestore.rules`
- Test: `tests/firestore/userLanguage.rules.test.ts`

**Interfaces:**
- Allows: self-update of only `language` when its value is `en` or `tr`.
- Denies: unsupported language, cross-user language change, and any protected-field mutation.

- [ ] Add emulator tests for the allowed values and every required denial boundary.
- [ ] Run the new rules test and confirm valid self-updates fail before the rule exists.
- [ ] Add a narrow language self-update rule without broadening the existing generic profile update.
- [ ] Run `npm run test:rules` exactly as configured by `firebase.json` and confirm all Firestore tests pass.

### Task 4: Verification, commit, and deployment

**Files:**
- Review only the files listed above and these two documents.

- [ ] Run focused Settings language, auth/store bootstrap, and i18n initialization tests.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check`.
- [ ] Stage only related files and commit with `fix(i18n): persist language preference across sessions`.
- [ ] Verify the active Firebase project is `familyquest-beta-402cb`.
- [ ] Deploy with `firebase deploy --only firestore:rules,hosting`.
- [ ] Confirm both Firestore rules and Hosting succeed and record the production URL.
