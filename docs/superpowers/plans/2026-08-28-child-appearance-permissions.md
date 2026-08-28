# Child Appearance Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a child immediately save a valid composable, starter, or already-owned avatar while keeping display-name changes parent-approved and preserving all existing economic/account security boundaries.

**Architecture:** Split child profile edits into two independent paths. A narrow `updateChildAppearance` API writes only `avatarConfig`/`avatarId` to the authenticated child's effective Firestore profile, while the existing `profile_update_requests` path becomes identity-only for child display-name changes. Firestore Rules enforce self-only targeting, strict AvatarConfigV1 validation, starter-or-owned catalog selection, and a closed changed-key allowlist.

**Tech Stack:** React 19, TypeScript 6, Firebase Auth/Firestore, Firestore Security Rules, Vitest 4, Testing Library, Firebase Rules Unit Testing.

**Spec:** `docs/superpowers/specs/2026-08-28-child-appearance-permissions-design.md`

## Global Constraints

- `displayName` changes remain parent-approved through `profile_update_requests`.
- Child appearance self-service is limited to `avatarConfig` and `avatarId` in this project.
- Never grant a child generic `users/{uid}` update permission.
- Premium purchase remains the existing authoritative point-spending/unlock transaction; equipping an already-owned premium avatar is free.
- Client `ownedAvatarIds` is never authorization; Rules verify the immutable `avatar_unlocks/{avatarId}` document.
- AvatarConfig remains a closed `AvatarConfigV1` allowlist: no arbitrary URL, SVG, CSS, uploads, unknown keys, or unknown values.
- Managed-child callers must continue using the existing trusted effective-profile identity boundary.
- Do not change points, XP, wallet, gamification, reward, or family-membership semantics.
- Do not deploy as part of this implementation plan.

---

## File Structure

- Modify `src/lib/api.ts` — add the narrow child appearance writer; make child profile-update submission identity-only and resolve managed-child effective IDs correctly.
- Modify `src/components/profile/ProfileEditorModal.tsx` — independently detect/save appearance and display-name changes; keep appearance editable while a name request is pending.
- Modify `src/components/profile/ProfileEditorModal.test.tsx` — UI regression coverage for immediate avatar persistence, identity approval, combined saves, pending-name behavior, and failure states.
- Modify `firestore.rules` — add strict AvatarConfigV1 validation and self-only child appearance update validation; compose it into the existing users update allow without broadening other writes.
- Create `tests/firestore/childAppearance.rules.test.ts` — focused allow/deny coverage for normal and managed children, ownership, schema, cross-user access, and mixed-field attacks.
- Optionally modify an existing focused API test file if one already covers `src/lib/api.ts`; otherwise create `src/lib/childAppearance.test.ts` to unit-test effective actor resolution and write payload shape without duplicating modal tests.

---

### Task 1: Lock the Firestore Security Contract with RED Rules Tests

**Files:**
- Create: `tests/firestore/childAppearance.rules.test.ts`
- Read: `firestore.rules`
- Read: `src/config/avatarConfig.ts`
- Read: `src/config/avatarCatalog.ts`

**Interfaces:**
- Consumes: existing user documents, managed-child custom claims, and immutable `families/{familyId}/users/{userId}/avatar_unlocks/{avatarId}` records.
- Produces: executable security expectations for the child appearance update rule.

- [ ] **Step 1: Copy the repository's existing Rules test harness pattern**

Use the same `initializeTestEnvironment`, emulator project setup, `withSecurityRulesDisabled`, authenticated contexts, and teardown conventions already used in `tests/firestore/*.rules.test.ts`. Do not introduce a second Rules harness.

Create fixtures with a family `f1`, normal child `c1`, sibling `c2`, parent `p1`, and managed child profile `mc1` whose synthetic Auth UID is `auth-mc1` and whose claims include:

```ts
{
  role: 'child',
  managedChild: true,
  childId: 'mc1',
  familyId: 'f1',
}
```

The managed child's `users/mc1` fixture must include:

```ts
{
  uid: 'mc1',
  authUid: 'auth-mc1',
  isManaged: true,
  requiresPasswordChange: false,
  role: 'child',
  familyId: 'f1',
  displayName: 'Managed Child',
  avatarId: 'starter-cat',
  rewardPoints: 1000,
  lifetimeXP: 500,
}
```

