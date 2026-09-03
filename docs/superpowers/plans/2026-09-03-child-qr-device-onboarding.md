# One-Time QR Child Device Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Base Commit SHA:** `c9905f8615f7c5f0b250ec99e96e9434ffa8c6e0`
**Branch:** `feature/child-qr-onboarding`
**Target Path:** `docs/superpowers/plans/2026-09-03-child-qr-device-onboarding.md`


**Goal:** Securely connect a child device to an **EXISTING managed-child profile** in Queki via a parent-generated, 15-minute, single-use, high-entropy QR code with server-authoritative parent approval and custom token exchange.

---

## Architectural Invariants & Critical Identity Rules

1. **REUSE EXISTING MANAGED CHILD IDENTITY (NO NEW CHILD / NO NEW WALLET / NO PROFILE MUTATION)**:
   - `users/{childId}` profile document, `families/{familyId}/wallets/{childId}` wallet document, `families/{familyId}/childLogins/{childId}` private login record, and synthetic Auth UID (`authUid`) MUST NOT be created, duplicated, or overwritten.
   - Points (`rewardPoints`), experience (`lifetimeXP`), wallet balance (`balance`), task history, rewards, and achievements MUST remain 100% untouched.
   - Approval MUST NOT call `setCustomUserClaims` as if creating a replacement identity. Custom claims (`{ role: 'child', familyId, childId, managedChild: true }`) already exist on the managed child's Auth UID.

2. **OPAQUE HIGH-ENTROPY SINGLE-USE QR TOKEN**:
   - QR token is a $\ge 256$-bit URL-safe random string (`queki_qr_v1_...`).
   - QR token contains **ZERO** embedded state/authority: NO `familyId`, NO `childId`, NO `role`, NO `inviteCode`, NO credentials.
   - Server stores **ONLY** `SHA-256(token)` in `childQrTokenLookup/{sha256(token)}` and `families/{familyId}/child_qr_sessions/{sessionId}`.
   - TTL is strictly 15 minutes (`900,000 ms`).
   - Generating a new QR revokes any previous active QR for that family/parent session.
   - Previewing a QR validates active/unexpired status but **DOES NOT** consume the token.
   - First valid join request submission consumes the QR atomically (`active -> consumed`). Sub-sequent requests or re-scans fail closed (`QR_ALREADY_USED`).

3. **BEARER SECRET & UNAUTHENTICATED CHILD REQUEST**:
   - The scanning child device does not require an existing Firebase Auth session.
   - Successful join request submission creates a pending request in `families/{familyId}/child_qr_join_requests/{requestId}` and returns `{ requestId, requestSecret, status: 'pending', expiresAtMs }`.
   - Server stores **ONLY** `SHA-256(requestSecret)` in server-only `families/{familyId}/childQrJoinSecrets/{requestId}`.
   - `requestSecret` is a $\ge 256$-bit bearer capability used strictly to poll request status and exchange an `approved` request for the existing child's custom token. It grants zero family membership, zero Firestore read/write access, and no profile selection authority.
   - Pending request TTL is set to 24 hours (`86,400,000 ms`). Consuming a 15-minute QR creates a 24-hour pending request so the parent has a reasonable window to approve without invalidating the pending request prematurely.
   - Frontend stores `{ requestId, requestSecret }` in persistent device storage (`localStorage` with `sessionStorage` fallback) so page reloads or app reopens maintain state without infinite spinners.

4. **SERVER-AUTHORITATIVE PARENT APPROVAL & TOKEN EXCHANGE**:
   - Request appears in Parent Approval Center using the Universal Request Model adapter (`category: 'join'`, `type: 'child_qr_device_join'`).
   - Parent selects an existing active managed child (`selectedManagedChildId`) from `families/{familyId}`. Child device **NEVER** sends `selectedManagedChildId`.
   - `approveChildQrJoinRequest` verifies caller is `parent` or `owner` of `familyId`, request is `pending`, selected profile exists and is active `role: 'child'` and `isManaged: true`, and `authUid` link is consistent.
   - Approval updates **ONLY** request resolution state (`status = 'approved'`, `resolvedBy = callerUid`, `resolvedAt = serverTimestamp()`, `selectedManagedChildId`).
   - Token Exchange (`exchangeApprovedChildQrRequest`): Child device passes `requestId` + `requestSecret`. Server verifies secret hash, checks `status == 'approved'`, loads `selectedManagedChildId`, revalidates active child identity & `authUid`, generates a custom token using `auth.createCustomToken(existingAuthUid, existingClaims)`, and returns it. Token exchange retries are idempotent and recoverable.

