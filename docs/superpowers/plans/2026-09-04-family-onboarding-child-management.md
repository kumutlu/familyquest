# Queki — Family-Only Onboarding & Child Management Architecture Implementation Plan

**Base Commit**: `313a4a06e2a074ce0e348e2eadcfe095d834ec91`
**Target Branch**: `todo-theme`
**Status**: Planning Phase (Strictly Read-Only, No Production Code Mutated, No Deployments)

---

## Executive Summary & Architectural Invariants

This plan decouples family workspace creation from child creation in Queki. A parent can sign up, create a family, and immediately reach their Parent Home workspace without being forced to create a child, configure a wallet, invent a task, or set a reward. An owner-only family (0 children) is a first-class, durable, valid production state.

Child addition and device management are separated into two distinct operations:
1. **Add Child**:
   - **On their own device** (`new_child_join` QR): child scans QR on personal device, enters display name, submits join request. Parent approves in Approval Center (with NO existing-child selector dropdown). On approval, the backend atomically provisions a new managed child user profile, wallet, child auth identity, and binds the device.
   - **Set up without a device**: Parent enters child name directly; parent client invokes server-guarded managed child creation.
2. **Existing Child Device Binding** (`existing_child_device_bind` QR):
   - Initiated strictly from `Family` → child card → `Manage <Child>` → `Devices` → `Connect personal device`.
   - Server pins `targetChildId` at QR token generation. Child scan and submission carry this pinned target. Parent approval binds the device to the existing child without creating a new child or wallet.
3. **Canonical Child Management Surface**:
   - Replaces fragmented modals with a single `ManageChild` dialog/surface covering Profile (name, avatar), Devices & Access, Money / Wallet, Child Settings (login, PIN reset), and Danger Zone (`Remove child` using existing backend `deleteChild`).
   - Fixes the release-blocking black-screen regression in `MemberDetailSheet.tsx` where clicking "Manage Member" routed to an unmapped path.
4. **Family Screen Simplification**:
   - Removes duplicate `Manage family` accordions and standalone top-level device connect buttons; replaces them with a single interactive `Family Settings` destination.

---

## 18 Implementation Tasks (TDD Order)

### Task 1: Onboarding Machine Flow Reduction (Pre-auth & Post-auth Steps)

- **Goal**: Shorten pre-auth wizard from 7 steps to 5 steps by removing Step 4 (Child Name) and Step 5 (Mini Journey). Remove post-auth child creation and first task creation from `FamilyComposition.tsx` and `FirstTask.tsx`.
- **Files to Inspect**:
  - `src/onboarding/useOnboardingMachine.ts`
  - `src/onboarding/OnboardingFlow.tsx`
  - `src/onboarding/steps/Step4ChildName.tsx`
  - `src/onboarding/steps/Step5MiniJourney.tsx`
  - `src/onboarding/postauth/FamilyComposition.tsx`
  - `src/onboarding/postauth/FirstTask.tsx`
  - `src/onboarding/postauth/Success.tsx`
- **Files to Modify/Create**:
  - `src/onboarding/useOnboardingMachine.ts` (update step transitions: Step 3 `relationship` transitions directly to Step 6 `family_name`; eliminate `child_name` and `mini_journey` from active pre-auth states; transition post-auth `family_composition` directly to `success` / home once family is confirmed).
  - `src/onboarding/OnboardingFlow.tsx` (remove render paths for `child_name`, `mini_journey`, `first_task`).
  - `src/onboarding/postauth/FamilyComposition.tsx` (remove call to `ensureFirstChild`; execute only `ensureFamily`).
  - `src/onboarding/useOnboardingMachine.test.ts` (update step sequence tests).
  - `src/onboarding/OnboardingFlow.test.tsx` (verify UI step progression).
- **RED Test Command**:
  ```bash
  npx vitest run src/onboarding/useOnboardingMachine.test.ts
  ```
  *Expected Failure*: Test fails asserting `child_name` is no longer a visited state after `relationship`.
- **Minimal GREEN Implementation**:
  Update `STEP_ORDER` in `useOnboardingMachine.ts` to `['value_proposition', 'parent_name', 'relationship', 'family_name', 'account']`. In `FamilyComposition.tsx`, resolve onboarding after family document creation without dispatching child creation.
- **GREEN Command**:
  ```bash
  npx vitest run src/onboarding/useOnboardingMachine.test.ts src/onboarding/OnboardingFlow.test.tsx
  ```
- **Regression Tests**:
  Verify existing tests in `src/onboarding/onboarding.existingFamilyRegression.test.tsx` continue to pass.
- **Security Invariants**:
  Parent user document creation remains bound to authenticated Firebase Auth UID. No client-generated IDs for unauthenticated entities.
- **Commit Boundary**: `feat(onboarding): streamline onboarding machine to family-only flow`

---

### Task 2: Parent Home Zero-Child State & Unblocking Focus Mode

- **Goal**: Ensure owner-only families (0 children) can load and view `ParentLivingHome.tsx` normally. Replace the blocking full-screen takeover in `focusMode.ts` with a non-blocking welcome card within `ParentLivingHome`.
- **Files to Inspect**:
  - `src/lib/focusMode.ts`
  - `src/components/home/ParentLivingHome.tsx`
  - `src/components/FocusModeDashboard.tsx`
  - `src/components/next-action/NextActionCard.tsx`
  - `src/pages/NoFamilyChoice.tsx`
  - `src/pages/ContinueSetup.tsx`
