# Onboarding Owner Bootstrap Root-Cause Report

## Proven root cause

The production flow split a Firestore operation that the security rules require to be atomic.

The committed `isValidOwnerBootstrap(uid)` rule accepted adding `familyId` and changing the signed-in profile from `parent` to `owner` only when:

```text
users/{uid} previously has no familyId
users/{uid}.role == "parent"
families/{familyId} does not exist before the request
families/{familyId} exists after the same request
```

The UI instead did this:

1. `createFamilyAndParent` created `families/{familyId}` in Step 1.
2. Finish Setup called `createManagedMember`.
3. Only after the managed members did it call `updateUserToOwner`.

Both Finish Setup operations were impossible under the rules:

- Managed-member creation requires `isOwner(familyId)`, but the caller's profile was still `{ role: "parent", familyId: absent }`.
- The later owner update required the family not to exist before that request, but Step 1 had already created it.

The Firestore emulator reproduced both contradictions. Before the fix, the atomic-bootstrap regression failed and the working-tree alternative incorrectly allowed a late bootstrap. After the fix, atomic bootstrap succeeds and late bootstrap is denied.

## Pre-fix execution order

1. `/signup` submits `Signup.handleSignup`.
2. `signUp(email, password, name)` calls Firebase Auth `createUserWithEmailAndPassword`.
3. `signUp` writes `users/{uid}` with `uid`, `role: "parent"`, display/profile fields, counters, and no `familyId`.
4. Firebase Auth's `onAuthStateChanged` callback sets:
   - `authStatus: "authenticated"`
   - `authUser: Firebase Auth User`
   - `currentUser: null`
5. The profile listener and `getDocFromServer(users/{uid})` load the Firestore profile into Zustand:
   - `currentUser.role: "parent"`
   - `currentUser.familyId: undefined`
6. `Signup` navigates to `/`.
7. `AppLayout` evaluates `currentUser && !currentUser.familyId && pathname !== "/onboarding"` as true and replaces the route with `/onboarding`.
8. Family-name Continue calls `Onboarding.handleCreateFamily`.
9. `createFamilyAndParent` creates `families/{familyId}` only.
10. Finish Setup calls `Onboarding.handleFinishSetup`.
11. For the first local member, `createManagedMember` batches:
    - `users/{managedUid}` with `familyId`, `role`, `isManaged: true`, display/profile/counter fields.
    - `families/{familyId}/wallets/{managedUid}` with `balance: 0`, `createdAt`, `migratedFromLegacy: true`.
12. Rules evaluate `isValidManagedMemberCreate -> isOwner(familyId)`.
13. `isOwner` reads the caller's unchanged `users/{uid}` profile. Actual values are `role: "parent"` and `familyId: absent`; expected values are `role: "owner"` and the new family ID. The managed-member batch is denied.
14. `updateUserToOwner` is not reached when at least one member exists. If reached with no members, its separate transaction is denied because `families/{familyId}` already exists.
15. Zustand remains on the old Firestore profile. Navigating or refreshing evaluates the same AppLayout condition and returns to onboarding.

## Post-fix execution order

1. Signup/auth/profile bootstrap remains unchanged.
2. `Onboarding.handleCreateFamily` calls `createFamilyAndParent`.
3. One Firestore transaction:
   - reads `users/{uid}`;
   - verifies the profile exists, has no `familyId`, and has `role: "parent"`;
   - creates `families/{familyId}` with `name`, `inviteCode`, `ownerId: uid`, `createdBy: uid`, and `createdAt`;
   - updates `users/{uid}` with `familyId` and `role: "owner"`.
4. `createFamilyAndParent` reads `users/{uid}` back and returns the authoritative profile.
5. `handleCreateFamily` calls `refreshCurrentUser(uid, { familyId, role: "owner" })`.
6. Zustand merges the committed fields into `currentUser` and calls `loadFamilyData`.
7. The independent Firestore profile listener receives the same committed profile and converges on identical Firestore-backed values.
8. Finish Setup creates managed members. `isOwner(familyId)` now succeeds.
9. Finish Setup navigates to `/`.
10. AppLayout evaluates `!currentUser.familyId` as false, waits for family bootstrap if necessary, and renders the dashboard.
11. On refresh, `getDocFromServer(users/{uid})` returns the persisted `familyId` and `role: "owner"`, so the same guard remains false.

## Every onboarding decision

Repository-wide searches found one route decision that starts onboarding:

| File | Condition | Source | Can be stale? |
|---|---|---|---|
| `src/components/layout/AppLayout.tsx` | `currentUser && !currentUser.familyId && location.pathname !== '/onboarding'` | `currentUser` is Zustand state populated by the `users/{uid}` Firestore listener/server read; `pathname` is React Router state. | Before the fix, yes: Finish Setup never produced an authorized user write, so the value remained absent. After the fix, the transaction is read back and synchronously merged before Finish Setup. Cold refresh uses the server read. |

Related gates do not start onboarding:

| Condition | Outcome |
|---|---|
| `authStatus === "initializing"` | Loading screen |
| `bootstrapError` | Recoverable connection-error screen |
| `authStatus === "unauthenticated" || authUser === null` | `/login` |
| `authUser && currentUser === null` | Profile setup/loading screen |
| `currentUser?.familyId && !appReady` | Dashboard bootstrap loading screen |
| `shouldStartChildOnboarding(...)` | `/child-onboarding`, not `/onboarding` |

No `RequireOnboarding`, `ProtectedRoute`, `RouteGuard`, `onboardingCompleted`, `navigate("/onboarding")`, `replace("/onboarding")`, or `redirect("/onboarding")` implementation exists elsewhere in the repository.

## Firestore field verification

The tested successful transaction produces:

- `users/{uid}`: preserves signup fields and adds `familyId`; changes `role` from `parent` to `owner`.
- `families/{familyId}`: `name`, `inviteCode`, `ownerId`, `createdBy`, `createdAt`.
- `users/{managedUid}`: `uid`, `familyId`, requested `role`, `displayName`, `isManaged: true`, avatar/profile fields, counters, `lastActiveDate`.
- `families/{familyId}/wallets/{managedUid}`: `balance: 0`, `createdAt`, `migratedFromLegacy: true`.

There is no singular `owner` field and no `isActive` field in this onboarding write path. Ownership is represented by `families.ownerId`, `families.createdBy`, and `users/{uid}.role: "owner"`. Managed status is represented by `isManaged: true`.

## Auth/store identity

Firebase Auth User, Firestore profile, and Zustand `currentUser` are intentionally not identical object types:

- Firebase Auth User is the authentication identity and supplies `uid`; it does not carry Firestore `familyId` or application `role`.
- Firestore `users/{uid}` is the authoritative application profile.
- Zustand `authUser` references the Firebase Auth User.
- Zustand `currentUser` mirrors the Firestore profile (with document `id`).

The pre-fix stale object was Zustand `currentUser`, because the authorized Firestore owner-profile mutation never completed. The fix returns the committed Firestore profile, immediately merges its routing fields into `currentUser`, and retains the existing server-backed profile listener as the long-term source of truth.

## Regression evidence

- The API regression was observed red before implementation because the family write lacked owner identity and no atomic user update occurred.
- The rules regression was observed red before implementation: atomic bootstrap was denied and late bootstrap was allowed by an unfinished working-tree rules change.
- Focused tests: 25 passed.
- Owner-bootstrap rules tests: 15 passed.
- Complete non-Firestore suite (excluding the unrelated nested checkout): 1,443 passed.
- Complete Firestore rules suite (excluding the unrelated nested checkout): 436 passed.
- TypeScript typecheck: passed.
- Production build: passed.