5. **FIRESTORE RULES SECURITY BOUNDARY**:
   - Direct clients have zero write access to QR sessions, token lookups, request secrets, or resolution states (`allow read, write: if false;`). All state transitions are performed via Admin SDK inside trusted Cloud Functions transactions.

---

## Tech Stack & Testing Frameworks

- **Backend**: Cloud Functions v2 (`europe-west1`), Node.js 20, Firebase Admin Auth & Firestore SDK.
- **Frontend**: React 19, TypeScript 5, Vite, TailwindCSS / CSS Modules, Lucide Icons, `html5-qrcode` / browser camera API.
- **Testing**:
  - Unit/Integration: Vitest (`npx vitest run`)
  - Firestore Rules: `@firebase/rules-unit-testing` (`npx vitest run tests/firestore/childQrOnboarding.rules.test.ts`)
  - E2E Browser Verification: Playwright Chromium & WebKit (`npx playwright test`)

---

## Detailed Task Breakdown

### Task 1: Backend QR Session & Token Lookup Primitive

**Files:**
- Create: `functions/src/childQrOnboarding.ts`
- Create: `functions/src/childQrOnboarding.test.ts`
- Modify: `functions/src/index.ts`

**Responsibilities:**
- Implement `generateChildQrToken` callable (Parent-only).
  - Validates caller `role in ['parent', 'owner']` and reads caller's `familyId`.
  - Transactionally revokes all active QR sessions for `familyId` (`status: 'revoked'`).
  - Generates 32-byte (256-bit) cryptographically random opaque token string.
  - Computes `tokenHash = SHA256(token)`.
  - Writes session doc `families/{familyId}/child_qr_sessions/{sessionId}` and lookup doc `childQrTokenLookup/{tokenHash}` with `expiresAtMs = nowMs() + 15 * 60 * 1000`.
  - Returns `{ rawToken, expiresAtMs }`.
- Implement `scanChildQrToken` callable (Unauthenticated Preview).
  - Receives `{ token }`.
  - Computes `tokenHash = SHA256(token)`.
  - Reads `childQrTokenLookup/{tokenHash}`.
  - Validates `status == 'active'` and `expiresAtMs > nowMs()`.
  - **Does NOT** consume token.
  - Returns `{ valid: true, expiresAtMs }` or throws `INVALID_QR_TOKEN`.

- [ ] **RED Tests to write in `functions/src/childQrOnboarding.test.ts`**:
  - Test 1: `QR contains no familyId/childId/role/inviteCode` - Verify generated raw token is pure random hex/base64url without embedded substrings.
  - Test 2: `QR has >=256-bit entropy` - Verify generated token length matches $\ge 32$ random bytes.
  - Test 3: `stored QR token is hashed, raw token absent` - Inspect Firestore session/lookup docs; confirm `tokenHash` is present and raw token is absent.
  - Test 4: `preview grants zero authority` - `scanChildQrToken` output returns only `{ valid: true, expiresAtMs }` with no `familyId` or claims.
  - Test 5: `preview does not consume QR` - Scanning 3 times leaves session status `active`.
  - Test 9: `expired QR fails` - Advance clock by 15 mins + 1 sec; `scanChildQrToken` throws `QR_EXPIRED`.
  - Test 10: `revoked QR fails` - Revoked session fails with `QR_REVOKED`.
  - Test 11: `generating new QR revokes old QR` - Call `generateChildQrToken` twice; verify first session turns `revoked`.

- [ ] **Execution Command (RED)**:
  `npx vitest run functions/src/childQrOnboarding.test.ts -t "Task 1"`
  *(Expected: Fails because `childQrOnboarding.ts` callables do not exist yet)*

- [ ] **Implementation**:
  Implement `generateChildQrTokenImpl` and `scanChildQrTokenImpl` in `functions/src/childQrOnboarding.ts`.

- [ ] **Execution Command (GREEN)**:
  `npx vitest run functions/src/childQrOnboarding.test.ts -t "Task 1"`

- [ ] **Commit Checkpoint**:
  `git commit -m "feat(qr): implement backend QR token generation and unauthenticated scan preview"`