- **Files to Modify/Create**:
  - `src/lib/focusMode.ts`: decouple `isFocusMode` from `familyMembers <= 1` or `tasks === 0`. Focus mode should only trigger on explicit user toggle or specific task-execution workflows, never block a valid empty family home.
  - `src/components/home/ParentLivingHome.tsx`: render a welcoming zero-child card when `children.length === 0`:
    "Welcome to Queki! Your family workspace is ready." with buttons `[+ Add a child]` (opens AddChildModal) and `[Invite another parent]`.
  - `src/components/parent/ParentDashboard.focusMode.test.tsx`: update to verify zero-child family renders `ParentLivingHome` rather than `FocusModeDashboard`.
  - `src/lib/focusMode.test.ts`: verify focus mode state calculations for 0 children.
- **RED Test Command**:
  ```bash
  npx vitest run src/components/parent/ParentDashboard.focusMode.test.tsx
  ```
  *Expected Failure*: Fails because 0 children previously forced `isFocusMode = true` and rendered `FocusModeDashboard` instead of `ParentLivingHome`.
- **Minimal GREEN Implementation**:
  Update `getFocusModeState` in `src/lib/focusMode.ts` so `familyMembers <= 1` does not force `isFocusMode = true`. In `ParentLivingHome.tsx`, add conditional zero-child banner when `children.length === 0`.
- **GREEN Command**:
  ```bash
  npx vitest run src/components/parent/ParentDashboard.focusMode.test.tsx src/lib/focusMode.test.ts
  ```
- **Regression Tests**:
  `src/components/parent/ParentDashboard.activeFamily.test.tsx`
- **Security Invariants**:
  Read queries scoped strictly to parent's `familyId`.
- **Commit Boundary**: `feat(home): support first-class zero-child parent home state`

---

### Task 3: Onboarding Draft Schema & Abandonment Compatibility

- **Goal**: Make `onboardingDraft.ts` robust against abandoned sessions. Existing localStorage drafts with or without `childFirstName` must deserialize safely and allow parents to complete onboarding without orphaned child creations.
- **Files to Inspect**:
  - `src/onboarding/lib/onboardingDraft.ts`
  - `src/onboarding/lib/onboardingSetup.ts`
  - `src/onboarding/lib/onboardingDraft.test.ts`
- **Files to Modify/Create**:
  - `src/onboarding/lib/onboardingDraft.ts`: mark `childFirstName`, `childAge`, `childAvatar` as optional/deprecated in `OnboardingDraft` interface. Ensure `loadDraft` strips or ignores legacy child fields and validates valid parent/family state.
  - `src/onboarding/lib/onboardingDraft.test.ts`: add unit tests for:
    1. Loading a draft created by the new flow (family only).
    2. Migrating a legacy draft containing `childFirstName` without crashing or forcing child creation.
    3. Recovering when localStorage is empty or corrupted.
- **RED Test Command**:
  ```bash
  npx vitest run src/onboarding/lib/onboardingDraft.test.ts
  ```
  *Expected Failure*: Draft validator rejects drafts without `childFirstName` or fails migration assertions.
- **Minimal GREEN Implementation**:
  Update draft schema validation in `onboardingDraft.ts` to make child fields strictly optional and ignore them during post-auth execution.
- **GREEN Command**:
  ```bash
  npx vitest run src/onboarding/lib/onboardingDraft.test.ts src/onboarding/lib/onboardingSetup.test.ts
  ```
- **Regression Tests**:
  `src/onboarding/lib/onboardingSetup.test.ts`
- **Security Invariants**:
  Draft storage remains in client `localStorage` only; no sensitive credentials stored.
- **Commit Boundary**: `refactor(onboarding): make onboarding draft schema family-centric and backwards-compatible`

---

### Task 4: Add Child Modal UX (Two Explicit Paths)

- **Goal**: Transform `AddChildModal.tsx` into a two-path chooser:
  1. "On their own device" (generates `new_child_join` QR modal)
  2. "Set up without a device" (direct form to create managed child on this device)
- **Files to Inspect**:
  - `src/components/AddChildModal.tsx`
  - `src/components/ConnectChildDeviceQrModal.tsx`
  - `src/pages/Family.tsx`
- **Files to Modify/Create**:
  - `src/components/AddChildModal.tsx`:
    - Screen 1: Choice between:
      - Option A: "On their own device" (Icon: Smartphone / Tablet) -> opens child QR invitation flow with intent `new_child_join`.
      - Option B: "Set up without a device" (Icon: UserPlus) -> presents direct form (Name, Avatar, optional PIN) to create a managed child.
    - Screen 2 (if Option B chosen): Direct child creation form submitting via existing `createManagedMember` API.
  - `src/components/AddChildModal.test.tsx`: test that both options render, selecting Option A initiates QR generation with intent `new_child_join`, and Option B invokes direct managed child creation.
- **RED Test Command**:
  ```bash
  npx vitest run src/components/AddChildModal.test.tsx
  ```
  *Expected Failure*: Test file does not exist or fails on missing path selection buttons.
- **Minimal GREEN Implementation**:
  Implement state machine inside `AddChildModal.tsx` (`choice` | `without_device` | `qr_invite`).
- **GREEN Command**:
  ```bash
  npx vitest run src/components/AddChildModal.test.tsx
  ```
- **Regression Tests**:
  Verify managed child creation invokes existing `api.ts:addManagedMember` with full validation.
- **Security Invariants**:
  Parent must be authenticated with active `familyId`.
- **Commit Boundary**: `feat(family): provide two explicit Add Child paths in AddChildModal`

---