- [ ] **Step 2: Add RED allow tests for valid self-service appearance writes**

Add tests using `assertSucceeds(updateDoc(...))` for:

```ts
await updateDoc(doc(childDb, 'users/c1'), {
  avatarConfig: {
    version: 1,
    base: 'round',
    skinTone: 'warm',
    hairStyle: 'curls',
    hairColor: 'brown',
    face: 'happy',
    accessory: 'none',
    outfit: 'hoodie',
    outfitColor: 'purple',
    background: 'sky',
  },
})
```

and:

```ts
await updateDoc(doc(childDb, 'users/c1'), { avatarId: 'starter-robot' })
```

Add the equivalent valid `avatarConfig` update from the managed-child authenticated context against `users/mc1`.

Add an owned-premium fixture at:

```text
families/f1/users/c1/avatar_unlocks/rare-neon
```

with valid immutable unlock data, then assert the child may set:

```ts
{ avatarId: 'rare-neon' }
```

- [ ] **Step 3: Add RED deny tests for every security invariant**

Use `assertFails` for:

```ts
{ avatarId: 'rare-neon' } // without unlock record
{ displayName: 'Hacked' }
{ avatarId: 'starter-robot', rewardPoints: 999999 }
{ avatarConfig: validConfig, lifetimeXP: 999999 }
{ avatarConfig: validConfig, familyId: 'other-family' }
{ avatarConfig: validConfig, role: 'owner' }
{ avatarConfig: validConfig, authUid: 'attacker' }
```

Assert `c1` cannot update `users/c2`.

Add malformed AvatarConfig cases:

```ts
{ ...validConfig, version: 2 }
{ ...validConfig, hairStyle: 'arbitrary-value' }
{ ...validConfig, injectedCss: 'url(https://evil.example)' }
{ version: 1, base: 'round' } // incomplete
```

Also assert an invalid managed-child identity (wrong `authUid`, wrong family claim, or `requiresPasswordChange: true`) cannot update `users/mc1`.

- [ ] **Step 4: Run the focused Rules test and verify RED**

Run:

```bash
firebase emulators:exec --only firestore,auth 'vitest run tests/firestore/childAppearance.rules.test.ts'
```

Expected: the intended ALLOW cases fail with permission denied because no child appearance update rule exists yet; DENY cases should remain denied.

- [ ] **Step 5: Commit the RED test**

```bash
git add tests/firestore/childAppearance.rules.test.ts
git commit -m "test(profile): define child appearance security boundary"
```

---

### Task 2: Implement the Narrow Firestore Child Appearance Rule

**Files:**
- Modify: `firestore.rules`
- Test: `tests/firestore/childAppearance.rules.test.ts`

**Interfaces:**
- Consumes: `authProfileId()`, `isManagedChildCaller()`, `isTrustedManagedChild()`, `familyIsActive()`, `isStarterAvatar()`, `isPremiumAvatar()`, and immutable avatar unlock records.
- Produces: `isValidChildAppearanceUpdate(uid)` (or equivalently named focused validator) used only by the existing `users/{uid}` update allow.

- [ ] **Step 1: Locate the existing `match /users/{uid}` update allow before editing**

Preserve all existing parent/owner, language, lifecycle, wallet/gamification, and managed-child clauses. Add one narrowly-scoped OR branch rather than replacing the whole allow statement.

- [ ] **Step 2: Add a strict Rules mirror of AvatarConfigV1**

Add a helper that accepts either absence/null where appropriate or a map whose keys are exactly:

```text
version, base, skinTone, hairStyle, hairColor, face,
accessory, outfit, outfitColor, background
```

Require:

```text
version == 1
base in ['round', 'soft', 'bold']
skinTone in ['porcelain', 'fair', 'warm', 'tan', 'brown', 'deep']
hairStyle in ['short', 'crop', 'bob', 'waves', 'long', 'curls', 'coils', 'ponytail']
hairColor in ['black', 'brown', 'chestnut', 'blonde', 'copper', 'pink', 'purple', 'blue']
face in ['smile', 'happy', 'bright', 'calm', 'cheeky']
accessory in ['none', 'glasses', 'round-glasses', 'cap', 'beanie', 'headband']
outfit in ['tee', 'hoodie', 'jacket', 'sweater']
outfitColor in ['purple', 'indigo', 'blue', 'teal', 'green', 'coral', 'pink', 'gold']
background in ['lilac', 'sky', 'mint', 'peach', 'sunny', 'berry']
```