---

### Task 2: Backend Pending Join Request & Secret Status Primitive

**Files:**
- Modify: `functions/src/childQrOnboarding.ts`
- Modify: `functions/src/childQrOnboarding.test.ts`

**Responsibilities:**
- Implement `submitChildQrJoinRequest` callable.
  - Receives `{ token, clientReqId }`.
  - Computes `tokenHash = SHA256(token)`.
  - Executes Firestore transaction:
    - Reads `childQrTokenLookup/{tokenHash}` and corresponding `child_qr_sessions/{sessionId}`.
    - Asserts `status == 'active'` and `expiresAtMs > nowMs()`.
    - Updates QR session `status = 'consumed'`, `consumedAtMs = nowMs()`, `consumedByRequestId = requestId`.
    - Generates 32-byte `requestSecret`.
    - Computes `requestSecretHash = SHA256(requestSecret)`.
    - Creates request doc `families/{familyId}/child_qr_join_requests/{requestId}` (`status: 'pending'`, `expiresAtMs: nowMs() + 24 * 60 * 60 * 1000`).
    - Creates secret doc `families/{familyId}/childQrJoinSecrets/{requestId}` (`requestSecretHash`).
    - Returns `{ requestId, requestSecret, status: 'pending', expiresAtMs }`.
- Implement `getChildQrJoinStatus` callable.
  - Receives `{ requestId, requestSecret }`.
  - Validates `requestSecretHash`.
  - Returns `{ requestId, status, expiresAtMs }`.

- [ ] **RED Tests to write in `functions/src/childQrOnboarding.test.ts`**:
  - Test 6: `first request consumes QR` - Submitting join request updates QR session status to `consumed`.
  - Test 7: `second request fails` - Re-submitting with same QR token throws `QR_ALREADY_USED`.
  - Test 8: `concurrent request race produces exactly one pending request` - Run two concurrent `submitChildQrJoinRequest` calls; exactly one succeeds and one fails.
  - Test 12: `pending request creates no child` - Count `users` collection before/after submit; count is unchanged.
  - Test 13: `pending request creates no wallet` - Count `wallets` collection before/after submit; count is unchanged.
  - Test 14: `pending request creates no membership` - Requester UID has no `familyId` set on user doc.
  - Test 15: `request secret is hashed server-side` - Verify `childQrJoinSecrets` doc stores `requestSecretHash`, raw secret absent.
  - Test 31: `wrong requestSecret cannot read request status` - Calling `getChildQrJoinStatus` with invalid secret throws `JOIN_REQUEST_NOT_FOUND`.

- [ ] **Execution Command (RED)**:
  `npx vitest run functions/src/childQrOnboarding.test.ts -t "Task 2"`

- [ ] **Implementation**:
  Implement `submitChildQrJoinRequestImpl` and `getChildQrJoinStatusImpl` in `functions/src/childQrOnboarding.ts`.

- [ ] **Execution Command (GREEN)**:
  `npx vitest run functions/src/childQrOnboarding.test.ts -t "Task 2"`

- [ ] **Commit Checkpoint**:
  `git commit -m "feat(qr): implement QR join request submission and status lookup with secret hashing"`

---

### Task 3: Backend Parent Approval & Rejection

**Files:**
- Modify: `functions/src/childQrOnboarding.ts`
- Modify: `functions/src/childQrOnboarding.test.ts`

**Responsibilities:**
- Implement `approveChildQrJoinRequest` callable.
  - Inputs: `{ familyId, requestId, selectedManagedChildId, clientReqId }`.
  - Asserts caller `role in ['parent', 'owner']` of `familyId`.
  - Executes Firestore transaction:
    - Reads request `families/{familyId}/child_qr_join_requests/{requestId}`. Asserts `status == 'pending'`.
    - Reads `users/{selectedManagedChildId}`. Asserts `familyId == familyId`, `role == 'child'`, `isManaged == true`, `status != 'deleted'`.
    - Reads `families/{familyId}/childLogins/{selectedManagedChildId}`. Asserts valid existing `authUid` is present.
    - Updates request: `status = 'approved'`, `resolvedBy = callerUid`, `resolvedAt = serverTimestamp()`, `selectedManagedChildId = selectedManagedChildId`.
    - **CRITICAL**: Does **NOT** alter `users/{selectedManagedChildId}` fields (`rewardPoints`, `lifetimeXP`, `authUid`), does **NOT** create a new wallet, does **NOT** mint new custom claims.
    - Returns `{ requestId, selectedManagedChildId, status: 'approved' }`.
