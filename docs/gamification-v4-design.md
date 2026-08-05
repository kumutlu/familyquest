# Gamification V4 — Design Specification

> Status: DESIGN ONLY. No production code, no Firestore writes, no deploy, no tests, no wallet access.
> Scope: Rewrite Queki gamification from scratch while preserving historical records via deterministic replay.
> Wallet (balances, transactions, allowances, Pet Box, savings, transfers) is **completely out of scope**.

---

## 0. Guiding Principles

1. **Replay result is authoritative.** Current displayed balances never override replay.
2. **One ledger, one projection, one server writer, one UI read model, zero legacy fallback.**
3. **Dashboard and Profile cannot disagree** — they consume the same read model.
4. **Wallet is immutable during migration.** Any step that writes wallet data aborts.
5. **Deterministic IDs only.** Random ledger IDs are forbidden.

---

## 1. Architecture

```
                         ┌─────────────────────────────────────────┐
                         │            SERVER (single writer)         │
                         │                                           │
   source action         │   entry point (Cloud Function / callable) │
   (task approval,       │        │                                  │
    behaviour, redeem,    │        ▼                                  │
    reversal, daily/      │   build deterministic gamification_event │
    perfect-day, avatar,  │        │                                  │
    manual adjust)        │        ▼                                  │
                         │   write event to gamification_events      │
                         │   (idempotent: id derived from source)    │
                         │        │                                  │
                         │        ▼                                  │
                         │   projection engine folds event into      │
                         │   gamification_state/{memberId}           │
                         └─────────────────────────────────────────┘
                                          │
                                          ▼
                         ┌─────────────────────────────────────────┐
                         │         FIRESTORE                         │
                         │  families/{fid}/gamification_events/{eid} │
                         │  families/{fid}/gamification_state/{mid}  │
                         └─────────────────────────────────────────┘
                                          │
                                          ▼
                         ┌─────────────────────────────────────────┐
                         │   UI read model: resolveGamificationState │
                         │   Dashboard │ Profile │ Children │ Rewards │
                         │   Achievements │ Leaderboard              │
                         └─────────────────────────────────────────┘

   REPLAY TOOL (isolated, no prod writes in dry-run):
   legacy sources → deterministic events → projection → before/replay report
```

**Invariant:** Only the server writer may create events or mutate `gamification_state`. The client never writes `rewardPoints`, `xpTotal`, `level`, `progress`, `streak`, `achievements`, or any gamification state.

---

## 2. Data Model

### 2.1 Authoritative Ledger

Collection: `families/{familyId}/gamification_events/{eventId}`

| Field | Type | Required | Notes |
|---|---|---|---|
| `schemaVersion` | number | yes | V4 constant |
| `eventId` | string | yes | Deterministic (see §2.3) |
| `familyId` | string | yes | Partition key |
| `memberId` | string | yes | Target member |
| `eventType` | enum | yes | One of §2.2 |
| `sourceType` | string | yes | e.g. `task_completion`, `behaviour`, `reward_redemption`, `reversal`, `daily_goal`, `perfect_day`, `avatar`, `manual` |
| `sourceId` | string | yes | Idempotency anchor (e.g. `task-1#2026-01-05`) |
| `effectiveAt` | timestamp | yes | When the effect applies (approval time) |
| `createdAt` | timestamp | yes | When the event was written |
| `rewardPointsDelta` | number | yes | May be negative; never drives state below 0 |
| `xpDelta` | number | yes | Positive except reversals |
| `metadata` | map | yes | `effectSnapshot`, `awardedPoints`, `reason`, `classification`, etc. |
| `estimated` | boolean | yes | true when fallback reward selection used |
| `reversalOfEventId` | string | conditional | Present iff `eventType == *REVERSED/REFUNDED` or a reversal |

No `weeklyPointsDelta`, no duplicate aliases.

### 2.2 Event Types

