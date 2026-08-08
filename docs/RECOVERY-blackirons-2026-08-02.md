# Recovery Report — The Blackirons (`uTnrixcB4uvrZ5Xf44NV`)

Date: 2026-08-02 (UTC)
Project: `familyquest-beta-402cb` (production)
Executed with: supported approval flow (`src/lib/api.ts :: approveJoinRequest`, run under the
owner's authenticated session and production Firestore rules) and the supported
`deleteChild` callable (`functions/src/childDeletion.ts`, region `europe-west1`).

No Firestore document, Auth claim, or index was edited manually. No in-place child→parent conversion.
No Phase 3 UX work was started.

Scripts used (all reproducible, read-only unless named otherwise):
- [`scripts/recovery-inspect.cjs`](scripts/recovery-inspect.cjs) — read-only snapshot
- [`scripts/recovery-approve.cjs`](scripts/recovery-approve.cjs) — step 1
- [`scripts/recovery-delete-child.cjs`](scripts/recovery-delete-child.cjs) — step 3

---

## BEFORE

Family doc `families/uTnrixcB4uvrZ5Xf44NV`
- name: `The Blackirons`, inviteCode `FP6ZD5`, ownerId `KRcaSOIJkydUn6vqcxNXX4d2q232`

Members (`users` where `familyId == uTnrixcB4uvrZ5Xf44NV`)

| uid | role | isManaged | displayName |
|---|---|---|---|
| KRcaSOIJkydUn6vqcxNXX4d2q232 | owner | false | mehmet ali Karademir |
| TZYbQ7sL6qnak9A69A0z | child | true | Gulhan |
| nfeRa675XkdqoReRmU4c | child | true | Omar Serdar |

Pending join request `families/.../join_requests/WBJwXtdOI2XSnxJD1bhi7b6u1792`
- `uid: WBJwXtdOI2XSnxJD1bhi7b6u1792`, `displayName: "Gülhan Naile"`, `status: pending`
- no `intendedRole` field (so the reviewer-supplied role applies)

`users/WBJwXtdOI2XSnxJD1bhi7b6u1792` — existed with `role: parent` but **no `familyId`** (orphan, not in family).
Auth: `gulhannailekarademir@gmail.com`, provider `google.com`, enabled, no custom claims.

Incorrect managed child `users/TZYbQ7sL6qnak9A69A0z`
- `role: child`, `isManaged: true`, `displayName: Gulhan`, `username: Gulhan`,
  `hasLogin: true`, `loginEnabled: true`, `authUid: Rs2cTA9OL4PYvFaPQBbWDp1VzI33`,
  `joinRequestId: 3bb4e60c50f233b50a7752d6109a359e`
- `families/.../childLogins/TZYbQ7sL6qnak9A69A0z` (synthetic email `child-utnrixcb4uvrz5xf44nv-gulhan@managed.familyquest.app`)
- `families/.../childLoginIndex/gulhan`
- `families/.../wallets/TZYbQ7sL6qnak9A69A0z` — **balance 0**
- `families/.../childLoginAudit/FAr2iFHMksOcH8v6fP4m` (`child_join_approved`)

Pre-deletion reference sweep (whole family): tasks 7 / rewards 0 / goals 0 / feed 7 /
transactions 0 / notifications 0 / approvals 0 / taskCompletions 0 / behaviourEvents 0 /
profile_update_requests 0 / moneyRequests 0 — **0 references to `TZYbQ7sL6qnak9A69A0z`**.
Only the (zero-balance) wallet projection referenced the child.

---

## ACTIONS

1. **Approval** — signed in as owner `KRcaSOIJkydUn6vqcxNXX4d2q232`, ran the supported
   approval transaction with role `parent`. The script hard-aborts if the effective role
   would be anything other than `parent`; `owner` is never grantable by this flow.
2. **Verification** — confirmed the Google account is a `parent` member and `families/...ownerId`
   is unchanged (still the original owner).
3. **Deletion** — called `deleteChild` as owner with
   `{ childId: TZYbQ7sL6qnak9A69A0z, displayNameConfirmation: "Gulhan", clientReqId: "recovery-TZYbQ7sL6qnak9A69A0z-1" }`.
   Result: `{"childId":"TZYbQ7sL6qnak9A69A0z","deleted":true}`.

---

## AFTER

Members

| uid | role | isManaged | displayName |
|---|---|---|---|
| KRcaSOIJkydUn6vqcxNXX4d2q232 | owner | false | mehmet ali Karademir |
| WBJwXtdOI2XSnxJD1bhi7b6u1792 | **parent** | false | Gülhan Naile |
| nfeRa675XkdqoReRmU4c | child | true | Omar Serdar |

Join request `.../join_requests/WBJwXtdOI2XSnxJD1bhi7b6u1792`
- `status: approved`, `assignedRole: parent`,
  `reviewedBy: KRcaSOIJkydUn6vqcxNXX4d2q232`, `reviewedByName: "mehmet ali Karademir"`,
  `reviewedAt: 2026-08-02T13:25:34Z`

`users/WBJwXtdOI2XSnxJD1bhi7b6u1792` — now `familyId: uTnrixcB4uvrZ5Xf44NV`, `role: parent`,
`joinRequestId: WBJwXtdOI2XSnxJD1bhi7b6u1792`. Google Auth account untouched. **Never owner**;
`families/.../ownerId` still `KRcaSOIJkydUn6vqcxNXX4d2q232`.

Feed entry added by the approval flow: `families/.../feed/join_WBJwXtdOI2XSnxJD1bhi7b6u1792`
("Gülhan Naile has joined the family as a parent!") — feed count 7 → 8.

Deleted records (exact):
- `users/TZYbQ7sL6qnak9A69A0z` — gone
- Auth `Rs2cTA9OL4PYvFaPQBbWDp1VzI33` (synthetic managed-child account) — gone (`auth/user-not-found`)
- `families/.../childLogins/TZYbQ7sL6qnak9A69A0z` — gone (only `nfeRa675XkdqoReRmU4c` remains)
- `families/.../childLoginIndex/gulhan` — gone (only `omar` remains)
- `families/.../childLoginAudit/FAr2iFHMksOcH8v6fP4m` (`child_join_approved`) — removed by the flow's Phase-4 sweep

Created by the flow:
- `families/.../childLoginIdempotency/recovery-TZYbQ7sL6qnak9A69A0z-1` (`status: completed`, result `{childId, deleted:true}`) — by design

Untouched: Omar Serdar's profile, login, index entry and Auth account; all 7 tasks; family
document, invite code and settings.

---

## Residual issues (NOT modified — require a code fix, not a manual edit)

1. **Orphaned wallet projection**: `families/uTnrixcB4uvrZ5Xf44NV/wallets/TZYbQ7sL6qnak9A69A0z`
   still exists (`balance: 0`). `deleteChild`'s Phase-4 sweep only queries collections for a
   `childId` field, and `wallets` is keyed by uid with no `childId` field and is not in
   `childSpecificCollections` ([`functions/src/childDeletion.ts:319`](functions/src/childDeletion.ts:319)).
   Impact: harmless zero-balance orphan; no UI surface references it (the member no longer exists).

2. **Deletion audit record self-erased**: the transaction writes a `child_deleted` audit doc
   ([`functions/src/childDeletion.ts:369`](functions/src/childDeletion.ts:369)), but Phase 4 then deletes
   every `childLoginAudit` doc whose `childId == childId` — including the one just written
   ([`functions/src/childDeletion.ts:409`](functions/src/childDeletion.ts:409)). Consequently:
   - Approval audit trail: present (`join_requests` doc carries `reviewedBy` / `reviewedByName` /
     `reviewedAt` / `assignedRole`, plus the family feed entry).
   - Deletion audit trail: the durable evidence is the idempotency receipt
     `childLoginIdempotency/recovery-TZYbQ7sL6qnak9A69A0z-1`; the intended `childLoginAudit`
     `child_deleted` entry is absent because of the above ordering bug.
   Remaining audit docs in the family: `login_created` (Omar) and `child_join_requested`.

Both should be fixed in `childDeletion.ts` (exclude `childLoginAudit` from the sweep and add
`wallets`/uid-keyed projections to the cleanup set) before the next managed-child deletion.