- Implement `rejectChildQrJoinRequest` callable.
  - Inputs: `{ familyId, requestId, rejectionReason?, clientReqId }`.
  - Asserts caller is parent/owner of `familyId`.
  - Updates request status to `'rejected'`. Rejection is final.

- [ ] **RED Tests to write in `functions/src/childQrOnboarding.test.ts`**:
  - Test 16: `child cannot select managedChildId` - Submit request payload with `selectedManagedChildId` rejected by backend.
  - Test 17: `child cannot self-approve` - Non-parent UID calling `approveChildQrJoinRequest` throws `NOT_AUTHORIZED`.
  - Test 18: `unrelated family parent cannot approve` - Parent of Family B calling approve on Family A request throws `NOT_AUTHORIZED`.
  - Test 19: `parent must select existing managed child` - Non-existent `selectedManagedChildId` throws `CHILD_NOT_FOUND`.
  - Test 20: `wrong-family child cannot be selected` - Managed child from Family B passed to Family A approval throws `CHILD_NOT_IN_FAMILY`.
  - Test 21: `inactive/non-managed child cannot be selected` - Parent user or deleted child passed throws `INVALID_TARGET_CHILD`.
  - Test 22: `approval changes no points` - Target child `rewardPoints` before & after approval identical.
  - Test 23: `approval changes no XP` - Target child `lifetimeXP` before & after approval identical.
  - Test 24: `approval changes no wallet balance` - Target wallet `balance` before & after approval identical.
  - Test 25: `approval does not alter existing authUid` - `users/{childId}.authUid` before & after approval identical.
  - Test 26: `approval does not alter childLogin identity` - `childLogins/{childId}` record before & after approval identical.
  - Test 27: `approval creates no new Firebase child identity` - Auth user count before & after approval identical.
  - Test 28: `approve replay is idempotent` - Calling approve twice with same `clientReqId` returns success.
  - Test 29: `approve/reject race has one terminal result` - Concurrent approve & reject calls resolve to exactly one terminal state.
  - Test 30: `reject is terminal` - Calling approve after request is rejected throws `REQUEST_NOT_PENDING`.

- [ ] **Execution Command (RED)**:
  `npx vitest run functions/src/childQrOnboarding.test.ts -t "Task 3"`

- [ ] **Implementation**:
  Implement `approveChildQrJoinRequestImpl` and `rejectChildQrJoinRequestImpl` in `functions/src/childQrOnboarding.ts`.

- [ ] **Execution Command (GREEN)**:
  `npx vitest run functions/src/childQrOnboarding.test.ts -t "Task 3"`

- [ ] **Commit Checkpoint**:
  `git commit -m "feat(qr): implement server-authoritative parent approval and rejection for QR device join"`

---

### Task 4: Backend Custom Token Exchange Primitive

**Files:**
- Modify: `functions/src/childQrOnboarding.ts`
- Modify: `functions/src/childQrOnboarding.test.ts`

**Responsibilities:**
- Implement `exchangeApprovedChildQrRequest` callable.
  - Inputs: `{ requestId, requestSecret }`.
  - Computes `requestSecretHash = SHA256(requestSecret)`.
  - Validates `childQrJoinSecrets/{requestId}` matches hash.
  - Reads lookup & request `families/{familyId}/child_qr_join_requests/{requestId}`.
  - Asserts `status == 'approved'` and `selectedManagedChildId` is present.
  - Loads target profile `users/{selectedManagedChildId}` and private login record `families/{familyId}/childLogins/{selectedManagedChildId}`.
  - Revalidates: `role == 'child'`, `isManaged == true`, `familyId == familyId`, `status != 'deleted'`, existing `authUid` is active.
  - Mints custom token using Admin Auth:
    `auth.createCustomToken(existingAuthUid, { role: 'child', familyId, childId: selectedManagedChildId, managedChild: true })`.
  - Records exchange timestamp `exchangedAtMs` safely.
  - Returns `{ customToken, childId: selectedManagedChildId }`.
  - Exchange retries with valid secret continue returning a valid custom token for the existing child identity.

