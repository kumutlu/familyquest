# Child Home Enrichment and Avatar Creator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add useful Goals/Pet Box summaries to Child Home and a secure composable avatar creator that persists through the existing parent-approval workflow.

**Architecture:** Child Home uses pure selectors over existing Zustand data and canonical routes. Avatar configuration is a closed, versioned presentation contract rendered by one deterministic resolver, with narrowly scoped Rules/API/lifecycle support and unchanged legacy/premium behavior.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest/Testing Library, Firebase Firestore Rules emulator, Playwright, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-08-25-child-home-avatar-creator-design.md`

## Global Constraints

- No arbitrary avatar URLs, SVG, CSS, uploads, binaries, or free-form configuration.
- Child avatar changes remain parent-approved and self-scoped.
- Existing `avatarId`, `avatarUrl`, and premium unlock semantics remain intact.
- Do not modify accounting, points/XP formulas, goal/Pet Box accounting, indexes, migrations, or service worker.
- Do not commit, push, or deploy.

---

### Task 1: Child Home live summaries

**Files:**
- Create: `src/lib/home/childFamilyTools.ts`
- Create: `src/lib/home/childFamilyTools.test.ts`
- Modify: `src/components/home/ChildLivingHome.tsx`
- Modify: `src/components/home/ChildLivingHome.test.tsx`
- Modify: `src/i18n/locales/en/home.json`
- Modify: `src/i18n/locales/tr/home.json`

**Interfaces:**
- Consumes: normalized child-visible `savingsGoals`, `funds`, `familyData`.
- Produces: `selectFeaturedChildGoal(goals)` and semantic `/goals` and `/pet-box` cards.

- [ ] Write selector and component tests proving family/own goals are eligible, sibling goals are excluded, Pet Box is conditional, routes are canonical, and the mobile grid cannot overflow.
- [ ] Run focused tests and confirm failures arise from missing selector/cards.
- [ ] Implement the pure selector and Child Home cards with existing progress/money primitives.
- [ ] Run focused tests and preserve hero, wallet privacy, XP, and points assertions.

### Task 2: Versioned avatar contract and renderer

**Files:**
- Create: `src/config/avatarConfig.ts`
- Create: `src/config/avatarConfig.test.ts`
- Create: `src/components/avatar/ComposableAvatar.tsx`
- Create: `src/components/avatar/ComposableAvatar.test.tsx`
- Modify: `src/config/avatarCatalog.ts`
- Modify: `src/config/avatarCatalog.test.ts`
- Modify: `src/components/ui/Avatar.tsx`
- Modify: `src/components/queki/CharacterFrame.tsx`

**Interfaces:**
- Produces: `AvatarConfigV1`, `isValidAvatarConfig`, `normalizeAvatarConfig`, `randomAvatarConfig`, `avatarConfigToDataUrl`, and `resolveAvatarImage(avatarId, legacyUrl, avatarConfig)`.

- [ ] Write failing tests with literal configs for validation, deterministic output, category mutations, malformed fallback, and legacy fallback.
- [ ] Run focused tests and verify the missing contract/resolver is the failure.
- [ ] Implement closed enums, deterministic SVG layers, safe data URL generation, and the compatibility resolver.
- [ ] Run focused tests and refactor only after green.

### Task 3: Avatar Creator interaction

**Files:**
- Create: `src/components/profile/AvatarCreator.tsx`
- Create: `src/components/profile/AvatarCreator.test.tsx`
- Modify: `src/components/profile/ProfileEditorModal.tsx`
- Modify: `src/components/profile/ProfileEditorModal.test.tsx`
- Modify: `src/i18n/locales/en/profile.json`
- Modify: `src/i18n/locales/tr/profile.json`

**Interfaces:**
- Consumes: `AvatarConfigV1`, normalizer, renderer, and randomizer.
- Produces: `onChange(config)` live preview and profile editor save/cancel behavior.

- [ ] Write failing tests proving every category changes preview state, Surprise Me stays valid, Cancel writes nothing, and Save submits only intended avatar data.
- [ ] Run the tests and confirm expected RED results.
- [ ] Implement the mobile-first category editor and integrate it beside unchanged classic-avatar selection.
- [ ] Run focused tests and accessibility assertions.

### Task 4: API and approval contract

**Files:**
- Modify: `src/lib/api.ts`
- Modify: `src/lib/api.profileUpdate.test.ts`
- Modify: `src/lib/requestModel.ts`
- Modify: `src/components/requests/RequestDetailContent.tsx`
- Modify: `src/components/parent/ApprovalCenter.tsx`

**Interfaces:**
- Adds optional `requestedAvatarConfig` and `currentAvatarConfig` to profile requests.
- Approval applies a validated config without changing avatar unlock ownership.

- [ ] Write failing API tests for valid config submission/application, malformed rejection, legacy payload compatibility, and preservation of unrelated profile fields.
- [ ] Run focused tests and confirm contract failures.
- [ ] Extend validation, request adaptation, approval preview, and transactional application minimally.
- [ ] Run focused tests and existing profile-approval regressions.

### Task 5: Firestore Rules security boundary

**Files:**
- Modify: `firestore.rules`
- Modify: `tests/firestore/profileAndAvatar.rules.test.ts`
- Modify: `tests/firestore/profileUpdateTxn.rules.test.ts`

**Interfaces:**
- Rules accept only the exact `AvatarConfigV1` keys and values in self-scoped profile requests and parent-approved profile writes.

- [ ] Add emulator tests for valid configuration, invalid version/key/value/type, child direct-write denial, sibling/cross-family request denial, and unrelated parent-write denial.
- [ ] Run only the profile Rules suite and verify new valid cases fail before Rules changes while denial cases remain denied.
- [ ] Add closed Rules helpers and narrowly extend the two affected allowlists.
- [ ] Run focused and full Rules suites.

### Task 6: Lifecycle and canonical presentation

**Files:**
- Modify: `functions/src/memberLifecycle.ts`
- Modify: corresponding member lifecycle tests
- Modify: `src/store/useStore.ts`
- Modify: affected store/bootstrap tests

**Interfaces:**
- Archive/restore preserves `avatarConfig`; current user and family members expose a centrally resolved avatar presentation.

- [ ] Write failing lifecycle and normalization tests proving config preservation and identical Parent/Child resolution.
- [ ] Run focused tests and confirm RED.
- [ ] Preserve config in lifecycle snapshots and normalize presentation at the store boundary.
- [ ] Run focused tests plus representative header, crew, wallet, request, and leaderboard tests.

### Task 7: Verification and authenticated browser QA

**Files:**
- Modify only existing emulator seed/e2e fixtures if required; do not create production data.

**Interfaces:**
- Produces recorded test and QA evidence; no release action.

- [ ] Run all new focused component/API/lifecycle tests.
- [ ] Run focused profile Rules emulator tests, then `npm run test:rules`.
- [ ] Run `npx tsc --noEmit`, `npm run build`, `npm run ci:freeze`, and `git diff --check`.
- [ ] Run the project regression suite and compare failures with baseline if any.
- [ ] Start the Firebase emulators/local app and authenticate seeded Parent and Child accounts.
- [ ] Verify Child Home scenarios A–D and Avatar Creator persistence/isolation at 1440×900, 768×1024, 390×844, and 412×915 in light/dark modes.
- [ ] Verify Parent sees the saved child avatar consistently across crew/profile/wallet/request surfaces and legacy accounts remain unchanged.
- [ ] Report exact changed files and git status. Do not commit, push, or deploy.
