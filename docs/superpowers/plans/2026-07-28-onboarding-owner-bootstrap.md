# Onboarding Owner Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make new-family onboarding atomically establish ownership, publish the authoritative user profile to Zustand, and reach the dashboard without returning to onboarding.

**Architecture:** Keep Firestore's existing owner-bootstrap trust boundary: create the family and add `familyId`/`role: "owner"` to the signed-in user's existing profile in one transaction. Re-read the committed profile, update Zustand from that authoritative result, then allow Finish Setup to create managed members and navigate.

**Tech Stack:** React 19, TypeScript, Zustand, Firebase Auth/Firestore, Vitest, Firebase Rules Emulator.

## Global Constraints

- Work only in `/Users/kemal/.gemini/antigravity/scratch/family-gamification` on branch `todo-theme`.
- Do not use a detached worktree or switch repositories.
- Prove the root cause before modifying production behavior.
- Do not add timeouts, reloads, local-storage flags, retry loops, forced navigation, or artificial waits.
- Preserve unrelated working-tree changes.

---

### Task 1: Lock the Firestore bootstrap contract

**Files:**
- Modify: `src/lib/api.familyCreation.test.ts`
- Modify: `tests/firestore/ownerBootstrap.rules.test.ts`

**Interfaces:**
- Consumes: `createFamilyAndParent(uid, name, familyName)`
- Produces: a regression contract proving family creation and owner-profile update are one atomic transaction.

- [ ] **Step 1: Write failing API and rules tests**

Assert that the family write and user update occur in the same transaction, the family contains its owner identity, the committed user is re-read, and a separate post-creation owner claim is denied.

- [ ] **Step 2: Run tests to verify failure**

Run the focused Vitest API test and the owner-bootstrap emulator test. Confirm failures identify the absent atomic owner update.

### Task 2: Restore atomic ownership and store publication

**Files:**
- Modify: `src/lib/api.ts`
- Modify: `src/pages/Onboarding.tsx`
- Modify: `src/pages/Onboarding.test.tsx`
- Modify: `src/store/useStore.ts`
- Modify: `firestore.rules`

**Interfaces:**
- Produces: `createFamilyAndParent(...) => { familyId, inviteCode, user }`
- Consumes: `refreshCurrentUser(uid, user)`

- [ ] **Step 1: Implement the minimal Firestore transaction**

Read the existing parent profile, validate it has no family, create the family with `ownerId`/`createdBy`, and update only `familyId` and `role` in the same transaction.

- [ ] **Step 2: Re-read and publish the authoritative profile**

Read `users/{uid}` after commit, return it, and merge it into Zustand before advancing onboarding.

- [ ] **Step 3: Remove the impossible late owner promotion**

At Finish Setup, create managed members after ownership already exists and navigate only on success.

- [ ] **Step 4: Run focused tests**

Run the API, onboarding, store/bootstrap, and rules regression tests.

### Task 3: Verify the complete outcome

**Files:**
- No production files.

- [ ] **Step 1: Run typecheck, complete unit suite, rules suite, and build**

Use the repository scripts and record exact pass/fail evidence.

- [ ] **Step 2: Re-check every onboarding condition**

Confirm the only `/onboarding` decision receives a user profile containing the committed `familyId`, both immediately and after cold bootstrap.