- [ ] **RED Tests to write in `functions/src/childQrOnboarding.test.ts`**:
  - Test 32: `wrong requestSecret cannot exchange token` - Calling exchange with incorrect secret throws `JOIN_REQUEST_NOT_FOUND`.
  - Test 33: `approved request exchanges to EXISTING child authUid` - Decoded custom token sub claim matches existing child `authUid`.
  - Test 34: `custom token claims match existing child identity` - Token claims contain exact `role: 'child'`, `familyId`, `childId`, `managedChild: true`.
  - Test 35: `exchange cannot switch selected child` - Request payload cannot pass or override `selectedManagedChildId`.
  - Test 36: `exchange retry is recoverable/idempotent` - Retrying exchange after simulated drop returns fresh custom token.
  - Test 37: `target becoming invalid before exchange fails closed` - Disabling/deleting managed child between approval and exchange causes exchange to fail closed (`CHILD_INACTIVE`).

- [ ] **Execution Command (RED)**:
  `npx vitest run functions/src/childQrOnboarding.test.ts -t "Task 4"`

- [ ] **Implementation**:
  Implement `exchangeApprovedChildQrRequestImpl` in `functions/src/childQrOnboarding.ts`.

- [ ] **Execution Command (GREEN)**:
  `npx vitest run functions/src/childQrOnboarding.test.ts -t "Task 4"`

- [ ] **Commit Checkpoint**:
  `git commit -m "feat(qr): implement custom token exchange for approved QR onboarding requests"`

---

### Task 5: Firestore Security Rules & Projections

**Files:**
- Modify: `firestore.rules`
- Create: `tests/firestore/childQrOnboarding.rules.test.ts`

**Responsibilities:**
- Add rules for:
  - `match /childQrTokenLookup/{tokenHash}`: `allow read, write: if false;` (Server-only).
  - `match /families/{familyId}/child_qr_sessions/{sessionId}`: `allow read, write: if false;` (Server-only).
  - `match /families/{familyId}/childQrJoinSecrets/{requestId}`: `allow read, write: if false;` (Server-only).
  - `match /families/{familyId}/child_qr_join_requests/{requestId}`:
    - `allow read: if isParent(familyId);` (Parent Approval Center projection).
    - `allow create, update, delete: if false;` (Backend callables write).

- [ ] **RED Tests to write in `tests/firestore/childQrOnboarding.rules.test.ts`**:
  - Test 44: `Firestore Rules deny direct secret/session mutation` - Direct client `setDoc`, `updateDoc`, `deleteDoc`, `getDoc` on lookup, sessions, secrets, or join requests from child or parent SDK throw permission denied. Parent SDK can `getDoc`/`list` only on `child_qr_join_requests`.

- [ ] **Execution Command (RED)**:
  `npx vitest run tests/firestore/childQrOnboarding.rules.test.ts`

- [ ] **Implementation**:
  Update `firestore.rules` with server-only and parent-read-only match blocks.

- [ ] **Execution Command (GREEN)**:
  `npx vitest run tests/firestore/childQrOnboarding.rules.test.ts`

- [ ] **Commit Checkpoint**:
  `git commit -m "security(rules): enforce server-only isolation for QR token lookups, secrets, and session documents"`

---

### Task 6: Universal Request Model Adapter & Approval Center UI

**Files:**
- Modify: `src/lib/requestModel.ts`
- Modify: `src/lib/requestModel.test.ts`
- Create: `src/components/family/QrJoinRequestCard.tsx`
- Create: `src/components/family/QrJoinRequestCard.test.tsx`
- Modify: `src/pages/Notifications.tsx`
- Modify: `src/pages/Notifications.test.tsx`

**Responsibilities:**
- Register `child_qr_device_join` request adapter in `src/lib/requestModel.ts`.
- Build `QrJoinRequestCard` component:
  - Renders QR Device Join request badge.
  - Displays dropdown/picker of existing managed children in the family (`users` where `role == 'child'` and `isManaged == true`).
  - Provides "Approve" and "Reject" buttons.
  - Enforces child selection before "Approve" button is enabled.
  - Calls `approveChildQrJoinRequest` / `rejectChildQrJoinRequest`.

- [ ] **RED Tests to write in `src/lib/requestModel.test.ts` & `QrJoinRequestCard.test.tsx`**:
  - Test adapter normalizes `child_qr_device_join` into `NormalizedRequest` category `'join'`.
  - Test UI requires selecting an existing managed child before approving.
  - Test UI renders error state if approval callable fails.