### Task 5: QR Intent Backend Architecture (`generateChildQrToken` & `submitChildQrJoinRequest`)

- **Goal**: Add explicit `intent` (`'new_child_join'` | `'existing_child_device_bind'`) and optional `targetChildId` to QR session generation and join requests in Cloud Functions.
- **Files to Inspect**:
  - `functions/src/childQrOnboarding.ts`
  - `functions/src/childQrOnboarding.test.ts`
  - `src/lib/childQrOnboardingApi.ts`
- **Files to Modify/Create**:
  - `functions/src/childQrOnboarding.ts`:
    - `generateChildQrTokenImpl`:
      - Accept `{ intent: 'new_child_join' | 'existing_child_device_bind', targetChildId?: string }`.
      - Validate: if `intent === 'existing_child_device_bind'`, `targetChildId` is mandatory and must belong to caller's `familyId`. If `intent === 'new_child_join'`, `targetChildId` must NOT be supplied.
      - Store `intent` and `targetChildId` in `child_qr_sessions` and `childQrTokenLookup`.
    - `scanChildQrTokenImpl`:
      - Return `{ valid: true, familyName, intent, targetChildName?: string }`.
    - `submitChildQrJoinRequestImpl`:
      - Read session's authoritative `intent` and `targetChildId`.
      - Save `intent` and `targetChildId` onto `child_qr_join_requests/{requestId}`.
      - Tailor parent notification:
        - `new_child_join`: `"${requesterDisplayName} wants to join your family"`
        - `existing_child_device_bind`: `"${requesterDisplayName} wants to connect a device"`
  - `functions/src/childQrOnboarding.test.ts`:
    - Unit tests asserting `generateChildQrToken` validates intent and targetChildId correctly.
    - Unit tests asserting `submitChildQrJoinRequest` propagates intent and generates distinct notification text.
- **RED Test Command**:
  ```bash
  npx vitest run functions/src/childQrOnboarding.test.ts -t "intent"
  ```
  *Expected Failure*: Fails because `generateChildQrToken` does not yet accept or validate `intent`.
- **Minimal GREEN Implementation**:
  Add validation and persistence for `intent` and `targetChildId` in `childQrOnboarding.ts`.
- **GREEN Command**:
  ```bash
  npx vitest run functions/src/childQrOnboarding.test.ts
  ```
- **Regression Tests**:
  `src/lib/childQrOnboardingApi.test.ts`
- **Security Invariants**:
  Child client cannot set or override `intent` or `targetChildId`; both are bound strictly by server-side session lookup.
- **Commit Boundary**: `feat(functions): introduce explicit QR onboarding intents and scoped sessions`

---

### Task 6: QR Approval Backend Execution (`approveChildQrJoinRequest`)

- **Goal**: Implement server-side transactional child provisioning on approval for `new_child_join`, while maintaining safe binding for `existing_child_device_bind`.
- **Files to Inspect**:
  - `functions/src/childQrOnboarding.ts`
  - `functions/src/childQrOnboarding.test.ts`
- **Files to Modify/Create**:
  - `functions/src/childQrOnboarding.ts` (`approveChildQrJoinRequestImpl`):
    - Multi-Phase Durable Provisioning State Machine (Auth is NOT Firestore-atomic):
      1. Phase A — Reserve Identity Transactionally (Firestore Transaction):
         - Check request exists, status is `'pending'`.
         - If `intent === 'new_child_join'`:
           - Derive deterministic identity: `newChildId = child_qr_${requestId}`, `authUid = newChildId`.
           - Set request `provisioningState = 'reserved'` and `reservedChildId = newChildId`. Do NOT mark `status = 'approved'` yet.
         - If `intent === 'existing_child_device_bind'`:
           - Validate target child exists in `familyId`, update request to `'approved'` directly.
         - If legacy / pre-release request (`intent === undefined`):
           - Fail-closed: require explicit `selectedManagedChildId` from parent, zero new children, zero new wallets.
      2. Phase B — Auth Provisioning Outside Firestore Transaction:
         - Lookup Auth user `auth.getUser(authUid)`: if not found, call `auth.createUser({ uid: authUid, displayName: requesterDisplayName })`.
         - Retry-safe and idempotent across retries.
      3. Phase C — Canonical Managed-Child Firestore Provisioning:
         - Create/reconcile canonical profile: `users/${newChildId}` with all required fields (`avatarUrl`, `rewardPoints: 0`, `lifetimeXP: 0`, `currentStreak: 0`, `longestStreak: 0`, `lastActiveDate`).
         - Create/reconcile canonical wallet: `families/${familyId}/wallets/${newChildId}` with `{ balance: 0, createdAt }`. (NEVER root `wallets/`).
         - Create/reconcile canonical child login record: `families/${familyId}/childLogins/${newChildId}` with `{ status: 'enabled', authUid }`.
      4. Phase D — Finalize Request Transactionally (Firestore Transaction):
         - Verify same provisioning identity.
         - Mark request `status = 'approved'`, `selectedManagedChildId = newChildId`, `approvedChildId = newChildId`, `provisioningState = 'complete'`, `resolvedAtMs`, `resolvedBy`.
         - Record idempotency receipt.
    - Idempotency & Replay Protection:
      - If request is already `'approved'`, return `{ success: true, selectedManagedChildId: request.selectedManagedChildId, status: 'approved' }` without duplicating user, wallet, or Auth user.
  - `functions/src/childQrOnboarding.test.ts`:
    - Add tests for:
      - `new_child_join` creates wallet at `families/${familyId}/wallets/${childId}` and NEVER root `wallets/`.
      - Auth user created prior to final approval.
      - Retry after Auth creation succeeds without duplicate Auth user.
      - Concurrent approval calls converge to exact same child and wallet.
      - Legacy requests without intent require explicit child selection and never create new children or wallets.
      - `existing_child_device_bind` binds to target without creating new child/wallet.
      - Rejection transitions request to `'rejected'` without creating user/wallet.
