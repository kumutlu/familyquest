# FamilyQuest Sprint 4A — Real In-App Notification Center

## Final Report

### 1. Audit

**Bell (before):** `src/components/layout/AppLayout.tsx` rendered a placeholder bell that read the family-wide `feed` collection and showed a simple dot when any `feed` item existed. It had no unread count, no per-user read state, no notification panel, and no per-recipient isolation.

**`feed` collection:** Family-wide readable (`allow read: if isFamilyMember(familyId)`) with `visibleTo` arrays. It is **not** suitable for the notification requirements: children must not be able to read other children's notifications, read state must be per-user, and the spec forbids unbounded arrays of read user IDs inside a notification doc. Reusing `feed` would have required weakening its rules or duplicating its read model.

**Decision:** A **dedicated `notifications` collection** was created. The existing `feed` rules were left untouched (spec requirement). Notifications reuse the same `familyId` scoping and the same `isFamilyMember`/`isParent` helper functions already present in `firestore.rules`.

**APIs creating feed entries:** `completeTask`, `approveTaskCompletion`, `rejectTaskCompletion`, `addBehaviourEvent`, `redeemReward`, `depositToWallet`, `withdrawFromWallet`, `addFundExpense`, `contributeToFund`, `createTransferRequest`, `approveTransferRequest`, `rejectTransferRequest` (all use `runTransaction` + `transaction.set(feedRef, …)`). Notification writes were queued inside the same transactions.

**Role helpers:** `src/lib/roles.ts` (`isParentRole`, `isOwnerRole`, `isChildRole`) plus the rules helpers `isParent`/`isOwner`/`isChildInFamily`. Recipient resolution uses Firestore queries (`getApproverIds` = owner+parent, `getChildIds` = child) and is **non-fatal** (returns `[]` on error so a notification problem never corrupts the business event).

**Realtime listeners:** The app already uses `onSnapshot` for bootstrap queries. The notification center uses bounded `onSnapshot` queries (`limit(20)` + `orderBy createdAt desc` + `where recipientIds array-contains userId`).

### 2. Data Model

`families/{familyId}/notifications/{notificationId}` with fields:

| Field | Type | Notes |
|---|---|---|
| `familyId` | string | must equal the document family |
| `type` | enum | one of 15 `NotificationType` values |
| `actorId` | string | authenticated actor uid (never `"system"`) |
| `recipientIds` | string[] | 1–50 recipients; each has independent read state |
| `title` | string | |
| `body` | string | |
| `entityType` | string? | task, reward, transfer, behaviour_event, fund… |
| `entityId` | string? | |
| `actionUrl` | string? | route the UI navigates to |
| `dedupeKey` | string? | becomes the document id for idempotent writes |
| `createdAt` | timestamp | `request.time` on create |
| `metadata` | map? | structured extras |

Content is **immutable** (no `update`/`delete` from clients).

### 3. Read-State Model

**Option A** was chosen: `families/{familyId}/notification_reads/{userId_notificationId}`.

- One document per (user, notification) pair → independent unread/read per recipient.
- Fields: `familyId`, `userId`, `notificationId`, `readAt` (server timestamp).
- Created/updated only by the recipient (`userId == request.auth.uid`), only for a notification they are allowed to read, and only with `readAt == request.time`.
- No unbounded arrays; no client deletes (retention is server-side).

### 4. Event Matrix

| # | Event | Type | Recipients | Implemented |
|---|---|---|---|---|
| 1 | Child completes a task | `task_submitted` | owner + parent | ✅ |
| 2 | Child redeems a reward | `reward_requested` | owner + parent | ✅ |
| 3 | Child creates transfer request | `transfer_requested` | owner + parent | ✅ |
| 4 | Task approved | `task_approved` | the child | ✅ |
| 5 | Task rejected (with comment) | `task_rejected` | the child | ✅ |
| 6 | Reward approved | — | the child | ⏸ deferred (see §14) |
| 7 | Reward rejected (with comment) | — | the child | ⏸ deferred (see §14) |
| 8 | Transfer approved | `transfer_approved` | sender **and** recipient (two distinct docs) | ✅ |
| 9 | Transfer rejected | `transfer_rejected` | the sender | ✅ |
| 10 | Wallet deposit | `wallet_deposit` | the child | ✅ |
| 11 | Wallet withdrawal | `wallet_withdrawal` | the child | ✅ |
| 12 | Positive behaviour | `behaviour_positive` | the child | ✅ |
| 13 | Negative behaviour | `behaviour_negative` | the child | ✅ |
| 14 | Pet Box contribution | `petbox_contribution` | owner + parent | ✅ |
| 15 | Pet Box expense | `petbox_expense` | children only | ✅ |