- [ ] **Execution Command (RED)**:
  `npx vitest run src/lib/requestModel.test.ts src/components/family/QrJoinRequestCard.test.tsx`

- [ ] **Implementation**:
  Update `requestModel.ts` and create `QrJoinRequestCard.tsx`.

- [ ] **Execution Command (GREEN)**:
  `npx vitest run src/lib/requestModel.test.ts src/components/family/QrJoinRequestCard.test.tsx`

- [ ] **Commit Checkpoint**:
  `git commit -m "feat(ui): add QR device join request adapter and Approval Center selection card"`

---

### Task 7: Parent QR Generation & Management UI

**Files:**
- Create: `src/components/family/ParentQrConnectModal.tsx`
- Create: `src/components/family/ParentQrConnectModal.test.tsx`
- Modify: `src/pages/Family.tsx`
- Modify: `src/pages/Family.test.tsx`

**Responsibilities:**
- Implement `ParentQrConnectModal`:
  - Entry point on Family/Settings page: "Connect child device".
  - Calls `generateChildQrToken`.
  - Renders QR code canvas/SVG with visible 15-minute countdown clock (`MM:SS`).
  - Provides "Generate New QR" button (invalidates active QR).
  - Handles countdown expiration cleanly (shows "QR Expired - Tap to regenerate", clears stale canvas, no infinite spinner).

- [ ] **RED Tests to write in `ParentQrConnectModal.test.tsx`**:
  - Test modal renders QR code and starts 15:00 countdown timer.
  - Test tapping "Generate New QR" calls backend and resets timer to 15:00.
  - Test timer reaching 00:00 renders expired state and disables stale QR.

- [ ] **Execution Command (RED)**:
  `npx vitest run src/components/family/ParentQrConnectModal.test.tsx`

- [ ] **Implementation**:
  Implement `ParentQrConnectModal.tsx` using `qrcode.react` or SVG generator.

- [ ] **Execution Command (GREEN)**:
  `npx vitest run src/components/family/ParentQrConnectModal.test.tsx`

- [ ] **Commit Checkpoint**:
  `git commit -m "feat(ui): implement Parent QR generation modal with 15-minute countdown"`

---

### Task 8: Child Device QR Scan, Join, Wait, and Exchange Flow

**Files:**
- Create: `src/lib/childQrApi.ts`
- Create: `src/lib/childQrApi.test.ts`
- Modify: `src/pages/JoinFamily.tsx`
- Modify: `src/pages/JoinFamily.test.tsx`

**Responsibilities:**
- Create `src/lib/childQrApi.ts` for handle persistence (`localStorage` + `sessionStorage` fallback) and callable wrappers.
- Update `JoinFamily.tsx`:
  - Step 1: Scanner view ("Scan family QR code").
  - Step 2: On QR detect, calls `scanChildQrToken` for preview verification.
  - Step 3: Shows "Valid QR - Request to join" action.
  - Step 4: On submit, calls `submitChildQrJoinRequest`, stores `{ requestId, requestSecret }` in persistent storage, and renders Waiting Screen.
  - Step 5: Waiting screen polls `getChildQrJoinStatus` every 3 seconds.
  - Step 6: On page reload / app reopen, automatically recovers active `{ requestId, requestSecret }` handle and resumes status polling.
  - Step 7: When status turns `'approved'`, calls `exchangeApprovedChildQrRequest`, gets custom token, calls `signInWithCustomToken(customToken)`, clears local handle, and navigates to Child Dashboard (`/`).
  - Step 8: If rejected/expired/cancelled, displays clear status feedback with "Scan again" button.

- [ ] **RED Tests to write in `JoinFamily.test.tsx` & `childQrApi.test.ts`**:
  - Test 38: `reload restores waiting flow` - Mock persistent handle in `localStorage`; mounting `/join-family` resumes polling on `requestId`.
  - Test 39: `child transitions into existing Child experience after exchange` - Mock status transitioning to `approved`; component exchanges token, signs in, and redirects to dashboard.

- [ ] **Execution Command (RED)**:
  `npx vitest run src/lib/childQrApi.test.ts src/pages/JoinFamily.test.tsx`

- [ ] **Implementation**:
  Implement `childQrApi.ts` and update `JoinFamily.tsx`.

