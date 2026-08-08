# Gamification V3 — Migration, Rollback & Security

---

## 1. Migration strategy

```
Legacy users ─► Ledger baseline ─► Projection rebuild ─► Verification ─► Delete legacy fields
```

Runner: `scripts/gamification-v3-migrate.ts`, per-family, resumable, dry-run by default.

### Step 1 — Freeze
Deploy Rules that reject client writes to `users.rewardPoints`/`lifetimeXP` **before** migrating. Legacy write paths are already replaced by callables at this point (Phase 3), so the freeze is a no-op for correct clients.

### Step 2 — Baseline
For each member, emit exactly one:

```ts
{
  type: 'MIGRATION_BASELINE',
  idempotencyKey: `migration-baseline:v3:${memberId}`,
  rewardPointsDelta: users.rewardPoints ?? 0,
  xpDelta: max(users.lifetimeXP ?? 0, summary.xpTotal ?? 0),
  weeklyPointsDelta: 0,
  occurredAt: <family creation time>,   // sorts before all real events
  metadata: { legacyRewardPoints, legacyLifetimeXP, legacySummaryXpTotal, chosenXpSource }
}
```

**XP conflict rule:** take the **maximum** of the two counters and record both in metadata. Rationale: XP is monotonic and never spent, so the max is the value the child has already been shown; lowering it would be a visible regression. Every divergence is logged for review.

**Reward points rule:** `users.rewardPoints` wins — it is the balance redemption has actually been debiting.

Historical XP events already in `gamification_events` are migrated in place (schema upcast to V3 with `rewardPointsDelta: 0`) and the baseline is reduced by their sum so totals are not double-counted.

### Step 3 — Rebuild
Run the reducer over the full ledger, write `gamification_state`, compute `ledgerChecksum`.

### Step 4 — Verification (per member, must all pass)
1. `state.rewardPoints === users.rewardPoints` (or divergence explicitly whitelisted).
2. `state.xpTotal >= users.lifetimeXP` and `>= summary.xpTotal`.
3. `state.level === levelForXp(state.xpTotal)`.
4. Delete `gamification_state`, rebuild from ledger, assert **deep equality** ignoring `updatedAt`.
5. No negative balances.

Failure ⇒ that family is quarantined (`rebuildRequired: true`), migration continues for others, alert raised.

### Step 5 — Delete legacy fields
Only after 7 days of green verification for the whole estate: `FieldValue.delete()` on the six `users` fields, then drop the `gamification_summaries` collection.

### Idempotency
- Baseline keyed by `migration-baseline:v3:${memberId}` — a second run fails the `create` and skips.
- Rebuild is a pure recomputation.
- Field deletion is naturally idempotent.
- A `families/{id}/_migrations/gamification-v3` doc records `{ phase, checksum, completedAt }`.

Re-running the whole script on a fully migrated estate must produce **zero writes**. This is asserted by a test.

---

## 2. Rollback strategy

Phase numbers below are the implementation phases defined in [`04-implementation-and-testing.md`](docs/gamification-v3/04-implementation-and-testing.md:5).

| Phase | Rollback |
|---|---|
| 0 (audit lock) | Revert the ESLint rule commit. No runtime impact — Phase 0 is behaviour-neutral. |
| 1–2 (ledger + reducer dark, command handlers) | Delete the new collections and redeploy the previous function bundle. No user impact; nothing reads V3 yet. |
| 3 (client writes switch to callables) | Feature-flag `gamificationV3.writes=false` → clients fall back to legacy transactions. The mirror keeps `users.*` current, so legacy paths remain correct. |
| 4 (single reader) | Flag `gamificationV3.reads=false` → the hook serves the legacy adapter. Instant, no data change. |
| 5 (migration) | Migration is additive: baselines are ledger events and legacy fields are untouched. Roll back by flipping both flags to `false`; the estate continues on `users.*`. Quarantined families are simply skipped. |
| 6 (legacy deletion) | **Point of no return.** Recovery = restore from the pre-delete export in `backups/gamification-v3/` plus ledger replay. |

Safety nets:
- Full export of `users` + `gamification_summaries` before Phase 6 (same mechanism as [`backups/pre-deploy-5dda1f6/`](backups/pre-deploy-5dda1f6)).
- The legacy mirror stays for one full release after Phase 5.
- Every flag is per-family, allowing single-family rollback.

---

## 3. Risk analysis

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Baseline double-counts existing XP events | M | High | Subtract existing event sum; verification step 4 |
| R2 | XP visibly drops for a child | M | High | Max-rule; divergence report reviewed before Phase 6 |
| R3 | Callable latency worsens redeem UX | M | Med | Optimistic UI on `status`, p95 budget 800 ms, load test |
| R4 | Ledger write amplification / cost | L | Med | One event per action; projection updated in the same transaction |
| R5 | Projection drift from ledger | L | Critical | `ledgerChecksum` + nightly rebuild-and-compare job, alert on mismatch |
| R6 | Weekly rollover races across timezones | M | Med | `weekKey` computed server-side from the family timezone; scheduled `WEEK_ROLLOVER` event |
| R7 | Offline clients queue stale writes | M | Med | Callables are online-only; queued mutations rejected with a retry prompt |
| R8 | Rules change locks out a legitimate path | M | High | Rules unit tests in the emulator before deploy |
| R9 | Large families exceed transaction limits on rebuild | L | Med | Chunked rebuild with a staging doc, atomic swap |
| R10 | A screen is missed and still reads legacy | M | High | ESLint boundary rule + golden test opening every screen |

---

## 4. Security (Part 10)

`firestore.rules` changes:

```
match /families/{familyId}/gamification_events/{eventId} {
  allow read: if isFamilyMember(familyId);
  allow create, update, delete: if false;      // Admin SDK only
}

match /families/{familyId}/gamification_state/{memberId} {
  allow read: if isFamilyMember(familyId);
  allow write: if false;                        // Admin SDK only
}

match /users/{userId} {
  allow update: if isSelfOrGuardian(userId)
    && !request.resource.data.diff(resource.data).affectedKeys()
         .hasAny(['rewardPoints','lifetimeXP','currentStreak','longestStreak',
                  'lastActiveDate','lastRedemptionId','lastReversalId']);
}
```

Also: `gamification_summaries` becomes read-only immediately (Phase 1), and rules unit tests assert that a child client attempting to raise their own `rewardPoints` is denied.

Client capability after cutover: **read gamification, call commands, nothing else.**