13 of 15 events are wired. The actor is never notified about their own action.

### 5. Business APIs Changed

All integrations live in `src/lib/api.ts` and call `queueNotificationInTransaction(transaction, familyId, input)` inside the existing `runTransaction`:

- `completeTask` — `task_submitted` (only when `requiresApproval` and approvers resolve)
- `approveTaskCompletion` — `task_approved`
- `rejectTaskCompletion` — `task_rejected` (includes the comment)
- `redeemReward` — `reward_requested`
- `addBehaviourEvent` — `behaviour_positive` / `behaviour_negative`
- `depositToWallet` — `wallet_deposit`
- `withdrawFromWallet` — `wallet_withdrawal`
- `addFundExpense` — `petbox_expense` (children)
- `contributeToFund` — `petbox_contribution` (approvers)
- `createTransferRequest` — `transfer_requested`
- `approveTransferRequest` — `transfer_approved` ×2 (sender + recipient)
- `rejectTransferRequest` — `transfer_rejected`

Recipient resolution (`getApproverIds` / `getChildIds`) runs **before** the transaction and is non-fatal.

### 6. Atomicity & De-duplication

- **Atomicity:** the notification write shares the same `runTransaction` as the business event, so either both commit or neither does. A notification failure cannot corrupt wallet/task/reward state (recipient resolution failures degrade to "no notification", not a thrown error that aborts the transaction).
- **De-duplication:** when a `dedupeKey` is supplied it becomes the document id. `queueNotificationInTransaction` reads the doc first and skips the `set` when it already exists, so a retried/duplicate event never produces a duplicate notification. `dedupeKey` examples: `task_submit_<completionId>`, `task_approve_<completionId>`, `transfer_approve_sender_<requestId>`, `transfer_approve_recipient_<requestId>`.

### 7. Bell / Panel Behaviour

`src/components/layout/NotificationCenter.tsx` + `src/lib/useNotifications.ts`:

- **Badge:** hidden at 0; exact count 1–9; `"9+"` at ≥10. Bell `aria-label` includes the unread count.
- **Realtime:** unread count derived from the bounded notification listener + the read-state listener.
- **Panel:** header "Notifications", "Mark all as read" (disabled at 0 unread), "Close". Rows show type icon, title, body, relative timestamp, unread indicator (blue dot + bold title + `sr-only` "Unread" — distinguishable without colour). Clicking a row marks it read, closes the panel, and navigates to `actionUrl` (falls back to `/` when missing). **Opening the panel does NOT auto-mark anything read.**
- **Mobile:** bottom sheet (`fixed bottom-0 … rounded-t-2xl` + `pb-[env(safe-area-inset-bottom)]`) with a backdrop; sticky header; scrollable list. **Desktop:** anchored dropdown (`md:absolute md:w-96`).
- **Empty state:** "You're all caught up / No new notifications."
- **Bounded listener:** latest 20 via `onSnapshot`; older items via "Load more" (`fetchNotificationsPage` with cursor). No unbounded realtime listener; pagination merges by id so no duplicate rows.

### 8. Navigation Targets

| Type | `actionUrl` |
|---|---|
| `task_submitted` | `/` |
| `task_approved` / `task_rejected` | `/tasks` |
| `reward_requested` | `/` |
| `transfer_requested` | `/` |
| `transfer_approved` / `transfer_rejected` | `/wallet` |
| `wallet_deposit` / `wallet_withdrawal` | `/wallet` |
| `behaviour_positive` / `behaviour_negative` | `/family/{childId}` |
| `petbox_contribution` / `petbox_expense` | `/pet-box` |

Missing entity → mark read, navigate to `/`, no crash.

### 9. Role / Recipient Handling

