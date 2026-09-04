# Family Onboarding & Child Management Design

## Goal

Make Queki onboarding extremely short, make `Add child` mean “add a new child to the family,” separate child identity from device binding, and replace the duplicated/broken Family management surfaces with one clear management model.

## Product Principles

1. **Enter Queki fast.** Account creation should lead to a usable family workspace as quickly as possible.
2. **Everything optional is progressive setup.** Avatar choice, allowance, rewards, first task, shared-device setup, and similar preferences must not block entry to the app.
3. **Abandonment must be recoverable.** Closing the app during onboarding must never strand the user in a half-finished wizard or force them to restart completed authoritative steps.
4. **Add Child and Connect Device are different concepts.**
   - Add Child = create a new child identity in the family.
   - Connect Device = attach another personal device to an existing child identity.
   - Shared Family Device = optional post-onboarding family setting.
5. **Server authority stays intact.** A child device must never choose family authority, target child identity, parent recipients, or privilege-bearing fields.

## 1. Parent Onboarding

### 1.1 Minimum required flow

The normal parent path is:

1. Sign up / sign in.
2. Create or confirm the family workspace.
3. Enter Queki Home.

No task, reward, allowance, avatar, PIN, shared-device configuration, theme choice, or first-child setup is required to reach the product.

### 1.2 Defaults

Safe defaults may be used for non-security settings. Examples:

- Family display name: `My Family` when the user has not chosen one.
- Theme: product default.
- Allowance: off.
- Rewards: none.
- Tasks: none.
- Shared Family Device: off.
- Child avatar: starter/default avatar when no explicit avatar is chosen.

Defaults must never infer or fabricate identity/security decisions. A QR join request must never be auto-bound to an existing child merely because a local state or display name happens to match.

### 1.3 Abandonment and resume

Authoritative milestones are checkpointed independently. Reopening the app resumes from durable state rather than replaying earlier work.

If the family workspace already exists, the user goes to Home even if optional onboarding prompts were never completed.

The Home experience may surface contextual setup suggestions such as:

- Add your first child
- Create a first task
- Add a reward

These are suggestions, not route gates.

## 2. Add Child

`+ Add child` is the single primary entry point for adding a new child after onboarding and from the Family screen at any later time.

It offers two paths.

### 2.1 Child has their own device

Flow:

1. Parent chooses `Add child` → `On their own device`.
2. Parent generates a short-lived one-time QR invitation.
3. Child scans QR on their device.
4. Child enters a minimal display name and any other strictly required profile data.
5. Child submits a join request and waits.
6. Parent receives a realtime notification and sees the request in Approval Center.
7. Parent sees: `<name> wants to join your family` and the coarse device label.
8. Parent approves or rejects.
9. On approval, the backend creates the **new child identity/profile** atomically and associates the child device/session with that new identity.
10. Child polling observes approval, exchanges the approved request for a custom token, and signs into the newly created child identity.

There is **no “Choose existing managed child” selector** in this new-child path.

### 2.2 Child has no device

Flow:

1. Parent chooses `Add child` → `Set up without a device`.
2. Parent enters only the minimum required child information.
3. Backend creates a managed child profile using existing lifecycle/security guarantees.
4. Parent returns to Family/Home.

Later, the parent can open that child’s management surface and choose `Connect personal device`.

## 3. Existing Child → Connect Personal Device

This is a separate flow for an already-existing child.

Entry point:

`Family` → child card/avatar → `Manage <Child>` → `Devices` → `Connect personal device`

The target child is established by the authenticated parent’s action and encoded server-side when the QR invitation/session is created.

The child device must not be able to choose or replace the target child identity.

Flow:

1. Parent opens an existing child.
2. Parent chooses `Connect personal device`.
3. Server creates a short-lived one-time device-binding QR scoped to that child.
4. Child scans and confirms only presentation-level information if needed.
5. Parent approves if approval is required by the final implementation.
6. Device signs into the exact existing child identity.

This is the only place where the current “bind device to existing managed child” concept belongs.

## 4. Shared Family Device

Shared Family Device is **not part of onboarding**.

It appears later as an optional Family/Settings feature.

Example path:

`Settings` → `Family` → `Shared Family Device`

A parent authorizes a tablet/browser as a shared family device. Once configured, it presents a family-mode chooser such as:

`Who’s using Queki?`

with the existing child profiles.

A child chooses their profile and enters their own PIN. The resulting session must use that child’s server-authoritative identity. A parent session must never remain underneath a child-only UI facade.

Shared-device setup may later include:

- device name
- revoke access
- child access enable/disable
- child PIN management
- switch profile

It remains outside the first implementation unless required to establish compatible identity boundaries.

## 5. Family Screen Simplification

The Family page has one clear model.

### 5.1 Primary family area

Show:

- Family title
- Child cards/avatars
- `+ Add child`
- `Invite adult`

Remove the standalone top-level `Connect Child Device` action from the primary Family actions because device connection now belongs to an existing child’s management surface.

### 5.2 Child interaction

Tapping a child card/avatar opens the single canonical `Manage <Child>` surface.

Do not route through a child-summary modal followed by a second `Manage child` action.

The black-screen path currently reachable from `Manage child` is a release-blocking regression to eliminate.

### 5.3 Family-level management

Family-wide settings are separate from child management.

Use a single, obviously interactive entry such as `Family Settings`.

It manages family-level concerns only, for example:

- family name
- parents/adults
- invite adult/parent
- shared family devices
- other family-wide settings

Remove duplicated `Manage family` labels/accordion surfaces that currently repeat or hide the same functionality.