- `TASK_APPROVED`
- `TASK_REVERSED`
- `BEHAVIOUR_POSITIVE`
- `BEHAVIOUR_NEGATIVE`
- `DAILY_GOAL_AWARDED`
- `PERFECT_DAY_AWARDED`
- `REWARD_REDEEMED`
- `REWARD_REFUNDED`
- `AVATAR_UNLOCKED`
- `MANUAL_ADJUSTMENT`
- `MIGRATION_BASELINE`

### 2.3 Deterministic Event IDs

`eventId = `${familyId}::${memberId}::${eventType}::${sourceId}``
Reversals append `::REV` (or `::REFUND`). `MIGRATION_BASELINE` uses `sourceId = BASELINE`.

This guarantees idempotency: a duplicate source delivery maps to the same document and is a no-op write.

### 2.4 Authoritative Projection

Collection: `families/{familyId}/gamification_state/{memberId}`

| Field | Type | Notes |
|---|---|---|
| `rewardPoints` | number | Spendable; clamped ≥ 0 |
| `xpTotal` | number | Lifetime XP; only reduced by reversals |
| `level` | number | Derived exclusively from `xpTotal` via canonical `levelForXp()` |
| `xpProgressInLevel` | number | XP into current level |
| `xpToNextLevel` | number | Remaining XP for next level |
| `levelProgressPercentage` | number | 0–100 |
| `currentStreak` | number | Computed only by projection |
| `bestStreak` | number | Max streak seen |
| `lastQualifiedDayKey` | string | Last day that counted toward streak |
| `unlockedAchievementIds` | string[] | Projection-derived |
| `unlockedAvatarIds` | string[] | Projection-derived |
| `projectionVersion` | number | Bump on engine change |
| `foldedThroughEventId` | string | Last event folded (monotonic cursor) |
| `updatedAt` | timestamp | Last write |

**Forbidden duplicate aliases:** no `lifetimeXP`, `totalXP`, `pointsTotal`, `longestStreak` (use `bestStreak` only).

---

## 3. Semantics

### 3.1 Reward Points
- Spendable; may increase or decrease.
- State clamps `rewardPoints` to ≥ 0 after applying any delta.

### 3.2 XP
- Lifetime progression.
- Increases on: positive task, positive behaviour, daily/perfect-day, avatar, manual (+), migration baseline.
- **Does not** decrease on redemption or negative behaviour.
- **Only** a reversal of a prior XP event may reduce it (via `reversalOfEventId`).

### 3.3 Level
- Derived exclusively from `xpTotal` by one canonical function `levelForXp(xpTotal) -> {level, xpProgressInLevel, xpToNextLevel, levelProgressPercentage}`.
- No UI formula. No client arithmetic.

### 3.4 Streak
- Calculated only by the projection engine from folded events (`DAILY_GOAL_AWARDED` / `PERFECT_DAY_AWARDED` with `effectiveAt` day keys).
- No `users` document fallback.

### 3.5 Achievements & Avatars
- Projection-derived from `xpTotal`, `level`, `streak`, and `unlockedAvatarIds`.
- No UI unlock calculations.

---

## 4. Single Writer — Server Entry Points

All mutations go through server entry points (Callable Functions / scheduled triggers). The client only invokes them; it never writes state.

| Source action | Server entry point |
|---|---|
| Task approval | `approveTaskCompletion(familyId, memberId, taskId, completionId, effectSnapshot?)` |
| Behaviour | `recordBehaviour(familyId, memberId, kind: positive|negative, points, reason)` |
| Reward redemption | `redeemReward(familyId, memberId, rewardId, cost)` |
| Reversal | `reverseEvent(familyId, memberId, originalEventId)` |
| Daily / perfect-day finalization | `finalizeDailyGoals(familyId, dayKey)` (scheduled) |
| Avatar unlock | `unlockAvatar(familyId, memberId, avatarId)` |
| Manual adjustment | `manualAdjustment(familyId, memberId, rpDelta, xpDelta, reason)` |

