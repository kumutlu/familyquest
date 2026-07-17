# FamilyQuest Sprint 4B — Notification Edge-Case QA and Settings Status

**Date:** 2026-07-15
**Project:** `familyquest-beta-402cb`
**Scope:** Harden the in-app notification system and expose its real status in Settings. No FCM, no browser push, no preference toggles, no email/SMS, no fake switches, no reward-approval notifications (per the explicit "do not implement" list).

---

## 1. Production Data Audit

A safe, **read-only** Admin SDK script was added at [`scripts/audit-notifications.ts`](scripts/audit-notifications.ts). It never writes, updates, or deletes production data; it only reads and reports.

**Live run (`--discover` mode) results:**
- 19 families scanned.
- 0 notification documents and 0 read-state documents found across all families.
- 0 malformed/legacy records detected.

The notification feature was only deployed at the end of Sprint 4A, so no business events have yet produced live notifications in production. The audit therefore establishes a clean baseline and a repeatable check for the future. Per-user isolation, recipient correctness, and dedupe-key determinism are all verified by the unit tests (see §3, §4, §11) since no live data exercises them yet.

The audit script reports, for any family that later accumulates notifications:
- missing/blank `title`/`body`, missing/invalid `createdAt`, missing `metadata`
- unknown `type`, missing `actionUrl`/`entityId`
- duplicate `recipientIds`, recipients not present in the family (orphans)
- `dedupeKey` not equal to the document id, or two distinct docs sharing a `dedupeKey`
- recipient-role correctness for approver-targeted vs child-targeted types
- read-state coverage (unread counts survive refresh; mark-one/mark-all persist)

---

## 2. Malformed / Legacy Record Handling

[`src/lib/notifications.ts`](src/lib/notifications.ts) now exposes safe rendering helpers used by the UI:
- `getNotificationTitle(n)` → falls back to `NOTIFICATION_FALLBACK_TITLE` (`"Notification"`) when `title` is missing/blank.
- `getNotificationBody(n)` → falls back to `NOTIFICATION_FALLBACK_BODY` (`"You have a new update."`) when `body` is missing/blank.
- `formatRelativeTime` already tolerates invalid `createdAt` (returns a stable fallback rather than throwing).

[`src/components/layout/NotificationCenter.tsx`](src/components/layout/NotificationCenter.tsx) renders every row through these helpers, uses a generic icon for unknown types, and routes unknown/missing `actionUrl` to `/` via the central mapping. A single malformed row cannot break the panel: the list maps over all rows and each row is independently rendered; the malformed row simply shows the fallback title/body. Verified by tests: `renders an unknown notification type safely`, `renders a notification with a missing body using a safe fallback`, `does not crash on an invalid createdAt`, `does not crash when the target entity is missing`, `does not block valid rows when one row is malformed`.

---

## 3. Deduplication Audit

All dedupe keys are now produced by deterministic builders in [`src/lib/notificationDedupe.ts`](src/lib/notificationDedupe.ts) (one per event type, built only from business ids — no timestamps, no random values). [`src/lib/api.ts`](src/lib/api.ts) was refactored to call these builders instead of inline string literals, so the key used at creation time is identical to the document id used for idempotent writes.

Collision guarantees (covered by [`src/lib/notificationDedupe.test.ts`](src/lib/notificationDedupe.test.ts)):
- Deterministic for the same business id.
- No timestamps/random values (`/\d{10,}/` never matches).
- Sender vs recipient transfer keys cannot collide (`transfer_approve_sender_*` vs `transfer_approve_recipient_*`).
- Approval vs rejection keys cannot collide.
- Distinct events produce distinct keys; all four transfer keys for one request id are unique.

Additionally, `buildNotificationData` and `queueNotificationInTransaction` de-duplicate `recipientIds` (`Array.from(new Set(...))`) so a duplicated recipient id can never create a duplicate read-state row.

---

## 4. Recipient Failure Behaviour

Recipient resolution in [`src/lib/notifications.ts`](src/lib/notifications.ts) (`getApproverIds`, `getChildIds`) is **non-fatal**: on any query error it returns `[]` and logs a dev-only diagnostic via `devLog` (silenced in production builds via `import.meta.env.PROD`). The caller then simply skips the notification rather than corrupting the underlying business event.

Hardening added this sprint:
- Docs without a valid `role` or whose `familyId` does not match are skipped, so a notification is never addressed to a deleted/inactive/partial member.
- `queueNotificationInTransaction` de-duplicates recipients and logs skips.
- The actor is excluded from recipients where they would receive no value (verified for task approval and transfer approval in [`src/lib/notifications.api.test.ts`](src/lib/notifications.api.test.ts)).

