# Gamification V3 — Current State Inventory (Phase 0)

Status: **Phase 0 artefact. Behaviour-neutral. No runtime code changed to produce it.**

Companion to [`01-architecture.md`](docs/gamification-v3/01-architecture.md:1) ·
[`02-data-model.md`](docs/gamification-v3/02-data-model.md:1) ·
[`03-migration-and-rollback.md`](docs/gamification-v3/03-migration-and-rollback.md:1) ·
[`04-implementation-and-testing.md`](docs/gamification-v3/04-implementation-and-testing.md:1) ·
[`06-phase-0-baseline.md`](docs/gamification-v3/06-phase-0-baseline.md:1)

This document is the **shrink-to-zero baseline** for the V3 refactor. It is exhaustive, not a
sample: the occurrence table at the end is regenerated mechanically from the repository by
[`scripts/gamification-inventory.cjs`](scripts/gamification-inventory.cjs:1) and is verified in CI
via `node scripts/gamification-inventory.cjs --check`.

Scanned scope: every git-tracked file under `src/`, `functions/src/`, `scripts/`, `tests/`, plus
`firestore.rules` and `firestore.indexes.json`.

Terms scanned: `rewardPoints`, `lifetimeXP`, `xpTotal`, `weeklyXP`, `weeklyPoints`,
`currentStreak`, `longestStreak`, `bestStreak`, `level` (narrowed to gamification-shaped
positions), `xpProgressInLevel`, `xpToNextLevel`, `gamification_summaries`,
`gamification_events`, `task_occurrences`, `behaviour_events`, `levelFromXp`,
`levelProgressForXp`, `redeemReward` (reward redemption), `unlockAvatar` (avatar unlock),
`claimChallenge` / `createChallenge` (family challenge), `reversal`, `leaderboard`.

Legend for the **V3 decision** column:

| Decision | Meaning |
|---|---|
| **KEEP** | Survives V3 unchanged in intent; may move layer. |
| **REMOVE** | Deleted outright; the value ceases to exist in this place. |
| **DERIVE** | The value stops being stored/computed here and becomes reducer-derived. |
| **MIGRATE** | Rewritten against the V3 contract (ledger event, callable, or new collection). |
| **TEMPORARY COMPATIBILITY** | Allowed to keep reading legacy shapes for now; must be removed by its target phase. |

---

## 1. Executive summary of the current state

There is **no single writer** and **no single reader**.

- Reward Points are a client-written balance on `users/{id}`, mutated inside client Firestore
  transactions by reward redemption, avatar unlock, family challenge claim, manual awards and
  reversal.
- XP exists **twice**: `users.lifetimeXP` (legacy, client-written) and
  `gamification_summaries.xpTotal` (server projection). A documented "temporary" fallback in
  [`gamificationAdapters.ts`](src/lib/gamificationAdapters.ts:99) chooses between them at read
  time and is load-bearing in the UI.
- The weekly leaderboard is computed **entirely client-side** in
  [`Family.tsx`](src/pages/Family.tsx:59) by scanning task completions and joining tasks for
  `pointsReward`; family XP is a client-side `reduce` over `lifetimeXP`.
- Level and progress formulas exist in **three** places:
  [`level.ts`](src/domain/gamification/level.ts:1) (canonical),
  [`levelFromXp()`](src/lib/gamificationAdapters.ts:183) /
  [`xpProgressInLevel()`](src/lib/gamificationAdapters.ts:190) (duplicates), and inline
  `/ 1000 * 100` progress arithmetic in two components.
- Behaviour point maths is duplicated in [`behaviour.ts`](src/lib/behaviour.ts:60) (client) and
  [`behaviourProcessor.ts`](functions/src/behaviourProcessor.ts:1) (server).

The good news, and the reason V3 is a wiring problem rather than a rewrite: a correct
event-sourced core already exists in [`src/domain/gamification/`](src/domain/gamification/engine.ts:1)
and a correct server writer already exists in
[`functions/src/gamificationRepository.ts`](functions/src/gamificationRepository.ts:1). XP already
flows through them. Reward Points do not.

---

## 2. Summary table — all client-side gamification writes

Every one of these is a client-initiated mutation of an authoritative gamification value.
All become callable commands in Phase 3.

| # | Location | Field(s) written | Trigger | V3 decision | Phase | Risk |
|---|---|---|---|---|---|---|
| W1 | [`redeemReward()`](src/lib/api.ts:1047) | `users.rewardPoints`, `lastRedemptionId` | Child redeems a reward | MIGRATE → `REWARD_REDEEM` | 3 | High |
| W2 | [`unlockAvatar()`](src/lib/api.ts:3089) | `users.rewardPoints` | Child buys an avatar | MIGRATE → `AVATAR_UNLOCK` | 3 | High |
| W3 | [`claimChallenge()`](src/lib/api.ts:985) | `users.rewardPoints`, `users.lifetimeXP` | Parent claims a family challenge | MIGRATE → `CHALLENGE_CLAIM` | 3 | High |
| W4 | [`awardPoints()`](src/lib/api.ts:1088) | `users.rewardPoints`, `users.lifetimeXP` | Manual parent award | MIGRATE → `MANUAL_ADJUSTMENT` | 3 | High |
| W5 | [`completeTask()`](src/lib/api.ts:686) | `users.currentStreak`, `users.longestStreak` (+ RP/XP locals at 655-656) | Task completion / auto-approval | MIGRATE → `TASK_APPROVED` | 3 | High |
| W6 | [`addBehaviourEvent()`](src/lib/api.ts:866) | `users.rewardPoints`, `users.lifetimeXP` snapshot into the behaviour event | Behaviour logged | MIGRATE → `BEHAVIOUR` | 3 | High |
| W7 | [`reversalApi.ts`](src/lib/reversalApi.ts:116) | `users.rewardPoints`, `lastReversalId` | Reversal of a prior action | MIGRATE → `REVERSAL` | 3 | High |
| W8 | [`signUp()`](src/lib/api.ts:108) | RP/XP/streak fields = 0 | Account creation | MIGRATE (initialise) → projection created empty | 3 | Medium |
| W9 | [`approveJoinRequest()`](src/lib/api.ts:361) | RP/XP/streak fields = 0 | Join request approved | MIGRATE (initialise) | 3 | Medium |
| W10 | [`createManagedMember()`](src/lib/api.ts:438) | RP/XP/streak fields = 0 | Managed child created | MIGRATE (initialise) | 3 | Medium |
| W11 | [`googleRedirectAuth.ts`](src/lib/googleRedirectAuth.ts:29) | RP/XP/streak fields = 0 | Google sign-up bootstrap | MIGRATE (initialise) | 3 | Medium |

**Count: 11 client-side gamification write sites** (7 balance mutations + 4 initialisers).

---

## 3. Summary table — all UI-side gamification calculations

Arithmetic performed on gamification values inside pages/components/adapters. All become
reducer-derived in Phase 4.

| # | Location | Calculation | V3 decision | Phase | Risk |
|---|---|---|---|---|---|
| C1 | [`Family.tsx:60-74`](src/pages/Family.tsx:60) | `weeklyXP` accumulated from task completions × `task.pointsReward` | REMOVE → `gamification_state.weeklyPoints` | 4 | High |
| C2 | [`Family.tsx:77`](src/pages/Family.tsx:77) | Leaderboard sort by `weeklyXP` | REMOVE → `leaderboardRank` | 4 | High |
| C3 | [`Family.tsx:79`](src/pages/Family.tsx:79) | Champion selection | REMOVE → `__family.championMemberId` | 4 | Medium |
| C4 | [`Family.tsx:85`](src/pages/Family.tsx:85) | `totalFamilyXP` = reduce over `lifetimeXP` | REMOVE → `__family.totalXP` | 4 | High |
| C5 | [`ChildSummaryCard.tsx:45`](src/components/parent/dashboard/ChildSummaryCard.tsx:45) | `levelProgress = xpProgressInLevel / 1000 * 100` | DERIVE → `state.progress` | 4 | Medium |
| C6 | [`GamificationSummaryCard.tsx:106`](src/components/dashboard/GamificationSummaryCard.tsx:106) | `levelProgress = xpProgressInLevel / 1000 * 100` | DERIVE → `state.progress` | 4 | Medium |
| C7 | [`ChildSummaryCard.tsx:74`](src/components/parent/dashboard/ChildSummaryCard.tsx:74) | `level + 1` for the "to next level" label | DERIVE → reducer supplies `nextLevel` | 4 | Low |
| C8 | [`GamificationSummaryCard.tsx:123`](src/components/dashboard/GamificationSummaryCard.tsx:123) | `level + 1` | DERIVE | 4 | Low |
| C9 | [`adaptGamificationSummary()`](src/lib/gamificationAdapters.ts:59) | `xpTotal % XP_PER_LEVEL`, `XP_PER_LEVEL - progress` | REMOVE → reducer | 4 | High |
| C10 | [`levelFromXp()`](src/lib/gamificationAdapters.ts:183) | Duplicate level formula | REMOVE | 4 | High |
| C11 | [`xpProgressInLevel()`](src/lib/gamificationAdapters.ts:190) | Duplicate progress formula | REMOVE | 4 | High |
| C12 | [`resolveProgression()`](src/lib/gamificationAdapters.ts:116) | Chooses `xpTotal` vs `lifetimeXP`, floors, clamps | REMOVE | 4 | High |
| C13 | [`achievements.ts:32-72`](src/lib/achievements.ts:32) | Badge thresholds over `xpTotal` / `rewardPoints` / `longestStreak` | DERIVE → reducer `badges[]` | 4 | Medium |
| C14 | [`behaviour.ts:61-87`](src/lib/behaviour.ts:60) | Client RP/XP delta maths incl. `Math.max(0, …)` clamp | REMOVE → server owns it | 3 | High |

**Count: 14 UI/client-side gamification calculations.**

---

## 4. Summary table — all direct Firestore gamification reads from the UI layer

| # | Location | Read | V3 decision | Phase | Risk |
|---|---|---|---|---|---|
| R1 | [`bootstrapQueries.ts:280`](src/lib/bootstrapQueries.ts:280) | Query of the whole `gamification_summaries` collection | REMOVE → single reader | 4 | Medium |
| R2 | [`bootstrapQueries.ts:288`](src/lib/bootstrapQueries.ts:288) | Document read of `gamification_summaries/{userId}` | REMOVE → single reader | 4 | Medium |
| R3 | [`Rewards.tsx:45`](src/pages/Rewards.tsx:45) | `currentUser.rewardPoints` affordability check | DERIVE → `useGamification` | 4 | High |
| R4 | [`Rewards.tsx:148`](src/pages/Rewards.tsx:148) | `currentUser.rewardPoints` badge | DERIVE | 4 | Medium |
| R5 | [`Dashboard.tsx:115`](src/pages/Dashboard.tsx:115) | `currentUser.rewardPoints \|\| 0` | DERIVE | 4 | Medium |
| R6 | [`Dashboard.tsx:120`](src/pages/Dashboard.tsx:120) | `currentUser.currentStreak \|\| 0` | DERIVE | 4 | Medium |
| R7 | [`MemberProfile.tsx:95`](src/pages/MemberProfile.tsx:95) | `member.rewardPoints \|\| 0` | DERIVE | 4 | Medium |
| R8 | [`MemberProfile.tsx:136`](src/pages/MemberProfile.tsx:136) | `member.rewardPoints \|\| 0` | DERIVE | 4 | Medium |
| R9 | [`MemberProfile.tsx:221`](src/pages/MemberProfile.tsx:221) | `member.rewardPoints` mixed with projection `xpTotal` for badges | DERIVE | 4 | High |
| R10 | [`ChildSummaryCard.tsx:39`](src/components/parent/dashboard/ChildSummaryCard.tsx:39) | `child.rewardPoints \|\| 0` | DERIVE | 4 | Medium |
| R11 | [`ProfileEditorModal.tsx`](src/components/profile/ProfileEditorModal.tsx:54) | `user?.rewardPoints \|\| 0` for avatar affordability | DERIVE | 4 | High |
| R12 | [`reversalHistory.ts:54`](src/lib/reversalHistory.ts:54) | `member.rewardPoints \|\| 0` snapshot map | MIGRATE | 3 | Medium |
| R13 | [`ReversalHistoryPanel.tsx:38`](src/components/reversals/ReversalHistoryPanel.tsx:38) | `member.rewardPoints \|\| 0` snapshot map | MIGRATE | 3 | Medium |

**Count: 13 direct UI-layer gamification reads** (2 direct Firestore collection/document reads,
11 direct reads of authoritative fields off the user/member record).

---

## 5. Summary table — duplicate fields

| Value | Copy A | Copy B | Authoritative today | V3 resolution |
|---|---|---|---|---|
| Lifetime XP | `users.lifetimeXP` | `gamification_summaries.xpTotal` | Ambiguous — chosen at read time by `resolveProgression` | `gamification_state.xpTotal`; baseline takes the **max** (see [`03 §Step 2`](docs/gamification-v3/03-migration-and-rollback.md:16)) |
| Best streak | `users.longestStreak` | `gamification_summaries.bestStreak` | Ambiguous — `resolveStreaks` prefers the projection | `gamification_state.bestStreak` |
| Current streak | `users.currentStreak` | `gamification_summaries.currentStreak` | Ambiguous | `gamification_state.currentStreak` |
| Level | `summary.level` | `levelFromXp()` in the adapter | Recomputed in two places | Reducer-only |
| Progress in level | `summary.xpProgressInLevel` | `xpProgressInLevel()` + inline `/1000*100` | Recomputed in three places | Reducer-only (`progress`) |
| Reward Points | `users.rewardPoints` | *(none — the projection has no RP today)* | `users.rewardPoints` | `gamification_state.rewardPoints`; `users.rewardPoints` wins at migration |
| Weekly score | `Family.tsx` `weeklyXP` (derived on every render) | *(none stored)* | Recomputed per render, per client | `gamification_state.weeklyPoints` |

**Count: 7 duplicate / ambiguous authoritative-looking values, 6 of which are duplicated fields.**

---

## 6. Summary table — legacy fallbacks

| # | Location | Fallback | V3 decision | Phase | Risk |
|---|---|---|---|---|---|
| L1 | [`resolveProgression()`](src/lib/gamificationAdapters.ts:99) | `TODO(gamification-legacy-fallback)` — falls back from `summary.xpTotal` to `member.lifetimeXP` | REMOVE | 4 | High |
| L2 | [`resolveStreaks()`](src/lib/gamificationAdapters.ts:173) | Falls back to `member.currentStreak` / `member.longestStreak` | REMOVE | 4 | Medium |
| L3 | [`adaptGamificationSummary()`](src/lib/gamificationAdapters.ts:44) | Null-summary zero object masks "no data" as "zero" | REMOVE → explicit `status` | 4 | Medium |
| L4 | [`MemberProfile.tsx:60`](src/pages/MemberProfile.tsx:60) | Documented "always-complete progression" fallback to `lifetimeXP` | REMOVE | 4 | High |
| L5 | [`ChildSummaryCard.tsx:32`](src/components/parent/dashboard/ChildSummaryCard.tsx:32) | Documented legacy guard: summary missing ⇒ render zeros | REMOVE | 4 | Medium |

**Count: 5 legacy XP/streak fallbacks.**

---

## 7. Summary table — independent leaderboard calculations

| # | Location | What it computes independently | V3 decision | Phase |
|---|---|---|---|---|
| LB1 | [`Family.tsx:59-74`](src/pages/Family.tsx:59) `membersWithWeeklyXP` | Per-member weekly score from `task_completions` × `tasks.pointsReward` | REMOVE | 4 |
| LB2 | [`Family.tsx:77`](src/pages/Family.tsx:77) `sortedMembers` | Ranking | REMOVE | 4 |
| LB3 | [`Family.tsx:85`](src/pages/Family.tsx:85) `totalFamilyXP` | Family aggregate from `lifetimeXP` | REMOVE | 4 |

**Count: 3 independent leaderboard calculations, all client-side, all in `Family.tsx`.**

---

## 8. Summary table — server writer paths

| # | Path | Writes | V3 decision | Phase | Risk |
|---|---|---|---|---|---|
| S1 | [`functions/src/gamificationRepository.ts`](functions/src/gamificationRepository.ts:1) | `gamification_events`, `gamification_summaries`, `task_occurrences`, `daily_eligibility`, `gamification_checkpoints` | KEEP → becomes the V3 ledger + projection writer | 1-2 | Medium |
| S2 | [`functions/src/gamificationTriggers.ts`](functions/src/gamificationTriggers.ts:1) | Trigger-driven projection updates | KEEP → projection writer | 1-2 | Medium |
| S3 | [`functions/src/gamificationScheduler.ts`](functions/src/gamificationScheduler.ts:1) | Scheduled rollups / eligibility | KEEP → `DAILY_GOAL`, `PERFECT_DAY`, `WEEK_ROLLOVER` | 2 | Medium |
| S4 | [`functions/src/behaviourProcessor.ts`](functions/src/behaviourProcessor.ts:1) | Behaviour XP, server-authoritative | KEEP → emits `BEHAVIOUR` events | 2 | Medium |
| S5 | [`functions/src/behaviourRepository.ts`](functions/src/behaviourRepository.ts:1) | Behaviour event persistence | KEEP | 2 | Low |
| S6 | [`functions/src/familyDeletion.ts`](functions/src/familyDeletion.ts:51) | Deletes gamification collections on family deletion | KEEP → collection list updated | 6 | Low |
| S7 | [`functions/src/childDeletion.ts`](functions/src/childDeletion.ts:1) | Deletes/retains child gamification data | KEEP → collection list updated | 6 | Low |

**Count: 7 server writer paths.**

---

## 9. Summary table — existing event types

Sourced from [`src/domain/gamification/types.ts`](src/domain/gamification/types.ts:1) and
[`functions/src/gamificationRepository.ts`](functions/src/gamificationRepository.ts:1).

| Existing event / effect | Carries | V3 mapping | Decision |
|---|---|---|---|
| Task approval XP event (`gamification_events`) | `xpDelta` only | `TASK_APPROVED` with `rewardPointsDelta` added | MIGRATE (upcast to `schemaVersion: 3`) |
| Behaviour event (`behaviour_events` + XP effect) | `pointsDelta` | `BEHAVIOUR` | MIGRATE |
| Legacy XP baseline event | Adopted legacy XP | `MIGRATION_BASELINE` | MIGRATE |
| Reversal record (`reversals` / `reversal_events`) | `xpAdjustment`, `xpReversed`, effect snapshots | `REVERSAL` | MIGRATE |
| Reward redemption | *(no event — direct balance write)* | `REWARD_REDEEM` | **NEW** |
| Avatar unlock | *(no event — direct balance write)* | `AVATAR_UNLOCK` | **NEW** |
| Family challenge claim | *(no event — direct balance write)* | `CHALLENGE_CLAIM` | **NEW** |
| Manual award (`awardPoints`) | *(no event — direct balance write)* | `MANUAL_ADJUSTMENT` | **NEW** |
| Daily eligibility / perfect day | Snapshot documents | `DAILY_GOAL`, `PERFECT_DAY` | MIGRATE |
| Weekly rollover | *(none — client clock)* | `WEEK_ROLLOVER` | **NEW** |

**Count: 5 existing event/effect types; 11 V3 event types; 5 of them new.**

---

## 10. Rules and index surface

| Location | Concern | V3 decision | Phase |
|---|---|---|---|
| [`firestore.rules:648-660`](firestore.rules:648) | Client redemption may write `rewardPoints` + `lastRedemptionId` | MIGRATE → deny | 5 |
| [`firestore.rules:685-695`](firestore.rules:685) | Client behaviour write may increment `rewardPoints`/`lifetimeXP` | MIGRATE → deny | 5 |
| [`firestore.rules:706-707`](firestore.rules:706) | Redemption cost consistency check against `rewardPoints` | MIGRATE → deny | 5 |
| [`firestore.rules:978-985`](firestore.rules:978) | Client reversal may write `rewardPoints` | MIGRATE → deny | 5 |
| [`firestore.rules:1031-1033`](firestore.rules:1031) | Join approval seeds RP/XP/streak = 0 | MIGRATE → server-created projection | 5 |
| [`firestore.rules:1609`](firestore.rules:1609) | `rewardPoints`/`lifetimeXP` in the allowed user-field list | MIGRATE → removed | 6 |
| [`firestore.rules:2354-2374`](firestore.rules:2354) | `gamification_events` / `gamification_summaries` / `gamification_checkpoints` server-only | KEEP → extended to `gamification_state` | 1 |
| `firestore.indexes.json` | No gamification indexes today | MIGRATE → ledger indexes added | 1 |

---

## 11. Notes on scope boundaries

- `users.walletBalance`, goals, funds, transfers and money requests are **money**, not
  gamification. They appear in the raw scan only where a `reversal` shares a code path, and are
  marked KEEP.
- `challenges.rewardPoints`, `tasks.pointsReward`, `rewards.cost` and `avatarCatalog` costs are
  **configuration**, not balances. KEEP.
- i18n locale keys mentioning points/XP are labels. KEEP.

---

<!-- BEGIN GENERATED: gamification-inventory -->

_Generated by [`scripts/gamification-inventory.cjs`](scripts/gamification-inventory.cjs:1). Do not edit by hand._

Occurrences: **1879** across **151** files.

### Totals by operation

| Operation | Count |
|---|---|
| test | 1205 |
| read | 333 |
| migrate | 204 |
| calculate | 92 |
| initialise | 36 |
| write | 9 |

### Totals by V3 decision

| Decision | Count |
|---|---|
| MIGRATE | 903 |
| DERIVE | 439 |
| KEEP | 328 |
| REMOVE | 124 |
| TEMPORARY COMPATIBILITY | 85 |

### Totals by risk

| Risk | Count |
|---|---|
| High | 667 |
| Medium | 625 |
| Low | 587 |

### Totals by term

| Term | Count |
|---|---|
| `rewardPoints` | 336 |
| `lifetimeXP` | 241 |
| `xpTotal` | 222 |
| `currentStreak` | 189 |
| `reversal` | 151 |
| `bestStreak` | 136 |
| `level` | 119 |
| `gamification_summaries` | 74 |
| `longestStreak` | 72 |
| `gamification_events` | 69 |
| `behaviour_events` | 56 |
| `xpProgressInLevel` | 55 |
| `xpToNextLevel` | 55 |
| `task_occurrences` | 23 |
| `levelProgressForXp` | 20 |
| `redeemReward` | 17 |
| `claimChallenge` | 11 |
| `unlockAvatar` | 9 |
| `levelFromXp` | 8 |
| `leaderboard` | 6 |
| `weeklyXP` | 6 |
| `createChallenge` | 4 |

### Full occurrence table

#### `firestore.rules` — MIGRATE · Phase 1-5 · risk High

