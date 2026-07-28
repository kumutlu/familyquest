# Family Setup and Localization Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix first-run family setup, make Pet Box an owner-controlled family feature, localize mounted navigation reactively, and provide comprehensive canonical timezone selection.

**Architecture:** Extend the existing family document and owner-only settings API rather than creating new stores or subscriptions. Pure helpers resolve setup readiness, Pet Box legacy defaults, and timezone options; UI and route guards consume those helpers, while Firestore rules enforce setup and Pet Box writes at the data boundary.

**Tech Stack:** React 18, TypeScript, Zustand, react-i18next, Firebase Firestore, Firestore Security Rules, Vitest, Testing Library.

## Global Constraints

- Work only in `/Users/kemal/.gemini/antigravity/scratch/family-gamification` on branch `todo-theme`.
- Preserve unrelated pre-existing working-tree changes.
- Missing `setup` and `petBoxEnabled` fields must require no migration.
- Only owners may modify `setup.*` or `petBoxEnabled`.
- Do not add timers, forced reloads, duplicate stores/APIs/member models, or authoritative local-storage settings.
- Reuse existing family/member subscriptions and secure managed-child/invitation flows.
- Existing Pet Box data must never be deleted.
- Preserve family isolation, ledger validation, protected user balances, and role security.

---

### Task 1: Persisted Family Setup Flow

**Files:**
- Create: `src/lib/familySetup.ts`
- Create: `src/lib/familySetup.test.ts`
- Create: `src/components/family/FamilySetupPrompt.tsx`
- Create: `src/components/family/FamilySetupPrompt.test.tsx`
- Modify: `src/components/layout/AppLayout.tsx`
- Modify: `src/components/layout/AppLayout.test.tsx`
- Modify: `src/components/family/AddChildModal.tsx`
- Modify: `src/components/family/FamilySettings.tsx`
- Modify: `src/lib/api.ts`
- Modify: `src/lib/api.familySettings.test.ts`
- Modify: `src/i18n/locales/en/auth.json`
- Modify: `src/i18n/locales/tr/auth.json`
- Modify: `src/i18n/i18n.auth.test.ts`
- Modify: `firestore.rules`
- Modify: `tests/firestore/familySettings.rules.test.ts`

**Interfaces:**
- Produces: `isFamilySetupReady(state): boolean`, `shouldShowFamilySetupPrompt(state): boolean`.
- Produces: `completeFamilyWelcomeSetup(familyId, uid): Promise<void>`, writing `setup.welcomePromptCompleted`, `setup.completedAt`, and `setup.completedBy`.
- Consumes: existing `appReady`, `familyLoading`, `familyData`, `familyMembers`, bootstrap status, `AddChildModal`, and invite-code UI.

- [ ] **Step 1: Write failing pure-helper and layout readiness tests**

Cover `appReady === false`, missing family document, family/member bootstrap loading, completed setup, non-owner users, zero children, and existing children. Assert that no unresolved state is interpreted as empty.

- [ ] **Step 2: Run setup helper/layout tests and confirm failure**

Run:

```bash
npx vitest run src/lib/familySetup.test.ts src/components/layout/AppLayout.test.tsx
```

Expected: FAIL because the setup resolver and prompt integration do not exist.

- [ ] **Step 3: Implement setup readiness and prompt rendering**

Create pure setup-state predicates over existing store state. Mount one non-blocking prompt from `AppLayout` only after all required bootstrap resources are ready and only for owners with incomplete family setup.

- [ ] **Step 4: Write failing prompt action tests**

Assert:

- zero children renders “Add a child”;
- existing child renders “Add another child” and never “Add my first child”;
- child action opens the existing `AddChildModal`;
- adult action opens the existing invite-code family settings UI;
- opening/copying invitation details does not persist completion;
- successful child creation and Skip persist completion;
- failed persistence logs, shows friendly feedback, keeps the app usable, and leaves the prompt eligible.

- [ ] **Step 5: Run prompt tests and confirm failure**

Run:

```bash
npx vitest run src/components/family/FamilySetupPrompt.test.tsx src/components/family/FamilyMemberModals.test.tsx src/components/family/FamilySettings.test.tsx
```

- [ ] **Step 6: Extend the existing API and secure flows**

Add `completeFamilyWelcomeSetup` to the family-settings API allowlist. Use `serverTimestamp()` and the authenticated owner UID. Let `AddChildModal` report successful child creation so the prompt can persist completion. Open the existing invitation section without marking completion.

- [ ] **Step 7: Add Firestore rule validation tests**

Assert:

- owner can write the exact setup object;
- `completedAt` must equal request time;
- `completedBy` must equal the authenticated owner;
- extra setup keys are denied;
- parent and child writes are denied;
- missing setup remains readable and otherwise compatible.

- [ ] **Step 8: Implement strict setup rule validation**

Add a dedicated setup validator and constrain family updates without weakening the existing owner-only boundary or gamification validation.

- [ ] **Step 9: Run focused setup tests**

Run:

```bash
npx vitest run src/lib/familySetup.test.ts src/components/family/FamilySetupPrompt.test.tsx src/components/family/FamilyMemberModals.test.tsx src/components/layout/AppLayout.test.tsx src/lib/api.familySettings.test.ts
firebase emulators:exec --only firestore "npx vitest run tests/firestore/familySettings.rules.test.ts"
```

- [ ] **Step 10: Commit setup flow**

Stage only Task 1 hunks and commit:

```bash
git commit -m "feat(setup): improve family setup flow"
```

---

### Task 2: Pet Box Family Feature Toggle

**Files:**
- Create: `src/lib/familyFeatures.ts`
- Create: `src/lib/familyFeatures.test.ts`
- Create: `src/components/routing/PetBoxRoute.tsx`
- Create: `src/components/routing/PetBoxRoute.test.tsx`
- Modify: `src/components/family/FamilySettings.tsx`
- Modify: `src/components/family/FamilySettings.test.tsx`
- Modify: `src/lib/api.ts`
- Modify: `src/lib/api.familySettings.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/pages/Dashboard.test.tsx`
- Modify: `src/components/parent/ParentDashboard.tsx`
- Modify: `src/components/parent/ParentDashboard.test.tsx`
- Modify: `src/components/parent/dashboard/QuickActions.tsx`
- Modify: `src/components/parent/dashboard/QuickActions.test.tsx`
- Modify: `src/components/parent/ApprovalCenter.tsx`
- Modify: `src/components/parent/ApprovalCenter.test.tsx`
- Modify: `src/lib/notificationRoutes.ts`
- Modify: `src/lib/notificationRoutes.test.ts`
- Modify: `src/lib/api.ts`
- Modify: relevant Pet Box API tests under `src/lib/api.*.test.ts`
- Modify: `src/i18n/locales/en/settings.json`
- Modify: `src/i18n/locales/tr/settings.json`
- Modify: `firestore.rules`
- Modify: `tests/firestore/familySettings.rules.test.ts`
- Modify: `tests/firestore/fundExpense.rules.test.ts`
- Modify: `tests/firestore/approvalCenter.rules.test.ts`
- Modify: `tests/firestore/reversal.rules.test.ts` only if historical reversal semantics require explicit coverage.

**Interfaces:**
- Produces: `isPetBoxEnabled(familyData): boolean`, where only explicit `false` disables.
- Produces: a guarded Pet Box route consuming existing store `familyData` and `appReady`.
- Consumes: existing family settings update API and all existing Pet Box transaction APIs/rules.

- [ ] **Step 1: Write failing feature-default and settings tests**

Assert missing and `true` resolve enabled, `false` resolves disabled, owners see/persist the toggle, and non-owners cannot edit it.

- [ ] **Step 2: Implement resolver and owner toggle**

Add `petBoxEnabled` to the existing family-settings API allowlist and render the toggle under Gamification/Family settings. Use authoritative family state and no extra reads.

- [ ] **Step 3: Write failing entry-point and route tests**

Search-derived coverage must include child dashboard summary, parent dashboard cards/actions, pending approvals, notification navigation, and `/pet-box`. Assert disabled families see no actionable Pet Box entry and direct navigation redirects safely.

- [ ] **Step 4: Gate every UI entry point and route**

Use `isPetBoxEnabled(familyData)` consistently. Preserve historical transaction/audit presentation while removing current actions.

- [ ] **Step 5: Write failing API/rule bypass tests**

For every client Pet Box mutation (`contributeToFund`, Pet Box request approval/cancellation, and Pet Box fund expense), assert explicit `false` is rejected. Assert missing `petBoxEnabled` preserves legacy success. Cover server/backend write paths represented by Firestore rules.

- [ ] **Step 6: Implement API and Firestore enforcement**

Client helpers must verify the already-subscribed family state or transaction-read family document before mutations. Rules must use a legacy-compatible `isPetBoxEnabled(familyId)` helper on Pet Box request and Pet Box ledger/expense writes. Do not prevent safe historical reads or delete data.

- [ ] **Step 7: Run focused Pet Box tests**

Run the relevant component/API tests plus:

```bash
firebase emulators:exec --only firestore "npx vitest run tests/firestore/familySettings.rules.test.ts tests/firestore/fundExpense.rules.test.ts tests/firestore/approvalCenter.rules.test.ts tests/firestore/reversal.rules.test.ts"
```

- [ ] **Step 8: Commit Pet Box feature**

Stage only Task 2 hunks and commit:

```bash
git commit -m "feat(settings): add Pet Box family feature toggle"
```

---

### Task 3: Reactive Navigation and Authentication Localization

**Files:**
- Modify: `src/pages/Signup.tsx`
- Modify: `src/pages/Signup.test.tsx`
- Modify: `src/pages/Login.test.tsx`
- Modify: `src/config/navigation.ts`
- Modify: `src/config/navigation.test.ts`
- Modify: `src/components/layout/AppLayout.tsx`
- Modify: `src/components/layout/AppLayout.test.tsx`
- Modify: `src/components/layout/ProfileDropdown.tsx`
- Modify: `src/components/layout/ProfileDropdown.test.tsx`
- Modify: `src/pages/Settings.tsx`
- Modify: `src/pages/Settings.test.tsx`
- Modify: mounted page-heading components found by the audit where labels remain hard-coded
- Modify: matching tests for audited page headings
- Modify: locale JSON files under `src/i18n/locales/en` and `src/i18n/locales/tr`
- Modify: `src/i18n/i18n.auth.test.ts`

