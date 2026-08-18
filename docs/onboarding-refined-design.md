# Queki — Refined Onboarding: Design Specification & Implementation Plan

> Status: **DESIGN ONLY — no production code has been changed.**
> Goal: a first-time parent reaches a useful, non-empty dashboard with minimal friction,
> through a premium, calm, fast, trustworthy, family-friendly-but-not-childish flow that is
> unmistakably Queki.

This document is the first deliverable. It inspects the current codebase and specifies the
architecture, state machine, persistence, idempotency, error/recovery, accessibility,
responsive, performance, analytics, testing and a phased TDD implementation plan. Another
engineer should be able to implement it without making new product decisions.

---

## 0. Critical architectural finding (read first)

The **current** `/onboarding` route is declared **inside** `<AppLayout>` (`src/App.tsx:83`),
which means it is only reachable for **authenticated** users who have **no familyId** — the
`AppLayout` guard (`src/components/layout/AppLayout.tsx:59-72`) sends `unauthenticated` users
to `/login` and `authenticated + familyId` users away from `/onboarding`.

The new **pre-auth** flow (Steps 1–7) must be reachable by **unauthenticated** visitors.
Therefore the new onboarding container must be a **public top-level route** (like `/login` and
`/signup`), rendered **outside** `<AppLayout>`. The flow carries its own internal guards:

* If `useStore.currentUser?.familyId` is already set → `Navigate to "/"` (an existing family
  owner is **never** re-routed through new-family onboarding; a managed child **never** enters
  the parent flow).
* If `useStore.currentUser?.role === 'child'` → `Navigate to "/"`.
* Pre-auth steps perform **zero** Firestore reads, so they render instantly with no
  `StartupScreen`.

This is the single most important structural change and is reflected throughout the plan.

---

## 1. Current onboarding architecture

| File | Role today | Disposition |
|------|-----------|------------|
| `src/pages/Onboarding.tsx` | Single screen, `select` → `create` (family name) or `join` (invite code). Calls `createFamilyAndParent` then `refreshCurrentUser` + `navigate('/')`. | **REPLACE** with the new `OnboardingFlow` container. |
| `src/pages/ContinueSetup.tsx` | Post-setup checklist (invite family / create reward / create task) shown from the dashboard. | **KEEP** (reusable, separate surface). Not part of the new onboarding route. |
| `src/components/family/FamilySetupPrompt.tsx` | "Set up your family" modal: add child / show invite code / skip. | **REUSE** patterns (invite-code display, add-child entry) inside Phase 2. |
| `src/components/layout/startupState.ts` + `StartupScreen.tsx` | Deterministic `auth → profile → family → ready/error` phases with bounded timeout + recovery. | **REUSE** unchanged for the post-auth bootstrap. |
| `src/store/useStore.ts` | Global Zustand store; `initAuth`, `loadFamilyData`, `refreshCurrentUser`. | **REUSE**; add no new global state beyond a thin onboarding draft hook. |

The current flow has **no** pre-auth personalisation, no mini-journey, no progress indicator,
and asks for the family name before the parent/child identity is established. The new design
replaces it entirely.

---

## 2. Current auth architecture & supported providers

**Implemented providers (do NOT invent others):**

* **Email / Password** — `signUp(email, pass, name)` (`src/lib/api.ts:117`) creates the Auth
  user **and** a `users/{uid}` doc with `role: 'parent'`, no `familyId`. `signIn` wraps
  `signInWithEmailAndPassword`.
* **Google** — `signInWithGoogle` → `startGoogleAuthentication` (`src/lib/googleRedirectAuth.ts`).
  Uses **popup on desktop**, **redirect on mobile** (`isMobileBrowser()`). On redirect return,
  `consumeGoogleRedirectResult()` (called in `App.tsx:43`) resolves the credential and calls
  `ensureGoogleUserProfile` which creates the `users/{uid}` doc with `role: 'parent'`, no
  `familyId`. A missing redirect state surfaces `bootstrapError = 'Google sign-in could not be
  completed. Please try again.'`.
* **Managed child sign-in** — `signInChild` (custom token). Not relevant to parent onboarding.

**NOT implemented:** Apple, Facebook, GitHub, Twitter. `PROVIDER_LABELS` (`src/lib/api.ts:173`)
merely maps provider ids to display strings; there is **no** `signInWithApple` and
`src/lib/accountDeletionApi.ts:7` explicitly states *"Sign in with Apple is NOT offered by this
app"*.

**Helper utilities to reuse:**
* `getAuthProviderInfo()` (`src/lib/api.ts:187`) — inspects attached providers.
* `mapAuthErrorMessage(error)` (`src/lib/api.ts:208`) — friendly, non-leaking messages.
* `consumeGoogleRedirectResult()` — already wired in `App.tsx`.

**Decision for Step 7:** present exactly the providers the app supports —
**"Continue with Google"** and **"Continue with Email"** (email → existing `/signup`).
**Do not add Apple.** If product later requires Apple, that is a separate backend project
(Apple auth provider + `ensureAppleUserProfile` + a new `signInWithApple`); call it out as a
follow-up behind a feature flag, not part of this plan.

