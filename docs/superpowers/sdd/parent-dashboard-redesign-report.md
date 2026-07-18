# FamilyQuest UI Sprint 2 — Parent Dashboard Redesign: Final Report

**Date:** 2026-07-14
**Project:** familyquest-beta-402cb
**Scope:** UI-only redesign of the parent Home dashboard. No data-model, security-rule, role-permission, approval-logic, wallet-calculation, or task/reward-API changes.

---

## 1. Dashboard Structure

The parent Home dashboard (`/`) is now composed of five ordered sections, matching the spec exactly:

1. **Welcome Header** — `DashboardHeader.tsx`
2. **Quick Actions** — `QuickActions.tsx` (reusing `QuickActionCard.tsx`)
3. **Pending Approvals** — `PendingApprovalsSection.tsx` (reuses `ApprovalCenter.tsx`)
4. **Children Overview** — `ChildrenOverview.tsx` (reusing `ChildSummaryCard.tsx`)
5. **Recent Family Activity** — `RecentActivity.tsx`

The `ParentDashboard.tsx` orchestrates these sections, plus the retained owner-only join-request panel, the `ReversalHistoryPanel`, and the three existing form modals. The old Stat cards and inline wallet modal were removed.

## 2. Components Added / Reused

**Added (new files in `src/components/parent/dashboard/`):**
- `DashboardHeader.tsx` — time-based greeting (`getGreeting()` → Good morning/afternoon/evening), first name from `currentUser.displayName`, optional `familyData.name` badge, subtext "Here's what's happening with your family today."
- `QuickActionCard.tsx` — reusable card (icon, label, optional helper, `onClick`, accent classes, `aria-label`, focus-visible ring).
- `QuickActions.tsx` — the six actions (New Task, New Reward, Log Behaviour, Add Money, Pet Box, Invite Member).
- `PendingApprovalsSection.tsx` — thin wrapper returning `<ApprovalCenter />`.
- `ChildSummaryCard.tsx` — avatar, name, level, points, canonical wallet balance, streak, pending-task count, "View Profile" link to `/family/{child.id}`.
- `ChildrenOverview.tsx` — filters child-role members, maps to `ChildSummaryCard`, loading skeleton, empty handling.
- `RecentActivity.tsx` — latest 8 feed events with type icon, text, actor label, timestamp; empty state "No family activity yet."

**Reused (unchanged logic):**
- `ApprovalCenter.tsx` (approvals data, Approve/Reject, "You're all caught up!" empty state, "Pending (N)" count).
- `ReversalHistoryPanel.tsx`, `HistoryActionControl.tsx`.
- `TaskFormModal.tsx`, `RewardFormModal.tsx`, `BehaviourFormModal.tsx`.
- UI primitives: `Card`, `Button`, `Avatar`, `CurrencyDisplay`, `Badge`, `Progress`.

## 3. Modals / Routes Reused

- **New Task** → opens existing `TaskFormModal` (no new form).
- **New Reward** → opens existing `RewardFormModal`.
- **Log Behaviour** → opens existing `BehaviourFormModal` (passes `childrenList` from store).
- **Add Money** → `navigate('/wallets')`.
- **Pet Box** → `navigate('/pet-box')`.
- **Invite Member** → `navigate('/settings')` (existing invite-code UI).
- **View Profile** (per child) → `Link` to `/family/{child.id}` (existing `MemberProfile` route).

No duplicate forms were created; all actions reuse existing modals/routes.

## 4. Canonical Data Sources

- **Wallet balance:** `childWallets.find(w => w.id === child.id)?.balance` only (the `families/{familyId}/wallets/{childId}.balance` document). The legacy `users.walletBalance` field is explicitly **not** used — `ChildSummaryCard` receives `walletBalance` from `ChildrenOverview`, which reads the canonical doc and passes `null` when the doc is absent. A test verifies a child with `walletBalance: 999.99` (legacy) but canonical `balance: 2720` shows £27.20, never £999.99.
- **Points:** `child.rewardPoints`.
- **Level:** `Math.floor((child.lifetimeXP || 0) / 1000) + 1`.
- **Streak:** `child.currentStreak`.
- **Activity feed:** `feed` collection entries (`type`, `text`, `actorName`, `timestamp`), sorted by `timestamp.toMillis()`, sliced to 8.
- **Approvals:** existing `ApprovalCenter` selectors (task completions, transfer/money/petbox requests).

## 5. Owner / Parent Role Handling

`Dashboard.tsx` now routes to the parent dashboard via `isParentRole(currentUser.role)` (from `src/lib/roles.ts`), which returns true for `owner`, `parent`, and the legacy `admin` role — replacing the previous strict `role === 'parent' || role === 'owner'` check. Children keep the child dashboard. A test confirms the legacy `admin` role is treated as a parent.

## 6. Loading / Empty / Error States

- **Loading:** `ParentDashboard` keeps the existing bootstrap loading guard. `ChildrenOverview` shows an `animate-pulse` skeleton per child while `bootstrapStatus.wallets === 'loading'`, so no false £0.00 is ever shown. `ChildSummaryCard` renders "Unavailable" (not £0.00) when the canonical wallet doc is missing.
- **Empty:** Approvals show "You're all caught up! / There are no pending approvals."; activity shows "No family activity yet."; children overview returns `null` when there are no children.
- **Error:** `ParentDashboard` logs the technical error to `console.error` and renders a friendly message ("We couldn't load your dashboard. Please try again.") instead of a broken UI.

## 7. Tests

- **31 new/updated dashboard tests** across `ParentDashboard.test.tsx`, `Dashboard.test.tsx`, and the six `dashboard/*.test.tsx` files cover: greeting, quick-action routing, approval rendering/empty, canonical balance + legacy-ignore + View Profile route, loading skeleton (no false £0), feed render/empty, modal openers, loading/error states, and owner/parent/admin role routing.
- **Full suite:** `npm test` → **304 passed, 0 failed** (43 test files).
- The 14 spec test requirements are satisfied (greeting, quick actions, pending approvals, children overview with canonical balance, recent activity, owner+parent visibility, loading/empty/error states, accessibility basics, no duplicate forms, reuse of modals/routes).

## 8. Build

`npm run build` (`tsc -b && vite build`) succeeds. One unused import (`Link`) was removed from `ParentDashboard.tsx` to clear the TS strict-error. The remaining build output notes (INEFFECTIVE_DYNAMIC_IMPORT for `api.ts`, >500 kB chunk) are pre-existing and non-blocking.

## 9. Deployment

`firebase deploy --only hosting --project familyquest-beta-402cb` completed successfully.
- Hosting URL: https://familyquest-beta-402cb.web.app
- 14 files uploaded; version finalized and released.

## 10. Deferred / Improvements

- **Code-splitting:** The main JS chunk is ~1.06 MB (301 kB gzip). A future task could lazy-load route pages to reduce initial bundle size (the `api.ts` dynamic-import warning should also be resolved by making `Onboarding.tsx` use a static import or isolating the dynamically imported surface).
- **Accessibility polish:** Headings use semantic `<h1>`/`<h2>` and quick actions have `aria-label`s; a follow-up could add a visible focus-order audit and ensure the activity feed icons have associated text (currently text is always present, so icons are not the sole label).
- **Pending-task count:** Computed client-side from tasks/completions; if a server-side count becomes available it should replace the derived value.
- **Family-name badge:** Shown only when `familyData.name` exists; no change to family settings was made (out of scope).
