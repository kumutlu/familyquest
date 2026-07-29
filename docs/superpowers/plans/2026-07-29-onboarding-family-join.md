# Onboarding and Family Join Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shorten parent onboarding and provide secure, unified child creation, self-join approval, and family-code regeneration.

**Architecture:** Keep family creation and managed-child provisioning on their existing authoritative paths. Move invite-code lookup and regeneration into trusted `europe-west1` callables, reuse existing profile subscriptions and approval transactions, and consolidate repeated UI into shared components.

**Tech Stack:** React 19, TypeScript, Zustand, i18next, Firebase Auth, Firestore, Cloud Functions v2, Vitest, Firebase Rules Unit Testing.

## Global Constraints

- Roles are only `owner`, `parent`, and `child`; user-facing “parent or adult” maps to `parent`.
- Requesters never choose a final role, and legacy `requestedRole` is ignored.
- No family data access before approval.
- Preserve `europe-west1` Functions configuration.
- Never store or log plaintext passwords or invite codes in audit diagnostics.
- Existing pending requests remain reviewable after code regeneration.
- Use current FamilyQuest branding.

---

### Task 1: Shorten Parent Onboarding

**Files:**
- Modify: `src/pages/Onboarding.tsx`
- Modify: `src/pages/Onboarding.test.tsx`
- Modify: `src/i18n/locales/en/auth.json`
- Modify: `src/i18n/locales/tr/auth.json`
- Modify: `src/App.tsx`
- Delete: `src/pages/ChildOnboarding.tsx`
- Delete: `src/pages/ChildOnboarding.test.tsx`
- Delete: `src/lib/childOnboarding.ts`
- Delete: `src/lib/childOnboarding.test.ts`

**Interfaces:**
- Consumes: `createFamilyAndParent(uid, displayName, familyName)`
- Produces: create-family onboarding that navigates directly to `/`

- [ ] Write tests proving family creation navigates directly Home and no child/member fields or child-count questions render.
- [ ] Run `npx vitest run src/pages/Onboarding.test.tsx src/App.test.tsx` and verify the new assertions fail.
- [ ] Remove staged-member/invite-code steps and the dead child-onboarding route/helper.
- [ ] Add concise English/Turkish onboarding copy.
- [ ] Re-run focused tests and commit with `refactor(onboarding): defer child setup until after signup`.

### Task 2: Move the Authoritative First-Child Prompt to Home

**Files:**
- Modify: `src/components/layout/AppLayout.tsx`
- Modify: `src/components/layout/AppLayout.test.tsx`
- Modify: `src/components/parent/ParentDashboard.tsx`
- Modify: `src/components/parent/ParentDashboard.test.tsx`
- Modify: `src/components/family/FamilySetupPrompt.tsx`
- Modify: `src/components/family/FamilySetupPrompt.test.tsx`
- Modify: `src/lib/familySetup.ts`
- Modify: `src/lib/familySetup.test.ts`
- Modify: `src/i18n/locales/en/dashboard.json`
- Modify: `src/i18n/locales/tr/dashboard.json`

**Interfaces:**
- Consumes: `shouldShowFamilySetupPrompt(state)`
- Produces: Home-only dismissible setup prompt with add/copy/not-now paths

- [ ] Add failing tests for loading, error, zero children, existing child, persisted dismissal, and asynchronously arriving child.
- [ ] Verify focused tests fail because the prompt is globally mounted and lacks the new actions.
- [ ] Remove prompt mounting from `AppLayout`; mount it in `ParentDashboard` using existing store state.
- [ ] Update `FamilySetupPrompt` to show/copy the family code without completing setup and to persist only Not now or successful child completion.
- [ ] Add persistent add/invite actions on Home or Family.
- [ ] Re-run focused tests.

### Task 3: Consolidate Managed Child Creation

**Files:**
- Modify: `src/components/family/AddChildModal.tsx`
- Modify: `src/components/family/FamilyMemberModals.test.tsx`
- Modify: `src/components/family/FamilySetupPrompt.test.tsx`
- Modify: `src/components/family/FamilySettings.tsx`
- Modify: `src/pages/Family.tsx`
- Modify: `src/pages/Family.test.tsx`
- Modify: `src/i18n/locales/en/auth.json`
- Modify: `src/i18n/locales/tr/auth.json`

**Interfaces:**
- Consumes: `createManagedMember`, `CreateChildLoginDialog`
- Produces: shared two-stage profile + optional-login flow

- [ ] Add failing tests for profile-only creation, successful login handoff, failure retaining the created child, and retry without duplicate profile creation.
- [ ] Verify the tests fail against the current six-step flow.
- [ ] Reduce the profile form to display name/avatar and replace task/reward steps with the sign-in choice.
- [ ] Preserve the created child ID across login failure/retry and provide “manage later” completion.
- [ ] Wire the same modal from Home, Settings, and Family.
- [ ] Re-run focused tests and commit with `feat(family): add unified child creation flow`.