- **RED Test Command**:
  ```bash
  npx vitest run functions/src/childQrOnboarding.test.ts -t "approveChildQrJoinRequest"
  ```
  *Expected Failure*: Fails because `new_child_join` logic is not yet implemented.
- **Minimal GREEN Implementation**:
  Implement transaction branch in `approveChildQrJoinRequestImpl` for `new_child_join`.
- **GREEN Command**:
  ```bash
  npx vitest run functions/src/childQrOnboarding.test.ts
  ```
- **Regression Tests**:
  `tests/functions/childQrOnboarding.integration.test.ts`
- **Security Invariants**:
  Only authenticated parent/owner of the family can call `approveChildQrJoinRequest`. Child creation must be 100% server-authoritative.
- **Commit Boundary**: `feat(functions): atomic new child creation on QR join approval with idempotency`

---

### Task 7: Child QR Token Exchange Backend (`exchangeApprovedChildQrRequest`)

- **Goal**: Ensure `exchangeApprovedChildQrRequestImpl` issues a valid Firebase Custom Auth Token for the newly created or bound child.
- **Files to Inspect**:
  - `functions/src/childQrOnboarding.ts`
  - `functions/src/childQrOnboarding.test.ts`
- **Files to Modify/Create**:
  - `functions/src/childQrOnboarding.ts`:
    - Verify `exchangeApprovedChildQrRequestImpl` retrieves `approvedChildId`, ensures Firebase Auth account exists for `approvedChildId`, and generates custom auth token with claims `{ familyId, role: 'child' }`.
    - Mark request as `'exchanged'` or record exchange timestamp to prevent replay attacks.
  - `functions/src/childQrOnboarding.test.ts`:
    - Add test verifying custom token creation and claims for `new_child_join` approvals.
- **RED Test Command**:
  ```bash
  npx vitest run functions/src/childQrOnboarding.test.ts -t "exchangeApprovedChildQrRequest"
  ```
  *Expected Failure*: Token claims or exchange checks fail for newly created child IDs.
- **Minimal GREEN Implementation**:
  Ensure child auth UID is provisioned and token generated with valid family claims.
- **GREEN Command**:
  ```bash
  npx vitest run functions/src/childQrOnboarding.test.ts
  ```
- **Regression Tests**:
  `src/pages/ChildQrScanPage.test.tsx`
- **Security Invariants**:
  Child device must prove possession of high-entropy `requestSecretHash` established at request submission.
- **Commit Boundary**: `feat(functions): complete token exchange for new child join requests`

---

### Task 8: QR Approval Center UI (`ChildQrDeviceJoinApprovalCard` & `ApprovalCenter`)

- **Goal**: Eliminate the existing-child selector dropdown from `ChildQrDeviceJoinApprovalCard` when `intent === 'new_child_join'`. Display clear copy explaining that approving adds a new child to the family.
- **Files to Inspect**:
  - `src/components/ChildQrDeviceJoinApprovalCard.tsx`
  - `src/components/parent/ApprovalCenter.tsx`
  - `src/components/parent/ApprovalCenter.childJoin.test.tsx`
  - `src/components/parent/ApprovalCenter.test.tsx`
- **Files to Modify/Create**:
  - `src/components/ChildQrDeviceJoinApprovalCard.tsx`:
    - When `request.intent === 'new_child_join'`:
      - Header: "New Child Joining"
      - Body: `<requesterDisplayName> wants to join your family on <deviceLabel>`
      - Subtext: "Approving will create a new child profile and wallet."
      - NO `<select>` dropdown for existing managed children.
      - Direct `[Approve]` and `[Decline]` buttons.
    - When `request.intent === 'existing_child_device_bind'`:
      - Header: "Connect Child Device"
      - Body: `<requesterDisplayName> wants to connect a personal device to <targetChildName>`
      - Direct `[Approve]` and `[Decline]` buttons.
  - `src/components/parent/ApprovalCenter.childJoin.test.tsx`:
    - Test that `new_child_join` card contains no dropdown and calls `approveChildQrJoinRequest` with `{ requestId }`.
    - Test that `existing_child_device_bind` card displays target child name.
- **RED Test Command**:
  ```bash
  npx vitest run src/components/parent/ApprovalCenter.childJoin.test.tsx
  ```
  *Expected Failure*: Fails because component renders existing child selector dropdown unconditionally.
- **Minimal GREEN Implementation**:
  Conditionally branch card rendering based on `request.intent`.
- **GREEN Command**:
  ```bash
  npx vitest run src/components/parent/ApprovalCenter.childJoin.test.tsx src/components/parent/ApprovalCenter.test.tsx
  ```
- **Regression Tests**:
  `src/pages/ReviewPage.test.tsx`
- **Security Invariants**:
  Approve/Decline buttons disabled while mutation is in flight to prevent double submissions.
- **Commit Boundary**: `feat(ui): update Approval Center QR cards to honor join intent without child selector`

---

### Task 9: Family Screen Simplification (`src/pages/Family.tsx`)

- **Goal**: Clean up the Family page:
  1. Remove standalone top-level `Connect Child Device` button.
  2. Remove duplicate `Manage family` labels and jumpy accordion sections.
  3. Provide a single, prominent `Family Settings` link navigating directly to `/settings/family`.
  4. Ensure primary actions are strictly `+ Add child` and `Invite adult`.
