# Production Startup / Deployment Investigation

**Scope:** Issue 1 (Family Challenge UX not in production) + Issue 2 (Connection problem after deploys).
**Out of scope (per instructions):** gamification, rewards, XP, challenge logic, activity attribution, Firestore rules, unrelated UI.

---

## A. Deployment diagnosis (Issue 1)

### Evidence gathered

| Check | Result |
|-------|--------|
| Local branch | `fix/notification-read-state` |
| Local HEAD | `1034bff923ae6a355d6996c0e0a38a4f2b688947` — `feat(family): clarify family challenge states` |
| `git branch -r --contains 1034bff` | **empty** — the commit is on **no remote branch** |
| `git merge-base --is-ancestor 1034bff origin/main` | **NO** — not an ancestor of `origin/main` |
| `origin/main` HEAD | `5dda1f6` (`fix(goals): enforce seeded goal creation at trust boundary`) |
| `origin/fix/notification-read-state` HEAD | `db9c7a5` — **2 commits behind** local (`1034bff`, `5b365e5` are local-only) |
| CI deploy workflow | `.github/workflows/ci.yml` only runs a **freeze-guard** on `push: [main]` + PRs. **No deploy job.** |
| Hosting config | `firebase.json` → `hosting.public: "dist"`, project `familyquest-beta-402cb` (`.firebaserc`). |
| What `1034bff` changed | `src/pages/Family.tsx` (+`Family.test.tsx`, `en/tr family.json`) — the Family Challenge card UX. |
| `origin/main:src/pages/Family.tsx` | Still contains the **old** card: `Reward: {activeChallenge.rewardPoints} pts each` and `Complete Challenge & Award Points!` (lines ~128, ~134). |

### Diagnosis

**The Family Challenge UX commit (`1034bff`) exists only on the local `fix/notification-read-state` branch. It has never been pushed to `origin`, never merged into `origin/main`, and therefore has never been built or deployed.**

Production is served from `origin/main` (the only branch with a CI gate; there is no other deploy pipeline in the repo). `origin/main`'s `Family.tsx` still renders the legacy card the user sees on queki.app:

```
100% Complete
Reward: 100 pts each
[Complete Challenge & Award Points!]
```

So the purple Family Challenge card is "still old" simply because **the new code was never shipped** — not because of a caching or build regression. The UX implementation is correct and complete in the local commit; it just isn't in the deployed artifact.

**Action required (not performed — awaiting your go-ahead):** push `fix/notification-read-state` and merge/PR it into `main`, then deploy. No code change to `Family.tsx` is needed.

---

## B. Startup root cause (Issue 2)

### The startup gate (what shows "Connection problem")

- `src/components/layout/startupState.ts:25` — `deriveStartupPhase()` maps store state → `auth | profile | family | ready | error`.
- `src/components/layout/AppLayout.tsx:32` — `AppLayout` renders `<StartupScreen>` whenever the phase ≠ `ready`.
- `src/components/layout/StartupScreen.tsx:26` — `STARTUP_TIMEOUT_MS = 20000` (raised from 15s; see comment lines 18-24).
- `StartupScreen.tsx:75-80` — a **per-phase** `setTimeout(STARTUP_TIMEOUT_MS)` flips `timedOutToken`; when it matches, `failed = true` and the generic copy is shown:
  - `StartupScreen.tsx:90` — `body = phase === 'error' && error ? error : t('timeoutBody')` where `timeoutBody` = *"Startup is taking longer than expected. Check your connection and try again."* (`src/i18n/locales/en/startup.json:8`).
- `StartupScreen.tsx:100` — `errorTitle` = **"Connection problem"**.

So the screen is a **per-phase 20s timeout that collapses every failure into one generic message**, regardless of which phase stalled or why.

### Bootstrap path (Firebase → ready)

`src/App.tsx:39` calls `initAuth()` on mount. `src/store/useStore.ts:238` `initAuth()`:
1. `onAuthStateChanged` (line 242) → sets `authStatus: authenticated` (line 271).
2. `await user.getIdToken()` + `getIdTokenResult()` for custom claims (lines 290-295).
3. Profile: `onSnapshot` + `getDocFromServer` fallback (lines 406-461).
4. On profile resolve → `loadFamilyData()` (line 395) → ~20 parallel `getDocsFromServer` reads; when all report ready, `appReady = true` (line 551).

The store logic itself is **robust** (generation guards, `.finally` not-found fallback, `retryBootstrap` tears down listeners — `useStore.ts:924`). The stall is not a logic bug in the happy path; it is triggered by the deployment.

### Root cause: service-worker update strategy

`vite.config.ts` PWA config (lines 71-135):

```ts
VitePWA({
  selfDestroying: true,
  registerType: 'autoUpdate',     // line 73
  workbox: {
    skipWaiting: true,            // line 110
    clientsClaim: true,           // line 111
    cleanupOutdatedCaches: true,  // line 112
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
  },
})
```

