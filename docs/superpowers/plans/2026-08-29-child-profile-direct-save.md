# Child Profile Direct Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let children save their own display name and allowlisted cosmetic profile fields immediately without creating a parent-approval request.

**Architecture:** The shared editor will call one narrowly scoped API helper for child self-edits. That helper validates the display name, catalog avatar ownership, and composable avatar configuration before updating only the loaded child's top-level user document; Firestore rules independently enforce the same field allowlist and ownership boundary. Avatar URLs remain derived from the catalog/config in memory and are not child-writable.

**Tech Stack:** React, TypeScript, Firebase Web SDK, Firestore Security Rules, Vitest, Firebase Rules Unit Testing, Playwright.

**Spec:** Approved P0 design in the 2026-08-29 task conversation.

## Global Constraints

- Branch is `fix/child-profile-direct-save`, based on exact `origin/todo-theme` SHA `505761582a3002f5af1322208e16790484163d8a`.
- Button copy is `Save changes`; progress is `Saving…`; success is `Profile updated`; failure is `Your profile could not be updated. Please try again.`
- Children may update only their own `displayName`, `avatarId`, and valid allowlisted `avatarConfig`; `avatarUrl` remains derived and non-writable.
- No profile approval request, feed entry, notification, or parent action may be created by the new child save flow.
- Do not change Functions or deploy anything.
- Preserve onboarding, Money Privacy, Goals, Pet Box, hold-to-complete safety, and the separate deployment downgrade guard.

---

### Task 1: Direct-save UI regression

**Files:**
- Modify: `src/components/profile/ProfileEditorModal.test.tsx`
- Modify: `src/pages/Settings.test.tsx`
- Modify: `src/components/profile/ProfileEditorModal.tsx`
- Modify: `src/i18n/locales/en/profile.json`
- Modify: `src/i18n/locales/tr/profile.json`

**Interfaces:**
- Consumes: existing `ProfileEditorModal` props and profile validation.
- Produces: child save behavior that invokes `updateOwnCosmeticProfile` and displays the required copy.

- [ ] Replace the approval-oriented child component test with a failing test that edits the child name, clicks `Save changes`, observes `Profile updated`, and proves `submitProfileUpdateRequest` was not invoked.
- [ ] Run the focused modal test and confirm it fails because the current button and approval branch remain.
- [ ] Add error and avatar-creator cases covering the required failure copy and immediate cosmetic payload.
- [ ] Implement the smallest modal/copy change that routes children to `updateOwnCosmeticProfile` and removes pending-request locking and approval messaging.
- [ ] Run focused modal and Settings tests until green.

### Task 2: Tightly scoped API helper

**Files:**
- Modify: `src/lib/api.ts`
- Create: `src/lib/api.childProfile.test.ts`

**Interfaces:**
- Consumes: authenticated actor identity, `validateProfileUpdateInput`, `isValidAvatarConfig`, avatar catalog lookup.
- Produces: `updateOwnCosmeticProfile(displayName, avatarId, options): Promise<void>`.

- [ ] Write failing helper tests proving the exact three-field write, display-name validation, invalid config rejection, and no approval collection side effects.
- [ ] Run the focused helper tests and confirm they fail because the helper is absent.
- [ ] Implement the helper with an authenticated self-document reference and an exact cosmetic payload.
- [ ] Run helper and modal tests until green.

### Task 3: Firestore self-edit boundary

**Files:**
- Modify: `firestore.rules`
- Modify: `tests/firestore/profileAndAvatar.rules.test.ts`

**Interfaces:**
- Consumes: `authProfileId`, `isChildInFamily`, avatar catalog ownership helpers, `isValidAvatarConfig`.
- Produces: a child-self-update rule permitting only valid cosmetic changes.

- [ ] Replace the direct-child-denial regression with an allow test for the child's own display name and valid cosmetic fields.
- [ ] Add denial tests for another child, `familyId`, `role`, balances/points/XP, and login/ownership/security fields.
- [ ] Run only the profile/avatar emulator suite and confirm the own-cosmetic test fails under baseline rules.
- [ ] Add a dedicated child-self-cosmetic rule clause with exact changed-key, identity, role, family, display-name, avatar ownership, and avatar-config validation.
- [ ] Run the profile/avatar rules suite until all allow and denial cases pass.

### Task 4: Verification and delivery

**Files:**
- Modify as needed only for defects found by verification.

**Interfaces:**
- Consumes: completed UI, API, and rule changes.
- Produces: verified commit and PR into `todo-theme`.

- [ ] Run focused profile tests and relevant rules tests.
- [ ] Run `npm run typecheck`, `npm run build`, and `git diff --check`.
- [ ] Verify the flow in a browser with a child account, including immediate UI refresh and no approval item.
- [ ] Confirm no deployment, Functions changes, or unrelated protected-feature changes.
- [ ] Commit, push `fix/child-profile-direct-save`, and open a PR into `todo-theme`.