Each entry point:
1. Computes the deterministic `eventId`.
2. Writes the event (idempotent — same ID overwrites, no double award).
3. Folds the event into `gamification_state/{memberId}` in the same transaction.
4. Returns the updated state.

---

## 5. Single Reader — `resolveGamificationState(memberId)`

One hook/service consumed by Dashboard, Member Profile, Children Overview, Rewards, Achievements, and Leaderboard.

Rules:
- No direct `users.rewardPoints` reads.
- No `users.lifetimeXP` fallback.
- No local XP arithmetic, no local level arithmetic.
- No task-completion aggregation in UI.
- No separate Dashboard/Profile resolver logic.

If `gamification_state/{memberId}` is absent:
- Render an explicit **"Gamification unavailable"** state.
- Never fabricate values from legacy fields.

```ts
// Pseudocode (design only)
function resolveGamificationState(familyId, memberId): GamificationState | null {
  const doc = read(families/{familyId}/gamification_state/{memberId})
  return doc.exists ? doc.data() : null  // null => explicit unavailable UI
}
```

---

## 6. Historical Replay

### 6.1 Sources (chronological by `effectiveAt`)
1. Approved task completions
2. Behaviour events
3. Daily / perfect-day events
4. Reward redemptions
5. Refunds / reversals
6. Avatar unlocks
7. Manual adjustments

### 6.2 Reward Selection (per task approval)
1. Use `effectSnapshot.awardedPoints` at approval time **if present**.
2. Else use the task's **current** points value.
3. If fallback (2) is used, set `estimated = true`.

### 6.3 Classifications
- `exact` — approval-time snapshot present.
- `estimated` — fell back to current task points (`estimated=true`).
- `malformed` — record missing required fields; **never guess**.
- `ambiguous` — multiple conflicting sources for one `sourceId`; **never guess**.
- `skipped` — explicitly excluded (e.g. wallet-linked, out of family).

Replay must **never guess** for `malformed` or `ambiguous`. Those are reported and excluded from authoritative output.

### 6.4 Algorithm
```
for each family:
  events = []
  for each source in chronological order:
    classify(source)
    if malformed or ambiguous: record + skip
    else: build deterministic event (estimated flag per §6.2)
          events.push(event)
  sort events by (effectiveAt, createdAt, eventId)
  state = {}
  for event in events:
    state[event.memberId] = fold(state[event.memberId], event)
  emit ledger + state + classification report
```

Replay output becomes authoritative. Current displayed balances do not override it.

---

## 7. Wallet Protection Invariant

**Hard automated invariant — gamification Reward Points are NOT wallet money.**

Before migration:
- Hash/snapshot every wallet-related document (wallet balances, wallet transactions, allowances, Pet Box, savings, money transfers) per family/member. Store hashes in an immutable `wallet_snapshots` artifact.

After migration:
- Require **byte-equivalent** wallet data (re-hash, compare to snapshot).
- Migration **must fail** if any wallet path changed.

Any migration step that attempts to read/write/migrate/reconcile wallet data **aborts immediately** with a non-zero exit and a clear error. Gamification code paths must never import wallet modules.

---

## 8. Cutover Strategy (smallest safe)

- **Phase A** — Build V4 engine + replay tooling in isolation (no prod writes).
- **Phase B** — Production dry-run; emit per-family/member before/replay report. **No writes.**
- **Phase C** — Owner approval of replay report.
- **Phase D** — Write V4 ledger + projection. Old app still reads old system.
- **Phase E** — Verify V4 rebuild equality and balances (replay idempotency + projection rebuild).
- **Phase F** — Switch every UI read to `resolveGamificationState` in one controlled release.
- **Phase G** — Switch all writers to V4 entry points.
- **Phase H** — Remove old gamification writers, fallbacks, summaries, V3 shadow code.

**Rule:** Never run old and new authoritative writers simultaneously.

---

## 9. Rollback Plan