- **Files to Inspect**:
  - `src/pages/Family.tsx`
  - `src/components/family/FamilyWorld.tsx`
  - `src/components/family/FamilyWorldScene.tsx`
- **Files to Modify/Create**:
  - `src/pages/Family.tsx`:
    - Remove standalone top-level `Connect Child Device` button.
    - Remove duplicate `Manage family` accordion blocks that repeat member lists or expand off-screen.
    - Add clean `Family Settings` button linking to `/settings/family`.
    - Ensure `+ Add child` opens `AddChildModal` with the two new paths.
  - `src/pages/Family.test.tsx` (create or update):
    - Assert `Connect Child Device` is not rendered at top level.
    - Assert `Family Settings` link is present.
    - Assert `+ Add child` button triggers modal.
- **RED Test Command**:
  ```bash
  npx vitest run src/pages/Family.test.tsx
  ```
  *Expected Failure*: Assertions for removed standalone button or missing settings link fail.
- **Minimal GREEN Implementation**:
  Refactor `Family.tsx` header and action rows according to the specification.
- **GREEN Command**:
  ```bash
  npx vitest run src/pages/Family.test.tsx
  ```
- **Regression Tests**:
  `src/components/layout/AppLayout.routing.test.tsx`
- **Security Invariants**:
  Family settings and invitation controls restricted to parent/owner roles.
- **Commit Boundary**: `refactor(family): simplify family screen actions and unify family settings entry`

---

### Task 10: Canonical Manage Child Surface (`ManageChildDialog`)

- **Goal**: Create a single canonical `ManageChild` dialog/surface containing: Profile (name, avatar), Devices & Access (`Connect personal device`), Money / Wallet, Child Settings (PIN reset / login), and Danger Zone (`Remove child`).
- **Files to Inspect**:
  - `src/components/family/MemberDetailSheet.tsx`
  - `src/components/family/EditMemberModal.tsx`
  - `src/components/family/ChildLoginSection.tsx`
  - `src/lib/childLoginApi.ts`
- **Files to Modify/Create**:
  - `src/components/family/ManageChildDialog.tsx` (new component):
    - Section 1: Profile (view/edit display name and avatar).
    - Section 2: Devices & Access (view connected devices, button `Connect personal device` opening `ConnectChildDeviceQrModal` with `intent: 'existing_child_device_bind'` and `targetChildId: child.id`).
    - Section 3: Money / Wallet (view current balance, points, allowance config).
    - Section 4: Child Settings (login username, PIN reset via `childLoginApi:resetChildPassword`).
    - Section 5: Danger Zone (`Remove child` button triggering confirmation modal and calling `childLoginApi:deleteChild`).
  - `src/components/family/ManageChildDialog.test.tsx`:
    - Test rendering of all 5 sections.
    - Test clicking `Connect personal device` opens QR modal scoped to child.
    - Test clicking `Remove child` triggers confirmation and calls delete API.
- **RED Test Command**:
  ```bash
  npx vitest run src/components/family/ManageChildDialog.test.tsx
  ```
  *Expected Failure*: Component does not exist.
- **Minimal GREEN Implementation**:
  Assemble `ManageChildDialog.tsx` integrating existing sub-components (`ChildLoginSection`, avatar picker, delete confirmation).
- **GREEN Command**:
  ```bash
  npx vitest run src/components/family/ManageChildDialog.test.tsx
  ```
- **Regression Tests**:
  `src/components/family/MemberDetailSheet.tsx`
- **Security Invariants**:
  Child deletion relies exclusively on backend Cloud Function `deleteChild`, preserving audit logs and wallet balance safety.
- **Commit Boundary**: `feat(family): create canonical ManageChildDialog with profile, device connect, and danger zone`

---

### Task 11: Fix Black-Screen Regression in Child Management

- **Goal**: Eliminate the black-screen bug when tapping "Manage Member" in `MemberDetailSheet.tsx`. Tapping a child card must directly open `ManageChildDialog` (or safely fallback to error boundary).
- **Files to Inspect**:
  - `src/components/family/MemberDetailSheet.tsx`
  - `src/pages/Family.tsx`
  - `src/App.tsx`
- **Files to Modify/Create**:
  - `src/pages/Family.tsx`:
    - When tapping a child avatar/card in `FamilyWorld` or child list, directly open `ManageChildDialog` with the selected child.
    - If `MemberDetailSheet` is opened, provide `onManageMember={(member) => openManageChild(member)}` so it never calls `navigate('/family/members/' + id)` to a non-existent route.
  - `src/App.tsx`:
    - Add safety route redirect or error boundary for `/family/members/:id` -> `/family` to prevent black screens if an old URL is accessed directly.
  - `src/pages/Family.manageChild.test.tsx` (new test):
    - Verify clicking a child card opens `ManageChildDialog`.
    - Verify clicking Manage Member in `MemberDetailSheet` opens `ManageChildDialog` without navigating to unmapped routes.
- **RED Test Command**:
  ```bash
  npx vitest run src/pages/Family.manageChild.test.tsx
  ```
  *Expected Failure*: Fails verifying that `MemberDetailSheet` triggers `onManageMember` or that unmapped route does not throw.
- **Minimal GREEN Implementation**:
  Pass `onManageMember` handler in `Family.tsx` and wire child cards directly to `selectedManageChild`.
- **GREEN Command**:
  ```bash
  npx vitest run src/pages/Family.manageChild.test.tsx
  ```