---

## 3. Current Create / Join Family architecture

* **Create:** `createFamilyAndParent(uid, name, familyName)` (`src/lib/api.ts:244`) runs a
  `runTransaction` that:
  * rejects if the user doc already has `familyId` ("User already has a family") — **this is the
    server-side idempotency guard we rely on**;
  * rejects if `role !== 'parent'`;
  * creates `families/{newId}` with `inviteCode`, `ownerId`, `createdBy`, `gamificationMigration`
    (so the family is gamification-ready from birth);
  * sets the user doc `familyId` + `role: 'owner'`;
  * returns `{ familyId, inviteCode, user }`.
  The old `Onboarding.tsx` then calls `refreshCurrentUser(uid, { familyId, role:'owner' })` to
  publish state and `navigate('/', { replace:true })`. **Reuse this exact sequence.**
* **Join (child / invitee):** `requestFamilyJoin(familyCode)` (`src/lib/familyMembershipApi.ts`)
  for a pending request; `previewInvitation` / `acceptInvitation` + `buildJoinUrl` /
  `rememberPendingInvite` (`src/lib/inviteLink.ts`) for code invites. These are **not** used by
  the new-parent flow (a new parent *creates* a family), but the **invite-code share UI** is
  reused in Phase 2 ("Invite another parent").

---

## 4. Existing managed-child creation path

* **Authoritative API:** `createManagedMember(familyId, role, displayName, profile?)` (
  `src/lib/api.ts:441`). Creates `users/{newId}` with `isManaged: true`, `role`, `familyId`,
  optional `avatarId`/`dob`/`colour`, and a zero-balance `wallets/{newId}` in one batch. The
  Firestore rule (`isValidManagedMemberCreate`, `firestore.rules:1045`) requires the caller to be
  the **owner** of `familyId` — satisfied because we call it post-auth as the owner.
* **UI today:** `AddChildModal` → `createManagedMember` → `CreateChildLoginDialog` →
  `createChildLogin` callable (optional login). For onboarding we call `createManagedMember`
  **directly** for the first child (no forced login prompt), and reuse `AddChildModal` for the
  optional "Add another child" step.

---

## 5. Existing routing / guards protecting established families

`src/components/layout/AppLayout.tsx:46-80` (driven by `deriveStartupPhase`,
`src/components/layout/startupState.ts`):

1. `startupPhase !== 'ready'` → `StartupScreen` (bounded 20s timeout, recoverable).
2. `unauthenticated` → `/login`.
3. `authenticated && !familyId && path !== '/onboarding'` → `/onboarding`.
4. `authenticated && familyId && path === '/onboarding'` → `/` (owner never re-onboards).
5. `managed child && requiresPasswordChange` → `MandatoryChildPasswordChange`.

**New onboarding container lives outside `AppLayout`** (public route), so it must replicate
guards #3/#4/#5 internally (see §0 and §10). The existing `AppLayout` guards remain the
authoritative protection for every other route and must **not** be weakened.

---

## 6. Existing task creation path

* **Authoritative API:** `createTask(familyId, taskData)` (`src/lib/api.ts:530`) — writes the
  task doc (`isActive:true`) + a feed entry in a batch. Firestore rule `match /tasks` allows
  `write` only for `isParent(familyId)` (`firestore.rules:1833`). The new "first real task" calls
  this **directly** (no special insecure onboarding write).
* **UI today:** `src/pages/Tasks.tsx` `handleFormSubmit` builds
  `{ title, pointsReward, type, requiresApproval, assigneeId }`. The onboarding first-task screen
  reuses the **same shape** with starter templates and assigns the task to the first child.

---

## 7. Components / hooks / services that can be reused

| Reuse | Where | Why |
|-------|-------|-----|
| `Button` (`components/ui/Button.tsx`) | all steps | variants `primary/secondary/ghost`, sizes, `fullWidth`, focus-visible ring. |
| `Modal` (`components/ui/Modal.tsx`) | optional sub-dialogs | focus trap, scroll lock, safe-area footer, Escape. |
| `Card` / `CardContent` | mini-journey + dashboard preview | rounded Queki-native cards. |
| `Toast` (`components/ui/Toast.tsx`) | error toasts | existing pattern. |
| `AvatarPicker` (`components/profile/AvatarPicker.tsx`) | child personalisation (optional) | curated catalog, never arbitrary URLs. |
| `useAccessibleDialog` | dialogs | accessible open/close. |
| `useStore` (`store/useStore.ts`) | entire flow | `currentUser`, `familyMembers`, `refreshCurrentUser`, `loadFamilyData`. |
| `createFamilyAndParent` / `createManagedMember` / `createTask` | post-auth setup | authoritative, rule-compliant. |
| `signUp` / `signInWithGoogle` / `mapAuthErrorMessage` / `getAuthProviderInfo` | Step 7 | existing auth. |
| `buildJoinUrl` / `regenerateFamilyCode` / `rememberPendingInvite` pattern | Phase 2 invite | proven cross-reload persistence. |
| `startupDiagnostics` (`logAuthTrace`) | analytics/diagnostics | dev-only trace; reuse for funnel diagnostics. |
| `ContinueSetup` | dashboard "continue" | kept as a separate surface; not replaced. |
| `AddChildModal` | "Add another child" | accessible, idempotent-ish. |

