# Child Appearance Permissions — Design

Date: 2026-08-28
Status: Approved design
Target branch: `todo-theme`

## 1. Purpose

Separate child-controlled appearance from parent-controlled identity so children can customize and equip their avatar immediately without weakening FamilyQuest's account, family, or gamification security boundaries.

This also fixes the current user-visible persistence problem where a child customizes an avatar, saves, and then sees the previous avatar again because child profile edits are routed through the parent-approval profile update flow rather than persisted immediately to the child's authoritative user profile.

## 2. Product Rules

### Child-controlled, immediate

A child may change these appearance fields without parent approval:

- `avatarConfig`
- `avatarId`, when the avatar is free/starter or already owned by that child

The design intentionally creates an appearance permission boundary that can later support equipped themes, frames, badges, and cosmetics without granting broad profile-write access.

### Parent-controlled

`displayName` changes remain parent-approved through the existing `profile_update_requests` workflow.

Account identity, family membership, role, authentication/security fields, balances, wallet values, points, XP, and other authoritative fields remain outside the child appearance permission boundary.

### Premium purchases

Buying a premium avatar remains an authoritative point-spending operation. A child may initiate the purchase, but the existing validated unlock transaction determines catalog price, ownership, and point deduction.

Purchase and equip are separate operations:

1. Locked premium avatar -> authoritative unlock transaction.
2. Points deducted exactly once and ownership recorded.
3. Owned avatar -> child may equip or switch away from it freely thereafter.

No point deduction occurs when equipping an already-owned avatar.

## 3. Existing Problem and Root Cause

`ProfileEditorModal` currently treats child profile editing as one parent-approved operation. Child saves call `submitProfileUpdateRequest(...)` instead of writing the selected `avatarConfig` to `users/{childId}` immediately.

The request stores `requestedAvatarConfig`, and `approveProfileUpdateRequest(...)` applies that configuration to the user document only after parent approval. Therefore a child's locally selected custom avatar can disappear when authoritative profile state is re-read before approval.

The rendering resolver itself already supports the desired precedence: a valid `avatarConfig` is rendered ahead of catalog `avatarId` and legacy `avatarUrl`. The persistence/authorization boundary, not the avatar renderer, is the primary problem.

## 4. Architecture

### 4.1 Appearance and identity are independent writes

The profile editor must compute appearance changes separately from identity changes.

For a child save:

- changed appearance -> persist immediately through a dedicated child appearance API/path;
- changed `displayName` -> create a normal parent-approved profile update request;
- both changed -> perform the immediate appearance update and submit only the identity portion for approval;
- neither changed -> no write.

The UI must not imply that an avatar is waiting for parent approval when only `displayName` is pending.

### 4.2 Dedicated appearance writer

Introduce a narrowly scoped client API such as `updateChildAppearance(...)` rather than using a generic user-document updater.

Input contract:

```ts
interface ChildAppearanceUpdate {
  avatarConfig?: AvatarConfigV1 | null;
  avatarId?: string | null;
}
```

The implementation must resolve the effective child profile ID correctly for both normal and managed-child authentication. It must not accept arbitrary user IDs as a way to select another child's profile.

The writer may update only the explicit appearance allowlist.

### 4.3 Firestore Rules boundary

Children do not receive general `users/{uid}` update permission.

A child appearance update is allowed only when all of the following hold:

1. caller is authenticated;
2. managed-child callers pass the repository's existing trusted-managed-child identity checks;
3. target user document is the caller's effective profile document;
4. target remains in the same family and remains a child;
5. changed keys are limited to the approved appearance allowlist;
6. `avatarConfig`, when present, exactly satisfies the closed `AvatarConfigV1` contract;
7. `avatarId`, when present, is either an active starter avatar or a premium avatar for which the child has a valid ownership/unlock record;
8. no authoritative/account field is changed in the same request.

A request attempting to combine an allowed avatar change with a forbidden mutation such as `rewardPoints`, `lifetimeXP`, `familyId`, `role`, `displayName`, `authUid`, or wallet state must be denied as a whole.

The existing strict avatar-config approach remains: no arbitrary URL, SVG, CSS, free-form asset, or unknown configuration key/value is accepted.

### 4.4 Ownership validation

Starter avatars require no ownership record.

Premium avatars require the existing authoritative avatar unlock/ownership record. Client-provided arrays such as `ownedAvatarIds` are presentation hints only and must never constitute authorization in Firestore Rules.

The catalog price and premium classification remain authoritative in the existing catalog/rules model.

### 4.5 Render precedence

Keep the existing presentation resolution order:

1. valid `avatarConfig`;
2. valid catalog `avatarId`;
3. legacy `avatarUrl`;
4. initials/default fallback.

No renderer rewrite is required for this project unless tests expose a separate defect.

## 5. UI Behaviour

The child editor should present appearance as an immediately savable customization, not as an approval request.

When only appearance changed, Save persists the appearance and the modal may close after successful authoritative acknowledgement.