Use `keys().hasAll(...)` plus `keys().hasOnly(...)` so injected fields fail closed.

- [ ] **Step 3: Add ownership validation for equipped catalog avatars**

Implement a helper equivalent to:

```text
isStarterAvatar(avatarId)
|| (
  isPremiumAvatar(avatarId)
  && exists(/databases/$(database)/documents/families/$(resource.data.familyId)/users/$(uid)/avatar_unlocks/$(avatarId))
)
```

Do not trust a user-document ownership array or request-provided price.

- [ ] **Step 4: Add the self-only changed-key validator**

The validator must require all of these:

```text
request.auth != null
authProfileId() == uid
resource.data.role == 'child'
request.resource.data.role == 'child'
request.resource.data.familyId == resource.data.familyId
familyIsActive(resource.data.familyId)
(!isManagedChildCaller() || isTrustedManagedChild())
request.resource.data.diff(resource.data).affectedKeys().hasOnly(['avatarConfig', 'avatarId'])
```

Validate the resulting `avatarConfig` whenever it exists and validate the resulting `avatarId` whenever it exists/non-null. Do not permit `displayName`, `avatarUrl`, balances, role, family, auth, or any unrelated field in this branch.

- [ ] **Step 5: Compose the validator into the existing users update allow**

Add only:

```text
|| isValidChildAppearanceUpdate(uid)
```

at the appropriate users-update boundary. Do not loosen any existing validator.

- [ ] **Step 6: Run the focused Rules suite**

```bash
firebase emulators:exec --only firestore,auth 'vitest run tests/firestore/childAppearance.rules.test.ts'
```

Expected: all new tests PASS.

- [ ] **Step 7: Run the broader relevant Rules regressions**

```bash
npm run test:rules
```

Expected: existing approved Rules baseline remains unchanged and the new child appearance cases pass. Any new failure must be investigated before continuing; do not normalize a security regression as a baseline exception.

- [ ] **Step 8: Commit the Rules implementation**

```bash
git add firestore.rules tests/firestore/childAppearance.rules.test.ts
git commit -m "feat(profile): allow secure child appearance updates"
```

---

### Task 3: Add a Narrow `updateChildAppearance` Client API

**Files:**
- Modify: `src/lib/api.ts`
- Create or Modify Test: `src/lib/childAppearance.test.ts` if no existing focused API test is suitable

**Interfaces:**
- Consumes: `getEffectiveActorId()`, `isValidAvatarConfig`, `getAvatarById`, Firestore `updateDoc`, `deleteField`.
- Produces:

```ts
export interface ChildAppearanceUpdate {
  avatarConfig?: AvatarConfigV1 | null;
  avatarId?: string | null;
}

export async function updateChildAppearance(
  familyId: string,
  update: ChildAppearanceUpdate,
): Promise<void>
```

The function determines the effective profile ID itself; callers do not supply a target user ID.

- [ ] **Step 1: Write RED API tests**

Mock Firebase auth/Firestore following existing `src/lib` test conventions. Cover:

```ts
await updateChildAppearance('f1', { avatarConfig: validConfig })
```

Expected write target: `users/{effectiveActorId}` and payload contains only `avatarConfig`.

Cover managed child claims so Auth UID `auth-mc1` resolves target profile `mc1`.

Cover:

```ts
await updateChildAppearance('f1', { avatarId: 'starter-cat', avatarConfig: null })
```

Expected payload uses `deleteField()` for `avatarConfig` and sets only `avatarId` plus that deletion sentinel.

Reject locally before Firestore for:

```ts
updateChildAppearance('', { avatarId: 'starter-cat' })
updateChildAppearance('f1', {})
updateChildAppearance('f1', { avatarConfig: malformedConfig as any })
updateChildAppearance('f1', { avatarId: 'unknown-avatar' })
```