---

## 8. Components that should be replaced

* **`src/pages/Onboarding.tsx`** — replaced by the new public `OnboardingFlow` container +
  step components. The old `onboardingCompletion.test.tsx` and `Onboarding.test.tsx` are
  rewritten against the new flow.
* **`src/App.tsx` route `/onboarding`** — moved outside `<AppLayout>` and pointed at
  `OnboardingFlow`.
* No Firestore rules, no store internals, no auth internals are replaced.

---

## 9. Exact proposed file structure

```
src/
  App.tsx                         # EDIT: move /onboarding out of AppLayout → public route
  onboarding/
    OnboardingFlow.tsx            # container: state machine + internal guards + draft wiring
    OnboardingFlow.test.tsx       # rewrite of Onboarding.test.tsx
    useOnboardingMachine.ts       # step state machine (pure, testable)
    useOnboardingMachine.test.ts
    lib/
      onboardingDraft.ts          # draft persistence (session+local mirror)
      onboardingDraft.test.ts
      onboardingSetup.ts          # idempotent createFamily+child+task orchestration
      onboardingSetup.test.ts
      onboardingAnalytics.ts      # minimal funnel (dev-only unless backend callable exists)
      onboardingAnalytics.test.ts
    components/
      OnboardingShell.tsx         # warm bg, max-width, safe-area, progress slot
      OnboardingProgress.tsx      # refined 7-step indicator (semantic)
      OnboardingProgress.test.tsx
      OnboardingCard.tsx          # rounded Queki-native card wrapper
      MiniJourney.tsx             # Step 5 animated demo (CSS, reduced-motion safe)
      MiniJourney.test.tsx
      OnboardingError.tsx         # shared error/retry UI
    steps/
      Step1ValueProposition.tsx
      Step2ParentName.tsx
      Step3Relationship.tsx
      Step4ChildName.tsx
      Step5MiniJourney.tsx
      Step6FamilyName.tsx
      Step7Account.tsx
    postauth/
      PostAuthSetup.tsx           # orchestrates family composition → first task → success
      FamilyComposition.tsx
      FirstTask.tsx
      Success.tsx
  i18n/locales/en/onboarding.json # NEW namespace
  i18n/locales/tr/onboarding.json # NEW namespace
```

`ContinueSetup.tsx`, `FamilySetupPrompt.tsx`, `AddChildModal.tsx`, `Tasks.tsx` are **not** moved;
they are reused where noted.

---

## 10. State-machine / data-flow design

### 10.1 Phases & steps

```
PRE_AUTH  (public, unauthenticated-or-authenticated-no-family):
  S1 ValueProposition
  S2 ParentName            (parentFirstName)
  S3 Relationship          (parentRoleDisplay: Mum/Dad/Parent/Carer/Grandparent/Other)
  S4 ChildName             (childFirstName)
  S5 MiniJourney           (visual demo only)
  S6 FamilyName            (familyName)
  S7 Account               (auth: Google / Email → /signup)

POST_AUTH (authenticated, no familyId yet → familyId created during this phase):
  P1 FamilyComposition     (show members; +Add another child / +Invite another parent; Continue/Skip)
  P2 FirstTask             (starter templates; REAL createTask)
  P3 Success               (restrained check animation → Go to my dashboard)
```

### 10.2 State shape (in `useOnboardingMachine`)

```ts
type Step =
  | 's1' | 's2' | 's3' | 's4' | 's5' | 's6' | 's7'
  | 'p1' | 'p2' | 'p3';

interface OnboardingDraft {
  version: 1;
  step: Step;
  parentFirstName: string;
  parentRoleDisplay: string;        // display ONLY — never a security role
  childFirstName: string;
  familyName: string;
  // post-auth reconciliation (persisted so refresh/retry is idempotent):
  familyId?: string;
  childId?: string;
  firstTaskId?: string;
  authProvider?: 'google' | 'email';
  updatedAt: number;
}
```

* `parentRoleDisplay` is **purely personalisation**. The authoritative security role is always
  derived from the existing flow: a new parent is `role:'parent'` → promoted to `owner` by
  `createFamilyAndParent`. The relationship choice (Mum/Dad/…) never touches `role` and never
  weakens the parent/child security model.
* The machine is a **pure reducer** (`goNext`, `goBack`, `patchDraft`, `reset`) so it is
  unit-testable without React.

### 10.3 Data flow