> Rules tighten to deny all client gamification writes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 459 | `behaviour_events` | calculate | families/{f}/behaviour_events | Behaviour intent log | `let eventPath = /databases/$(database)/documents/families/$(familyId)/behaviour_events/$(eventId);` |
| 648 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `&& diff.hasOnly(['rewardPoints', 'lastRedemptionId'])` |
| 650 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `&& tx.data.costPaid == (oldData.get('rewardPoints', 0) - data.get('rewardPoints', 0))` |
| 653 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `&& data.get('rewardPoints', 0) >= 0` |
| 659 | `lifetimeXP` | calculate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// Task approval mutation: DENY client rewardPoints/lifetimeXP writes.` |
| 659 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `// Task approval mutation: DENY client rewardPoints/lifetimeXP writes.` |
| 685 | `behaviour_events` | calculate | families/{f}/behaviour_events | Behaviour intent log | `let event = getAfter(/databases/$(database)/documents/families/$(familyId)/behaviour_events/$(eventId));` |
| 688 | `behaviour_events` | calculate | families/{f}/behaviour_events | Behaviour intent log | `&& !exists(/databases/$(database)/documents/families/$(familyId)/behaviour_events/$(eventId))` |
| 689 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `&& data.get('rewardPoints', 0) == oldData.get('rewardPoints', 0) + event.data.pointsDelta` |
| 692 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `&& data.diff(oldData).affectedKeys().hasOnly(['rewardPoints', 'lifetimeXP', 'lastBehaviourEventId'])` |
| 692 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `&& data.diff(oldData).affectedKeys().hasOnly(['rewardPoints', 'lifetimeXP', 'lastBehaviourEventId'])` |
| 693 | `lifetimeXP` | calculate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `&& data.get('lifetimeXP', 0) == oldData.get('lifetimeXP', 0) + event.data.pointsDelta)` |
| 695 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `&& data.diff(oldData).affectedKeys().hasOnly(['rewardPoints', 'lastBehaviourEventId']))` |
| 706 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `&& oldUser.data.rewardPoints >= data.costPaid` |
| 707 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `&& user.data.rewardPoints == oldUser.data.rewardPoints - data.costPaid` |
| 854 | `behaviour_events` | calculate | families/{f}/behaviour_events | Behaviour intent log | `&& exists(/databases/$(database)/documents/families/$(familyId)/behaviour_events/$(sourceId))` |
| 855 | `behaviour_events` | calculate | families/{f}/behaviour_events | Behaviour intent log | `&& get(/databases/$(database)/documents/families/$(familyId)/behaviour_events/$(sourceId)).data.get('effectSnapshot', null) == snapshot)` |
| 875 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& inverse.schemaVersion == 1 && inverse.entityType == 'reversal'` |
| 906 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `let reversal = getAfter(/databases/$(database)/documents/families/$(familyId)/reversals/$(reversalId));` |
| 907 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `return reversal != null` |
| 910 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& data.sourceKind == reversal.data.sourceKind && data.sourceId == reversal.data.sourceId` |
| 911 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& data.actorId == authProfileId() && data.actorName == reversal.data.actorName` |
| 912 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& data.reason == reversal.data.reason && data.effectSnapshot == reversal.data.inverseEffectSnapshot` |
| 920 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `let reversal = getAfter(/databases/$(database)/documents/families/$(familyId)/reversals/$(reversalId));` |
| 921 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `let original = reversal == null ? {} : reversal.data.originalEffectSnapshot;` |
| 922 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `let inverse = reversal == null ? {} : reversal.data.inverseEffectSnapshot;` |
| 926 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `return reversal != null && reversal.data.actorId == authProfileId()` |
| 936 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `let reversal = getAfter(/databases/$(database)/documents/families/$(familyId)/reversals/$(data.get('reversalId', 'null')));` |
| 937 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `let original = reversal == null ? {} : reversal.data.originalEffectSnapshot;` |
| 938 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `let inverse = reversal == null ? {} : reversal.data.inverseEffectSnapshot;` |
| 941 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `return reversal != null && data.keys().hasOnly(['type', 'familyId', 'sourceKind', 'sourceId', 'reversalId', 'actorId', 'actorName', 'childId', 'amountPence', 'e` |
| 942 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& data.type == 'reversal' && data.familyId == familyId` |
| 943 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& data.sourceKind == reversal.data.sourceKind && data.sourceId == reversal.data.sourceId` |
| 944 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& data.actorId == authProfileId() && data.actorName == reversal.data.actorName` |
| 945 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& data.effectSnapshot == reversal.data.inverseEffectSnapshot && data.createdAt == request.time` |
| 953 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `let reversal = getAfter(/databases/$(database)/documents/families/$(familyId)/reversals/$(reversalId));` |
| 954 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `return reversal != null && reversal.data.actorId == authProfileId()` |
| 955 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& reversal.data.originalEffectSnapshot.get('fundId', '') == fundId` |
| 957 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `&& data.balance == oldData.balance + reversal.data.inverseEffectSnapshot.get('fundDeltaPence', 0)` |
| 963 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `let reversal = getAfter(/databases/$(database)/documents/families/$(familyId)/reversals/$(data.get('reversalId', 'null')));` |
| 964 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `return reversal != null && txId == data.reversalId + '__fund'` |
| 966 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& data.type == 'reversal' && data.familyId == familyId` |
| 967 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& data.fundId == reversal.data.originalEffectSnapshot.get('fundId', '')` |
| 968 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& data.amount == reversal.data.inverseEffectSnapshot.get('fundDeltaPence', 0)` |
| 969 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& data.sourceKind == reversal.data.sourceKind && data.sourceId == reversal.data.sourceId` |
| 970 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& data.actorId == authProfileId() && data.actorName == reversal.data.actorName` |
| 971 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& data.effectSnapshot == reversal.data.inverseEffectSnapshot && data.createdAt == request.time;` |
| 979 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `let reversal = getAfter(/databases/$(database)/documents/families/$(familyId)/reversals/$(reversalId));` |
| 980 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `return reversal != null && reversal.data.actorId == authProfileId()` |
| 981 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& reversal.data.originalEffectSnapshot.get('childId', '') == uid` |
| 982 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& 'pointsDelta' in reversal.data.originalEffectSnapshot` |
| 983 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `&& data.diff(oldData).affectedKeys().hasOnly(['rewardPoints', 'lastReversalId'])` |
| 984 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `&& data.get('rewardPoints', 0) == oldData.get('rewardPoints', 0) + reversal.data.inverseEffectSnapshot.get('pointsDelta', 0)` |
| 984 | `rewardPoints` | calculate | families/{f}/reversals | Spendable Reward Points balance (RP) | `&& data.get('rewardPoints', 0) == oldData.get('rewardPoints', 0) + reversal.data.inverseEffectSnapshot.get('pointsDelta', 0)` |
| 985 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `&& data.get('rewardPoints', 0) >= 0;` |
| 1031 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `&& data.diff(resource.data).affectedKeys().hasOnly(['uid', 'joinRequestId', 'familyId', 'role', 'displayName', 'avatarUrl', 'rewardPoints', 'lifetimeXP', 'curre` |
| 1031 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `&& data.diff(resource.data).affectedKeys().hasOnly(['uid', 'joinRequestId', 'familyId', 'role', 'displayName', 'avatarUrl', 'rewardPoints', 'lifetimeXP', 'curre` |
| 1031 | `longestStreak` | read | users.longestStreak | Legacy best-streak counter on the user doc | `&& data.diff(resource.data).affectedKeys().hasOnly(['uid', 'joinRequestId', 'familyId', 'role', 'displayName', 'avatarUrl', 'rewardPoints', 'lifetimeXP', 'curre` |
| 1031 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `&& data.diff(resource.data).affectedKeys().hasOnly(['uid', 'joinRequestId', 'familyId', 'role', 'displayName', 'avatarUrl', 'rewardPoints', 'lifetimeXP', 'curre` |
| 1032 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `&& data.get('rewardPoints', -1) == 0 && data.get('lifetimeXP', -1) == 0` |
| 1032 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `&& data.get('rewardPoints', -1) == 0 && data.get('lifetimeXP', -1) == 0` |
| 1033 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `&& data.get('currentStreak', -1) == 0 && data.get('longestStreak', -1) == 0 && data.get('lastActiveDate', 'null') == request.time;` |
| 1033 | `longestStreak` | read | users.longestStreak | Legacy best-streak counter on the user doc | `&& data.get('currentStreak', -1) == 0 && data.get('longestStreak', -1) == 0 && data.get('lastActiveDate', 'null') == request.time;` |
| 1609 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `'role', 'familyId', 'rewardPoints', 'lifetimeXP', 'walletBalance', 'balance', 'lastFundTxId',` |
| 1609 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `'role', 'familyId', 'rewardPoints', 'lifetimeXP', 'walletBalance', 'balance', 'lastFundTxId',` |
| 1795 | `behaviour_events` | calculate | families/{f}/behaviour_events | Behaviour intent log | `match /behaviour_events/{eventId} {` |
| 1876 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `allow create: if familyIsActive(familyId) && ((request.resource.data.type == 'reversal' && isValidReversalWalletLedger(familyId, txId)) \|\| (isBehaviourManager(f` |
| 2111 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `allow create: if (request.resource.data.type == 'reversal' && isValidReversalFundLedger(familyId, txId))` |
| 2345 | `lifetimeXP` | calculate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// - All states: client rewardPoints/lifetimeXP writes on task completion are DENIED` |
| 2345 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `// - All states: client rewardPoints/lifetimeXP writes on task completion are DENIED` |
| 2348 | `gamification_events` | calculate | families/{f}/gamification_events | Existing XP event ledger | `// Server-only collections: task_occurrences, gamification_events, daily_eligibility,` |
| 2348 | `task_occurrences` | calculate | families/{f}/gamification_events | Server-side task occurrence dedupe records | `// Server-only collections: task_occurrences, gamification_events, daily_eligibility,` |
| 2349 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `// daily_progress, gamification_summaries, gamification_checkpoints` |
| 2350 | `task_occurrences` | calculate | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `match /task_occurrences/{occurrenceId} {` |
| 2354 | `gamification_events` | calculate | families/{f}/gamification_events | Existing XP event ledger | `match /gamification_events/{eventId} {` |
| 2368 | `gamification_summaries` | calculate | families/{f}/gamification_summaries | Legacy projection collection | `match /gamification_summaries/{summaryId} {` |

#### `functions/src/behaviourProcessor.test.ts` — KEEP · Phase 2 · risk Medium

> Server behaviour writer — emits BEHAVIOUR ledger events

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 33 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `it('awards +20 rewardPoints and +20 xpTotal for a positive behaviour', () => {` |
| 33 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `it('awards +20 rewardPoints and +20 xpTotal for a positive behaviour', () => {` |
| 43 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `it('recalculates canonical level and progress from the projected xpTotal', () => {` |

#### `functions/src/behaviourProcessor.ts` — KEEP · Phase 2 · risk Medium

> Server behaviour writer — emits BEHAVIOUR ledger events

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 2 | `levelProgressForXp` | calculate | in-memory / derived | Canonical level formula | `import { levelProgressForXp, type LevelProgress } from '../../src/domain/gamification/level'` |
| 11 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `* Lifetime XP must never decrease. ˋusers.lifetimeXPˋ remains only as a` |
| 13 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `* authoritative XP balance is ˋgamification_summaries.xpTotalˋ.` |
| 13 | `xpTotal` | read | families/{f}/gamification_summaries | Projection lifetime XP counter (authoritative today) | `* authoritative XP balance is ˋgamification_summaries.xpTotalˋ.` |
| 82 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `assertBalance(input.currentRewardPoints, 'rewardPoints')` |
| 83 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `assertBalance(input.currentXpTotal, 'xpTotal')` |
| 84 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `assertBalance(input.currentLifetimeXP, 'lifetimeXP')` |
| 107 | `levelProgressForXp` | read | in-memory / derived | Canonical level formula | `const progress = levelProgressForXp(nextXpTotal, xpPerLevel)` |

#### `functions/src/behaviourRepository.test.ts` — KEEP · Phase 2 · risk Medium

> Server behaviour writer — emits BEHAVIOUR ledger events

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 46 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `'users/child-1': { familyId: 'family-1', role: 'child', rewardPoints: 350, lifetimeXP: 380 },` |
| 46 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `'users/child-1': { familyId: 'family-1', role: 'child', rewardPoints: 350, lifetimeXP: 380 },` |
| 47 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `'families/family-1/gamification_summaries/child-1': {` |
| 48 | `level` | test | in-memory / derived | Member level | `schemaVersion: 1, familyId: 'family-1', childId: 'child-1', xpTotal: 380, level: 1,` |
| 48 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `schemaVersion: 1, familyId: 'family-1', childId: 'child-1', xpTotal: 380, level: 1,` |
| 49 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `currentStreak: 0, bestStreak: 0, perfectDayCount: 0, lastQualifiedDayKey: null,` |
| 49 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0, bestStreak: 0, perfectDayCount: 0, lastQualifiedDayKey: null,` |
| 53 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `'families/family-1/behaviour_events/behaviour-1': {` |
| 64 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `it('awards +20 rewardPoints and +20 xpTotal exactly once for a positive behaviour', async () => {` |
| 64 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `it('awards +20 rewardPoints and +20 xpTotal exactly once for a positive behaviour', async () => {` |
| 72 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `expect(db.store['users/child-1']).toMatchObject({ rewardPoints: 370, lifetimeXP: 400 })` |
| 72 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(db.store['users/child-1']).toMatchObject({ rewardPoints: 370, lifetimeXP: 400 })` |
| 73 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `expect(db.store['families/family-1/gamification_summaries/child-1']).toMatchObject({ xpTotal: 400, level: 1 })` |
| 73 | `level` | test | families/{f}/gamification_summaries | Member level | `expect(db.store['families/family-1/gamification_summaries/child-1']).toMatchObject({ xpTotal: 400, level: 1 })` |
| 73 | `xpTotal` | test | families/{f}/gamification_summaries | Projection lifetime XP counter (authoritative today) | `expect(db.store['families/family-1/gamification_summaries/child-1']).toMatchObject({ xpTotal: 400, level: 1 })` |
| 74 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect(db.created.filter(path => path.includes('/gamification_events/'))).toHaveLength(1)` |
| 75 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `const event = db.store[db.created.find(path => path.includes('/gamification_events/'))!]` |
| 91 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `expect(db.store['users/child-1']).toMatchObject({ rewardPoints: 370, lifetimeXP: 400 })` |
| 91 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(db.store['users/child-1']).toMatchObject({ rewardPoints: 370, lifetimeXP: 400 })` |
| 92 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `expect(db.store['families/family-1/gamification_summaries/child-1']).toMatchObject({ xpTotal: 400 })` |
| 92 | `xpTotal` | test | families/{f}/gamification_summaries | Projection lifetime XP counter (authoritative today) | `expect(db.store['families/family-1/gamification_summaries/child-1']).toMatchObject({ xpTotal: 400 })` |
| 93 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect(db.created.filter(path => path.includes('/gamification_events/'))).toHaveLength(1)` |
| 98 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `'families/family-1/behaviour_events/behaviour-1': {` |
| 106 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `expect(db.store['users/child-1']).toMatchObject({ rewardPoints: 330, lifetimeXP: 380 })` |
| 106 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(db.store['users/child-1']).toMatchObject({ rewardPoints: 330, lifetimeXP: 380 })` |
| 107 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `expect(db.store['families/family-1/gamification_summaries/child-1']).toMatchObject({ xpTotal: 380 })` |
| 107 | `xpTotal` | test | families/{f}/gamification_summaries | Projection lifetime XP counter (authoritative today) | `expect(db.store['families/family-1/gamification_summaries/child-1']).toMatchObject({ xpTotal: 380 })` |
| 111 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const db = fakeDb(baseStore({ 'users/child-1': { familyId: 'family-2', role: 'child', rewardPoints: 10, lifetimeXP: 0 } }))` |
| 111 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const db = fakeDb(baseStore({ 'users/child-1': { familyId: 'family-2', role: 'child', rewardPoints: 10, lifetimeXP: 0 } }))` |
| 117 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(db.store['users/child-1']).toMatchObject({ rewardPoints: 10 })` |

#### `functions/src/behaviourRepository.ts` — KEEP · Phase 2 · risk Medium

> Server behaviour writer — emits BEHAVIOUR ledger events

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 40 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `* are derived here inside a single transaction. ˋusers.lifetimeXPˋ is written` |
| 41 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `* only as a COMPATIBILITY MIRROR of ˋgamification_summaries.xpTotalˋ and must` |
| 41 | `xpTotal` | read | families/{f}/gamification_summaries | Projection lifetime XP counter (authoritative today) | `* only as a COMPATIBILITY MIRROR of ˋgamification_summaries.xpTotalˋ and must` |
| 49 | `behaviour_events` | read | families/{f}/behaviour_events | Behaviour intent log | `const eventRef = familyRef.collection('behaviour_events').doc(args.behaviourEventId)` |
| 59 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `const summaryRef = familyRef.collection('gamification_summaries').doc(childId)` |
| 70 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `const gamificationEventRef = familyRef.collection('gamification_events').doc(behaviourGamificationEventId(args.behaviourEventId))` |
| 83 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `currentRewardPoints: integer(child.rewardPoints),` |
| 84 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `currentXpTotal: integer(summary?.xpTotal),` |
| 85 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `currentLifetimeXP: integer(child.lifetimeXP),` |
| 92 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: plan.nextRewardPoints,` |
| 93 | `xpTotal` | calculate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `// Compatibility-only mirror; authoritative XP is summary.xpTotal.` |
| 94 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: plan.nextLifetimeXP,` |
| 102 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: plan.nextXpTotal,` |

#### `functions/src/childDeletion.ts` — KEEP · Phase 6 · risk Low

> Lifecycle/cleanup — collection list updated when legacy is dropped

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 357 | `behaviour_events` | read | families/{f}/behaviour_events | Behaviour intent log | `ˋfamilies/${familyId}/behaviour_eventsˋ,` |
| 359 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `ˋfamilies/${familyId}/gamification_summariesˋ,` |

#### `functions/src/childJoinRequest.ts` — KEEP · Phase 6 · risk Low

> Lifecycle/cleanup — collection list updated when legacy is dropped

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 637 | `rewardPoints` | initialise | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 638 | `lifetimeXP` | initialise | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 0,` |
| 639 | `currentStreak` | initialise | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 640 | `longestStreak` | initialise | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 0,` |

#### `functions/src/familyDeletion.integration.test.ts` — KEEP · Phase 6 · risk Low

> Lifecycle/cleanup — collection list updated when legacy is dropped

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 109 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 120,` |
| 110 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 900,` |
| 111 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 4,` |
| 112 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 9,` |
| 127 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 10,` |
| 193 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `'familyId', 'role', 'rewardPoints', 'lifetimeXP', 'currentStreak',` |
| 193 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `'familyId', 'role', 'rewardPoints', 'lifetimeXP', 'currentStreak',` |
| 193 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `'familyId', 'role', 'rewardPoints', 'lifetimeXP', 'currentStreak',` |
| 194 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `'longestStreak', 'lastActiveDate', 'walletBalance', 'lastGoalTxId',` |

#### `functions/src/familyDeletion.ts` — KEEP · Phase 6 · risk Low

> Lifecycle/cleanup — collection list updated when legacy is dropped

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 39 | `behaviour_events` | read | families/{f}/behaviour_events | Behaviour intent log | `'task_completions', 'behaviour_events', 'rewards', 'redemptions', 'wallets',` |
| 51 | `task_occurrences` | read | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `'task_occurrences',` |
| 52 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `'gamification_events', 'daily_eligibility', 'daily_progress',` |
| 53 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `'gamification_summaries', 'gamification_checkpoints',` |
| 66 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `'task_occurrences', 'gamification_events', 'daily_eligibility',` |
| 66 | `task_occurrences` | read | families/{f}/gamification_events | Server-side task occurrence dedupe records | `'task_occurrences', 'gamification_events', 'daily_eligibility',` |
| 85 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `'rewardPoints', 'lifetimeXP', 'currentStreak', 'longestStreak', 'lastActiveDate',` |
| 85 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `'rewardPoints', 'lifetimeXP', 'currentStreak', 'longestStreak', 'lastActiveDate',` |
| 85 | `longestStreak` | read | users.longestStreak | Legacy best-streak counter on the user doc | `'rewardPoints', 'lifetimeXP', 'currentStreak', 'longestStreak', 'lastActiveDate',` |
| 85 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `'rewardPoints', 'lifetimeXP', 'currentStreak', 'longestStreak', 'lastActiveDate',` |

#### `functions/src/familyDeletionWorker.test.ts` — KEEP · Phase 6 · risk Low

> Lifecycle/cleanup — collection list updated when legacy is dropped

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 284 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// Seeded with the REAL profile schema (R2): rewardPoints/lifetimeXP/streaks/` |
| 284 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `// Seeded with the REAL profile schema (R2): rewardPoints/lifetimeXP/streaks/` |
| 289 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `rewardPoints: 120, lifetimeXP: 4200, currentStreak: 3, longestStreak: 9,` |
| 289 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `rewardPoints: 120, lifetimeXP: 4200, currentStreak: 3, longestStreak: 9,` |
| 289 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `rewardPoints: 120, lifetimeXP: 4200, currentStreak: 3, longestStreak: 9,` |
| 289 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 120, lifetimeXP: 4200, currentStreak: 3, longestStreak: 9,` |
| 320 | `task_occurrences` | test | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `db.store.set('task_occurrences/occ1', { familyId: FAMILY_ID });` |
| 321 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `db.store.set('gamification_events/ev1', { familyId: FAMILY_ID });` |
| 325 | `task_occurrences` | test | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `db.store.set('task_occurrences/occ-other', { familyId: 'other-family' });` |
| 359 | `task_occurrences` | test | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `expect(db.store.has('task_occurrences/occ1')).toBe(false);` |
| 360 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect(db.store.has('gamification_events/ev1')).toBe(false);` |
| 398 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `'familyId', 'role', 'rewardPoints', 'lifetimeXP', 'currentStreak', 'longestStreak',` |
| 398 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `'familyId', 'role', 'rewardPoints', 'lifetimeXP', 'currentStreak', 'longestStreak',` |
| 398 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `'familyId', 'role', 'rewardPoints', 'lifetimeXP', 'currentStreak', 'longestStreak',` |
| 398 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `'familyId', 'role', 'rewardPoints', 'lifetimeXP', 'currentStreak', 'longestStreak',` |
| 414 | `task_occurrences` | test | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `expect(db.store.has('task_occurrences/occ-other')).toBe(true);` |

#### `functions/src/gamificationProcessor.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 31 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('passes immutable reversal identity and an injected clock to invalidation processing', async () => {` |

#### `functions/src/gamificationRepository.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 418 | `bestStreak` | initialise | summary.bestStreak | Projection best-streak counter | `schemaVersion: 1, familyId, childId, xpTotal: 0, level: 1, currentStreak: 0, bestStreak: 0,` |
| 418 | `currentStreak` | initialise | users.currentStreak | Consecutive qualifying days | `schemaVersion: 1, familyId, childId, xpTotal: 0, level: 1, currentStreak: 0, bestStreak: 0,` |
| 418 | `level` | initialise | in-memory / derived | Member level | `schemaVersion: 1, familyId, childId, xpTotal: 0, level: 1, currentStreak: 0, bestStreak: 0,` |
| 418 | `xpTotal` | initialise | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `schemaVersion: 1, familyId, childId, xpTotal: 0, level: 1, currentStreak: 0, bestStreak: 0,` |
| 451 | `xpTotal` | calculate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const nextXp = base.xpTotal + xpDelta` |
| 457 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `let currentStreak = base.currentStreak` |
| 460 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `currentStreak = 0` |
| 464 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `currentStreak = base.lastQualifiedDayKey !== null && addFamilyDays(base.lastQualifiedDayKey, 1) === progress.dayKey` |
| 465 | `currentStreak` | calculate | users.currentStreak | Consecutive qualifying days | `? base.currentStreak + 1 : 1` |
| 472 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: nextXp,` |
| 473 | `level` | read | in-memory / derived | Member level | `level: levelForXp(nextXp, 1000),` |
| 474 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `currentStreak,` |
| 475 | `bestStreak` | calculate | summary.bestStreak | Projection best-streak counter | `bestStreak: Math.max(base.bestStreak, currentStreak),` |
| 475 | `currentStreak` | calculate | users.currentStreak | Consecutive qualifying days | `bestStreak: Math.max(base.bestStreak, currentStreak),` |
| 598 | `task_occurrences` | read | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `const occurrenceRef = familyRef.collection('task_occurrences').doc(logicalKey)` |
| 601 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `const summaryRef = familyRef.collection('gamification_summaries').doc(childId)` |
| 645 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `transaction.get(familyRef.collection('gamification_events').doc(taskXpEventId(logicalKey))),` |
| 646 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `transaction.get(familyRef.collection('gamification_events').doc(taskXpReversalEventId(logicalKey))),` |
| 648 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `.map(id => transaction.get(familyRef.collection('gamification_events').doc(id))),` |
| 680 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `const currentPoints = child.rewardPoints ?? 0` |
| 681 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `if (!Number.isSafeInteger(currentPoints) \|\| currentPoints < 0) throw new Error('Child rewardPoints is invalid')` |
| 683 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `if (!Number.isSafeInteger(nextPoints)) throw new Error('Child rewardPoints would exceed the safe integer range')` |
| 702 | `rewardPoints` | write | users.rewardPoints | Spendable Reward Points balance (RP) | `if (nextPoints !== currentPoints) transaction.update(childRef, { rewardPoints: nextPoints, lastTaskCompletionId: args.completionId })` |
| 703 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `for (const document of plan.events) transaction.create(familyRef.collection('gamification_events').doc(document.id), eventToData(document.event))` |
| 738 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `const summaryRef = familyRef.collection('gamification_summaries').doc(effect.childId)` |
| 748 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `transaction.get(familyRef.collection('gamification_events').doc(taskXpEventId(effect.logicalCompletionKey))),` |
| 749 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `transaction.get(familyRef.collection('gamification_events').doc(taskXpReversalEventId(effect.logicalCompletionKey))),` |
| 751 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `.map(id => transaction.get(familyRef.collection('gamification_events').doc(id))),` |
| 782 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `const currentPoints = child.rewardPoints ?? 0` |
| 787 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `if (!Number.isSafeInteger(nextPoints) \|\| nextPoints < 0) throw new Error('Task invalidation would make rewardPoints invalid')` |
| 788 | `rewardPoints` | write | users.rewardPoints | Spendable Reward Points balance (RP) | `transaction.update(childRef, { rewardPoints: nextPoints })` |
| 790 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `for (const document of plan.events) transaction.create(familyRef.collection('gamification_events').doc(document.id), eventToData(document.event))` |
| 833 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `const summaryRef = familyRef.collection('gamification_summaries').doc(childId)` |
| 851 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `.map(id => transaction.get(familyRef.collection('gamification_events').doc(id))))` |
| 866 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `for (const document of events) transaction.create(familyRef.collection('gamification_events').doc(document.id), eventToData(document.event))` |
| 880 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const lifetimeXp = child.data().lifetimeXP` |
| 882 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `const baseline = await familyRef.collection('gamification_events').doc(ˋlegacy_xp_baseline:${encodeURIComponent(familyId)}:${encodeURIComponent(child.id)}ˋ).get` |
| 885 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `const summary = await familyRef.collection('gamification_summaries').doc(child.id).get()` |
| 920 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `const eventQuery = this.rebuildQuery(familyRef.collection('gamification_events'), args.childId, checkpoint.watermarkAt, checkpoint.eventCursor)` |
| 971 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `const summaryRef = familyRef.collection('gamification_summaries').doc(args.childId)` |

#### `functions/src/gamificationTriggers.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 31 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('routes only task-completion reversal documents with their immutable ID', async () => {` |

#### `functions/src/index.ts` — KEEP · Phase 6 · risk Low

> Lifecycle/cleanup — collection list updated when legacy is dropped

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 61 | `behaviour_events` | read | families/{f}/behaviour_events | Behaviour intent log | `'families/{familyId}/behaviour_events/{behaviourEventId}',` |

#### `functions/src/leaveFamily.test.ts` — KEEP · Phase 6 · risk Low

> Lifecycle/cleanup — collection list updated when legacy is dropped

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 125 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `rewardPoints: 30, lifetimeXP: 900, currentStreak: 2, longestStreak: 7,` |
| 125 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `rewardPoints: 30, lifetimeXP: 900, currentStreak: 2, longestStreak: 7,` |
| 125 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `rewardPoints: 30, lifetimeXP: 900, currentStreak: 2, longestStreak: 7,` |
| 125 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 30, lifetimeXP: 900, currentStreak: 2, longestStreak: 7,` |
| 149 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `'rewardPoints', 'lifetimeXP', 'currentStreak', 'longestStreak', 'lastActiveDate',` |
| 149 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `'rewardPoints', 'lifetimeXP', 'currentStreak', 'longestStreak', 'lastActiveDate',` |
| 149 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `'rewardPoints', 'lifetimeXP', 'currentStreak', 'longestStreak', 'lastActiveDate',` |
| 149 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `'rewardPoints', 'lifetimeXP', 'currentStreak', 'longestStreak', 'lastActiveDate',` |

#### `scripts/addModalTests.cjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 18 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `"    renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: '', avatarId: null, rewardPoints: 500, familyId: 'f1' })",` |
| 32 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `"    renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: '', avatarId: 'starter-cat', rewardPoints: 500, familyId: 'f1' })",` |
| 45 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `"    renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: '', avatarId: 'starter-cat', rewardPoints: 500, familyId: 'f1' })",` |

#### `scripts/audit-gamification-projection.cjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Read-only operational forensics against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 6 | `gamification_summaries` | migrate | families/{f}/gamification_summaries | Legacy projection collection | `* summary at families/{familyId}/gamification_summaries/{memberId}, and compares` |
| 7 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `* legacy Σ users.lifetimeXP against authoritative Σ summaries.xpTotal for every` |
| 7 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `* legacy Σ users.lifetimeXP against authoritative Σ summaries.xpTotal for every` |
| 27 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `Number.isFinite(Number(s.xpTotal)) &&` |
| 49 | `gamification_summaries` | migrate | families/{f}/gamification_summaries | Legacy projection collection | `const summaries = await db.collection(ˋfamilies/${familyId}/gamification_summariesˋ).get();` |
| 57 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `legacySum += Number(child.data().lifetimeXP \|\| 0);` |
| 68 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `report.malformedSummaries.push({ familyId, memberId: child.id, xpTotal: s.xpTotal, level: s.level });` |
| 72 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `authoritativeSum += Number(s.xpTotal \|\| 0);` |

#### `scripts/audit-mnalium-history.cjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Read-only operational forensics against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 42 | `gamification_summaries` | migrate | families/{f}/gamification_summaries | Legacy projection collection | `const summaryDoc = await db.doc(ˋfamilies/${familyId}/gamification_summaries/${user.id}ˋ).get();` |
| 63 | `gamification_events` | migrate | families/{f}/gamification_events | Existing XP event ledger | `const eventsSnap = await db.collection(ˋfamilies/${familyId}/gamification_eventsˋ)` |
| 166 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: u.rewardPoints ?? null,` |
| 167 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: u.lifetimeXP ?? null,` |
| 173 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `summaryXpTotal: summaryDoc.exists ? (summaryDoc.data().xpTotal ?? null) : null,` |
| 187 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `console.log('created:', result.member.createdAt, '\| rewardPoints:', result.member.rewardPoints, '\| lifetimeXP:', result.member.lifetimeXP);` |
| 187 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `console.log('created:', result.member.createdAt, '\| rewardPoints:', result.member.rewardPoints, '\| lifetimeXP:', result.member.lifetimeXP);` |

#### `scripts/backfill-gamification-xp.firestore.ts` — MIGRATE · Phase 5 · risk Medium

> Historical one-shot migration tooling

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 67 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: number(data.lifetimeXP),` |
| 68 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: number(data.rewardPoints),` |
| 75 | `gamification_summaries` | migrate | families/{f}/gamification_summaries | Legacy projection collection | `const document = await family(familyId).collection('gamification_summaries').doc(memberId).get()` |
| 80 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: number(data.xpTotal) ?? 0,` |
| 84 | `currentStreak` | migrate | users.currentStreak | Consecutive qualifying days | `currentStreak: number(data.currentStreak) ?? 0,` |
| 85 | `bestStreak` | migrate | summary.bestStreak | Projection best-streak counter | `bestStreak: number(data.bestStreak) ?? 0,` |
| 116 | `behaviour_events` | migrate | families/{f}/behaviour_events | Behaviour intent log | `const snapshot = await family(familyId).collection('behaviour_events')` |
| 132 | `gamification_events` | migrate | families/{f}/gamification_events | Existing XP event ledger | `const snapshot = await family(familyId).collection('gamification_events')` |
| 147 | `gamification_summaries` | migrate | families/{f}/gamification_summaries | Legacy projection collection | `const summaryRef = family(familyId).collection('gamification_summaries').doc(memberId)` |
| 157 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `if (number(data.xpTotal) !== 0) throw new Error(ˋSummary XP changed for ${familyId}/${memberId}ˋ)` |
| 158 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `// Only XP-derived fields are written. rewardPoints lives on users/{id}` |
| 161 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: write.xpTotal,` |

#### `scripts/backfill-gamification-xp.test.ts` — MIGRATE · Phase 5 · risk Medium

> Historical one-shot migration tooling

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 32 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: Record<string, number>` |
| 49 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 0,` |
| 50 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 53 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 54 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 65 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 40,` |
| 66 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 350,` |
| 84 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: { 'child-1': 350 },` |
| 104 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: write.xpTotal,` |
| 139 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('subtracts reversed awards through the reversal delta', () => {` |
| 195 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `['summary_xp_already_populated', { summary: summary({ xpTotal: 120 }) }],` |
| 212 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const report = classifyCandidate({ ...base, member: member({ lifetimeXP: 999 }) })` |
| 224 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 2500,` |
| 225 | `level` | test | in-memory / derived | Member level | `level: 3,` |
| 226 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 500,` |
| 227 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 500,` |
| 242 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(state.summaries['family-1/child-1'].xpTotal).toBe(0)` |
| 245 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `it('execute writes reconstructed XP and never touches rewardPoints', async () => {` |
| 250 | `level` | test | in-memory / derived | Member level | `expect(state.summaries['family-1/child-1']).toMatchObject({ xpTotal: 40, level: 1 })` |
| 250 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(state.summaries['family-1/child-1']).toMatchObject({ xpTotal: 40, level: 1 })` |
| 251 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state.rewardPoints['child-1']).toBe(350)` |
| 252 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `// no store method exists that can write rewardPoints` |
| 257 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `const state = world({ summaries: { 'family-1/child-1': summary({ currentStreak: 2, bestStreak: 6 }) } })` |
| 257 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `const state = world({ summaries: { 'family-1/child-1': summary({ currentStreak: 2, bestStreak: 6 }) } })` |
| 259 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `expect(state.summaries['family-1/child-1']).toMatchObject({ currentStreak: 2, bestStreak: 6, xpTotal: 40 })` |
| 259 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `expect(state.summaries['family-1/child-1']).toMatchObject({ currentStreak: 2, bestStreak: 6, xpTotal: 40 })` |
| 259 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(state.summaries['family-1/child-1']).toMatchObject({ currentStreak: 2, bestStreak: 6, xpTotal: 40 })` |
| 271 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(state.summaries['family-1/child-1'].xpTotal).toBe(40)` |
| 314 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `members: [member(), member({ id: 'child-2', displayName: 'Ali', lifetimeXP: 999 })],` |

#### `scripts/backfill-gamification-xp.ts` — MIGRATE · Phase 5 · risk Medium

> Historical one-shot migration tooling

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 10 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `* pre-cutover history can end up with a ready projection whose ˋxpTotalˋ is 0` |
| 11 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `* while the legacy ˋusers/{id}.lifetimeXPˋ counter is large.` |
| 14 | `gamification_summaries` | migrate | families/{f}/gamification_summaries | Legacy projection collection | `* writes it into ˋfamilies/{familyId}/gamification_summaries/{memberId}ˋ.` |
| 19 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `* - NEVER writes ˋusers/{id}.rewardPointsˋ (or any other spendable balance).` |
| 21 | `levelProgressForXp` | migrate | in-memory / derived | Canonical level formula | `*   with the canonical ˋlevelProgressForXpˋ helper and the canonical` |
| 31 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `* the legacy ˋlifetimeXPˋ counter (ˋreconciled_exactˋ). Any other outcome is` |
| 36 | `levelProgressForXp` | migrate | in-memory / derived | Canonical level formula | `import { levelProgressForXp } from '../src/domain/gamification/level'` |
| 59 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `readonly lifetimeXP: number \| undefined` |
| 60 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `readonly rewardPoints: number \| undefined` |
| 64 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `readonly xpTotal: number` |
| 68 | `currentStreak` | migrate | users.currentStreak | Consecutive qualifying days | `readonly currentStreak: number` |
| 69 | `bestStreak` | migrate | summary.bestStreak | Projection best-streak counter | `readonly bestStreak: number` |
| 123 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `readonly xpTotal: number` |
| 125 | `xpProgressInLevel` | migrate | summary.xpProgressInLevel | XP accumulated inside the current level | `readonly xpProgressInLevel: number` |
| 126 | `xpToNextLevel` | migrate | summary.xpToNextLevel | XP remaining until the next level | `readonly xpToNextLevel: number` |
| 148 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `* contract (ˋlifetimeXP += pointsRewardˋ at approval time).` |
| 197 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// Legacy contract: only positive behaviour deltas ever increased lifetimeXP.` |
| 251 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `legacyLifetimeXp: safeInteger(input.member.lifetimeXP) ?? null,` |
| 252 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `currentXpTotal: input.summary ? input.summary.xpTotal : null,` |
| 284 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `if (marker !== undefined && marker.source === BACKFILL_SOURCE && summary.xpTotal === marker.reconstructedXp) {` |
| 287 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `if (summary.xpTotal !== 0) return skip(input, 'summary_xp_already_populated')` |
| 306 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const legacy = safeInteger(member.lifetimeXP) ?? null` |
| 319 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `currentXpTotal: summary.xpTotal,` |
| 340 | `levelProgressForXp` | migrate | in-memory / derived | Canonical level formula | `const progress = levelProgressForXp(reconstructedXp, XP_PER_LEVEL)` |
| 342 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: reconstructedXp,` |
| 344 | `xpProgressInLevel` | migrate | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: progress.xpIntoLevel,` |
| 345 | `xpToNextLevel` | migrate | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: progress.xpToNextLevel,` |

#### `scripts/dump-repair-inputs.cjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Read-only operational forensics against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 32 | `gamification_summaries` | migrate | families/{f}/gamification_summaries | Legacy projection collection | `db.doc(ˋ${familyPath}/gamification_summaries/${childId}ˋ).get(),` |
| 33 | `gamification_events` | migrate | families/{f}/gamification_events | Existing XP event ledger | `db.collection(ˋ${familyPath}/gamification_eventsˋ).where('childId', '==', childId).get(),` |
| 46 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: user.rewardPoints ?? null,` |
| 47 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: user.lifetimeXP ?? null,` |

#### `scripts/dump-repair-inputs2.cjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Read-only operational forensics against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 25 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `rewardPoints: d.data().rewardPoints, lifetimeXP: d.data().lifetimeXP }));` |
| 25 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: d.data().rewardPoints, lifetimeXP: d.data().lifetimeXP }));` |
| 31 | `behaviour_events` | migrate | families/{f}/behaviour_events | Behaviour intent log | `out.behaviourEvent = await familyRef.collection('behaviour_events').doc('SXkg6R4vxWTJowdJXdLA').get()` |

#### `scripts/dump-repair-inputs3.cjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Read-only operational forensics against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 20 | `gamification_events` | migrate | families/{f}/gamification_events | Existing XP event ledger | `familyRef.collection('gamification_events').get(),` |
| 24 | `task_occurrences` | migrate | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `familyRef.collection('task_occurrences').get(),` |

#### `scripts/investigate-divergence.cjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Read-only operational forensics against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 2 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `* READ-ONLY production investigation: rewardPoints vs lifetimeXP divergence.` |
| 2 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `* READ-ONLY production investigation: rewardPoints vs lifetimeXP divergence.` |
| 39 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: d.rewardPoints ?? null,` |
| 40 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: d.lifetimeXP ?? null,` |
| 41 | `currentStreak` | migrate | users.currentStreak | Consecutive qualifying days | `currentStreak: d.currentStreak ?? null,` |
| 53 | `gamification_summaries` | migrate | families/{f}/gamification_summaries | Legacy projection collection | `console.log('\n########## STEP 2: gamification_summaries ##########');` |
| 54 | `gamification_summaries` | migrate | families/{f}/gamification_summaries | Legacy projection collection | `const sum = await db.doc(ˋfamilies/${fid}/gamification_summaries/${user.id}ˋ).get();` |
| 58 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `console.log(j({ xpTotal: s.xpTotal ?? null, level: s.level ?? null, projectionStatus: s.projectionStatus ?? null, updatedAt: ts(s.updatedAt), all: Object.keys(s` |
| 62 | `gamification_events` | migrate | families/{f}/gamification_events | Existing XP event ledger | `console.log('\n########## STEP 3: gamification_events ##########');` |
| 63 | `gamification_events` | migrate | families/{f}/gamification_events | Existing XP event ledger | `const ev = await db.collection(ˋfamilies/${fid}/gamification_eventsˋ).where('childId', '==', user.id).get();` |

#### `scripts/investigate-divergence2.cjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Read-only operational forensics against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 16 | `gamification_events` | migrate | families/{f}/gamification_events | Existing XP event ledger | `const be = await db.doc(ˋfamilies/${FID}/gamification_events/legacy_xp_baseline:${FID}:${CID}ˋ).get();` |
| 35 | `behaviour_events` | migrate | families/{f}/behaviour_events | Behaviour intent log | `const bev = await db.collection(ˋfamilies/${FID}/behaviour_eventsˋ).get();` |
| 61 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `tasks.docs.forEach(d => { const v = d.data(); console.log(d.id, '\|', v.title, '\| points=', v.points ?? v.pointsReward ?? v.rewardPoints, '\| xp=', v.xp ?? v.xpRe` |

#### `scripts/investigate-divergence3.cjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Read-only operational forensics against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 11 | `behaviour_events` | migrate | families/{f}/behaviour_events | Behaviour intent log | `const bev = await db.collection(ˋfamilies/${FID}/behaviour_eventsˋ).get();` |

#### `scripts/investigate-mnalium.cjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Read-only operational forensics against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 2 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `* READ-ONLY production investigation for the "rewardPoints up, lifetimeXP 0" P0.` |
| 2 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `* READ-ONLY production investigation for the "rewardPoints up, lifetimeXP 0" P0.` |
| 39 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: data.rewardPoints ?? null,` |
| 40 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: data.lifetimeXP ?? null,` |
| 41 | `currentStreak` | migrate | users.currentStreak | Consecutive qualifying days | `currentStreak: data.currentStreak ?? null,` |
| 42 | `longestStreak` | migrate | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: data.longestStreak ?? null,` |
| 50 | `gamification_summaries` | migrate | families/{f}/gamification_summaries | Legacy projection collection | `const summary = await db.doc(ˋfamilies/${familyId}/gamification_summaries/${user.id}ˋ).get();` |
| 70 | `task_occurrences` | migrate | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `const occurrences = await db.collection(ˋfamilies/${familyId}/task_occurrencesˋ)` |
| 75 | `gamification_events` | migrate | families/{f}/gamification_events | Existing XP event ledger | `const events = await db.collection(ˋfamilies/${familyId}/gamification_eventsˋ)` |

#### `scripts/investigate-today.cjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Read-only operational forensics against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 53 | `task_occurrences` | migrate | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `const occ = await db.collection(ˋfamilies/${FID}/task_occurrencesˋ).get();` |
| 61 | `gamification_events` | migrate | families/{f}/gamification_events | Existing XP event ledger | `console.log('\n=== gamification_events (whole family) ===');` |
| 62 | `gamification_events` | migrate | families/{f}/gamification_events | Existing XP event ledger | `const ev = await db.collection(ˋfamilies/${FID}/gamification_eventsˋ).get();` |

#### `scripts/legacy-xp-baseline.firestore.ts` — MIGRATE · Phase 5 · risk Medium

> Historical one-shot migration tooling

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 12 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `* Never writes ˋusers/{id}.rewardPointsˋ: the users collection is only read.` |
| 76 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: data.lifetimeXP,` |
| 77 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: integer(data.rewardPoints),` |
| 84 | `gamification_summaries` | migrate | families/{f}/gamification_summaries | Legacy projection collection | `const document = await family(familyId).collection('gamification_summaries').doc(memberId).get()` |
| 88 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: integer(data.xpTotal) ?? Number.NaN,` |
| 91 | `currentStreak` | migrate | users.currentStreak | Consecutive qualifying days | `currentStreak: integer(data.currentStreak) ?? 0,` |
| 92 | `bestStreak` | migrate | summary.bestStreak | Projection best-streak counter | `bestStreak: integer(data.bestStreak) ?? 0,` |
| 102 | `gamification_events` | migrate | families/{f}/gamification_events | Existing XP event ledger | `root.collection('gamification_events').where('childId', '==', memberId).get(),` |
| 103 | `task_occurrences` | migrate | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `root.collection('task_occurrences').where('assigneeId', '==', memberId).get(),` |
| 105 | `gamification_events` | migrate | families/{f}/gamification_events | Existing XP event ledger | `root.collection('gamification_events').doc(legacyBaselineEventId(familyRecord.id, memberId)).get(),` |
| 133 | `reversal` | migrate | families/{f}/reversals | Reversal / compensation path | `return data.eventType === 'reversal'` |
| 181 | `gamification_summaries` | migrate | families/{f}/gamification_summaries | Legacy projection collection | `const summaryRef = family(familyId).collection('gamification_summaries').doc(memberId)` |
| 183 | `gamification_events` | migrate | families/{f}/gamification_events | Existing XP event ledger | `const eventRef = family(familyId).collection('gamification_events').doc(write.event.id)` |
| 209 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `if (integer(data.xpTotal) !== 0) return 'noop' as const` |
| 214 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: write.projection.xpTotal,` |
| 216 | `xpProgressInLevel` | migrate | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: write.projection.xpProgressInLevel,` |
| 217 | `xpToNextLevel` | migrate | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: write.projection.xpToNextLevel,` |
| 222 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `// never by a hidden summary-only offset. No rewardPoints, occurrence,` |

#### `scripts/legacy-xp-baseline.test.ts` — MIGRATE · Phase 5 · risk Medium

> Historical one-shot migration tooling

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 35 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 380,` |
| 36 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 350,` |
| 41 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 0,` |
| 44 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 45 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 4,` |
| 86 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `readonly rewardPoints: Record<string, number \| undefined> = {}` |
| 94 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `for (const m of seed.members) this.rewardPoints[m.id] = m.rewardPoints` |
| 126 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `if (current === undefined \|\| current.xpTotal !== 0) return 'noop' as const` |
| 127 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `this.summaries[key] = { ...current, xpTotal: write.projection.xpTotal }` |
| 145 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `/* 1. eligible zero summary adopts legacy lifetimeXP                  */` |
| 149 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('adopts legacy lifetimeXP for an eligible zero summary', async () => {` |
| 155 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(store.summaries['fam1/child1'].xpTotal).toBe(380)` |
| 158 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `/* 2. rewardPoints untouched */` |
| 159 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `it('never writes rewardPoints', async () => {` |
| 161 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const before = JSON.stringify(store.rewardPoints)` |
| 163 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(JSON.stringify(store.rewardPoints)).toBe(before)` |
| 164 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(store.rewardPoints.child1).toBe(350)` |
| 171 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `members: [member({ lifetimeXP: 2_350 })],` |
| 175 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 2_350,` |
| 176 | `level` | test | in-memory / derived | Member level | `level: 3,` |
| 177 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 350,` |
| 178 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 650,` |
| 187 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `member: member({ id: 'NuyIJDP9fDNP2LiKynlsEyzur5N2', displayName: 'Alisya', lifetimeXP: 86, rewardPoints: 71 }),` |
| 187 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `member: member({ id: 'NuyIJDP9fDNP2LiKynlsEyzur5N2', displayName: 'Alisya', lifetimeXP: 86, rewardPoints: 71 }),` |
| 196 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `// rewardPoints are reported only, never proposed for a write.` |
| 213 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `/* 4c. negative / reversal XP events block */` |
| 214 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('skips when a negative XP reversal event exists', () => {` |
| 298 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `summary: summary({ xpTotal: 25 }),` |
| 306 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `/* 7. invalid or negative lifetimeXP -> skip */` |
| 307 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it.each([-1, 12.5, Number.NaN, '380', null, undefined])('skips invalid lifetimeXP %p', value => {` |
| 310 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `member: member({ lifetimeXP: value }),` |
| 369 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `members: [member(), member({ id: 'child2', displayName: 'Zero', lifetimeXP: 0, rewardPoints: 0 })],` |
| 369 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `members: [member(), member({ id: 'child2', displayName: 'Zero', lifetimeXP: 0, rewardPoints: 0 })],` |
| 393 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `store.summaries[key] = { ...store.summaries[key], xpTotal: store.summaries[key].xpTotal + 40 }` |
| 397 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(store.summaries[key].xpTotal).toBe(420)` |
| 441 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `summary: summary({ currentStreak: 0, bestStreak: 7 }),` |
| 441 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `summary: summary({ currentStreak: 0, bestStreak: 7 }),` |
| 447 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `'xpTotal', 'level', 'xpProgressInLevel', 'xpToNextLevel', 'percentage',` |
| 447 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `'xpTotal', 'level', 'xpProgressInLevel', 'xpToNextLevel', 'percentage',` |
| 447 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `'xpTotal', 'level', 'xpProgressInLevel', 'xpToNextLevel', 'percentage',` |
| 454 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `member: member({ lifetimeXP: 0 }),` |
| 498 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(afterBaseline.xpTotal).toBe(380)` |
| 507 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(afterAward.xpTotal).toBe(420)` |
| 509 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `// rewardPoints move only for the +40 completion, never for the baseline.` |
| 511 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(store.rewardPoints.child1).toBe(350)` |
| 514 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `it('reports rewardPoints before and after as identical in the dry-run', async () => {` |
| 521 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(store.summaries['fam1/child1'].xpTotal).toBe(0)` |

#### `scripts/legacy-xp-baseline.ts` — MIGRATE · Phase 5 · risk Medium

> Historical one-shot migration tooling

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 6 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `* Before the authoritative gamification projection existed, ˋusers/{memberId}.lifetimeXPˋ` |
| 9 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `* impossible. For eligible legacy members ˋlifetimeXPˋ is therefore ADOPTED as` |
| 13 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `*  - ˋusers/{id}.rewardPointsˋ is spendable currency and is NEVER read for a` |
| 22 | `levelProgressForXp` | migrate | in-memory / derived | Canonical level formula | `import { levelProgressForXp } from '../src/domain/gamification/level'` |
| 69 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `readonly lifetimeXP: unknown` |
| 71 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `readonly rewardPoints: number \| undefined` |
| 75 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `readonly xpTotal: number` |
| 78 | `currentStreak` | migrate | users.currentStreak | Consecutive qualifying days | `readonly currentStreak: number` |
| 79 | `bestStreak` | migrate | summary.bestStreak | Projection best-streak counter | `readonly bestStreak: number` |
| 137 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `readonly xpTotal: number` |
| 139 | `xpProgressInLevel` | migrate | summary.xpProgressInLevel | XP accumulated inside the current level | `readonly xpProgressInLevel: number` |
| 140 | `xpToNextLevel` | migrate | summary.xpToNextLevel | XP remaining until the next level | `readonly xpToNextLevel: number` |
| 186 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `legacyLifetimeXp: validLegacyXp(input.member.lifetimeXP) ?? null,` |
| 187 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `currentXpTotal: input.summary?.xpTotal ?? null,` |
| 188 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPointsBefore: typeof input.member.rewardPoints === 'number' ? input.member.rewardPoints : null,` |
| 205 | `levelProgressForXp` | migrate | in-memory / derived | Canonical level formula | `const progress = levelProgressForXp(xp, XP_PER_LEVEL)` |
| 207 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: xp,` |
| 209 | `xpProgressInLevel` | migrate | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: progress.xpIntoLevel,` |
| 210 | `xpToNextLevel` | migrate | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: progress.xpToNextLevel,` |
| 247 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const legacy = validLegacyXp(member.lifetimeXP)` |
| 257 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `if (summary.xpTotal !== 0) {` |
| 296 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `ˋlifetimeXP=${legacy}(valid,non-negative,integer)ˋ,` |
| 589 | `xpProgressInLevel` | migrate | summary.xpProgressInLevel | XP accumulated inside the current level | `? ˋ${r.proposedProjection.xpProgressInLevel}/${XP_PER_LEVEL} (${r.proposedProjection.percentage}%, toNext=${r.proposedProjection.xpToNextLevel})ˋ` |
| 589 | `xpToNextLevel` | migrate | summary.xpToNextLevel | XP remaining until the next level | `? ˋ${r.proposedProjection.xpProgressInLevel}/${XP_PER_LEVEL} (${r.proposedProjection.percentage}%, toNext=${r.proposedProjection.xpToNextLevel})ˋ` |
| 619 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `lines.push('rewardPoints writes: 0 (this script never writes users/{id}.rewardPoints)')` |

#### `scripts/lib/family-data-tools.ts` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 34 | `behaviour_events` | read | families/{f}/behaviour_events | Behaviour intent log | `'behaviour_events',` |
| 286 | `rewardPoints` | initialise | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 287 | `lifetimeXP` | initialise | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 0,` |
| 288 | `currentStreak` | initialise | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 289 | `longestStreak` | initialise | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 0,` |

#### `scripts/migrate-legacy-xp.test.ts` — MIGRATE · Phase 5 · risk Medium

> Historical one-shot migration tooling

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 57 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `eventsA: await docs(ˋfamilies/${FAMILY_A}/gamification_eventsˋ),` |
| 58 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `summariesA: await docs(ˋfamilies/${FAMILY_A}/gamification_summariesˋ),` |
| 73 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `events: await docs(ˋfamilies/${FAMILY_A}/gamification_eventsˋ),` |
| 74 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `summaries: await docs(ˋfamilies/${FAMILY_A}/gamification_summariesˋ),` |
| 95 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `db.doc('users/positive').set({ familyId: FAMILY_A, role: 'child', lifetimeXP: 125, rewardPoints: 7 }),` |
| 95 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `db.doc('users/positive').set({ familyId: FAMILY_A, role: 'child', lifetimeXP: 125, rewardPoints: 7 }),` |
| 96 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `db.doc('users/fresh').set({ familyId: FAMILY_A, role: 'child', lifetimeXP: 75 }),` |
| 97 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `db.doc('users/zero').set({ familyId: FAMILY_A, role: 'child', lifetimeXP: 0 }),` |
| 99 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `db.doc('users/negative').set({ familyId: FAMILY_A, role: 'child', lifetimeXP: -1 }),` |
| 100 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `db.doc('users/fraction').set({ familyId: FAMILY_A, role: 'child', lifetimeXP: 1.5 }),` |
| 101 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `db.doc('users/nan').set({ familyId: FAMILY_A, role: 'child', lifetimeXP: Number.NaN }),` |
| 102 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `db.doc('users/infinity').set({ familyId: FAMILY_A, role: 'child', lifetimeXP: Infinity }),` |
| 103 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `db.doc('users/negative-infinity').set({ familyId: FAMILY_A, role: 'child', lifetimeXP: -Infinity }),` |
| 104 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `db.doc('users/unsafe').set({ familyId: FAMILY_A, role: 'child', lifetimeXP: Number.MAX_SAFE_INTEGER + 1 }),` |
| 105 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `db.doc('users/other-role').set({ familyId: FAMILY_A, role: 'parent', lifetimeXP: 999 }),` |
| 106 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `db.doc('users/existing').set({ familyId: FAMILY_A, role: 'child', lifetimeXP: 50 }),` |
| 107 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `db.doc('users/clean-existing').set({ familyId: FAMILY_A, role: 'child', lifetimeXP: 60 }),` |
| 108 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `db.doc('users/foreign').set({ familyId: FAMILY_B, role: 'child', lifetimeXP: 333 }),` |
| 111 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `db.doc(ˋfamilies/${FAMILY_A}/gamification_events/${legacyBaselineEventId(FAMILY_A, 'existing')}ˋ).set(` |
| 114 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `db.doc(ˋfamilies/${FAMILY_A}/gamification_events/${legacyBaselineEventId(FAMILY_A, 'clean-existing')}ˋ).set(` |
| 117 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `db.doc(ˋfamilies/${FAMILY_A}/gamification_summaries/positiveˋ).set({` |
| 118 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `schemaVersion: 1, familyId: FAMILY_A, childId: 'positive', xpTotal: 999, level: 1, currentStreak: 0, bestStreak: 0,` |
| 118 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `schemaVersion: 1, familyId: FAMILY_A, childId: 'positive', xpTotal: 999, level: 1, currentStreak: 0, bestStreak: 0,` |
| 118 | `level` | test | in-memory / derived | Member level | `schemaVersion: 1, familyId: FAMILY_A, childId: 'positive', xpTotal: 999, level: 1, currentStreak: 0, bestStreak: 0,` |
| 118 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `schemaVersion: 1, familyId: FAMILY_A, childId: 'positive', xpTotal: 999, level: 1, currentStreak: 0, bestStreak: 0,` |
| 122 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `db.doc(ˋfamilies/${FAMILY_A}/gamification_summaries/clean-existingˋ).set({` |
| 123 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `schemaVersion: 1, familyId: FAMILY_A, childId: 'clean-existing', xpTotal: 60, level: 1, currentStreak: 0, bestStreak: 0,` |
| 123 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `schemaVersion: 1, familyId: FAMILY_A, childId: 'clean-existing', xpTotal: 60, level: 1, currentStreak: 0, bestStreak: 0,` |
| 123 | `level` | test | in-memory / derived | Member level | `schemaVersion: 1, familyId: FAMILY_A, childId: 'clean-existing', xpTotal: 60, level: 1, currentStreak: 0, bestStreak: 0,` |
| 123 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `schemaVersion: 1, familyId: FAMILY_A, childId: 'clean-existing', xpTotal: 60, level: 1, currentStreak: 0, bestStreak: 0,` |
| 127 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `db.doc(ˋfamilies/${FAMILY_A}/gamification_events/live-post-cutoverˋ).set({` |
| 166 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `const existingBefore = (await db.doc(ˋfamilies/${FAMILY_A}/gamification_events/${existingId}ˋ).get()).data()!` |
| 172 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect((await db.doc(ˋfamilies/${FAMILY_A}/gamification_events/${positiveId}ˋ).get()).data()).toEqual(baseline(FAMILY_A, 'positive', 125, FIRST_RUN))` |
| 173 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect((await db.doc(ˋfamilies/${FAMILY_A}/gamification_events/${freshId}ˋ).get()).data()).toEqual(baseline(FAMILY_A, 'fresh', 75, FIRST_RUN))` |
| 174 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect((await db.doc(ˋfamilies/${FAMILY_A}/gamification_events/${existingId}ˋ).get()).data()).toEqual(existingBefore)` |
| 175 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `expect((await db.doc('users/positive').get()).data()).toMatchObject({ lifetimeXP: 125, rewardPoints: 7 })` |
| 175 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await db.doc('users/positive').get()).data()).toMatchObject({ lifetimeXP: 125, rewardPoints: 7 })` |
| 177 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect((await db.doc(ˋfamilies/${FAMILY_A}/gamification_events/live-post-cutoverˋ).get()).data()!.xpDelta).toBe(10)` |
| 179 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `const positiveSummary = (await db.doc(ˋfamilies/${FAMILY_A}/gamification_summaries/positiveˋ).get()).data()!` |
| 181 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `const recoveredSummary = (await db.doc(ˋfamilies/${FAMILY_A}/gamification_summaries/existingˋ).get()).data()!` |
| 183 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `const repairedCleanSummary = (await db.doc(ˋfamilies/${FAMILY_A}/gamification_summaries/clean-existingˋ).get()).data()!` |
| 188 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect((await db.doc(ˋfamilies/${FAMILY_A}/gamification_events/${positiveId}ˋ).get()).data()).toEqual(baseline(FAMILY_A, 'positive', 125, FIRST_RUN))` |
| 202 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `const eventRef = db.doc(ˋfamilies/${FAMILY_A}/gamification_events/${legacyBaselineEventId(FAMILY_A, 'existing')}ˋ)` |
| 230 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `const summary = await transaction.get(writer.doc(ˋfamilies/${FAMILY_A}/gamification_summaries/positiveˋ))` |
| 235 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `transaction.create(writer.doc(ˋfamilies/${FAMILY_A}/gamification_events/concurrent-live-eventˋ), {` |
| 246 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `expect((await db.doc(ˋfamilies/${FAMILY_A}/gamification_summaries/positiveˋ).get()).data()!.earliestDirtyCursor).toEqual(raceCursor)` |
| 247 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect((await db.doc(ˋfamilies/${FAMILY_A}/gamification_events/concurrent-live-eventˋ).get()).data()).toMatchObject({ xpDelta: 1, sourceId: 'race-source' })` |
| 257 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect((await db.doc(ˋfamilies/${FAMILY_B}/gamification_events/${legacyBaselineEventId(FAMILY_B, 'foreign')}ˋ).get()).data()).toMatchObject({ familyId: FAMILY_B` |

#### `scripts/migrate-legacy-xp.ts` — MIGRATE · Phase 5 · risk Medium

> Historical one-shot migration tooling

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 133 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `function expectedBaseline(familyId: string, childId: string, lifetimeXP: number, cutoverAt: Timestamp, runAt: Timestamp): LegacyBaselineEvent {` |
| 140 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `xpDelta: lifetimeXP,` |
| 192 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 0,` |
| 193 | `level` | migrate | in-memory / derived | Member level | `level: 1,` |
| 194 | `currentStreak` | migrate | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 195 | `bestStreak` | migrate | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 277 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: number,` |
| 284 | `gamification_events` | migrate | families/{f}/gamification_events | Existing XP event ledger | `const eventRef = familyRef.collection('gamification_events').doc(eventId)` |
| 285 | `gamification_summaries` | migrate | families/{f}/gamification_summaries | Legacy projection collection | `const summaryRef = familyRef.collection('gamification_summaries').doc(childId)` |
| 297 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `if (userData.lifetimeXP !== lifetimeXP) {` |
| 298 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `throw new Error(ˋUser ${childId} lifetimeXP changed while migrating; retry the family passˋ)` |
| 301 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const expected = expectedBaseline(familyId, childId, lifetimeXP, migration.cutoverAt!, runAt)` |
| 324 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const lifetimeXP = child.data().lifetimeXP` |
| 325 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `if (!assertPositiveSafeInteger(lifetimeXP)) {` |
| 330 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const expected = expectedBaseline(familyId, child.id, lifetimeXP, migration.cutoverAt!, runAt)` |
| 331 | `gamification_events` | migrate | families/{f}/gamification_events | Existing XP event ledger | `const existing = await db.collection('families').doc(familyId).collection('gamification_events').doc(expected.idempotencyKey).get()` |
| 340 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const outcome = await inspectChild(db, familyId, child.id, lifetimeXP, runAt, args.afterChildTransactionRead)` |

#### `scripts/reconcile-pre-cutover-completions.cjs` — MIGRATE · Phase 5 · risk Medium

> Historical one-shot migration tooling

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 58 | `gamification_summaries` | migrate | families/{f}/gamification_summaries | Legacy projection collection | `? await db.doc(ˋfamilies/${familyId}/gamification_summaries/${childId}ˋ).get()` |
| 63 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// Evidence that the adopted baseline was derived from legacy lifetimeXP.` |
| 84 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `currentXpTotal: summary.exists ? (summary.data().xpTotal ?? 0) : null,` |
| 85 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `currentLifetimeXP: child.exists ? (child.data().lifetimeXP ?? 0) : null,` |

#### `scripts/reconcile-xp-ledger.cjs` — MIGRATE · Phase 5 · risk Medium

> Historical one-shot migration tooling

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 7 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `*   current summary.xpTotal - legacy baseline event xpDelta` |
| 12 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `* when BOTH its rewardPoints delta and its XP delta are provably absent.` |
| 55 | `gamification_summaries` | migrate | families/{f}/gamification_summaries | Legacy projection collection | `db.collection(ˋfamilies/${familyId}/gamification_summariesˋ).get(),` |
| 56 | `gamification_events` | migrate | families/{f}/gamification_events | Existing XP event ledger | `db.collection(ˋfamilies/${familyId}/gamification_eventsˋ).get(),` |
| 58 | `task_occurrences` | migrate | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `db.collection(ˋfamilies/${familyId}/task_occurrencesˋ).get(),` |
| 59 | `behaviour_events` | migrate | families/{f}/behaviour_events | Behaviour intent log | `db.collection(ˋfamilies/${familyId}/behaviour_eventsˋ).get(),` |
| 83 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const xpTotal = int(summary && summary.xpTotal);` |
| 84 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `const rewardPoints = int(member.rewardPoints);` |
| 85 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const lifetimeXP = int(member.lifetimeXP);` |
| 92 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const postBaselineXp = xpTotal - baselineXp;` |
| 146 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// Behaviour events: legacy client-applied points/lifetimeXP vs projection.` |
| 154 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// (users.lifetimeXP), so it must never be re-applied.` |
| 178 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `balances: { rewardPoints, lifetimeXP, xpTotal },` |
| 178 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `balances: { rewardPoints, lifetimeXP, xpTotal },` |
| 178 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `balances: { rewardPoints, lifetimeXP, xpTotal },` |
| 179 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// A positive gap proves the legacy mirror (users.lifetimeXP) received XP` |
| 181 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `legacyPostBaselineXp: lifetimeXP - baselineXp,` |
| 182 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXpVersusProjectionGap: (lifetimeXP - baselineXp) - (xpTotal - baselineXp),` |
| 182 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `lifetimeXpVersusProjectionGap: (lifetimeXP - baselineXp) - (xpTotal - baselineXp),` |

#### `scripts/recovery-approve.cjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Read-only operational forensics against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 89 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 90 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 0,` |
| 91 | `currentStreak` | migrate | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 92 | `longestStreak` | migrate | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 0,` |

#### `scripts/repair-shared-task-completions.cjs` — MIGRATE · Phase 5 · risk Medium

> Historical one-shot migration tooling

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 74 | `task_occurrences` | migrate | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `const occurrences = await db.collection(ˋfamilies/${familyId}/task_occurrencesˋ)` |
| 78 | `gamification_events` | migrate | families/{f}/gamification_events | Existing XP event ledger | `const events = await db.collection(ˋfamilies/${familyId}/gamification_eventsˋ)` |
| 82 | `gamification_summaries` | migrate | families/{f}/gamification_summaries | Legacy projection collection | `const summary = await db.doc(ˋfamilies/${familyId}/gamification_summaries/${childId}ˋ).get();` |
| 97 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `currentRewardPoints: child.rewardPoints ?? 0,` |
| 98 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `currentXpTotal: summary.exists ? (summary.data().xpTotal ?? 0) : 0,` |

#### `scripts/scan-post-deploy-approvals.cjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Read-only operational forensics against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 8 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `*   2. no new positive behaviour leaves lifetimeXP and xpTotal divergent.` |
| 8 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `*   2. no new positive behaviour leaves lifetimeXP and xpTotal divergent.` |
| 47 | `behaviour_events` | migrate | families/{f}/behaviour_events | Behaviour intent log | `const behaviourEvents = await db.collection(ˋfamilies/${familyId}/behaviour_eventsˋ).get();` |
| 52 | `gamification_summaries` | migrate | families/{f}/gamification_summaries | Legacy projection collection | `const summary = await db.doc(ˋfamilies/${familyId}/gamification_summaries/${data.childId}ˋ).get();` |
| 57 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: child.exists ? (child.data().lifetimeXP ?? 0) : null,` |
| 58 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: summary.exists ? (summary.data().xpTotal ?? 0) : null,` |

#### `scripts/seed.ts` — MIGRATE · Phase 5 · risk Low

> Fixture/seed data follows the new schema

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 37 | `rewardPoints` | initialise | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 38 | `lifetimeXP` | initialise | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 0,` |
| 39 | `currentStreak` | initialise | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 40 | `longestStreak` | initialise | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 0,` |
| 53 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 1250,` |
| 54 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 3400,` |
| 55 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `currentStreak: 5,` |
| 56 | `longestStreak` | read | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 12,` |

#### `scripts/verify-deployed-build-contract.cjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Read-only operational forensics against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 42 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `await db.doc(ˋusers/${CHILD_A}ˋ).set({ familyId: FAMILY, role: 'child', status: 'active', rewardPoints: 0, lifetimeXP: 0 })` |
| 42 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `await db.doc(ˋusers/${CHILD_A}ˋ).set({ familyId: FAMILY, role: 'child', status: 'active', rewardPoints: 0, lifetimeXP: 0 })` |
| 43 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `await db.doc(ˋusers/${CHILD_B}ˋ).set({ familyId: FAMILY, role: 'child', status: 'active', rewardPoints: 0, lifetimeXP: 0 })` |
| 43 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `await db.doc(ˋusers/${CHILD_B}ˋ).set({ familyId: FAMILY, role: 'child', status: 'active', rewardPoints: 0, lifetimeXP: 0 })` |
| 61 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `assert.equal(childA.rewardPoints, 20)` |
| 63 | `behaviour_events` | migrate | families/{f}/behaviour_events | Behaviour intent log | `await db.doc(ˋfamilies/${FAMILY}/behaviour_events/behaviour-1ˋ).set({` |
| 76 | `gamification_summaries` | migrate | families/{f}/gamification_summaries | Legacy projection collection | `const summaryB = (await db.doc(ˋfamilies/${FAMILY}/gamification_summaries/${CHILD_B}ˋ).get()).data()` |
| 77 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `assert.equal(childB.rewardPoints, 20)` |
| 78 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `assert.equal(childB.lifetimeXP, 20)` |
| 79 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `assert.equal(summaryB.xpTotal, 20, 'lifetimeXP and xpTotal must not diverge')` |
| 79 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `assert.equal(summaryB.xpTotal, 20, 'lifetimeXP and xpTotal must not diverge')` |
| 84 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `sharedTaskAward: { status: first.status, retry: second.status, rewardPoints: childA.rewardPoints },` |
| 85 | `lifetimeXP` | migrate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `behaviourAward: { status: behaviourFirst.status, retry: behaviourSecond.status, rewardPoints: childB.rewardPoints, lifetimeXP: childB.lifetimeXP, xpTotal: summa` |
| 85 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `behaviourAward: { status: behaviourFirst.status, retry: behaviourSecond.status, rewardPoints: childB.rewardPoints, lifetimeXP: childB.lifetimeXP, xpTotal: summa` |
| 85 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `behaviourAward: { status: behaviourFirst.status, retry: behaviourSecond.status, rewardPoints: childB.rewardPoints, lifetimeXP: childB.lifetimeXP, xpTotal: summa` |

#### `scripts/verify-join-route.mjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Read-only operational forensics against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 31 | `level` | migrate | in-memory / derived | Member level | `const heading = await page.getByRole('heading', { level: 1 }).first().textContent();` |

#### `scripts/verify-smoke-data.ts` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Read-only operational forensics against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 250 | `behaviour_events` | migrate | families/{f}/behaviour_events | Behaviour intent log | `'wallet_transactions', 'behaviour_events', 'challenges', 'funds',` |

#### `src/components/dashboard/GamificationSummaryCard.regression.test.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 14 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `'gamification.xpTotal': ˋ${options?.xp ?? 0} Total XPˋ,` |
| 15 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `'gamification.currentStreak': 'Current Streak',` |
| 16 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `'gamification.bestStreak': 'Best Streak',` |
| 24 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 0,` |
| 25 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 26 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 1000,` |
| 27 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 0,` |
| 28 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 29 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |

#### `src/components/dashboard/GamificationSummaryCard.test.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 14 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `'gamification.xpTotal': ˋ${options?.xp ?? 0} Total XPˋ,` |
| 17 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `'gamification.xpToNextLevel': ˋ${options?.xp ?? 0} XP to reach Level ${options?.level ?? ''}ˋ,` |
| 18 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `'gamification.currentStreak': 'Current Streak',` |
| 19 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `'gamification.bestStreak': 'Best Streak',` |
| 59 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 0,` |
| 60 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 61 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 1000,` |
| 62 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 0,` |
| 63 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 64 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 80 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 2500,` |
| 81 | `level` | test | in-memory / derived | Member level | `level: 3,` |
| 82 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 500,` |
| 83 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 500,` |
| 84 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 2,` |
| 85 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 5,` |
| 100 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1000,` |
| 101 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 102 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 1000,` |
| 103 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 0,` |
| 104 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 3,` |
| 105 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 10,` |
| 121 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1000,` |
| 122 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 123 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 1000,` |
| 124 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 0,` |
| 125 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 1,` |
| 126 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 1,` |
| 139 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1000,` |
| 140 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 141 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 1000,` |
| 142 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 0,` |
| 143 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 1,` |
| 144 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 1,` |
| 157 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1000,` |
| 158 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 159 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 1000,` |
| 160 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 0,` |
| 161 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 162 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 175 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1000,` |
| 176 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 177 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 1000,` |
| 178 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 0,` |
| 179 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 180 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 193 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1500,` |
| 194 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 195 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 500,` |
| 196 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 500,` |
| 197 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 198 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 212 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1500,` |
| 213 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 214 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 500,` |
| 215 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 500,` |
| 216 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 217 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |

#### `src/components/dashboard/GamificationSummaryCard.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 96 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal,` |
| 97 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel,` |
| 98 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel,` |
| 99 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `currentStreak,` |
| 100 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `bestStreak,` |
| 106 | `level` | calculate | in-memory / derived | Member level | `const levelProgress = (xpProgressInLevel / 1000) * 100;` |
| 106 | `xpProgressInLevel` | calculate | summary.xpProgressInLevel | XP accumulated inside the current level | `const levelProgress = (xpProgressInLevel / 1000) * 100;` |
| 113 | `xpProgressInLevel` | calculate | summary.xpProgressInLevel | XP accumulated inside the current level | `<span aria-label={t('gamification.xpProgress', { xp: xpProgressInLevel, level })}>` |
| 114 | `level` | calculate | in-memory / derived | Member level | `{Math.round(levelProgress)}%` |
| 119 | `level` | calculate | in-memory / derived | Member level | `<Progress value={levelProgress} className="bg-primary-700 [&>div]:bg-white" />` |
| 120 | `xpTotal` | calculate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `<p className="mt-2 text-right text-xs font-medium text-primary-200" aria-label={t('gamification.xpTotal', { xp: xpTotal })}>` |
| 121 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `{t('gamification.xpTotal', { xp: xpTotal })}` |
| 123 | `xpToNextLevel` | calculate | summary.xpToNextLevel | XP remaining until the next level | `<p className="mt-1 text-right text-xs font-medium text-primary-200" aria-label={t('gamification.xpToNextLevel', { xp: xpToNextLevel, level: level + 1 })}>` |
| 124 | `xpToNextLevel` | calculate | summary.xpToNextLevel | XP remaining until the next level | `{t('gamification.xpToNext', { xp: xpToNextLevel, level: level + 1 })}` |
| 130 | `currentStreak` | calculate | users.currentStreak | Consecutive qualifying days | `<p className="text-xs font-bold uppercase tracking-wider text-primary-200">{t('gamification.currentStreak')}</p>` |
| 133 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `{currentStreak}` |
| 137 | `bestStreak` | calculate | summary.bestStreak | Projection best-streak counter | `<p className="text-xs font-bold uppercase tracking-wider text-primary-200">{t('gamification.bestStreak')}</p>` |
| 140 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `{bestStreak}` |

#### `src/components/funds/PetLeaderboard.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 18 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `// A petbox_request reversal has sourceKind === 'petbox_request'` |

#### `src/components/history/TransactionDetailsSheet.action.test.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 74 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `describe('TransactionDetailsSheet raw reversal source integration', () => {` |
| 83 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `familyMembers: [{ id: 'child-1', displayName: 'Alex', rewardPoints: 0 }],` |

#### `src/components/history/TransactionHistoryScreen.test.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 361 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('keeps request details connected to their canonical reversal source', () => {` |

#### `src/components/history/historySourceResolver.ts` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 38 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `* Resolves a display row back to the exact source document used by reversal` |

#### `src/components/parent/ApprovalCenter.test.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 215 | `level` | test | in-memory / derived | Member level | `expect(screen.getByRole('heading', { name: 'Money Request', level: 3 })).toBeInTheDocument();` |

#### `src/components/parent/dashboard/ChildSummaryCard.authoritativeXp.test.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 11 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 0,` |
| 12 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 13 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 1000,` |
| 14 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 0,` |
| 15 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 16 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 31 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('renders level/progress from the projection even when users.lifetimeXP is stale', () => {` |
| 32 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const child = { id: 'c1', displayName: 'Alice', lifetimeXP: 9999, rewardPoints: 0 };` |
| 32 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const child = { id: 'c1', displayName: 'Alice', lifetimeXP: 9999, rewardPoints: 0 };` |
| 38 | `level` | test | in-memory / derived | Member level | `gamificationSummary={summaryView({ level: 3, xpTotal: 2500, xpToNextLevel: 500, xpProgressInLevel: 500 })}` |
| 38 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `gamificationSummary={summaryView({ level: 3, xpTotal: 2500, xpToNextLevel: 500, xpProgressInLevel: 500 })}` |
| 38 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `gamificationSummary={summaryView({ level: 3, xpTotal: 2500, xpToNextLevel: 500, xpProgressInLevel: 500 })}` |
| 38 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `gamificationSummary={summaryView({ level: 3, xpTotal: 2500, xpToNextLevel: 500, xpProgressInLevel: 500 })}` |
| 47 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('does not fabricate a level from lifetimeXP when the projection is unavailable', () => {` |
| 48 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const child = { id: 'c1', displayName: 'Bob', lifetimeXP: 4200, rewardPoints: 0 };` |
| 48 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const child = { id: 'c1', displayName: 'Bob', lifetimeXP: 4200, rewardPoints: 0 };` |
| 58 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// Fallback state only — never a lifetimeXP-derived level, never a fake Level 1` |
| 66 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const child = { id: 'c1', displayName: 'Cara', lifetimeXP: 1200, rewardPoints: 0 };` |
| 66 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const child = { id: 'c1', displayName: 'Cara', lifetimeXP: 1200, rewardPoints: 0 };` |

#### `src/components/parent/dashboard/ChildSummaryCard.test.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 14 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 0,` |
| 15 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 16 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 21 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 0,` |
| 22 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 23 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 1000,` |
| 24 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 0,` |
| 25 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 26 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 49 | `level` | test | in-memory / derived | Member level | `level: 3,` |
| 50 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 2500,` |
| 51 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 500,` |
| 52 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 500,` |
| 53 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 2,` |
| 54 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 5,` |
| 197 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 0,` |
| 198 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 199 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 200 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 221 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 222 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1000,` |
| 223 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 1000,` |
| 224 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 0,` |
| 243 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 244 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 100,` |
| 245 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 900,` |
| 246 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 100,` |
| 386 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `const summary1 = createMockSummary({ level: 2, currentStreak: 3 });` |
| 386 | `level` | test | in-memory / derived | Member level | `const summary1 = createMockSummary({ level: 2, currentStreak: 3 });` |
| 387 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `const summary2 = createMockSummary({ level: 5, currentStreak: 10 });` |
| 387 | `level` | test | in-memory / derived | Member level | `const summary2 = createMockSummary({ level: 5, currentStreak: 10 });` |
| 422 | `level` | test | in-memory / derived | Member level | `level: 3,` |

#### `src/components/parent/dashboard/ChildSummaryCard.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 31 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `// Authoritative progression source: families/{familyId}/gamification_summaries/{memberId}.` |
| 32 | `lifetimeXP` | calculate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// ˋusers/{id}.lifetimeXPˋ is legacy and must never drive level/XP UI here — when the` |
| 37 | `level` | read | in-memory / derived | Member level | `const level = summary ? summary.level : null;` |
| 39 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `const points = child.rewardPoints \|\| 0;` |
| 41 | `bestStreak` | initialise | summary.bestStreak | Projection best-streak counter | `const bestStreak = summary ? summary.bestStreak : 0;` |
| 43 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `const xpToNextLevel = summary ? summary.xpToNextLevel : null;` |
| 45 | `level` | calculate | in-memory / derived | Member level | `const levelProgress = summary ? (summary.xpProgressInLevel / 1000) * 100 : 0;` |
| 45 | `xpProgressInLevel` | calculate | summary.xpProgressInLevel | XP accumulated inside the current level | `const levelProgress = summary ? (summary.xpProgressInLevel / 1000) * 100 : 0;` |
| 73 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `<span>{t('childCard.xpTotal')}</span>` |
| 74 | `xpToNextLevel` | calculate | summary.xpToNextLevel | XP remaining until the next level | `<span aria-label={t('childCard.xpToNext', { xp: xpToNextLevel, level: (level as number) + 1 })}>` |
| 75 | `xpToNextLevel` | calculate | summary.xpToNextLevel | XP remaining until the next level | `{t('childCard.xpToNext', { xp: xpToNextLevel, level: (level as number) + 1 })}` |
| 78 | `level` | calculate | in-memory / derived | Member level | `<Progress value={levelProgress} className="mt-1" />` |
| 102 | `bestStreak` | calculate | summary.bestStreak | Projection best-streak counter | `<p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{t('childCard.bestStreak')}</p>` |
| 105 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `{bestStreak}` |

#### `src/components/parent/dashboard/ChildrenOverview.test.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 87 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{ id: 'c-1', role: 'child', displayName: 'Alice', lifetimeXP: 500 },` |
| 118 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1000,` |
| 119 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 120 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 1,` |
| 121 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 3,` |
| 157 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1000,` |
| 158 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 159 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 1,` |
| 160 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 3,` |
| 196 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 2500,` |
| 197 | `level` | test | in-memory / derived | Member level | `level: 3,` |
| 198 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 2,` |
| 199 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 5,` |
| 261 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1000,` |
| 262 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 263 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 1,` |
| 264 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 3,` |
| 278 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 5000,` |
| 279 | `level` | test | in-memory / derived | Member level | `level: 6,` |
| 280 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 5,` |
| 281 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 10,` |
| 387 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1000,` |
| 388 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 389 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 1,` |
| 390 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 3,` |

#### `src/components/profile/ProfileEditorModal.test.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 16 | `unlockAvatar` | test | in-memory / derived | Avatar unlock (RP debit) | `return { ...actual, submitProfileUpdateRequest: submitMock, unlockAvatar: unlockMock }` |
| 75 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: 'https://old', avatarId: 'starter-cat', rewardPoints: 500, familyId: 'f1' })` |
| 87 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: '', avatarId: 'starter-cat', rewardPoints: 500, familyId: 'f1' })` |
| 98 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: '', avatarId: 'starter-cat', rewardPoints: 500, familyId: 'f1' })` |
| 111 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: '', avatarId: 'starter-cat', rewardPoints: 500, familyId: 'f1' })` |
| 118 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: '', avatarId: 'starter-cat', rewardPoints: 500, familyId: 'f1' })` |
| 145 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: '', avatarId: null, rewardPoints: 500, familyId: 'f1' })` |
| 159 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: '', avatarId: 'starter-cat', rewardPoints: 500, familyId: 'f1' })` |
| 171 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: '', avatarId: 'starter-cat', rewardPoints: 500, familyId: 'f1' })` |

#### `src/components/profile/ProfileEditorModal.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 10 | `unlockAvatar` | read | in-memory / derived | Avatar unlock (RP debit) | `unlockAvatar,` |
| 54 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `const pointsBalance = user?.rewardPoints \|\| 0;` |
| 83 | `unlockAvatar` | read | in-memory / derived | Avatar unlock (RP debit) | `await unlockAvatar(user.familyId, unlockTarget);` |

#### `src/components/reversals/HistoryActionControl.test.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 15 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `familyMembers: [{ id: 'child-1', displayName: 'Alex', rewardPoints: 20 }], childWallets: [{ id: 'child-1', balance: 500 }],` |
| 27 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('renders persisted reversal reason, actor, and completedAt rather than epoch time', () => {` |
| 44 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('does not expose a reversal control to a child', () => {` |

#### `src/components/reversals/HistoryActionControl.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 36 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `if (!action.action && !action.reversal) return null;` |
| 47 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `{action.reversal ? (` |
| 50 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `<p className="mt-1 font-medium">{action.reversal.reason}</p>` |
| 51 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `<p>{t('byActor', { actor: action.reversal.actorName, date: auditDate(action.reversal.occurredAt) })}</p>` |

#### `src/components/reversals/ReversalActionModal.test.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 25 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `expect(screen.getByText('This creates a linked reversal record. The original action will remain in history.')).toBeInTheDocument();` |

#### `src/components/reversals/ReversalActionModal.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 154 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `aria-labelledby="reversal-action-title"` |
| 158 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `<h2 id="reversal-action-title" className="text-xl font-bold text-gray-900">` |
| 176 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `<label className="mt-4 block text-sm font-semibold text-gray-700" htmlFor="reversal-reason">` |
| 179 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `<textarea ref={reasonRef} id="reversal-reason" aria-label={t('modal.reason')} value={reason} onChange={event => setReason(event.target.value)} className="mt-1 m` |

#### `src/components/reversals/ReversalHistoryPanel.test.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 10 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `familyData: { currency: '£' }, familyMembers: [{ id: 'child-1', displayName: 'Alex', rewardPoints: 20 }],` |

#### `src/components/reversals/ReversalHistoryPanel.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 38 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `points: Object.fromEntries(state.familyMembers.map((member: any) => [member.id, member.rewardPoints \|\| 0])),` |
| 53 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `.filter(action => action.action \|\| action.reversal)` |
| 79 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `{action.reversal && (` |
| 82 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `<p className="mt-1 font-medium">{action.reversal.reason}</p>` |
| 83 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `<p>{t('byActor', { actor: action.reversal.actorName, date: reversalDate(action.reversal.occurredAt) })}</p>` |

#### `src/components/wallet/TransactionDetailsModal.test.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 7 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `describe('TransactionDetailsModal reversal integration', () => {` |

#### `src/config/avatarCatalog.ts` — KEEP · n/a · risk Low

> Configuration and documentation, not a balance

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 12 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `* ˋrewardPointsˋ is a SPENDABLE reward currency — it is already deducted on` |
| 14 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `* unlocks deduct ˋrewardPointsˋ once. Selecting an already-owned avatar is free` |
| 36 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `/** Point cost for premium avatars (0 for starter). Integer rewardPoints. */` |

#### `src/domain/gamification/engine.test.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 49 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `.toMatchObject({ xpTotal: 175, level: 1, currentStreak: 1, bestStreak: 1, perfectDayCount: 1 })` |
| 49 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `.toMatchObject({ xpTotal: 175, level: 1, currentStreak: 1, bestStreak: 1, perfectDayCount: 1 })` |
| 49 | `level` | test | in-memory / derived | Member level | `.toMatchObject({ xpTotal: 175, level: 1, currentStreak: 1, bestStreak: 1, perfectDayCount: 1 })` |
| 49 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `.toMatchObject({ xpTotal: 175, level: 1, currentStreak: 1, bestStreak: 1, perfectDayCount: 1 })` |
| 58 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `.toMatchObject({ xpTotal: 175 })` |
| 83 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('compensates a later reversal and preserves the genuinely reached historical best', () => {` |
| 86 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `completionId: 'manual-document', effect: effect(true), immutableReversalId: 'reversal-1',` |
| 95 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `expect(reversed.events.every(({ event }) => event.causalGroupId.endsWith('invalidation_v1\|reversal-1'))).toBe(true)` |
| 97 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `.toMatchObject({ xpTotal: 0, currentStreak: 0, bestStreak: 1, perfectDayCount: 0 })` |
| 97 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `.toMatchObject({ xpTotal: 0, currentStreak: 0, bestStreak: 1, perfectDayCount: 0 })` |
| 97 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `.toMatchObject({ xpTotal: 0, currentStreak: 0, bestStreak: 1, perfectDayCount: 0 })` |
| 100 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('compensates a post-award reversal even when the day is not finalized', () => {` |
| 103 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `completionId: 'manual-document', effect: effect(true), immutableReversalId: 'unfinalized-reversal',` |
| 141 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `.toMatchObject({ currentStreak: 1, perfectDayCount: 1 })` |
| 144 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('repairs reversal-before-award as one net-zero causal group and makes retries no-ops', () => {` |
| 159 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `.toMatchObject({ xpTotal: 0, currentStreak: 0, bestStreak: 0, perfectDayCount: 0 })` |
| 159 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `.toMatchObject({ xpTotal: 0, currentStreak: 0, bestStreak: 0, perfectDayCount: 0 })` |
| 159 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `.toMatchObject({ xpTotal: 0, currentStreak: 0, bestStreak: 0, perfectDayCount: 0 })` |
| 162 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('makes valid already-invalid repairs no-ops through both approval and reversal entry points', () => {` |
| 175 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `expect(approvalRetry.summary).toMatchObject({ xpTotal: 0, currentStreak: 0, bestStreak: 0, perfectDayCount: 0 })` |
| 175 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `expect(approvalRetry.summary).toMatchObject({ xpTotal: 0, currentStreak: 0, bestStreak: 0, perfectDayCount: 0 })` |
| 175 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(approvalRetry.summary).toMatchObject({ xpTotal: 0, currentStreak: 0, bestStreak: 0, perfectDayCount: 0 })` |
| 176 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `expect(reversalRetry.summary).toMatchObject({ xpTotal: 0, currentStreak: 0, bestStreak: 0, perfectDayCount: 0 })` |
| 176 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `expect(reversalRetry.summary).toMatchObject({ xpTotal: 0, currentStreak: 0, bestStreak: 0, perfectDayCount: 0 })` |
| 176 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(reversalRetry.summary).toMatchObject({ xpTotal: 0, currentStreak: 0, bestStreak: 0, perfectDayCount: 0 })` |
| 219 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `expect(summary).toMatchObject({ xpTotal: 175, level: 1, currentStreak: 1, bestStreak: 1, perfectDayCount: 1, lastQualifiedDayKey: dayKey })` |
| 219 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `expect(summary).toMatchObject({ xpTotal: 175, level: 1, currentStreak: 1, bestStreak: 1, perfectDayCount: 1, lastQualifiedDayKey: dayKey })` |
| 219 | `level` | test | in-memory / derived | Member level | `expect(summary).toMatchObject({ xpTotal: 175, level: 1, currentStreak: 1, bestStreak: 1, perfectDayCount: 1, lastQualifiedDayKey: dayKey })` |
| 219 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(summary).toMatchObject({ xpTotal: 175, level: 1, currentStreak: 1, bestStreak: 1, perfectDayCount: 1, lastQualifiedDayKey: dayKey })` |

#### `src/domain/gamification/engine.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 459 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `// A reversal removes a previously observed qualification even before finalization;` |
| 507 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const xpTotal = foldXpEvents(events as readonly XpEventDocumentV1[])` |
| 511 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `schemaVersion: 1, familyId: [...familyIds][0], childId: [...childIds][0], xpTotal,` |
| 512 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `level: levelForXp(xpTotal, GAMIFICATION_CONFIG_V1.xpPerLevel), currentStreak: streak.currentStreak,` |
| 512 | `level` | read | in-memory / derived | Member level | `level: levelForXp(xpTotal, GAMIFICATION_CONFIG_V1.xpPerLevel), currentStreak: streak.currentStreak,` |
| 512 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `level: levelForXp(xpTotal, GAMIFICATION_CONFIG_V1.xpPerLevel), currentStreak: streak.currentStreak,` |
| 513 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `bestStreak: streak.bestStreak, perfectDayCount: calculatePerfectDayCount(events), lastQualifiedDayKey: streak.lastQualifiedDayKey,` |

#### `src/domain/gamification/level.test.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 2 | `levelProgressForXp` | test | in-memory / derived | Canonical level formula | `import { levelForXp, levelProgressForXp } from './level'` |
| 11 | `levelProgressForXp` | test | in-memory / derived | Canonical level formula | `expect(levelProgressForXp(1250, 1000)).toEqual({` |
| 12 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 14 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 750,` |
| 20 | `levelProgressForXp` | test | in-memory / derived | Canonical level formula | `expect(levelProgressForXp(Number.MAX_SAFE_INTEGER - 2, Number.MAX_SAFE_INTEGER - 1)).toMatchObject({` |
| 30 | `levelProgressForXp` | test | in-memory / derived | Canonical level formula | `expect(() => levelProgressForXp(0, xpPerLevel)).toThrow()` |

#### `src/domain/gamification/level.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 4 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `readonly xpToNextLevel: number` |
| 26 | `levelProgressForXp` | read | in-memory / derived | Canonical level formula | `export function levelProgressForXp(xp: number, xpPerLevel: number): Readonly<LevelProgress> {` |
| 32 | `xpToNextLevel` | calculate | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: xpPerLevel - xpIntoLevel,` |

#### `src/domain/gamification/perfectDay.test.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 105 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `const reversal = 'invalidation_v1\|reversal-1'` |
| 108 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `sourceTransitionId: reversal, effectiveAt: 2, existingEvents: initial,` |

#### `src/domain/gamification/streak.test.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 66 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `})).toEqual({ currentStreak: 2, bestStreak: 2, lastQualifiedDayKey: tuesday })` |
| 66 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `})).toEqual({ currentStreak: 2, bestStreak: 2, lastQualifiedDayKey: tuesday })` |
| 76 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `})).toMatchObject({ currentStreak: 0, bestStreak: 1, lastQualifiedDayKey: null })` |
| 76 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `})).toMatchObject({ currentStreak: 0, bestStreak: 1, lastQualifiedDayKey: null })` |
| 81 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `})).toMatchObject({ currentStreak: 1, bestStreak: 1, lastQualifiedDayKey: monday })` |
| 81 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `})).toMatchObject({ currentStreak: 1, bestStreak: 1, lastQualifiedDayKey: monday })` |
| 91 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `})).toEqual({ currentStreak: 2, bestStreak: 2, lastQualifiedDayKey: wednesday })` |
| 91 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `})).toEqual({ currentStreak: 2, bestStreak: 2, lastQualifiedDayKey: wednesday })` |
| 94 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('does not use a cache or clock: a late approval restores a finalized day and a later reversal removes it', () => {` |
| 97 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `const reversal = qualification(monday, 'unqualified', 'invalidation_v1\|reversal-1', 3)` |
| 100 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `.toEqual({ currentStreak: 1, bestStreak: 1, lastQualifiedDayKey: monday })` |
| 100 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `.toEqual({ currentStreak: 1, bestStreak: 1, lastQualifiedDayKey: monday })` |
| 101 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `expect(calculateStreak({ eligibilitySnapshots: [eligibility(monday)], events: [finalizedMiss, lateApproval, reversal] }))` |
| 102 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `.toEqual({ currentStreak: 0, bestStreak: 1, lastQualifiedDayKey: null })` |
| 102 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `.toEqual({ currentStreak: 0, bestStreak: 1, lastQualifiedDayKey: null })` |
| 124 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `.toEqual({ currentStreak: 0, bestStreak: 0, lastQualifiedDayKey: null })` |
| 124 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `.toEqual({ currentStreak: 0, bestStreak: 0, lastQualifiedDayKey: null })` |
| 146 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `})).toEqual({ currentStreak: 0, bestStreak: 1, lastQualifiedDayKey: null })` |
| 146 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `})).toEqual({ currentStreak: 0, bestStreak: 1, lastQualifiedDayKey: null })` |
| 157 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `})).toEqual({ currentStreak: 1, bestStreak: 1, lastQualifiedDayKey: tuesday })` |
| 157 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `})).toEqual({ currentStreak: 1, bestStreak: 1, lastQualifiedDayKey: tuesday })` |

#### `src/domain/gamification/streak.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 19 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `readonly currentStreak: number` |
| 20 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `readonly bestStreak: number` |
| 111 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `): Omit<StreakProjectionV1, 'bestStreak'> {` |
| 116 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `let currentStreak = 0` |
| 132 | `currentStreak` | calculate | users.currentStreak | Consecutive qualifying days | `currentStreak = currentStreak > 0 && !unresolvedEligibleDay ? currentStreak + 1 : 1` |
| 136 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `currentStreak = 0` |
| 146 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `return { currentStreak, lastQualifiedDayKey }` |
| 160 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `let bestStreak = 0` |
| 174 | `bestStreak` | calculate | summary.bestStreak | Projection best-streak counter | `bestStreak = Math.max(bestStreak, observed.currentStreak)` |
| 174 | `currentStreak` | calculate | users.currentStreak | Consecutive qualifying days | `bestStreak = Math.max(bestStreak, observed.currentStreak)` |
| 179 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `return { ...current, bestStreak }` |

#### `src/domain/gamification/types.test.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 28 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `expect(invalidationSourceTransitionId('reversal-1')).toBe('invalidation_v1\|reversal-1')` |
| 44 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `expect(invalidationSourceTransitionId('reversal-1')).not.toBe(` |
| 45 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `invalidationSourceTransitionId('reversal-2'),` |
| 54 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `() => invalidationSourceTransitionId('reversal\|1'),` |
| 104 | `level` | test | in-memory / derived | Member level | `schemaVersion: 1, familyId: 'family-1', childId: 'child-1', xpTotal: 25, level: 1,` |
| 104 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `schemaVersion: 1, familyId: 'family-1', childId: 'child-1', xpTotal: 25, level: 1,` |
| 105 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `currentStreak: 1, bestStreak: 1, perfectDayCount: 1, lastQualifiedDayKey: '2026-07-22',` |
| 105 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 1, bestStreak: 1, perfectDayCount: 1, lastQualifiedDayKey: '2026-07-22',` |

#### `src/domain/gamification/types.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 112 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `readonly xpTotal: number` |
| 114 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `readonly currentStreak: number` |
| 115 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `readonly bestStreak: number` |

#### `src/domain/gamification/xp.test.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 126 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `eventType: 'xp_revoked', xpDelta: -25, sourceId: 'reversal-1', idempotencyKey: taskXpReversalEventId(logicalKey),` |
| 127 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `causalEventId: taskXpEventId(logicalKey), causalGroupId: 'gamification_transition_v1\|invalidation_v1\|reversal-1', transitionRank: 1,` |

#### `src/domain/gamification/xp.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 74 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `let xpTotal = 0n` |
| 92 | `xpTotal` | calculate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal += BigInt(event.xpDelta)` |
| 95 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `if (xpTotal < 0n) throw new Error('XP ledger must not be negative')` |
| 96 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `if (xpTotal > BigInt(Number.MAX_SAFE_INTEGER)) {` |
| 99 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `return Number(xpTotal)` |

#### `src/help/HelpCenter.test.tsx` — MIGRATE · Phase 1-4 · risk Low

> Test rewritten against the V3 contract

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 38 | `level` | test | in-memory / derived | Member level | `await screen.findByRole('heading', { level: 2, name: 'Getting started' })` |
| 47 | `level` | test | in-memory / derived | Member level | `expect(await screen.findByRole('heading', { level: 1, name: 'Wallet' })).toBeInTheDocument();` |
| 69 | `level` | test | in-memory / derived | Member level | `expect(await screen.findByRole('heading', { level: 1, name: 'Money' })).toBeInTheDocument();` |
| 91 | `level` | test | in-memory / derived | Member level | `expect(await screen.findByRole('heading', { level: 1, name: 'Wallet' })).toBeInTheDocument();` |

#### `src/help/data/en/money.ts` — KEEP · n/a · risk Low

> Unclassified — review before Phase 1

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 271 | `leaderboard` | read | in-memory / derived | Leaderboard ordering | `'A shared fund for each family pet: budgets, donations from children, expenses, and a helper leaderboard.',` |
| 273 | `leaderboard` | read | in-memory / derived | Leaderboard ordering | `keywords: ['pet box', 'pet', 'fund', 'donation', 'expense', 'vet', 'budget', 'leaderboard', 'animal'],` |
| 290 | `leaderboard` | read | in-memory / derived | Leaderboard ordering | `'Parents add pets, set budgets, and record expenses. Children donate from their wallets — a donation is a request that needs parent approval, and their money is` |

#### `src/i18n/locales/en/dashboard.json` — KEEP · n/a · risk Low

> Translation keys and labels

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 79 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `"xpTotal": "Total XP",` |
| 81 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `"bestStreak": "Best Streak",` |
| 95 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `"xpTotal": "{{xp}} Total XP",` |
| 98 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `"xpToNextLevel": "{{xp}} XP to reach Level {{level}}",` |
| 99 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `"currentStreak": "Current Streak",` |
| 100 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `"bestStreak": "Best Streak",` |

#### `src/i18n/locales/en/family.json` — KEEP · n/a · risk Low

> Translation keys and labels

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 34 | `leaderboard` | read | in-memory / derived | Leaderboard ordering | `"subtitle": "Check back next week to see who won this week's leaderboard!"` |

#### `src/i18n/locales/en/funds.json` — KEEP · n/a · risk Low

> Translation keys and labels

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 9 | `leaderboard` | read | in-memory / derived | Leaderboard ordering | `"noContributions": "No contributions yet. Start helping out to appear on the leaderboard!",` |

#### `src/i18n/locales/en/profile.json` — KEEP · n/a · risk Low

> Translation keys and labels

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 13 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `"bestStreak": "Best Streak",` |

#### `src/i18n/locales/en/reversals.json` — KEEP · n/a · risk Low

> Translation keys and labels

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 45 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `"createsReversal": "This creates a linked reversal record. The original action will remain in history.",` |

#### `src/i18n/locales/tr/dashboard.json` — KEEP · n/a · risk Low

> Translation keys and labels

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 79 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `"xpTotal": "Toplam XP",` |
| 81 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `"bestStreak": "En İyi Seri",` |
| 95 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `"xpTotal": "{{xp}} Toplam XP",` |
| 98 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `"xpToNextLevel": "Seviye {{level}}'e ulaşmak için {{xp}} XP",` |
| 99 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `"currentStreak": "Mevcut Seri",` |
| 100 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `"bestStreak": "En İyi Seri",` |

#### `src/i18n/locales/tr/profile.json` — KEEP · n/a · risk Low

> Translation keys and labels

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 13 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `"bestStreak": "En İyi Seri",` |

#### `src/i18n/parentCore.i18n.test.tsx` — KEEP · n/a · risk Low

> Translation keys and labels

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 10 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `currentUser: { id: 'u1', familyId: 'f1', role: 'parent', displayName: 'Sam Smith', rewardPoints: 120 },` |
| 30 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `redeemReward: vi.fn(),` |
| 31 | `createChallenge` | test | in-memory / derived | Family challenge configuration | `createChallenge: vi.fn(),` |
| 32 | `claimChallenge` | test | in-memory / derived | Family challenge claim (RP + XP credit) | `claimChallenge: vi.fn(),` |
| 58 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `store.currentUser = { id: 'u1', familyId: 'f1', role: 'parent', displayName: 'Sam Smith', rewardPoints: 120 };` |

#### `src/i18n/phase2d.i18n.test.tsx` — KEEP · n/a · risk Low

> Translation keys and labels

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 17 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 96 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `'gamification.xpTotal': ˋ${options?.xp \|\| 0} Total XPˋ,` |
| 97 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `'gamification.currentStreak': 'Current Streak',` |
| 98 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `'gamification.bestStreak': 'Best Streak',` |
| 102 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `'gamification.xpTotal': ˋ${options?.xp \|\| 0} Toplam XPˋ,` |
| 103 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `'gamification.currentStreak': 'Mevcut Seri',` |
| 104 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `'gamification.bestStreak': 'En İyi Seri',` |
| 113 | `level` | test | in-memory / derived | Member level | `<span>{t('gamification.level', { level: summary.level })}</span>` |
| 114 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `<span>{t('gamification.xpTotal', { xp: summary.xpTotal })}</span>` |
| 115 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `<span>{t('gamification.currentStreak')}</span>` |
| 116 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `<span>{t('gamification.bestStreak')}</span>` |
| 160 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 307 | `leaderboard` | test | in-memory / derived | Leaderboard ordering | `screen.getByText('No contributions yet. Start helping out to appear on the leaderboard!'),` |
| 332 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `store.familyMembers = [{ id: 'c1', displayName: 'Kid', rewardPoints: 0, lifetimeXP: 0, currentStreak: 0, longestStreak: 0, avatarUrl: '' }];` |
| 332 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `store.familyMembers = [{ id: 'c1', displayName: 'Kid', rewardPoints: 0, lifetimeXP: 0, currentStreak: 0, longestStreak: 0, avatarUrl: '' }];` |
| 332 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `store.familyMembers = [{ id: 'c1', displayName: 'Kid', rewardPoints: 0, lifetimeXP: 0, currentStreak: 0, longestStreak: 0, avatarUrl: '' }];` |
| 332 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `store.familyMembers = [{ id: 'c1', displayName: 'Kid', rewardPoints: 0, lifetimeXP: 0, currentStreak: 0, longestStreak: 0, avatarUrl: '' }];` |
| 338 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 0,` |
| 339 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 340 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 341 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 374 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `store.familyMembers = [{ id: 'c1', displayName: 'Kid', rewardPoints: 0, lifetimeXP: 0, currentStreak: 0, longestStreak: 0, avatarUrl: '' }];` |
| 374 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `store.familyMembers = [{ id: 'c1', displayName: 'Kid', rewardPoints: 0, lifetimeXP: 0, currentStreak: 0, longestStreak: 0, avatarUrl: '' }];` |
| 374 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `store.familyMembers = [{ id: 'c1', displayName: 'Kid', rewardPoints: 0, lifetimeXP: 0, currentStreak: 0, longestStreak: 0, avatarUrl: '' }];` |
| 374 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `store.familyMembers = [{ id: 'c1', displayName: 'Kid', rewardPoints: 0, lifetimeXP: 0, currentStreak: 0, longestStreak: 0, avatarUrl: '' }];` |
| 380 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 0,` |
| 381 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 382 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 383 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |

#### `src/lib/achievements.test.ts` — DERIVE · Phase 4 · risk Medium

> Badge unlocking becomes reducer-derived; UI keeps labels only

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 11 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 0,` |
| 12 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 13 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 0,` |
| 18 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('unlocks XP badges from projection xpTotal even when users.lifetimeXP is stale', () => {` |
| 18 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `it('unlocks XP badges from projection xpTotal even when users.lifetimeXP is stale', () => {` |
| 19 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const stale = { xpTotal: 5200, rewardPoints: 0, longestStreak: 0, lifetimeXP: 0 } as AchievementInput;` |
| 19 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `const stale = { xpTotal: 5200, rewardPoints: 0, longestStreak: 0, lifetimeXP: 0 } as AchievementInput;` |
| 19 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const stale = { xpTotal: 5200, rewardPoints: 0, longestStreak: 0, lifetimeXP: 0 } as AchievementInput;` |
| 19 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const stale = { xpTotal: 5200, rewardPoints: 0, longestStreak: 0, lifetimeXP: 0 } as AchievementInput;` |
| 25 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('does not unlock XP badges from stale users.lifetimeXP alone', () => {` |
| 26 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const legacyOnly = { xpTotal: 0, rewardPoints: 0, longestStreak: 0, lifetimeXP: 9999 } as AchievementInput;` |
| 26 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `const legacyOnly = { xpTotal: 0, rewardPoints: 0, longestStreak: 0, lifetimeXP: 9999 } as AchievementInput;` |
| 26 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const legacyOnly = { xpTotal: 0, rewardPoints: 0, longestStreak: 0, lifetimeXP: 9999 } as AchievementInput;` |
| 26 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const legacyOnly = { xpTotal: 0, rewardPoints: 0, longestStreak: 0, lifetimeXP: 9999 } as AchievementInput;` |
| 32 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `it('keeps the reward-points badge on spendable rewardPoints', () => {` |
| 33 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(badge('wealthy').checkUnlocked(input({ rewardPoints: 500, xpTotal: 0 }))).toBe(true);` |
| 33 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(badge('wealthy').checkUnlocked(input({ rewardPoints: 500, xpTotal: 0 }))).toBe(true);` |
| 34 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(badge('wealthy').checkUnlocked(input({ rewardPoints: 499, xpTotal: 99999 }))).toBe(false);` |
| 34 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(badge('wealthy').checkUnlocked(input({ rewardPoints: 499, xpTotal: 99999 }))).toBe(false);` |
| 38 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const parent = input({ xpTotal: 9000, rewardPoints: 999 });` |
| 38 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const parent = input({ xpTotal: 9000, rewardPoints: 999 });` |
| 39 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const child = input({ xpTotal: 100, rewardPoints: 10 });` |
| 39 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const child = input({ xpTotal: 100, rewardPoints: 10 });` |
| 46 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `const missing = { xpTotal: 0, rewardPoints: 0, longestStreak: 0 } as AchievementInput;` |
| 46 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const missing = { xpTotal: 0, rewardPoints: 0, longestStreak: 0 } as AchievementInput;` |
| 46 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const missing = { xpTotal: 0, rewardPoints: 0, longestStreak: 0 } as AchievementInput;` |
| 51 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `it('leaves streak badges on longestStreak', () => {` |
| 52 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `expect(badge('streak_starter').checkUnlocked(input({ longestStreak: 3 }))).toBe(true);` |
| 53 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `expect(badge('streak_master').checkUnlocked(input({ longestStreak: 6 }))).toBe(false);` |
| 54 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `expect(badge('streak_master').checkUnlocked(input({ longestStreak: 7 }))).toBe(true);` |

#### `src/lib/achievements.ts` — DERIVE · Phase 4 · risk Medium

> Badge unlocking becomes reducer-derived; UI keeps labels only

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 5 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `* ˋxpTotalˋ MUST come from the gamification projection` |
| 6 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `* (families/{familyId}/gamification_summaries/{memberId}.xpTotal), resolved via` |
| 6 | `xpTotal` | read | families/{f}/gamification_summaries | Projection lifetime XP counter (authoritative today) | `* (families/{familyId}/gamification_summaries/{memberId}.xpTotal), resolved via` |
| 7 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `* ˋresolveProgressionˋ. ˋusers/{id}.lifetimeXPˋ is legacy and must never be read` |
| 8 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `* here. ˋrewardPointsˋ remains the spendable currency balance.` |
| 11 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: number;` |
| 12 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: number;` |
| 13 | `longestStreak` | read | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak?: number;` |
| 32 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `checkUnlocked: (input) => (input.xpTotal \|\| 0) >= 50` |
| 40 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `checkUnlocked: (input) => (input.xpTotal \|\| 0) >= 1000` |
| 48 | `longestStreak` | read | users.longestStreak | Legacy best-streak counter on the user doc | `checkUnlocked: (input) => (input.longestStreak \|\| 0) >= 3` |
| 56 | `longestStreak` | read | users.longestStreak | Legacy best-streak counter on the user doc | `checkUnlocked: (input) => (input.longestStreak \|\| 0) >= 7` |
| 64 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `checkUnlocked: (input) => (input.rewardPoints \|\| 0) >= 500` |
| 72 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `checkUnlocked: (input) => (input.xpTotal \|\| 0) >= 5000` |

#### `src/lib/api.approvals.test.ts` — MIGRATE · Phase 3 · risk High

> Client gamification writes become callable commands

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 47 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `'users/child-1': { familyId: 'family-1', role: 'child', rewardPoints: 5, lifetimeXP: 20 },` |
| 47 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `'users/child-1': { familyId: 'family-1', role: 'child', rewardPoints: 5, lifetimeXP: 20 },` |

#### `src/lib/api.behaviour.test.ts` — MIGRATE · Phase 3 · risk High

> Client gamification writes become callable commands

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 59 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `'users/child-1': { familyId: 'family-1', role: 'child', displayName: 'Ada', rewardPoints: 10, lifetimeXP: 100, walletBalance: 0 },` |
| 59 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `'users/child-1': { familyId: 'family-1', role: 'child', displayName: 'Ada', rewardPoints: 10, lifetimeXP: 100, walletBalance: 0 },` |
| 78 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `const eventWrite = transaction.set.mock.calls.find(([ref]) => ref.path.includes('/behaviour_events/'))?.[1]` |
| 107 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `const eventWrite = transaction.set.mock.calls.find(([ref]) => ref.path.includes('/behaviour_events/'))?.[1]` |
| 125 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `const eventWrite = transaction.set.mock.calls.find(([ref]) => ref.path.includes('/behaviour_events/'))?.[1]` |

#### `src/lib/api.managedChildOwnership.test.ts` — MIGRATE · Phase 3 · risk High

> Client gamification writes become callable commands

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 10 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `// Before the fix, ownership comparisons in completeTask, redeemReward,` |
| 75 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `redeemReward,` |
| 114 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'Muhammed', rewardPoints: 0, lifetimeXP: 0, lastActiveDate: null },` |
| 114 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'Muhammed', rewardPoints: 0, lifetimeXP: 0, lastActiveDate: null },` |
| 128 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `describe('redeemReward', () => {` |
| 133 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `'users/child-1': { familyId: 'fam1', role: 'child', rewardPoints: 100, lifetimeXP: 0 },` |
| 133 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `'users/child-1': { familyId: 'fam1', role: 'child', rewardPoints: 100, lifetimeXP: 0 },` |
| 135 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `await redeemReward('fam1', CHILD_FIRESTORE_ID, 'reward-1')` |
| 140 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `await expect(redeemReward('fam1', 'child-2', 'reward-1'))` |
| 150 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'Muhammed', rewardPoints: 0, lifetimeXP: 0 },` |
| 150 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'Muhammed', rewardPoints: 0, lifetimeXP: 0 },` |
| 166 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'Muhammed', rewardPoints: 0, lifetimeXP: 0 },` |
| 166 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'Muhammed', rewardPoints: 0, lifetimeXP: 0 },` |
| 177 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'Muhammed', rewardPoints: 0, lifetimeXP: 0 },` |
| 177 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'Muhammed', rewardPoints: 0, lifetimeXP: 0 },` |
| 194 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'Muhammed', rewardPoints: 0, lifetimeXP: 0 },` |
| 194 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'Muhammed', rewardPoints: 0, lifetimeXP: 0 },` |
| 203 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'Muhammed', rewardPoints: 0, lifetimeXP: 0 },` |
| 203 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'Muhammed', rewardPoints: 0, lifetimeXP: 0 },` |

#### `src/lib/api.profileUpdate.test.ts` — MIGRATE · Phase 3 · risk High

> Client gamification writes become callable commands

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 38 | `unlockAvatar` | test | in-memory / derived | Avatar unlock (RP debit) | `unlockAvatar,` |
| 300 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `'users/child-1': { familyId: 'family-1', role: 'child', displayName: 'Muhammed', rewardPoints: 500 },` |
| 303 | `unlockAvatar` | test | in-memory / derived | Avatar unlock (RP debit) | `const cost = await unlockAvatar('family-1', PREMIUM)` |
| 307 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `{ rewardPoints: 350 },` |
| 317 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `'users/child-1': { familyId: 'family-1', role: 'child', displayName: 'Muhammed', rewardPoints: 100 },` |
| 320 | `unlockAvatar` | test | in-memory / derived | Avatar unlock (RP debit) | `await expect(unlockAvatar('family-1', PREMIUM)).rejects.toThrow(/more points/i)` |
| 325 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `'users/child-1': { familyId: 'family-1', role: 'child', displayName: 'Muhammed', rewardPoints: 500 },` |
| 328 | `unlockAvatar` | test | in-memory / derived | Avatar unlock (RP debit) | `await expect(unlockAvatar('family-1', PREMIUM)).rejects.toThrow(/already own/i)` |
| 333 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `'users/child-1': { familyId: 'family-1', role: 'child', displayName: 'Muhammed', rewardPoints: 500 },` |
| 335 | `unlockAvatar` | test | in-memory / derived | Avatar unlock (RP debit) | `await expect(unlockAvatar('family-1', STARTER)).rejects.toThrow(/already free/i)` |
| 345 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `avatarUrl: 'https://old', avatarId: 'starter-cat', rewardPoints: 500,` |

#### `src/lib/api.tasks.test.ts` — MIGRATE · Phase 3 · risk High

> Client gamification writes become callable commands

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 39 | `claimChallenge` | test | in-memory / derived | Family challenge claim (RP + XP credit) | `import { createTask, createReward, claimChallenge } from './api'` |
| 118 | `claimChallenge` | test | in-memory / derived | Family challenge claim (RP + XP credit) | `describe('claimChallenge (completeChallenge) feed actor', () => {` |
| 127 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `get: vi.fn(async () => ({ exists: () => true, data: () => ({ isActive: true, rewardPoints: 0, lifetimeXP: 0 }) })),` |
| 127 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `get: vi.fn(async () => ({ exists: () => true, data: () => ({ isActive: true, rewardPoints: 0, lifetimeXP: 0 }) })),` |
| 135 | `claimChallenge` | test | in-memory / derived | Family challenge claim (RP + XP credit) | `// E. claimChallenge uses the authenticated actor` |
| 139 | `claimChallenge` | test | in-memory / derived | Family challenge claim (RP + XP credit) | `await claimChallenge('family-1', 'challenge-1', 50, ['child-1'], 'Read a book')` |
| 148 | `claimChallenge` | test | in-memory / derived | Family challenge claim (RP + XP credit) | `// E. claimChallenge does not leave partial primary records when the feed fails` |
| 152 | `claimChallenge` | test | in-memory / derived | Family challenge claim (RP + XP credit) | `await expect(claimChallenge('family-1', 'challenge-1', 50, ['child-1'], 'Read a book')).rejects.toThrow(/permission-denied/)` |
| 158 | `claimChallenge` | test | in-memory / derived | Family challenge claim (RP + XP credit) | `await expect(claimChallenge('family-1', 'challenge-1', 50, ['child-1'], 'Read a book')).rejects.toThrow(/Authentication required/)` |

#### `src/lib/api.transactionOrder.test.ts` — MIGRATE · Phase 3 · risk High

> Client gamification writes become callable commands

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 67 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `redeemReward,` |
| 114 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const childUser = { familyId: 'family-1', role: 'child', displayName: 'Muhammed', rewardPoints: 500 }` |
| 240 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `it('redeemReward keeps reads before writes', async () => {` |
| 245 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `await redeemReward('family-1', 'child-1', 'r1')` |

#### `src/lib/api.ts` — MIGRATE · Phase 3 · risk High

> Client gamification writes become callable commands

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 108 | `rewardPoints` | initialise | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 109 | `lifetimeXP` | initialise | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 0,` |
| 110 | `currentStreak` | initialise | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 111 | `longestStreak` | initialise | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 0,` |
| 361 | `rewardPoints` | initialise | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 362 | `lifetimeXP` | initialise | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 0,` |
| 363 | `currentStreak` | initialise | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 364 | `longestStreak` | initialise | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 0,` |
| 438 | `rewardPoints` | initialise | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 439 | `lifetimeXP` | initialise | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 0,` |
| 440 | `currentStreak` | initialise | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 441 | `longestStreak` | initialise | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 0,` |
| 639 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `let newCurrentStreak = userData.currentStreak \|\| 0;` |
| 640 | `longestStreak` | read | users.longestStreak | Legacy best-streak counter on the user doc | `let newLongestStreak = userData.longestStreak \|\| 0;` |
| 655 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `let finalRewardPoints = userData.rewardPoints \|\| 0;` |
| 656 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `let finalLifetimeXP = userData.lifetimeXP \|\| 0;` |
| 686 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `currentStreak: newCurrentStreak,` |
| 687 | `longestStreak` | read | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: newLongestStreak,` |
| 824 | `behaviour_events` | read | families/{f}/behaviour_events | Behaviour intent log | `const eventRef = doc(collection(db, ˋfamilies/${familyId}/behaviour_eventsˋ));` |
| 866 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: child.rewardPoints ?? 0,` |
| 867 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: child.lifetimeXP ?? 0,` |
| 875 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `// writes gamification_summaries.xpTotal and the immutable gamification` |
| 875 | `xpTotal` | read | families/{f}/gamification_summaries | Projection lifetime XP counter (authoritative today) | `// writes gamification_summaries.xpTotal and the immutable gamification` |
| 956 | `createChallenge` | read | in-memory / derived | Family challenge configuration | `export const createChallenge = async (familyId: string, title: string, targetXP: number, rewardPoints: number, startXP: number) => {` |
| 956 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `export const createChallenge = async (familyId: string, title: string, targetXP: number, rewardPoints: number, startXP: number) => {` |
| 960 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints,` |
| 967 | `claimChallenge` | read | in-memory / derived | Family challenge claim (RP + XP credit) | `export const claimChallenge = async (familyId: string, challengeId: string, rewardPoints: number, childrenIds: string[], challengeTitle: string) => {` |
| 967 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `export const claimChallenge = async (familyId: string, challengeId: string, rewardPoints: number, childrenIds: string[], challengeTitle: string) => {` |
| 985 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: (userDoc.data().rewardPoints \|\| 0) + rewardPoints,` |
| 986 | `lifetimeXP` | calculate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: (userDoc.data().lifetimeXP \|\| 0) + rewardPoints` |
| 986 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `lifetimeXP: (userDoc.data().lifetimeXP \|\| 0) + rewardPoints` |
| 994 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `text: ˋFamily Challenge Completed: ${challengeTitle}! Everyone got +${rewardPoints} pts!ˋ,` |
| 1004 | `redeemReward` | read | in-memory / derived | Reward redemption (RP debit) | `export const redeemReward = async (familyId: string, userId: string, rewardId: string) => {` |
| 1023 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `const currentPoints = userDoc.data().rewardPoints \|\| 0;` |
| 1047 | `rewardPoints` | write | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: currentPoints - cost,` |
| 1084 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `const currentPoints = userDoc.data().rewardPoints \|\| 0;` |
| 1085 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const currentXP = userDoc.data().lifetimeXP \|\| 0;` |
| 1088 | `rewardPoints` | write | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: currentPoints + points,` |
| 1089 | `lifetimeXP` | write | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: currentXP + points` |
| 3054 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `*  6. The exact point cost is deducted from ˋrewardPointsˋ.` |
| 3061 | `unlockAvatar` | read | in-memory / derived | Avatar unlock (RP debit) | `export const unlockAvatar = async (familyId: string, avatarId: string): Promise<number> => {` |
| 3084 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `const currentPoints = userData.rewardPoints \|\| 0;` |
| 3089 | `rewardPoints` | write | users.rewardPoints | Spendable Reward Points balance (RP) | `transaction.update(userRef, { rewardPoints: currentPoints - cost });` |

#### `src/lib/behaviour.test.ts` — REMOVE · Phase 3 · risk High

> Client-side balance maths duplicated server-side

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 52 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const balances = { rewardPoints: 10, lifetimeXP: 100, walletBalance: 0 }` |
| 52 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const balances = { rewardPoints: 10, lifetimeXP: 100, walletBalance: 0 }` |
| 59 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `)).toEqual({ rewardPoints: 35, lifetimeXP: 125, walletBalance: 0, pointsDelta: 25, walletDelta: 0 })` |
| 59 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `)).toEqual({ rewardPoints: 35, lifetimeXP: 125, walletBalance: 0, pointsDelta: 25, walletDelta: 0 })` |
| 67 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `)).toEqual({ rewardPoints: 0, lifetimeXP: 100, walletBalance: 0, pointsDelta: -10, walletDelta: 0 })` |
| 67 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `)).toEqual({ rewardPoints: 0, lifetimeXP: 100, walletBalance: 0, pointsDelta: -10, walletDelta: 0 })` |
| 75 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `)).toEqual({ rewardPoints: 10, lifetimeXP: 100, walletBalance: -5000, pointsDelta: 0, walletDelta: -1500 })` |
| 75 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `)).toEqual({ rewardPoints: 10, lifetimeXP: 100, walletBalance: -5000, pointsDelta: 0, walletDelta: -1500 })` |

#### `src/lib/behaviour.ts` — REMOVE · Phase 3 · risk High

> Client-side balance maths duplicated server-side

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 11 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: number` |
| 12 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: number` |
| 61 | `rewardPoints` | write | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: balances.rewardPoints + input.pointsDelta,` |
| 62 | `lifetimeXP` | write | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: balances.lifetimeXP + input.pointsDelta,` |
| 70 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `const rewardPoints = Math.max(0, balances.rewardPoints + input.pointsDelta)` |
| 72 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints,` |
| 73 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: balances.lifetimeXP,` |
| 75 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `pointsDelta: rewardPoints - balances.rewardPoints,` |
| 86 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: balances.rewardPoints,` |
| 87 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: balances.lifetimeXP,` |

#### `src/lib/bootstrapQueries.ts` — REMOVE · Phase 4 · risk Medium

> Direct summaries query replaced by the single reader

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 267 | `behaviour_events` | read | families/{f}/behaviour_events | Behaviour intent log | `{ resource: 'behaviourEvents', key: 'behaviourEvents', kind: 'query', target: collection(db, ˋ${familyPath}/behaviour_eventsˋ) },` |
| 280 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `{ resource: 'gamificationSummaries', key: 'gamificationSummaries', kind: 'query', target: collection(db, ˋ${familyPath}/gamification_summariesˋ) },` |
| 288 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `{ resource: 'gamificationSummaries', key: 'gamificationSummaries', kind: 'document', target: doc(db, ˋ${familyPath}/gamification_summaries/${userId}ˋ) },` |

#### `src/lib/gamificationAdapters.test.ts` — MIGRATE · Phase 1-4 · risk Low

> Test rewritten against the V3 contract

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 2 | `levelFromXp` | test | in-memory / derived | Duplicate level formula | `import { adaptGamificationSummary, levelFromXp, xpProgressInLevel } from './gamificationAdapters';` |
| 2 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `import { adaptGamificationSummary, levelFromXp, xpProgressInLevel } from './gamificationAdapters';` |
| 10 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 0,` |
| 11 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 12 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 1000,` |
| 13 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 0,` |
| 14 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 15 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 34 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 5000,` |
| 35 | `level` | test | in-memory / derived | Member level | `level: 5,` |
| 36 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 3,` |
| 37 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 10,` |
| 56 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 5000,` |
| 57 | `level` | test | in-memory / derived | Member level | `level: 5,` |
| 58 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 3,` |
| 59 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 10,` |
| 73 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `it('computes level and XP progress from xpTotal', () => {` |
| 78 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 2500,` |
| 79 | `level` | test | in-memory / derived | Member level | `level: 3,` |
| 80 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 2,` |
| 81 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 5,` |
| 92 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(result.xpTotal).toBe(2500);` |
| 94 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `expect(result.xpProgressInLevel).toBe(500);` |
| 95 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `expect(result.xpToNextLevel).toBe(500);` |
| 104 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1500,` |
| 105 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 106 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 1,` |
| 107 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 3,` |
| 148 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1000,` |
| 149 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 150 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 151 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 167 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `it('handles level 1 correctly (xpTotal < XP_PER_LEVEL)', () => {` |
| 172 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 100,` |
| 173 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 174 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 175 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 187 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `expect(result.xpProgressInLevel).toBe(100);` |
| 188 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `expect(result.xpToNextLevel).toBe(900);` |
| 196 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1000,` |
| 197 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 198 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 199 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 210 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `expect(result.xpProgressInLevel).toBe(0);` |
| 211 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `expect(result.xpToNextLevel).toBe(1000);` |
| 215 | `levelFromXp` | test | in-memory / derived | Duplicate level formula | `describe('levelFromXp', () => {` |
| 217 | `levelFromXp` | test | in-memory / derived | Duplicate level formula | `expect(levelFromXp(0)).toBe(1);` |
| 221 | `levelFromXp` | test | in-memory / derived | Duplicate level formula | `expect(levelFromXp(999)).toBe(1);` |
| 225 | `levelFromXp` | test | in-memory / derived | Duplicate level formula | `expect(levelFromXp(1000)).toBe(2);` |
| 229 | `levelFromXp` | test | in-memory / derived | Duplicate level formula | `expect(levelFromXp(2500)).toBe(3);` |
| 230 | `levelFromXp` | test | in-memory / derived | Duplicate level formula | `expect(levelFromXp(5000)).toBe(6);` |
| 234 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `describe('xpProgressInLevel', () => {` |
| 236 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `expect(xpProgressInLevel(1000)).toBe(0);` |
| 237 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `expect(xpProgressInLevel(2000)).toBe(0);` |
| 241 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `expect(xpProgressInLevel(1500)).toBe(500);` |
| 242 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `expect(xpProgressInLevel(2500)).toBe(500);` |
| 246 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `expect(xpProgressInLevel(500)).toBe(500);` |

#### `src/lib/gamificationAdapters.ts` — REMOVE · Phase 4 · risk High

> Legacy fallback + duplicate formulas — absorbed by the projection reducer

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 3 | `levelProgressForXp` | calculate | in-memory / derived | Canonical level formula | `import { levelProgressForXp } from '../domain/gamification/level'` |
| 10 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `readonly xpTotal: number` |
| 12 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `readonly xpToNextLevel: number` |
| 13 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `readonly xpProgressInLevel: number` |
| 14 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `readonly currentStreak: number` |
| 15 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `readonly bestStreak: number` |
| 34 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `* - Computes level progress and XP to next level from xpTotal` |
| 44 | `xpTotal` | initialise | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 0,` |
| 45 | `level` | read | in-memory / derived | Member level | `level: 1,` |
| 46 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: XP_PER_LEVEL,` |
| 47 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 0,` |
| 48 | `currentStreak` | initialise | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 49 | `bestStreak` | initialise | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 59 | `xpProgressInLevel` | calculate | summary.xpProgressInLevel | XP accumulated inside the current level | `const xpProgressInLevel = summary.xpTotal % XP_PER_LEVEL` |
| 59 | `xpTotal` | calculate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const xpProgressInLevel = summary.xpTotal % XP_PER_LEVEL` |
| 60 | `xpProgressInLevel` | calculate | summary.xpProgressInLevel | XP accumulated inside the current level | `const xpToNextLevel = XP_PER_LEVEL - xpProgressInLevel` |
| 60 | `xpToNextLevel` | calculate | summary.xpToNextLevel | XP remaining until the next level | `const xpToNextLevel = XP_PER_LEVEL - xpProgressInLevel` |
| 63 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: summary.xpTotal,` |
| 64 | `level` | read | in-memory / derived | Member level | `level: summary.level,` |
| 65 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel,` |
| 66 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel,` |
| 67 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `currentStreak: summary.currentStreak,` |
| 68 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `bestStreak: summary.bestStreak,` |
| 82 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `* derive the progression from the member's authoritative ˋlifetimeXPˋ balance` |
| 88 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `readonly xpTotal: number` |
| 90 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `readonly xpProgressInLevel: number` |
| 91 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `readonly xpToNextLevel: number` |
| 99 | `lifetimeXP` | calculate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `* TODO(gamification-legacy-fallback): the ˋmember.lifetimeXPˋ fallback below is a` |
| 102 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `* ˋfamilies/{familyId}/gamification_summaries/{memberId}ˋ — verified by a full` |
| 107 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `* @param member   Member record providing the ˋlifetimeXPˋ fallback.` |
| 111 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `member: { lifetimeXP?: number \| null } \| null \| undefined,` |
| 116 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const rawXp = projectionUsable ? Number(summary!.xpTotal) : Number(member?.lifetimeXP)` |
| 116 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const rawXp = projectionUsable ? Number(summary!.xpTotal) : Number(member?.lifetimeXP)` |
| 117 | `levelProgressForXp` | calculate | in-memory / derived | Canonical level formula | `// ˋlevelProgressForXpˋ (the canonical formula) requires a non-negative safe` |
| 119 | `xpTotal` | calculate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const xpTotal = Number.isFinite(rawXp) ? Math.max(0, Math.floor(rawXp)) : 0` |
| 122 | `levelProgressForXp` | read | in-memory / derived | Canonical level formula | `// projection use (ˋlevelForXpˋ / ˋlevelProgressForXpˋ with the config's` |
| 124 | `levelProgressForXp` | read | in-memory / derived | Canonical level formula | `const progress = levelProgressForXp(xpTotal, XP_PER_LEVEL)` |
| 124 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const progress = levelProgressForXp(xpTotal, XP_PER_LEVEL)` |
| 128 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal,` |
| 129 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `lifetimeXp: xpTotal,` |
| 130 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: progress.xpIntoLevel,` |
| 131 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: progress.xpToNextLevel,` |
| 143 | `longestStreak` | read | users.longestStreak | Legacy best-streak counter on the user doc | `* unlocked from a stale legacy ˋlongestStreakˋ while the card shows 0.` |
| 148 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `readonly currentStreak: number` |
| 149 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `readonly bestStreak: number` |
| 160 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `member: { currentStreak?: number \| null; longestStreak?: number \| null } \| null \| undefined,` |
| 160 | `longestStreak` | read | users.longestStreak | Legacy best-streak counter on the user doc | `member: { currentStreak?: number \| null; longestStreak?: number \| null } \| null \| undefined,` |
| 167 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `currentStreak: nonNegativeInteger(summary!.currentStreak),` |
| 168 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `bestStreak: nonNegativeInteger(summary!.bestStreak),` |
| 173 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `currentStreak: nonNegativeInteger(member?.currentStreak),` |
| 174 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `bestStreak: nonNegativeInteger(member?.longestStreak),` |
| 174 | `longestStreak` | read | users.longestStreak | Legacy best-streak counter on the user doc | `bestStreak: nonNegativeInteger(member?.longestStreak),` |
| 181 | `levelProgressForXp` | read | in-memory / derived | Canonical level formula | `* Thin wrapper over the canonical {@link levelProgressForXp} helper.` |
| 183 | `levelFromXp` | read | in-memory / derived | Duplicate level formula | `export function levelFromXp(xpTotal: number): number {` |
| 183 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `export function levelFromXp(xpTotal: number): number {` |
| 184 | `levelProgressForXp` | read | in-memory / derived | Canonical level formula | `return levelProgressForXp(xpTotal, XP_PER_LEVEL).level` |
| 184 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `return levelProgressForXp(xpTotal, XP_PER_LEVEL).level` |
| 190 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `export function xpProgressInLevel(xpTotal: number): number {` |
| 190 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `export function xpProgressInLevel(xpTotal: number): number {` |
| 191 | `xpTotal` | calculate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `return xpTotal % XP_PER_LEVEL` |

#### `src/lib/gamificationProgression.test.ts` — REMOVE · Phase 4 · risk Medium

> Progression resolution moves into the reducer

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 8 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 2500,` |
| 9 | `level` | test | in-memory / derived | Member level | `level: 3,` |
| 10 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 1,` |
| 11 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 2,` |
| 24 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `expect(resolveProgression(null, { lifetimeXP: 2500 })).toEqual({` |
| 25 | `level` | test | in-memory / derived | Member level | `level: 3,` |
| 26 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 2500,` |
| 28 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 500,` |
| 29 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 500,` |
| 37 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `expect(resolveProgression(rebuilding, { lifetimeXP: 1000 }).source).toBe('derived')` |
| 38 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `expect(resolveProgression(rebuilding, { lifetimeXP: 1000 }).level).toBe(2)` |
| 42 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `expect(resolveProgression(projection, { lifetimeXP: 0 })).toEqual({` |
| 43 | `level` | test | in-memory / derived | Member level | `level: 3,` |
| 44 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 2500,` |
| 46 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 500,` |
| 47 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 500,` |
| 55 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 56 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 0,` |
| 58 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 0,` |
| 59 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 1000,` |

#### `src/lib/gamificationStreaks.test.ts` — REMOVE · Phase 4 · risk Medium

> Streak resolution moves into the reducer

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 9 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 0,` |
| 10 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 11 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 12 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 25 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `expect(resolveStreaks(ready, { currentStreak: 3, longestStreak: 3 })).toEqual({` |
| 25 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `expect(resolveStreaks(ready, { currentStreak: 3, longestStreak: 3 })).toEqual({` |
| 26 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 27 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 33 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `expect(resolveStreaks({ ...ready, currentStreak: 3, bestStreak: 4 }, { longestStreak: 0 })).toEqual({` |
| 33 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `expect(resolveStreaks({ ...ready, currentStreak: 3, bestStreak: 4 }, { longestStreak: 0 })).toEqual({` |
| 33 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `expect(resolveStreaks({ ...ready, currentStreak: 3, bestStreak: 4 }, { longestStreak: 0 })).toEqual({` |
| 34 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 3,` |
| 35 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 4,` |
| 41 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `expect(resolveStreaks(null, { currentStreak: 1, longestStreak: 3 })).toEqual({` |
| 41 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `expect(resolveStreaks(null, { currentStreak: 1, longestStreak: 3 })).toEqual({` |
| 42 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 1,` |
| 43 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 3,` |
| 46 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `expect(resolveStreaks({ ...ready, rebuildRequired: true }, { longestStreak: 3 }).source).toBe('legacy')` |
| 47 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `expect(resolveStreaks({ ...ready, projectionStatus: 'rebuilding' }, { longestStreak: 3 }).source).toBe('legacy')` |
| 51 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `expect(resolveStreaks(null, { currentStreak: -4, longestStreak: 2.7 })).toEqual({` |
| 51 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `expect(resolveStreaks(null, { currentStreak: -4, longestStreak: 2.7 })).toEqual({` |
| 52 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 53 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 2,` |

#### `src/lib/googleRedirectAuth.ts` — MIGRATE · Phase 3 · risk Medium

> Member bootstrap stops seeding gamification fields

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 29 | `rewardPoints` | initialise | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 30 | `lifetimeXP` | initialise | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 0,` |
| 31 | `currentStreak` | initialise | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 32 | `longestStreak` | initialise | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 0,` |

#### `src/lib/notifications.api.test.ts` — KEEP · Phase 4 · risk Low

> Notification copy only

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 45 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `redeemReward,` |
| 102 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'Muhammed', rewardPoints: 0, lifetimeXP: 0, lastActiveDate: null },` |
| 102 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'Muhammed', rewardPoints: 0, lifetimeXP: 0, lastActiveDate: null },` |
| 120 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `'users/child-1': { familyId: 'fam1', role: 'child', rewardPoints: 5, lifetimeXP: 0 },` |
| 120 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `'users/child-1': { familyId: 'fam1', role: 'child', rewardPoints: 5, lifetimeXP: 0 },` |
| 154 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'Muhammed', rewardPoints: 100 },` |
| 156 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `await redeemReward('fam1', 'child-1', 'r1');` |
| 169 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'C1', rewardPoints: 0, lifetimeXP: 0 },` |
| 169 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'C1', rewardPoints: 0, lifetimeXP: 0 },` |
| 186 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'C1', rewardPoints: 0, lifetimeXP: 0 },` |
| 186 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'C1', rewardPoints: 0, lifetimeXP: 0 },` |
| 359 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'Muhammed', rewardPoints: 0, lifetimeXP: 0, lastActiveDate: null },` |
| 359 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'Muhammed', rewardPoints: 0, lifetimeXP: 0, lastActiveDate: null },` |
| 374 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `'users/child-2': { familyId: 'fam1', role: 'child', displayName: 'Osman', rewardPoints: 0, lifetimeXP: 0, lastActiveDate: null },` |
| 374 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `'users/child-2': { familyId: 'fam1', role: 'child', displayName: 'Osman', rewardPoints: 0, lifetimeXP: 0, lastActiveDate: null },` |
| 385 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `'users/child-1': { familyId: 'fam1', role: 'child', rewardPoints: 5, lifetimeXP: 0 },` |
| 385 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `'users/child-1': { familyId: 'fam1', role: 'child', rewardPoints: 5, lifetimeXP: 0 },` |

#### `src/lib/reversalApi.test.ts` — MIGRATE · Phase 3 · risk High

> Direct balance write becomes a REVERSAL ledger event

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 25 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `describe('reversal API dispatcher', () => {` |
| 33 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `'wallet_transactions', 'fund_transactions', 'behaviour_events', 'task_completions',` |
| 53 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `type: 'reversal', reversalId, sourceId: 'source-1', amountPence: -300, actorId: 'parent-1',` |
| 110 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `// Wallet reversal ledger entry` |
| 113 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `expect.objectContaining({ type: 'reversal', reversalId, sourceId: 'pet-1', amountPence: 200, actorId: 'parent-1' })` |
| 115 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `// Fund reversal ledger entry` |
| 118 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `expect.objectContaining({ type: 'reversal', reversalId, sourceId: 'pet-1', amount: -200, actorId: 'parent-1' })` |

#### `src/lib/reversalApi.ts` — MIGRATE · Phase 3 · risk High

> Direct balance write becomes a REVERSAL ledger event

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 15 | `behaviour_events` | read | families/{f}/behaviour_events | Behaviour intent log | `behaviour_event: 'behaviour_events',` |
| 27 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `if (!collectionName) throw new Error(ˋUnsupported reversal source kind: ${kind}ˋ)` |
| 45 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `entityType: 'reversal', familyId: source.familyId, actorId,` |
| 104 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `points: pointsUserDoc?.exists() ? pointsUserDoc.data().rewardPoints : undefined,` |
| 116 | `rewardPoints` | write | users.rewardPoints | Spendable Reward Points balance (RP) | `if (pointsUserRef) transaction.update(pointsUserRef, { rewardPoints: plan.points, lastReversalId: reversalId })` |

#### `src/lib/reversalContracts.test.ts` — MIGRATE · Phase 1-4 · risk Low

> Test rewritten against the V3 contract

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 4 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `describe('reversal source contracts', () => {` |

#### `src/lib/reversalDomain.test.ts` — MIGRATE · Phase 1-4 · risk Low

> Test rewritten against the V3 contract

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 7 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `describe('reversal domain', () => {` |
| 21 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('rejects a reversal that would breach wallet debt or points sufficiency, but permits a negative fund balance', () => {` |
| 24 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `// A fund reversal may legitimately drive the balance negative (parents pay real` |

#### `src/lib/reversalDomain.ts` — KEEP · n/a · risk Low

> Unclassified — review before Phase 1

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 41 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `// their own money and children later cover the deficit, so a reversal must` |

#### `src/lib/reversalHistory.test.ts` — MIGRATE · Phase 3 · risk High

> Client gamification writes become callable commands

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 13 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `describe('reversal history normalization', () => {` |
| 14 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('builds a signed wallet reversal preview for a traceable completed source', () => {` |
| 23 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('uses Refund for debit-like sources and joins immutable reversal metadata', () => {` |
| 29 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `expect(reversed.reversal).toMatchObject({ reason: 'Duplicate', actorName: 'Owner' });` |
| 30 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `expect(reversed.reversal.occurredAt).toBe(completedAt);` |
| 34 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('hides legacy, unsupported, child, and reversal-ledger actions', () => {` |
| 38 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `expect(normalizeHistoryAction({ ...base, actor: parent, source: { id: 'reverse', type: 'reversal', effectSnapshot: effectSnapshot({ entityType: 'reversal', fami` |

#### `src/lib/reversalHistory.ts` — MIGRATE · Phase 3 · risk High

> Client gamification writes become callable commands

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 23 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `reversal?: any;` |
| 54 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `points: Object.fromEntries((state.familyMembers \|\| []).map((member: any) => [member.id, member.rewardPoints \|\| 0])),` |
| 60 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `return reversals.find(reversal => reversal.sourceKind === sourceKind && reversal.sourceId === sourceId);` |
| 117 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `const reversal = storedReversal ? { ...storedReversal, occurredAt: storedReversal.completedAt ?? storedReversal.createdAt } : undefined;` |
| 121 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `sourceKind, sourceId: source.id, source, targets, reversal, isLegacy,` |
| 137 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `if (!reversal && source.type !== 'reversal' && isCanonicalSource && hasEveryBalance) {` |

#### `src/lib/reversalPayloads.test.ts` — MIGRATE · Phase 1-4 · risk Low

> Test rewritten against the V3 contract

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 5 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `describe('reversal payload contract', () => {` |
| 8 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `const inverse = effectSnapshot({ entityType: 'reversal', familyId: 'family-1', actorId: 'parent-1', childId: 'child-1', walletDeltaPence: -300 })` |

#### `src/lib/reversalPayloads.ts` — KEEP · n/a · risk Low

> Unclassified — review before Phase 1

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 45 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `type: 'reversal', ...common, childId, amountPence,` |
| 49 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `type: 'reversal', ...common, fundId, amount,` |

#### `src/lib/transactionAdapter.test.ts` — MIGRATE · Phase 1-4 · risk Low

> Test rewritten against the V3 contract

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 448 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `{ id: 'reversal-behaviour', sourceKind: 'behaviour_event', sourceId: 'behaviour1', reason: 'Undo behaviour', completedAt: createdAt },` |
| 449 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `{ id: 'reversal-petbox', sourceKind: 'petbox_request', sourceId: 'petbox1', reason: 'Undo donation', completedAt: createdAt },` |
| 450 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `{ id: 'reversal-transfer', sourceKind: 'transfer_request', sourceId: 'transfer1', reason: 'Undo transfer', completedAt: createdAt },` |
| 451 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `{ id: 'reversal-money', sourceKind: 'money_request', sourceId: 'money1', reason: 'Undo payment', completedAt: createdAt },` |
| 463 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `'reversal-behaviour',` |
| 464 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `'reversal-petbox',` |
| 465 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `'reversal-transfer',` |
| 466 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `'reversal-money',` |

#### `src/lib/transactionAdapter.ts` — KEEP · n/a · risk Low

> Unclassified — review before Phase 1

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 366 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `reversal?: ReversalRecord,` |
| 368 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `const status: TransactionStatus = reversal ? 'reversed' : seed.status;` |
| 376 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `const reversalId = reversal ? stringValue(reversal.reversalId) ?? reversal.id : undefined;` |
| 377 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `const reversalOccurredAt = reversal` |
| 378 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `? timestampFrom(reversal.completedAt, reversal.createdAt)` |
| 406 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `reversalReason: reversal ? stringValue(reversal.reason) : undefined,` |
| 407 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `reversalActorName: reversal ? stringValue(reversal.actorName) : undefined,` |

#### `src/lib/transactionModel.test.ts` — MIGRATE · Phase 1-4 · risk Low

> Test rewritten against the V3 contract

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 14 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `] satisfies ReadonlyArray<readonly [TransactionStatus, boolean]>)('classifies %s reversal status', (status, expected) => {` |

#### `src/lib/transactionModel.ts` — KEEP · n/a · risk Low

> Unclassified — review before Phase 1

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 54 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `\| 'reversal'` |

#### `src/pages/Dashboard.test.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 41 | `level` | test | in-memory / derived | Member level | `{summary?.isAvailable ? ˋLevel ${summary.level}ˋ : 'Loading…'}` |
| 243 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1500,` |
| 244 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 245 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 1,` |
| 246 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 3,` |
| 299 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1500,` |
| 300 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 301 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 1,` |
| 302 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 3,` |

#### `src/pages/Dashboard.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 115 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `<span className="font-bold text-gray-900">{currentUser.rewardPoints \|\| 0}</span>` |
| 120 | `currentStreak` | calculate | users.currentStreak | Consecutive qualifying days | `<span className="font-bold text-gray-900">{currentUser.currentStreak \|\| 0}</span>` |

#### `src/pages/Family.test.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 45 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{ id: 'c', displayName: 'Kid', role: 'child', avatarUrl: '', lifetimeXP: 0 },` |
| 59 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{ id: 'auth_child', displayName: 'AuthChild', role: 'child', avatarUrl: '', lifetimeXP: 0 },` |
| 60 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{ id: 'managed_child', displayName: 'ManagedChild', role: 'child', avatarUrl: '', lifetimeXP: 0 },` |
| 61 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{ id: 'weird', displayName: 'Weird', role: 'unknown', avatarUrl: '', lifetimeXP: 0 },` |
| 105 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// taskCompletions only (never from behaviourEvents, lifetimeXP, or wallet).` |
| 109 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{ id: 'c1', displayName: 'Child', role: 'child', lifetimeXP: 5000, rewardPoints: 200 }` |
| 109 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `{ id: 'c1', displayName: 'Child', role: 'child', lifetimeXP: 5000, rewardPoints: 200 }` |
| 125 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{ id: 'c1', displayName: 'Child', role: 'child', lifetimeXP: 100, rewardPoints: 50 }` |
| 125 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `{ id: 'c1', displayName: 'Child', role: 'child', lifetimeXP: 100, rewardPoints: 50 }` |
| 146 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{ id: 'c1', displayName: 'Alice', role: 'child', lifetimeXP: 0 },` |
| 147 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{ id: 'c2', displayName: 'Bob', role: 'child', lifetimeXP: 0 }` |

#### `src/pages/Family.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 13 | `claimChallenge` | calculate | in-memory / derived | Family challenge claim (RP + XP credit) | `import { createChallenge, claimChallenge } from '../lib/api';` |
| 13 | `createChallenge` | calculate | in-memory / derived | Family challenge configuration | `import { createChallenge, claimChallenge } from '../lib/api';` |
| 40 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `const [challengeData, setChallengeData] = useState({ title: 'Weekend Warriors', targetXP: 500, rewardPoints: 100 });` |
| 60 | `weeklyXP` | read | derived (client-computed today) | Client-computed weekly leaderboard score | `let weeklyXP = 0;` |
| 71 | `weeklyXP` | calculate | derived (client-computed today) | Client-computed weekly leaderboard score | `if (task) weeklyXP += (task.pointsReward \|\| 0);` |
| 74 | `weeklyXP` | read | derived (client-computed today) | Client-computed weekly leaderboard score | `return { ...member, weeklyXP };` |
| 77 | `weeklyXP` | calculate | derived (client-computed today) | Client-computed weekly leaderboard score | `const sortedMembers = [...membersWithWeeklyXP].sort((a, b) => b.weeklyXP - a.weeklyXP);` |
| 79 | `weeklyXP` | read | derived (client-computed today) | Client-computed weekly leaderboard score | `const champion = sortedMembers.length > 0 && sortedMembers[0].weeklyXP > 0 ? sortedMembers[0] : null;` |
| 85 | `lifetimeXP` | calculate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const totalFamilyXP = children.reduce((acc, child) => acc + (child.lifetimeXP \|\| 0), 0);` |
| 98 | `createChallenge` | read | in-memory / derived | Family challenge configuration | `await createChallenge(currentUser.familyId, challengeData.title, Number(challengeData.targetXP), Number(challengeData.rewardPoints), totalFamilyXP);` |
| 98 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `await createChallenge(currentUser.familyId, challengeData.title, Number(challengeData.targetXP), Number(challengeData.rewardPoints), totalFamilyXP);` |
| 111 | `claimChallenge` | read | in-memory / derived | Family challenge claim (RP + XP credit) | `await claimChallenge(currentUser.familyId, activeChallenge.id, activeChallenge.rewardPoints, childIds, activeChallenge.title);` |
| 111 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `await claimChallenge(currentUser.familyId, activeChallenge.id, activeChallenge.rewardPoints, childIds, activeChallenge.title);` |
| 172 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `<span>{t('challenge.rewardEach', { points: activeChallenge.rewardPoints })}</span>` |
| 276 | `weeklyXP` | calculate | derived (client-computed today) | Client-computed weekly leaderboard score | `<p className="text-sm text-gray-500 font-medium mt-0.5">{t('ptsThisWeek', { value: formatNumber(member.weeklyXP) })}</p>` |
| 327 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `<input type="number" required min="1" value={challengeData.rewardPoints} onChange={e => setChallengeData({...challengeData, rewardPoints: Number(e.target.value)` |

#### `src/pages/MemberProfile.progression.test.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 13 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const readyProjection = (childId: string, xpTotal: number, level: number) => ({` |
| 17 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal,` |
| 19 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 2,` |
| 20 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 5,` |
| 47 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{ id: 'child-1', role: 'child', displayName: 'Test Child', rewardPoints: 100, lifetimeXP: 2500 },` |
| 47 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `{ id: 'child-1', role: 'child', displayName: 'Test Child', rewardPoints: 100, lifetimeXP: 2500 },` |
| 112 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `currentUser: { id: 'parent-1', role: 'owner', lifetimeXP: 9000, rewardPoints: 999 },` |
| 112 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `currentUser: { id: 'parent-1', role: 'owner', lifetimeXP: 9000, rewardPoints: 999 },` |
| 114 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{ id: 'parent-1', role: 'owner', displayName: 'Parent One', rewardPoints: 999, lifetimeXP: 9000 },` |
| 114 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `{ id: 'parent-1', role: 'owner', displayName: 'Parent One', rewardPoints: 999, lifetimeXP: 9000 },` |
| 115 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{ id: 'parent-2', role: 'parent', displayName: 'Parent Two', rewardPoints: 12, lifetimeXP: 3200 },` |
| 115 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `{ id: 'parent-2', role: 'parent', displayName: 'Parent Two', rewardPoints: 12, lifetimeXP: 3200 },` |
| 116 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{ id: 'child-1', role: 'child', displayName: 'Mnalium', rewardPoints: 100, lifetimeXP: 2500 },` |
| 116 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `{ id: 'child-1', role: 'child', displayName: 'Mnalium', rewardPoints: 100, lifetimeXP: 2500 },` |
| 117 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{ id: 'child-2', role: 'child', displayName: 'Alisya', rewardPoints: 40, lifetimeXP: 1250 },` |
| 117 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `{ id: 'child-2', role: 'child', displayName: 'Alisya', rewardPoints: 40, lifetimeXP: 1250 },` |

#### `src/pages/MemberProfile.streakBadges.test.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 18 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 0,` |
| 19 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 20 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 21 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 56 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `it('keeps the streak badge locked when a ready projection shows 0 despite legacy longestStreak 3', () => {` |
| 58 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Mnalium', rewardPoints: 350, longestStreak: 3, currentStreak: 3 }],` |
| 58 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Mnalium', rewardPoints: 350, longestStreak: 3, currentStreak: 3 }],` |
| 58 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Mnalium', rewardPoints: 350, longestStreak: 3, currentStreak: 3 }],` |
| 72 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Mnalium', rewardPoints: 0, longestStreak: 0 }],` |
| 72 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Mnalium', rewardPoints: 0, longestStreak: 0 }],` |
| 75 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `gamificationSummaries: [readySummary({ currentStreak: 3, bestStreak: 3 })],` |
| 75 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `gamificationSummaries: [readySummary({ currentStreak: 3, bestStreak: 3 })],` |
| 85 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Mnalium', rewardPoints: 0, longestStreak: 3, currentStreak: 1 }],` |
| 85 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Mnalium', rewardPoints: 0, longestStreak: 3, currentStreak: 1 }],` |
| 85 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Mnalium', rewardPoints: 0, longestStreak: 3, currentStreak: 1 }],` |
| 100 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `{ id: 'child-1', role: 'child', displayName: 'Mnalium', rewardPoints: 0, longestStreak: 0 },` |
| 100 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `{ id: 'child-1', role: 'child', displayName: 'Mnalium', rewardPoints: 0, longestStreak: 0 },` |
| 101 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `{ id: 'child-2', role: 'child', displayName: 'Ali', rewardPoints: 0, longestStreak: 0 },` |
| 101 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `{ id: 'child-2', role: 'child', displayName: 'Ali', rewardPoints: 0, longestStreak: 0 },` |
| 106 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `readySummary({ childId: 'child-1', currentStreak: 7, bestStreak: 9 }),` |
| 106 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `readySummary({ childId: 'child-1', currentStreak: 7, bestStreak: 9 }),` |
| 107 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `readySummary({ childId: 'child-2', currentStreak: 1, bestStreak: 2 }),` |
| 107 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `readySummary({ childId: 'child-2', currentStreak: 1, bestStreak: 2 }),` |
| 109 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `currentUser: { id: 'parent-1', role: 'parent', displayName: 'Kemal', longestStreak: 11 },` |
| 110 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `myGamificationSummary: readySummary({ childId: 'parent-1', currentStreak: 11, bestStreak: 12 }),` |
| 110 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `myGamificationSummary: readySummary({ childId: 'parent-1', currentStreak: 11, bestStreak: 12 }),` |

#### `src/pages/MemberProfile.test.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 8 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Test Child', rewardPoints: 100 }],` |
| 21 | `level` | test | in-memory / derived | Member level | `{summary?.isAvailable ? ˋStreaks for level ${summary.level}ˋ : 'Loading…'}` |
| 36 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Test Child', rewardPoints: 100 }],` |
| 57 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Test Child', rewardPoints: 100 }],` |
| 64 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 2500,` |
| 65 | `level` | test | in-memory / derived | Member level | `level: 3,` |
| 66 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 2,` |
| 67 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 5,` |
| 115 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Test Child', rewardPoints: 100 }],` |
| 122 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 2500,` |
| 123 | `level` | test | in-memory / derived | Member level | `level: 3,` |
| 124 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 2,` |
| 125 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 5,` |
| 160 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Test Child', rewardPoints: 100 }],` |
| 167 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 2500,` |
| 168 | `level` | test | in-memory / derived | Member level | `level: 3,` |
| 169 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 2,` |
| 170 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 5,` |
| 195 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Test Child', rewardPoints: 100 }],` |
| 216 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `{ id: 'child-1', role: 'child', displayName: 'Child One', rewardPoints: 100 },` |
| 217 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `{ id: 'child-2', role: 'child', displayName: 'Child Two', rewardPoints: 200 },` |
| 226 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1000,` |
| 227 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 228 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 1,` |
| 229 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 2,` |
| 243 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 2500,` |
| 244 | `level` | test | in-memory / derived | Member level | `level: 3,` |
| 245 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 2,` |
| 246 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 5,` |

#### `src/pages/MemberProfile.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 46 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `// - Parents read the whole ˋgamification_summariesˋ collection. Documents are` |
| 60 | `lifetimeXP` | calculate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// Always-complete progression: falls back to the member's lifetimeXP balance` |
| 66 | `longestStreak` | read | users.longestStreak | Legacy best-streak counter on the user doc | `// ˋlongestStreakˋ while the card displays 0.` |
| 68 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `const currentStreak = streaks.currentStreak;` |
| 69 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `const bestStreak = streaks.bestStreak;` |
| 89 | `level` | read | in-memory / derived | Member level | `{progression.level}` |
| 95 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `<p className="text-primary-600 font-bold">{t('profile:rewardPoints', { count: member.rewardPoints \|\| 0 })}</p>` |
| 99 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{/* Progression — always rendered from the projection or the lifetimeXP fallback */}` |
| 104 | `level` | read | in-memory / derived | Member level | `{t('profile:level', { level: progression.level })}` |
| 123 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `{t('profile:currentXp', { count: progression.xpProgressInLevel })}` |
| 126 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `{t('profile:toNextLevel', { count: progression.xpToNextLevel })}` |
| 136 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `{member.rewardPoints \|\| 0}` |
| 156 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `{currentStreak}` |
| 161 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `{t('profile:bestStreak')}` |
| 168 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `{bestStreak}` |
| 218 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `// member; spendable-points badges keep using the profile rewardPoints.` |
| 220 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: progression.xpTotal,` |
| 221 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: member.rewardPoints \|\| 0,` |
| 223 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `longestStreak: bestStreak,` |
| 223 | `longestStreak` | read | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: bestStreak,` |

#### `src/pages/Rewards.test.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 8 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `redeemReward: vi.fn(),` |
| 49 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `currentUser: { id: 'u1', familyId: 'fam', role: 'owner', rewardPoints: 100 },` |
| 63 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `api.redeemReward.mockResolvedValue(undefined);` |
| 68 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'u1', familyId: 'fam', role: 'owner', rewardPoints: 100 } }));` |
| 78 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'u1', familyId: 'fam', role: 'parent', rewardPoints: 100 } }));` |
| 87 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'u1', familyId: 'fam', role: 'child', rewardPoints: 100 } }));` |
| 105 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'u1', familyId: 'fam', role: 'owner', rewardPoints: 100 } }));` |
| 120 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'u1', familyId: 'fam', role: 'owner', rewardPoints: 100 } }));` |
| 135 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `api.redeemReward.mockResolvedValue(undefined);` |
| 146 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `currentUser: { id: 'u1', familyId: 'fam', role: 'parent', rewardPoints: 100 },` |
| 168 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `currentUser: { id: 'u1', familyId: 'fam', role: 'parent', rewardPoints: 100 },` |
| 179 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `currentUser: { id: 'u1', familyId: 'fam', role: 'parent', rewardPoints: 100 },` |
| 191 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `currentUser: { id: 'u1', familyId: 'fam', role: 'parent', rewardPoints: 100 },` |
| 202 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `currentUser: { id: 'u1', familyId: 'fam', role: 'child', rewardPoints: 100 },` |

#### `src/pages/Rewards.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 11 | `redeemReward` | calculate | in-memory / derived | Reward redemption (RP debit) | `import { redeemReward, createReward, updateReward } from '../lib/api';` |
| 45 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `if (currentUser.rewardPoints < selectedReward.cost) {` |
| 58 | `redeemReward` | read | in-memory / derived | Reward redemption (RP debit) | `await redeemReward(currentUser.familyId, currentUser.id, selectedReward.id);` |
| 148 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `{t('rewards:pointsBadge', { value: formatNumber(currentUser.rewardPoints) })}` |

#### `src/pages/Tasks.test.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 28 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `currentUser: { id: 'u1', familyId: 'fam', role: 'owner', rewardPoints: 0 },` |
| 54 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'u1', familyId: 'fam', role: 'owner', rewardPoints: 0 } }));` |
| 65 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'u1', familyId: 'fam', role: 'parent', rewardPoints: 0 } }));` |
| 74 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'u1', familyId: 'fam', role: 'child', rewardPoints: 0 } }));` |
| 85 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'u1', familyId: 'fam', role: 'owner', rewardPoints: 0 } }));` |
| 177 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `currentUser: { id: 'childA', familyId: 'fam', role: 'child', rewardPoints: 0 },` |
| 191 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `currentUser: { id: 'childA', familyId: 'fam', role: 'child', rewardPoints: 0 },` |
| 205 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `currentUser: { id: 'childA', familyId: 'fam', role: 'child', rewardPoints: 0 },` |
| 219 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `currentUser: { id: 'childA', familyId: 'fam', role: 'child', rewardPoints: 0 },` |
| 233 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `currentUser: { id: 'childB', familyId: 'fam', role: 'child', rewardPoints: 0 },` |
| 250 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `currentUser: { id: 'parent', familyId: 'fam', role: 'parent', rewardPoints: 0 },` |
| 267 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `currentUser: { id: 'childA', familyId: 'fam', role: 'child', rewardPoints: 0 },` |
| 282 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `currentUser: { id: 'childA', familyId: 'fam', role: 'child', rewardPoints: 0 },` |
| 303 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `currentUser: { id: 'childA', familyId: 'fam', role: 'child', rewardPoints: 0 },` |
| 330 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'parent', familyId: 'fam', role: 'parent', rewardPoints: 0 } }));` |
| 344 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'parent', familyId: 'fam', role: 'parent', rewardPoints: 0 } }));` |
| 358 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'parent', familyId: 'fam', role: 'parent', rewardPoints: 0 } }));` |
| 373 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `currentUser: { id: 'parent', familyId: 'fam', role: 'parent', rewardPoints: 0 },` |
| 392 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `currentUser: { id: 'parent', familyId: 'fam', role: 'parent', rewardPoints: 0 },` |
| 411 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `currentUser: { id: 'parent', familyId: 'fam', role: 'parent', rewardPoints: 0 },` |
| 425 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `currentUser: { id: 'childA', familyId: 'fam', role: 'child', rewardPoints: 0 },` |

#### `src/pages/legal/LegalPages.test.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 33 | `level` | test | in-memory / derived | Member level | `expect(await screen.findByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeInTheDocument();` |
| 34 | `level` | test | in-memory / derived | Member level | `expect(screen.getByRole('heading', { level: 2, name: 'Information we collect' })).toBeInTheDocument();` |
| 35 | `level` | test | in-memory / derived | Member level | `expect(screen.getByRole('heading', { level: 2, name: 'Authentication data' })).toBeInTheDocument();` |
| 36 | `level` | test | in-memory / derived | Member level | `expect(screen.getByRole('heading', { level: 2, name: 'Account deletion and family deletion' })).toBeInTheDocument();` |
| 50 | `level` | test | in-memory / derived | Member level | `expect(await screen.findByRole('heading', { level: 1, name: 'Terms of Service' })).toBeInTheDocument();` |
| 51 | `level` | test | in-memory / derived | Member level | `expect(screen.getByRole('heading', { level: 2, name: 'Rewards disclaimer' })).toBeInTheDocument();` |
| 52 | `level` | test | in-memory / derived | Member level | `expect(screen.getByRole('heading', { level: 2, name: 'Wallet disclaimer' })).toBeInTheDocument();` |
| 58 | `level` | test | in-memory / derived | Member level | `expect(await screen.findByRole('heading', { level: 1, name: 'Account Deletion' })).toBeInTheDocument();` |
| 60 | `level` | test | in-memory / derived | Member level | `expect(screen.getByRole('heading', { level: 2, name: 'Recent authentication requirement' })).toBeInTheDocument();` |
| 61 | `level` | test | in-memory / derived | Member level | `expect(screen.getByRole('heading', { level: 2, name: 'Sign Out' })).toBeInTheDocument();` |
| 62 | `level` | test | in-memory / derived | Member level | `expect(screen.getByRole('heading', { level: 2, name: 'Delete Family' })).toBeInTheDocument();` |
| 70 | `level` | test | in-memory / derived | Member level | `await screen.findByRole('heading', { level: 1, name: 'Privacy Policy' });` |
| 72 | `level` | test | in-memory / derived | Member level | `expect(await screen.findByRole('heading', { level: 1, name: 'Gizlilik Politikası' })).toBeInTheDocument();` |
| 73 | `level` | test | in-memory / derived | Member level | `expect(screen.getByRole('heading', { level: 2, name: 'Topladığımız bilgiler' })).toBeInTheDocument();` |
| 78 | `level` | test | in-memory / derived | Member level | `await screen.findByRole('heading', { level: 1, name: 'Terms of Service' });` |

#### `tests/components/gamificationPhase1.integration.test.tsx` — MIGRATE · Phase 1-4 · risk Low

> Test rewritten against the V3 contract

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 16 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `'gamification.xpTotal': ˋ${options?.xp ?? 0} Total XPˋ,` |
| 19 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `'gamification.xpToNextLevel': ˋ${options?.xp ?? 0} XP to reach Level ${options?.level ?? ''}ˋ,` |
| 20 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `'gamification.currentStreak': 'Current Streak',` |
| 21 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `'gamification.bestStreak': 'Best Streak',` |
| 42 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 100,` |
| 43 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 44 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 1,` |
| 45 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 1,` |
| 58 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(view.xpTotal).toBe(100);` |
| 69 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 100,` |
| 70 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 71 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 1,` |
| 72 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 1,` |
| 85 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(view.xpTotal).toBe(100);` |
| 105 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 100,` |
| 106 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 107 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 1,` |
| 108 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 1,` |
| 131 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 100,` |
| 132 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 133 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 1,` |
| 134 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 1,` |
| 150 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `describe('reversal before and after award', () => {` |
| 151 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('handles reversal before award (already-invalid source)', () => {` |
| 152 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `// When reversal comes before award, the system creates` |
| 158 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 0,` |
| 159 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 160 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 161 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 173 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(view.xpTotal).toBe(0);` |
| 174 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `expect(view.currentStreak).toBe(0);` |
| 177 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('handles reversal after award (compensation)', () => {` |
| 178 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `// When reversal comes after award, the system creates` |
| 184 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 0,` |
| 185 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 186 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 187 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 1, // bestStreak preserved` |
| 199 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(view.xpTotal).toBe(0);` |
| 200 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `expect(view.bestStreak).toBe(1); // bestStreak not decreased` |
| 211 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 100,` |
| 212 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 213 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 1,` |
| 214 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 1,` |
| 257 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 125, // 100 task + 25 bonus` |
| 258 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 259 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 1,` |
| 260 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 1,` |
| 302 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 50, // Only task XP, no bonus` |
| 303 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 304 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 305 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 1,` |
| 318 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `expect(view.currentStreak).toBe(0);` |
| 349 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 175, // 100 task + 25 daily goal + 50 perfect day` |
| 350 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 351 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 1,` |
| 352 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 1,` |
| 375 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 0,` |
| 376 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 377 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 378 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 401 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 0,` |
| 402 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 403 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 404 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 428 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `// Parent can read: families/{familyId}/gamification_summaries` |
| 437 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `// Child can read: families/{familyId}/gamification_summaries/{childId}` |
| 463 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(view.xpTotal).toBe(0);` |
| 477 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1500,` |
| 478 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 479 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 500,` |
| 480 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 500,` |
| 481 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 482 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 502 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1500,` |
| 503 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 504 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 500,` |
| 505 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 500,` |
| 506 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 507 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 526 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1000,` |
| 527 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 528 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 1000,` |
| 529 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 0,` |
| 530 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 1,` |
| 531 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 1,` |

#### `tests/e2e/utils/seed-mobile.ts` — MIGRATE · Phase 1-4 · risk Low

> Test rewritten against the V3 contract

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 71 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 10,` |
| 72 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 10,` |

#### `tests/e2e/utils/seed.ts` — MIGRATE · Phase 1-4 · risk Low

> Test rewritten against the V3 contract

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 54 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `batch.set(db.doc(ˋusers/child1ˋ), { familyId, role: 'child', displayName: 'Child Leo', rewardPoints: 100, lifetimeXP: 100, walletBalance: 500 });` |
| 54 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `batch.set(db.doc(ˋusers/child1ˋ), { familyId, role: 'child', displayName: 'Child Leo', rewardPoints: 100, lifetimeXP: 100, walletBalance: 500 });` |
| 55 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `batch.set(db.doc(ˋusers/child2ˋ), { familyId, role: 'child', displayName: 'Child Ava', rewardPoints: 50, lifetimeXP: 50, walletBalance: 200 });` |
| 55 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `batch.set(db.doc(ˋusers/child2ˋ), { familyId, role: 'child', displayName: 'Child Ava', rewardPoints: 50, lifetimeXP: 50, walletBalance: 200 });` |

#### `tests/firestore/approvalCenter.rules.test.ts` — MIGRATE · Phase 1-5 · risk Medium

> Rules tests rewritten alongside the rules

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 49 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 100,` |
| 50 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 100` |
| 58 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 50,` |
| 59 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 50` |
| 173 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `await assertFails(updateDoc(doc(parentDb, 'users', childId), { rewardPoints: 999, lifetimeXP: 999 }));` |
| 173 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `await assertFails(updateDoc(doc(parentDb, 'users', childId), { rewardPoints: 999, lifetimeXP: 999 }));` |
| 279 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `await setDoc(doc(context.firestore(), 'users', target), { familyId, role: 'child', rewardPoints: 0, lifetimeXP: 0, ...(legacyBalance ? { walletBalance: legacyBa` |
| 279 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `await setDoc(doc(context.firestore(), 'users', target), { familyId, role: 'child', rewardPoints: 0, lifetimeXP: 0, ...(legacyBalance ? { walletBalance: legacyBa` |
| 340 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `batch.update(doc(db, 'users', childId), { rewardPoints: 75, lastRedemptionId: 'redemption-1' });` |
| 387 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `rewardPoints: 0, lifetimeXP: 0, currentStreak: 0, longestStreak: 0, lastActiveDate: serverTimestamp(),` |
| 387 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `rewardPoints: 0, lifetimeXP: 0, currentStreak: 0, longestStreak: 0, lastActiveDate: serverTimestamp(),` |
| 387 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `rewardPoints: 0, lifetimeXP: 0, currentStreak: 0, longestStreak: 0, lastActiveDate: serverTimestamp(),` |
| 387 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0, lifetimeXP: 0, currentStreak: 0, longestStreak: 0, lastActiveDate: serverTimestamp(),` |

#### `tests/firestore/behaviour.rules.test.ts` — MIGRATE · Phase 1-5 · risk Medium

> Rules tests rewritten alongside the rules

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 85 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `setDoc(doc(db, 'users', CHILD_ID), { uid: CHILD_ID, familyId: FAMILY_ID, role: 'child', displayName: 'Casey Child', rewardPoints: 20, lifetimeXP: 50, walletBala` |
| 85 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `setDoc(doc(db, 'users', CHILD_ID), { uid: CHILD_ID, familyId: FAMILY_ID, role: 'child', displayName: 'Casey Child', rewardPoints: 20, lifetimeXP: 50, walletBala` |
| 102 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `await assertFails(setDoc(doc(attacker, ˋfamilies/${FAMILY_ID}/behaviour_events/forgedˋ), validEvent({` |
| 143 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `await setDoc(doc(context.firestore(), ˋfamilies/${FAMILY_ID}/behaviour_events/existingˋ), validEvent({ createdAt: new Date() }));` |
| 145 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `await assertSucceeds(getDoc(doc(user(CHILD_ID), ˋfamilies/${FAMILY_ID}/behaviour_events/existingˋ)));` |
| 146 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `await assertFails(getDoc(doc(user('parent-two'), ˋfamilies/${FAMILY_ID}/behaviour_events/existingˋ)));` |
| 150 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `await assertSucceeds(setDoc(doc(user(PARENT_ID), ˋfamilies/${FAMILY_ID}/behaviour_events/positiveˋ), validEvent()));` |
| 151 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `await assertSucceeds(setDoc(doc(user(OWNER_ID), ˋfamilies/${FAMILY_ID}/behaviour_events/negativeˋ), validEvent({ type: 'negative', pointsDelta: -5, createdBy: O` |
| 155 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `await assertFails(setDoc(doc(user(CHILD_ID), ˋfamilies/${FAMILY_ID}/behaviour_events/childˋ), validEvent({ createdBy: CHILD_ID, createdByName: 'Casey Child' }))` |
| 156 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `await assertFails(setDoc(doc(user('parent-two'), ˋfamilies/${FAMILY_ID}/behaviour_events/otherˋ), validEvent({ createdBy: 'parent-two', createdByName: 'Other Pa` |
| 165 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// Remove lifetimeXP from the initial user to simulate a legacy user` |
| 168 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `await updateDoc(doc(adminDb, 'users', CHILD_ID), { lifetimeXP: deleteField() });` |
| 171 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `batch.update(childRef, { rewardPoints: 20 + 10, lifetimeXP: 10, lastBehaviourEventId: 'evt-1' });` |
| 171 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `batch.update(childRef, { rewardPoints: 20 + 10, lifetimeXP: 10, lastBehaviourEventId: 'evt-1' });` |
| 173 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `// 2. behaviour_events` |
| 174 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `const eventRef = doc(db, ˋfamilies/${FAMILY_ID}/behaviour_events/evt-1ˋ);` |
| 215 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `await assertFails(setDoc(doc(user(PARENT_ID), ˋfamilies/${FAMILY_ID}/behaviour_events/bad-deltaˋ), validEvent(overrides)));` |
| 237 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `await assertFails(setDoc(doc(user(PARENT_ID), ˋfamilies/${FAMILY_ID}/behaviour_events/malformedˋ), event));` |
| 241 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `await assertSucceeds(setDoc(doc(user(PARENT_ID), ˋfamilies/${FAMILY_ID}/behaviour_events/immutableˋ), validEvent()));` |
| 242 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `await assertFails(updateDoc(doc(user(PARENT_ID), ˋfamilies/${FAMILY_ID}/behaviour_events/immutableˋ), { reason: 'Changed later' }));` |
| 243 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `await assertFails(deleteDoc(doc(user(OWNER_ID), ˋfamilies/${FAMILY_ID}/behaviour_events/immutableˋ)));` |
| 251 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `batch.set(doc(db, ˋfamilies/${FAMILY_ID}/behaviour_events/financialˋ), validEvent({ type: 'financial', pointsDelta: 0, walletDelta: -100, reason: 'Damaged a boo` |
| 271 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `batch.set(doc(db, ˋfamilies/${FAMILY_ID}/behaviour_events/penalty-event-2ˋ), validEvent({` |
| 304 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `await setDoc(doc(db, ˋfamilies/${FAMILY_ID}/behaviour_events/mismatchedˋ), validEvent({` |
| 336 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `await setDoc(doc(context.firestore(), ˋfamilies/${FAMILY_ID}/behaviour_events/timestamp-linkˋ), validEvent({` |
| 348 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `batch.set(doc(db, ˋfamilies/${FAMILY_ID}/behaviour_events/financial2ˋ), validEvent({ type: 'financial', pointsDelta: 0, walletDelta: -100, reason: 'Damaged a bo` |
| 447 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `batch.set(doc(db, ˋfamilies/${FAMILY_ID}/behaviour_events/penalty-event-atomicˋ), validEvent({` |
| 470 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `test.each(['rewardPoints', 'lifetimeXP', 'walletBalance'])('child cannot directly change %s', async (field) => {` |
| 470 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `test.each(['rewardPoints', 'lifetimeXP', 'walletBalance'])('child cannot directly change %s', async (field) => {` |

#### `tests/firestore/bootstrapQueries.rules.test.ts` — MIGRATE · Phase 1-5 · risk Medium

> Rules tests rewritten alongside the rules

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 76 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `setDoc(doc(db, ˋfamilies/${familyId}/reversals/reversalˋ), { status: 'completed', completedAt: now }),` |
| 82 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `setDoc(doc(db, ˋfamilies/${familyId}/behaviour_events/legacyˋ), { createdAt: now }),` |
| 83 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `setDoc(doc(db, ˋfamilies/${familyId}/behaviour_events/v2ˋ), { timestamp: now }),` |

#### `tests/firestore/diagnostic.test.ts` — MIGRATE · Phase 1-5 · risk Medium

> Rules tests rewritten alongside the rules

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 34 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 1000,` |
| 35 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 1000` |
| 42 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 100,` |
| 43 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 100` |

#### `tests/firestore/gamification.rules.test.ts` — MIGRATE · Phase 1-5 · risk Medium

> Rules tests rewritten alongside the rules

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 43 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 100,` |
| 44 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 100` |
| 61 | `task_occurrences` | test | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `it('denies all client reads on task_occurrences', async () => {` |
| 63 | `task_occurrences` | test | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `await assertFails(getDoc(doc(db, 'task_occurrences', 'occurrence123')));` |
| 66 | `task_occurrences` | test | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `it('denies all client writes on task_occurrences', async () => {` |
| 68 | `task_occurrences` | test | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `await assertFails(setDoc(doc(db, 'task_occurrences', 'occurrence123'), {` |
| 75 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `it('denies all client reads on gamification_events', async () => {` |
| 77 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `await assertFails(getDoc(doc(db, 'gamification_events', 'event123')));` |
| 80 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `it('denies all client writes on gamification_events', async () => {` |
| 82 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `await assertFails(setDoc(doc(db, 'gamification_events', 'event123'), {` |
| 118 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `it('denies unauthenticated reads on gamification_summaries', async () => {` |
| 120 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `await assertFails(getDoc(doc(db, ˋfamilies/${familyId}/gamification_summariesˋ, childId)));` |
| 123 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `it('denies all client writes on gamification_summaries', async () => {` |
| 125 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `await assertFails(setDoc(doc(db, ˋfamilies/${familyId}/gamification_summariesˋ, childId), {` |
| 128 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1000,` |
| 129 | `level` | test | in-memory / derived | Member level | `level: 1` |
| 153 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `await setDoc(doc(db, ˋfamilies/${familyId}/gamification_summariesˋ, childId), {` |
| 156 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1000,` |
| 157 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 158 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 5,` |
| 159 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 10,` |
| 194 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `await assertSucceeds(getDoc(doc(db, ˋfamilies/${familyId}/gamification_summariesˋ, childId)));` |
| 204 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `await assertSucceeds(getDoc(doc(db, ˋfamilies/${familyId}/gamification_summariesˋ, childId)));` |
| 221 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `await setDoc(doc(db, ˋfamilies/${familyId}/gamification_summariesˋ, otherChildId), {` |
| 224 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 500,` |
| 225 | `level` | test | in-memory / derived | Member level | `level: 1` |
| 229 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `await assertFails(getDoc(doc(db, ˋfamilies/${familyId}/gamification_summariesˋ, otherChildId)));` |
| 252 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `it('denies all clients write access to gamification_summaries', async () => {` |
| 254 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `await assertFails(setDoc(doc(db, ˋfamilies/${familyId}/gamification_summariesˋ, childId), {` |
| 257 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 2000,` |
| 258 | `level` | test | in-memory / derived | Member level | `level: 2` |

#### `tests/firestore/ownerBootstrap.rules.test.ts` — MIGRATE · Phase 1-5 · risk Medium

> Rules tests rewritten alongside the rules

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 91 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 92 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 0,` |
| 93 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 94 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 0,` |
| 120 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 121 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 0,` |
| 122 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 123 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 0,` |
| 135 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 136 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 0,` |
| 137 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 138 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 0,` |
| 152 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 153 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 0,` |
| 154 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 155 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 0,` |
| 169 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 170 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 0,` |
| 171 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 172 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 0,` |
| 186 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 187 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 0,` |
| 188 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 189 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 0,` |
| 194 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `// User tries to set rewardPoints to a non-zero value` |
| 202 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 100, // Not allowed - must be 0` |
| 203 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 0,` |
| 204 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 205 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 0,` |
| 218 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 219 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 0,` |
| 220 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 221 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 0,` |
| 226 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('7. User cannot set non-zero lifetimeXP during bootstrap', async () => {` |
| 234 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 235 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 500, // Not allowed - must be 0` |
| 236 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 237 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 0,` |
| 241 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `it('8. User cannot set non-zero currentStreak during bootstrap', async () => {` |
| 249 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 250 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 0,` |
| 251 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 10, // Not allowed - must be 0` |
| 252 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 0,` |
| 256 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `it('9. User cannot set non-zero longestStreak during bootstrap', async () => {` |
| 264 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 265 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 0,` |
| 266 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 267 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 50, // Not allowed - must be 0` |
| 279 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 280 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 0,` |
| 281 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 282 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 0,` |
| 294 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 295 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 0,` |
| 296 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 297 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 0,` |
| 309 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 310 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 0,` |
| 311 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 312 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 0,` |
| 326 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 327 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 0,` |
| 328 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 329 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 0,` |

#### `tests/firestore/ownerPermissions.rules.test.ts` — MIGRATE · Phase 1-5 · risk Medium

> Rules tests rewritten alongside the rules

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 41 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `rewardPoints: 100, lifetimeXP: 100, walletBalance: 500` |
| 41 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 100, lifetimeXP: 100, walletBalance: 500` |
| 115 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 116 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 0,` |
| 117 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 118 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 0,` |
| 257 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('owner cannot create arbitrary reversal', async () => {` |
| 267 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('owner cannot duplicate a refund/reversal', async () => {` |
| 284 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `inverseEffectSnapshot: { schemaVersion: 1, entityType: 'reversal', familyId: 'fam-1', actorId: 'owner-1', childId: 'child-1', pointsDelta: -10, xpAdjustment: 0 ` |

#### `tests/firestore/profileAndAvatar.rules.test.ts` — MIGRATE · Phase 1-5 · risk Medium

> Rules tests rewritten alongside the rules

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 31 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `avatarId: 'starter-cat', rewardPoints: 500, lifetimeXP: 100,` |
| 31 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `avatarId: 'starter-cat', rewardPoints: 500, lifetimeXP: 100,` |
| 34 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `familyId, role: 'child', displayName: 'Muhammed', avatarUrl: '', rewardPoints: 50, lifetimeXP: 50,` |
| 34 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `familyId, role: 'child', displayName: 'Muhammed', avatarUrl: '', rewardPoints: 50, lifetimeXP: 50,` |
| 336 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `it('owner CANNOT alter rewardPoints / balance via self-edit', async () => {` |
| 338 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `await assertFails(updateDoc(doc(db, 'users', ownerId), { rewardPoints: 99999 }));` |

#### `tests/firestore/profileUpdateTxn.rules.test.ts` — MIGRATE · Phase 1-5 · risk Medium

> Rules tests rewritten alongside the rules

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 28 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `avatarId: 'starter-cat', rewardPoints: 500, lifetimeXP: 100,` |
| 28 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `avatarId: 'starter-cat', rewardPoints: 500, lifetimeXP: 100,` |

#### `tests/firestore/reproProfileSubmit.test.ts` — MIGRATE · Phase 1-5 · risk Medium

> Rules tests rewritten alongside the rules

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 29 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `avatarId: 'starter-cat', rewardPoints: 500, lifetimeXP: 100,` |
| 29 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `avatarId: 'starter-cat', rewardPoints: 500, lifetimeXP: 100,` |

#### `tests/firestore/reversal.rules.test.ts` — MIGRATE · Phase 1-5 · risk Medium

> Rules tests rewritten alongside the rules

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 10 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `const familyId = 'reversal-family'` |
| 18 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `projectId: 'familyquest-reversal-rules',` |
| 30 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `await setDoc(doc(db, 'users', childId), { familyId, role: 'child', displayName: 'Ada', rewardPoints: 100, lifetimeXP: 500 })` |
| 30 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `await setDoc(doc(db, 'users', childId), { familyId, role: 'child', displayName: 'Ada', rewardPoints: 100, lifetimeXP: 500 })` |
| 31 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `await setDoc(doc(db, 'users', child2Id), { familyId, role: 'child', displayName: 'Ben', rewardPoints: 100, lifetimeXP: 500 })` |
| 31 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `await setDoc(doc(db, 'users', child2Id), { familyId, role: 'child', displayName: 'Ben', rewardPoints: 100, lifetimeXP: 500 })` |
| 50 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `const inverse = effectSnapshot({ entityType: 'reversal', familyId, actorId, childId, walletDeltaPence: -(original.walletDeltaPence \|\| 0) })` |
| 61 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `wallet_transaction: 'wallet_transactions', fund_transaction: 'fund_transactions', behaviour_event: 'behaviour_events',` |
| 68 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `entityType: 'reversal', familyId, actorId,` |
| 99 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `batch.update(doc(db, 'users', original.childId!), { rewardPoints: 100 + inverse.pointsDelta, lastReversalId: reversalId })` |
| 106 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `describe('reversal security rules', () => {` |
| 116 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('denies a child reversal', async () => {` |
| 159 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('denies duplicate reversal records and keeps ledgers immutable', async () => {` |
| 175 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('allows a fund reversal that drives the balance negative (negative balances permitted)', async () => {` |
| 194 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('accepts petbox_request reversal (donation refund) from parent/owner', async () => {` |

#### `tests/firestore/userLanguage.rules.test.ts` — MIGRATE · Phase 1-5 · risk Medium

> Rules tests rewritten alongside the rules

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 33 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 10,` |
| 34 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 20,` |
| 41 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 30,` |
| 42 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 40,` |
| 71 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 999,` |
| 72 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 999,` |

#### `tests/functions/gamification.integration.test.ts` — MIGRATE · Phase 1-4 · risk Low

> Test rewritten against the V3 contract

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 36 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `db().doc(ˋusers/${CHILD}ˋ).set({ familyId: FAMILY, role: 'child', status: 'active', rewardPoints: 5 }),` |
| 63 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await db().doc(ˋusers/${CHILD}ˋ).get()).data()!.rewardPoints).toBe(25)` |
| 67 | `task_occurrences` | test | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `expect((await db().collection(ˋfamilies/${FAMILY}/task_occurrencesˋ).get()).size).toBe(1)` |
| 68 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect((await db().collection(ˋfamilies/${FAMILY}/gamification_eventsˋ).get()).docs.map(d => d.data().eventType).sort()).toEqual([` |
| 83 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await db().doc(ˋusers/${CHILD}ˋ).get()).data()!.rewardPoints).toBe(25)` |
| 84 | `task_occurrences` | test | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `expect((await db().collection(ˋfamilies/${FAMILY}/task_occurrencesˋ).get()).size).toBe(1)` |
| 85 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect((await db().collection(ˋfamilies/${FAMILY}/gamification_eventsˋ).get()).size).toBe(5)` |
| 109 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const beforePoints = (await db().doc(ˋusers/${CHILD}ˋ).get()).data()!.rewardPoints` |
| 115 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await db().doc(ˋusers/${CHILD}ˋ).get()).data()!.rewardPoints).toBe(beforePoints)` |
| 116 | `task_occurrences` | test | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `expect((await db().collection(ˋfamilies/${FAMILY}/task_occurrencesˋ).get()).empty).toBe(true)` |
| 117 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect((await db().collection(ˋfamilies/${FAMILY}/gamification_eventsˋ).get()).empty).toBe(true)` |
| 120 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('reversal before or after delivery converges to one net-zero award/revoke ledger', async () => {` |
| 125 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `const events = (await db().collection(ˋfamilies/${FAMILY}/gamification_eventsˋ).get()).docs.map(d => d.data())` |
| 127 | `bestStreak` | test | families/{f}/gamification_summaries | Projection best-streak counter | `expect((await db().doc(ˋfamilies/${FAMILY}/gamification_summaries/${CHILD}ˋ).get()).data()).toMatchObject({ xpTotal: 0, currentStreak: 0, bestStreak: 0, perfect` |
| 127 | `currentStreak` | test | families/{f}/gamification_summaries | Consecutive qualifying days | `expect((await db().doc(ˋfamilies/${FAMILY}/gamification_summaries/${CHILD}ˋ).get()).data()).toMatchObject({ xpTotal: 0, currentStreak: 0, bestStreak: 0, perfect` |
| 127 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `expect((await db().doc(ˋfamilies/${FAMILY}/gamification_summaries/${CHILD}ˋ).get()).data()).toMatchObject({ xpTotal: 0, currentStreak: 0, bestStreak: 0, perfect` |
| 127 | `xpTotal` | test | families/{f}/gamification_summaries | Projection lifetime XP counter (authoritative today) | `expect((await db().doc(ˋfamilies/${FAMILY}/gamification_summaries/${CHILD}ˋ).get()).data()).toMatchObject({ xpTotal: 0, currentStreak: 0, bestStreak: 0, perfect` |
| 130 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('a later reversal removes spendable points once, unqualifies the day, and preserves a legitimate best', async () => {` |
| 136 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await db().doc(ˋusers/${CHILD}ˋ).get()).data()!.rewardPoints).toBe(5)` |
| 137 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `const summary = (await db().doc(ˋfamilies/${FAMILY}/gamification_summaries/${CHILD}ˋ).get()).data()!` |
| 138 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `expect(summary).toMatchObject({ xpTotal: 0, currentStreak: 0, bestStreak: 1, perfectDayCount: 0 })` |
| 138 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `expect(summary).toMatchObject({ xpTotal: 0, currentStreak: 0, bestStreak: 1, perfectDayCount: 0 })` |
| 138 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(summary).toMatchObject({ xpTotal: 0, currentStreak: 0, bestStreak: 1, perfectDayCount: 0 })` |
| 139 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect((await db().collection(ˋfamilies/${FAMILY}/gamification_eventsˋ).get()).docs.filter(d => d.data().eventType === 'xp_revoked')).toHaveLength(1)` |
| 145 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await db().doc(ˋusers/${CHILD}ˋ).get()).data()!.rewardPoints).toBe(5)` |
| 147 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `const events = (await db().collection(ˋfamilies/${FAMILY}/gamification_eventsˋ).get()).docs.map(document => document.data())` |
| 156 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `let transitions = (await db().collection(ˋfamilies/${FAMILY}/gamification_eventsˋ).get()).docs.map(document => document.data())` |
| 159 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `transitions = (await db().collection(ˋfamilies/${FAMILY}/gamification_eventsˋ).get()).docs.map(document => document.data())` |
| 168 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect((await db().collection(ˋfamilies/${FAMILY}/gamification_eventsˋ).get()).empty).toBe(true)` |
| 173 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `await db().doc(ˋfamilies/${FAMILY}/gamification_summaries/${CHILD}ˋ).set({` |
| 174 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `schemaVersion: 1, familyId: FAMILY, childId: CHILD, xpTotal: 0, level: 1, currentStreak: 0, bestStreak: 0,` |
| 174 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `schemaVersion: 1, familyId: FAMILY, childId: CHILD, xpTotal: 0, level: 1, currentStreak: 0, bestStreak: 0,` |
| 174 | `level` | test | in-memory / derived | Member level | `schemaVersion: 1, familyId: FAMILY, childId: CHILD, xpTotal: 0, level: 1, currentStreak: 0, bestStreak: 0,` |
| 174 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `schemaVersion: 1, familyId: FAMILY, childId: CHILD, xpTotal: 0, level: 1, currentStreak: 0, bestStreak: 0,` |
| 184 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `expect((await db().doc(ˋfamilies/${FAMILY}/gamification_summaries/${CHILD}ˋ).get()).data()).toMatchObject({ rebuildRequired: true, projectionStatus: 'rebuilding` |
| 214 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `const events = (await db().collection(ˋfamilies/${FAMILY}/gamification_eventsˋ).get()).docs.map(document => document.data())` |
| 222 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await db().doc(ˋusers/${CHILD}ˋ).get()).data()!.rewardPoints).toBe(35)` |
| 264 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await db().doc(ˋusers/${CHILD}ˋ).get()).data()!.rewardPoints).toBe(25)` |

#### `tests/functions/gamificationOnboarding.integration.test.ts` — MIGRATE · Phase 1-4 · risk Low

> Test rewritten against the V3 contract

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 9 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `*     -> gamification processor -> rewardPoints / lifetimeXP / summary` |
| 9 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `*     -> gamification processor -> rewardPoints / lifetimeXP / summary` |
| 91 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `displayName: 'Test Child', rewardPoints: 0, lifetimeXP: 0,` |
| 91 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `displayName: 'Test Child', rewardPoints: 0, lifetimeXP: 0,` |
| 125 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('awards rewardPoints, lifetimeXP and a summary for a family created today', async () => {` |
| 125 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `it('awards rewardPoints, lifetimeXP and a summary for a family created today', async () => {` |
| 135 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `return child?.rewardPoints === 20` |
| 151 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(child.rewardPoints).toBe(20)` |
| 153 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// Lifetime XP is owned by the gamification summary. ˋusers.lifetimeXPˋ is` |
| 156 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `const summary = await admin().doc(ˋfamilies/${familyId}/gamification_summaries/${childId}ˋ).get()` |
| 158 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(summary.data()!.xpTotal).toBeGreaterThan(0)` |

#### `tests/functions/gamificationSharedTask.e2e.test.ts` — MIGRATE · Phase 1-4 · risk Low

> Test rewritten against the V3 contract

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 9 | `levelProgressForXp` | test | in-memory / derived | Canonical level formula | `import { levelProgressForXp } from '../../src/domain/gamification/level'` |
| 43 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `return (await db().doc(ˋfamilies/${FAMILY}/gamification_summaries/${id}ˋ).get()).data()` |
| 46 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `return (await db().collection(ˋfamilies/${FAMILY}/gamification_eventsˋ).get()).docs.map(document => document.data())` |
| 57 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `db().doc(ˋusers/${CHILD_A}ˋ).set({ familyId: FAMILY, role: 'child', status: 'active', rewardPoints: 0, lifetimeXP: 0 }),` |
| 57 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `db().doc(ˋusers/${CHILD_A}ˋ).set({ familyId: FAMILY, role: 'child', status: 'active', rewardPoints: 0, lifetimeXP: 0 }),` |
| 58 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `db().doc(ˋusers/${CHILD_B}ˋ).set({ familyId: FAMILY, role: 'child', status: 'active', rewardPoints: 0, lifetimeXP: 0 }),` |
| 58 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `db().doc(ˋusers/${CHILD_B}ˋ).set({ familyId: FAMILY, role: 'child', status: 'active', rewardPoints: 0, lifetimeXP: 0 }),` |
| 86 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `await db().doc(ˋfamilies/${FAMILY}/behaviour_events/${id}ˋ).set({` |
| 116 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await child(CHILD_A)).rewardPoints).toBe(20)` |
| 123 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(projection.xpTotal).toBe(ledgerXp)` |
| 124 | `levelProgressForXp` | test | in-memory / derived | Canonical level formula | `expect(levelProgressForXp(projection.xpTotal, GAMIFICATION_CONFIG_V1.xpPerLevel))` |
| 124 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(levelProgressForXp(projection.xpTotal, GAMIFICATION_CONFIG_V1.xpPerLevel))` |
| 130 | `task_occurrences` | test | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `expect((await db().collection(ˋfamilies/${FAMILY}/task_occurrencesˋ).get()).size).toBe(1)` |
| 135 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await child(CHILD_B)).rewardPoints).toBe(0)` |
| 149 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await child(CHILD_A)).rewardPoints).toBe(20)` |
| 156 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await child(CHILD_B)).rewardPoints).toBe(0)` |
| 185 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('awards a positive behaviour once, mirroring lifetimeXP, with no client balance writes', async () => {` |
| 189 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await child(CHILD_A)).rewardPoints).toBe(0)` |
| 202 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(member.rewardPoints).toBe(20)` |
| 203 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `expect(member.lifetimeXP).toBe(20)` |
| 204 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect((await summary(CHILD_A))!.xpTotal).toBe(20)` |
| 224 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(member.rewardPoints).toBe(15)` |
| 225 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `expect(member.lifetimeXP).toBe(20)` |
| 226 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect((await summary(CHILD_A))!.xpTotal).toBe(20)` |
| 234 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(after.rewardPoints).toBe(0)` |
| 235 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `expect(after.lifetimeXP).toBe(20)` |
| 236 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect((await summary(CHILD_A))!.xpTotal).toBe(20)` |

#### `tests/scripts/resetFamilyData.test.ts` — MIGRATE · Phase 1-4 · risk Low

> Test rewritten against the V3 contract

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 86 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `record('users/owner-1', { familyId: 'fam-1', role: 'owner', displayName: 'Owner', rewardPoints: 99 }),` |
| 90 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `rewardPoints: 120, lifetimeXP: 300, currentStreak: 4, longestStreak: 8,` |
| 90 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `rewardPoints: 120, lifetimeXP: 300, currentStreak: 4, longestStreak: 8,` |
| 90 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `rewardPoints: 120, lifetimeXP: 300, currentStreak: 4, longestStreak: 8,` |
| 90 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 120, lifetimeXP: 300, currentStreak: 4, longestStreak: 8,` |
| 282 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `data: { walletBalance: 0, rewardPoints: 0, lifetimeXP: 0, currentStreak: 0, longestStreak: 0 },` |
| 282 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `data: { walletBalance: 0, rewardPoints: 0, lifetimeXP: 0, currentStreak: 0, longestStreak: 0 },` |
| 282 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `data: { walletBalance: 0, rewardPoints: 0, lifetimeXP: 0, currentStreak: 0, longestStreak: 0 },` |
| 282 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `data: { walletBalance: 0, rewardPoints: 0, lifetimeXP: 0, currentStreak: 0, longestStreak: 0 },` |

#### `tests/store/useStore.test.ts` — MIGRATE · Phase 1-4 · risk Low

> Test rewritten against the V3 contract

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 80 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `'families/fam1/behaviour_events',` |
| 90 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `'families/fam1/gamification_summaries',` |
| 99 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `if (target === 'families/fam1/gamification_summaries') return 'families/fam1/gamification_summaries/user1';` |
| 146 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `} else if (target === 'families/fam1/gamification_summaries/user1') {` |
| 428 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `const behaviourQuery = queryShapes.find(shape => shape.target === 'families/fam1/behaviour_events');` |
| 445 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `listener('families/fam1/behaviour_events').next(collectionSnapshot([` |
| 472 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('ignores queued reversal callbacks after the active family changes', async () => {` |
| 480 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `oldReversals.next(collectionSnapshot([{ id: 'stale-reversal' }]));` |
| 636 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `expect(listeners.some(item => item.target === 'families/fam1/gamification_summaries')).toBe(true);` |
| 643 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `expect(listeners.some(item => item.target === 'families/fam1/gamification_summaries/user1')).toBe(true);` |


<!-- END GENERATED: gamification-inventory -->