- Rollback is per-phase and reversible until Phase G:
  - Phases A–C: no prod impact; discard dry-run artifacts.
  - Phase D: V4 data is additive (new collections); old system untouched → disable V4 reads, delete new collections if needed.
  - Phase E: verification gates prevent advancing if mismatch.
  - Phase F: UI reads gated by a feature flag → flip flag back to old resolver.
  - Phase G: writers gated by flag → flip back to old writer; V4 ledger frozen.
  - Phase H (deletion): only after a soak period; keep a tagged git revert + Firestore export backup.
- Wallet snapshot comparison is the final gate before any destructive step.

---

## 10. Old-Code Deletion List (post-cutover)

- `users.lifetimeXP`
- `users` gamification streak fields
- Client Reward Points writes
- `gamification_summaries` legacy projection
- V3 shadow collections
- Shadow writers
- Compatibility mirrors
- Separate Dashboard/Profile fallback logic
- Legacy migration gates
- Dead repair scripts

**Do not delete anything before cutover verification (Phase E).**

---

## 11. Acceptance Tests (design)

1. Replay same history twice → identical ledger + state (idempotent, deterministic IDs).
2. Delete projection; rebuild from ledger → identical state.
3. Task +20 → RP +20, XP +20.
4. Positive behaviour +20 → RP +20, XP +20.
5. Negative behaviour −5 → RP −5, XP unchanged.
6. Redeem 10 → RP −10, XP unchanged.
7. Reversal cancels exactly one original event (via `reversalOfEventId`).
8. Duplicate source delivery → no duplicate award (same deterministic ID).
9. Dashboard and Profile render identical values (same read model).
10. Wallet before/after hashes are identical.
11. Snapshot-missing task uses current points and `estimated=true`.
12. Cross-family event is rejected (familyId mismatch → write aborts).

---

## 12. Risks

- **Replay divergence** if legacy sources are incomplete → mitigated by `malformed`/`ambiguous` skip + owner review (Phase C).
- **Streak recomputation drift** vs old UI → mitigated by single projection engine, no fallback.
- **Wallet accidental touch** → hard invariant + code-review gate + snapshot diff.
- **Double-writer window** → forbidden by cutover rule; flag-gated switch.
- **Level formula change** → bump `projectionVersion`, re-fold all states.

---

## 13. Unresolved Decisions (max 3)

1. **Daily/perfect-day finalization trigger:** scheduled Cloud Scheduler vs on-read lazy finalization — not yet chosen.
2. **`MIGRATION_BASELINE` reward selection** for members with no approval snapshot and no current task: treat as `skipped` or `estimated=0`?
3. **Leaderboard read model:** direct `gamification_state` collection query vs derived view — pending perf decision.

---

## 14. Recommended Implementation Sequence

1. Define V4 event + state types and deterministic ID helpers (mirror V3 `ids.ts`).
2. Implement `levelForXp()` canonical function + unit tests.
3. Implement projection fold engine (pure function, no IO).
4. Implement server entry points (single writer) with idempotent event writes.
5. Implement `resolveGamificationState` read model + unavailable-state UI.
6. Implement replay tool (dry-run, classification report).
7. Run Phase B–E verification; gate on wallet snapshot equality.
8. Flag-gated UI switch (F), then writer switch (G), then deletion (H).

---

## 15. Estimated Production Files to Replace/Remove

- **Replace (~10–14 files):** gamification event/state types, storage paths, ID helpers, projection engine, server entry points (callables), `resolveGamificationState` hook, Dashboard/Profile/Children/Rewards/Achievements/Leaderboard consumers, Firestore rules for new collections.
- **Remove (~6–10 files):** `gamification_summaries` legacy projection, V3 shadow collections/writers, client RP writes, separate Dashboard/Profile fallback logic, legacy migration gates, dead repair scripts.
- **Add (~3–5 files):** V4 design-aligned engine module, replay tool, wallet-snapshot invariant checker.

*End of specification. Awaiting approval before implementation planning.*