- **Regression Tests**:
  `src/App.authRoutingOnboarding.test.tsx`
- **Security Invariants**:
  Client-side navigation guarded against unauthenticated access.
- **Commit Boundary**: `fix(family): resolve child management black-screen navigation bug`

---

### Task 12: Generic Placeholders & Production Copy Hygiene

- **Goal**: Replace all personal/developer test names (e.g. `Ali`, `Kumutlu`) across production forms, placeholders, and examples with neutral, generic names (e.g. `Alex`, `Sam`, `Jamie`).
- **Files to Inspect**:
  - `src/pages/ChildQrScanPage.tsx`
  - `src/components/AddChildModal.tsx`
  - `src/onboarding/steps/Step2ParentName.tsx`
  - `src/onboarding/steps/Step6FamilyName.tsx`
- **Files to Modify/Create**:
  - `src/pages/ChildQrScanPage.tsx`: ensure placeholder is `"e.g. Alex"`.
  - `src/components/AddChildModal.tsx`: placeholder `"e.g. Sam"`.
  - `src/onboarding/steps/Step2ParentName.tsx`: placeholder `"e.g. Sarah"`.
  - `src/onboarding/steps/Step6FamilyName.tsx`: placeholder `"e.g. The Smiths"`.
  - `src/lib/copyHygiene.test.ts` (new test):
    - Grep/assert that production source code in `src/` does not contain developer family names in user-visible placeholder strings.
- **RED Test Command**:
  ```bash
  npx vitest run src/lib/copyHygiene.test.ts
  ```
  *Expected Failure*: Fails finding stale name strings.
- **Minimal GREEN Implementation**:
  Replace stale placeholder strings with generic examples.
- **GREEN Command**:
  ```bash
  npx vitest run src/lib/copyHygiene.test.ts
  ```
- **Regression Tests**:
  `src/pages/ChildQrScanPage.test.tsx`
- **Security Invariants**:
  No PII or private developer data exposed in production source.
- **Commit Boundary**: `chore(copy): sanitize production placeholders to neutral generic names`

---

### Task 13: Firestore Security Rules Verification

- **Goal**: Verify and enforce Firestore security rules for zero-child families, child creation by parents, and parent-only approvals.
- **Files to Inspect**:
  - `firestore.rules`
  - `tests/firestore/childQrOnboarding.rules.test.ts`
- **Files to Modify/Create**:
  - `firestore.rules`:
    - Confirm `child_qr_join_requests/{requestId}`:
      - `allow read: if isParent(resource.data.familyId);`
      - `allow write: if false;` (Cloud Functions handle all mutations).
    - Confirm `users/{userId}`:
      - Parents can create managed child profiles where `role == 'child'` and `familyId == request.auth.token.familyId`.
    - Confirm zero-child families:
      - Family doc read allowed for family owner even when no members/children subcollection documents exist yet.
  - `tests/firestore/childQrOnboarding.rules.test.ts`:
    - Add rule test: parent can read their pending QR join requests.
    - Add rule test: non-family members and children cannot read parent join requests.
    - Add rule test: clients cannot directly write or update `child_qr_join_requests`.
- **RED Test Command**:
  ```bash
  npm run test:rules -- -t "childQrOnboarding"
  ```
  *Expected Failure*: Any rule gap causes test assertion failure.
- **Minimal GREEN Implementation**:
  Validate existing rules match the required constraints. (Rules were deployed and verified in previous hotfix).
- **GREEN Command**:
  ```bash
  npm run test:rules -- -t "childQrOnboarding"
  ```
- **Regression Tests**:
  `tests/firestore/childQrOnboarding.rules.test.ts`
- **Security Invariants**:
  Zero-trust client writes on `child_qr_join_requests`. All state transitions executed via Cloud Functions.
- **Commit Boundary**: `test(rules): add security rules regression coverage for zero-child and QR join requests`

---

### Task 14: Comprehensive Unit & Component Test Suite

- **Goal**: Consolidate and execute all frontend unit and component tests covering onboarding, focus mode, modals, and approval cards.
- **Files to Inspect & Run**:
  - `src/onboarding/useOnboardingMachine.test.ts`
  - `src/onboarding/OnboardingFlow.test.tsx`
  - `src/onboarding/lib/onboardingDraft.test.ts`
  - `src/lib/focusMode.test.ts`
  - `src/components/parent/ParentDashboard.focusMode.test.tsx`
  - `src/components/AddChildModal.test.tsx`
  - `src/components/ChildQrDeviceJoinApprovalCard.test.tsx`
  - `src/components/family/ManageChildDialog.test.tsx`
  - `src/pages/Family.test.tsx`
  - `src/pages/ChildQrScanPage.test.tsx`
  - `src/pages/ReviewPage.test.tsx`
- **Execution Command**:
  ```bash
  npx vitest run src/onboarding src/components/family src/components/parent src/lib/focusMode.test.ts
  ```
- **Regression Tests**:
  All unit tests in `src/` must pass with zero warnings and zero regressions.
- **Security Invariants**:
  No mocking of security invariants in unit tests without asserting fail-closed behavior.
- **Commit Boundary**: `test(frontend): verify all onboarding, family, and child management unit tests`

---

### Task 15: Backend Cloud Function Integration Tests

- **Goal**: Comprehensive test coverage of `childQrOnboarding` Cloud Functions in emulator environment.
- **Files to Inspect & Run**:
  - `functions/src/childQrOnboarding.test.ts`
  - `tests/functions/childQrOnboarding.integration.test.ts`