Do not perform client-side premium ownership authorization here; Rules remain authoritative. The modal may still use its loaded unlock list for UX.

- [ ] **Step 2: Run the API test and verify RED**

```bash
npx vitest run src/lib/childAppearance.test.ts
```

Expected: FAIL because `updateChildAppearance` does not exist.

- [ ] **Step 3: Implement the minimal API**

Add the interface and function near the profile APIs in `src/lib/api.ts`.

Required behavior:

```ts
const actorId = await getEffectiveActorId()
if (!familyId.trim()) throw new Error('Family id is required')
if (no avatarConfig key and no avatarId key) throw new Error('No appearance changes to update')
if (avatarConfig is non-null and !isValidAvatarConfig(avatarConfig)) throw new Error('Invalid avatar configuration.')
if (avatarId is non-null/non-empty and catalog entry is missing/inactive) throw new Error('This avatar is no longer available. Please choose another.')
```

Build a fresh payload object containing only keys explicitly present in the input. When `avatarConfig === null`, write `deleteField()` so switching from creator mode to catalog mode removes the stale creator config. Do not write `displayName`, `avatarUrl`, `familyId`, points, XP, or ownership arrays.

Then:

```ts
await updateDoc(doc(db, 'users', actorId), payload)
```

- [ ] **Step 4: Run the API test GREEN**

