# Managed-Child Access and Adult Invitations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the deployed managed-child login lifecycle, enforce mandatory password replacement, and expose secure adult invitation and approval controls.

**Architecture:** The existing Firebase Auth synthetic-user and custom-token design remains authoritative. Functions own login lifecycle mutations, Firestore rules fail closed for restricted children, the existing profile listener resolves managed-child identity from trusted claims, and both family surfaces reuse shared lifecycle/invitation/approval components.

**Tech Stack:** React 19, Zustand, React Router, i18next, Firebase Auth, callable Cloud Functions, Firestore rules, Vitest, Testing Library, Firebase emulator.

## Global Constraints

- Work only on branch `todo-theme` in `/Users/kemal/.gemini/antigravity/scratch/family-gamification`.
- Do not add PIN authentication, email requirements for children, shared passwords, or another invitation model.
- Never persist or log plaintext passwords, hashes, digests, or password-derived values.
- Every parent reset forces `requiresPasswordChange: true` and requires successful session revocation.
- Restricted managed children may only hydrate their profile, replace the password, or sign out.
- Parent role approval is strictly owner-only; role values are only `child` or `parent`.
- Preserve family isolation and all protected profile, role, wallet, XP, and gamification fields.
- Existing managed children and join requests require no migration.

---

### Task 1: Secret-free lifecycle backend

**Files:**
- Modify: `functions/src/childLogin.ts`
- Test: `functions/src/childLogin.test.ts`

**Interfaces:**
- `ResetChildPasswordInput = { childId: string; newPassword: string; clientReqId: string }`
- `CompleteChildPasswordChangeInput = { newPassword: string; clientReqId: string }`
- Idempotency fingerprint consumes operation, child ID, caller UID, and non-secret phase only.

- [ ] Add failing tests proving reset cannot disable mandatory replacement, no idempotency/audit document contains password-derived material, revocation failure leaves a restricted recovery state, retry resumes idempotently, and cross-family reset is denied.
- [ ] Add failing tests proving password completion accepts no current password, validates Auth UID/custom claims/public profile/private linkage/family, requires active restriction, does not clear before password write and revocation, preserves restriction on failure, and audits success/failure without secrets.
- [ ] Run `npm --prefix functions test -- src/childLogin.test.ts` and verify failures come from the existing contracts.
- [ ] Remove `requirePasswordChange` from reset input and `currentPassword` from completion input; remove `hashSecret`.
- [ ] Replace secret-derived payload hashes with a non-secret fingerprint containing operation, child ID, caller UID, and phase.
- [ ] Implement fail-closed reset phases: reserve, restrict, update Auth password, require token revocation, persist completion, audit.
- [ ] Implement claim/linkage-validated completion: update password, require revocation, then clear flags and complete audit/idempotency.
- [ ] Re-run `functions/src/childLogin.test.ts` and confirm all lifecycle tests pass.

### Task 2: Managed-child profile hydration and restricted authorization

**Files:**
- Modify: `src/store/useStore.ts`
- Modify: `firestore.rules`
- Test: `src/store/authBootstrap.test.tsx`
- Test: `tests/store/useStore.test.ts`
- Test: `tests/firestore/childLogin.rules.test.ts`

**Interfaces:**
- Profile bootstrap derives `profileId` from `token.claims.childId` only when `managedChild === true` and `role === 'child'`.
- Rules helper resolves the managed-child profile from trusted `request.auth.token.childId`.
- Rules helper `isPasswordChangeRestricted()` blocks normal family operations.

- [ ] Add failing auth tests for claim-based `users/{childId}` subscription, inconsistent claim/profile family rejection, authoritative restriction hydration before readiness, and normal UID compatibility.
- [ ] Add failing emulator tests allowing only restricted-child profile hydration while denying dashboard collections, tasks, wallet, settings, and direct writes.
- [ ] Run focused store and rules tests and verify the managed-child cases fail against UID-only bootstrap/current rules.
- [ ] Resolve managed-child profile ID from verified token claims without adding reads or listeners; validate profile linkage before `appReady`.
- [ ] Add centralized restricted-child rule predicates and apply them to family access while preserving parent/normal-child behavior.
- [ ] Re-run focused store and Firestore tests.

### Task 3: Frontend lifecycle API and mandatory password screen

**Files:**
- Modify: `src/lib/childLoginApi.ts`
- Create: `src/pages/ChildPasswordChange.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/layout/AppLayout.tsx`
- Modify: `src/i18n/locales/en/auth.json`
- Modify: `src/i18n/locales/tr/auth.json`
- Modify: `src/i18n/locales/en/errors.json`
- Modify: `src/i18n/locales/tr/errors.json`
- Test: `src/lib/childLoginApi.test.ts`
- Create: `src/pages/ChildPasswordChange.test.tsx`
- Test: `src/components/layout/AppLayout.test.tsx`
- Test: `src/App.test.tsx`

**Interfaces:**
- `resetChildPassword({ childId, newPassword }): Promise<ResetChildPasswordResult>`
- `disableChildLogin(childId): Promise<DisableChildLoginResult>`
- `enableChildLogin(childId): Promise<EnableChildLoginResult>`
- `completeChildPasswordChange(newPassword): Promise<{ success: true }>`

- [ ] Add failing API tests for exact callable names, stable request IDs, secret-free payload shapes, validation, and friendly error mapping.
- [ ] Add failing route tests proving restricted children always see `/change-password`, cannot mount navigation/outlets, cannot dismiss it, and remain restricted after failure.
- [ ] Add a successful replacement test proving the profile listener clears the screen and normal child content becomes available without a reload.
- [ ] Run the focused API/layout/page tests and confirm the missing wrappers/page/gate cause the failures.
- [ ] Implement callable wrappers with one request ID per user action and no secret logging or persistence.
- [ ] Implement the localized password-change form accepting only new password plus confirmation; clear inputs after every terminal path.
- [ ] Gate `AppLayout` after authoritative profile hydration and before any navigation/protected outlet mounts.
- [ ] Re-run focused tests.