- **Test Scenarios**:
  1. `generateChildQrToken` with `intent: 'new_child_join'`.
  2. `generateChildQrToken` with `intent: 'existing_child_device_bind'` and valid `targetChildId`.
  3. `generateChildQrToken` with invalid `targetChildId` rejects with `permission-denied` or `not-found`.
  4. `submitChildQrJoinRequest` stores session intent and dispatches correct notification.
  5. `approveChildQrJoinRequest` for `new_child_join` creates child doc + wallet + auth record.
  6. `approveChildQrJoinRequest` for `existing_child_device_bind` binds without creating duplicate child/wallet.
  7. Concurrent/repeated approval calls are strictly idempotent.
  8. Legacy request without intent fails closed to existing child binding.
  9. Rejection leaves request in `rejected` status with no child created.
  10. `exchangeApprovedChildQrRequest` issues valid custom auth token with correct claims.
- **Execution Command**:
  ```bash
  npx vitest run functions/src/childQrOnboarding.test.ts tests/functions/childQrOnboarding.integration.test.ts
  ```
- **Commit Boundary**: `test(functions): add comprehensive integration tests for QR join and bind flows`

---

### Task 16: Playwright End-to-End Test Suite (Chromium & WebKit)

- **Goal**: End-to-end verification across both desktop/mobile viewports in Chromium and WebKit.
- **Files to Inspect**:
  - `tests/e2e/childQrOnboarding.spec.ts`
  - `scripts/onboarding-gate/launcher.ts`
  - `playwright.config.ts`
- **Files to Modify/Create**:
  - `tests/e2e/familyOnboardingChildManagement.spec.ts` (new comprehensive E2E spec):
    - **Flow A**: Parent Signs Up -> Creates Family -> Lands immediately on Parent Home (zero children, zero tasks, zero rewards) -> Sees welcome card with "+ Add a child".
    - **Flow B**: Parent clicks "+ Add a child" -> Chooses "On their own device" -> QR displayed -> Child browser opens `/join-qr?token=...` -> Child enters "Jamie" -> Submits -> Parent opens Approval Center -> Sees "Jamie wants to join your family" (NO child selector) -> Approves -> Child automatically receives approval -> Exchanges token -> Child lands on Child Home.
    - **Flow C**: Parent clicks "+ Add a child" -> Chooses "Set up without a device" -> Enters "Sam" -> Direct managed child created -> Appears in Family world.
    - **Flow D**: Parent opens Family -> Taps "Sam" -> Canonical `Manage Child` dialog opens (NO black screen) -> Clicks "Connect personal device" -> QR displayed -> Child device scans -> Parent approves -> Device bound to "Sam".
    - **Flow E**: Parent opens `Manage Child` for "Sam" -> Danger Zone -> Removes child -> Child deleted and removed from Family world.
- **Execution Commands**:
  - **Chromium**:
    ```bash
    npm run test:e2e:onboarding:chromium
    ```
  - **WebKit**:
    ```bash
    npm run test:e2e:onboarding:webkit
    ```
- **Commit Boundary**: `test(e2e): add end-to-end Playwright specs for Flows A-E in Chromium and WebKit`

---

### Task 17: Migration & Pre-Release Pending Request Safety

- **Goal**: Formulate safe operational handling for active pre-release pending QR join requests so no pre-release request creates unintended child profiles or wallets.
- **Files to Inspect**:
  - `functions/src/childQrOnboarding.ts`
  - `scripts/query_live_request_p0_3.cjs`
- **Implementation Strategy**:
  1. In `approveChildQrJoinRequestImpl`, if `request.intent` is missing/undefined:
     - Require `selectedManagedChildId` explicitly in parent approval call.
     - Never default to `new_child_join`.
     - Log deprecation warning: `"Approving legacy pre-release QR request without explicit intent"`.
  2. If a pre-release session has expired, return standard friendly expired message prompting a fresh QR scan.
- **Commit Boundary**: `fix(safety): enforce fail-closed legacy request handling during transition`

---

### Task 18: Verification & Rollout Plan

- **Goal**: Detailed, repeatable verification runbooks before deployment authorization.
- **Checklist**:
  1. Local unit & function test pass:
     ```bash
     npm test
     ```
  2. Firestore security rules pass:
     ```bash
     npm run test:rules
     ```
  3. E2E browser tests pass on Chromium:
     ```bash
     npm run test:e2e:onboarding:chromium
     ```
  4. E2E browser tests pass on WebKit:
     ```bash
     npm run test:e2e:onboarding:webkit
     ```
  5. Typecheck & lint clean:
     ```bash
     npm run typecheck && npm run lint
     ```
  6. Git status verified clean with no unrelated drift.
  7. Staged deployment order (when authorized in Phase 2):
     - Step 1: Deploy Firestore Security Rules (if rules changed).
     - Step 2: Deploy Cloud Functions (`childQrOnboarding` + any deletion updates).
     - Step 3: Deploy Hosting bundle.
     - Step 4: Live smoke verification and physical QA script execution.
- **Commit Boundary**: `docs(release): document verification and staged deployment rollout plan`

---

## E2E Testing Strategy (Flows A, B, C, D, E)