```bash
npx vitest run src/lib/childAppearance.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the API**

```bash
git add src/lib/api.ts src/lib/childAppearance.test.ts
git commit -m "feat(profile): add child appearance writer"
```

---

### Task 4: Make Child Profile Approval Identity-Only

**Files:**
- Modify: `src/lib/api.ts`
- Modify or Create focused tests around profile request submission/approval
- Preserve: existing notification and approval-center contracts unless the test proves a required shape change

**Interfaces:**
- Consumes: existing `submitProfileUpdateRequest`, `approveProfileUpdateRequest`, profile notifications, and request collection.
- Produces: child profile requests that represent display-name approval only; appearance is no longer applied by approval for newly-created requests.

- [ ] **Step 1: Write RED tests for identity-only request creation**

For a child whose current profile is `displayName: 'Ali'`, call the profile request API for `displayName: 'Ali Updated'` and assert the created request contains the identity audit fields required by current Rules/Approval Center but does not request a new avatar configuration.

The new request must not rely on `requestedAvatarConfig` to persist child appearance.

Also preserve the pending-request duplicate guard for display-name requests.

- [ ] **Step 2: Add backward-compatibility approval test**

Existing pending records created before this change may contain `requestedAvatarId`, `requestedAvatar`, or `requestedAvatarConfig`. Add a test proving `approveProfileUpdateRequest` can still approve a legacy pending request safely so rollout does not strand already-pending approvals.

New requests, however, must be identity-only.

- [ ] **Step 3: Run focused tests RED**

Use the existing profile/API Vitest command for the selected test file(s). Expected failure: new requests still carry the old avatar approval semantics.

- [ ] **Step 4: Refactor submission without deleting legacy approval support**

Keep `approveProfileUpdateRequest` tolerant of old request shapes. Change new child submission semantics so the profile request is created only for an actual display-name change and represents that identity change.

Do not remove fields from Rules or approval parsing if doing so would make legacy pending documents unapprovable. YAGNI applies to new writes, not to migration safety.

- [ ] **Step 5: Run focused profile/API tests GREEN**

Expected: identity-only new request tests PASS and legacy pending approval compatibility remains PASS.

- [ ] **Step 6: Commit the identity split**

```bash
git add src/lib/api.ts <focused-test-files>
git commit -m "refactor(profile): keep child identity changes approval-only"
```

---

### Task 5: Split `ProfileEditorModal` Save into Appearance + Identity Paths

**Files:**
- Modify: `src/components/profile/ProfileEditorModal.tsx`
- Modify: `src/components/profile/ProfileEditorModal.test.tsx`

**Interfaces:**
- Consumes:

```ts
updateChildAppearance(familyId, update)
submitProfileUpdateRequest(...)
unlockAvatar(...)
```

- Produces: immediate child avatar save; parent-approved display name; deterministic combined-save behavior.

- [ ] **Step 1: Replace obsolete child approval tests with RED product-behavior tests**

Update the API mock to include:

```ts
const appearanceMock = vi.hoisted(() => vi.fn(async () => {}))
```

and export it as `updateChildAppearance` from the mocked `../../lib/api` module.

Replace the old expectation:

```text
child creator change is submitted through approval as avatarConfig only
```

with:

```text
child creator change saves immediately and does not submit approval
```

Expected call:

```ts
expect(appearanceMock).toHaveBeenCalledWith(
  'f1',
  expect.objectContaining({
    avatarConfig: expect.objectContaining({ version: 1, hairStyle: 'curls' }),
  }),
)
expect(submitMock).not.toHaveBeenCalled()
```

- [ ] **Step 2: Add RED tests for all save combinations**

Add explicit tests:

1. **avatar only** -> `updateChildAppearance` once; no `submitProfileUpdateRequest`.
2. **display name only** -> `submitProfileUpdateRequest` once; no appearance write.
3. **avatar + display name** -> appearance write succeeds first, then name request is submitted; assert both calls and order.
4. **pending display-name request** -> display-name control/submit portion remains locked, but AvatarCreator/AvatarPicker and appearance save remain usable.
5. **appearance write fails** -> no success close; edited creator state remains visible; identity request is not submitted in the combined case.
6. **appearance succeeds but identity submit fails** -> avatar remains saved; UI reports that the name request failed without claiming the avatar failed.
7. **switch creator -> catalog** -> call includes `avatarConfig: null` so stale creator config is removed.
8. **Cancel** -> no appearance or identity write.

Use an `onClose` mock in persistence tests and assert it fires only after required successful operations.

- [ ] **Step 3: Run modal tests and verify RED**

```bash
npx vitest run src/components/profile/ProfileEditorModal.test.tsx
```

Expected: new child self-service tests FAIL against the current all-approval behavior.

- [ ] **Step 4: Implement explicit dirty-state comparison**

In `ProfileEditorModal.tsx`, derive separately:

```ts
const displayNameChanged = normalizedName !== originalDisplayName
const avatarIdChanged = selectedAvatarId !== originalAvatarId
const avatarConfigChanged = !avatarConfigsEqual(selectedAvatarConfig, originalAvatarConfig)
const appearanceChanged = avatarIdChanged || avatarConfigChanged
```

Use an existing stable equality helper if one exists; otherwise compare normalized AvatarConfigV1 fields explicitly or use deterministic JSON serialization because the schema has a fixed key set. Do not treat unrelated user document changes as editor dirtiness.

- [ ] **Step 5: Implement deterministic child save ordering**

For child role:

```text
1. validate local form state;
2. if appearanceChanged -> await updateChildAppearance(...);
3. if displayNameChanged -> await submitProfileUpdateRequest(...);
4. close only when all requested operations for this click have succeeded;
5. report partial success accurately when step 2 succeeded and step 3 failed.
```

The ordering is deliberate: a failed appearance write prevents creating an identity request during a combined save, while a later name-request failure cannot roll back an already-authorized avatar save.

For parent/owner, preserve the current immediate edit path.

- [ ] **Step 6: Decouple pending identity state from appearance controls**

A pending `profile_update_request` may disable the display-name input and prevent another name submission, but must not disable AvatarCreator, AvatarPicker, or an appearance-only Save action.

Adjust button copy/state so a child changing only appearance sees a normal Save action rather than `Submit for approval`. If both are dirty, copy should communicate that appearance saves now and the name goes for approval without requiring two separate manual actions.

- [ ] **Step 7: Run modal tests GREEN**

```bash
npx vitest run src/components/profile/ProfileEditorModal.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Run AvatarCreator regression tests**

