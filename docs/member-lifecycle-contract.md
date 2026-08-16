# Member Lifecycle — Product Contract (as implemented)

> Status: **Pre-production, NOT deployed.** This document describes the
> *actually implemented* behaviour of the server-authoritative member lifecycle
> (`functions/src/memberLifecycle.ts`) and the client UI
> (`src/components/family/FamilySettings.tsx`). It supersedes any earlier
> intended/aspirational wording (e.g. "owner/parent can Archive OR Remove a
> child"). Where this document disagrees with older reports, **this document is
> authoritative.**

## Roles

| Role    | Can be created by            | Login model                                   |
| ------- | ---------------------------- | ---------------------------------------------- |
| owner   | first family member          | self-registered (email/Google)                 |
| parent  | owner approval / invite      | self-registered (email/Google)                 |
| adult   | owner approval / invite      | self-registered (email/Google)                 |
| child   | parent/owner (managed)       | managed-child (synthetic Auth + custom token)  |

`adult` is a **distinct** role in storage, separate from `parent` (see
`src/lib/roles.ts`: `FamilyRole = 'owner' | 'parent' | 'adult' | 'child'`). The
`changeMemberRole` callable moves a member **only** between `adult` and `parent`
(owner-only); it never touches `owner` or `child`. Adults are created via
owner-approved join / invitation (default approval role is now `adult`).

## Lifecycle states (explicit `lifecycle` field on `users/{uid}`)

- `active` (default) — normal participating member.
- `archived` — preserved in the family, history intact, no active participation.
- `removed` — account survives, family membership terminated, history retained.

None of these operations delete gamification events, wallets,
wallet_transactions, task_completions, behaviour_events, redemptions, feed,
notifications, daily_progress, challenge records, rankings, or audit records.

## Authorization matrix (enforced server-side, not in the UI)

| Caller | archive | restore | remove | changeRole | transfer |
| ------ | ------- | ------- | ------ | ---------- | -------- |
| owner  | any non-owner | any non-owner | **parent/adult only (NEVER a child)** | adult↔parent | eligible adult/parent |
| parent | **child only** | **child only** | — (denied) | — (denied) | — (denied) |
| adult  | — | — | — (use Leave Family) | — | — |
| child  | — | — | — | — | — |

## 1. Child Remove — NOT supported (resolved contradiction)

**Actual implemented behaviour:**

- `removeMemberFromFamily` is **owner-only** and now rejects **every** child
  (`role === 'child'`), managed or self-registered, with
  `CHILD_REMOVE_NOT_SUPPORTED`.
- A parent can **never** call `removeMemberFromFamily` (it requires owner
  role), so a parent could never remove a child via this path.
- The client UI never offers "Remove from family" for a child card. Children
  are shown with **Archive** (parent or owner) only.

**Why Remove is forbidden for children:**

Removing a child would detach an account that still carries child-specific
identity, managed-child login state, and full history, leaving an ambiguous
account state. Instead:

- **Parent or owner** may **Archive** / **Restore** a child (history preserved,
  still in family).
- **Permanent** removal of a managed child is a separate, explicit **Danger
  Zone** operation (`deleteChild` in `functions/src/childDeletion.ts`), which
  permanently deletes the managed-child Auth account, profile, login metadata,
  and child-scoped operational documents while retaining audit/idempotency
  evidence.

**Contract:** there is **no** supported path where a child is "removed" into a
surviving-but-detached account state. Any report claiming "Child Leaves Home →
owner/parent can Archive OR Remove" is **incorrect** and has been corrected to
"Archive (parent or owner) or permanent Danger Zone deletion (owner/parent)".

## 2. Child → Adult promotion — NOT implemented (and currently unsafe)

**Actual implemented behaviour:**

- `changeMemberRole` is **owner-only** and only accepts `adult` ↔ `parent`.
  It rejects any child target with `CANNOT_CHANGE_CHILD`.
- There is **no** `convertChildToAdult` operation. A child cannot be promoted
  to adult by the owner, by a parent, or by the child itself.

**Why it is not safe with the current managed-child Auth architecture (exact blocker):**

The managed-child identity model couples the profile document ID (`childId`)
to a **synthetic** Firebase Auth account via trusted custom claims
(`managedChild`, `childId`). The client bootstrap
(`src/store/useStore.ts`) resolves the profile as follows:

```ts
const managedChildId = claims.managedChild === true && typeof claims.childId === 'string'
  ? claims.childId : null;
const profileId = managedChildId || user.uid;
```

and then **hard-requires** for any managed-child-resolved profile:

```ts
profile.role !== 'child' || profile.isManaged !== true  →  bootstrap fails
```

Consequences:

1. To keep login working after a role change, the `managedChild`/`childId`
   claims must remain (otherwise `profileId = user.uid`, the synthetic Auth
   UID, which is **not** the profile document ID `childId` → profile not
   found). But keeping those claims forces `role === 'child'` in the bootstrap,
   so a converted "adult" would fail to load. **Contradiction.**
2. To make the account a *normal* adult (resolved by `auth.uid`), the profile
   document would have to be re-keyed to `users/{auth.uid}`. That changes the
   profile document ID — violating the requirement **"Same UID is retained"** —
   and would require rewriting/re-keying every historical collection keyed by
   `childId` (wallets, gamification summaries, task completions, behaviour
   events, etc.), violating **"No historical collections are rewritten/deleted."**
3. The managed-child login state (synthetic email, `childLogins` record,
   `childLoginIndex`) cannot be safely retired without breaking login, and
   cannot be converted into a normal email/password adult login without
   exposing the server-only synthetic email or building a new login flow —
   both of which are explicitly out of scope ("DO NOT hack around it").

**Decision:** child→adult is **not implemented**. The supported safe behaviour
for a child who "grows up" is to **Archive** the managed child (preserving all
history) and, if a fully independent account is required, use the Danger Zone
permanent deletion and let the individual self-register as an adult. No
reverse `adult → child` conversion exists either.

## 3. Acceptance scenarios (real, implemented behaviour)

These scenarios describe what the code **actually does today**, not intended
behaviour. Each is covered by the tests listed in §4.

### 3.1 Child Remove is never available
- **Owner UI:** a child card shows **Archive** only (and, for managed children,
  login management). It never shows **Remove from family**.
- **Parent UI:** a child card shows **Archive** only. It never shows Remove,
  Change role, Make owner, or Leave.
- **Server:** `removeMemberFromFamily` targeting any child (managed or
  self-registered) rejects with `CHILD_REMOVE_NOT_SUPPORTED`.
- **Server:** a parent calling `removeMemberFromFamily` for any member rejects
  with `NOT_AUTHORIZED` (remove is owner-only).

### 3.2 Child Archive / Restore (parent or owner)
- Archiving a child sets `lifecycle = archived`; all history (tasks, points,
  wallet, rankings, gamification) is preserved and the child stays in the
  family.
- Restoring returns `lifecycle` to `active`.
- A child can never archive, restore, remove, or change themselves or others.

### 3.3 Owner Remove (parent / adult only)
- An owner removing a parent or adult terminates family membership; the account
  survives and **every** historical collection is retained (a historical-identity
  projection is kept under `families/{familyId}/users/{uid}`).
- Removing self (`CANNOT_REMOVE_SELF`) or another owner (`CANNOT_REMOVE_OWNER`)
  is rejected.

### 3.4 Change role (adult ↔ parent, owner-only)
- An owner may promote adult → parent or demote parent → adult.
- `changeMemberRole` targeting a child rejects with `CANNOT_CHANGE_CHILD`.
- A parent attempting `changeMemberRole` rejects with `NOT_AUTHORIZED`.
- There is **no** `convertChildToAdult` operation; a child cannot be promoted to
  adult by the owner, a parent, or the child itself.

### 3.5 Child → adult is NOT supported (and currently unsafe)
- No operation converts `role: child` → `role: adult`. See §2 for the exact
  managed-child Auth blocker. Archive (history-preserving) is the supported
  safe behaviour; permanent removal is the separate Danger Zone flow.

### 3.6 Permanent managed-child deletion (Danger Zone)
- The only path that removes a child is the explicit, irreversible Danger Zone
  `deleteChild` (owner/parent). It permanently deletes the managed-child Auth
  account, profile, login metadata, and child-scoped operational documents while
  retaining audit/idempotency evidence. It is **not** a "Remove from family"
  detach.

## 4. Tests of record

- `functions/src/memberLifecycle.test.ts` — server-authoritative matrix,
  including `CHILD_REMOVE_NOT_SUPPORTED` for managed and self-registered
  children, and `CANNOT_CHANGE_CHILD` for child→adult.
- `src/components/family/FamilySettings.lifecycle.test.tsx` — UI never offers
  Remove for a child; parent can only archive a child; owner can archive a child
  but not remove one.
- `tests/firestore/familyDeletion.rules.test.ts` — Danger Zone / Leave Family
  rules.