### Task 4: Add Server-Authoritative Self-Join

**Files:**
- Create: `functions/src/familyMembership.ts`
- Create: `functions/src/familyMembership.test.ts`
- Modify: `functions/src/index.ts`
- Modify: `src/lib/api.ts`
- Create: `src/lib/familyMembershipApi.test.ts`
- Modify: `src/pages/Onboarding.tsx`
- Modify: `src/pages/Onboarding.test.tsx`
- Modify: `firestore.rules`
- Modify: `tests/firestore/approvalCenter.rules.test.ts`
- Modify: `src/i18n/locales/en/auth.json`
- Modify: `src/i18n/locales/tr/auth.json`

**Interfaces:**
- Produces: `requestFamilyJoin({ familyCode, clientReqId }): Promise<{status:'pending'}>`
- The callable request contains no role field.

- [ ] Add failing callable tests for valid code, invalid code, duplicate pending request, caller already in family, role-field rejection/ignoring, and rate limiting.
- [ ] Add failing rules tests proving pending/rejected requesters cannot read family data and may read only their request.
- [ ] Add failing client tests proving the callable receives no role and pending UI renders.
- [ ] Implement the callable with authenticated profile lookup, code resolution, stable request ID, duplicate/rate-limit validation, and safe errors.
- [ ] Replace direct protected family queries in `requestToJoinFamily`.
- [ ] Re-run Functions, frontend, and rules tests.

### Task 5: Unify Authoritative Approval Roles

**Files:**
- Create: `src/components/family/JoinRequestReview.tsx`
- Create: `src/components/family/JoinRequestReview.test.tsx`
- Modify: `src/components/parent/ParentDashboard.tsx`
- Modify: `src/components/family/FamilySettings.tsx`
- Modify: `src/lib/api.ts`
- Modify: `src/lib/api.approvals.test.ts`
- Modify: `firestore.rules`
- Modify: `tests/firestore/approvalCenter.rules.test.ts`
- Modify: `src/i18n/locales/en/dashboard.json`
- Modify: `src/i18n/locales/tr/dashboard.json`
- Modify: `src/i18n/locales/en/settings.json`
- Modify: `src/i18n/locales/tr/settings.json`

**Interfaces:**
- Produces: shared `JoinRequestReview` emitting only `approve('child'|'parent')` or `reject()`

- [ ] Add failing UI tests for default child, parent/adult warning, and no adult/owner option.
- [ ] Add failing API/rules tests proving requester/legacy roles are ignored, owner can assign child/parent, and adult/owner/cross-family/replay/unauthorized approvals fail.
- [ ] Extract the shared reviewer UI and update both surfaces.
- [ ] Keep the final role sourced only from the reviewer transaction input.
- [ ] Re-run focused frontend/API/rules tests and commit with `feat(family): support self-join approval workflow`.

### Task 6: Secure Family-Code Regeneration

**Files:**
- Modify: `functions/src/familyMembership.ts`
- Modify: `functions/src/familyMembership.test.ts`
- Modify: `functions/src/index.ts`
- Modify: `src/lib/api.ts`
- Modify: `src/lib/api.familySettings.test.ts`
- Modify: `src/components/family/FamilySettings.tsx`
- Modify: `src/components/family/FamilySettings.test.tsx`
- Modify: `firestore.rules`
- Modify: `tests/firestore/familySettings.rules.test.ts`
- Modify: `src/i18n/locales/en/settings.json`
- Modify: `src/i18n/locales/tr/settings.json`

**Interfaces:**
- Produces: `regenerateFamilyCode({clientReqId}): Promise<{familyCode:string}>`

- [ ] Add failing tests for owner authorization, cryptographic format/uniqueness retry, idempotency, old-code invalidation, new-code acceptance, member preservation, and pending-request preservation.
- [ ] Add failing UI tests for explicit confirmation copy and cancellation.
- [ ] Implement callable generation/transaction/audit and replace the direct client write.
- [ ] Restrict direct invite-code family updates in rules.
- [ ] Re-run focused tests and commit with `feat(family): allow secure family code regeneration`.

### Task 7: Full Verification and Deployment

**Files:**
- Verify only; change files only to fix discovered regressions.

- [ ] Run focused frontend suites for onboarding, prompt, child creation, join review, and settings.
- [ ] Run `npx vitest run --dir functions/src familyMembership childLogin`.
- [ ] Run the complete Firestore predeploy command from `firebase.json`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check`.
- [ ] Inspect staged scope and preserve unrelated dirty files.
- [ ] Deploy changed Functions, Firestore rules, and Hosting to `familyquest-beta-402cb`.
- [ ] Verify `https://queki.app` returns HTTP 200 and the production bundle contains `europe-west1`.
- [ ] Report only authenticated production checks actually performed.