| Flow | Description | Actor(s) | Expected Outcome | Browser Engines |
| :--- | :--- | :--- | :--- | :--- |
| **Flow A** | Family-Only Onboarding | New Parent | Signs up, names family, reaches Parent Living Home with 0 children, 0 tasks. Unblocked. | Chromium, WebKit |
| **Flow B** | Add Child via QR (`new_child_join`) | Parent + New Child Device | Parent generates QR. Child scans, submits name. Parent sees approval card (no dropdown), approves. Child created + logged in. | Chromium, WebKit |
| **Flow C** | Add Child without Device | Parent | Parent enters child name directly in modal. Managed child created and appears on Family screen. | Chromium, WebKit |
| **Flow D** | Existing Child Device Bind (`existing_child_device_bind`) | Parent + Child Device | Parent taps existing child -> Manage Child -> Devices -> Connect device. Child scans. Device bound to exact existing child. | Chromium, WebKit |
| **Flow E** | Family Simplification & Child Removal | Parent | Family settings link works; Manage Child Danger Zone removes child cleanly via backend. | Chromium, WebKit |

---

## 20 Explicit Self-Review Checks

1. **Does the onboarding flow allow a parent to reach Home with 0 children, 0 tasks, 0 rewards?**
   *Yes*. The pre-auth wizard terminates at Step 6/7 (Family Name & Account). Post-auth `FamilyComposition.tsx` provisions only the family document and transitions immediately to Home without requiring child, task, or reward creation.

2. **Does `focusMode.ts` prevent zero-child families from seeing `ParentLivingHome`?**
   *Previously yes, but resolved by Task 2*. The check `familyMembers <= 1` is decoupled from `isFocusMode` so new families see the normal `ParentLivingHome` interface with an empty-state welcome card.

3. **Does `ParentLivingHome.tsx` crash or misbehave with 0 children?**
   *No*. Task 2 adds explicit empty-state guards for `children.length === 0`, rendering a clean invitation card to add a child or invite another parent, without crashing tasks or points widgets.

4. **How does `onboardingDraft.ts` handle previous draft states stored in localStorage?**
   *Backwards compatible*. Task 3 ensures draft validation ignores obsolete child fields (`childFirstName`, `childAge`) while preserving parent and family names.

5. **Where is `+ Add child` located, and what choices does it present?**
   Located prominently on the Family screen and in the Parent Living Home welcome card. It presents two clear options: "On their own device" (QR) and "Set up without a device" (direct form).

6. **How does `generateChildQrToken` distinguish between new child join vs existing child device bind?**
   Via an explicit `intent` parameter: `'new_child_join'` (no target child allowed) vs `'existing_child_device_bind'` (requires valid `targetChildId` belonging to caller's family).

7. **What fields are stored in `child_qr_sessions` and `childQrTokenLookup`?**
   `tokenHash`, `familyId`, `createdByParentUid`, `intent`, `targetChildId` (optional), `expiresAt`, `status`, `createdAt`.

8. **What does `submitChildQrJoinRequest` do with `intent` and `targetChildId`?**
   It reads them authoritatively from the verified session document and writes them directly to `child_qr_join_requests/{requestId}` while formatting the parent notification accordingly.

9. **What does `approveChildQrJoinRequest` do when `intent === 'new_child_join'`?**
   Within an atomic Firestore transaction, it creates `users/${childUid}`, `wallets/${childUid}`, provisions authentication credentials, sets `status: 'approved'`, and assigns `approvedChildId: childUid`.

10. **What does `approveChildQrJoinRequest` do when `intent === 'existing_child_device_bind'`?**
    It validates `targetChildId`, sets `status: 'approved'`, and assigns `approvedChildId: targetChildId` without creating any new user or wallet document.

11. **How are duplicate/concurrent approvals prevented (idempotency)?**
    The approval function operates inside a Firestore transaction. If the request status is already `'approved'`, it immediately returns the existing `approvedChildId` without performing duplicate writes.

12. **What happens to pre-release requests with `intent === undefined`?**
    They fail closed to `existing_child_device_bind`, requiring the parent to supply an explicit `selectedManagedChildId`, ensuring no legacy request accidentally creates a phantom child.

13. **Does the parent Approval Center show an existing-child dropdown for `new_child_join`?**
    *No*. The selector dropdown is completely removed for `new_child_join` cards.

14. **What causes the current black-screen bug when tapping "Manage child"?**
    `MemberDetailSheet.tsx:204` called `navigate('/family/members/' + member.id)` when `onManageMember` prop was omitted. `App.tsx` has no route for `/family/members/:id`, leaving the viewport blank. Fixed in Tasks 10 & 11 by wiring the canonical dialog directly.

15. **What is the canonical `Manage <Child>` surface and what sections does it contain?**
    `ManageChildDialog`, containing:
    - Profile (name, avatar)
    - Devices & Access (`Connect personal device`)
    - Money / Wallet (balance, allowance)
    - Child Settings (login, PIN reset)
    - Danger Zone (`Remove child`)

16. **How does `Remove child` work and what security guarantees apply?**
    It uses the existing backend Cloud Function `deleteChild` via `childLoginApi.ts`. It verifies parent authorization, deletes child auth/user records, and cleans up subcollections securely.

17. **What happens to the standalone "Connect Child Device" button on the Family screen?**
    Removed. Device connection is now scoped strictly under the child's `Manage <Child>` surface.

18. **How are duplicate "Manage family" accordions on the Family screen resolved?**
    Removed and replaced with a single `Family Settings` link navigating directly to `/settings/family`.

19. **Are production placeholders generic (e.g. Alex, Sam) without personal names?**
    *Yes*. Sanitized and verified across all onboarding and child creation components in Task 12.

20. **Are Chromium and WebKit E2E tests planned for all core flows?**
    *Yes*. Task 16 defines end-to-end Playwright tests executed via `scripts/onboarding-gate/launcher.ts` on both Chromium and WebKit.