1. Pre-auth steps only `patchDraft` (local state + persistence). **No network.**
2. Step 7 "Continue with Google" → `signInWithGoogle()` (redirect on mobile). Page reloads;
   `consumeGoogleRedirectResult()` resolves; `useStore.authStatus` becomes `authenticated`.
   The container detects auth completion and advances `s7 → p1`, restoring the draft from
   storage.
3. Step 7 "Continue with Email" → `navigate('/signup')`. After `signUp`, the `AppLayout` guard
   sends the user back to `/onboarding`; the draft (restored from storage) is intact and the
   flow advances to `p1`.
4. `p1` calls `onboardingSetup.ensureFamily(draft)` → `createFamilyAndParent` →
   `refreshCurrentUser` → store `familyId`. Then optionally `createManagedMember` for the first
   child. Both results persisted to the draft.
5. `p2` calls `onboardingSetup.ensureFirstTask(draft, childId)` → `createTask` (assigned to the
   child). Result persisted.
6. `p3` shows success, then `navigate('/')` and **clears the draft**.

---

## 11. Draft persistence strategy (safest minimal approach)

**Recommendation: dual-write mirror — `sessionStorage` primary, `localStorage` mirror — under a
single key `queki.onboardingDraft`.**

Rationale (derived from the proven `inviteLink.ts` `rememberPendingInvite` pattern):
* **`sessionStorage`** is tab-scoped and cleared when the tab closes — ideal default so a draft
  never leaks across tabs/devices.
* **`localStorage`** survives the **full page reloads** that Google's redirect auth performs
  (popup does not reload, but redirect does). Without the mirror, a mobile Google sign-in would
  lose the draft.
* The draft contains **only low-sensitivity personalisation** (first names, family name, a
  display relationship). No financial, auth, or authoritative data. This keeps the privacy
  surface minimal.

`lib/onboardingDraft.ts` API (pure, testable):
* `saveDraft(draft)`, `loadDraft(): OnboardingDraft | null`, `clearDraft()`, `patchDraft(partial)`.
* On `loadDraft`, **validate & self-heal**:
  * if `version !== 1` or parse fails → return `null` (treat as corrupt → start fresh);
  * if `currentUser?.familyId` is already set (user already has a family) → `clearDraft()` and
    return `null` (stale draft can never drive a second family creation; the container guard also
    redirects to `/`).
* `clearDraft()` removes from **both** storages.

This satisfies: back navigation preserves values, refresh/relaunch safe, never unexpectedly
reset, no trap, safe recovery from corrupt/stale drafts.

---

## 12. Post-auth idempotency strategy

Three independent "exactly-once" operations, each defended by **(a) a client guard flag persisted
in the draft, and (b) the existing server-side transaction guard**.