- `getApproverIds` resolves owner + parent members; `getChildIds` resolves child members. Both are centralised and non-fatal.
- Child results are addressed to the **affected child only** (except transfers, which notify both parties distinctly).
- Rules enforce recipient access: a notification is readable only by `request.auth.uid in resource.data.recipientIds` **and** `isFamilyMember`. Children can never read another child's notification, and never query all family notifications client-side (the query is `where recipientIds array-contains uid`).
- Cross-family access is denied by `familyId` checks in every rule.

### 10. Security Rules (`firestore.rules`)

`notifications/{notificationId}`:
- read: `isFamilyMember(familyId) && request.auth.uid in resource.data.recipientIds`
- create: `isParent(familyId)` + exact key set + `familyId == familyId` + `actorId == request.auth.uid` + `recipientIds` is a list, size 1–50, + `createdAt == request.time`
- update/delete: `false` (immutable, no client deletes)

`notification_reads/{readId}`:
- read: `isFamilyMember(familyId) && resource.data.userId == request.auth.uid`
- create/update: `request.auth.uid == request.resource.data.userId` + `familyId == familyId` + exact key set + `readAt == request.time` + the referenced notification exists **and** its `recipientIds` contains `request.auth.uid`
- delete: `false`

This prevents: forging notifications/recipients by children, reading another child's notification, modifying content, marking another user's read state, cross-family access, and malformed records. The `feed` rules were not weakened.

### 11. Tests

- **Unit (`src/lib/notifications.test.ts`, 14 tests):** builder, `toMillis`, `formatRelativeTime`, `mapNotificationError`, `queueNotificationInTransaction` (skip when no recipients / write new / dedupe existing), recipient resolution failure → `[]`.
- **API integration (`src/lib/notifications.api.test.ts`, 14 tests):** all 13 wired events produce the correct notification type/recipients/title/body/dedupeKey; transfer approval produces two distinct docs; reusing a `dedupeKey` produces no duplicate.
- **Component (`src/components/layout/NotificationCenter.test.tsx`, 16 tests):** badge 0 / 1–9 / 9+, newest-first order, no auto-mark on open, mark-one + navigate, missing-entity fallback, focus returns to bell, mark-all, disabled mark-all at 0, empty state, load-error message, unread indicator, Escape closes + focus returns, mobile bottom-sheet, broken-notification resilience.
- **Firestore rules (`tests/firestore/notifications.rules.test.ts`, 23 tests):** child cannot create/forge, child cannot read another child's, parent/owner can create valid, malformed/empty/oversized/foreign-family/wrong-timestamp rejected, content immutable, read-state ownership + `readAt == request.time` + notification existence + recipient membership enforced, cross-family denied.
- **Full suites:** `npm test` → 415 passed; `npm run test:rules` → 198 passed (10 files).

### 12. Build

`npm run build` (`tsc -b && vite build`) passes. The new composite index was added to both `firestore.indexes.json` and the source constant `bootstrapCompositeIndexes` in `src/lib/bootstrapQueries.ts` so the index config test (`tests/config/firestoreIndexes.test.ts`) stays green.

### 13. Deployment

`firebase deploy --only hosting,firestore:rules --project familyquest-beta-402cb` completed successfully:
- Hosting released to https://familyquest-beta-402cb.web.app
- Firestore rules released to cloud.firestore

No Cloud Functions were changed, so only hosting + rules were deployed (per spec).

### 14. Deferred Items

- **Push / FCM / service workers / email / SMS:** explicitly out of scope for this sprint. The `notifications` data model is structured so push can later reuse the same records (a Cloud Function can read `notifications` and deliver via FCM) without a data migration.
- **Notification preference toggles / per-type opt-out:** deferred. The `Settings.tsx` notification category UI exists but is unrelated to this in-app model; no preference gating was added.
- **Profile-update notifications:** deferred per spec.
- **Events 6 & 7 (Reward approved / Reward rejected):** **not implemented because the current production `redeemReward` flow completes immediately** (points are deducted and the redemption is created with `status: 'completed'`) — there is no pending reward-approval/rejection state in the codebase, so there is no production event to notify on. Event 2 (`reward_requested`, child redeems → approvers) is implemented. If a future sprint introduces a reward-approval step, the `reward_approved` / `reward_rejected` types are already reserved in `NotificationType` and only need an `api.ts` integration. This decision is documented here for traceability.