Opening a family-management control must place the resulting content in view; no off-screen accordion expansion that appears to do nothing.

## 6. Canonical Manage Child Surface

`Manage <Child>` is the only canonical child-management surface.

It contains the relevant existing child controls, grouped clearly.

### Profile

- display name
- avatar

### Devices & Access

- personal device status
- `Connect personal device`
- later: shared-family-device access / PIN

### Money / Wallet

- existing parent wallet/allowance controls that already belong to child management

### Child Settings

- existing child-specific settings and permissions that are currently scattered elsewhere

### Danger Zone

- `Remove child`

Removal must reuse the existing safe managed-child deletion/lifecycle architecture. No new direct client deletion shortcut is introduced.

Changing name/avatar is part of Manage Child, not the entirety of “Edit Member.”

## 7. QR Join Approval Semantics

There are two explicit request intents and they must not be confused.

### `new_child_join`

Purpose: create a new child in the family.

Parent UI:

- requester display name
- device label
- Approve
- Reject

No existing-child selector.

Approval performs the server-authoritative child creation + device/session association.

### `existing_child_device_bind`

Purpose: connect a new personal device to an existing child.

The target existing child is server-scoped from the parent-created invitation/session.

Approval must not accept a child-supplied target child id.

The backend may preserve common token/session/request primitives, but request intent and lifecycle effects must be explicit and testable.

## 8. Data and Security Invariants

- QR tokens remain opaque, high entropy, short lived, revocable, and server-validated.
- Raw QR tokens are not persisted where hashes are sufficient.
- Request secrets remain high entropy; raw secrets are not stored server-side.
- Parent/owner approval authority remains server-authoritative.
- Unauthenticated child devices cannot choose `familyId`, notification recipients, role, auth UID, target existing child, wallet, points, XP, or privileged routes.
- New-child approval creates exactly one child identity/profile and exactly one required wallet/account structure, using deterministic/idempotent request identity.
- Replay or concurrent approval cannot create duplicate children, wallets, or auth identities.
- Existing-child device binding never creates a new child or overwrites another child’s identity.
- Rejection creates no child identity.
- Display name/device label are presentation metadata until the parent approves a new child.

## 9. Error Handling

- A failed QR listener or authorization error must never render `Pending (0)` / `All caught up` as if loading succeeded.
- A failed new-child approval must leave the request in a recoverable state; no half-created child identity.
- A successfully created child followed by client navigation failure must be recoverable by idempotent resume rather than creating another child.
- Onboarding optional-step failures must not lock the parent out of Home.
- Broken child-management navigation must render a visible recoverable error rather than a blank/black screen.

## 10. Copy and Placeholder Rules

Production placeholders/examples must be generic and unrelated to the developer’s family or test fixtures.

Use neutral examples such as `Alex`, `Sam`, `Jamie`, or instructions without personal names where possible.

Do not expose development/test family names as production placeholder, example, empty-state, or fallback copy.

## 11. Testing Strategy

Implementation is TDD-first.

Required regression coverage includes:

- parent can reach Home without adding a child/task/reward
- abandoning optional onboarding does not restart or block the app
- `Add child → own device` creates a new child only after parent approval
- new-child QR approval UI has no existing-child selector
- repeated/concurrent approval creates exactly one child/wallet/auth identity
- rejection creates none
- `Add child → no device` creates one managed child
- existing child → Connect personal device signs into the exact existing child
- Family page has one child-management path and one family-settings path
- child card opens Manage Child directly
- Manage Child never produces the current black-screen failure
- Manage Child exposes name/avatar and existing safe Remove Child lifecycle
- duplicate Manage Family controls are removed
- family-management expansion/navigation is visible and actionable
- Approval Center and notifications remain realtime without reload
- Chromium + WebKit end-to-end flows for both new-child QR and existing-child device bind

Production physical QA must verify at least one real parent + child-device new-child onboarding flow before the work is declared complete.

## 12. Migration / Existing Families

Existing managed children remain valid.

No mass recreation or identity migration is required for existing children.

Existing device-binding QR data may be preserved for compatible pending requests or explicitly expired according to safe lifecycle rules; the implementation plan must define how pre-release pending `child_qr_join_requests` are classified so no old request accidentally creates a new child.

Existing family, wallet, points, XP, task, reward, and gamification histories must remain unchanged.

## 13. Out of Scope for This Release

- Full Shared Family Device implementation
- new push-notification infrastructure
- broad Family page redesign unrelated to onboarding/management clarity
- changing gamification calculations
- changing wallet/points semantics
- email action URL work
- unrelated onboarding visual redesign beyond removing unnecessary gates

## Acceptance Criteria

The release is complete only when all of the following are true:

1. Parent can create an account/family and reach Home without completing child/task/reward setup.
2. `Add child` supports `own device` and `without device`.
3. Own-device QR approval creates a new child identity; it does not ask the parent to choose an existing child.
4. Existing-child device binding is available only from that child’s management path.
5. Family page no longer contains duplicate/confusing Manage Family surfaces.
6. Tapping a child opens one canonical Manage Child experience.
7. Manage Child contains profile management, relevant child controls, device connection, and safe Remove Child access.
8. Current Manage Child black-screen path is covered by a regression test and fixed.
9. Optional Shared Family Device remains a post-onboarding Settings feature, not an onboarding requirement.
10. Existing family data and gamification history are preserved.
11. Full relevant unit/rules/functions suites and Chromium/WebKit E2E pass with no new regressions.
12. Physical production QA passes before final closure.