| Operation | Client guard | Server guard (already exists) |
|-----------|-------------|-------------------------------|
| Family creation | `if (draft.familyId) skip;` plus an in-flight `creating` flag to block double-click/refresh. | `createFamilyAndParent` transaction rejects if user doc has `familyId` ("User already has a family") and if `role !== 'parent'`. |
| First child creation | `if (draft.childId) skip;` plus `creating` flag. | `createManagedMember` rule requires owner; re-calling with same name creates a *new* doc, so the client flag is the real guard. (Optional: before creating, read `familyMembers` and skip if a child with the same `displayName` already exists.) |
| First task creation | `if (draft.firstTaskId) skip;` plus `submittingRef` (mirrors `CreateChildLoginDialog`'s `submittingRef`). | `createTask` is append-only; the client flag prevents duplicate tasks from a double-click/refresh. |

**Refresh/retry safety:** because `familyId`/`childId`/`firstTaskId` are written into the draft
*and* the store, a refresh during `p1`/`p2` re-enters the step, sees the ids are present, and
skips the already-completed write, then advances. A slow Firestore family bootstrap (the
`StartupScreen` `family` phase) is handled by the **existing** `StartupScreen` + `deriveStartupPhase`
— the onboarding container simply waits for `appReady` before showing `p2`/`p3` content that
needs family data.

**Duplicate submission prevention:** every async action sets a `submitting`/`creating` boolean and
early-returns if already set (same pattern as `CreateChildLoginDialog.tsx:87` and
`AddChildModal.tsx:30`). Buttons are `disabled` while submitting.

---

## 13. Error / recovery design

Shared `OnboardingError` component renders friendly, **non-Firebase** copy with a Retry / Back /
Start-over action. Map errors via `mapAuthErrorMessage` + new `onboarding.json` keys.

| Scenario | Detection | Recovery UI | Data safety |
|----------|-----------|-------------|-------------|
| Offline / network unavailable | `navigator.onLine === false` or `auth/network-request-failed` | "You're offline" + Retry; disable submit. | Draft preserved. |
| Auth cancelled | Google redirect returns `redirect-state-missing` (existing `bootstrapError`) or popup dismissed | "Sign-in was cancelled" + return to Step 7. | Draft preserved. |
| Auth failed | `mapAuthErrorMessage` | Friendly message + Retry. | Draft preserved. |
| Family creation failed | `createFamilyAndParent` throws | Error + Retry (server guard prevents partial family). | Draft preserved; no family written. |
| Child creation failed | `createManagedMember` throws | Error + Retry (child step is optional; offer Skip). | Draft preserved. |
| First task failed | `createTask` throws | Error + Retry; offer "Skip & go to dashboard". | Draft preserved. |
| Session restored after refresh | draft reload | Resume at `draft.step`; if `familyId` present, jump to `p2`/`p3` as appropriate. | See §11/§12. |
| Stale/corrupt draft | `loadDraft` validation fails | Silently start fresh at S1 (no scary error). | Old draft cleared. |
| Duplicate click/submission | `submitting` flag | Button disabled; no second call. | — |
| Existing family discovered during setup | `currentUser.familyId` set mid-flow | Redirect to `/` (guard). | Draft cleared. |

**Never** leave the user on an indefinite spinner: the existing `STARTUP_TIMEOUT_MS = 20000`
(`StartupScreen.tsx:27`) already converts a stuck `family` phase into a recoverable screen; the
onboarding async actions each have their own try/catch → error state. **Never** destroy valid
entered data on a failed network op — only the draft in memory/storage is the source of truth and
is untouched by failures. Log diagnostics via `logAuthTrace` (dev only).

---

## 14. Accessibility strategy

Reuse the existing accessible primitives (`Modal`, `Button` focus-visible ring, `useAccessibleDialog`).
Specific requirements:

* **Touch targets:** all CTAs `min-h-[44px]`+ (Button `md`=`h-11`, `lg`=`h-14`). Already met.
* **Colour contrast:** warm/light background with `text-gray-900`/`text-gray-600` on white cards;
  purple CTA `bg-primary-500 text-white` meets AA on the chosen purple (verify token contrast).
* **Visible focus:** `focus-visible:ring-2 ring-primary-500 ring-offset-2` (Button already).
* **Keyboard nav:** every step is a single focusable form; Enter submits; Back is a real
  `<button>`; focus moves to the first field on step change (`useEffect` + ref, like
  `CreateChildLoginDialog.tsx:63`).
* **Screen-reader labels:** `aria-labelledby` on each step region; `aria-describedby` for helper
  text; the privacy reassurance in S4 uses `role="note"`.
* **Semantic progress:** `OnboardingProgress` uses
  `<ol>`/`<li>` with `aria-current="step"` and an `aria-label="Step X of 7"`; a visually-hidden
  `aria-live="polite"` announces step changes ("Now: And you're the…").
* **Form labels:** every input has a `<label htmlFor>`; validation errors use `role="alert"` and
  are linked via `aria-describedby`.
* **Validation announcement:** inline `role="alert"` + the input `aria-invalid`.
* **Reduced motion:** `MiniJourney` animations use CSS transitions gated by
  `@media (prefers-reduced-motion: reduce)` / Tailwind `motion-reduce:*`; **the mini-journey
  mental model is fully conveyed by text + static cards even with motion off** (no motion required
  to understand Task → Complete → Points → Reward).
* **Dynamic viewport / mobile keyboard:** inputs use `min-h-[44px]`, the CTA is in a sticky
  footer with `pb-[env(safe-area-inset-bottom)]` (mirror `Modal.tsx:158`); avoid `100vh` (use
  `dvh`/`min-h-dvh`).
* **Safe-area insets:** respect `env(safe-area-inset-*)` on all fixed/edge elements.
* **Text scaling:** use `rem`/Tailwind text scales; never fix card heights that clip scaled text.

---

## 15. Responsive strategy

Mobile-first. `OnboardingShell` = `min-h-dvh bg-[warm] flex flex-col`, inner
`mx-auto w-full max-w-md sm:max-w-lg px-4` (phone) expanding to a centered two-column "hero +
form" on `lg:` (desktop/PWA) — **do not stretch the mobile card across desktop**; instead cap
width (~`max-w-2xl`) and add whitespace. Breakpoints to verify: iPhone SE (320–375), iPhone 14
Pro (390), large mobile (430), tablet (768), desktop/PWA (≥1024). Primary CTA stays above the
keyboard (sticky footer, safe-area). Tablet/desktop may show the floating mini-cards demo
alongside the form (like `Login.tsx` left/right split) but must remain calm and uncluttered.

---

## 16. Performance strategy

* Landing (S1) depends on **zero** Firestore reads — pure local UI. Feels immediate.
* No heavy animation library; use CSS/Tailwind transitions + `prefers-reduced-motion`.
* i18n `onboarding` namespace is bundled like `startup` (`src/i18n/config.ts`) so first paint is
  localised.
* Avoid layout thrash; memoize step components; keep the machine pure.

---

## 17. Analytics / observability

**Finding:** Queki currently has **no analytics/telemetry vendor**. The only instrumentation is
dev-only `logAuthTrace` / `startupDiagnostics` and `console.*` (stripped in prod via
`import.meta.env?.PROD` guards).

**Decision (per spec — do not add a new vendor solely for this feature):** introduce a minimal
first-party funnel in `lib/onboardingAnalytics.ts`:
* `recordOnboardingEvent(name, props?)` where `name` ∈
  `onboarding_started, onboarding_parent_named, onboarding_child_named, onboarding_demo_seen,
  onboarding_auth_started, onboarding_auth_completed, onboarding_family_created,
  onboarding_first_task_created, onboarding_completed`.
* In **dev**: `logAuthTrace('onboarding:'+name, props)` (consistent with existing diagnostics).
* In **prod**: no-op **unless** a backend callable (e.g. `recordAnalyticsEvent`) is later added;
  then it posts only non-PII props (`step`, `authProvider`, `hadChild`, `taskTemplate`) — **never**
  names or emails. This keeps the funnel ready without introducing a vendor now.
* Wiring to a real pipeline is explicitly a follow-up task, not part of this plan.

---

## 18. Testing strategy (TDD)

Framework: **Vitest + @testing-library/react + user-event** (already configured; see
`Onboarding.test.tsx`, `onboardingCompletion.test.tsx`). Mock `../lib/api`,
`../lib/firebase`, `firebase/auth`, `firebase/firestore` exactly as the existing tests do.

### State / draft
* `useOnboardingMachine`: step navigation forward/back; `patchDraft` preserves values; back never
  loses data; `reset` clears.
* `onboardingDraft`: save/load round-trip; corrupt JSON → `null`; `version` mismatch → `null`;
  `clearDraft` removes both storages; stale draft (familyId set) → cleared + `null`.

### Auth
* email signup path → lands on `/onboarding` with draft intact;
* Google auth (mock `startGoogleAuthentication` + `consumeGoogleRedirectResult`) → auth_completed;
* auth cancelled (redirect-state-missing) → returns to S7;
* auth failed → friendly error + retry;
* existing account (user already has familyId) → redirected to `/`;
* existing-family user hitting `/onboarding` → redirected to `/`;
* managed child hitting `/onboarding` → redirected to `/`.

### Family setup (idempotency)
* `onboardingSetup.ensureFamily` calls `createFamilyAndParent` once; second call (refresh/retry)
  is skipped because `draft.familyId` is set; server guard also rejects a true double-write.
* child creation exactly once (flag + optional name check);
* refresh during `p1` resumes without recreating family/child;
* additional child optional (Skip); second-parent invitation optional (Skip).

### First task
* successful creation writes via `createTask` with child assignee;
* failure → retry; success → `draft.firstTaskId` set;
* no duplicate task from double-click (`submittingRef`).

### Routing / guards
* existing owner never sees onboarding (AppLayout guard + internal guard);
* managed child never enters parent onboarding;
* direct `/onboarding` URL (public) renders S1 when unauthenticated;
* refresh before auth → draft restored at same step;
* refresh after auth → resumes at `p1`/`p2`/`p3` per persisted ids;
* refresh during family bootstrap → waits for `appReady` (StartupScreen), then continues;
* logout/login → draft cleared or resumed correctly; re-auth re-runs setup idempotently.

### UI
* mobile viewport (320/390) renders without horizontal scroll; CTA reachable with keyboard open;
* progress indicator exposes `aria-current` + live region;
* validation announces via `role="alert"`;
* loading states never indefinite (error path reachable);
* reduced-motion: mini-journey conveys model without animation (jsdom + `matchMedia` mock).

### Regression suites to keep green
* `Onboarding.test.tsx` (rewritten), `onboardingCompletion.test.tsx` (rewritten for new
  idempotent completion), `App.test.tsx`, `authBootstrap.test.tsx`, `startupRecovery.test.tsx`,
  `ContinueSetup.test.tsx`, `AddChildModal.flow.test.tsx`, `FamilySettings.test.tsx`.

---

## 19. Risks / regression points

1. **Route relocation (§0):** moving `/onboarding` outside `AppLayout` is the highest-risk change.
   Must preserve the `unauthenticated→/login` and `authenticated+familyId→/` behaviours via
   internal guards; otherwise an owner could be re-onboarded or a child could enter the parent
   flow. **Covered by routing tests above.**
2. **Google redirect reload loses draft** if `localStorage` mirror is omitted. Mitigated by §11.
3. **Double family creation** on refresh/double-click — mitigated by §12 (client flag + server
   transaction guard). The P0 bug in `onboardingCompletion.test.tsx` (denormalised `uid`) must not
   regress: keep calling `refreshCurrentUser(authUser.uid, …)` with the **authoritative** uid.
4. **Slow family bootstrap** after creation could show an empty dashboard; the existing
   `StartupScreen` + `appReady` gate handles it — do not bypass.
5. **Stale draft cross-tab** — mitigated by `sessionStorage` primary + validation on load.
6. **Firestore rules** — none need changing (§20). A careless "make onboarding easier" rule edit
   would weaken security; explicitly forbidden.
7. **Apple provider** — do not invent (§2). Adding it later is a separate backend project.
8. **Mini-journey must not perform real writes** — it is pure presentational state; a test must
   assert zero `createTask`/`createManagedMember` calls during S5.

---

## 20. Firestore rules assessment

**No rule changes are required.** Evidence from `firestore.rules`:
* New-user doc (`isValidOwnerBootstrap`, ~line 1038): `data.uid == uid && data.role == 'parent'
  && !('familyId' in data)` — satisfied by `signUp`/`ensureGoogleUserProfile`.
* Family create (~line 1057): requires `!('familyId' in resource.data)`, `role == 'parent'`,
  sets `role == 'owner'`, `!exists(familyPath)` — exactly what `createFamilyAndParent` does.
* Managed member create (`isValidManagedMemberCreate`, ~line 1045): requires `isOwner(data.familyId)`
  and `isManaged == true` — satisfied because we call it as the owner post-creation.
* Task write (`match /tasks`, ~line 1833): `allow write: if isParent(familyId)` — satisfied
  (owner is parent).
* Wallet create for the child is performed inside `createManagedMember`'s batch
  (`isValidWalletCreate`).

The new flow uses **only** these existing authoritative APIs; it introduces no client-authoritative
financial or gamification mutation and no new readable/writable collection. Therefore the plan
does **not** modify `firestore.rules`. (If a future analytics pipeline writes an
`analyticsEvents` collection, that would be a separate, reviewed rule addition — out of scope.)

---

## 21. Screen-by-screen specification (final proposed copy)

> Copy is English; mirror to `tr/onboarding.json`. `{{child}}`, `{{parent}}`, `{{family}}` are
> interpolated from the draft. Tone: calm, premium, plain.

### S1 — Value proposition (`Step1ValueProposition`)
* **Eyebrow:** Queki
* **H1:** Small wins. Big habits.
* **Sub:** Queki turns everyday responsibilities into progress your child can see.
* **Floating mini-cards (decorative, `aria-hidden`):** `Make your bed · +10 pts`,
  `Homework · Completed`, `New bike · £35 / £100`, `Movie night · 150 pts`.
* **Optional weekly summary:** `This week — 12 tasks done · 240 pts earned · £8 saved`.
* **Primary CTA:** `Set up your family`
* **Secondary:** `I already have an account` → `/login`.

### S2 — Parent first name (`Step2ParentName`)
* **H1:** What should we call you?
* **Field:** `Your first name` (text, required, autofocus).
* **Primary:** `Continue` (disabled until non-empty). **Back:** none (first step) / `Sign out`.

### S3 — Family relationship (`Step3Relationship`)
* **H1:** And you're the…
* **Choices (single select, large touch targets):** `Mum`, `Dad`, `Parent`, `Carer`,
  `Grandparent`, `Other`.
* **Reassurance (note):** `This is just how Queki addresses you — it doesn't change your
  parental controls.`
* **Primary:** `Continue`. **Back:** `Back`.

### S4 — First child personalisation (`Step4ChildName`)
* **H1:** Let's make this yours.
* **Body:** `Add one child's first name and we'll show you how Queki could work for your family.`
* **Field:** `Child's first name` (text, required).
* **Privacy note (`role="note"`):** `Just a first name for now. Nothing is saved until you create
  your account.`
* **Primary:** `Continue`. **Back:** `Back`.

### S5 — Personalised mini journey (`Step5MiniJourney`)
* Uses `{{child}}`. Sequence (text + static cards; motion optional, reduced-motion safe):
  1. `Give {{child}} something to aim for.` → card `Tidy your room · +20 pts`.
  2. `{{child}} completed it!` → `Review · +20 pts`.
  3. `Nice. +20 points earned.`
  4. `Gaming time · 20 / 100 pts` → `One task closer.`
* **Mental model line:** `Task → {{child}} completes → you approve → points → reward.`
* **Secondary teaser:** `And there's more when you're ready.` bullets: `Allowance & wallet`,
  `Saving goals`, `Rewards` (no config required).
* **Primary:** `Looks good` → S6. **Back:** `Back`.

### S6 — Family name (`Step6FamilyName`)
* **H1:** Every family needs a name.
* **Field:** `Family name` (text, required). Placeholder `e.g., The Umutlu Family`.
* **Suggestion (optional, only if derivable from `parentFirstName`):** `How about "{{parent}}'s
  Family"?` as a one-tap chip — never blocks.
* **Primary:** `Continue`. **Back:** `Back`.

### S7 — Ready + account creation (`Step7Account`)
* **H1:** Your family is ready.
* **Summary card:** `{{parent}} · {{relationship}}` / `{{child}} · Child` / `{{family}}`.
* **Body:** `Creating or signing into an account will save this setup.`
* **Auth methods (only those implemented):** `Continue with Google` (primary),
  `Continue with Email` (secondary → `/signup`). **Do not show Apple.**
* **Back:** `Back`. **Cancel:** `Start over` (clears draft → S1).

### P1 — Family composition (`FamilyComposition`, post-auth)
* **H1:** Your family is taking shape.
* **Members list:** parent + child (from store).
* **Actions:** `+ Add another child` (reuse `AddChildModal`), `+ Invite another parent`
  (reuse `buildJoinUrl`/`regenerateFamilyCode` share UI).
* **Primary:** `Continue`. **Allow:** `Skip for now`.

### P2 — First real task (`FirstTask`, post-auth)
* **H1:** Let's give {{child}} their first win.
* **Templates (real `createTask`, assigned to child):** `Tidy bedroom — 20 pts`,
  `Read for 20 minutes — 15 pts`, `Help tidy up — 10 pts`, `Create my own`.
* On create → `draft.firstTaskId` set → advance. **Back:** `Back`. **Allow:** `Skip`.

### P3 — Success (`Success`, post-auth)
* **Restrained transition:** `{{child}}'s first task is ready.` (subtle check animation /
  card transition; no confetti).
* **Final:** `You're all set, {{parent}}.`
* **Checklist:** `✓ {{child}} added` · `✓ First task ready` · `✓ Queki is ready to go`.
* **Primary CTA:** `Go to my dashboard` → `/` (clears draft).
* **Support copy:** `You can add rewards, allowance and saving goals anytime.`

---

## 22. Phased TDD implementation plan (logical commits)

Each phase: write/extend tests first, watch them fail, implement, watch them pass, run the
regression suites.

**Phase A — Scaffold & routing (no behaviour change to users yet)**
1. Add `src/onboarding/` directory + `OnboardingFlow.tsx` shell rendering a placeholder.
2. `src/App.tsx`: move `/onboarding` outside `<AppLayout>` to public route; add internal guards
   (familyId/child → `/`). Tests: direct `/onboarding` renders for unauthenticated; owner/child
   redirected.
3. Add `i18n/locales/{en,tr}/onboarding.json` with S1 copy; wire namespace in `i18n/config.ts`.

**Phase B — Draft persistence & state machine**
4. `lib/onboardingDraft.ts` + tests (round-trip, corrupt, stale, clear).
5. `useOnboardingMachine.ts` + tests (nav, back, patch, reset).
6. `OnboardingShell` + `OnboardingProgress` (semantic, a11y) + tests.

**Phase C — Pre-auth steps S1–S7 (pure UI, no network)**
7. S1 ValueProposition (+ floating cards, weekly summary).
8. S2 ParentName, S3 Relationship, S4 ChildName (with privacy note).
9. S5 MiniJourney (+ `MiniJourney` component, reduced-motion safe) + test asserting **zero**
   api writes.
10. S6 FamilyName (+ suggestion chip).
11. S7 Account (Google + Email; no Apple). Wire `signInWithGoogle` + navigate `/signup`. Tests:
    auth_started/auth_completed, cancelled, failed.

**Phase D — Post-auth setup (idempotent, authoritative APIs)**
12. `lib/onboardingSetup.ts` (`ensureFamily`, `ensureFirstChild`, `ensureFirstTask`) with client
    flags + server-guard reliance + tests (exactly-once each; refresh/retry safe).
13. P1 FamilyComposition (reuse `AddChildModal`, invite share) + Skip.
14. P2 FirstTask (starter templates → `createTask`) + Skip + double-click guard.
15. P3 Success (restrained animation, checklist, `Go to my dashboard`, clears draft).

**Phase E — Errors, analytics, polish**
16. `OnboardingError` + error/recovery mapping for all §13 scenarios; offline detection.
17. `lib/onboardingAnalytics.ts` (dev funnel; prod no-op unless callable exists) + tests.
18. Responsive pass (320/390/430/768/≥1024), safe-area, keyboard, reduced-motion, contrast.

**Phase F — Regression & cleanup**
19. Rewrite `Onboarding.test.tsx` + `onboardingCompletion.test.tsx` for the new flow (keep the P0
    authoritative-uid assertion). Delete the old `src/pages/Onboarding.tsx` (replaced).
20. Run full suite: `authBootstrap`, `startupRecovery`, `ContinueSetup`, `AddChildModal.flow`,
    `FamilySettings`, `App`. Fix any regressions. Verify `firestore.rules` unchanged.

---

## 23. Open questions for product (non-blocking)

* **Apple:** confirm we ship Google + Email only for v1 (recommended) and defer Apple to a
  follow-up backend project.
* **Family-name suggestion:** confirm deriving a suggestion from the parent's first name is
  acceptable (e.g. "Kemal's Family") or whether to omit suggestions entirely.
* **"Invite another parent"** in P1: confirm reusing the family-code share (no dedicated invite
  UI) is acceptable for v1.
* **Avatar for child:** confirm we skip avatar selection in S4 (first name only) and let the
  parent personalise later in `AddChildModal`, to keep S4 frictionless.

---

*End of design specification. No code was modified. Implementation may begin following Phase A–F
with the TDD order above.*