- [ ] **Execution Command (GREEN)**:
  `npx vitest run src/lib/childQrApi.test.ts src/pages/JoinFamily.test.tsx`

- [ ] **Commit Checkpoint**:
  `git commit -m "feat(ui): implement Child QR scan, join submission, waiting recovery, and custom token exchange"`

---

### Task 9: Full E2E & Browser Integration Tests

**Files:**
- Create: `tests/e2e/childQrOnboarding.spec.ts`

**Responsibilities:**
- Write Playwright E2E tests simulating the complete flow:
  1. Parent logs in on Chromium/WebKit, opens "Connect child device" modal, generates QR token.
  2. Child context opens `/join-family`, scans QR token, submits join request, enters Waiting screen.
  3. Parent Approval Center receives request, selects existing child profile "Ali", approves request.
  4. Child context automatically detects approval, exchanges custom token, logs in as "Ali", and lands on Child Dashboard.

- [ ] **RED Tests to write in `tests/e2e/childQrOnboarding.spec.ts`**:
  - Test 45: `Chromium E2E full flow` - End-to-end multi-context test in Chromium.
  - Test 46: `WebKit E2E full flow` - End-to-end multi-context test in WebKit.

- [ ] **Execution Command (RED)**:
  `npx playwright test tests/e2e/childQrOnboarding.spec.ts`

- [ ] **Implementation**:
  Finalize E2E integration wiring.

- [ ] **Execution Command (GREEN)**:
  `npx playwright test tests/e2e/childQrOnboarding.spec.ts`

- [ ] **Commit Checkpoint**:
  `test(e2e): add Playwright Chromium and WebKit full E2E suites for QR child device onboarding`

---

### Task 10: Regression & Non-Breakage Verification

**Files:**
- Verify existing test suites:
  - `functions/src/childLogin.test.ts`
  - `functions/src/childJoinRequest.test.ts`
  - `functions/src/familyInvitations.test.ts`
  - `functions/src/familyMembership.test.ts`
  - `src/pages/Onboarding.test.tsx`

- [ ] **RED / Regression Check Tests**:
  - Test 40: `legacy child login unchanged` - Run `npx vitest run functions/src/childLogin.test.ts`.
  - Test 41: `legacy child join flow unchanged` - Run `npx vitest run functions/src/childJoinRequest.test.ts`.
  - Test 42: `adult invitation flow unchanged` - Run `npx vitest run functions/src/familyInvitations.test.ts`.
  - Test 43: `parent onboarding unchanged` - Run `npx vitest run src/pages/Onboarding.test.tsx`.

- [ ] **Execution Command (Verification)**:
  `npx vitest run functions/src/childLogin.test.ts functions/src/childJoinRequest.test.ts functions/src/familyInvitations.test.ts functions/src/familyMembership.test.ts src/pages/Onboarding.test.tsx`

- [ ] **Commit Checkpoint**:
  `test(regression): verify 100% pass rate across legacy child login, adult invitations, and onboarding`

---

## Verification & Build Checklist

- [ ] `npx vitest run` (All unit, integration, and rules tests passing)
- [ ] `npx playwright test` (All Chromium & WebKit E2E tests passing)
- [ ] `npm run build` (Clean Vite & Functions TypeScript compilation)
- [ ] `git diff --check` (No lint errors or orphaned whitespace)

---

## Self-Review

1. **Spec Coverage**:
   - Covers all 46 RED test requirements listed in prompt.
   - Enforces zero new child creation, zero wallet creation, zero points/XP/balance mutation.
   - Reuses existing managed child `authUid` and custom token claims.
   - Opaque $\ge 256$-bit QR token with 15-minute TTL and server-side SHA-256 hashing.
   - Bearer `requestSecret` hashed server-side, 24-hour pending request TTL, persistent storage recovery.
   - Parent-only selection of existing child profile; child cannot select profile or self-approve.
   - Direct Firestore client writes denied.

2. **Placeholder Scan**:
   - All tasks specify exact file paths, function signatures, test descriptions, commands, and commit messages.

3. **Type / Signature Consistency**:
   - Aligns with existing `europe-west1` callables, `clientReqId` idempotency patterns, and Universal Request Model (`requestModel.ts`).

4. **Scope Drift Check**:
   - Firebase Auth global Action URL / email action handler remains untouched as requested.
   - No schema migrations. No changes to legacy flows.