When only `displayName` changed, the existing parent-approval UX remains.

When both changed, the avatar is saved immediately while the UI clearly reports that the name change was submitted for parent approval.

A pending display-name request must not unnecessarily lock avatar customization. Pending identity approval and appearance editing are independent concerns.

Selecting a catalog avatar may clear a composable avatar configuration if that is the explicit selection semantics. Selecting/customizing a composable avatar must persist its `avatarConfig` so reopening the editor or reloading the application reproduces the same avatar.

## 6. Data Flow

### Custom/composable avatar

```text
AvatarCreator
    -> local AvatarConfigV1
    -> Save
    -> updateChildAppearance
    -> Firestore Rules validate self + allowlist + schema
    -> users/{childId}.avatarConfig
    -> existing user listener/store normalization
    -> resolveAvatarImage
    -> same custom avatar renders after modal reopen/reload
```

### Owned catalog avatar

```text
AvatarPicker
    -> owned/free avatarId
    -> updateChildAppearance
    -> Rules validate starter OR authoritative ownership
    -> users/{childId}.avatarId
    -> normal profile listener/render
```

### Display name

```text
Display-name edit
    -> submitProfileUpdateRequest
    -> profile_update_requests
    -> parent approval
    -> approveProfileUpdateRequest
    -> users/{childId}.displayName
```

## 7. Error Handling

Appearance persistence is considered successful only after the Firestore write resolves. The modal must not display a success state or close optimistically before that point.

Permission, validation, network, and ownership errors should map to child-friendly UI messages while preserving diagnostic detail in existing development/test instrumentation where appropriate.

If a combined save contains appearance plus display-name changes and one operation fails, the UI must describe the actual state rather than claim the whole profile was saved. The two operations are intentionally independent because one is immediate self-service and the other is an approval workflow.

The implementation should choose and test deterministic ordering for the combined case so retrying does not create duplicate pending profile requests.

## 8. Security Invariants

This project must preserve all of these invariants:

- child cannot directly change `displayName`;
- child cannot change another user's appearance;
- child cannot change role/family/auth/security fields;
- child cannot change points, XP, wallet, or other authoritative economic fields through the appearance writer;
- child cannot equip a premium avatar without authoritative ownership;
- child cannot forge premium price or ownership;
- child cannot provide arbitrary external avatar content;
- managed-child authentication continues to resolve the Firestore child profile safely;
- parent/owner existing profile-management capabilities remain functional.

## 9. Tests

### UI / integration regression

Add a regression covering the reported bug:

1. managed child opens avatar creator;
2. changes composable avatar configuration;
3. saves;
4. authoritative profile state receives the new `avatarConfig`;
5. modal closes;
6. editor is reopened;
7. the same configuration is loaded;
8. simulated reload/profile rehydration still renders the same custom avatar.

Also test:

- avatar-only child save does not create `profile_update_requests`;
- display-name-only child save does create an approval request;
- combined avatar + display-name save immediately persists avatar and submits only the name for approval;
- pending name request does not block subsequent allowed appearance changes;
- owned premium selection is free to equip after purchase.

### Firestore Rules

Required rule cases include:

- child updates valid `avatarConfig` on self -> ALLOW;
- managed child updates valid `avatarConfig` on effective self profile -> ALLOW;
- child equips starter avatar -> ALLOW;
- child equips owned premium avatar -> ALLOW;
- child equips unowned premium avatar -> DENY;
- child directly changes `displayName` -> DENY;
- child changes avatar plus `rewardPoints` -> DENY;
- child changes avatar plus XP/wallet/role/family/security field -> DENY;
- child changes another child's avatar -> DENY;
- malformed/unknown AvatarConfigV1 data -> DENY.

Existing avatar unlock, profile approval, managed-child, lifecycle, and relevant security suites must remain green.

## 10. Scope

Included:

- fix child avatar persistence behavior;
- separate appearance saves from identity approval;
- child self-service for valid composable/free/owned avatars;
- narrow Firestore Rules permission;
- regression and security tests;
- preserve premium authoritative purchase semantics.

Explicitly deferred to later engagement projects:

- theme inventory/equip implementation;
- frames, badges, auras, mascot cosmetics;
- weekly/seasonal theme engine;
- notification engine;
- mascot state machine;
- surge mechanics;
- retention analytics.

The appearance boundary is intentionally designed so those later cosmetic fields can be added through explicit allowlist extensions rather than broadening child profile permissions.

## 11. Acceptance Criteria

The project is complete when:

1. a child can customize and save an avatar and it remains after modal reopen and full profile reload;
2. free or already-owned avatars can be equipped without parent approval;
3. display-name changes still require parent approval;
4. pending display-name approval does not prevent avatar customization;
5. premium purchase remains authoritative and point-safe;
6. Firestore Rules reject every mutation outside the explicit child appearance boundary;
7. managed-child identity remains secure;
8. relevant frontend and Firestore Rules regression suites pass without changing gamification/accounting semantics.
