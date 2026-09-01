# Queki-Branded Email Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Queki-owned Firebase email-action handler that redeems verification codes safely and hands authority resumption exclusively to `/verify-email`.

**Architecture:** A pure parser classifies action parameters and fixes the only successful continuation to `/verify-email`. A public React page owns redemption UX through injected Firebase Auth APIs; existing `/verify-email` authority refresh and intent precedence remain unchanged.

**Tech Stack:** React, TypeScript, Firebase Auth Web SDK, React Router, i18next, Vitest, Testing Library, Playwright, Firebase Auth/Firestore emulators.

**Spec:** `docs/superpowers/specs/2026-09-01-queki-email-verification-design.md`

## Global Constraints

- Base is exact `7af93b30a6b6a94ec8c464035a404ab24fe3ccf2`.
- Do not mutate Firebase Console, DNS, templates, authorized domains, or deployment state.
- `/auth/verify` may redeem a code but never grants family authority or reconstructs onboarding intent.
- Successful navigation is always `/verify-email`; caller-controlled `continueUrl` is never trusted.
- Do not change Functions or Rules unless verification demonstrates a genuine requirement.

---

### Task 1: Safe action request contract

**Files:**
- Create: `src/auth/emailActionHandler.ts`
- Create: `src/auth/emailActionHandler.test.ts`

**Interfaces:**
- Produces: `parseVerificationAction(search: string): VerificationActionRequest` and `EMAIL_ACTION_CONTINUE_PATH`.
- Consumes: URL query parameters only.

- [ ] Write table-driven RED tests proving only `verifyEmail` plus non-empty `oobCode` is accepted, arbitrary `continueUrl` is ignored, and unsupported `lang` falls back.
- [ ] Run `npx vitest run src/auth/emailActionHandler.test.ts` and verify failure because the module does not exist.
- [ ] Implement the smallest parser returning either `{ kind: 'verifyEmail', oobCode, locale }` or `{ kind: 'invalid' }`, with continuation exported as literal `/verify-email`.
- [ ] Run the focused test and verify GREEN.

### Task 2: Public redemption page

**Files:**
- Create: `src/pages/EmailActionVerify.tsx`
- Create: `src/pages/EmailActionVerify.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/auth/AuthRoutingGate.tsx`
- Modify: `src/auth/AuthRoutingGate.test.tsx`
- Modify: `src/i18n/locales/en/auth.json`
- Modify: `src/i18n/locales/tr/auth.json`

**Interfaces:**
- Consumes: `parseVerificationAction`, Firebase `applyActionCode`, current Auth user, router navigation.
- Produces: public `/auth/verify` success/error UI and canonical Continue behavior.

- [ ] Write RED component tests for success, expired, invalid, authenticated-already-verified, network Retry, and canonical Continue under hostile `continueUrl`.
- [ ] Write RED routing tests proving `/auth/verify` is public for signed-out and unverified users.
- [ ] Run focused tests and record the expected route/component failures.
- [ ] Implement the Queki page, error classifier, translations, public route, and routing passthrough without changing `/verify-email`.
- [ ] Re-run focused tests and verify GREEN.

### Task 3: Authority and intent non-regression

**Files:**
- Modify: `src/pages/EmailActionVerify.test.tsx`
- Modify only existing auth/onboarding tests where an observable contract is missing.

**Interfaces:**
- Consumes: existing `refreshFamilyAuthority`, `VerifyEmail.resumeDestination`, create/invite/join storage.
- Produces: proof that action redemption itself performs no authority or intent mutation.

- [ ] Add RED assertions that the action page never invokes family APIs, token refresh, or intent writers.
- [ ] Verify `/verify-email` still owns reload + forced token refresh and invite → legacy join → UID-bound create precedence.
- [ ] Verify Google and managed-child paths bypass the password verification gate.
- [ ] Run focused auth/onboarding tests GREEN.

### Task 4: Production-shaped email round trip

**Files:**
- Modify: `tests/e2e/email-verification.spec.ts`
- Modify test helpers only as required to expose the emulator action URL.

**Interfaces:**
- Consumes: Auth emulator verification email and public handler.
- Produces: authoritative browser and Firestore evidence.

- [ ] Update the E2E expectation so the emulator link reaches `/auth/verify`, code redemption succeeds, then the original signed-in flow resumes through `/verify-email`.
- [ ] Assert malicious continuation cannot change the handler's Continue destination.
- [ ] Assert create and adult/legacy/join intent regressions, exactly one family, and no duplicate Create/Join.
- [ ] Run Chromium and WebKit gates.

### Task 5: Release-independent configuration runbook and full verification

**Files:**
- Create: `docs/production/email-verification-branding.md`

**Interfaces:**
- Produces: exact console workflow and placeholders for Firebase-generated DNS records without mutating configuration.

- [ ] Document Console paths, sender/template/action URL values, unchanged authorized domains, and Firebase-generated TXT/CNAME workflow.
- [ ] Run focused tests, auth/onboarding regressions, Rules, Functions authority tests, typecheck, lint, build, `git diff --check`, and full frontend baseline comparison.
- [ ] Commit the verified implementation and report its exact SHA without deployment.