### Task 4: Parent lifecycle controls

**Files:**
- Modify: `src/components/family/ChildLoginSection.tsx`
- Create: `src/components/family/ResetChildPasswordDialog.tsx`
- Create: `src/components/family/ChildLoginStatusDialog.tsx`
- Modify: `src/pages/Family.tsx`
- Modify: `src/components/family/CreateChildLoginDialog.tsx`
- Modify: `src/components/family/AddChildModal.tsx`
- Modify: `src/pages/ChildOnboarding.tsx`
- Modify: `src/i18n/locales/en/family.json`
- Modify: `src/i18n/locales/tr/family.json`
- Test: `src/components/family/ChildLoginSection.test.tsx`
- Create: `src/components/family/ResetChildPasswordDialog.test.tsx`
- Test: `src/components/family/CreateChildLoginDialog.test.tsx`
- Test: `src/pages/Family.test.tsx`

**Interfaces:**
- `ChildLoginSection` emits `onSetup`, `onReset`, `onEnable`, and `onDisable`.
- Reset dialog always calls `resetChildPassword` without an optional restriction flag.

- [ ] Replace obsolete “Coming soon” assertions with failing lifecycle-action tests for not-configured, enabled, disabled, restricted, loading, success, and error states.
- [ ] Add failing reset-dialog tests for the exact temporary-password warning, confirmation validation, cleared secrets, duplicate-submit prevention, and no display of replacement password.
- [ ] Add failing setup-flow tests proving family code + username + password instructions appear after managed-child creation.
- [ ] Run the focused component and Family tests and verify the disabled controls/incomplete copy cause failures.
- [ ] Wire reset/enable/disable actions to the API through accessible confirmations and live profile state.
- [ ] Replace misleading status text and add localized login instructions without exposing Auth UID or synthetic email.
- [ ] Re-run focused lifecycle and Family tests.

### Task 5: Adult invitation panel and role-safe approval

**Files:**
- Create: `src/components/family/AdultInviteDialog.tsx`
- Create: `src/components/family/JoinRequestApprovalDialog.tsx`
- Modify: `src/components/family/FamilySettings.tsx`
- Modify: `src/components/parent/ParentDashboard.tsx`
- Modify: `src/pages/Family.tsx`
- Modify: `src/lib/api.ts`
- Modify: `firestore.rules`
- Modify: `src/i18n/locales/en/family.json`
- Modify: `src/i18n/locales/tr/family.json`
- Modify: `src/i18n/locales/en/dashboard.json`
- Modify: `src/i18n/locales/tr/dashboard.json`
- Create: `src/components/family/AdultInviteDialog.test.tsx`
- Create: `src/components/family/JoinRequestApprovalDialog.test.tsx`
- Test: `src/components/family/FamilySettings.test.tsx`
- Test: `src/components/parent/ParentDashboard.test.tsx`
- Test: `src/lib/api.familySettings.test.ts`
- Test: `tests/firestore/ownerPermissions.rules.test.ts`

**Interfaces:**
- `approveJoinRequest(familyId, requestId, role: 'child' | 'parent')`
- Approval dialog defaults to `child`; `canApproveParent` is true only for owners.

- [ ] Add failing invitation tests proving the visible action opens the existing code, copying has no Firestore/account/setup mutation, and explanatory copy describes account creation/sign-in and joining.
- [ ] Add failing approval tests for default child, owner parent selection, privilege warning, final selected-role confirmation, non-owner parent denial, existing request compatibility, cross-family denial, and processed-request denial.
- [ ] Run focused Family/Dashboard/API/rules tests and confirm both UIs currently hard-code child and the invite action lacks a panel.
- [ ] Implement the shared invitation dialog and use it from Family and Settings without adding a backend model.
- [ ] Implement the shared approval dialog in both approval surfaces.
- [ ] Validate the role allowlist and reviewer authority inside `approveJoinRequest`; record reviewer, approved UID, selected role, and server timestamp.
- [ ] Tighten Firestore rules so parent-role approval is owner-only while existing authorized child approval remains unchanged.
- [ ] Re-run focused tests and the complete Firestore rules suite.

### Task 6: Phase-one verification, commit, and deployment

**Files:**
- Review only phase-one files and the approved spec/plan.

- [ ] Run focused auth, managed-child, Family, Dashboard, API, Functions, and rules tests.
- [ ] Run `npm run test:rules`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check`.
- [ ] Confirm no password material appears in serialized fixtures, logs, audit payloads, idempotency payloads, or responses.
- [ ] Stage only phase-one changes and commit with `fix(family): complete managed-child access and adult invites`.
- [ ] Verify `firebase use` reports `familyquest-beta-402cb`.
- [ ] Deploy `firebase deploy --only functions,firestore:rules,hosting`.
- [ ] Confirm Functions, Firestore rules, and Hosting all succeed; verify the Hosting URL returns HTTP 200.
- [ ] Record the phase-one root causes, files, test totals, commit SHAs, deployment results, URL, and manual verification checklist.

### Task 7: Family Bulletin handoff

**Files:**
- Create after phase-one production verification: `docs/superpowers/specs/2026-07-29-family-bulletin-design.md`
- Create after Bulletin spec approval: `docs/superpowers/plans/2026-07-29-family-bulletin.md`

- [ ] After phase one is deployed and verified, begin a separate brainstorming/specification cycle for Family Bulletin.
- [ ] Keep Bulletin code, tests, commit, and deployment completely separate from phase one.