**Interfaces:**
- Changes `NavItem.name` to `NavItem.labelKey`.
- Consumes `useTranslation` directly in mounted components so `languageChanged` triggers rendering.

- [ ] **Step 1: Write failing signup/login wording tests**

Assert signup uses “Continue with Google” / “Google ile devam et” and login remains “Sign in with Google” / “Google ile giriş yap.”

- [ ] **Step 2: Implement distinct authentication keys**

Use `continueWithGoogle` only on Signup and retain `signInWithGoogle` on Login.

- [ ] **Step 3: Write failing mounted-layout language test**

Render `AppLayout` once, assert all desktop and mobile labels in English, call `i18n.changeLanguage('tr')` without remount/rerender, and assert every mounted label changes.

- [ ] **Step 4: Convert navigation to translation keys**

Return stable key/path/icon metadata from navigation config and translate labels inside `AppLayout`. Use stable paths or label keys as React keys.

- [ ] **Step 5: Audit and fix mounted labels**

Convert remaining hard-coded visible labels in profile menu, settings tabs, sidebar/drawer if present, and mounted page headings to existing/new locale keys. Do not duplicate language state.

- [ ] **Step 6: Run focused localization tests**

Run:

```bash
npx vitest run src/pages/Signup.test.tsx src/pages/Login.test.tsx src/config/navigation.test.ts src/components/layout/AppLayout.test.tsx src/components/layout/ProfileDropdown.test.tsx src/pages/Settings.test.tsx src/i18n/i18n.auth.test.ts src/i18n/phase2d.i18n.test.tsx
```

- [ ] **Step 7: Commit localization changes**

Stage only Task 3 hunks and commit:

```bash
git commit -m "feat(i18n): complete reactive navigation localization"
```

---

### Task 4: Canonical IANA Timezones

**Files:**
- Create: `src/lib/timezones.ts`
- Create: `src/lib/timezones.test.ts`
- Modify: `src/components/family/FamilySettings.tsx`
- Modify: `src/components/family/FamilySettings.test.tsx`
- Modify: `src/i18n/locales/en/settings.json`
- Modify: `src/i18n/locales/tr/settings.json`

**Interfaces:**
- Produces: `getTimezoneOptions(locale, currentValue): { value: string; label: string }[]`.
- Uses `Intl.supportedValuesOf('timeZone')` when present and a bundled canonical fallback otherwise.

- [ ] **Step 1: Write failing timezone helper tests**

Assert runtime enumeration, fallback behavior, canonical values, regional coverage, `Europe/Istanbul`, friendly labels, sorting, and retention of a valid existing saved value.

- [ ] **Step 2: Implement timezone option helper**

Generate labels from IANA region/city segments and localized region display where supported. Persist only option `value`.

- [ ] **Step 3: Write failing selector persistence tests**

Assert the selector loads the comprehensive options, selects `Europe/Istanbul`, and sends that exact canonical ID through `updateFamilySettings`.

- [ ] **Step 4: Replace the small hard-coded list**

Use `getTimezoneOptions(i18n.resolvedLanguage, regionalSettings.timezone)` and retain the existing owner/non-owner behavior.

- [ ] **Step 5: Run focused timezone tests**

Run:

```bash
npx vitest run src/lib/timezones.test.ts src/components/family/FamilySettings.test.tsx src/lib/api.familySettings.test.ts
```

- [ ] **Step 6: Commit timezone changes**

Stage only Task 4 hunks and commit:

```bash
git commit -m "feat(settings): expand timezone support"
```

---

### Task 5: Full Verification and Deployment

**Files:**
- Verify all scoped changes and preserve unrelated working-tree content.

- [ ] **Step 1: Run the exact configured Firestore predeploy command**

Read `firebase.json`, then run its exact command:

```bash
npm run test:rules
```

Expected: exit 0 with all configured Firestore test files passing.

- [ ] **Step 2: Run the complete unit suite**

```bash
npm test
```

Expected: exit 0.

- [ ] **Step 3: Run production build**

```bash
npm run build
```

Expected: exit 0.

- [ ] **Step 4: Validate whitespace**

```bash
git diff --check
```

Expected: no output and exit 0.

- [ ] **Step 5: Inspect scoped commit history and dirty tree**

Confirm the four logical commits contain only related files/hunks and unrelated pre-existing changes remain uncommitted.

- [ ] **Step 6: Verify Firebase target**

Confirm `.firebaserc` resolves the default project to `familyquest-beta-402cb`.

- [ ] **Step 7: Deploy rules and hosting together**

```bash
firebase deploy --only firestore:rules,hosting
```

Expected: both Firestore rules and hosting succeed for `familyquest-beta-402cb`.

- [ ] **Step 8: Record final evidence**

Capture root causes, exact changed files, Firestore totals, unit totals, build result, all commit SHAs, rules deployment result, hosting deployment result, and hosting URL.