Tests confirm: `completeTask` still creates the completion when approvers cannot be resolved (notification is skipped, business write succeeds); inactive/deleted members are skipped; actor is excluded.

---

## 5. Central Route Mapping

[`src/lib/notificationRoutes.ts`](src/lib/notificationRoutes.ts) is the single source of truth for navigation. `getNotificationRoute(type, actionUrl?)`:
- Maps every active type to a valid current route: `task_submitted`/`reward_requested`/`transfer_requested` → `/`; `task_approved`/`task_rejected` → `/tasks`; `wallet_deposit`/`wallet_withdrawal`/`transfer_approved`/`transfer_rejected` → `/wallet`; `petbox_contribution`/`petbox_expense` → `/pet-box`.
- Prefers the member-profile `actionUrl` for `behaviour_positive`/`behaviour_negative`.
- Falls back to the stored `actionUrl`, then to `/`, for unknown types.

`NotificationCenter` now navigates exclusively through `getNotificationRoute` (no inline `actionUrl` literals at creation time). `reward_approved`/`reward_rejected` exist in the type union for forward compatibility but are intentionally **not** routed (no reward-approval workflow yet); the route helper safely falls back for them. Covered by [`src/lib/notificationRoutes.test.ts`](src/lib/notificationRoutes.test.ts) (every active type maps to a valid route; unknown types fall back).

---

## 6. Settings Notification Section

[`src/pages/Settings.tsx`](src/pages/Settings.tsx) Notifications section now shows **real capability only**:
- **In-app notifications** → `Active` badge (real status).
- **Notification categories** → six informational rows (Task updates, Reward requests, Wallet updates, Transfer updates, Behaviour updates, Pet Box updates) with a note that per-category preferences are not available yet. **No toggles/switches/checkboxes** are rendered (asserted in tests).
- **Push notifications** → `Not enabled yet` badge. No browser permission is requested.

---

## 7. Role-Specific Settings Copy

Copy is generated from central role helpers (`isOwnerRole`/`isParentRole` in [`src/lib/roles.ts`](src/lib/roles.ts)):
- **Owner/Parent:** "Approval requests — tasks, reward requests, and transfers appear here." (accurate: they receive `task_submitted`, `reward_requested`, `transfer_requested`, `petbox_contribution`).
- **Child:** "Task results, wallet changes, transfers, and behaviour updates appear here." (accurate: they receive `task_approved`/`task_rejected`, wallet events, transfer results, behaviour events). Children are **not** told they get parent-only approval notifications.

Tests assert the correct copy per role and that the approval copy is absent for children.

---

## 8. Notification Health Indicator

A non-interactive `NotificationHealth` component (in [`src/pages/Settings.tsx`](src/pages/Settings.tsx)) shows the real-time connection status driven by [`src/lib/useNotifications.ts`](src/lib/useNotifications.ts):
- `Connecting…` (amber), `Connected` (green), `Temporarily unavailable` (red). Status is **not** colour-only — each state has a text label and an icon.
- `Connected` is only reported after the realtime listener's first successful snapshot (authenticated user + `familyId` + listener initialized).
- A **Retry** button appears **only** in the `unavailable` state and calls the hook's safe `retry()` (a `retryNonce` bump that re-subscribes without leaking listeners). No Retry button when connected.
- A `aria-live="polite"` region announces the status label once (not on every unread-count update).

Tests cover all three states and confirm the Retry button is absent when connected and present only when unavailable.

---

## 9. Listener / Performance Audit

[`src/lib/useNotifications.ts`](src/lib/useNotifications.ts) was reviewed for listener hygiene:
- Exactly **one** `subscribeToNotifications` + **one** `subscribeToReadStates` listener per mounted hook (per user).
- Effect dependencies are `[familyId, userId, retryNonce]`; cleanup unsubscribes on every change, on sign-out (`userId` → `null`), and on unmount.
- **Strict Mode** double-invoke is safe: the first effect's cleanup runs before the second, so active subscription count returns to the expected value (no duplicate listeners). Verified by `does not create duplicate active subscriptions under Strict Mode`.
- No per-row actor/member reads — recipient resolution reuses cached family-member data via the existing `getApproverIds`/`getChildIds` queries, and rows render from already-loaded notification documents.
- `NotificationCenter` is mounted **once** in [`src/components/layout/AppLayout.tsx`](src/components/layout/AppLayout.tsx), so there is no duplicate mount driving duplicate subscriptions.