There is **no `registerSW` import anywhere in `src/`** (confirmed by search). `vite-plugin-pwa` defaults to `injectRegister: 'auto'`, so it **auto-injects a registration `<script>` into the built `index.html`**. That script uses `autoUpdate`, which calls `skipWaiting()` on the new SW and reloads the page on `controllerchange`.

`src/main.tsx:10` + `src/serviceWorkerUpdate.ts:6-18` add a second reload path:

```ts
serviceWorker.addEventListener('controllerchange', () => {
  if (refreshing) return;
  refreshing = true;
  reload();   // window.location.reload()
});
```

**The dangerous combination is `autoUpdate` + `skipWaiting: true` + `clientsClaim: true`.** This is the textbook cause of "app breaks right after a deploy, retry fixes it":

1. A new deploy uploads a new `index.html`, new hashed JS chunks, and a new `sw.js` whose precache manifest lists **only the new chunk hashes**.
2. The already-open Queki tab's auto-injected `registerSW` detects the new `sw.js` and calls `skipWaiting()`.
3. `clientsClaim: true` makes the new SW call `clients.claim()` → it **takes control of the open tab immediately, while the previous bundle is still executing** (`controllerchange` fires).
4. `installServiceWorkerUpdateReload` then calls `window.location.reload()`.

The failure window is between steps 3 and 4 (and any reload that races with a partially-live deploy):

- The **old page is now controlled by the new SW**, whose precache contains only **new** chunk filenames. Any chunk the old bundle requests by its **old** hash is no longer in the new precache and is gone from the server → the request 404s (or, because `firebase.json` rewrites `**` → `/index.html`, returns HTML instead of JS) → **chunk-load failure**.
- A chunk-load failure during bootstrap means `initAuth`/Firebase never finishes: `authStatus` stays `'initializing'` (or the family listeners never report ready), so `deriveStartupPhase` stays in `auth`/`profile`/`family`.
- After `STARTUP_TIMEOUT_MS` (20s) the `StartupScreen` timeout fires and shows the generic **"Connection problem"**.
- A manual **Retry** is a clean full reload against the now-fully-deployed new version → consistent assets → app loads. This exactly matches "Retry eventually loads the app."

### Why it is especially visible after deployments

The bug is **deployment-correlated by construction**: it only manifests when a new `sw.js` is published while a tab is open. On a quiet day there is no new SW, so no `controllerchange`, so no disruption. Immediately after a deploy, every open tab goes through the `skipWaiting` + `clientsClaim` takeover → the race above.

### Why it is NOT a Firebase-initialization delay per se

Firebase Auth / profile / family reads are healthy on retry. The trigger is the **asset-version mismatch caused by the SW taking over the open tab**, not a slow backend. (The 15s→20s bump in `StartupScreen.tsx:18-24` was treating a symptom, not this cause.)

---

## C. Proposed minimal fix

### Files to change

1. **`vite.config.ts`** (lines 110-111) — remove the disruptive takeover:
   - `skipWaiting: true` → `false` (or delete the key).
   - `clientsClaim: true` → `false` (or delete the key).
   - Keep `registerType: 'autoUpdate'` and `cleanupOutdatedCaches: true`.

   **Why this is safe and minimal:** With `clientsClaim: false`, when the new SW activates it does **not** claim the open tab. The open tab keeps running under the **old, consistent** SW (old precache, old app shell + old chunks) until the user performs a full reload. No open tab ever mixes an old app shell with new chunks, so the chunk-load race is eliminated. Offline/PWA functionality is **preserved** — the SW is still installed and controlling; only the *timing* of the update changes. `cleanupOutdatedCaches` still reclaims the old cache on the next load.

   Note: `autoUpdate` will still call `skipWaiting()` programmatically, but without `clientsClaim` the new SW will not disrupt the open tab; it simply becomes the active SW for the **next** navigation. This is the smallest change that guarantees version consistency.

2. **`src/serviceWorkerUpdate.ts`** (optional hardening) — the `controllerchange`→reload listener becomes inert once `clientsClaim` is off (no spurious reload mid-session). Leave it as a safety net, or gate the reload so it never fires while `deriveStartupPhase` is not `ready` (avoid reloading a tab that is mid-bootstrap). No behavior change required for the fix itself.