```bash
npx vitest run src/components/profile/AvatarCreator.test.tsx src/components/profile/ProfileEditorModal.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit the UI split**

```bash
git add src/components/profile/ProfileEditorModal.tsx src/components/profile/ProfileEditorModal.test.tsx
git commit -m "fix(profile): persist child avatar changes immediately"
```

---

### Task 6: Prove Reload Persistence and Premium Equip Semantics

**Files:**
- Modify: `src/components/profile/ProfileEditorModal.test.tsx`
- Modify: `tests/firestore/childAppearance.rules.test.ts` only if an uncovered security case is found
- Read: `src/config/avatarCatalog.ts`
- Read: relevant store/profile normalization code used to hydrate `User`

**Interfaces:**
- Consumes: authoritative `users/{childId}.avatarConfig/avatarId`, existing profile hydration, and `resolveAvatarImage` precedence.
- Produces: regression evidence that save survives modal recreation/profile rehydration and owned premium equip does not spend points.

- [ ] **Step 1: Add a modal recreation/rehydration regression**

Test this exact sequence:

```text
render child with original avatar
customize hair to curls
Save
capture the avatarConfig sent to updateChildAppearance
unmount
render a fresh modal with a fresh user object containing that saved avatarConfig
assert creator controls/preview represent curls
```

This test must not rely on component-local state surviving unmount.

- [ ] **Step 2: Add catalog precedence regression**

Render a fresh child profile containing both an old catalog `avatarId` and the saved valid `avatarConfig`; assert the creator/custom avatar is the active resolved presentation. This protects the existing `avatarConfig -> avatarId -> legacy URL` precedence.

- [ ] **Step 3: Add owned-premium equip regression**

With `storeState.avatarUnlocks` containing `rare-neon`, select/equip `rare-neon` and save. Assert:

```ts
expect(appearanceMock).toHaveBeenCalledWith('f1', expect.objectContaining({ avatarId: 'rare-neon' }))
expect(unlockMock).not.toHaveBeenCalled()
```

Purchase tests remain responsible for proving point deduction on first unlock; equip must never re-spend points.

- [ ] **Step 4: Run focused regressions**

```bash
npx vitest run src/components/profile/AvatarCreator.test.tsx src/components/profile/ProfileEditorModal.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit persistence coverage**

```bash
git add src/components/profile/ProfileEditorModal.test.tsx
git commit -m "test(profile): cover child avatar persistence and re-equip"
```

---

### Task 7: Full Verification and Release-Safety Check

**Files:**
- No production changes expected; fix only regressions caused by Tasks 1–6.

**Interfaces:**
- Consumes: completed child appearance implementation.
- Produces: verified candidate commit; no deployment.

- [ ] **Step 1: Run focused frontend tests**

```bash
npx vitest run src/components/profile/AvatarCreator.test.tsx src/components/profile/ProfileEditorModal.test.tsx src/lib/childAppearance.test.ts
```

Expected: PASS.

If Task 3 reused another existing API test rather than creating `src/lib/childAppearance.test.ts`, substitute that exact test path.

- [ ] **Step 2: Run focused Firestore security tests**

```bash
firebase emulators:exec --only firestore,auth 'vitest run tests/firestore/childAppearance.rules.test.ts'
```

Expected: PASS.

- [ ] **Step 3: Run the complete Rules suite**

```bash
npm run test:rules
```

Expected: no new failures relative to the repository's approved baseline.

- [ ] **Step 4: Run static/build gates**

```bash
npm run typecheck
npm run build
npm run lint
git diff --check
```

Expected: PASS, allowing only already-documented pre-existing non-fatal warnings; no new warnings attributable to this change.

- [ ] **Step 5: Run the relevant normalized frontend suite**

```bash
npx vitest run --dir src
```

Expected: no new failures beyond the repository's currently approved pre-existing exception manifest. Do not silently expand that manifest.

- [ ] **Step 6: Review the final diff for forbidden scope**

Confirm the candidate does **not** change:

```text
rewardPoints/lifetimeXP accounting
wallet logic
gamification processors
premium avatar prices
family membership/auth claims
notification behavior except unavoidable existing profile-request semantics
theme/seasonal/mascot/surge systems
```

Confirm dependency manifests are unchanged.

- [ ] **Step 7: Commit any verification-only corrections, then report exact HEAD**

If no correction is needed, do not create an empty commit. Report:

```text
candidate branch
final HEAD SHA
focused frontend result
focused Rules result
full Rules result
typecheck/build/lint/diff-check result
normalized frontend result
known pre-existing exceptions
worktree cleanliness
dependency-manifest status
```

Do **not** deploy.