---

## 10. Retention Recommendation

Current behaviour (verified, not changed):
- The notifications listener is bounded to the latest **20** (`NOTIFICATION_PAGE_SIZE`) filtered by `recipientIds`, ordered by `createdAt` desc, with a bounded "Load more" page. No full-collection scans; read-state docs are read per notification id, not in an unbounded sweep.
- No client-side deletion of notifications or read states (security rules forbid client deletes), so there is no insecure cleanup.

**Recommendation (future, trusted backend only):** implement a 90-day retention policy that deletes read notifications (and their read states) via a scheduled Admin function or Cloud Function, not from the client. Until a trusted backend exists, no scheduled cleanup is added this sprint, matching the spec's constraint.

---

## 11. Tests

**Unit tests — all passing: 459/459** (`npm test`). **Rules tests — all passing: 198/198** (`npm run test:rules`).

New/extended coverage for this sprint:
- [`src/lib/notificationRoutes.test.ts`](src/lib/notificationRoutes.test.ts) — every active type maps to a valid route; unknown types fall back; behaviour prefers profile URL.
- [`src/lib/notificationDedupe.test.ts`](src/lib/notificationDedupe.test.ts) — determinism, no timestamps, sender/recipient & approval/rejection non-collision, per-request uniqueness.
- [`src/lib/notifications.test.ts`](src/lib/notifications.test.ts) — safe title/body fallbacks; `recipientIds` de-duplication; invalid members skipped in `getApproverIds`/`getChildIds`; listener bounded to 20 by recipient.
- [`src/lib/notifications.api.test.ts`](src/lib/notifications.api.test.ts) — recipient resolution failure does not fail the business action; actor excluded from task/transfer approval recipients.
- [`src/lib/useNotifications.test.ts`](src/lib/useNotifications.test.ts) — single subscription, `connected` after snapshot, `unavailable` + mapped error, `loadMore` merges by id with no duplicates, cleanup on sign-out, re-subscribe on `familyId` change, no duplicate subscriptions under Strict Mode, safe retry.
- [`src/components/layout/NotificationCenter.test.tsx`](src/components/layout/NotificationCenter.test.tsx) — unknown type → `/` fallback, known type → central route, safe render of unknown/missing-body/invalid-createdAt/missing-target/malformed rows without crashing or blocking valid rows.
- [`src/pages/Settings.test.tsx`](src/pages/Settings.test.tsx) — In-app `Active` with no toggles, Push `Not enabled yet`, six categories listed, accurate owner/parent vs child copy, the three connection states, Retry button only when unavailable.

All 26 spec-enumerated edge cases are covered.

---

## 12. Build

`npm run build` (`tsc -b && vite build`) succeeds. The only output notes are pre-existing, non-blocking warnings (a >500 kB bundle chunk and an ineffective dynamic import of `api.ts`); neither is introduced by this sprint. `import.meta.env.PROD` is used for dev-only diagnostics so they are eliminated from the production bundle.

---

## 13. Deployment

`firebase deploy --only hosting --project familyquest-beta-402cb` — **complete**.
- No `firestore.rules` or `firestore.indexes.json` changes were required (the notification security rules and indexes from Sprint 4A remain correct), so hosting-only deployment is appropriate per the spec.
- Hosting URL: `https://familyquest-beta-402cb.web.app`
- The predeploy `npm run build` ran and passed as part of the deploy.

---

## 14. Remaining Work Before Push Notifications

To move from in-app-only to real push (FCM / browser push), the following remain (explicitly **out of scope** for this sprint):
1. **Trusted backend for delivery** — FCM token registration, server-side fan-out, and a 90-day retention cleanup job (see §10). Client must not hold FCM server keys.
2. **Per-category preference toggles** — once a backend can store them; today Settings shows informational rows only, by design.
3. **Reward-approval notifications** — only after a genuine reward-approval workflow exists; `reward_approved`/`reward_rejected` are reserved in the type union but unrouted.
4. **Browser permission request** — must be user-initiated (not on Settings load) and gracefully degrade when denied; the "Not enabled yet" badge stays until then.
5. **Email/SMS** — not planned; excluded by spec.
6. **Production data soak** — re-run [`scripts/audit-notifications.ts`](scripts/audit-notifications.ts) after real families generate notifications to confirm per-user isolation and dedupe behaviour on live data (baseline this sprint: 0 records, 0 malformed).