3. **Observability (safe, non-blocking)** — make the generic screen diagnosable without exposing user/Firebase data:
   - `src/components/layout/StartupScreen.tsx` — when `timedOutToken === token`, emit a **phase-specific** console diagnostic: `AUTH_TIMEOUT` / `PROFILE_LOAD_TIMEOUT` / `FAMILY_LOAD_TIMEOUT` (use the `phase` already in props). Keep the user-facing copy generic.
   - Add a global `window` `'error'`/`'unhandledrejection'` listener (e.g. in `src/main.tsx` or a small module) that detects chunk-load failures (`ChunkLoadError`, `"Failed to fetch dynamically imported module"`, `"Importing a module script failed"`) and logs `CHUNK_LOAD_ERROR`; optionally surface a distinct, non-sensitive message instead of the generic timeout.
   - Detect `SERVICE_WORKER_VERSION_MISMATCH`: compare `FAMILYQUEST_BUILD.sha` (`src/buildInfo.ts:45`) against the SW's cached build id, or flag a `controllerchange` that occurs **during** bootstrap (phase ≠ `ready`) and log `SERVICE_WORKER_VERSION_MISMATCH`.
   - `FIRESTORE_UNAVAILABLE` / `AUTH_TIMEOUT` can be derived from existing `bootstrapError` prefixes (`[Auth]`, `[Profile]`, `[Family]`) already set in `useStore.ts`.

### What we must NOT do (per safety rules)
- Do **not** increase `STARTUP_TIMEOUT_MS`.
- Do **not** hide/auto-dismiss the Connection Problem screen.
- Do **not** add an automatic `window.location.reload()` on failure.
- Do **not** disable auth guards, Firebase readiness, family/profile loading, or Firestore rules.
- Do **not** disable PWA/offline (we are only changing update *timing*).

### Service-worker/PWA involvement
Yes — the root cause is entirely in the SW update strategy (`vite.config.ts`). The fix is confined to that config plus safe, additive observability. No business logic, gamification, or Firestore changes.

---

## D. Tests to add / change

Existing coverage already exercises the gate well:
- `src/components/layout/StartupScreen.test.tsx` (per-phase timeout, late success clears error, retry restarts timers).
- `src/components/layout/startupRecovery.test.tsx` (stuck auth/profile/family → recoverable screen).
- `src/store/authBootstrap.test.tsx` (auth/profile/family race, StrictMode double-effect).
- `src/store/retryBootstrap.test.ts` (retry genuinely restarts bootstrap).

Proposed **additions** (to be implemented after approval):

1. **`src/serviceWorkerUpdate.test.ts`** (exists) — extend with a test asserting that when `clientsClaim` is disabled, a `controllerchange` during an active bootstrap does **not** produce a false "Connection problem" and the open tab keeps a consistent controller. (Currently the file only covers the reload-on-update path.)
2. **New: stale-SW / chunk-mismatch scenario** — simulate an open tab controlled by an *old* SW while a *new* `sw.js` is present; assert the app does not enter a mixed-version state and that a clean reload (not a mid-session takeover) is the only path to the new version. This can be a jsdom unit test using the `serviceWorker` mock already accepted by `installServiceWorkerUpdateReload`, plus a Playwright preview test if a built artifact is available.
3. **`StartupScreen` phase diagnostics** — assert that a timeout in `auth` logs `AUTH_TIMEOUT`, `profile` → `PROFILE_LOAD_TIMEOUT`, `family` → `FAMILY_LOAD_TIMEOUT` (spy on `console.info`/`console.error`), and that the **user-facing** copy remains the generic, non-sensitive message.
4. **Chunk-load error detection** — dispatch a `ChunkLoadError`/`"Failed to fetch dynamically imported module"` `error` event before bootstrap completes; assert it is classified as `CHUNK_LOAD_ERROR` and does **not** collapse into the generic timeout body.
5. **No false positive while legitimately initializing** — already partially covered (StartupScreen.test.tsx #10/#19); add an explicit assertion that a bootstrap resolving just under `STARTUP_TIMEOUT_MS` never shows "Connection problem" (regression guard for the 20s budget).

### Verification to run (after approval)
- `npm run typecheck` (tsc)
- `npx vitest run src/components/layout src/store src/serviceWorkerUpdate.test.ts`
- `npm run build` (production build succeeds; confirm `dist/sw.js` no longer sets `clientsClaim`/`skipWaiting`)
- Optional: `npm run test:smoke` (Playwright prod config) for the stale-SW scenario.

---

## Summary for sign-off

- **Issue 1:** `1034bff` is local-only, never pushed/merged/deployed → production runs `origin/main` with the old `Family.tsx`. Fix = ship the commit (push + merge to `main` + deploy). No `Family.tsx` edit required.
- **Issue 2:** Root cause is `vite.config.ts` PWA `autoUpdate` + `skipWaiting: true` + `clientsClaim: true`, which takes over already-open tabs on deploy and causes an old-app-shell/new-chunk mismatch → bootstrap stalls → 20s `StartupScreen` timeout → "Connection problem". Minimal safe fix = disable `skipWaiting`/`clientsClaim` (keep offline/PWA), plus additive, non-sensitive observability to distinguish `AUTH/PROFILE/FAMILY_LOAD_TIMEOUT`, `CHUNK_LOAD_ERROR`, `SERVICE_WORKER_VERSION_MISMATCH`, `FIRESTORE_UNAVAILABLE`.

**No code has been changed, no commit/push/deploy performed. Awaiting approval before implementing the fix and tests in section C/D.**
