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

Occurrences: **3745** across **301** files.

### Totals by operation

| Operation | Count |
|---|---|
| test | 2456 |
| read | 781 |
| migrate | 212 |
| calculate | 190 |
| initialise | 71 |
| write | 35 |

### Totals by V3 decision

| Decision | Count |
|---|---|
| KEEP | 1369 |
| MIGRATE | 1291 |
| DERIVE | 574 |
| TEMPORARY COMPATIBILITY | 334 |
| REMOVE | 177 |

### Totals by risk

| Risk | Count |
|---|---|
| Low | 1666 |
| Medium | 1192 |
| High | 887 |

### Totals by term

| Term | Count |
|---|---|
| `rewardPoints` | 797 |
| `xpTotal` | 539 |
| `lifetimeXP` | 394 |
| `currentStreak` | 321 |
| `reversal` | 295 |
| `bestStreak` | 249 |
| `level` | 184 |
| `xpProgressInLevel` | 130 |
| `xpToNextLevel` | 128 |
| `gamification_events` | 123 |
| `gamification_summaries` | 123 |
| `longestStreak` | 85 |
| `behaviour_events` | 84 |
| `gamification_state` | 58 |
| `weeklyPoints` | 53 |
| `redeemReward` | 43 |
| `task_occurrences` | 33 |
| `levelProgressForXp` | 26 |
| `approveTaskCompletion` | 24 |
| `claimChallenge` | 18 |
| `unlockAvatar` | 10 |
| `leaderboard` | 8 |
| `levelFromXp` | 8 |
| `createChallenge` | 6 |
| `weeklyXP` | 6 |

### Full occurrence table

#### `firestore.rules` — MIGRATE · Phase 1-5 · risk High

> Rules tighten to deny all client gamification writes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 506 | `behaviour_events` | calculate | families/{f}/behaviour_events | Behaviour intent log | `let eventPath = /databases/$(database)/documents/families/$(familyId)/behaviour_events/$(eventId);` |
| 695 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `&& diff.hasOnly(['rewardPoints', 'lastRedemptionId'])` |
| 697 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `&& tx.data.costPaid == (oldData.get('rewardPoints', 0) - data.get('rewardPoints', 0))` |
| 700 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `&& data.get('rewardPoints', 0) >= 0` |
| 706 | `lifetimeXP` | calculate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// Task approval mutation: DENY client rewardPoints/lifetimeXP writes.` |
| 706 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `// Task approval mutation: DENY client rewardPoints/lifetimeXP writes.` |
| 732 | `behaviour_events` | calculate | families/{f}/behaviour_events | Behaviour intent log | `let event = getAfter(/databases/$(database)/documents/families/$(familyId)/behaviour_events/$(eventId));` |
| 735 | `behaviour_events` | calculate | families/{f}/behaviour_events | Behaviour intent log | `&& !exists(/databases/$(database)/documents/families/$(familyId)/behaviour_events/$(eventId))` |
| 736 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `&& data.get('rewardPoints', 0) == oldData.get('rewardPoints', 0) + event.data.pointsDelta` |
| 739 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `&& data.diff(oldData).affectedKeys().hasOnly(['rewardPoints', 'lifetimeXP', 'lastBehaviourEventId'])` |
| 739 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `&& data.diff(oldData).affectedKeys().hasOnly(['rewardPoints', 'lifetimeXP', 'lastBehaviourEventId'])` |
| 740 | `lifetimeXP` | calculate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `&& data.get('lifetimeXP', 0) == oldData.get('lifetimeXP', 0) + event.data.pointsDelta)` |
| 742 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `&& data.diff(oldData).affectedKeys().hasOnly(['rewardPoints', 'lastBehaviourEventId']))` |
| 753 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `&& oldUser.data.rewardPoints >= data.costPaid` |
| 754 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `&& user.data.rewardPoints == oldUser.data.rewardPoints - data.costPaid` |
| 901 | `behaviour_events` | calculate | families/{f}/behaviour_events | Behaviour intent log | `&& exists(/databases/$(database)/documents/families/$(familyId)/behaviour_events/$(sourceId))` |
| 902 | `behaviour_events` | calculate | families/{f}/behaviour_events | Behaviour intent log | `&& get(/databases/$(database)/documents/families/$(familyId)/behaviour_events/$(sourceId)).data.get('effectSnapshot', null) == snapshot)` |
| 922 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& inverse.schemaVersion == 1 && inverse.entityType == 'reversal'` |
| 953 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `let reversal = getAfter(/databases/$(database)/documents/families/$(familyId)/reversals/$(reversalId));` |
| 954 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `return reversal != null` |
| 957 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& data.sourceKind == reversal.data.sourceKind && data.sourceId == reversal.data.sourceId` |
| 958 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& data.actorId == authProfileId() && data.actorName == reversal.data.actorName` |
| 959 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& data.reason == reversal.data.reason && data.effectSnapshot == reversal.data.inverseEffectSnapshot` |
| 967 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `let reversal = getAfter(/databases/$(database)/documents/families/$(familyId)/reversals/$(reversalId));` |
| 968 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `let original = reversal == null ? {} : reversal.data.originalEffectSnapshot;` |
| 969 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `let inverse = reversal == null ? {} : reversal.data.inverseEffectSnapshot;` |
| 973 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `return reversal != null && reversal.data.actorId == authProfileId()` |
| 983 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `let reversal = getAfter(/databases/$(database)/documents/families/$(familyId)/reversals/$(data.get('reversalId', 'null')));` |
| 984 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `let original = reversal == null ? {} : reversal.data.originalEffectSnapshot;` |
| 985 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `let inverse = reversal == null ? {} : reversal.data.inverseEffectSnapshot;` |
| 988 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `return reversal != null && data.keys().hasOnly(['type', 'familyId', 'sourceKind', 'sourceId', 'reversalId', 'actorId', 'actorName', 'childId', 'amountPence', 'e` |
| 989 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& data.type == 'reversal' && data.familyId == familyId` |
| 990 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& data.sourceKind == reversal.data.sourceKind && data.sourceId == reversal.data.sourceId` |
| 991 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& data.actorId == authProfileId() && data.actorName == reversal.data.actorName` |
| 992 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& data.effectSnapshot == reversal.data.inverseEffectSnapshot && data.createdAt == request.time` |
| 1000 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `let reversal = getAfter(/databases/$(database)/documents/families/$(familyId)/reversals/$(reversalId));` |
| 1001 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `return reversal != null && reversal.data.actorId == authProfileId()` |
| 1002 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& reversal.data.originalEffectSnapshot.get('fundId', '') == fundId` |
| 1004 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `&& data.balance == oldData.balance + reversal.data.inverseEffectSnapshot.get('fundDeltaPence', 0)` |
| 1010 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `let reversal = getAfter(/databases/$(database)/documents/families/$(familyId)/reversals/$(data.get('reversalId', 'null')));` |
| 1011 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `return reversal != null && txId == data.reversalId + '__fund'` |
| 1013 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& data.type == 'reversal' && data.familyId == familyId` |
| 1014 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& data.fundId == reversal.data.originalEffectSnapshot.get('fundId', '')` |
| 1015 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& data.amount == reversal.data.inverseEffectSnapshot.get('fundDeltaPence', 0)` |
| 1016 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& data.sourceKind == reversal.data.sourceKind && data.sourceId == reversal.data.sourceId` |
| 1017 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& data.actorId == authProfileId() && data.actorName == reversal.data.actorName` |
| 1018 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& data.effectSnapshot == reversal.data.inverseEffectSnapshot && data.createdAt == request.time;` |
| 1026 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `let reversal = getAfter(/databases/$(database)/documents/families/$(familyId)/reversals/$(reversalId));` |
| 1027 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `return reversal != null && reversal.data.actorId == authProfileId()` |
| 1028 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& reversal.data.originalEffectSnapshot.get('childId', '') == uid` |
| 1029 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `&& 'pointsDelta' in reversal.data.originalEffectSnapshot` |
| 1030 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `&& data.diff(oldData).affectedKeys().hasOnly(['rewardPoints', 'lastReversalId'])` |
| 1031 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `&& data.get('rewardPoints', 0) == oldData.get('rewardPoints', 0) + reversal.data.inverseEffectSnapshot.get('pointsDelta', 0)` |
| 1031 | `rewardPoints` | calculate | families/{f}/reversals | Spendable Reward Points balance (RP) | `&& data.get('rewardPoints', 0) == oldData.get('rewardPoints', 0) + reversal.data.inverseEffectSnapshot.get('pointsDelta', 0)` |
| 1032 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `&& data.get('rewardPoints', 0) >= 0;` |
| 1078 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `&& data.diff(resource.data).affectedKeys().hasOnly(['uid', 'joinRequestId', 'familyId', 'role', 'displayName', 'avatarUrl', 'rewardPoints', 'lifetimeXP', 'curre` |
| 1078 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `&& data.diff(resource.data).affectedKeys().hasOnly(['uid', 'joinRequestId', 'familyId', 'role', 'displayName', 'avatarUrl', 'rewardPoints', 'lifetimeXP', 'curre` |
| 1078 | `longestStreak` | read | users.longestStreak | Legacy best-streak counter on the user doc | `&& data.diff(resource.data).affectedKeys().hasOnly(['uid', 'joinRequestId', 'familyId', 'role', 'displayName', 'avatarUrl', 'rewardPoints', 'lifetimeXP', 'curre` |
| 1078 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `&& data.diff(resource.data).affectedKeys().hasOnly(['uid', 'joinRequestId', 'familyId', 'role', 'displayName', 'avatarUrl', 'rewardPoints', 'lifetimeXP', 'curre` |
| 1079 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `&& data.get('rewardPoints', -1) == 0 && data.get('lifetimeXP', -1) == 0` |
| 1079 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `&& data.get('rewardPoints', -1) == 0 && data.get('lifetimeXP', -1) == 0` |
| 1080 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `&& data.get('currentStreak', -1) == 0 && data.get('longestStreak', -1) == 0 && data.get('lastActiveDate', 'null') == request.time;` |
| 1080 | `longestStreak` | read | users.longestStreak | Legacy best-streak counter on the user doc | `&& data.get('currentStreak', -1) == 0 && data.get('longestStreak', -1) == 0 && data.get('lastActiveDate', 'null') == request.time;` |
| 1661 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `'role', 'familyId', 'rewardPoints', 'lifetimeXP', 'walletBalance', 'balance', 'lastFundTxId',` |
| 1661 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `'role', 'familyId', 'rewardPoints', 'lifetimeXP', 'walletBalance', 'balance', 'lastFundTxId',` |
| 1847 | `behaviour_events` | calculate | families/{f}/behaviour_events | Behaviour intent log | `match /behaviour_events/{eventId} {` |
| 1999 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `allow create: if request.resource.data.type != 'financial_penalty' && familyIsActive(familyId) && ((request.resource.data.type == 'reversal' && isValidReversalW` |
| 2234 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `allow create: if (request.resource.data.type == 'reversal' && isValidReversalFundLedger(familyId, txId))` |
| 2469 | `lifetimeXP` | calculate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// - All states: client rewardPoints/lifetimeXP writes on task completion are DENIED` |
| 2469 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `// - All states: client rewardPoints/lifetimeXP writes on task completion are DENIED` |
| 2472 | `gamification_events` | calculate | families/{f}/gamification_events | Existing XP event ledger | `// Server-only collections: task_occurrences, gamification_events, daily_eligibility,` |
| 2472 | `task_occurrences` | calculate | families/{f}/gamification_events | Server-side task occurrence dedupe records | `// Server-only collections: task_occurrences, gamification_events, daily_eligibility,` |
| 2473 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `// daily_progress, gamification_summaries, gamification_checkpoints` |
| 2474 | `task_occurrences` | calculate | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `match /task_occurrences/{occurrenceId} {` |
| 2483 | `gamification_events` | calculate | families/{f}/gamification_events | Existing XP event ledger | `match /gamification_events/{eventId} {` |
| 2491 | `gamification_state` | calculate | in-memory / derived | New V4 projection state collection | `match /gamification_state/{memberId} {` |
| 2506 | `gamification_summaries` | calculate | families/{f}/gamification_summaries | Legacy projection collection | `match /gamification_summaries/{summaryId} {` |

#### `functions/src/acceptance.test.ts` — MIGRATE · Phase 1-4 · risk Low

> Test rewritten against the V3 contract

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 4 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `* 1. Approved shared task (+20 rewardPoints, +20 xpTotal)` |
| 4 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `* 1. Approved shared task (+20 rewardPoints, +20 xpTotal)` |
| 5 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `* 2. Positive behaviour         (+20 rewardPoints, +20 xpTotal)` |
| 5 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `* 2. Positive behaviour         (+20 rewardPoints, +20 xpTotal)` |
| 6 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `* 3. Reward redemption          (-10 rewardPoints, xpTotal unchanged)` |
| 6 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `* 3. Reward redemption          (-10 rewardPoints, xpTotal unchanged)` |
| 165 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 100,` |
| 166 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 200,` |
| 167 | `weeklyPoints` | test | derived (client-computed today) | Weekly leaderboard score | `weeklyPoints: 0,` |
| 168 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 169 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 173 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 174 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 200,` |
| 175 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 800,` |
| 197 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 100,` |
| 198 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 200,` |
| 199 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 200 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 0,` |
| 233 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `[ˋ${FAMILY_PATH}/behaviour_events/${BEHAVIOUR_EVENT_ID}ˋ]: {` |
| 260 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `[ˋ${FAMILY_PATH}/gamification_summaries/${CHILD_ID}ˋ]: {` |
| 264 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 200,` |
| 265 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 266 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 267 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 282 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `it('awards +20 rewardPoints and +20 xpTotal exactly once for a shared task', async () => {` |
| 282 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `it('awards +20 rewardPoints and +20 xpTotal exactly once for a shared task', async () => {` |
| 294 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `// rewardPoints increased by 20` |
| 295 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(db.store[ˋusers/${CHILD_ID}ˋ]).toMatchObject({ rewardPoints: 120 })` |
| 296 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `// xpTotal increased by 20` |
| 297 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `expect(db.store[ˋ${FAMILY_PATH}/gamification_summaries/${CHILD_ID}ˋ]).toMatchObject({ xpTotal: 220 })` |
| 297 | `xpTotal` | test | families/{f}/gamification_summaries | Projection lifetime XP counter (authoritative today) | `expect(db.store[ˋ${FAMILY_PATH}/gamification_summaries/${CHILD_ID}ˋ]).toMatchObject({ xpTotal: 220 })` |
| 299 | `task_occurrences` | test | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `const occurrencePath = ˋ${FAMILY_PATH}/task_occurrences/${LOGICAL_KEY}ˋ` |
| 306 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `const eventCreated = db.created.some(p => p.includes('/gamification_events/'))` |
| 326 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(db.store[ˋusers/${CHILD_ID}ˋ]).toMatchObject({ rewardPoints: 120 })` |
| 327 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `expect(db.store[ˋ${FAMILY_PATH}/gamification_summaries/${CHILD_ID}ˋ]).toMatchObject({ xpTotal: 220 })` |
| 327 | `xpTotal` | test | families/{f}/gamification_summaries | Projection lifetime XP counter (authoritative today) | `expect(db.store[ˋ${FAMILY_PATH}/gamification_summaries/${CHILD_ID}ˋ]).toMatchObject({ xpTotal: 220 })` |
| 332 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `it('awards +20 rewardPoints and +20 xpTotal exactly once for a positive behaviour', async () => {` |
| 332 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `it('awards +20 rewardPoints and +20 xpTotal exactly once for a positive behaviour', async () => {` |
| 340 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `expect(db.store[ˋusers/${CHILD_ID}ˋ]).toMatchObject({ rewardPoints: 120, lifetimeXP: 220 })` |
| 340 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(db.store[ˋusers/${CHILD_ID}ˋ]).toMatchObject({ rewardPoints: 120, lifetimeXP: 220 })` |
| 341 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `expect(db.store[ˋ${FAMILY_PATH}/gamification_summaries/${CHILD_ID}ˋ]).toMatchObject({ xpTotal: 220, level: 1 })` |
| 341 | `level` | test | families/{f}/gamification_summaries | Member level | `expect(db.store[ˋ${FAMILY_PATH}/gamification_summaries/${CHILD_ID}ˋ]).toMatchObject({ xpTotal: 220, level: 1 })` |
| 341 | `xpTotal` | test | families/{f}/gamification_summaries | Projection lifetime XP counter (authoritative today) | `expect(db.store[ˋ${FAMILY_PATH}/gamification_summaries/${CHILD_ID}ˋ]).toMatchObject({ xpTotal: 220, level: 1 })` |
| 354 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `expect(db.store[ˋusers/${CHILD_ID}ˋ]).toMatchObject({ rewardPoints: 120, lifetimeXP: 220 })` |
| 354 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(db.store[ˋusers/${CHILD_ID}ˋ]).toMatchObject({ rewardPoints: 120, lifetimeXP: 220 })` |
| 355 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `expect(db.store[ˋ${FAMILY_PATH}/gamification_summaries/${CHILD_ID}ˋ]).toMatchObject({ xpTotal: 220 })` |
| 355 | `xpTotal` | test | families/{f}/gamification_summaries | Projection lifetime XP counter (authoritative today) | `expect(db.store[ˋ${FAMILY_PATH}/gamification_summaries/${CHILD_ID}ˋ]).toMatchObject({ xpTotal: 220 })` |
| 361 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `// Start with rewardPoints = 100, xpTotal = 200` |
| 361 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `// Start with rewardPoints = 100, xpTotal = 200` |
| 366 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `delete store[ˋ${FAMILY_PATH}/behaviour_events/${BEHAVIOUR_EVENT_ID}ˋ]` |
| 389 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(db.store[ˋusers/${CHILD_ID}ˋ]).toMatchObject({ rewardPoints: 120 })` |
| 390 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `expect(db.store[ˋ${FAMILY_PATH}/gamification_summaries/${CHILD_ID}ˋ]).toMatchObject({ xpTotal: 220 })` |
| 390 | `xpTotal` | test | families/{f}/gamification_summaries | Projection lifetime XP counter (authoritative today) | `expect(db.store[ˋ${FAMILY_PATH}/gamification_summaries/${CHILD_ID}ˋ]).toMatchObject({ xpTotal: 220 })` |
| 393 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `db.store[ˋ${FAMILY_PATH}/behaviour_events/${BEHAVIOUR_EVENT_ID}ˋ] = {` |
| 406 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(db.store[ˋusers/${CHILD_ID}ˋ]).toMatchObject({ rewardPoints: 140 })` |
| 407 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `expect(db.store[ˋ${FAMILY_PATH}/gamification_summaries/${CHILD_ID}ˋ]).toMatchObject({ xpTotal: 240 })` |
| 407 | `xpTotal` | test | families/{f}/gamification_summaries | Projection lifetime XP counter (authoritative today) | `expect(db.store[ˋ${FAMILY_PATH}/gamification_summaries/${CHILD_ID}ˋ]).toMatchObject({ xpTotal: 240 })` |
| 411 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `// The users.rewardPoints decrement is done by the client in api.ts.` |
| 414 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const currentPoints = (db.store[childRef] as any).rewardPoints` |
| 415 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `db.store[childRef] = { ...db.store[childRef] as any, rewardPoints: currentPoints - 10 }` |
| 416 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(db.store[childRef]).toMatchObject({ rewardPoints: 130 })` |
| 417 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `// xpTotal unchanged` |
| 418 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `expect(db.store[ˋ${FAMILY_PATH}/gamification_summaries/${CHILD_ID}ˋ]).toMatchObject({ xpTotal: 240 })` |
| 418 | `xpTotal` | test | families/{f}/gamification_summaries | Projection lifetime XP counter (authoritative today) | `expect(db.store[ˋ${FAMILY_PATH}/gamification_summaries/${CHILD_ID}ˋ]).toMatchObject({ xpTotal: 240 })` |
| 429 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(db.store[childRef]).toMatchObject({ rewardPoints: 130 })` |
| 430 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `expect(db.store[ˋ${FAMILY_PATH}/gamification_summaries/${CHILD_ID}ˋ]).toMatchObject({ xpTotal: 240 })` |
| 430 | `xpTotal` | test | families/{f}/gamification_summaries | Projection lifetime XP counter (authoritative today) | `expect(db.store[ˋ${FAMILY_PATH}/gamification_summaries/${CHILD_ID}ˋ]).toMatchObject({ xpTotal: 240 })` |
| 433 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(db.store[childRef]).toMatchObject({ rewardPoints: 130 })` |
| 434 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `expect(db.store[ˋ${FAMILY_PATH}/gamification_summaries/${CHILD_ID}ˋ]).toMatchObject({ xpTotal: 240 })` |
| 434 | `xpTotal` | test | families/{f}/gamification_summaries | Projection lifetime XP counter (authoritative today) | `expect(db.store[ˋ${FAMILY_PATH}/gamification_summaries/${CHILD_ID}ˋ]).toMatchObject({ xpTotal: 240 })` |

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
| 54 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `* are derived here inside a single transaction. ˋusers.lifetimeXPˋ is written` |
| 55 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `* only as a COMPATIBILITY MIRROR of ˋgamification_summaries.xpTotalˋ and must` |
| 55 | `xpTotal` | read | families/{f}/gamification_summaries | Projection lifetime XP counter (authoritative today) | `* only as a COMPATIBILITY MIRROR of ˋgamification_summaries.xpTotalˋ and must` |
| 65 | `behaviour_events` | read | families/{f}/behaviour_events | Behaviour intent log | `const eventRef = familyRef.collection('behaviour_events').doc(args.behaviourEventId)` |
| 75 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `const summaryRef = familyRef.collection('gamification_summaries').doc(childId)` |
| 86 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `const gamificationEventRef = familyRef.collection('gamification_events').doc(behaviourGamificationEventId(args.behaviourEventId))` |
| 99 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `currentRewardPoints: integer(child.rewardPoints),` |
| 100 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `currentXpTotal: integer(summary?.xpTotal),` |
| 101 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `currentLifetimeXP: integer(child.lifetimeXP),` |
| 108 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `// which would silently discard the authoritative rewardPoints/summary` |
| 141 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: plan.nextRewardPoints,` |
| 142 | `xpTotal` | calculate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `// Compatibility-only mirror; authoritative XP is summary.xpTotal.` |
| 143 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: plan.nextLifetimeXP,` |
| 151 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: plan.nextXpTotal,` |
| 189 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `* for the delta math, the same ˋusers.rewardPointsˋ + ˋusers.lifetimeXPˋ` |
| 189 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `* for the delta math, the same ˋusers.rewardPointsˋ + ˋusers.lifetimeXPˋ` |
| 190 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `* compatibility mirror, the ˋgamification_summariesˋ projection, the` |
| 191 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `* immutable ˋgamification_eventsˋ ledger, and the V3 shadow. No parallel` |
| 208 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `const summaryRef = familyRef.collection('gamification_summaries').doc(args.childId)` |
| 220 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `const gamificationEventRef = familyRef.collection('gamification_events').doc(behaviourGamificationEventId(syntheticId))` |
| 245 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `currentRewardPoints: integer(child.rewardPoints),` |
| 246 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `currentXpTotal: integer(summary?.xpTotal),` |
| 247 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `currentLifetimeXP: integer(child.lifetimeXP),` |
| 284 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: plan.nextRewardPoints,` |
| 285 | `xpTotal` | calculate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `// Compatibility-only mirror; authoritative XP is summary.xpTotal.` |
| 286 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: plan.nextLifetimeXP,` |
| 293 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: plan.nextXpTotal,` |

#### `functions/src/challengeClaim.test.ts` — MIGRATE · Phase 1-4 · risk Low

> Test rewritten against the V3 contract

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 15 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `//   - the SERVER writes rewardPoints/lifetimeXP (client must NOT — see` |
| 15 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `//   - the SERVER writes rewardPoints/lifetimeXP (client must NOT — see` |
| 156 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `rewardPoints: 100, lifetimeXP: overrides.child1XP ?? 200,` |
| 156 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 100, lifetimeXP: overrides.child1XP ?? 200,` |
| 160 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `rewardPoints: 50, lifetimeXP: overrides.child2XP ?? 150,` |
| 160 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 50, lifetimeXP: overrides.child2XP ?? 150,` |
| 164 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `familyId: FAMILY_ID, role: 'child', status: 'deleted', rewardPoints: 0, lifetimeXP: 0,` |
| 164 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `familyId: FAMILY_ID, role: 'child', status: 'deleted', rewardPoints: 0, lifetimeXP: 0,` |
| 170 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: REWARD,` |
| 197 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(harness.store.get(ˋusers/${CHILD_1}ˋ)?.rewardPoints).toBe(100)` |
| 225 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(harness.store.get(ˋusers/${CHILD_1}ˋ)?.rewardPoints).toBe(100)` |
| 231 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `isActive: false, targetXP: 300, startXP: 0, rewardPoints: REWARD, title: 'Done',` |
| 246 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(harness.store.get(ˋusers/${CHILD_1}ˋ)?.rewardPoints).toBe(125)` |
| 247 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `expect(harness.store.get(ˋusers/${CHILD_1}ˋ)?.lifetimeXP).toBe(225)` |
| 248 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(harness.store.get(ˋusers/${CHILD_2}ˋ)?.rewardPoints).toBe(75)` |
| 249 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `expect(harness.store.get(ˋusers/${CHILD_2}ˋ)?.lifetimeXP).toBe(175)` |
| 252 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(harness.store.get(ˋusers/child-deletedˋ)?.rewardPoints).toBe(0)` |
| 281 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `const events = Array.from(harness.store.keys()).filter(k => k.includes('/gamification_events/'))` |
| 300 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(harness.store.get(ˋusers/${CHILD_1}ˋ)?.rewardPoints).toBe(125)` |
| 301 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(harness.store.get(ˋusers/${CHILD_2}ˋ)?.rewardPoints).toBe(75)` |
| 304 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `const events = Array.from(harness.store.keys()).filter(k => k.includes('/gamification_events/'))` |
| 335 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `harness.store.set(ˋfamilies/${FAMILY_ID}/gamification_events/behaviour_xp:${syntheticId}ˋ, {` |
| 358 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('still denies client rewardPoints/lifetimeXP writes on users/{uid}', () => {` |
| 358 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `it('still denies client rewardPoints/lifetimeXP writes on users/{uid}', () => {` |
| 359 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `expect(rules).toContain("'rewardPoints', 'lifetimeXP'")` |
| 359 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(rules).toContain("'rewardPoints', 'lifetimeXP'")` |

#### `functions/src/challengeClaim.ts` — KEEP · n/a · risk Low

> Unclassified — review before Phase 1

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 5 | `claimChallenge` | calculate | in-memory / derived | Family challenge claim (RP + XP credit) | `* The client ˋclaimChallengeˋ (src/lib/api.ts) only invokes this callable; it` |
| 6 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `* never writes ˋrewardPointsˋ / ˋlifetimeXPˋ itself (Firestore rules correctly` |
| 6 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `* never writes ˋrewardPointsˋ / ˋlifetimeXPˋ itself (Firestore rules correctly` |
| 91 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints?: number` |
| 114 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `//    source is ˋgamification_summaries.xpTotalˋ — ˋusers.lifetimeXPˋ is only a` |
| 114 | `lifetimeXP` | read | families/{f}/gamification_summaries | Legacy duplicate lifetime XP counter | `//    source is ˋgamification_summaries.xpTotalˋ — ˋusers.lifetimeXPˋ is only a` |
| 114 | `xpTotal` | read | families/{f}/gamification_summaries | Projection lifetime XP counter (authoritative today) | `//    source is ˋgamification_summaries.xpTotalˋ — ˋusers.lifetimeXPˋ is only a` |
| 117 | `xpTotal` | calculate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `//    authoritative xpTotal per eligible child. This is server-computed; the` |
| 120 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `.collection(ˋfamilies/${input.familyId}/gamification_summariesˋ)` |
| 124 | `xpTotal` | write | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpByChild.set(d.id, integer((d.data() as { xpTotal?: number }).xpTotal))` |
| 128 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// Fall back to the lifetimeXP mirror only if a summary is missing, so a` |
| 131 | `lifetimeXP` | calculate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `return acc + (typeof summaryXp === 'number' ? summaryXp : integer((d.data() as { lifetimeXP?: number }).lifetimeXP))` |
| 138 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `const rewardPoints = integer(challenge.rewardPoints)` |
| 151 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `points: rewardPoints,` |
| 187 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `body: ˋYou earned +${rewardPoints} pointsˋ,` |
| 192 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `metadata: { challengeTitle: title, rewardPoints },` |
| 198 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `text: ˋFamily Challenge Completed: ${title}! Everyone got +${rewardPoints} pts!ˋ,` |

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

#### `functions/src/gamification/runtimeCutoverConfig.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 153 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `fs._set(ˋfamilies/${FAMILY}/gamification_events/e1ˋ, { eventId: 'e1' })` |
| 154 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `fs._set(ˋfamilies/${FAMILY}/gamification_state/m1ˋ, { memberId: 'm1' })` |
| 166 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect(fs._get(ˋfamilies/${FAMILY}/gamification_events/e1ˋ)).toBeTruthy()` |
| 167 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `expect(fs._get(ˋfamilies/${FAMILY}/gamification_state/m1ˋ)).toBeTruthy()` |

#### `functions/src/gamification/v4/avatarUnlock.emulator.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 75 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(stored!.rewardPoints).toBe(30)` |
| 82 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(30)` |

#### `functions/src/gamification/v4/avatarUnlock.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 139 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(stored!.rewardPoints).toBe(30)` |
| 140 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(stored!.xpTotal).toBe(50)` |
| 151 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(30)` |
| 163 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(stored!.rewardPoints).toBe(80)` |
| 188 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect(path).toMatch(/^families\/[^/]+\/(gamification_events\|gamification_state)\//)` |
| 188 | `gamification_state` | test | families/{f}/gamification_events | New V4 projection state collection | `expect(path).toMatch(/^families\/[^/]+\/(gamification_events\|gamification_state)\//)` |

#### `functions/src/gamification/v4/avatarUnlockWriter.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 4 | `unlockAvatar` | calculate | in-memory / derived | Avatar unlock (RP debit) | `* V4 side of the avatar-unlock cutover (legacy: ˋsrc/lib/api.ts#unlockAvatarˋ,` |
| 24 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `*   - No legacy rewardPoints write, no wallet document.` |
| 145 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `const available = current?.rewardPoints ?? 0` |

#### `functions/src/gamification/v4/behaviour.emulator.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 88 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(stored!.rewardPoints).toBe(7)` |
| 89 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(stored!.xpTotal).toBe(12)` |
| 94 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect(collections.map((c) => c.id).sort()).toEqual(['gamification_events', 'gamification_state'])` |
| 94 | `gamification_state` | test | families/{f}/gamification_events | New V4 projection state collection | `expect(collections.map((c) => c.id).sort()).toEqual(['gamification_events', 'gamification_state'])` |
| 99 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await readState(db, OTHER_FAMILY, MEMBER))!.rewardPoints).toBe(3)` |
| 105 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(7)` |

#### `functions/src/gamification/v4/behaviour.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 163 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(10)` |
| 181 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(stored!.rewardPoints).toBe(18)` |
| 182 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(stored!.xpTotal).toBe(30)` |
| 189 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(stored!.rewardPoints).toBe(0)` |
| 190 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(stored!.xpTotal).toBe(0)` |
| 197 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect(path).toMatch(/^families\/[^/]+\/(gamification_events\|gamification_state)\//)` |
| 197 | `gamification_state` | test | families/{f}/gamification_events | New V4 projection state collection | `expect(path).toMatch(/^families\/[^/]+\/(gamification_events\|gamification_state)\//)` |
| 208 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(10)` |
| 209 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await readState(db, FAMILY, 'mem-2'))!.rewardPoints).toBe(7)` |
| 210 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await readState(db, 'fam-other', MEMBER))!.rewardPoints).toBe(3)` |

#### `functions/src/gamification/v4/behaviourWriter.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 21 | `lifetimeXP` | calculate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `*   - No legacy rewardPoints / lifetimeXP write, no wallet document.` |
| 21 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `*   - No legacy rewardPoints / lifetimeXP write, no wallet document.` |

#### `functions/src/gamification/v4/dayFinalization.emulator.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 29 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `dailyGoal: { rewardPoints: 10, xp: 10 },` |
| 30 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `perfectDay: { rewardPoints: 25, xp: 25 },` |
| 65 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(stored!.rewardPoints).toBe(35)` |

#### `functions/src/gamification/v4/dayFinalization.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 47 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `dailyGoal: { rewardPoints: 10, xp: 10 },` |
| 96 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const full = facts({ perfectDay: { rewardPoints: 25, xp: 25 } })` |
| 113 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(() => buildDailyGoalEventV4(facts({ dailyGoal: { rewardPoints: -1, xp: 0 } }))).toThrow(` |
| 134 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `facts({ perfectDay: { rewardPoints: 25, xp: 25 } }),` |
| 148 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(stored!.rewardPoints).toBe(35)` |
| 149 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(stored!.xpTotal).toBe(35)` |
| 154 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const full = facts({ perfectDay: { rewardPoints: 25, xp: 25 } })` |
| 161 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(35)` |
| 169 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `facts({ perfectDay: { rewardPoints: 25, xp: 25 } }),` |
| 174 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(35)` |
| 201 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect(path).toMatch(/^families\/[^/]+\/(gamification_events\|gamification_state)\//)` |
| 201 | `gamification_state` | test | families/{f}/gamification_events | New V4 projection state collection | `expect(path).toMatch(/^families\/[^/]+\/(gamification_events\|gamification_state)\//)` |

#### `functions/src/gamification/v4/dayFinalizationWriter.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 23 | `lifetimeXP` | calculate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `*   - No legacy rewardPoints / lifetimeXP write, no wallet document.` |
| 23 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `*   - No legacy rewardPoints / lifetimeXP write, no wallet document.` |
| 59 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `readonly rewardPoints: number` |
| 103 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `assertNonNegativeIntegerV4(award.rewardPoints, ˋ${label}.rewardPointsˋ)` |
| 152 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPointsDelta: award.rewardPoints,` |
| 156 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `awardedPoints: award.rewardPoints,` |

#### `functions/src/gamification/v4/manualAdjustment.emulator.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 73 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(stored!.rewardPoints).toBe(35)` |
| 74 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(stored!.xpTotal).toBe(10)` |
| 80 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(35)` |
| 89 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(stored!.rewardPoints).toBe(0)` |
| 90 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(stored!.xpTotal).toBe(10)` |

#### `functions/src/gamification/v4/manualAdjustment.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 149 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(stored!.rewardPoints).toBe(35)` |
| 150 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(stored!.xpTotal).toBe(10)` |
| 159 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(stored!.rewardPoints).toBe(0)` |
| 160 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(stored!.xpTotal).toBe(10)` |
| 171 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(35)` |
| 190 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(30)` |
| 197 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect(path).toMatch(/^families\/[^/]+\/(gamification_events\|gamification_state)\//)` |
| 197 | `gamification_state` | test | families/{f}/gamification_events | New V4 projection state collection | `expect(path).toMatch(/^families\/[^/]+\/(gamification_events\|gamification_state)\//)` |
| 207 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(25)` |
| 208 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await readState(db, FAMILY, 'mem-2'))!.rewardPoints).toBe(7)` |
| 209 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await readState(db, 'fam-other', MEMBER))!.rewardPoints).toBe(5)` |

#### `functions/src/gamification/v4/manualAdjustmentWriter.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 5 | `claimChallenge` | calculate | in-memory / derived | Family challenge claim (RP + XP credit) | `* parent "adjust points" and ˋclaimChallengeˋ paths in ˋsrc/lib/api.tsˋ).` |
| 20 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `*     an explicit reversal.` |
| 28 | `lifetimeXP` | calculate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `*   - No legacy rewardPoints / lifetimeXP write, no wallet document.` |
| 28 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `*   - No legacy rewardPoints / lifetimeXP write, no wallet document.` |

#### `functions/src/gamification/v4/no-dual-write.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 53 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `userFields: { rewardPoints: 100, lifetimeXP: 200, lastTaskCompletionId: 'older-completion' },` |
| 53 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `userFields: { rewardPoints: 100, lifetimeXP: 200, lastTaskCompletionId: 'older-completion' },` |
| 54 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `summaryPath: ˋfamilies/${FAMILY}/gamification_summaries/${MEMBER}ˋ,` |
| 59 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 200,` |
| 60 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 61 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 2,` |
| 62 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 3,` |
| 75 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 100,` |
| 76 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 200,` |
| 77 | `weeklyPoints` | test | derived (client-computed today) | Weekly leaderboard score | `weeklyPoints: 25,` |
| 79 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 80 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 200,` |
| 81 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 800,` |
| 83 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 2,` |
| 84 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 3,` |
| 166 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `it('detects an additional legacy users.rewardPoints award', () => {` |
| 168 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `after.legacy.userFields.rewardPoints = 110` |
| 172 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('detects an additional legacy users.lifetimeXP award', () => {` |
| 174 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `after.legacy.userFields.lifetimeXP = 210` |
| 180 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `after.legacy.summaryFields.xpTotal = 210` |
| 187 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `after.legacy.v3StateFields.xpTotal = 210` |
| 207 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: before.v4.stateBusiness!.rewardPoints + 1,` |

#### `functions/src/gamification/v4/rebuildFunction.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 218 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(result['mem-1'].rewardPoints).toBe(30)` |
| 219 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(result['mem-1'].xpTotal).toBe(40)` |
| 221 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(result['mem-2'].rewardPoints).toBe(5)` |
| 222 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(result['mem-2'].xpTotal).toBe(5)` |
| 226 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(stored1.rewardPoints).toBe(30)` |
| 227 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(stored2.rewardPoints).toBe(5)` |
| 259 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `.filter((p) => p.includes('gamification_state'))` |
| 272 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `const stateKeys = store.entries().map(([p]) => p).filter((p) => p.includes('gamification_state'))` |
| 283 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `const stateKeys = store.entries().map(([p]) => p).filter((p) => p.includes('gamification_state'))` |
| 307 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `expect(store.read(ˋgamification_state/mem-1ˋ)).toBeUndefined()` |
| 317 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((store.read(stateDocPath(FAMILY, 'mem-1')) as GamificationStateV4).rewardPoints).toBe(20)` |
| 318 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((store.read(stateDocPath(FAMILY, 'mem-2')) as GamificationStateV4).rewardPoints).toBe(99)` |
| 328 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect(store.collectionCalls).toEqual(expect.arrayContaining(['families', 'gamification_events']))` |
| 339 | `behaviour_events` | test | families/{f}/gamification_summaries | Behaviour intent log | `.filter((p) => /gamification_summaries\|daily_progress\|task_occurrences\|behaviour_events/.test(p))` |
| 339 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `.filter((p) => /gamification_summaries\|daily_progress\|task_occurrences\|behaviour_events/.test(p))` |
| 339 | `task_occurrences` | test | families/{f}/gamification_summaries | Server-side task occurrence dedupe records | `.filter((p) => /gamification_summaries\|daily_progress\|task_occurrences\|behaviour_events/.test(p))` |
| 384 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(snap.get('rewardPoints')).toBe(30)` |
| 385 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(snap.get('xpTotal')).toBe(40)` |
| 386 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(result['mem-1'].rewardPoints).toBe(30)` |
| 389 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `it('creates NO document at the root-level gamification_state path', async () => {` |
| 434 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(mem1[0].get('rewardPoints')).toBe(7)` |
| 443 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `expect(names).toContain('gamification_state')` |
| 444 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect(names).toContain('gamification_events')` |

#### `functions/src/gamification/v4/rebuildFunction.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 44 | `gamification_state` | read | in-memory / derived | New V4 projection state collection | `* ˋfamilies/{familyId}/gamification_state/{memberId}ˋ path in a single` |

#### `functions/src/gamification/v4/repository.emulator.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 9 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `*   - ˋwriteStateˋ persists to ˋfamilies/{familyId}/gamification_state/{memberId}ˋ` |
| 11 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `*   - NO document is created at the old root-level ˋgamification_state/{memberId}ˋ;` |
| 46 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 20,` |
| 47 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 20,` |
| 48 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 49 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 20,` |
| 50 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 980,` |
| 52 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 1,` |
| 53 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 1,` |
| 105 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(snap.get('rewardPoints')).toBe(20)` |
| 109 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `it('creates NO document at the old root-level gamification_state path', async () => {` |
| 118 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `// Collection-group scan finds every gamification_state doc in the project.` |
| 125 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `await writeState(db, FAMILY_A, MEMBER, makeState({ rewardPoints: 20 }))` |
| 126 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `await writeState(db, FAMILY_B, MEMBER, makeState({ rewardPoints: 99 }))` |
| 131 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(a.get('rewardPoints')).toBe(20)` |
| 132 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(b.get('rewardPoints')).toBe(99)` |
| 137 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const state = makeState({ rewardPoints: 42 })` |
| 140 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(read?.rewardPoints).toBe(42)` |
| 179 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(stored.rewardPoints).toBe(30) // 20 + 20 - 10` |
| 180 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(stored.xpTotal).toBe(40) // 20 + 20` |

#### `functions/src/gamification/v4/repository.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 143 | `level` | test | in-memory / derived | Member level | `rewardPoints: 20, xpTotal: 20, level: 1, xpProgressInLevel: 20, xpToNextLevel: 980,` |
| 143 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 20, xpTotal: 20, level: 1, xpProgressInLevel: 20, xpToNextLevel: 980,` |
| 143 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `rewardPoints: 20, xpTotal: 20, level: 1, xpProgressInLevel: 20, xpToNextLevel: 980,` |
| 143 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `rewardPoints: 20, xpTotal: 20, level: 1, xpProgressInLevel: 20, xpToNextLevel: 980,` |
| 143 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `rewardPoints: 20, xpTotal: 20, level: 1, xpProgressInLevel: 20, xpToNextLevel: 980,` |
| 144 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `levelProgressPercentage: 2, currentStreak: 1, bestStreak: 1, lastQualifiedDayKey: '2026-01-05',` |
| 144 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `levelProgressPercentage: 2, currentStreak: 1, bestStreak: 1, lastQualifiedDayKey: '2026-01-05',` |
| 178 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `const stored = store.read(ˋfamilies/fam-A/gamification_events/${event.eventId}ˋ) as GamificationEventV4` |
| 194 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect(keys.filter((p) => p.startsWith('families/fam-A/gamification_events/'))).toHaveLength(1)` |
| 202 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect(keys.filter((p) => p.includes('gamification_events'))).toHaveLength(0)` |
| 219 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect(store.read(ˋfamilies/fam-A/gamification_events/${event.eventId}ˋ)).toBeUndefined()` |
| 245 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(stored.rewardPoints).toBe(20)` |
| 248 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `it('never writes a root-level gamification_state document', async () => {` |
| 251 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `expect(store.read('gamification_state/mem-1')).toBeUndefined()` |
| 260 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `.filter((p) => p.includes('gamification_state'))` |
| 261 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `expect(statePaths).toEqual(['families/fam-A/gamification_state/mem-1'])` |
| 273 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `await writeState(db, 'fam-A', 'mem-1', makeState({ rewardPoints: 20 }))` |
| 274 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `await writeState(db, 'fam-A', 'mem-2', makeState({ rewardPoints: 99 }))` |
| 275 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((store.read(stateDocPath('fam-A', 'mem-1')) as GamificationStateV4).rewardPoints).toBe(20)` |
| 276 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((store.read(stateDocPath('fam-A', 'mem-2')) as GamificationStateV4).rewardPoints).toBe(99)` |
| 281 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `await writeState(db, 'fam-A', 'mem-1', makeState({ rewardPoints: 20 }))` |
| 282 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `await writeState(db, 'fam-B', 'mem-1', makeState({ rewardPoints: 99 }))` |
| 283 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((store.read(stateDocPath('fam-A', 'mem-1')) as GamificationStateV4).rewardPoints).toBe(20)` |
| 284 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((store.read(stateDocPath('fam-B', 'mem-1')) as GamificationStateV4).rewardPoints).toBe(99)` |
| 310 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(stored.rewardPoints).toBe(30) // 20 + 20 - 10` |
| 311 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(stored.xpTotal).toBe(40) // 20 + 20` |
| 323 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect.arrayContaining(['families', 'gamification_events', 'gamification_state']),` |
| 323 | `gamification_state` | test | families/{f}/gamification_events | New V4 projection state collection | `expect.arrayContaining(['families', 'gamification_events', 'gamification_state']),` |

#### `functions/src/gamification/v4/repository.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 112 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `* Resolve the canonical ˋfamilies/{familyId}/gamification_eventsˋ collection.` |
| 123 | `gamification_state` | read | in-memory / derived | New V4 projection state collection | `/** Resolve the canonical ˋfamilies/{familyId}/gamification_stateˋ collection. */` |
| 133 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `* ˋfamilies/{familyId}/gamification_events/{eventId}ˋ.` |
| 162 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `* ˋfamilies/{familyId}/gamification_eventsˋ. Only events stored under the` |
| 176 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `* ˋfamilies/{familyId}/gamification_events/{eventId}ˋ.` |
| 198 | `gamification_state` | read | in-memory / derived | New V4 projection state collection | `* ˋfamilies/{familyId}/gamification_state/{memberId}ˋ` |

#### `functions/src/gamification/v4/reversal.emulator.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 2 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `* Gamification V4 — Task 7.5 refund / reversal, REAL Firestore emulator.` |
| 25 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `describeEmulator('Task 7.5 — V4 reversal against the real Firestore emulator', () => {` |
| 48 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('appends a reversal that negates the original and leaves it intact', async () => {` |
| 69 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(stored!.rewardPoints).toBe(0)` |
| 70 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(stored!.xpTotal).toBe(0)` |

#### `functions/src/gamification/v4/reversal.writer.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 2 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `* Gamification V4 — Task 7.5 refund / reversal cutover tests.` |
| 77 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `describe('Task 7.5 — reversal routing is legacy XOR v4', () => {` |
| 112 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `describe('Task 7.5 — V4 reversal write semantics', () => {` |
| 113 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('appends a reversal that exactly negates the original', async () => {` |
| 125 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(stored!.rewardPoints).toBe(0)` |
| 126 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(stored!.xpTotal).toBe(0)` |
| 161 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(0)` |
| 195 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(stored!.rewardPoints).toBe(50)` |
| 196 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(stored!.xpTotal).toBe(50)` |
| 207 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('refuses to reverse a reversal', async () => {` |
| 210 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `const reversal = await applyReversalV4(db, reversalFacts())` |
| 213 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `applyReversalV4(db, reversalFacts({ originalEventId: reversal.eventId })),` |
| 217 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('refuses a cross-member reversal', async () => {` |

#### `functions/src/gamification/v4/reversalWriter.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 4 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `* V4 side of the refund/reversal cutover (legacy: the task-invalidation path in` |
| 6 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `* reversal APIs in ˋsrc/lib/api.tsˋ + ˋreversalApi.tsˋ). Reached ONLY when the` |
| 14 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `*   - A reversal is an APPEND, never a delete or an edit. The original event` |
| 15 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `*     stays in the ledger forever; the reversal negates it.` |
| 16 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `*   - Exactly ONE reversal per original: the deltas are derived from the stored` |
| 29 | `lifetimeXP` | calculate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `*   - No legacy rewardPoints / lifetimeXP write, no wallet document.` |
| 29 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `*   - No legacy rewardPoints / lifetimeXP write, no wallet document.` |
| 43 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `} from '../../../../src/domain/gamification/v4/reversal'` |
| 46 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `/** Thrown when the reversal facts handed to the V4 writer are unusable. */` |
| 62 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `/** Thrown when the target of a reversal is itself a reversal. */` |
| 65 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `super(ˋevent ${eventId} is a reversal and cannot itself be reversedˋ)` |
| 70 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `/** The already-validated facts of ONE refund / reversal. */` |
| 89 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `* Build the ONE canonical reversal event for a stored original.` |
| 91 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `* Delegates the negation to the canonical domain builder (no second reversal` |
| 124 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `* Apply ONE refund / reversal through the V4 engine.` |
| 127 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `*   1. Load the original event — a reversal without an original fails closed.` |
| 128 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `*   2. Build the canonical reversal (deltas derived from the stored original).` |
| 130 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `*   4. Append the reversal and rebuild the projection (shared writer core).` |
| 141 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `throw new ReversalInputError('reversal facts must be an object')` |

#### `functions/src/gamification/v4/rewardRedemption.emulator.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 76 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(stored!.rewardPoints).toBe(20)` |
| 77 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(stored!.xpTotal).toBe(50)` |
| 83 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(20)` |

#### `functions/src/gamification/v4/rewardRedemption.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 149 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(stored!.rewardPoints).toBe(20)` |
| 151 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(stored!.xpTotal).toBe(50)` |
| 161 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(20)` |
| 173 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(10)` |
| 189 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect(path).toMatch(/^families\/[^/]+\/(gamification_events\|gamification_state)\//)` |
| 189 | `gamification_state` | test | families/{f}/gamification_events | New V4 projection state collection | `expect(path).toMatch(/^families\/[^/]+\/(gamification_events\|gamification_state)\//)` |

#### `functions/src/gamification/v4/rewardRedemptionWriter.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 4 | `redeemReward` | calculate | in-memory / derived | Reward redemption (RP debit) | `* V4 side of the reward-redemption cutover (legacy: ˋsrc/lib/api.ts#redeemRewardˋ,` |
| 24 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `*   - No legacy rewardPoints write, no wallet document.` |
| 156 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `const available = current?.rewardPoints ?? 0` |

#### `functions/src/gamification/v4/routeResolver.emulator.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 43 | `level` | test | in-memory / derived | Member level | `rewardPoints: rp, xpTotal: xp, level: 1, xpProgressInLevel: xp,` |
| 43 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: rp, xpTotal: xp, level: 1, xpProgressInLevel: xp,` |
| 43 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `rewardPoints: rp, xpTotal: xp, level: 1, xpProgressInLevel: xp,` |
| 43 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `rewardPoints: rp, xpTotal: xp, level: 1, xpProgressInLevel: xp,` |
| 44 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `xpToNextLevel: 1000, levelProgressPercentage: 0, currentStreak: 0,` |
| 44 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 1000, levelProgressPercentage: 0, currentStreak: 0,` |
| 45 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0, lastQualifiedDayKey: null, unlockedAchievementIds: [],` |

#### `functions/src/gamification/v4/stage7.emulator.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 41 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `function memberReport(rewardPoints: number, xpTotal: number): ProductionFamilyReport['members'][string] {` |
| 41 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `function memberReport(rewardPoints: number, xpTotal: number): ProductionFamilyReport['members'][string] {` |
| 45 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints,` |
| 46 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal,` |
| 47 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 48 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: xpTotal,` |
| 48 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpProgressInLevel: xpTotal,` |
| 49 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 1000,` |
| 51 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 52 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 135 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `const stateRef = db.doc(ˋfamilies/${FAMILY}/gamification_state/${MEMBER}ˋ)` |
| 137 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const corrupted = { ...(snap.data() as Record<string, unknown>), rewardPoints: 999 }` |
| 176 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `const stateSnap = await db.doc(ˋfamilies/${FAMILY}/gamification_state/${MEMBER}ˋ).get()` |

#### `functions/src/gamification/v4/taskApproval.emulator.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 8 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `*   - no legacy rewardPoints / lifetimeXP document and no wallet doc is written` |
| 8 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `*   - no legacy rewardPoints / lifetimeXP document and no wallet doc is written` |
| 90 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect(names).toEqual(['gamification_events', 'gamification_state'])` |
| 90 | `gamification_state` | test | families/{f}/gamification_events | New V4 projection state collection | `expect(names).toEqual(['gamification_events', 'gamification_state'])` |
| 97 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await readState(db, FAMILY, MEMBER))!.rewardPoints).toBe(15)` |
| 98 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await readState(db, FAMILY, 'mem-2'))!.rewardPoints).toBe(7)` |
| 99 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await readState(db, OTHER_FAMILY, MEMBER))!.rewardPoints).toBe(3)` |

#### `functions/src/gamification/v4/taskApproval.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 284 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `expect(store.paths().filter((p) => p.includes('gamification_state'))).toHaveLength(1)` |
| 316 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('never writes a legacy rewardPoints / lifetimeXP document', async () => {` |
| 316 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `it('never writes a legacy rewardPoints / lifetimeXP document', async () => {` |
| 321 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(path).not.toMatch(/gamification_v2\|lifetimeXp\|rewardPoints\|wallet/i)` |
| 334 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect([...collections].sort()).toEqual(['gamification_events', 'gamification_state'])` |
| 334 | `gamification_state` | test | families/{f}/gamification_events | New V4 projection state collection | `expect([...collections].sort()).toEqual(['gamification_events', 'gamification_state'])` |
| 357 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(one!.rewardPoints).toBe(20)` |
| 358 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(two!.rewardPoints).toBe(5)` |

#### `functions/src/gamification/v4/taskApprovalAdapter.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 217 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect(store.paths().some((p) => p.includes('gamification_events'))).toBe(false)` |
| 274 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect(store.paths().some((p) => p.includes('gamification_events'))).toBe(false)` |
| 285 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect(store.paths().some((p) => p.includes('gamification_events'))).toBe(true)` |
| 318 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect(store.paths().filter((p) => p.includes('gamification_events')).length).toBe(1)` |

#### `functions/src/gamification/v4/taskApprovalWriter.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 19 | `gamification_state` | read | in-memory / derived | New V4 projection state collection | `*     ˋfamilies/{familyId}/gamification_state/{memberId}ˋ. There is no second` |
| 23 | `lifetimeXP` | calculate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `*   - No legacy rewardPoints / lifetimeXP write happens on this path, and no` |
| 23 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `*   - No legacy rewardPoints / lifetimeXP write happens on this path, and no` |
| 155 | `lifetimeXP` | calculate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `* The legacy rewardPoints / lifetimeXP documents are never touched here, and no` |
| 155 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `* The legacy rewardPoints / lifetimeXP documents are never touched here, and no` |

#### `functions/src/gamification/v4/writerCore.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 16 | `gamification_state` | read | in-memory / derived | New V4 projection state collection | `*      ˋfamilies/{familyId}/gamification_state/{memberId}ˋ.` |
| 20 | `lifetimeXP` | calculate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `* No legacy rewardPoints / lifetimeXP document is touched and no wallet` |
| 20 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `* No legacy rewardPoints / lifetimeXP document is touched and no wallet` |

#### `functions/src/gamificationProcessor.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 31 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('passes immutable reversal identity and an injected clock to invalidation processing', async () => {` |

#### `functions/src/gamificationRepository.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 366 | `currentStreak` | initialise | users.currentStreak | Consecutive qualifying days | `currentStreak: Number.isSafeInteger(data.currentStreak) && data.currentStreak >= 0 ? data.currentStreak : 0,` |
| 367 | `bestStreak` | initialise | summary.bestStreak | Projection best-streak counter | `bestStreak: Number.isSafeInteger(data.bestStreak) && data.bestStreak >= 0 ? data.bestStreak : 0,` |
| 425 | `bestStreak` | initialise | summary.bestStreak | Projection best-streak counter | `schemaVersion: 1, familyId, childId, xpTotal: 0, level: 1, currentStreak: 0, bestStreak: 0,` |
| 425 | `currentStreak` | initialise | users.currentStreak | Consecutive qualifying days | `schemaVersion: 1, familyId, childId, xpTotal: 0, level: 1, currentStreak: 0, bestStreak: 0,` |
| 425 | `level` | initialise | in-memory / derived | Member level | `schemaVersion: 1, familyId, childId, xpTotal: 0, level: 1, currentStreak: 0, bestStreak: 0,` |
| 425 | `xpTotal` | initialise | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `schemaVersion: 1, familyId, childId, xpTotal: 0, level: 1, currentStreak: 0, bestStreak: 0,` |
| 458 | `xpTotal` | calculate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const nextXp = base.xpTotal + xpDelta` |
| 464 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `let currentStreak = base.currentStreak` |
| 467 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `currentStreak = 0` |
| 471 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `currentStreak = base.lastQualifiedDayKey !== null && addFamilyDays(base.lastQualifiedDayKey, 1) === progress.dayKey` |
| 472 | `currentStreak` | calculate | users.currentStreak | Consecutive qualifying days | `? base.currentStreak + 1 : 1` |
| 479 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: nextXp,` |
| 480 | `level` | read | in-memory / derived | Member level | `level: levelForXp(nextXp, 1000),` |
| 481 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `currentStreak,` |
| 482 | `bestStreak` | calculate | summary.bestStreak | Projection best-streak counter | `bestStreak: Math.max(base.bestStreak, currentStreak),` |
| 482 | `currentStreak` | calculate | users.currentStreak | Consecutive qualifying days | `bestStreak: Math.max(base.bestStreak, currentStreak),` |
| 605 | `task_occurrences` | read | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `const occurrenceRef = familyRef.collection('task_occurrences').doc(logicalKey)` |
| 608 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `const summaryRef = familyRef.collection('gamification_summaries').doc(childId)` |
| 652 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `transaction.get(familyRef.collection('gamification_events').doc(taskXpEventId(logicalKey))),` |
| 653 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `transaction.get(familyRef.collection('gamification_events').doc(taskXpReversalEventId(logicalKey))),` |
| 655 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `.map(id => transaction.get(familyRef.collection('gamification_events').doc(id))),` |
| 687 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `const currentPoints = child.rewardPoints ?? 0` |
| 688 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `if (!Number.isSafeInteger(currentPoints) \|\| currentPoints < 0) throw new Error('Child rewardPoints is invalid')` |
| 690 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `if (!Number.isSafeInteger(nextPoints)) throw new Error('Child rewardPoints would exceed the safe integer range')` |
| 745 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `// Mirror the authoritative gamification_summaries.xpTotal into the` |
| 745 | `xpTotal` | read | families/{f}/gamification_summaries | Projection lifetime XP counter (authoritative today) | `// Mirror the authoritative gamification_summaries.xpTotal into the` |
| 746 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// users.lifetimeXP compatibility field, in the SAME transaction, so the` |
| 748 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const childUpdate: Record<string, unknown> = { lifetimeXP: summary.xpTotal }` |
| 748 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const childUpdate: Record<string, unknown> = { lifetimeXP: summary.xpTotal }` |
| 750 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `childUpdate.rewardPoints = nextPoints` |
| 754 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `for (const document of plan.events) transaction.create(familyRef.collection('gamification_events').doc(document.id), eventToData(document.event))` |
| 794 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `const summaryRef = familyRef.collection('gamification_summaries').doc(effect.childId)` |
| 804 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `transaction.get(familyRef.collection('gamification_events').doc(taskXpEventId(effect.logicalCompletionKey))),` |
| 805 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `transaction.get(familyRef.collection('gamification_events').doc(taskXpReversalEventId(effect.logicalCompletionKey))),` |
| 807 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `.map(id => transaction.get(familyRef.collection('gamification_events').doc(id))),` |
| 838 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `const currentPoints = child.rewardPoints ?? 0` |
| 843 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `if (!Number.isSafeInteger(nextPoints) \|\| nextPoints < 0) throw new Error('Task invalidation would make rewardPoints invalid')` |
| 844 | `rewardPoints` | write | users.rewardPoints | Spendable Reward Points balance (RP) | `transaction.update(childRef, { rewardPoints: nextPoints })` |
| 846 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `for (const document of plan.events) transaction.create(familyRef.collection('gamification_events').doc(document.id), eventToData(document.event))` |
| 891 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `const summaryRef = familyRef.collection('gamification_summaries').doc(childId)` |
| 911 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `.map(id => transaction.get(familyRef.collection('gamification_events').doc(id))))` |
| 968 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `for (const document of events) transaction.create(familyRef.collection('gamification_events').doc(document.id), eventToData(document.event))` |
| 971 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `// Mirror the authoritative gamification_summaries.xpTotal into the` |
| 971 | `xpTotal` | read | families/{f}/gamification_summaries | Projection lifetime XP counter (authoritative today) | `// Mirror the authoritative gamification_summaries.xpTotal into the` |
| 972 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// users.lifetimeXP compatibility field, in the SAME transaction, so the` |
| 974 | `lifetimeXP` | write | users.lifetimeXP | Legacy duplicate lifetime XP counter | `transaction.update(childRef, { lifetimeXP: summary.xpTotal })` |
| 974 | `xpTotal` | write | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `transaction.update(childRef, { lifetimeXP: summary.xpTotal })` |
| 990 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const lifetimeXp = child.data().lifetimeXP` |
| 992 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `const baseline = await familyRef.collection('gamification_events').doc(ˋlegacy_xp_baseline:${encodeURIComponent(familyId)}:${encodeURIComponent(child.id)}ˋ).get` |
| 995 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `const summary = await familyRef.collection('gamification_summaries').doc(child.id).get()` |
| 1014 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `const summaryRef = familyRef.collection('gamification_summaries').doc(args.childId)` |
| 1043 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `const eventQuery = this.rebuildQuery(familyRef.collection('gamification_events'), args.childId, checkpoint.eventCursor)` |
| 1102 | `lifetimeXP` | write | users.lifetimeXP | Legacy duplicate lifetime XP counter | `transaction.update(childRef, { lifetimeXP: summary.xpTotal })` |
| 1102 | `xpTotal` | write | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `transaction.update(childRef, { lifetimeXP: summary.xpTotal })` |

#### `functions/src/gamificationTriggers.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 31 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('routes only task-completion reversal documents with their immutable ID', async () => {` |

#### `functions/src/gamificationV3/comparison.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 48 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `if (path.includes('gamification_summaries')) return summariesStore` |
| 130 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 100,` |
| 131 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 100,` |
| 135 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 100,` |
| 136 | `weeklyPoints` | test | derived (client-computed today) | Weekly leaderboard score | `weeklyPoints: 0,` |
| 137 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |

#### `functions/src/gamificationV3/comparison.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 33 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `* Reads legacy data from the ˋusersˋ document and ˋgamification_summariesˋ` |
| 51 | `currentStreak` | initialise | users.currentStreak | Consecutive qualifying days | `legacySnapshot: { familyId, memberId, rewardPoints: 0, xpTotal: 0, weeklyPoints: 0, currentStreak: 0 },` |
| 51 | `rewardPoints` | initialise | users.rewardPoints | Spendable Reward Points balance (RP) | `legacySnapshot: { familyId, memberId, rewardPoints: 0, xpTotal: 0, weeklyPoints: 0, currentStreak: 0 },` |
| 51 | `weeklyPoints` | initialise | derived (client-computed today) | Weekly leaderboard score | `legacySnapshot: { familyId, memberId, rewardPoints: 0, xpTotal: 0, weeklyPoints: 0, currentStreak: 0 },` |
| 51 | `xpTotal` | initialise | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `legacySnapshot: { familyId, memberId, rewardPoints: 0, xpTotal: 0, weeklyPoints: 0, currentStreak: 0 },` |
| 58 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `const summaryDoc = await deps.db.doc(ˋfamilies/${familyId}/gamification_summaries/${memberId}ˋ).get()` |
| 64 | `rewardPoints` | initialise | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: typeof user.rewardPoints === 'number' ? user.rewardPoints : 0,` |
| 65 | `lifetimeXP` | initialise | users.lifetimeXP | Legacy duplicate lifetime XP counter | `xpTotal: typeof summary?.xpTotal === 'number' ? summary.xpTotal : typeof user.lifetimeXP === 'number' ? user.lifetimeXP : 0,` |
| 65 | `xpTotal` | initialise | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: typeof summary?.xpTotal === 'number' ? summary.xpTotal : typeof user.lifetimeXP === 'number' ? user.lifetimeXP : 0,` |
| 66 | `weeklyPoints` | initialise | derived (client-computed today) | Weekly leaderboard score | `weeklyPoints: typeof summary?.weeklyPoints === 'number' ? summary.weeklyPoints : 0,` |
| 67 | `currentStreak` | initialise | users.currentStreak | Consecutive qualifying days | `currentStreak: typeof summary?.currentStreak === 'number' ? summary.currentStreak : 0,` |

#### `functions/src/gamificationV3/golden.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 173 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `const eventId = ˋreversal:${originalEventId}:${revId}ˋ` |
| 180 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `sourceType: 'reversal',` |
| 215 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `if (path.includes('gamification_summaries')) return summariesStore` |
| 342 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `const reversal = makeReversalEvent(task1.eventId, 'rev-1', -10, -10, -10)` |
| 343 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `await writeShadowEvent({ eventRepo, projectionRepo, now: () => '2026-01-05T11:00:00.000Z', weeklyContext: weekly }, reversal)` |
| 354 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state!.rewardPoints).toBeGreaterThanOrEqual(0)` |
| 359 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(rebuildResult.state.rewardPoints).toBe(state!.rewardPoints)` |
| 364 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(reduced.rewardPoints).toBe(state!.rewardPoints)` |
| 365 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(reduced.xpTotal).toBe(state!.xpTotal)` |

#### `functions/src/gamificationV3/integration.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 368 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `// P0 FIX — shadow rewardPoints must accumulate (existing + delta), not fold` |
| 369 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `// from the single-event delta. Authoritative rewardPoints, wallet, and reward` |
| 373 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `describe('P0 FIX — shadow rewardPoints accumulation', () => {` |
| 379 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const RP = 'rewardPoints'` |
| 384 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: xp,` |
| 385 | `weeklyPoints` | test | derived (client-computed today) | Weekly leaderboard score | `weeklyPoints: wp,` |
| 386 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 387 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 391 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 392 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 0,` |
| 393 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 100,` |
| 425 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(readState().rewardPoints).toBe(10)` |
| 440 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(readState().rewardPoints).toBe(20)` |
| 443 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('3. negative/reversal delta applies correctly if allowed by V3 semantics', async () => {` |
| 455 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(readState().rewardPoints).toBe(10)` |
| 468 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(readState().rewardPoints).toBe(0)` |
| 485 | `weeklyPoints` | test | derived (client-computed today) | Weekly leaderboard score | `it('4. xpTotal and weeklyPoints behaviour unchanged', async () => {` |
| 485 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `it('4. xpTotal and weeklyPoints behaviour unchanged', async () => {` |
| 498 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(state.xpTotal).toBe(110)` |
| 499 | `weeklyPoints` | test | derived (client-computed today) | Weekly leaderboard score | `expect(state.weeklyPoints).toBe(15)` |
| 500 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state.rewardPoints).toBe(20)` |
| 524 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(readState().rewardPoints).toBe(20) // not 30` |
| 556 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `// merge (rewardPoints/xpTotal/weeklyPoints). The level-derived fields` |
| 556 | `weeklyPoints` | test | derived (client-computed today) | Weekly leaderboard score | `// merge (rewardPoints/xpTotal/weeklyPoints). The level-derived fields` |
| 556 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `// merge (rewardPoints/xpTotal/weeklyPoints). The level-derived fields` |
| 557 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `// (level, xpProgressInLevel, ...) are a separate pre-existing merge defect` |
| 558 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `// and intentionally out of scope for this P0 rewardPoints fix.` |
| 559 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const CUMULATIVE_FIELDS = ['rewardPoints', 'xpTotal', 'weeklyPoints'] as const` |
| 559 | `weeklyPoints` | test | derived (client-computed today) | Weekly leaderboard score | `const CUMULATIVE_FIELDS = ['rewardPoints', 'xpTotal', 'weeklyPoints'] as const` |
| 559 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const CUMULATIVE_FIELDS = ['rewardPoints', 'xpTotal', 'weeklyPoints'] as const` |
| 579 | `weeklyPoints` | test | derived (client-computed today) | Weekly leaderboard score | `// Single additive path: result === seeded + delta (mirrors xpTotal/weeklyPoints)` |
| 579 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `// Single additive path: result === seeded + delta (mirrors xpTotal/weeklyPoints)` |
| 580 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(readState().rewardPoints).toBe(7 + event.rewardPointsDelta)` |

#### `functions/src/gamificationV3/integration.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 57 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `* That previously discarded the authoritative rewardPoints/summary writes while` |
| 121 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `// P0 FIX: shadow rewardPoints must accumulate (existing + delta), exactly` |
| 122 | `weeklyPoints` | calculate | derived (client-computed today) | Weekly leaderboard score | `// like xpTotal/weeklyPoints — NOT fold from the single-event delta.` |
| 122 | `xpTotal` | calculate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `// like xpTotal/weeklyPoints — NOT fold from the single-event delta.` |
| 124 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `// literal rewardPoints writers outside V4 dirs) is not tripped.` |
| 125 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `const RP = 'rewardPoints'` |
| 126 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `const nextRewardPoints = existingState.rewardPoints + event.rewardPointsDelta` |
| 132 | `xpTotal` | write | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: existingState.xpTotal + event.xpDelta,` |
| 133 | `weeklyPoints` | write | derived (client-computed today) | Weekly leaderboard score | `weeklyPoints: existingState.weeklyPoints + event.weeklyPointsDelta,` |
| 134 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `currentStreak: newState.currentStreak,` |
| 135 | `bestStreak` | calculate | summary.bestStreak | Projection best-streak counter | `bestStreak: Math.max(existingState.bestStreak, newState.currentStreak),` |
| 135 | `currentStreak` | calculate | users.currentStreak | Consecutive qualifying days | `bestStreak: Math.max(existingState.bestStreak, newState.currentStreak),` |
| 140 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: newState.xpProgressInLevel,` |
| 141 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: newState.xpToNextLevel,` |

#### `functions/src/gamificationV3/projectionRepository.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 18 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `function baselineEvent(rewardPoints = 380): GamificationEventV3 {` |
| 29 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPointsDelta: rewardPoints,` |
| 30 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `xpDelta: rewardPoints,` |
| 152 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(rebuilt.rewardPoints).toBe(385)` |
| 153 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(rebuilt.xpTotal).toBe(385)` |
| 154 | `weeklyPoints` | test | derived (client-computed today) | Weekly leaderboard score | `expect(rebuilt.weeklyPoints).toBe(5)` |

#### `functions/src/gamificationV3/readAfterWrite.regression.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 10 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `* AFTER the authoritative writes (users.rewardPoints, gamification_summaries,` |
| 10 | `rewardPoints` | test | families/{f}/gamification_summaries | Spendable Reward Points balance (RP) | `* AFTER the authoritative writes (users.rewardPoints, gamification_summaries,` |
| 14 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `* "+10", but ˋusers.rewardPointsˋ was never committed, so the child could not` |
| 34 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const RP = 'rewardPoints'` |
| 35 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const LXP = 'lifetimeXP'` |
| 147 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 0,` |
| 148 | `weeklyPoints` | test | derived (client-computed today) | Weekly leaderboard score | `weeklyPoints: 0,` |
| 149 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 150 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 154 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 155 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 0,` |
| 156 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 1000,` |
| 179 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `familyId: FAMILY_ID, role: 'child', [RP]: 0, [LXP]: 0, currentStreak: 0, longestStreak: 0,` |
| 179 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `familyId: FAMILY_ID, role: 'child', [RP]: 0, [LXP]: 0, currentStreak: 0, longestStreak: 0,` |
| 181 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `[ˋ${FAMILY_PATH}/gamification_summaries/${CHILD_ID}ˋ]: {` |
| 182 | `level` | test | in-memory / derived | Member level | `schemaVersion: 1, familyId: FAMILY_ID, childId: CHILD_ID, xpTotal: 0, level: 1,` |
| 182 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `schemaVersion: 1, familyId: FAMILY_ID, childId: CHILD_ID, xpTotal: 0, level: 1,` |
| 183 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `currentStreak: 0, bestStreak: 0, perfectDayCount: 0, lastQualifiedDayKey: null,` |
| 183 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0, bestStreak: 0, perfectDayCount: 0, lastQualifiedDayKey: null,` |
| 221 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `const summaryPath = ˋ${FAMILY_PATH}/gamification_summaries/${CHILD_ID}ˋ` |
| 238 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(db.store[summaryPath]).toMatchObject({ xpTotal: 10 })` |
| 245 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(db.store[statePath]).toMatchObject({ [RP]: 10, xpTotal: 10 })` |
| 266 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(db.store[summaryPath]).toMatchObject({ xpTotal: 20 })` |
| 267 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `// The shadow projection folded BOTH approvals (xpTotal is cumulative) and` |
| 269 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(db.store[statePath]).toMatchObject({ xpTotal: 20, projectionVersion: 3 })` |
| 271 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `// P0 FIX (gamification-v3): the shadow now accumulates rewardPoints as` |
| 272 | `weeklyPoints` | test | derived (client-computed today) | Weekly leaderboard score | `// ˋexisting + deltaˋ, exactly like xpTotal/weeklyPoints, so both approvals` |
| 272 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `// ˋexisting + deltaˋ, exactly like xpTotal/weeklyPoints, so both approvals` |
| 273 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `// fold into the shadow balance. The AUTHORITATIVE users.rewardPoints (above)` |
| 329 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `expect(db.store[childPath].lifetimeXP).toBe(db.store[summaryPath].xpTotal)` |
| 329 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(db.store[childPath].lifetimeXP).toBe(db.store[summaryPath].xpTotal)` |
| 334 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `store[ˋ${FAMILY_PATH}/behaviour_events/behaviour-1ˋ] = {` |

#### `functions/src/gamificationV3/rebuild.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 167 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(result.state.rewardPoints).toBe(385)` |
| 168 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(result.state.xpTotal).toBe(385)` |
| 180 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 999,` |
| 191 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(result.state.rewardPoints).toBe(380) // Correct value from rebuild` |

#### `functions/src/gamificationV3/rebuild.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 62 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `'rewardPoints',` |
| 63 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `'xpTotal',` |
| 64 | `weeklyPoints` | read | derived (client-computed today) | Weekly leaderboard score | `'weeklyPoints',` |
| 67 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `'xpProgressInLevel',` |
| 68 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `'xpToNextLevel',` |
| 70 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `'currentStreak',` |
| 71 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `'bestStreak',` |

#### `functions/src/gamificationV3/shadowWriter.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 156 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state!.rewardPoints).toBe(380)` |
| 170 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state!.rewardPoints).toBe(380)` |
| 178 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state!.rewardPoints).toBe(385)` |
| 179 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(state!.xpTotal).toBe(385)` |
| 189 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state!.rewardPoints).toBe(395)` |
| 190 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(state!.xpTotal).toBe(395)` |

#### `functions/src/gamificationV3/shadowWriter.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 30 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `* manual adjustment, and reversal is a temporary bridge. Phase 3 must` |

#### `functions/src/gamificationV3/sourceMappers/reversalMapper.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 5 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('maps a reversal to a REVERSAL event', () => {` |
| 19 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `expect(event.eventId).toBe('reversal:task-approved:family-1:member-1:completion-1:rev-1')` |

#### `functions/src/gamificationV3/sourceMappers/reversalMapper.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 16 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `/** Pure mapper: reversal → immutable REVERSAL V3 event. */` |
| 25 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `sourceType: 'reversal',` |

#### `functions/src/gamificationV3/triggers.test.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 40 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `describe('reversal', () => {` |

#### `functions/src/gamificationV3/triggers.ts` — KEEP · Phase 1-2 · risk Medium

> Server writer — extended into the V3 command pipeline

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 189 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `'reversal', reversalId, legacyCommittedAt,` |

#### `functions/src/index.ts` — KEEP · Phase 6 · risk Low

> Lifecycle/cleanup — collection list updated when legacy is dropped

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 106 | `behaviour_events` | read | families/{f}/behaviour_events | Behaviour intent log | `'families/{familyId}/behaviour_events/{behaviourEventId}',` |

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

#### `functions/src/lifetimeXpMirror.test.ts` — MIGRATE · Phase 1-4 · risk Low

> Test rewritten against the V3 contract

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 2 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `* Regression tests for BUG 2 — lifetimeXP mirror drift.` |
| 4 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `* The authoritative gamification XP lives in ˋgamification_summaries.xpTotalˋ.` |
| 4 | `xpTotal` | test | families/{f}/gamification_summaries | Projection lifetime XP counter (authoritative today) | `* The authoritative gamification XP lives in ˋgamification_summaries.xpTotalˋ.` |
| 5 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `* ˋusers.lifetimeXPˋ is a legacy compatibility mirror that MUST be updated in the` |
| 6 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `* SAME transaction whenever ˋxpTotalˋ changes, in the two server authoritative` |
| 12 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `* ˋusers.lifetimeXP === gamification_summaries.xpTotalˋ.` |
| 12 | `lifetimeXP` | test | families/{f}/gamification_summaries | Legacy duplicate lifetime XP counter | `* ˋusers.lifetimeXP === gamification_summaries.xpTotalˋ.` |
| 12 | `xpTotal` | test | families/{f}/gamification_summaries | Projection lifetime XP counter (authoritative today) | `* ˋusers.lifetimeXP === gamification_summaries.xpTotalˋ.` |
| 17 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `* idempotently. Both writers must mirror ˋlifetimeXPˋ.` |
| 165 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 166 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 0,` |
| 167 | `weeklyPoints` | test | derived (client-computed today) | Weekly leaderboard score | `weeklyPoints: 0,` |
| 168 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 169 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 173 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 174 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 0,` |
| 175 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 1000,` |
| 197 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 198 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 0,` |
| 199 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 200 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 0,` |
| 202 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `[ˋ${FAMILY_PATH}/gamification_summaries/${CHILD_ID}ˋ]: {` |
| 206 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 0,` |
| 207 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 208 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 209 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 288 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `return ˋ${FAMILY_PATH}/gamification_summaries/${CHILD_ID}ˋ` |
| 297 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `describe('BUG 2 — lifetimeXP mirror', () => {` |
| 301 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `delete legacySummary.currentStreak` |
| 302 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `delete legacySummary.bestStreak` |
| 307 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `expect(db.store[summaryPath()].currentStreak).toBe(0)` |
| 308 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `expect(db.store[summaryPath()].bestStreak).toBe(0)` |
| 312 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('task approval: rewardPoints +10, xpTotal +10, lifetimeXP +10 (same transaction)', async () => {` |
| 312 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `it('task approval: rewardPoints +10, xpTotal +10, lifetimeXP +10 (same transaction)', async () => {` |
| 312 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `it('task approval: rewardPoints +10, xpTotal +10, lifetimeXP +10 (same transaction)', async () => {` |
| 325 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(db.store[summaryPath()]).toMatchObject({ xpTotal: 10 })` |
| 326 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `expect(db.store[childPath()]).toMatchObject({ rewardPoints: 10, lifetimeXP: 10 })` |
| 326 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(db.store[childPath()]).toMatchObject({ rewardPoints: 10, lifetimeXP: 10 })` |
| 327 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// Mirror invariant: lifetimeXP === xpTotal.` |
| 327 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `// Mirror invariant: lifetimeXP === xpTotal.` |
| 328 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `expect(db.store[childPath()].lifetimeXP).toBe(db.store[summaryPath()].xpTotal)` |
| 328 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(db.store[childPath()].lifetimeXP).toBe(db.store[summaryPath()].xpTotal)` |
| 331 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('daily goal: xpTotal +25, lifetimeXP +25 (mirrored by processApprovedCompletion and finalizeChildDay)', async () => {` |
| 331 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `it('daily goal: xpTotal +25, lifetimeXP +25 (mirrored by processApprovedCompletion and finalizeChildDay)', async () => {` |
| 343 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// Task XP (100) + daily-goal bonus (25) = 125, mirrored into lifetimeXP.` |
| 344 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(db.store[summaryPath()]).toMatchObject({ xpTotal: 125 })` |
| 345 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `expect(db.store[childPath()]).toMatchObject({ lifetimeXP: 125 })` |
| 353 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `expect(db.store[childPath()].lifetimeXP).toBe(db.store[summaryPath()].xpTotal)` |
| 353 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(db.store[childPath()].lifetimeXP).toBe(db.store[summaryPath()].xpTotal)` |
| 356 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('perfect day: xpTotal +50 (perfect-day bonus), lifetimeXP mirrored (same transaction)', async () => {` |
| 356 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `it('perfect day: xpTotal +50 (perfect-day bonus), lifetimeXP mirrored (same transaction)', async () => {` |
| 370 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(db.store[summaryPath()]).toMatchObject({ xpTotal: 175 })` |
| 371 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `expect(db.store[childPath()]).toMatchObject({ lifetimeXP: 175 })` |
| 379 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `expect(db.store[childPath()].lifetimeXP).toBe(db.store[summaryPath()].xpTotal)` |
| 379 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(db.store[childPath()].lifetimeXP).toBe(db.store[summaryPath()].xpTotal)` |
| 382 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('already-drifted user: new task +10 makes lifetimeXP = new xpTotal (430), not an increment from old lifetimeXP', async () => {` |
| 382 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `it('already-drifted user: new task +10 makes lifetimeXP = new xpTotal (430), not an increment from old lifetimeXP', async () => {` |
| 389 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `// Approve the 420-XP base task -> projection xpTotal 420, mirror 420.` |
| 396 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(db.store[summaryPath()]).toMatchObject({ xpTotal: 420 })` |
| 397 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `expect(db.store[childPath()]).toMatchObject({ lifetimeXP: 420 })` |
| 400 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `db.store[childPath()] = { ...db.store[childPath()], lifetimeXP: 400 }` |
| 420 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `// New task +10 -> projection xpTotal 430.` |
| 421 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(db.store[summaryPath()]).toMatchObject({ xpTotal: 430 })` |
| 423 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `expect(db.store[childPath()].lifetimeXP).toBe(430)` |
| 424 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `expect(db.store[childPath()].lifetimeXP).not.toBe(410)` |

#### `functions/src/recoveryEligibility.test.ts` — MIGRATE · Phase 1-4 · risk Low

> Test rewritten against the V3 contract

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 245 | `task_occurrences` | test | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `store[ˋfamilies/${FAMILY}/task_occurrences/${logical}ˋ] = {` |

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

#### `scripts/backup-gamification-collections.cjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 32 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `'gamification_summaries',` |
| 34 | `task_occurrences` | read | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `'task_occurrences',` |
| 35 | `behaviour_events` | read | families/{f}/behaviour_events | Behaviour intent log | `'behaviour_events',` |

#### `scripts/bootstrap-v3-baseline.ts` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 9 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `* - rewardPoints: current legacy rewardPoints balance` |
| 10 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `* - xpTotal: current legacy xpTotal (from gamification_summaries)` |
| 10 | `xpTotal` | read | families/{f}/gamification_summaries | Projection lifetime XP counter (authoritative today) | `* - xpTotal: current legacy xpTotal (from gamification_summaries)` |
| 11 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `* - currentStreak, bestStreak, lastQualifiedDayKey: from summary` |
| 11 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `* - currentStreak, bestStreak, lastQualifiedDayKey: from summary` |
| 13 | `weeklyPoints` | initialise | derived (client-computed today) | Weekly leaderboard score | `* - weeklyPoints: 0 (baseline does not inflate current week)` |
| 30 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `readonly rewardPoints: number` |
| 31 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `readonly xpTotal: number` |
| 32 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `readonly currentStreak: number` |
| 33 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `readonly bestStreak: number` |
| 43 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `readonly rewardPoints: number` |
| 44 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `readonly xpTotal: number` |
| 75 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `const summaryDoc = await db.doc(ˋfamilies/${familyId}/gamification_summaries/${memberId}ˋ).get()` |
| 87 | `rewardPoints` | initialise | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: typeof data.rewardPoints === 'number' ? data.rewardPoints : 0,` |
| 88 | `xpTotal` | initialise | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: typeof summary?.xpTotal === 'number' ? summary.xpTotal : 0,` |
| 89 | `currentStreak` | initialise | users.currentStreak | Consecutive qualifying days | `currentStreak: typeof summary?.currentStreak === 'number' ? summary.currentStreak : 0,` |
| 90 | `bestStreak` | initialise | summary.bestStreak | Projection best-streak counter | `bestStreak: typeof summary?.bestStreak === 'number' ? summary.bestStreak : 0,` |
| 124 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: input.rewardPoints,` |
| 125 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: input.xpTotal,` |
| 134 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: input.rewardPoints,` |
| 135 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: input.xpTotal,` |
| 150 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPointsDelta: input.rewardPoints,` |
| 151 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpDelta: input.xpTotal,` |
| 155 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `currentStreak: input.currentStreak,` |
| 156 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `bestStreak: input.bestStreak,` |
| 176 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: input.rewardPoints,` |
| 177 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: input.xpTotal,` |
| 184 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: input.rewardPoints,` |
| 185 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: input.xpTotal,` |

#### `scripts/cutover/task-approval-smoke.ts` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 118 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: data.rewardPoints ?? null,` |
| 119 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: data.lifetimeXP ?? null,` |
| 145 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `const summaryPath = ˋ${familyPath}/gamification_summaries/${memberId}ˋ` |
| 147 | `gamification_state` | read | in-memory / derived | New V4 projection state collection | `const v4StatePath = ˋ${familyPath}/gamification_state/${memberId}ˋ` |
| 159 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `memberEventDocs(db, ˋ${familyPath}/gamification_eventsˋ, 'childId', memberId),` |
| 161 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `db.collection(ˋ${familyPath}/gamification_eventsˋ).where('memberId', '==', memberId).get(),` |
| 266 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `throw new SmokeVerificationError('LEGACY_V1_CHANGED', 'legacy gamification_events member count changed')` |

#### `scripts/dry-run-gamification-rebuild.test.ts` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 22 | `level` | test | in-memory / derived | Member level | `unknownEvents: 0, duplicateRewardApplications: 0, level: 1, xpToNextLevel: 203 })` |
| 22 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `unknownEvents: 0, duplicateRewardApplications: 0, level: 1, xpToNextLevel: 203 })` |

#### `scripts/dry-run-gamification-rebuild.ts` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 7 | `levelProgressForXp` | calculate | in-memory / derived | Canonical level formula | `import { levelProgressForXp } from '../src/domain/gamification/level'` |
| 20 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `readonly xpToNextLevel: number` |
| 39 | `levelProgressForXp` | read | in-memory / derived | Canonical level formula | `const progress = levelProgressForXp(canonicalXp, GAMIFICATION_CONFIG_V1.xpPerLevel)` |
| 50 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: progress.xpToNextLevel,` |
| 60 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `db.doc(ˋfamilies/${familyId}/gamification_summaries/${childId}ˋ).get(),` |
| 61 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `db.collection(ˋfamilies/${familyId}/gamification_eventsˋ).where('childId', '==', childId).get(),` |
| 64 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const currentXp = summary.data()?.xpTotal` |

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

#### `scripts/gamification-freeze-guard.cjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 40 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `// direct rewardPoints assignment / object property write, e.g.` |
| 41 | `rewardPoints` | write | users.rewardPoints | Spendable Reward Points balance (RP) | `//   transaction.update(userRef, { rewardPoints: currentPoints - cost })` |
| 43 | `lifetimeXP` | calculate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// direct lifetimeXP assignment / object property write, e.g.` |
| 44 | `lifetimeXP` | write | users.lifetimeXP | Legacy duplicate lifetime XP counter | `//   transaction.update(userRef, { lifetimeXP: +points })` |

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

#### `scripts/migrate/migration-marker.test.ts` — MIGRATE · Phase 5 · risk Medium

> Historical one-shot migration tooling

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 95 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `function memberReport(rewardPoints: number, xpTotal: number) {` |
| 95 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `function memberReport(rewardPoints: number, xpTotal: number) {` |
| 99 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints,` |
| 100 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal,` |
| 101 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 102 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: xpTotal,` |
| 102 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpProgressInLevel: xpTotal,` |
| 103 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 1000,` |
| 105 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 106 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |

#### `scripts/migrate/partial-migration-failure.test.ts` — MIGRATE · Phase 5 · risk Medium

> Historical one-shot migration tooling

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 106 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `function member(rewardPoints: number, xpTotal: number, memberId: string) {` |
| 106 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `function member(rewardPoints: number, xpTotal: number, memberId: string) {` |
| 110 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints,` |
| 111 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal,` |
| 112 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 113 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: xpTotal,` |
| 113 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpProgressInLevel: xpTotal,` |
| 114 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 1000,` |
| 116 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 117 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 207 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `const cleanEvents = clean.fs._entries().filter(([path]) => path.includes('/gamification_events/')).sort()` |
| 208 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `const cleanStates = clean.fs._entries().filter(([path]) => path.includes('/gamification_state/')).sort()` |
| 220 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `const partialEvents = recovered.fs._entries().filter(([path]) => path.includes('/gamification_events/')).sort()` |
| 221 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `const partialStates = recovered.fs._entries().filter(([path]) => path.includes('/gamification_state/')).sort()` |
| 237 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `const recoveredEvents = recovered.fs._entries().filter(([path]) => path.includes('/gamification_events/')).sort()` |
| 238 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `const recoveredStates = recovered.fs._entries().filter(([path]) => path.includes('/gamification_state/')).sort()` |

#### `scripts/migrate/production-migration.test.ts` — MIGRATE · Phase 5 · risk Medium

> Historical one-shot migration tooling

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 87 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `function member(rewardPoints: number, xpTotal: number, memberId: string) {` |
| 87 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `function member(rewardPoints: number, xpTotal: number, memberId: string) {` |
| 91 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints,` |
| 92 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal,` |
| 93 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 94 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: xpTotal,` |
| 94 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpProgressInLevel: xpTotal,` |
| 95 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 1000,` |
| 97 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 98 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 256 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(p).not.toMatch(/rewardPoints\|wallet\|allowance\|transactions/)` |

#### `scripts/migrate/write-v4-ledger.test.ts` — MIGRATE · Phase 5 · risk Medium

> Historical one-shot migration tooling

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 110 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `function memberReport(rewardPoints: number, xpTotal: number) {` |
| 110 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `function memberReport(rewardPoints: number, xpTotal: number) {` |
| 114 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints,` |
| 115 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal,` |
| 116 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 117 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: xpTotal,` |
| 117 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpProgressInLevel: xpTotal,` |
| 118 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 1000,` |
| 120 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 121 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 230 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `const eventKeys = store.entries().map(([p]) => p).filter((p) => p.includes('/gamification_events/'))` |
| 236 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `it('creates NO root-level gamification_state document', async () => {` |
| 373 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `// No root-level gamification_state document.` |

#### `scripts/migrate/write-v4-ledger.ts` — MIGRATE · Phase 5 · risk Medium

> Historical one-shot migration tooling

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 9 | `gamification_events` | migrate | families/{f}/gamification_events | Existing XP event ledger | `*     ˋfamilies/{familyId}/gamification_events/{eventId}ˋ` |
| 12 | `gamification_state` | migrate | in-memory / derived | New V4 projection state collection | `*     ˋfamilies/{familyId}/gamification_state/{memberId}ˋ` |
| 122 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `replayed: { rewardPoints: number; xpTotal: number },` |
| 122 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `replayed: { rewardPoints: number; xpTotal: number },` |
| 135 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPointsDelta: replayed.rewardPoints,` |
| 136 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpDelta: replayed.xpTotal,` |
| 151 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `* (deltas = the replayed rewardPoints/xpTotal) and one rebuilt projection.` |
| 151 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `* (deltas = the replayed rewardPoints/xpTotal) and one rebuilt projection.` |

#### `scripts/p0-blackiron-check.cjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 15 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `console.log('  users.rewardPoints:', c.data().rewardPoints, 'lifetimeXP:', c.data().lifetimeXP);` |
| 15 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `console.log('  users.rewardPoints:', c.data().rewardPoints, 'lifetimeXP:', c.data().lifetimeXP);` |

#### `scripts/p0-divergence-probe.cjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 11 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `const s = await db.doc(ˋfamilies/${fid}/gamification_summaries/${cid}ˋ).get();` |
| 15 | `gamification_state` | read | in-memory / derived | New V4 projection state collection | `const v4 = await db.doc(ˋfamilies/${fid}/gamification_state/${cid}ˋ).get();` |
| 41 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `children.push({ id: d.id, familyId: u.familyId, rp: u.rewardPoints, lifetimeXP: u.lifetimeXP, weeklyPoints: u.weeklyPoints, role: u.role });` |
| 41 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `children.push({ id: d.id, familyId: u.familyId, rp: u.rewardPoints, lifetimeXP: u.lifetimeXP, weeklyPoints: u.weeklyPoints, role: u.role });` |
| 41 | `weeklyPoints` | read | derived (client-computed today) | Weekly leaderboard score | `children.push({ id: d.id, familyId: u.familyId, rp: u.rewardPoints, lifetimeXP: u.lifetimeXP, weeklyPoints: u.weeklyPoints, role: u.role });` |
| 53 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `users_rp: ch.rp, users_lifetimeXP: ch.lifetimeXP, users_weekly: ch.weeklyPoints,` |
| 53 | `weeklyPoints` | read | derived (client-computed today) | Weekly leaderboard score | `users_rp: ch.rp, users_lifetimeXP: ch.lifetimeXP, users_weekly: ch.weeklyPoints,` |
| 54 | `rewardPoints` | write | users.rewardPoints | Spendable Reward Points balance (RP) | `sum_rp: docs.summary ? docs.summary.rewardPoints : '<no-summary>',` |
| 55 | `xpTotal` | write | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `sum_xp: docs.summary ? docs.summary.xpTotal : '<no-summary>',` |
| 56 | `weeklyPoints` | write | derived (client-computed today) | Weekly leaderboard score | `sum_weekly: docs.summary ? docs.summary.weeklyPoints : '<no-summary>',` |
| 58 | `rewardPoints` | write | users.rewardPoints | Spendable Reward Points balance (RP) | `v3_rp: docs.v3 ? docs.v3.rewardPoints : '<no-v3>',` |
| 59 | `weeklyPoints` | write | derived (client-computed today) | Weekly leaderboard score | `v3_weekly: docs.v3 ? docs.v3.weeklyPoints : '<no-v3>',` |
| 60 | `rewardPoints` | write | users.rewardPoints | Spendable Reward Points balance (RP) | `v4_rp: docs.v4 ? docs.v4.rewardPoints : '<no-v4>',` |
| 66 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `// Divergence: has approved completions but users.rewardPoints == 0 (or missing)` |
| 68 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `console.log('=== DIVERGED (approved completions but users.rewardPoints==0) ===', diverged.length);` |

#### `scripts/p0-global-check.cjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 2 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `// Closes secondary candidates: missing rewardPoints on children, missing/non-numeric` |
| 19 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `if (typeof data.rewardPoints !== 'number') missingRewardPoints++;` |

#### `scripts/p0-inspect-divergence.cjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 86 | `task_occurrences` | read | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `// task_occurrences for this child` |
| 87 | `task_occurrences` | read | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `const occSnap = await db.collection(ˋfamilies/${FAMILY}/task_occurrencesˋ).where('childId', '==', CHILD).get()` |

#### `scripts/p0-managedchild-probe.cjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 29 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: data.rewardPoints,` |

#### `scripts/p0-managedchild-repro.cjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 51 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `r.isActive === true && Number(r.cost) > 0 && Number(r.cost) <= Number(childData.rewardPoints))` |
| 54 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `const currentPoints = Number(childData.rewardPoints)` |
| 63 | `rewardPoints` | write | users.rewardPoints | Spendable Reward Points balance (RP) | `tx.update(userRef, { rewardPoints: currentPoints - cost, lastRedemptionId: redRef.id })` |

#### `scripts/p0-migration-probe.cjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 1 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `// P0 READ-ONLY probe: family gamificationMigration status + children rewardPoints.` |
| 24 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `console.log(ˋ  child ${u.id}: rp=${ud.rewardPoints} lifetimeXP=${ud.lifetimeXP} approvedCompletions=${comps.size}ˋ);` |
| 24 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `console.log(ˋ  child ${u.id}: rp=${ud.rewardPoints} lifetimeXP=${ud.lifetimeXP} approvedCompletions=${comps.size}ˋ);` |

#### `scripts/p0-newfamily-inspect.cjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 21 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `console.log('  exists:', c.exists, 'role:', cd.role, 'familyId:', cd.familyId, 'status:', cd.status, 'disabled:', cd.disabled, 'rewardPoints:', cd.rewardPoints)` |
| 31 | `task_occurrences` | read | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `const occ = await db.collection(ˋfamilies/${fid}/task_occurrencesˋ).get();` |
| 32 | `task_occurrences` | read | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `console.log('  task_occurrences count:', occ.size);` |
| 40 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `const s = await db.doc(ˋfamilies/${fid}/gamification_summaries/${cid}ˋ).get();` |

#### `scripts/p0-points-probe.cjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 27 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `const s = await db.doc(ˋfamilies/${fid}/gamification_summaries/${d.id}ˋ).get();` |
| 31 | `gamification_state` | read | in-memory / derived | New V4 projection state collection | `const v4 = await db.doc(ˋfamilies/${fid}/gamification_state/${d.id}ˋ).get();` |
| 36 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `rp: u.rewardPoints, lifetimeXP: u.lifetimeXP,` |
| 36 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rp: u.rewardPoints, lifetimeXP: u.lifetimeXP,` |
| 37 | `weeklyPoints` | write | derived (client-computed today) | Weekly leaderboard score | `sum_weekly: summary ? summary.weeklyPoints : '<no-summary>',` |
| 38 | `rewardPoints` | write | users.rewardPoints | Spendable Reward Points balance (RP) | `sum_rp: summary ? summary.rewardPoints : '<no-summary>',` |
| 39 | `xpTotal` | write | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `sum_xp: summary ? summary.xpTotal : '<no-summary>',` |
| 41 | `rewardPoints` | write | users.rewardPoints | Spendable Reward Points balance (RP) | `v3_rp: stateV3 ? stateV3.rewardPoints : '<no-v3>',` |
| 42 | `weeklyPoints` | write | derived (client-computed today) | Weekly leaderboard score | `v3_weekly: stateV3 ? stateV3.weeklyPoints : '<no-v3>',` |
| 43 | `rewardPoints` | write | users.rewardPoints | Spendable Reward Points balance (RP) | `v4_rp: stateV4 ? stateV4.rewardPoints : '<no-v4>',` |
| 47 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `// 3) Divergence signature: summary.weeklyPoints > 0 but users.rewardPoints == 0` |
| 47 | `weeklyPoints` | read | derived (client-computed today) | Weekly leaderboard score | `// 3) Divergence signature: summary.weeklyPoints > 0 but users.rewardPoints == 0` |
| 49 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `console.log('=== DIVERGED (weekly>0 but rewardPoints==0) ===', diverged.length);` |
| 52 | `weeklyPoints` | read | derived (client-computed today) | Weekly leaderboard score | `// 4) Also show any child with weeklyPoints>0 for context` |
| 54 | `weeklyPoints` | read | derived (client-computed today) | Weekly leaderboard score | `console.log('=== CHILDREN WITH weeklyPoints>0 ===', withWeekly.length);` |

#### `scripts/p0-readonly-probe.cjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 19 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: data.rewardPoints,` |
| 59 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `const canAfford = byFamily[fid].some(c => typeof c.rewardPoints === 'number' && c.rewardPoints >= st.minRewardCost);` |
| 83 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `console.log(JSON.stringify({ id: c.id, familyId: c.familyId, rewardPoints: c.rewardPoints, role: c.role, isActive: c.isActive, lastRedemptionId: c.lastRedemptio` |

#### `scripts/p0-rebuild-projections.cjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 8 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `* gamification_summaries doc is still projectionStatus == 'rebuilding' or` |
| 13 | `gamification_summaries` | calculate | families/{f}/gamification_summaries | Legacy projection collection | `*   - No direct users.rewardPoints / gamification_summaries patches: the` |
| 13 | `rewardPoints` | calculate | families/{f}/gamification_summaries | Spendable Reward Points balance (RP) | `*   - No direct users.rewardPoints / gamification_summaries patches: the` |
| 44 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `const summaries = await db.collection(ˋfamilies/${family.id}/gamification_summariesˋ).get()` |
| 73 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `const after = await db.doc(ˋfamilies/${target.familyId}/gamification_summaries/${target.childId}ˋ).get()` |
| 75 | `xpTotal` | calculate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `results.push({ ...target, pages: pages + 1, status, afterStatus: data.projectionStatus, afterRebuildRequired: data.rebuildRequired === true, xpTotal: data.xpTot` |

#### `scripts/p0-recover-unprocessed-approvals.cjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 12 | `task_occurrences` | read | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `*     task_occurrences/{logicalKey} immutable reservation and returns ˋduplicateˋ` |
| 14 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `*   - No direct users.rewardPoints / summary / shadow patches. The processor` |
| 15 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `*     writes authoritative balance, summary, gamification_events, daily` |

#### `scripts/p0-scan-unprocessed-approvals.cjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 104 | `task_occurrences` | read | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `const occSnap = await db.collection(ˋfamilies/${familyId}/task_occurrencesˋ).get()` |
| 132 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `const currentRewardPoints = child && typeof child.rewardPoints === 'number' ? child.rewardPoints : null` |

#### `scripts/p0-shadow-readafterwrite-emulator-proof.cjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 24 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `const BALANCE = 'rewardPoints'` |
| 52 | `lifetimeXP` | initialise | users.lifetimeXP | Legacy duplicate lifetime XP counter | `familyId: FAMILY_ID, role: 'child', [BALANCE]: 0, lifetimeXP: 0,` |
| 53 | `currentStreak` | initialise | users.currentStreak | Consecutive qualifying days | `currentStreak: 0, longestStreak: 0,` |
| 53 | `longestStreak` | initialise | users.longestStreak | Legacy best-streak counter on the user doc | `currentStreak: 0, longestStreak: 0,` |
| 55 | `gamification_summaries` | write | families/{f}/gamification_summaries | Legacy projection collection | `batch.set(db.doc(ˋ${FAMILY_PATH}/gamification_summaries/${CHILD_ID}ˋ), {` |
| 56 | `level` | initialise | in-memory / derived | Member level | `schemaVersion: 1, familyId: FAMILY_ID, childId: CHILD_ID, xpTotal: 0, level: 1,` |
| 56 | `xpTotal` | initialise | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `schemaVersion: 1, familyId: FAMILY_ID, childId: CHILD_ID, xpTotal: 0, level: 1,` |
| 57 | `bestStreak` | initialise | summary.bestStreak | Projection best-streak counter | `currentStreak: 0, bestStreak: 0, perfectDayCount: 0, lastQualifiedDayKey: null,` |
| 57 | `currentStreak` | initialise | users.currentStreak | Consecutive qualifying days | `currentStreak: 0, bestStreak: 0, perfectDayCount: 0, lastQualifiedDayKey: null,` |
| 72 | `weeklyPoints` | initialise | derived (client-computed today) | Weekly leaderboard score | `memberId: CHILD_ID, familyId: FAMILY_ID, [BALANCE]: 0, xpTotal: 0, weeklyPoints: 0,` |
| 72 | `xpTotal` | initialise | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `memberId: CHILD_ID, familyId: FAMILY_ID, [BALANCE]: 0, xpTotal: 0, weeklyPoints: 0,` |
| 73 | `bestStreak` | initialise | summary.bestStreak | Projection best-streak counter | `currentStreak: 0, bestStreak: 0, lastQualifiedDayKey: null, unlockedAvatarIds: [],` |
| 73 | `currentStreak` | initialise | users.currentStreak | Consecutive qualifying days | `currentStreak: 0, bestStreak: 0, lastQualifiedDayKey: null, unlockedAvatarIds: [],` |
| 74 | `level` | calculate | in-memory / derived | Member level | `weeklyWindowKey: '2026-W32', level: 1, xpProgressInLevel: 0, xpToNextLevel: 1000,` |
| 74 | `xpProgressInLevel` | calculate | summary.xpProgressInLevel | XP accumulated inside the current level | `weeklyWindowKey: '2026-W32', level: 1, xpProgressInLevel: 0, xpToNextLevel: 1000,` |
| 74 | `xpToNextLevel` | calculate | summary.xpToNextLevel | XP remaining until the next level | `weeklyWindowKey: '2026-W32', level: 1, xpProgressInLevel: 0, xpToNextLevel: 1000,` |
| 146 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `const summary = (await db.doc(ˋ${FAMILY_PATH}/gamification_summaries/${CHILD_ID}ˋ).get()).data()` |
| 147 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `check('summary xpTotal', summary.xpTotal, 20)` |
| 148 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `check('lifetimeXP mirrors xpTotal', child.lifetimeXP, summary.xpTotal)` |
| 148 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `check('lifetimeXP mirrors xpTotal', child.lifetimeXP, summary.xpTotal)` |
| 151 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `check('shadow xpTotal folded both events', shadow.xpTotal, 20)` |

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

#### `scripts/rehearsal/full-cutover.emulator.test.ts` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 65 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `function member(rewardPoints: number, xpTotal: number, memberId: string) {` |
| 65 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `function member(rewardPoints: number, xpTotal: number, memberId: string) {` |
| 69 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints,` |
| 70 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal,` |
| 71 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 72 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: xpTotal,` |
| 72 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpProgressInLevel: xpTotal,` |
| 73 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 1000,` |
| 75 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 76 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 230 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state?.rewardPoints).toBe(100)` |
| 231 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(state?.xpTotal).toBe(200)` |
| 307 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await readState(db, FAMILY, MEMBER))?.rewardPoints).toBe(110)` |
| 320 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await readState(db, FAMILY, MEMBER))?.rewardPoints).toBe(110)` |
| 356 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect((await readState(db, FAMILY, MEMBER))?.rewardPoints).toBe(110)` |

#### `scripts/repair-shared-task-completions.cjs` — MIGRATE · Phase 5 · risk Medium

> Historical one-shot migration tooling

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 74 | `task_occurrences` | migrate | families/{f}/task_occurrences | Server-side task occurrence dedupe records | `const occurrences = await db.collection(ˋfamilies/${familyId}/task_occurrencesˋ)` |
| 78 | `gamification_events` | migrate | families/{f}/gamification_events | Existing XP event ledger | `const events = await db.collection(ˋfamilies/${familyId}/gamification_eventsˋ)` |
| 82 | `gamification_summaries` | migrate | families/{f}/gamification_summaries | Legacy projection collection | `const summary = await db.doc(ˋfamilies/${familyId}/gamification_summaries/${childId}ˋ).get();` |
| 97 | `rewardPoints` | migrate | users.rewardPoints | Spendable Reward Points balance (RP) | `currentRewardPoints: child.rewardPoints ?? 0,` |
| 98 | `xpTotal` | migrate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `currentXpTotal: summary.exists ? (summary.data().xpTotal ?? 0) : 0,` |

#### `scripts/replay/export-to-fixtures.test.ts` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 53 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `behaviour_events: [` |
| 77 | `level` | test | in-memory / derived | Member level | `[{ id: 'm1', data: { rewardPoints: 50, xpTotal: 40, level: 3 } }],` |
| 77 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `[{ id: 'm1', data: { rewardPoints: 50, xpTotal: 40, level: 3 } }],` |
| 77 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `[{ id: 'm1', data: { rewardPoints: 50, xpTotal: 40, level: 3 } }],` |
| 80 | `level` | test | in-memory / derived | Member level | `expect(fixture.displayed).toEqual({ m1: { rewardPoints: 50, xpTotal: 40, level: 3 } })` |
| 80 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(fixture.displayed).toEqual({ m1: { rewardPoints: 50, xpTotal: 40, level: 3 } })` |
| 80 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(fixture.displayed).toEqual({ m1: { rewardPoints: 50, xpTotal: 40, level: 3 } })` |
| 108 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `it('maps behaviour_events type -> behaviourType', () => {` |
| 109 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `const out = mapLegacyDoc('behaviour_events', {` |
| 182 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `behaviour_events: [{ id: 'b1', data: { type: 'positive', childId: 'm1', pointsDelta: 3, createdAt: '2026-01-03T00:00:00.000Z' } }],` |
| 203 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `behaviour_events: [{ id: 'b1', data: { childId: 'm1', behaviourType: 'positive', createdAt: 'c' } }],` |
| 232 | `gamification_summaries` | test | families/{f}/gamification_summaries | Legacy projection collection | `assertReadCollectionsSafe([...Object.keys(LEGACY_COLLECTION_MAP), 'gamification_summaries', 'tasks']),` |

#### `scripts/replay/export-to-fixtures.ts` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 27 | `behaviour_events` | read | families/{f}/behaviour_events | Behaviour intent log | `behaviour_events: 'behaviours',` |
| 49 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `readonly rewardPoints: number` |
| 50 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `readonly xpTotal: number` |
| 106 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `* Production gamification ˋreversalsˋ is a generic reversal log that also covers` |
| 140 | `behaviour_events` | read | families/{f}/behaviour_events | Behaviour intent log | `case 'behaviour_events': {` |
| 240 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: Number(s.data.rewardPoints ?? 0),` |
| 241 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: Number(s.data.xpTotal ?? s.data.totalXp ?? 0),` |
| 249 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `const points = t.data.points ?? t.data.rewardPoints ?? t.data.pointsValue ?? t.data.pointsReward` |
| 304 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `'gamification_summaries',` |
| 314 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `await famRef.collection('gamification_summaries').get(),` |
| 315 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `ˋfamilies/${familyId}/gamification_summariesˋ,` |

#### `scripts/replay/fixtures/FAM_DEMO_A.json` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 30 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `"m1": { "rewardPoints": 50, "xpTotal": 40, "level": 2, "currentStreak": 1, "bestStreak": 3, "unlockedAchievementIds": [], "unlockedAvatarIds": [] },` |
| 30 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `"m1": { "rewardPoints": 50, "xpTotal": 40, "level": 2, "currentStreak": 1, "bestStreak": 3, "unlockedAchievementIds": [], "unlockedAvatarIds": [] },` |
| 30 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `"m1": { "rewardPoints": 50, "xpTotal": 40, "level": 2, "currentStreak": 1, "bestStreak": 3, "unlockedAchievementIds": [], "unlockedAvatarIds": [] },` |
| 30 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `"m1": { "rewardPoints": 50, "xpTotal": 40, "level": 2, "currentStreak": 1, "bestStreak": 3, "unlockedAchievementIds": [], "unlockedAvatarIds": [] },` |
| 31 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `"m2": { "rewardPoints": 0, "xpTotal": 0, "level": 1, "currentStreak": 0, "bestStreak": 0, "unlockedAchievementIds": [], "unlockedAvatarIds": [] }` |
| 31 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `"m2": { "rewardPoints": 0, "xpTotal": 0, "level": 1, "currentStreak": 0, "bestStreak": 0, "unlockedAchievementIds": [], "unlockedAvatarIds": [] }` |
| 31 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `"m2": { "rewardPoints": 0, "xpTotal": 0, "level": 1, "currentStreak": 0, "bestStreak": 0, "unlockedAchievementIds": [], "unlockedAvatarIds": [] }` |
| 31 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `"m2": { "rewardPoints": 0, "xpTotal": 0, "level": 1, "currentStreak": 0, "bestStreak": 0, "unlockedAchievementIds": [], "unlockedAvatarIds": [] }` |

#### `scripts/replay/production-report.test.ts` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 35 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 36 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 0,` |
| 37 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 38 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 39 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 80 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(famA.members['m1'].replayed.rewardPoints).toBe(30) // task 20 + behaviour 20 - redemption 10` |
| 82 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(famA.members['m2'].replayed.rewardPoints).toBe(7) // estimated 12 - negative 5` |
| 123 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `m1: makeDisplayed({ rewardPoints: 10, xpTotal: 5, level: 1, currentStreak: 0, bestStreak: 0 }),` |
| 123 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `m1: makeDisplayed({ rewardPoints: 10, xpTotal: 5, level: 1, currentStreak: 0, bestStreak: 0 }),` |
| 123 | `level` | test | in-memory / derived | Member level | `m1: makeDisplayed({ rewardPoints: 10, xpTotal: 5, level: 1, currentStreak: 0, bestStreak: 0 }),` |
| 123 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `m1: makeDisplayed({ rewardPoints: 10, xpTotal: 5, level: 1, currentStreak: 0, bestStreak: 0 }),` |
| 123 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `m1: makeDisplayed({ rewardPoints: 10, xpTotal: 5, level: 1, currentStreak: 0, bestStreak: 0 }),` |
| 131 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(m.diff!.rewardPoints).toBe(10) // 20 - 10` |
| 132 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(m.diff!.xpTotal).toBe(15) // 20 - 5` |

#### `scripts/replay/production-report.ts` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 42 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `readonly rewardPoints: number` |
| 43 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `readonly xpTotal: number` |
| 45 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `readonly currentStreak: number` |
| 46 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `readonly bestStreak: number` |
| 122 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `readonly rewardPoints: number` |
| 123 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `readonly xpTotal: number` |
| 125 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `readonly currentStreak: number` |
| 126 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `readonly bestStreak: number` |
| 176 | `rewardPoints` | write | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: replayed.rewardPoints - displayed.rewardPoints,` |
| 177 | `xpTotal` | write | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: replayed.xpTotal - displayed.xpTotal,` |
| 179 | `currentStreak` | write | users.currentStreak | Consecutive qualifying days | `currentStreak: replayed.currentStreak - displayed.currentStreak,` |
| 180 | `bestStreak` | write | summary.bestStreak | Projection best-streak counter | `bestStreak: replayed.bestStreak - displayed.bestStreak,` |
| 344 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `ˋ\| ${memberId} \| ${m.replayed.rewardPoints} \| ${m.replayed.xpTotal} \| ${m.replayed.level} \| ${m.replayed.currentStreak} \| ${m.replayed.bestStreak} \| ${d ? d.rew` |
| 344 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `ˋ\| ${memberId} \| ${m.replayed.rewardPoints} \| ${m.replayed.xpTotal} \| ${m.replayed.level} \| ${m.replayed.currentStreak} \| ${m.replayed.bestStreak} \| ${d ? d.rew` |
| 344 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `ˋ\| ${memberId} \| ${m.replayed.rewardPoints} \| ${m.replayed.xpTotal} \| ${m.replayed.level} \| ${m.replayed.currentStreak} \| ${m.replayed.bestStreak} \| ${d ? d.rew` |
| 344 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `ˋ\| ${memberId} \| ${m.replayed.rewardPoints} \| ${m.replayed.xpTotal} \| ${m.replayed.level} \| ${m.replayed.currentStreak} \| ${m.replayed.bestStreak} \| ${d ? d.rew` |

#### `scripts/replay/reconcile.ts` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 263 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `fallbackValue: c.rewardPoints,` |
| 471 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `'The legacy ˋreversalsˋ collection is a generic reversal log that also covers wallet/fund reversals. ' +` |

#### `scripts/replay/run-dry-run.test.ts` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 68 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(result.replayedMembers['m1'].rewardPoints).toBe(20)` |

#### `scripts/replay/run-dry-run.ts` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 115 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `const rewardPointsDelta = classification.rewardPoints ?? 0` |

#### `scripts/replay/verify.test.ts` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 121 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(result.replayedMembers['m1'].rewardPoints).toBe(20)` |

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

#### `scripts/verify/pre-cutover.test.ts` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Read-only operational forensics against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 107 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `function memberReport(rewardPoints: number, xpTotal: number) {` |
| 107 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `function memberReport(rewardPoints: number, xpTotal: number) {` |
| 111 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints,` |
| 112 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal,` |
| 113 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 114 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: xpTotal,` |
| 114 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpProgressInLevel: xpTotal,` |
| 115 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 1000,` |
| 117 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 118 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 216 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `const statePath = ˋfamilies/${FAMILY_A}/gamification_state/mem-1ˋ` |
| 218 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `corrupted.rewardPoints = 999` |
| 231 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `store.delete(ˋfamilies/${FAMILY_A}/gamification_state/mem-1ˋ)` |
| 271 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `store.write(ˋfamilies/${FAMILY_A}/gamification_events/badˋ, badEvent)` |
| 323 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `store.write(ˋfamilies/${FAMILY_A}/gamification_events/crossˋ, crossEvent)` |
| 337 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 338 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 0,` |
| 339 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 340 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 0,` |
| 341 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 1000,` |
| 343 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 344 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |

#### `scripts/verify/production-verify.test.ts` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Read-only operational forensics against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 74 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `function member(rewardPoints: number, xpTotal: number, memberId: string) {` |
| 74 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `function member(rewardPoints: number, xpTotal: number, memberId: string) {` |
| 78 | `level` | test | in-memory / derived | Member level | `rewardPoints, xpTotal, level: 1, xpProgressInLevel: xpTotal, xpToNextLevel: 1000,` |
| 78 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints, xpTotal, level: 1, xpProgressInLevel: xpTotal, xpToNextLevel: 1000,` |
| 78 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `rewardPoints, xpTotal, level: 1, xpProgressInLevel: xpTotal, xpToNextLevel: 1000,` |
| 78 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `rewardPoints, xpTotal, level: 1, xpProgressInLevel: xpTotal, xpToNextLevel: 1000,` |
| 78 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `rewardPoints, xpTotal, level: 1, xpProgressInLevel: xpTotal, xpToNextLevel: 1000,` |
| 79 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `levelProgressPercentage: 0, currentStreak: 0, bestStreak: 0, lastQualifiedDayKey: null,` |
| 79 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `levelProgressPercentage: 0, currentStreak: 0, bestStreak: 0, lastQualifiedDayKey: null,` |

#### `scripts/wallet-snapshot.test.cjs` — TEMPORARY COMPATIBILITY · Phase 6 · risk Low

> Ad-hoc tooling against legacy shapes

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 78 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `const mk = (bal, rp) => ({ walletBalance: bal, rewardPoints: rp, lifetimeXP: 9, currentStreak: 3 })` |
| 78 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const mk = (bal, rp) => ({ walletBalance: bal, rewardPoints: rp, lifetimeXP: 9, currentStreak: 3 })` |
| 78 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `const mk = (bal, rp) => ({ walletBalance: bal, rewardPoints: rp, lifetimeXP: 9, currentStreak: 3 })` |

#### `src/components/challenges/ChildChallengeCelebration.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 10 | `claimChallenge` | calculate | in-memory / derived | Family challenge claim (RP + XP credit) | `*    distribution stays inside ˋclaimChallengeˋ (src/lib/api.ts).` |

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

#### `src/components/parent/ApprovalCenter.childJoin.test.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 6 | `approveTaskCompletion` | test | in-memory / derived | V4 task completion command (RP + XP credit) | `approveTaskCompletion: vi.fn(), rejectTaskCompletion: vi.fn(),` |
| 101 | `approveTaskCompletion` | test | in-memory / derived | V4 task completion command (RP + XP credit) | `expect(api.approveTaskCompletion).not.toHaveBeenCalled()` |

#### `src/components/parent/ApprovalCenter.test.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 6 | `approveTaskCompletion` | test | in-memory / derived | V4 task completion command (RP + XP credit) | `approveTaskCompletion: vi.fn(), rejectTaskCompletion: vi.fn(),` |
| 75 | `approveTaskCompletion` | test | in-memory / derived | V4 task completion command (RP + XP credit) | `api.approveTaskCompletion.mockReturnValue(pending.promise)` |
| 82 | `approveTaskCompletion` | test | in-memory / derived | V4 task completion command (RP + XP credit) | `expect(api.approveTaskCompletion).toHaveBeenCalledTimes(1)` |
| 96 | `approveTaskCompletion` | test | in-memory / derived | V4 task completion command (RP + XP credit) | `api.approveTaskCompletion.mockReturnValue(taskPending.promise)` |
| 249 | `level` | test | in-memory / derived | Member level | `expect(screen.getByRole('heading', { name: 'Money Request', level: 3 })).toBeInTheDocument();` |

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
| 35 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `])('shows authoritative total %i XP separately from %i XP to the next level', (xpTotal, xpToNextLevel) => {` |
| 35 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `])('shows authoritative total %i XP separately from %i XP to the next level', (xpTotal, xpToNextLevel) => {` |
| 38 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `child={{ id: 'c1', displayName: 'Child', lifetimeXP: 1, rewardPoints: 0 }}` |
| 38 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `child={{ id: 'c1', displayName: 'Child', lifetimeXP: 1, rewardPoints: 0 }}` |
| 41 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `gamificationSummary={summaryView({ xpTotal, xpToNextLevel, xpProgressInLevel: xpTotal })}` |
| 41 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `gamificationSummary={summaryView({ xpTotal, xpToNextLevel, xpProgressInLevel: xpTotal })}` |
| 41 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `gamificationSummary={summaryView({ xpTotal, xpToNextLevel, xpProgressInLevel: xpTotal })}` |
| 45 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(screen.getByText(ˋ${xpTotal} XPˋ)).toBeInTheDocument();` |
| 46 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `expect(screen.getByText(ˋ${xpToNextLevel} XP to Level 2ˋ)).toBeInTheDocument();` |
| 49 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('renders level/progress from the projection even when users.lifetimeXP is stale', () => {` |
| 50 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const child = { id: 'c1', displayName: 'Alice', lifetimeXP: 9999, rewardPoints: 0 };` |
| 50 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const child = { id: 'c1', displayName: 'Alice', lifetimeXP: 9999, rewardPoints: 0 };` |
| 56 | `level` | test | in-memory / derived | Member level | `gamificationSummary={summaryView({ level: 3, xpTotal: 2500, xpToNextLevel: 500, xpProgressInLevel: 500 })}` |
| 56 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `gamificationSummary={summaryView({ level: 3, xpTotal: 2500, xpToNextLevel: 500, xpProgressInLevel: 500 })}` |
| 56 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `gamificationSummary={summaryView({ level: 3, xpTotal: 2500, xpToNextLevel: 500, xpProgressInLevel: 500 })}` |
| 56 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `gamificationSummary={summaryView({ level: 3, xpTotal: 2500, xpToNextLevel: 500, xpProgressInLevel: 500 })}` |
| 65 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('does not fabricate a level from lifetimeXP when the projection is unavailable', () => {` |
| 66 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const child = { id: 'c1', displayName: 'Bob', lifetimeXP: 4200, rewardPoints: 0 };` |
| 66 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const child = { id: 'c1', displayName: 'Bob', lifetimeXP: 4200, rewardPoints: 0 };` |
| 76 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// Fallback state only — never a lifetimeXP-derived level, never a fake Level 1` |
| 84 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const child = { id: 'c1', displayName: 'Cara', lifetimeXP: 1200, rewardPoints: 0 };` |
| 84 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const child = { id: 'c1', displayName: 'Cara', lifetimeXP: 1200, rewardPoints: 0 };` |

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
| 74 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `<span>{t('childCard.xpTotal')}</span>` |
| 75 | `xpTotal` | calculate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `<span className="text-xs font-bold text-gray-900">{t('childCard.xpTotalValue', { xp: summary.xpTotal })}</span>` |
| 77 | `xpToNextLevel` | calculate | summary.xpToNextLevel | XP remaining until the next level | `<span aria-label={t('childCard.xpToNext', { xp: xpToNextLevel, level: (level as number) + 1 })}>` |
| 78 | `xpToNextLevel` | calculate | summary.xpToNextLevel | XP remaining until the next level | `{t('childCard.xpToNext', { xp: xpToNextLevel, level: (level as number) + 1 })}` |
| 81 | `level` | calculate | in-memory / derived | Member level | `<Progress value={levelProgress} className="mt-1" />` |
| 105 | `bestStreak` | calculate | summary.bestStreak | Projection best-streak counter | `<p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{t('childCard.bestStreak')}</p>` |
| 108 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `{bestStreak}` |

#### `src/components/parent/dashboard/ChildrenOverview.test.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 84 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('falls back to lifetimeXP so a missing projection never hides valid progression', () => {` |
| 87 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{ id: 'c-1', role: 'child', displayName: 'Alice', lifetimeXP: 2500 },` |
| 99 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// The child's valid progression (derived from lifetimeXP = 2500 -> Level 3)` |
| 108 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('keeps the dirty projection own values (priority 2), never lifetimeXP', () => {` |
| 111 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{ id: 'c-1', role: 'child', displayName: 'Alice', lifetimeXP: 4200 },` |
| 121 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1000,` |
| 122 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 123 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 1,` |
| 124 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 3,` |
| 141 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `// The dirty projection is authoritative: its own Level 2 (xpTotal 1000)` |
| 142 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// is shown, NOT the lifetimeXP-derived Level 5 (4200).` |
| 151 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('REQUIRED: dirty summary xpTotal=420 with lifetimeXP=400 shows 420 (not 400)', () => {` |
| 151 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `it('REQUIRED: dirty summary xpTotal=420 with lifetimeXP=400 shows 420 (not 400)', () => {` |
| 154 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{ id: 'c-1', role: 'child', displayName: 'Alice', lifetimeXP: 400 },` |
| 164 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 420,` |
| 165 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 166 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 167 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 184 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// xpTotal 420 -> "580 XP to Level 2". The lifetimeXP=400 would render` |
| 184 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `// xpTotal 420 -> "580 XP to Level 2". The lifetimeXP=400 would render` |
| 193 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `it('REQUIRED: ready summary xpTotal=420 is authoritative (shows 420-derived progress)', () => {` |
| 196 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{ id: 'c-1', role: 'child', displayName: 'Alice', lifetimeXP: 400 },` |
| 206 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 420,` |
| 207 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 208 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 209 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 226 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// xpTotal 420 -> "580 XP to Level 2" (NOT the lifetimeXP=400 "600 XP to Level 2").` |
| 226 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `// xpTotal 420 -> "580 XP to Level 2" (NOT the lifetimeXP=400 "600 XP to Level 2").` |
| 231 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('REQUIRED: missing summary and no lifetimeXP renders unavailable', () => {` |
| 246 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// No projection AND no lifetimeXP -> genuinely unavailable.` |
| 268 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 420,` |
| 269 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 270 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 271 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 285 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 2500,` |
| 286 | `level` | test | in-memory / derived | Member level | `level: 3,` |
| 287 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 288 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 307 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `// Alice's card shows her own Level 1 (xpTotal 420), never Bob's Level 3.` |
| 310 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `// Bob's card shows his own Level 3 (xpTotal 2500), never Alice's Level 1.` |
| 330 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1000,` |
| 331 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 332 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 1,` |
| 333 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 3,` |
| 369 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 2500,` |
| 370 | `level` | test | in-memory / derived | Member level | `level: 3,` |
| 371 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 2,` |
| 372 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 5,` |
| 434 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1000,` |
| 435 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 436 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 1,` |
| 437 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 3,` |
| 451 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 5000,` |
| 452 | `level` | test | in-memory / derived | Member level | `level: 6,` |
| 453 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 5,` |
| 454 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 10,` |
| 535 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 86,` |
| 536 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 537 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 538 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 587 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 361,` |
| 588 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 589 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 1,` |
| 590 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 1,` |
| 602 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('REQUIRED: dirty summary (xpTotal=361) wins over member lifetimeXP=86 — no Updating…', () => {` |
| 602 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `it('REQUIRED: dirty summary (xpTotal=361) wins over member lifetimeXP=86 — no Updating…', () => {` |
| 605 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `{ id: 'c-1', role: 'child', displayName: 'Alice', lifetimeXP: 86, currentStreak: 2, longestStreak: 2 },` |
| 605 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{ id: 'c-1', role: 'child', displayName: 'Alice', lifetimeXP: 86, currentStreak: 2, longestStreak: 2 },` |
| 605 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `{ id: 'c-1', role: 'child', displayName: 'Alice', lifetimeXP: 86, currentStreak: 2, longestStreak: 2 },` |
| 617 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// xpTotal 361 -> "639 XP to Level 2". The member fallback (lifetimeXP=86)` |
| 617 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `// xpTotal 361 -> "639 XP to Level 2". The member fallback (lifetimeXP=86)` |
| 621 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `// bestStreak comes from the summary (1), never the member's longestStreak (2).` |
| 621 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `// bestStreak comes from the summary (1), never the member's longestStreak (2).` |
| 627 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('REQUIRED: missing summary falls back to member values (lifetimeXP=86)', () => {` |
| 630 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `{ id: 'c-1', role: 'child', displayName: 'Alice', lifetimeXP: 86, currentStreak: 2, longestStreak: 2 },` |
| 630 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{ id: 'c-1', role: 'child', displayName: 'Alice', lifetimeXP: 86, currentStreak: 2, longestStreak: 2 },` |
| 630 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `{ id: 'c-1', role: 'child', displayName: 'Alice', lifetimeXP: 86, currentStreak: 2, longestStreak: 2 },` |
| 642 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// Fallback derives level from lifetimeXP=86 -> "914 XP to Level 2".` |
| 650 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{ id: 'c-1', role: 'child', displayName: 'Alice', lifetimeXP: 86 },` |
| 651 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{ id: 'c-2', role: 'child', displayName: 'Bob', lifetimeXP: 50 },` |
| 657 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `gamificationSummaries: [makeSummary({ childId: 'c-2', id: 'c-2', xpTotal: 9999, bestStreak: 9 })],` |
| 657 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `gamificationSummaries: [makeSummary({ childId: 'c-2', id: 'c-2', xpTotal: 9999, bestStreak: 9 })],` |
| 664 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// Alice (c-1) has no summary -> falls back to her lifetimeXP=86 ("914 XP to Level 2"),` |
| 690 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1000,` |
| 691 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 692 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 1,` |
| 693 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 3,` |

#### `src/components/parent/dashboard/ChildrenOverview.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 108 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// is authoritative; ˋchild.lifetimeXPˋ is only a compatibility` |

#### `src/components/parent/dashboard/PendingApprovalsSection.test.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 5 | `approveTaskCompletion` | test | in-memory / derived | V4 task completion command (RP + XP credit) | `approveTaskCompletion: vi.fn(), rejectTaskCompletion: vi.fn(),` |

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

#### `src/components/requests/RequestDetail.test.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 10 | `approveTaskCompletion` | test | in-memory / derived | V4 task completion command (RP + XP credit) | `approveTaskCompletion: vi.fn(),` |

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

#### `src/components/reversals/ReversalHistoryPanel.attribution.test.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 15 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `familyMembers: [{ id: 'child-1', displayName: 'Alisya', rewardPoints: 20 }],` |

#### `src/components/reversals/ReversalHistoryPanel.test.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 10 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `familyData: { currency: '£' }, familyMembers: [{ id: 'child-1', displayName: 'Alex', rewardPoints: 20 }],` |

#### `src/components/reversals/ReversalHistoryPanel.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 48 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `points: Object.fromEntries(state.familyMembers.map((member: any) => [member.id, member.rewardPoints \|\| 0])),` |
| 63 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `.filter(action => action.action \|\| action.reversal)` |
| 110 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `{action.reversal && (` |
| 113 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `<p className="mt-1 font-medium">{action.reversal.reason}</p>` |
| 114 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `<p>{t('byActor', { actor: action.reversal.actorName, date: reversalDate(action.reversal.occurredAt) })}</p>` |

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

#### `src/domain/gamification/rebuildNormalization.test.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 46 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `baseline(MOSTIUM, 90), canonical('mostium-task', MOSTIUM, 425), canonical('mostium-reversal', MOSTIUM, -30, 'xp_revoked'),` |

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
| 119 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `readonly xpTotal: number` |
| 121 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `readonly currentStreak: number` |
| 122 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `readonly bestStreak: number` |

#### `src/domain/gamification/v3/contract.test.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 162 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `sourceType: 'reversal',` |
| 220 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('requires a reversal reference on REVERSAL events and forbids it elsewhere', () => {` |
| 225 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `eventId: 'reversal:x:y',` |
| 226 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `sourceType: 'reversal',` |
| 265 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `'reversal:task-approved:family-1:member-1:t:rev-1',` |
| 317 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: -1,` |
| 318 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 0,` |
| 319 | `weeklyPoints` | test | derived (client-computed today) | Weekly leaderboard score | `weeklyPoints: 0,` |
| 321 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 322 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 0,` |
| 323 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 1000,` |
| 325 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 326 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 333 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(() => assertValidStateV3(state)).toThrow(/rewardPoints/)` |
| 334 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(() => assertValidStateV3({ ...state, rewardPoints: 0 })).not.toThrow()` |

#### `src/domain/gamification/v3/event.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 55 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `/** Only REVERSAL events may carry a reversal reference. */` |
| 101 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `/** Mandatory: a reversal is never a standalone untraceable correction. */` |
| 146 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `// A reversal is the only event permitted to reduce XP, and only by referencing a prior event.` |

#### `src/domain/gamification/v3/ids.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 98 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `return ˋreversal:${originalEventId}:${reversalId}ˋ` |

#### `src/domain/gamification/v3/rebuild.test.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 118 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 370,` |
| 119 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 420,` |
| 120 | `weeklyPoints` | test | derived (client-computed today) | Weekly leaderboard score | `weeklyPoints: 40,` |
| 122 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 123 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 420,` |
| 124 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 580,` |
| 126 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 127 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 135 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(state.xpTotal).toBe(380 + 20 + 20)` |

#### `src/domain/gamification/v3/reducer.test.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 96 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `function baseline(rewardPoints: number, xp: number) {` |
| 104 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPointsDelta: rewardPoints,` |
| 114 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `sourceType: 'reversal',` |
| 128 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state.rewardPoints).toBe(25)` |
| 133 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state.rewardPoints).toBe(20)` |
| 134 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(state.xpTotal).toBe(50)` |
| 155 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state.rewardPoints).toBe(0)` |
| 156 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(state.xpTotal).toBe(5)` |
| 167 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('cancels exactly the referenced event effect on reversal', () => {` |
| 170 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state.rewardPoints).toBe(380)` |
| 171 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(state.xpTotal).toBe(380)` |
| 172 | `weeklyPoints` | test | derived (client-computed today) | Weekly leaderboard score | `expect(state.weeklyPoints).toBe(0)` |
| 175 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('rejects a reversal that references an unknown or already reversed event', () => {` |
| 191 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(state.xpTotal).toBe(420)` |
| 214 | `weeklyPoints` | test | derived (client-computed today) | Weekly leaderboard score | `expect(state.weeklyPoints).toBe(5)` |
| 215 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state.rewardPoints).toBe(2)` |
| 223 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state.rewardPoints).toBe(420)` |
| 224 | `weeklyPoints` | test | derived (client-computed today) | Weekly leaderboard score | `expect(state.weeklyPoints).toBe(40)` |
| 225 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(state.xpTotal).toBe(420)` |
| 228 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('applies a reversal to the window of the original event', () => {` |
| 233 | `weeklyPoints` | test | derived (client-computed today) | Weekly leaderboard score | `expect(state.weeklyPoints).toBe(0)` |
| 234 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state.rewardPoints).toBe(10)` |
| 240 | `weeklyPoints` | test | derived (client-computed today) | Weekly leaderboard score | `expect(state.weeklyPoints).toBe(0)` |
| 241 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state.rewardPoints).toBe(400)` |
| 242 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(state.xpTotal).toBe(400)` |
| 249 | `level` | test | in-memory / derived | Member level | `expect(state.level).toBe(2)` |
| 250 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `expect(state.xpProgressInLevel).toBe(500)` |
| 251 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `expect(state.xpToNextLevel).toBe(500)` |
| 268 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `expect(state.currentStreak).toBe(1)` |
| 269 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `expect(state.bestStreak).toBe(2)` |
| 296 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 315,` |
| 297 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 420,` |
| 298 | `weeklyPoints` | test | derived (client-computed today) | Weekly leaderboard score | `weeklyPoints: 40,` |
| 300 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 301 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 420,` |
| 302 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 580,` |
| 304 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 305 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 316 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(empty.rewardPoints).toBe(0)` |
| 317 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(empty.xpTotal).toBe(0)` |
| 326 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(state.xpTotal).toBe(420)` |
| 327 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state.rewardPoints).toBe(420)` |
| 333 | `weeklyPoints` | test | derived (client-computed today) | Weekly leaderboard score | `expect(state.weeklyPoints).toBe(5)` |
| 334 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state.rewardPoints).toBe(5)` |
| 335 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(state.xpTotal).toBe(5)` |
| 336 | `weeklyPoints` | test | derived (client-computed today) | Weekly leaderboard score | `expect(state.weeklyPoints).not.toBe(15)` |
| 339 | `leaderboard` | test | in-memory / derived | Leaderboard ordering | `it('keeps the profile reward balance and the weekly leaderboard total independent', () => {` |
| 341 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state.rewardPoints).toBe(385)` |
| 342 | `weeklyPoints` | test | derived (client-computed today) | Weekly leaderboard score | `expect(state.weeklyPoints).toBe(5)` |
| 374 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state.rewardPoints).toBe(0) // +5 then -5, never negative` |
| 383 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state.rewardPoints).toBe(105) // baseline first, then task` |
| 386 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('processes original event before its reversal at the same timestamp', () => {` |
| 388 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `const reversal = makeSameTsEvent({ eventType: 'REVERSAL', eventId: 'reversal:task-approved:f:m:t1:r1', rewardPointsDelta: -10, xpDelta: -10, weeklyPointsDelta: ` |
| 389 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `const events = [reversal, original] // reversed order in input` |
| 391 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `expect(state.rewardPoints).toBe(0) // original processed first, then reversal` |
| 391 | `rewardPoints` | test | families/{f}/reversals | Spendable Reward Points balance (RP) | `expect(state.rewardPoints).toBe(0) // original processed first, then reversal` |
| 404 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(result.rewardPoints).toBe(reference.rewardPoints)` |
| 405 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(result.xpTotal).toBe(reference.xpTotal)` |
| 420 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(result.rewardPoints).toBe(first.rewardPoints)` |
| 421 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(result.xpTotal).toBe(first.xpTotal)` |
| 422 | `weeklyPoints` | test | derived (client-computed today) | Weekly leaderboard score | `expect(result.weeklyPoints).toBe(first.weeklyPoints)` |

#### `src/domain/gamification/v3/reducer.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 2 | `levelProgressForXp` | read | in-memory / derived | Canonical level formula | `import { levelProgressForXp } from '../level'` |
| 49 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `*   - earnings are applied before spending (rewardPoints never negative)` |
| 111 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `let rewardPoints = 0` |
| 112 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `let xpTotal = 0` |
| 113 | `weeklyPoints` | read | derived (client-computed today) | Weekly leaderboard score | `let weeklyPoints = 0` |
| 114 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `let currentStreak = 0` |
| 115 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `let bestStreak = 0` |
| 138 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `ˋreversalOfEventId ${event.reversalOfEventId} must be ordered before its reversalˋ,` |
| 145 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `// A reversal belongs to the weekly window of the event it corrects.` |
| 154 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `const nextReward = rewardPoints + event.rewardPointsDelta` |
| 159 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `ˋevent ${event.eventId} would drive rewardPoints negative (${nextReward}); reward points may never be negativeˋ,` |
| 162 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints = 0` |
| 164 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints = nextReward` |
| 167 | `xpTotal` | calculate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const nextXp = xpTotal + event.xpDelta` |
| 169 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `throw new ValidationErrorV3(ˋevent ${event.eventId} would drive xpTotal negative (${nextXp})ˋ)` |
| 171 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal = nextXp` |
| 174 | `weeklyPoints` | calculate | derived (client-computed today) | Weekly leaderboard score | `weeklyPoints = Math.max(0, weeklyPoints + event.weeklyPointsDelta)` |
| 185 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `currentStreak = 1` |
| 191 | `currentStreak` | calculate | users.currentStreak | Consecutive qualifying days | `currentStreak += 1` |
| 193 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `currentStreak = 1` |
| 197 | `bestStreak` | calculate | summary.bestStreak | Projection best-streak counter | `bestStreak = Math.max(bestStreak, currentStreak)` |
| 197 | `currentStreak` | calculate | users.currentStreak | Consecutive qualifying days | `bestStreak = Math.max(bestStreak, currentStreak)` |
| 201 | `levelProgressForXp` | read | in-memory / derived | Canonical level formula | `const progress = levelProgressForXp(xpTotal, GAMIFICATION_CONFIG_V1.xpPerLevel)` |
| 201 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const progress = levelProgressForXp(xpTotal, GAMIFICATION_CONFIG_V1.xpPerLevel)` |
| 206 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints,` |
| 207 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal,` |
| 208 | `weeklyPoints` | read | derived (client-computed today) | Weekly leaderboard score | `weeklyPoints,` |
| 209 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `currentStreak,` |
| 210 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `bestStreak,` |
| 215 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: progress.xpIntoLevel,` |
| 216 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: progress.xpToNextLevel,` |

#### `src/domain/gamification/v3/shadowCompare.test.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 54 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 400,` |
| 55 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 400,` |
| 56 | `weeklyPoints` | test | derived (client-computed today) | Weekly leaderboard score | `weeklyPoints: 20,` |
| 57 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 69 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `{ legacy: { ...legacy, rewardPoints: 123 }, events: [baseline, taskEvent], ledgerComplete: true },` |
| 78 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `{ legacy: { ...legacy, xpTotal: 1 }, events: [baseline, taskEvent], ledgerComplete: true },` |
| 84 | `weeklyPoints` | test | derived (client-computed today) | Weekly leaderboard score | `{ legacy: { ...legacy, weeklyPoints: 1 }, events: [baseline, taskEvent], ledgerComplete: true },` |
| 90 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `{ legacy: { ...legacy, currentStreak: 7 }, events: [baseline, taskEvent], ledgerComplete: true },` |
| 98 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `{ legacy: { ...legacy, rewardPoints: 999 }, events: [taskEvent], ledgerComplete: false },` |
| 121 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(result.projected?.rewardPoints).toBe(400)` |

#### `src/domain/gamification/v3/shadowCompare.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 23 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `readonly rewardPoints: number` |
| 24 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `readonly xpTotal: number` |
| 25 | `weeklyPoints` | read | derived (client-computed today) | Weekly leaderboard score | `readonly weeklyPoints: number` |
| 26 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `readonly currentStreak: number` |
| 59 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `{ field: 'rewardPoints', classification: 'reward_points_mismatch' },` |
| 60 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `{ field: 'xpTotal', classification: 'xp_mismatch' },` |
| 61 | `weeklyPoints` | read | derived (client-computed today) | Weekly leaderboard score | `{ field: 'weeklyPoints', classification: 'weekly_points_mismatch' },` |
| 62 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `{ field: 'currentStreak', classification: 'streak_mismatch' },` |

#### `src/domain/gamification/v3/state.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 9 | `currentStreak` | calculate | users.currentStreak | Consecutive qualifying days | `*  2. Ledger-derived      — rewardPoints, xpTotal, weeklyPoints, currentStreak,` |
| 9 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `*  2. Ledger-derived      — rewardPoints, xpTotal, weeklyPoints, currentStreak,` |
| 9 | `weeklyPoints` | calculate | derived (client-computed today) | Weekly leaderboard score | `*  2. Ledger-derived      — rewardPoints, xpTotal, weeklyPoints, currentStreak,` |
| 9 | `xpTotal` | calculate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `*  2. Ledger-derived      — rewardPoints, xpTotal, weeklyPoints, currentStreak,` |
| 10 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `*                           bestStreak, lastQualifiedDayKey, unlockedAvatarIds` |
| 11 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `*  3. Deterministic derived — level, xpProgressInLevel, xpToNextLevel,` |
| 11 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `*  3. Deterministic derived — level, xpProgressInLevel, xpToNextLevel,` |
| 15 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `* There is exactly one authoritative lifetime XP field: ˋxpTotalˋ.` |
| 16 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `* ˋlifetimeXPˋ is deliberately absent — it is a legacy alias, not a second value.` |
| 25 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `readonly rewardPoints: number` |
| 27 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `readonly xpTotal: number` |
| 29 | `weeklyPoints` | read | derived (client-computed today) | Weekly leaderboard score | `readonly weeklyPoints: number` |
| 30 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `readonly currentStreak: number` |
| 31 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `readonly bestStreak: number` |
| 38 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `readonly xpProgressInLevel: number` |
| 39 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `readonly xpToNextLevel: number` |
| 51 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `'rewardPoints',` |
| 52 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `'xpTotal',` |
| 53 | `weeklyPoints` | read | derived (client-computed today) | Weekly leaderboard score | `'weeklyPoints',` |
| 54 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `'currentStreak',` |
| 55 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `'bestStreak',` |
| 60 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `'xpProgressInLevel',` |
| 61 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `'xpToNextLevel',` |
| 70 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `'rewardPoints',` |
| 71 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `'xpTotal',` |
| 72 | `weeklyPoints` | read | derived (client-computed today) | Weekly leaderboard score | `'weeklyPoints',` |
| 75 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `'xpProgressInLevel',` |
| 76 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `'xpToNextLevel',` |
| 78 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `'currentStreak',` |
| 79 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `'bestStreak',` |

#### `src/domain/gamification/v3/storage.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 34 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `export const PROHIBITED_EVENT_FIELDS = ['lifetimeXP', 'points', 'totalPoints', 'weeklyTotal'] as const` |

#### `src/domain/gamification/v3/validators.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 119 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `throw new ValidationErrorV3('reversalOfEventId must not reference the reversal itself')` |
| 183 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `assertNonNegativeInteger(candidate.rewardPoints, 'rewardPoints')` |
| 184 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `assertNonNegativeInteger(candidate.xpTotal, 'xpTotal')` |
| 185 | `weeklyPoints` | read | derived (client-computed today) | Weekly leaderboard score | `assertNonNegativeInteger(candidate.weeklyPoints, 'weeklyPoints')` |
| 186 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `assertNonNegativeInteger(candidate.currentStreak, 'currentStreak')` |
| 187 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `assertNonNegativeInteger(candidate.bestStreak, 'bestStreak')` |
| 188 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `assertNonNegativeInteger(candidate.xpProgressInLevel, 'xpProgressInLevel')` |
| 189 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `assertNonNegativeInteger(candidate.xpToNextLevel, 'xpToNextLevel')` |

#### `src/domain/gamification/v4/achievements.test.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 19 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 20 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 0,` |
| 21 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 22 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 0,` |
| 23 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 1000,` |
| 25 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 26 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 43 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `it('unlocks first_steps at xpTotal >= 50', () => {` |
| 44 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `const state = makeState({ xpTotal: 50, xpProgressInLevel: 50, xpToNextLevel: 950, levelProgressPercentage: 5 })` |
| 44 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `const state = makeState({ xpTotal: 50, xpProgressInLevel: 50, xpToNextLevel: 950, levelProgressPercentage: 5 })` |
| 44 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const state = makeState({ xpTotal: 50, xpProgressInLevel: 50, xpToNextLevel: 950, levelProgressPercentage: 5 })` |
| 49 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `const state = makeState({ xpTotal: 49, xpProgressInLevel: 49, xpToNextLevel: 951, levelProgressPercentage: 4 })` |
| 49 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `const state = makeState({ xpTotal: 49, xpProgressInLevel: 49, xpToNextLevel: 951, levelProgressPercentage: 4 })` |
| 49 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const state = makeState({ xpTotal: 49, xpProgressInLevel: 49, xpToNextLevel: 951, levelProgressPercentage: 4 })` |
| 53 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `it('unlocks centurion at xpTotal >= 1000', () => {` |
| 54 | `level` | test | in-memory / derived | Member level | `const state = makeState({ xpTotal: 1000, level: 2, xpProgressInLevel: 0, xpToNextLevel: 1000, levelProgressPercentage: 0 })` |
| 54 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `const state = makeState({ xpTotal: 1000, level: 2, xpProgressInLevel: 0, xpToNextLevel: 1000, levelProgressPercentage: 0 })` |
| 54 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `const state = makeState({ xpTotal: 1000, level: 2, xpProgressInLevel: 0, xpToNextLevel: 1000, levelProgressPercentage: 0 })` |
| 54 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const state = makeState({ xpTotal: 1000, level: 2, xpProgressInLevel: 0, xpToNextLevel: 1000, levelProgressPercentage: 0 })` |
| 58 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `it('unlocks champion at xpTotal >= 5000', () => {` |
| 59 | `level` | test | in-memory / derived | Member level | `const state = makeState({ xpTotal: 5000, level: 6, xpProgressInLevel: 0, xpToNextLevel: 1000, levelProgressPercentage: 0 })` |
| 59 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `const state = makeState({ xpTotal: 5000, level: 6, xpProgressInLevel: 0, xpToNextLevel: 1000, levelProgressPercentage: 0 })` |
| 59 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `const state = makeState({ xpTotal: 5000, level: 6, xpProgressInLevel: 0, xpToNextLevel: 1000, levelProgressPercentage: 0 })` |
| 59 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const state = makeState({ xpTotal: 5000, level: 6, xpProgressInLevel: 0, xpToNextLevel: 1000, levelProgressPercentage: 0 })` |
| 63 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `it('unlocks streak achievements from bestStreak only', () => {` |
| 64 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `const state = makeState({ bestStreak: 3, currentStreak: 3 })` |
| 64 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `const state = makeState({ bestStreak: 3, currentStreak: 3 })` |
| 70 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `it('unlocks streak_master at bestStreak >= 7', () => {` |
| 71 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `const state = makeState({ bestStreak: 7, currentStreak: 7 })` |
| 71 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `const state = makeState({ bestStreak: 7, currentStreak: 7 })` |
| 75 | `level` | test | in-memory / derived | Member level | `it('unlocks a level-based achievement from state.level only', () => {` |
| 76 | `level` | test | in-memory / derived | Member level | `const state = makeState({ level: 5, xpTotal: 4000, xpProgressInLevel: 0, xpToNextLevel: 1000, levelProgressPercentage: 0 })` |
| 76 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `const state = makeState({ level: 5, xpTotal: 4000, xpProgressInLevel: 0, xpToNextLevel: 1000, levelProgressPercentage: 0 })` |
| 76 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `const state = makeState({ level: 5, xpTotal: 4000, xpProgressInLevel: 0, xpToNextLevel: 1000, levelProgressPercentage: 0 })` |
| 76 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const state = makeState({ level: 5, xpTotal: 4000, xpProgressInLevel: 0, xpToNextLevel: 1000, levelProgressPercentage: 0 })` |
| 82 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 5000,` |
| 83 | `level` | test | in-memory / derived | Member level | `level: 6,` |
| 84 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 0,` |
| 85 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 1000,` |
| 87 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 7,` |
| 88 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 7,` |
| 97 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `const state = makeState({ xpTotal: 1200, level: 2, xpProgressInLevel: 200, xpToNextLevel: 800, levelProgressPercentage: 20, bestStreak: 4, currentStreak: 4 })` |
| 97 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `const state = makeState({ xpTotal: 1200, level: 2, xpProgressInLevel: 200, xpToNextLevel: 800, levelProgressPercentage: 20, bestStreak: 4, currentStreak: 4 })` |
| 97 | `level` | test | in-memory / derived | Member level | `const state = makeState({ xpTotal: 1200, level: 2, xpProgressInLevel: 200, xpToNextLevel: 800, levelProgressPercentage: 20, bestStreak: 4, currentStreak: 4 })` |
| 97 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `const state = makeState({ xpTotal: 1200, level: 2, xpProgressInLevel: 200, xpToNextLevel: 800, levelProgressPercentage: 20, bestStreak: 4, currentStreak: 4 })` |
| 97 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `const state = makeState({ xpTotal: 1200, level: 2, xpProgressInLevel: 200, xpToNextLevel: 800, levelProgressPercentage: 20, bestStreak: 4, currentStreak: 4 })` |
| 97 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const state = makeState({ xpTotal: 1200, level: 2, xpProgressInLevel: 200, xpToNextLevel: 800, levelProgressPercentage: 20, bestStreak: 4, currentStreak: 4 })` |
| 102 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `const state = makeState({ xpTotal: 5000, level: 6, bestStreak: 7, unlockedAchievementIds: ['first_steps'] })` |
| 102 | `level` | test | in-memory / derived | Member level | `const state = makeState({ xpTotal: 5000, level: 6, bestStreak: 7, unlockedAchievementIds: ['first_steps'] })` |
| 102 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const state = makeState({ xpTotal: 5000, level: 6, bestStreak: 7, unlockedAchievementIds: ['first_steps'] })` |
| 109 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `// xpTotal negative is invalid per assertValidStateV4` |
| 110 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const bad = makeState({ xpTotal: -1 })` |
| 147 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const bad = makeState({ rewardPoints: -5 })` |

#### `src/domain/gamification/v4/achievements.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 8 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `* Per design §3.5, achievements are derived exclusively from ˋxpTotalˋ,` |
| 9 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `* ˋlevelˋ, ˋstreakˋ (bestStreak), and ˋunlockedAvatarIdsˋ. Reward Points are` |
| 35 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `* exclusively from ˋxpTotalˋ, ˋlevelˋ, and ˋbestStreakˋ (the V4 "streak").` |
| 35 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `* exclusively from ˋxpTotalˋ, ˋlevelˋ, and ˋbestStreakˋ (the V4 "streak").` |
| 41 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `check: (s) => s.xpTotal >= 50,` |
| 46 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `check: (s) => s.xpTotal >= 1000,` |
| 51 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `check: (s) => s.xpTotal >= 5000,` |
| 56 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `check: (s) => s.bestStreak >= 3,` |
| 61 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `check: (s) => s.bestStreak >= 7,` |

#### `src/domain/gamification/v4/event.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 41 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `/** Present iff this event is a reversal/refund of another event. */` |

#### `src/domain/gamification/v4/featureFlags.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 27 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `\| 'task_invalidation' // gamificationRepository.ts rewardPoints reversal` |
| 27 | `rewardPoints` | read | families/{f}/reversals | Spendable Reward Points balance (RP) | `\| 'task_invalidation' // gamificationRepository.ts rewardPoints reversal` |
| 32 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `\| 'avatar_unlock' // avatar unlock + goal reversal (src/lib/api.ts, reversalApi.ts)` |

#### `src/domain/gamification/v4/ids.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 31 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `* Deterministic id for a reversal/refund of an existing event.` |
| 33 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `* Appends ˋ::REVˋ or ˋ::REFUNDˋ to the original event id so the reversal` |

#### `src/domain/gamification/v4/level.test.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 5 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `* from ˋxpTotalˋ only. No UI formula, no client arithmetic, no Firestore.` |
| 17 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 18 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 0,` |
| 19 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: XP_PER_LEVEL_V4,` |
| 26 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 27 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 0,` |
| 28 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: XP_PER_LEVEL_V4,` |
| 36 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `expect(r.xpProgressInLevel).toBe(XP_PER_LEVEL_V4 - 1)` |
| 37 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `expect(r.xpToNextLevel).toBe(1)` |
| 44 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `expect(r.xpProgressInLevel).toBe(1)` |
| 45 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `expect(r.xpToNextLevel).toBe(XP_PER_LEVEL_V4 - 1)` |
| 52 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `expect(r.xpProgressInLevel).toBe(333)` |
| 60 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `expect(r.xpProgressInLevel).toBe(250)` |
| 61 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `expect(r.xpToNextLevel).toBe(750)` |
| 69 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `expect(r.xpProgressInLevel).toBe(0)` |
| 70 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `expect(r.xpToNextLevel).toBe(XP_PER_LEVEL_V4)` |
| 77 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `expect(r.xpProgressInLevel + r.xpToNextLevel).toBe(XP_PER_LEVEL_V4)` |
| 77 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `expect(r.xpProgressInLevel + r.xpToNextLevel).toBe(XP_PER_LEVEL_V4)` |
| 109 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `expect(r.xpProgressInLevel + r.xpToNextLevel).toBe(XP_PER_LEVEL_V4)` |
| 109 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `expect(r.xpProgressInLevel + r.xpToNextLevel).toBe(XP_PER_LEVEL_V4)` |
| 114 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `Number((BigInt(r.xpProgressInLevel) * 100n) / BigInt(XP_PER_LEVEL_V4)),` |

#### `src/domain/gamification/v4/level.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 5 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `* ˋxpTotalˋ (design §3.3). No UI formula, no client arithmetic, no Firestore,` |
| 9 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `* Invariant: same ˋxpTotalˋ -> identical progression fields, byte for byte.` |
| 18 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `/** Canonical progression derived from ˋxpTotalˋ only. */` |
| 20 | `xpTotal` | calculate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `/** 1-based level, derived as floor(xpTotal / XP_PER_LEVEL_V4) + 1. */` |
| 23 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `readonly xpProgressInLevel: number` |
| 24 | `xpProgressInLevel` | calculate | summary.xpProgressInLevel | XP accumulated inside the current level | `/** Remaining XP until the next level (XP_PER_LEVEL_V4 - xpProgressInLevel). */` |
| 25 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `readonly xpToNextLevel: number` |
| 30 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `function assertValidXpTotal(xpTotal: number): void {` |
| 31 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `if (!Number.isSafeInteger(xpTotal) \|\| xpTotal < 0) {` |
| 33 | `xpTotal` | calculate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `ˋxpTotal must be a non-negative safe integer (received ${String(xpTotal)})ˋ,` |
| 39 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `* Canonical V4 level derivation. Pure and deterministic: identical ˋxpTotalˋ` |
| 43 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `export function levelForXp(xpTotal: number): LevelProgressV4 {` |
| 44 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `assertValidXpTotal(xpTotal)` |
| 46 | `xpTotal` | calculate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const level = Math.floor(xpTotal / XP_PER_LEVEL_V4) + 1` |
| 47 | `xpProgressInLevel` | calculate | summary.xpProgressInLevel | XP accumulated inside the current level | `const xpProgressInLevel = xpTotal % XP_PER_LEVEL_V4` |
| 47 | `xpTotal` | calculate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const xpProgressInLevel = xpTotal % XP_PER_LEVEL_V4` |
| 48 | `xpProgressInLevel` | calculate | summary.xpProgressInLevel | XP accumulated inside the current level | `const xpToNextLevel = XP_PER_LEVEL_V4 - xpProgressInLevel` |
| 48 | `xpToNextLevel` | calculate | summary.xpToNextLevel | XP remaining until the next level | `const xpToNextLevel = XP_PER_LEVEL_V4 - xpProgressInLevel` |
| 52 | `xpProgressInLevel` | calculate | summary.xpProgressInLevel | XP accumulated inside the current level | `(BigInt(xpProgressInLevel) * 100n) / BigInt(XP_PER_LEVEL_V4),` |
| 58 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel,` |
| 59 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel,` |

#### `src/domain/gamification/v4/ordering.test.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 43 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('orders baseline before earnings before spending before reversal', () => {` |
| 86 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `const reversal = makeEvent({ eventType: 'TASK_REVERSED', sourceId: 'src-4', reversalOfEventId: 'x' })` |
| 88 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `const ordered = canonicalOrder([reversal, spending, earning, baseline])` |
| 120 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `describe('canonicalOrder — original before its reversal', () => {` |
| 123 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `const reversal = makeEvent({` |
| 129 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `const ordered = canonicalOrder([reversal, original])` |

#### `src/domain/gamification/v4/ordering.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 18 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `*   baseline (0) → earnings → spending → reversal (last)` |
| 24 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `* folded before its reversal at the same timestamp.` |

#### `src/domain/gamification/v4/rebuild.test.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 72 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(rebuilt.rewardPoints).toBe(0)` |
| 73 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(rebuilt.xpTotal).toBe(0)` |
| 82 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(rebuilt.rewardPoints).toBe(50)` |
| 83 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(rebuilt.xpTotal).toBe(50)` |
| 92 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(rebuilt.rewardPoints).toBe(reduced.rewardPoints)` |
| 93 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(rebuilt.xpTotal).toBe(reduced.xpTotal)` |
| 95 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `expect(rebuilt.currentStreak).toBe(reduced.currentStreak)` |
| 96 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `expect(rebuilt.bestStreak).toBe(reduced.bestStreak)` |
| 175 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `describe('rebuildStateFromLedger — reversal reproduces corrected state', () => {` |
| 176 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('rebuild after reversal reproduces the same corrected state as the reducer', () => {` |
| 179 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `const reversal = makeEvent({` |
| 186 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `const ledger = [keep, original, reversal]` |
| 190 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(rebuilt.rewardPoints).toBe(30)` |
| 191 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(rebuilt.xpTotal).toBe(30)` |
| 210 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(all.mem1.rewardPoints).toBe(6)` |
| 211 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(all.mem2.rewardPoints).toBe(7)` |

#### `src/domain/gamification/v4/rebuild.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 11 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `*     avatar and reversal logic live only in the reducer and its helpers.` |

#### `src/domain/gamification/v4/reducer.test.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 54 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state.rewardPoints).toBe(20)` |
| 55 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(state.xpTotal).toBe(20)` |
| 63 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state.rewardPoints).toBe(20)` |
| 64 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(state.xpTotal).toBe(20)` |
| 72 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state.rewardPoints).toBe(0)` |
| 73 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(state.xpTotal).toBe(0)` |
| 81 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state.rewardPoints).toBe(0)` |
| 82 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(state.xpTotal).toBe(0)` |
| 85 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('#5 reversal cancels exactly one original', () => {` |
| 87 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `const reversal = makeEvent({` |
| 94 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `const state = reduceGamificationEventsV4([original, reversal], CTX)` |
| 95 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state.rewardPoints).toBe(0)` |
| 96 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(state.xpTotal).toBe(0)` |
| 99 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `it('#12 rewardPoints never below zero', () => {` |
| 104 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state.rewardPoints).toBeGreaterThanOrEqual(0)` |
| 105 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state.rewardPoints).toBe(0)` |
| 108 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('#13 XP only decreases via reversal', () => {` |
| 109 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `// A non-reversal event with negative xpDelta is rejected by the reducer.` |
| 113 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `// A reversal event with negative xpDelta is accepted and reduces XP.` |
| 115 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `const reversal = makeEvent({` |
| 122 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `const state = reduceGamificationEventsV4([original, reversal], CTX)` |
| 123 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(state.xpTotal).toBe(0)` |
| 130 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state.rewardPoints).toBe(0)` |
| 131 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(state.xpTotal).toBe(0)` |
| 132 | `level` | test | in-memory / derived | Member level | `expect(state.level).toBe(1)` |
| 133 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `expect(state.currentStreak).toBe(0)` |
| 134 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `expect(state.bestStreak).toBe(0)` |
| 140 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `it('baseline only seeds rewardPoints and xpTotal', () => {` |
| 140 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `it('baseline only seeds rewardPoints and xpTotal', () => {` |
| 145 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state.rewardPoints).toBe(50)` |
| 146 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(state.xpTotal).toBe(50)` |
| 158 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(shuffled.rewardPoints).toBe(canonical.rewardPoints)` |
| 159 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(shuffled.xpTotal).toBe(canonical.xpTotal)` |
| 160 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `expect(shuffled.currentStreak).toBe(canonical.currentStreak)` |
| 179 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('reversal cancellation leaves non-reversed earnings intact', () => {` |
| 182 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `const reversal = makeEvent({` |
| 189 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `const state = reduceGamificationEventsV4([keep, original, reversal], CTX)` |
| 190 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state.rewardPoints).toBe(30)` |
| 191 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(state.xpTotal).toBe(30)` |
| 201 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const expected = levelForXp(state.xpTotal)` |
| 202 | `level` | test | in-memory / derived | Member level | `expect(state.level).toBe(expected.level)` |
| 203 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `expect(state.xpProgressInLevel).toBe(expected.xpProgressInLevel)` |
| 204 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `expect(state.xpToNextLevel).toBe(expected.xpToNextLevel)` |
| 218 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `expect(state.currentStreak).toBe(expected.currentStreak)` |
| 219 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `expect(state.bestStreak).toBe(expected.bestStreak)` |
| 253 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 5,` |
| 254 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 5,` |
| 255 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 256 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 5,` |
| 257 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 995,` |
| 259 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 260 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 270 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state.rewardPoints).toBe(snapshot.rewardPoints)` |
| 271 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(state.xpTotal).toBe(snapshot.xpTotal)` |
| 279 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(state.rewardPoints).toBe(10)` |

#### `src/domain/gamification/v4/reducer.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 10 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `*   - update authoritative projection fields (rewardPoints, xpTotal, avatars)` |
| 10 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `*   - update authoritative projection fields (rewardPoints, xpTotal, avatars)` |
| 16 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `* XP only decreases through reversal semantics (enforced by` |
| 46 | `rewardPoints` | initialise | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 47 | `xpTotal` | initialise | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 0,` |
| 48 | `level` | read | in-memory / derived | Member level | `level: 1,` |
| 49 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 0,` |
| 50 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 1000,` |
| 52 | `currentStreak` | initialise | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 53 | `bestStreak` | initialise | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 62 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `/** Single clamping site: rewardPoints is never allowed below zero. */` |
| 75 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `* Pure: ˋstateˋ and ˋeventˋ are never mutated. Only ˋrewardPointsˋ, ˋxpTotalˋ,` |
| 75 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `* Pure: ˋstateˋ and ˋeventˋ are never mutated. Only ˋrewardPointsˋ, ˋxpTotalˋ,` |
| 81 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `// XP may only decrease through reversal semantics (Task 1.8). Reused helper.` |
| 84 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `const rewardPoints = clampRewardPoints(state.rewardPoints + event.rewardPointsDelta)` |
| 85 | `xpTotal` | calculate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const xpTotal = state.xpTotal + event.xpDelta` |
| 95 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints,` |
| 96 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal,` |
| 127 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const level = levelForXp(acc.xpTotal)` |
| 132 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `currentStreak: streak.currentStreak,` |
| 133 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `bestStreak: streak.bestStreak,` |

#### `src/domain/gamification/v4/replay/classify.test.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 69 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(r.rewardPoints).toBe(20)` |
| 77 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(r.rewardPoints).toBe(5)` |
| 88 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(r.rewardPoints).toBe(15)` |
| 97 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(r.rewardPoints).toBeNull()` |
| 120 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(results[0].rewardPoints).toBeNull()` |
| 130 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(r.rewardPoints).toBeNull()` |
| 170 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(r.rewardPoints).toBeNull()` |

#### `src/domain/gamification/v4/replay/classify.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 42 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `readonly rewardPoints: number \| null` |
| 106 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: null,` |
| 116 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: null,` |
| 126 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: null,` |
| 142 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `evidence: ˋ${evidenceFor(source)} rewardPoints=${selected.points} estimated=${selected.estimated}ˋ,` |
| 144 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: selected.points,` |
| 152 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: null,` |
| 161 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `evidence: ˋ${evidenceFor(source)} rewardPoints=${source.rawRewardSnapshot}ˋ,` |
| 163 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: source.rawRewardSnapshot,` |
| 172 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: null,` |

#### `src/domain/gamification/v4/replay/report.test.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 46 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 20,` |
| 71 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const classes = [cls({ category: 'exact', rewardPoints: 20 })]` |
| 82 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const classes = [cls({ category: 'exact', rewardPoints: 5 })]` |
| 95 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `cls({ category: 'exact', rewardPoints: 10, reason: 'r-a', evidence: 'e-a' }),` |
| 96 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `cls({ category: 'exact', rewardPoints: 5, reason: 'r-b', evidence: 'e-b' }),` |

#### `src/domain/gamification/v4/replay/report.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 153 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `const rewardPointsDelta = classification.rewardPoints` |

#### `src/domain/gamification/v4/replay/sources.test.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 111 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `expect(r.sourceType).toBe('reversal')` |

#### `src/domain/gamification/v4/replay/sources.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 188 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `if (!doc.id) throw new MalformedSourceError('reversal', String(doc.id), 'missing id')` |
| 189 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `if (!doc.childId) throw new MalformedSourceError('reversal', doc.id, 'missing childId')` |
| 190 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `if (!doc.kind) throw new MalformedSourceError('reversal', doc.id, 'missing kind')` |
| 191 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `if (!doc.originalSourceId) throw new MalformedSourceError('reversal', doc.id, 'missing originalSourceId')` |
| 192 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `const effectiveAt = requireTimestamp(doc.createdAt, null, 'reversal', doc.id)` |
| 193 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `const createdAt = requireTimestamp(doc.createdAt, null, 'reversal', doc.id)` |

#### `src/domain/gamification/v4/reversal.test.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 2 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `* Gamification V4 — reversal event construction tests (Task 1.8).` |
| 15 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `import { buildReversalEvent, isReversalOf } from './reversal'` |
| 37 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('negates exactly the original deltas for a REV reversal', () => {` |
| 39 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `const reversal = buildReversalEvent(original, 'REV')` |
| 40 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `expect(reversal.rewardPointsDelta).toBe(-original.rewardPointsDelta)` |
| 41 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `expect(reversal.xpDelta).toBe(-original.xpDelta)` |
| 52 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `const reversal = buildReversalEvent(original, 'REV')` |
| 53 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `expect(reversal.reversalOfEventId).toBe(original.eventId)` |
| 54 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `expect(reversal.reversalOfEventId).not.toBe(reversal.eventId)` |
| 67 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `const reversal = buildReversalEvent(original, 'REV')` |
| 68 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `expect(reversal.familyId).toBe(original.familyId)` |
| 69 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `expect(reversal.memberId).toBe(original.memberId)` |
| 72 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('uses the reversal source type', () => {` |
| 74 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `const reversal = buildReversalEvent(original, 'REV')` |
| 75 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `expect(reversal.sourceType).toBe(SOURCE_TYPE.REVERSAL)` |
| 87 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `const reversal = buildReversalEvent(original, 'REV')` |
| 88 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `expect(() => assertValidEventV4(reversal)).not.toThrow()` |
| 91 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('is idempotent: same inputs yield equal reversal events', () => {` |
| 100 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `const reversal = buildReversalEvent(original, 'REV')` |
| 101 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `expect(isReversalOf(reversal, original.eventId)).toBe(true)` |
| 104 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('returns false for a non-reversal event', () => {` |
| 111 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `const reversal = buildReversalEvent(original, 'REV')` |
| 112 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `expect(isReversalOf(reversal, 'some-other-id')).toBe(false)` |

#### `src/domain/gamification/v4/reversal.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 2 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `* Gamification V4 — reversal event construction (Task 1.8).` |
| 5 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `* Builds a deterministic reversal/refund event that negates exactly one` |
| 27 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `* Build a deterministic reversal event that negates exactly one original.` |
| 36 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `* original because this module has no clock access; the reversal is anchored` |
| 57 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `reason: 'reversal',` |
| 67 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `* True iff ˋeventˋ is a reversal of the event identified by ˋoriginalEventIdˋ.` |
| 68 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `* A reversal references exactly one original via ˋreversalOfEventIdˋ.` |

#### `src/domain/gamification/v4/storage.test.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 7 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `*     "Collection: ˋfamilies/{familyId}/gamification_state/{memberId}ˋ"` |
| 12 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `*     "Collection: ˋfamilies/{familyId}/gamification_events/{eventId}ˋ"` |
| 34 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect(EVENTS_V4_COLLECTION_ID).toBe('gamification_events')` |
| 35 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `expect(STATE_V4_COLLECTION_ID).toBe('gamification_state')` |
| 46 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `expect(stateDocPath(FAMILY, MEMBER)).toBe('families/family-1/gamification_state/member-1')` |
| 50 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `expect(stateDocPath(FAMILY, MEMBER)).not.toBe('gamification_state/member-1')` |
| 58 | `leaderboard` | test | in-memory / derived | Leaderboard ordering | `it('exposes the collection path used for rebuild/leaderboard reads', () => {` |
| 59 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `expect(stateCollectionPath(FAMILY)).toBe('families/family-1/gamification_state')` |
| 66 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect(eventDocPath(FAMILY, 'evt-1')).toBe('families/family-1/gamification_events/evt-1')` |
| 67 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `expect(eventCollectionPath(FAMILY)).toBe('families/family-1/gamification_events')` |

#### `src/domain/gamification/v4/storage.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 11 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `*   families/{familyId}/gamification_events/{eventId}   — authoritative ledger` |
| 12 | `gamification_state` | read | in-memory / derived | New V4 projection state collection | `*   families/{familyId}/gamification_state/{memberId}   — authoritative projection` |
| 21 | `gamification_state` | calculate | in-memory / derived | New V4 projection state collection | `*   - No root-level ˋgamification_stateˋ collection.` |
| 30 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `export const EVENTS_V4_COLLECTION_ID = 'gamification_events'` |
| 31 | `gamification_state` | read | in-memory / derived | New V4 projection state collection | `export const STATE_V4_COLLECTION_ID = 'gamification_state'` |
| 66 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `/** ˋfamilies/{familyId}/gamification_eventsˋ */` |
| 71 | `gamification_events` | read | families/{f}/gamification_events | Existing XP event ledger | `/** ˋfamilies/{familyId}/gamification_events/{eventId}ˋ */` |
| 76 | `gamification_state` | read | in-memory / derived | New V4 projection state collection | `/** ˋfamilies/{familyId}/gamification_stateˋ */` |
| 81 | `gamification_state` | read | in-memory / derived | New V4 projection state collection | `/** ˋfamilies/{familyId}/gamification_state/{memberId}ˋ */` |

#### `src/domain/gamification/v4/streak.test.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 4 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `* Pure, deterministic projection of ˋcurrentStreakˋ / ˋbestStreakˋ /` |
| 4 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `* Pure, deterministic projection of ˋcurrentStreakˋ / ˋbestStreakˋ /` |
| 119 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 120 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 127 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `it('counts a single qualified day as currentStreak 1 / bestStreak 1', () => {` |
| 127 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `it('counts a single qualified day as currentStreak 1 / bestStreak 1', () => {` |
| 130 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `expect(result.currentStreak).toBe(1)` |
| 131 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `expect(result.bestStreak).toBe(1)` |
| 138 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `expect(result.currentStreak).toBe(1)` |
| 144 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `it('increments currentStreak across consecutive days', () => {` |
| 151 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `expect(result.currentStreak).toBe(3)` |
| 152 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `expect(result.bestStreak).toBe(3)` |
| 158 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `it('resets currentStreak to 0 after a gap but keeps bestStreak', () => {` |
| 158 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `it('resets currentStreak to 0 after a gap but keeps bestStreak', () => {` |
| 166 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `expect(result.currentStreak).toBe(1)` |
| 167 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `expect(result.bestStreak).toBe(2)` |
| 171 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `it('reports currentStreak 0 when asOfDayKey is past the gap', () => {` |
| 177 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `expect(result.currentStreak).toBe(0)` |
| 178 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `expect(result.bestStreak).toBe(2)` |
| 197 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `expect(after.bestStreak).toBeGreaterThanOrEqual(before.bestStreak)` |
| 198 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `expect(after.bestStreak).toBe(3)` |
| 210 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `expect(result.currentStreak).toBe(2)` |
| 211 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `expect(result.bestStreak).toBe(2)` |
| 226 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `expect(forward.currentStreak).toBe(3)` |
| 289 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `expect(result.currentStreak).toBe(1)` |
| 290 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `expect(result.bestStreak).toBe(1)` |

#### `src/domain/gamification/v4/streak.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 4 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `* Pure, deterministic projection of ˋcurrentStreakˋ, ˋbestStreakˋ, and` |
| 4 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `* Pure, deterministic projection of ˋcurrentStreakˋ, ˋbestStreakˋ, and` |
| 98 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `readonly currentStreak: number` |
| 99 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `readonly bestStreak: number` |
| 108 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `* - ˋbestStreakˋ is the longest run of consecutive qualified days (never` |
| 110 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `* - ˋcurrentStreakˋ is the length of the consecutive run ending at the most` |
| 133 | `bestStreak` | initialise | summary.bestStreak | Projection best-streak counter | `return { currentStreak: 0, bestStreak: 0, lastQualifiedDayKey: null }` |
| 133 | `currentStreak` | initialise | users.currentStreak | Consecutive qualifying days | `return { currentStreak: 0, bestStreak: 0, lastQualifiedDayKey: null }` |
| 138 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `let bestStreak = 0` |
| 144 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `if (run > bestStreak) bestStreak = run` |
| 148 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `let currentStreak = 0` |
| 153 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `currentStreak = runEndingAt.get(day) ?? 0` |
| 156 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `currentStreak = 0` |
| 161 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `currentStreak,` |
| 162 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `bestStreak,` |

#### `src/domain/gamification/v4/types.test.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 13 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 10,` |
| 14 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 120,` |
| 15 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 16 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 20,` |
| 17 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 80,` |
| 19 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 3,` |
| 20 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 5,` |
| 59 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `'reversal',` |
| 72 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 10,` |
| 73 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 120,` |
| 74 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 75 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 20,` |
| 76 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 80,` |
| 78 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 3,` |
| 79 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 5,` |

#### `src/domain/gamification/v4/types.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 32 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `REVERSAL: 'reversal',` |
| 50 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `readonly rewardPoints: number` |
| 52 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `readonly xpTotal: number` |
| 53 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `/** Derived exclusively from xpTotal via canonical levelForXp(). */` |
| 55 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `readonly xpProgressInLevel: number` |
| 56 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `readonly xpToNextLevel: number` |
| 58 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `readonly currentStreak: number` |
| 59 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `readonly bestStreak: number` |
| 73 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `\| 'rewardPoints'` |
| 74 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `\| 'xpTotal'` |
| 76 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `\| 'xpProgressInLevel'` |
| 77 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `\| 'xpToNextLevel'` |
| 79 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `\| 'currentStreak'` |
| 80 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `\| 'bestStreak'` |
| 88 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `'rewardPoints',` |
| 89 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `'xpTotal',` |
| 91 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `'xpProgressInLevel',` |
| 92 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `'xpToNextLevel',` |
| 94 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `'currentStreak',` |
| 95 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `'bestStreak',` |
| 109 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: state.rewardPoints,` |
| 110 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: state.xpTotal,` |
| 111 | `level` | read | in-memory / derived | Member level | `level: state.level,` |
| 112 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: state.xpProgressInLevel,` |
| 113 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: state.xpToNextLevel,` |
| 115 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `currentStreak: state.currentStreak,` |
| 116 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `bestStreak: state.bestStreak,` |

#### `src/domain/gamification/v4/validators.test.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 33 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 10,` |
| 34 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 120,` |
| 35 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 36 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 20,` |
| 37 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: 80,` |
| 39 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 3,` |
| 40 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 5,` |
| 80 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('rejects a reversal event without reversalOfEventId', () => {` |
| 86 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('accepts a reversal event that references its original', () => {` |
| 100 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('rejects reversalOfEventId on a non-reversal event type', () => {` |
| 108 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('throws when xpDelta is negative without a reversal reference', () => {` |
| 114 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('passes when xpDelta is negative but a reversal is referenced', () => {` |
| 122 | `reversal` | test | families/{f}/reversals | Reversal / compensation path | `it('passes when xpDelta is non-negative regardless of reversal', () => {` |
| 130 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(() => assertNonNegativeRewardPoints(-1, 'rewardPoints')).toThrow(ValidationErrorV4)` |
| 134 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(() => assertNonNegativeRewardPoints(1.5, 'rewardPoints')).toThrow(ValidationErrorV4)` |
| 138 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(() => assertNonNegativeRewardPoints(0, 'rewardPoints')).not.toThrow()` |
| 139 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(() => assertNonNegativeRewardPoints(10, 'rewardPoints')).not.toThrow()` |
| 148 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `it('rejects a negative rewardPoints state', () => {` |
| 149 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(() => assertValidStateV4(makeState({ rewardPoints: -1 }))).toThrow(ValidationErrorV4)` |
| 152 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `it('rejects a negative xpTotal state', () => {` |
| 153 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(() => assertValidStateV4(makeState({ xpTotal: -1 }))).toThrow(ValidationErrorV4)` |
| 157 | `level` | test | in-memory / derived | Member level | `expect(() => assertValidStateV4(makeState({ level: 0 }))).toThrow(ValidationErrorV4)` |

#### `src/domain/gamification/v4/validators.ts` — KEEP · Phase 1 · risk Low

> Canonical pure domain — becomes the V3 reducer core

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 41 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `* The only event types permitted to reduce XP are the reversal/refund types,` |
| 109 | `reversal` | calculate | families/{f}/reversals | Reversal / compensation path | `* XP may only decrease when the event is a reversal/refund that references the` |
| 172 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `throw new ValidationErrorV4('reversalOfEventId must not reference the reversal itself')` |
| 175 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `throw new ValidationErrorV4(ˋreversalOfEventId is only permitted on reversal events, not ${eventType}ˋ)` |
| 187 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `assertNonNegativeRewardPoints(candidate.rewardPoints, 'rewardPoints')` |
| 188 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `assertNonNegativeRewardPoints(candidate.xpTotal, 'xpTotal')` |
| 189 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `assertNonNegativeRewardPoints(candidate.xpProgressInLevel, 'xpProgressInLevel')` |
| 190 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `assertNonNegativeRewardPoints(candidate.xpToNextLevel, 'xpToNextLevel')` |
| 191 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `assertNonNegativeRewardPoints(candidate.currentStreak, 'currentStreak')` |
| 192 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `assertNonNegativeRewardPoints(candidate.bestStreak, 'bestStreak')` |

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
| 82 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `"bestStreak": "Best Streak",` |
| 96 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `"xpTotal": "{{xp}} Total XP",` |
| 99 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `"xpToNextLevel": "{{xp}} XP to reach Level {{level}}",` |
| 100 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `"currentStreak": "Current Streak",` |
| 101 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `"bestStreak": "Best Streak",` |

#### `src/i18n/locales/en/family.json` — KEEP · n/a · risk Low

> Translation keys and labels

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 52 | `leaderboard` | read | in-memory / derived | Leaderboard ordering | `"subtitle": "Check back next week to see who won this week's leaderboard!"` |

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
| 82 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `"bestStreak": "En İyi Seri",` |
| 96 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `"xpTotal": "{{xp}} Toplam XP",` |
| 99 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `"xpToNextLevel": "Seviye {{level}}'e ulaşmak için {{xp}} XP",` |
| 100 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `"currentStreak": "Mevcut Seri",` |
| 101 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `"bestStreak": "En İyi Seri",` |

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
| 24 | `approveTaskCompletion` | test | in-memory / derived | V4 task completion command (RP + XP credit) | `import { approveJoinRequest, approveMoneyRequest, approveProfileUpdateRequest, approveTaskCompletion, approveTransferRequest, cancelPendingApproval, rejectMoney` |
| 47 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `'users/child-1': { familyId: 'family-1', role: 'child', rewardPoints: 5, lifetimeXP: 20 },` |
| 47 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `'users/child-1': { familyId: 'family-1', role: 'child', rewardPoints: 5, lifetimeXP: 20 },` |
| 51 | `approveTaskCompletion` | test | in-memory / derived | V4 task completion command (RP + XP credit) | `await approveTaskCompletion('family-1', 'completion-1', 'Great work')` |
| 66 | `approveTaskCompletion` | test | in-memory / derived | V4 task completion command (RP + XP credit) | `await expect(approveTaskCompletion('family-1', 'completion-1')).rejects.toThrow('Completion is not pending approval')` |

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

#### `src/lib/api.rewardInventory.test.ts` — MIGRATE · Phase 3 · risk High

> Client gamification writes become callable commands

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 6 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `* These exercise the REAL production ˋredeemRewardˋ Firestore transaction —` |
| 57 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `import { redeemReward } from './api'` |
| 106 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `describe('redeemReward — reward inventory', () => {` |
| 110 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `[USER_PATH]: { rewardPoints: 100, displayName: 'Alisya' },` |
| 112 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `await redeemReward('family-1', 'child-1', 'r1')` |
| 119 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `[USER_PATH]: { rewardPoints: 100, displayName: 'Alisya' },` |
| 121 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `await redeemReward('family-1', 'child-1', 'r1')` |
| 128 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `[USER_PATH]: { rewardPoints: 100, displayName: 'Alisya' },` |
| 130 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `await expect(redeemReward('family-1', 'child-1', 'r1')).rejects.toThrow(/out of stock/i)` |
| 137 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `[USER_PATH]: { rewardPoints: 100, displayName: 'Alisya' },` |
| 139 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `await redeemReward('family-1', 'child-1', 'r1')` |
| 147 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `[USER_PATH]: { rewardPoints: 10, displayName: 'Alisya' },` |
| 149 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `await expect(redeemReward('family-1', 'child-1', 'r1')).rejects.toThrow(/not enough points/i)` |
| 156 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `[USER_PATH]: { rewardPoints: 100, displayName: 'Alisya' },` |
| 158 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `await redeemReward('family-1', 'child-1', 'r1')` |
| 164 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `[USER_PATH]: { rewardPoints: 90, displayName: 'Alisya' },` |
| 166 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `await redeemReward('family-1', 'child-1', 'r1')` |
| 174 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `[USER_PATH]: { rewardPoints: 100, displayName: 'Alisya' },` |
| 178 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `await expect(redeemReward('family-1', 'child-1', 'r1')).rejects.toThrow(/write failed/i)` |
| 185 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `[USER_PATH]: { rewardPoints: 100, displayName: 'Alisya' },` |
| 187 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `await expect(redeemReward('family-1', 'child-2', 'r1')).rejects.toThrow(/another user/i)` |
| 193 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `[USER_PATH]: { rewardPoints: 100, displayName: 'Alisya' },` |
| 195 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `await redeemReward('family-1', 'child-1', 'r1')` |
| 196 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(tx.writes.find(w => w.path === USER_PATH)?.data.rewardPoints).toBe(90)` |

#### `src/lib/api.tasks.test.ts` — MIGRATE · Phase 3 · risk High

> Client gamification writes become callable commands

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 43 | `claimChallenge` | test | in-memory / derived | Family challenge claim (RP + XP credit) | `import { createTask, createReward, claimChallenge } from './api'` |
| 122 | `claimChallenge` | test | in-memory / derived | Family challenge claim (RP + XP credit) | `describe('claimChallenge delegates to the trusted server callable', () => {` |
| 131 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// rewardPoints/lifetimeXP writes — those are server-authoritative. The client` |
| 131 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `// rewardPoints/lifetimeXP writes — those are server-authoritative. The client` |
| 134 | `claimChallenge` | test | in-memory / derived | Family challenge claim (RP + XP credit) | `const result = await claimChallenge('family-1', 'challenge-1')` |
| 141 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// REGRESSION (P0): the client must NEVER write rewardPoints / lifetimeXP.` |
| 141 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `// REGRESSION (P0): the client must NEVER write rewardPoints / lifetimeXP.` |
| 145 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('does NOT write rewardPoints / lifetimeXP (no client-side reward transaction)', async () => {` |
| 145 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `it('does NOT write rewardPoints / lifetimeXP (no client-side reward transaction)', async () => {` |
| 146 | `claimChallenge` | test | in-memory / derived | Family challenge claim (RP + XP credit) | `await claimChallenge('family-1', 'challenge-1')` |
| 160 | `claimChallenge` | test | in-memory / derived | Family challenge claim (RP + XP credit) | `await expect(claimChallenge('family-1', 'challenge-1')).rejects.toThrow(/Authentication required/)` |
| 169 | `claimChallenge` | test | in-memory / derived | Family challenge claim (RP + XP credit) | `await expect(claimChallenge('family-1', 'challenge-1')).rejects.toThrow(/target not reached/)` |

#### `src/lib/api.transactionOrder.test.ts` — MIGRATE · Phase 3 · risk High

> Client gamification writes become callable commands

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 64 | `approveTaskCompletion` | test | in-memory / derived | V4 task completion command (RP + XP credit) | `approveTaskCompletion,` |
| 67 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `redeemReward,` |
| 114 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const childUser = { familyId: 'family-1', role: 'child', displayName: 'Muhammed', rewardPoints: 500 }` |
| 205 | `approveTaskCompletion` | test | in-memory / derived | V4 task completion command (RP + XP credit) | `it('approveTaskCompletion keeps reads before writes', async () => {` |
| 213 | `approveTaskCompletion` | test | in-memory / derived | V4 task completion command (RP + XP credit) | `await approveTaskCompletion('family-1', 'c1')` |
| 240 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `it('redeemReward keeps reads before writes', async () => {` |
| 245 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `await redeemReward('family-1', 'child-1', 'r1')` |

#### `src/lib/api.ts` — MIGRATE · Phase 3 · risk High

> Client gamification writes become callable commands

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 123 | `rewardPoints` | initialise | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 124 | `lifetimeXP` | initialise | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 0,` |
| 125 | `currentStreak` | initialise | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 126 | `longestStreak` | initialise | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 0,` |
| 376 | `rewardPoints` | initialise | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 377 | `lifetimeXP` | initialise | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 0,` |
| 378 | `currentStreak` | initialise | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 379 | `longestStreak` | initialise | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 0,` |
| 453 | `rewardPoints` | initialise | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 0,` |
| 454 | `lifetimeXP` | initialise | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 0,` |
| 455 | `currentStreak` | initialise | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 456 | `longestStreak` | initialise | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: 0,` |
| 654 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `let newCurrentStreak = userData.currentStreak \|\| 0;` |
| 655 | `longestStreak` | read | users.longestStreak | Legacy best-streak counter on the user doc | `let newLongestStreak = userData.longestStreak \|\| 0;` |
| 670 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `let finalRewardPoints = userData.rewardPoints \|\| 0;` |
| 671 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `let finalLifetimeXP = userData.lifetimeXP \|\| 0;` |
| 701 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `currentStreak: newCurrentStreak,` |
| 702 | `longestStreak` | read | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak: newLongestStreak,` |
| 711 | `approveTaskCompletion` | read | in-memory / derived | V4 task completion command (RP + XP credit) | `export const approveTaskCompletion = async (familyId: string, completionId: string, comment?: string) => {` |
| 839 | `behaviour_events` | read | families/{f}/behaviour_events | Behaviour intent log | `const eventRef = doc(collection(db, ˋfamilies/${familyId}/behaviour_eventsˋ));` |
| 881 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: child.rewardPoints ?? 0,` |
| 882 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: child.lifetimeXP ?? 0,` |
| 890 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `// writes gamification_summaries.xpTotal and the immutable gamification` |
| 890 | `xpTotal` | read | families/{f}/gamification_summaries | Projection lifetime XP counter (authoritative today) | `// writes gamification_summaries.xpTotal and the immutable gamification` |
| 971 | `createChallenge` | read | in-memory / derived | Family challenge configuration | `export const createChallenge = async (familyId: string, title: string, targetXP: number, rewardPoints: number, startXP: number) => {` |
| 971 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `export const createChallenge = async (familyId: string, title: string, targetXP: number, rewardPoints: number, startXP: number) => {` |
| 975 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints,` |
| 982 | `claimChallenge` | read | in-memory / derived | Family challenge claim (RP + XP credit) | `export const claimChallenge = async (familyId: string, challengeId: string) => {` |
| 990 | `lifetimeXP` | calculate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// exactly-once reward. The client NEVER writes rewardPoints / lifetimeXP —` |
| 990 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `// exactly-once reward. The client NEVER writes rewardPoints / lifetimeXP —` |
| 1015 | `redeemReward` | read | in-memory / derived | Reward redemption (RP debit) | `export const redeemReward = async (` |
| 1042 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `const currentPoints = userDoc.data().rewardPoints \|\| 0;` |
| 1079 | `rewardPoints` | write | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: currentPoints - cost,` |
| 1127 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `const currentPoints = userDoc.data().rewardPoints \|\| 0;` |
| 1128 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const currentXP = userDoc.data().lifetimeXP \|\| 0;` |
| 1131 | `rewardPoints` | write | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: currentPoints + points,` |
| 1132 | `lifetimeXP` | write | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: currentXP + points` |
| 3097 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `*  6. The exact point cost is deducted from ˋrewardPointsˋ.` |
| 3104 | `unlockAvatar` | read | in-memory / derived | Avatar unlock (RP debit) | `export const unlockAvatar = async (familyId: string, avatarId: string): Promise<number> => {` |
| 3129 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `const currentPoints = userData.rewardPoints \|\| 0;` |
| 3134 | `rewardPoints` | write | users.rewardPoints | Spendable Reward Points balance (RP) | `transaction.update(userRef, { rewardPoints: currentPoints - cost });` |

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
| 263 | `behaviour_events` | read | families/{f}/behaviour_events | Behaviour intent log | `{ resource: 'behaviourEvents', key: 'behaviourEvents', kind: 'query', target: collection(db, ˋ${familyPath}/behaviour_eventsˋ) },` |
| 276 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `{ resource: 'gamificationSummaries', key: 'gamificationSummaries', kind: 'query', target: collection(db, ˋ${familyPath}/gamification_summariesˋ) },` |
| 284 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `{ resource: 'gamificationSummaries', key: 'gamificationSummaries', kind: 'document', target: doc(db, ˋ${familyPath}/gamification_summaries/${userId}ˋ) },` |

#### `src/lib/challengeClaimApi.ts` — KEEP · n/a · risk Low

> Unclassified — review before Phase 1

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 7 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `// supplies ˋfamilyIdˋ + ˋchallengeIdˋ and never writes ˋrewardPointsˋ /` |
| 8 | `lifetimeXP` | calculate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// ˋlifetimeXPˋ (those writes are server-only via the Admin SDK, which is why` |

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
| 35 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 5000,` |
| 36 | `level` | test | in-memory / derived | Member level | `level: 5,` |
| 37 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 3,` |
| 38 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 10,` |
| 48 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `// A dirty projection is still authoritative: its own xpTotal/level are` |
| 49 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// shown (never replaced by the lifetimeXP mirror), flagged as updating.` |
| 53 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(result.xpTotal).toBe(5000);` |
| 62 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 5000,` |
| 63 | `level` | test | in-memory / derived | Member level | `level: 5,` |
| 64 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 3,` |
| 65 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 10,` |
| 78 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(result.xpTotal).toBe(5000);` |
| 82 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `it('computes level and XP progress from xpTotal', () => {` |
| 87 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 2500,` |
| 88 | `level` | test | in-memory / derived | Member level | `level: 3,` |
| 89 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 2,` |
| 90 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 5,` |
| 101 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(result.xpTotal).toBe(2500);` |
| 103 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `expect(result.xpProgressInLevel).toBe(500);` |
| 104 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `expect(result.xpToNextLevel).toBe(500);` |
| 113 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1500,` |
| 114 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 115 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 1,` |
| 116 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 3,` |
| 157 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1000,` |
| 158 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 159 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 160 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 176 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `it('handles level 1 correctly (xpTotal < XP_PER_LEVEL)', () => {` |
| 181 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 100,` |
| 182 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 183 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 184 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 196 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `expect(result.xpProgressInLevel).toBe(100);` |
| 197 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `expect(result.xpToNextLevel).toBe(900);` |
| 205 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1000,` |
| 206 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 207 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 208 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 219 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `expect(result.xpProgressInLevel).toBe(0);` |
| 220 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `expect(result.xpToNextLevel).toBe(1000);` |
| 223 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('falls back to member.lifetimeXP when the summary is null and a member is provided', () => {` |
| 224 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const result = adaptGamificationSummary(null, undefined, { lifetimeXP: 2500 });` |
| 226 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(result.xpTotal).toBe(2500);` |
| 228 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `expect(result.xpProgressInLevel).toBe(500);` |
| 229 | `xpToNextLevel` | test | summary.xpToNextLevel | XP remaining until the next level | `expect(result.xpToNextLevel).toBe(500);` |
| 232 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('uses the dirty summary own xpTotal, never the lifetimeXP mirror (priority 2)', () => {` |
| 232 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `it('uses the dirty summary own xpTotal, never the lifetimeXP mirror (priority 2)', () => {` |
| 237 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 9999,` |
| 238 | `level` | test | in-memory / derived | Member level | `level: 99,` |
| 239 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 3,` |
| 240 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 10,` |
| 250 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `// A dirty projection is still authoritative: its own xpTotal is shown,` |
| 251 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// NOT the legacy lifetimeXP mirror (1000).` |
| 252 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const result = adaptGamificationSummary(summary, undefined, { lifetimeXP: 1000 });` |
| 255 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(result.xpTotal).toBe(9999);` |
| 259 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('uses the rebuilding summary own xpTotal, never the lifetimeXP mirror (priority 2)', () => {` |
| 259 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `it('uses the rebuilding summary own xpTotal, never the lifetimeXP mirror (priority 2)', () => {` |
| 264 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 9999,` |
| 265 | `level` | test | in-memory / derived | Member level | `level: 99,` |
| 266 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 3,` |
| 267 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 10,` |
| 277 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const result = adaptGamificationSummary(summary, undefined, { lifetimeXP: 420 });` |
| 280 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(result.xpTotal).toBe(9999);` |
| 284 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// No member => no authoritative lifetimeXP to derive from => nothing to show.` |
| 290 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('REQUIRED: dirty summary xpTotal=420 with member.lifetimeXP=400 keeps 420', () => {` |
| 290 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `it('REQUIRED: dirty summary xpTotal=420 with member.lifetimeXP=400 keeps 420', () => {` |
| 295 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 420,` |
| 296 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 297 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 298 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 308 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const result = adaptGamificationSummary(summary, undefined, { lifetimeXP: 400 });` |
| 310 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(result.xpTotal).toBe(420);` |
| 314 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `it('REQUIRED: ready summary xpTotal=420 is authoritative', () => {` |
| 319 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 420,` |
| 320 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 321 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 322 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 332 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const result = adaptGamificationSummary(summary, undefined, { lifetimeXP: 400 });` |
| 334 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(result.xpTotal).toBe(420);` |
| 337 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('REQUIRED: missing summary with member.lifetimeXP=400 falls back to 400', () => {` |
| 338 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const result = adaptGamificationSummary(null, undefined, { lifetimeXP: 400 });` |
| 340 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(result.xpTotal).toBe(400);` |
| 343 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('REQUIRED: missing summary and no lifetimeXP renders unavailable', () => {` |
| 344 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const result = adaptGamificationSummary(null, undefined, { lifetimeXP: undefined });` |
| 346 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `expect(result.xpTotal).toBe(0);` |
| 350 | `levelFromXp` | test | in-memory / derived | Duplicate level formula | `describe('levelFromXp', () => {` |
| 352 | `levelFromXp` | test | in-memory / derived | Duplicate level formula | `expect(levelFromXp(0)).toBe(1);` |
| 356 | `levelFromXp` | test | in-memory / derived | Duplicate level formula | `expect(levelFromXp(999)).toBe(1);` |
| 360 | `levelFromXp` | test | in-memory / derived | Duplicate level formula | `expect(levelFromXp(1000)).toBe(2);` |
| 364 | `levelFromXp` | test | in-memory / derived | Duplicate level formula | `expect(levelFromXp(2500)).toBe(3);` |
| 365 | `levelFromXp` | test | in-memory / derived | Duplicate level formula | `expect(levelFromXp(5000)).toBe(6);` |
| 369 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `describe('xpProgressInLevel', () => {` |
| 371 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `expect(xpProgressInLevel(1000)).toBe(0);` |
| 372 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `expect(xpProgressInLevel(2000)).toBe(0);` |
| 376 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `expect(xpProgressInLevel(1500)).toBe(500);` |
| 377 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `expect(xpProgressInLevel(2500)).toBe(500);` |
| 381 | `xpProgressInLevel` | test | summary.xpProgressInLevel | XP accumulated inside the current level | `expect(xpProgressInLevel(500)).toBe(500);` |

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
| 24 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `* still displayed (never replaced by the legacy ˋusers.lifetimeXPˋ mirror).` |
| 42 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `* - Computes level progress and XP to next level from xpTotal` |
| 48 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `member?: { lifetimeXP?: number \| null } \| null,` |
| 52 | `xpTotal` | calculate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `// its own xpTotal/level/progress and (optionally) flag it as updating, but we` |
| 53 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// never replace its values with the legacy ˋusers.lifetimeXPˋ mirror.` |
| 56 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `Number.isFinite(Number(summary.xpTotal)) &&` |
| 57 | `level` | read | in-memory / derived | Member level | `Number.isFinite(Number(summary.level))` |
| 60 | `xpTotal` | calculate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const xpTotal = Math.max(0, Math.floor(Number(summary!.xpTotal)))` |
| 62 | `xpProgressInLevel` | calculate | summary.xpProgressInLevel | XP accumulated inside the current level | `const xpProgressInLevel = xpTotal % XP_PER_LEVEL` |
| 62 | `xpTotal` | calculate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const xpProgressInLevel = xpTotal % XP_PER_LEVEL` |
| 63 | `xpProgressInLevel` | calculate | summary.xpProgressInLevel | XP accumulated inside the current level | `const xpToNextLevel = XP_PER_LEVEL - xpProgressInLevel` |
| 63 | `xpToNextLevel` | calculate | summary.xpToNextLevel | XP remaining until the next level | `const xpToNextLevel = XP_PER_LEVEL - xpProgressInLevel` |
| 67 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal,` |
| 69 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel,` |
| 70 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel,` |
| 71 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `currentStreak: nonNegativeInteger(summary!.currentStreak),` |
| 72 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `bestStreak: nonNegativeInteger(summary!.bestStreak),` |
| 82 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// Priority 3: projection genuinely absent -> temporary ˋusers.lifetimeXPˋ` |
| 84 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// projection document at all AND a finite lifetimeXP is available.` |
| 85 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const rawXp = Number(member?.lifetimeXP)` |
| 88 | `xpTotal` | calculate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const xpTotal = Math.max(0, Math.floor(rawXp))` |
| 89 | `levelProgressForXp` | read | in-memory / derived | Canonical level formula | `const progress = levelProgressForXp(xpTotal, XP_PER_LEVEL)` |
| 89 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const progress = levelProgressForXp(xpTotal, XP_PER_LEVEL)` |
| 91 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal,` |
| 93 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: progress.xpToNextLevel,` |
| 94 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: progress.xpIntoLevel,` |
| 95 | `currentStreak` | initialise | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 96 | `bestStreak` | initialise | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 108 | `xpTotal` | initialise | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 0,` |
| 109 | `level` | read | in-memory / derived | Member level | `level: 1,` |
| 110 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: XP_PER_LEVEL,` |
| 111 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: 0,` |
| 112 | `currentStreak` | initialise | users.currentStreak | Consecutive qualifying days | `currentStreak: 0,` |
| 113 | `bestStreak` | initialise | summary.bestStreak | Projection best-streak counter | `bestStreak: 0,` |
| 128 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `* derive the progression from the member's authoritative ˋlifetimeXPˋ balance` |
| 134 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `readonly xpTotal: number` |
| 136 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `readonly xpProgressInLevel: number` |
| 137 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `readonly xpToNextLevel: number` |
| 145 | `lifetimeXP` | calculate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `* TODO(gamification-legacy-fallback): the ˋmember.lifetimeXPˋ fallback below is a` |
| 148 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `* ˋfamilies/{familyId}/gamification_summaries/{memberId}ˋ — verified by a full` |
| 153 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `* @param member   Member record providing the ˋlifetimeXPˋ fallback.` |
| 157 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `member: { lifetimeXP?: number \| null } \| null \| undefined,` |
| 162 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const rawXp = projectionUsable ? Number(summary!.xpTotal) : Number(member?.lifetimeXP)` |
| 162 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const rawXp = projectionUsable ? Number(summary!.xpTotal) : Number(member?.lifetimeXP)` |
| 163 | `levelProgressForXp` | calculate | in-memory / derived | Canonical level formula | `// ˋlevelProgressForXpˋ (the canonical formula) requires a non-negative safe` |
| 165 | `xpTotal` | calculate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const xpTotal = Number.isFinite(rawXp) ? Math.max(0, Math.floor(rawXp)) : 0` |
| 168 | `levelProgressForXp` | read | in-memory / derived | Canonical level formula | `// projection use (ˋlevelForXpˋ / ˋlevelProgressForXpˋ with the config's` |
| 170 | `levelProgressForXp` | read | in-memory / derived | Canonical level formula | `const progress = levelProgressForXp(xpTotal, XP_PER_LEVEL)` |
| 170 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const progress = levelProgressForXp(xpTotal, XP_PER_LEVEL)` |
| 174 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal,` |
| 175 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `lifetimeXp: xpTotal,` |
| 176 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: progress.xpIntoLevel,` |
| 177 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: progress.xpToNextLevel,` |
| 189 | `longestStreak` | read | users.longestStreak | Legacy best-streak counter on the user doc | `* unlocked from a stale legacy ˋlongestStreakˋ while the card shows 0.` |
| 194 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `readonly currentStreak: number` |
| 195 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `readonly bestStreak: number` |
| 206 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `member: { currentStreak?: number \| null; longestStreak?: number \| null } \| null \| undefined,` |
| 206 | `longestStreak` | read | users.longestStreak | Legacy best-streak counter on the user doc | `member: { currentStreak?: number \| null; longestStreak?: number \| null } \| null \| undefined,` |
| 213 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `currentStreak: nonNegativeInteger(summary!.currentStreak),` |
| 214 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `bestStreak: nonNegativeInteger(summary!.bestStreak),` |
| 219 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `currentStreak: nonNegativeInteger(member?.currentStreak),` |
| 220 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `bestStreak: nonNegativeInteger(member?.longestStreak),` |
| 220 | `longestStreak` | read | users.longestStreak | Legacy best-streak counter on the user doc | `bestStreak: nonNegativeInteger(member?.longestStreak),` |
| 227 | `levelProgressForXp` | read | in-memory / derived | Canonical level formula | `* Thin wrapper over the canonical {@link levelProgressForXp} helper.` |
| 229 | `levelFromXp` | read | in-memory / derived | Duplicate level formula | `export function levelFromXp(xpTotal: number): number {` |
| 229 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `export function levelFromXp(xpTotal: number): number {` |
| 230 | `levelProgressForXp` | read | in-memory / derived | Canonical level formula | `return levelProgressForXp(xpTotal, XP_PER_LEVEL).level` |
| 230 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `return levelProgressForXp(xpTotal, XP_PER_LEVEL).level` |
| 236 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `export function xpProgressInLevel(xpTotal: number): number {` |
| 236 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `export function xpProgressInLevel(xpTotal: number): number {` |
| 237 | `xpTotal` | calculate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `return xpTotal % XP_PER_LEVEL` |
| 248 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `* @param summaries  The gamification_summaries collection (parent view).` |
| 274 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `*  1. If a projection document exists with finite ˋxpTotalˋ/ˋlevelˋ, its values` |
| 277 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `*     ˋusers.lifetimeXPˋ mirror while a document is present.` |
| 278 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `*  2. The legacy member counters (ˋlifetimeXPˋ/ˋcurrentStreakˋ/ˋlongestStreakˋ)` |
| 278 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `*  2. The legacy member counters (ˋlifetimeXPˋ/ˋcurrentStreakˋ/ˋlongestStreakˋ)` |
| 278 | `longestStreak` | read | users.longestStreak | Legacy best-streak counter on the user doc | `*  2. The legacy member counters (ˋlifetimeXPˋ/ˋcurrentStreakˋ/ˋlongestStreakˋ)` |
| 289 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP?: number \| null` |
| 290 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `currentStreak?: number \| null` |
| 291 | `longestStreak` | read | users.longestStreak | Legacy best-streak counter on the user doc | `longestStreak?: number \| null` |
| 297 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `Number.isFinite(Number(summary.xpTotal)) &&` |
| 298 | `level` | read | in-memory / derived | Member level | `Number.isFinite(Number(summary.level))` |
| 302 | `xpTotal` | calculate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const xpTotal = Math.max(0, Math.floor(Number(summary!.xpTotal)))` |
| 304 | `xpProgressInLevel` | calculate | summary.xpProgressInLevel | XP accumulated inside the current level | `const xpProgressInLevel = xpTotal % XP_PER_LEVEL` |
| 304 | `xpTotal` | calculate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const xpProgressInLevel = xpTotal % XP_PER_LEVEL` |
| 306 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal,` |
| 308 | `xpProgressInLevel` | calculate | summary.xpProgressInLevel | XP accumulated inside the current level | `xpToNextLevel: XP_PER_LEVEL - xpProgressInLevel,` |
| 308 | `xpToNextLevel` | calculate | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: XP_PER_LEVEL - xpProgressInLevel,` |
| 309 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel,` |
| 310 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `currentStreak: nonNegativeInteger(summary!.currentStreak),` |
| 311 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `bestStreak: nonNegativeInteger(summary!.bestStreak),` |
| 322 | `lifetimeXP` | calculate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// XP/level derive from ˋlifetimeXPˋ when present; streaks always fall back to` |
| 323 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `// the member's ˋcurrentStreakˋ/ˋlongestStreakˋ counters (independent of` |
| 323 | `longestStreak` | read | users.longestStreak | Legacy best-streak counter on the user doc | `// the member's ˋcurrentStreakˋ/ˋlongestStreakˋ counters (independent of` |
| 324 | `lifetimeXP` | calculate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// ˋlifetimeXPˋ, matching the prior streak-only fallback behaviour).` |
| 325 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const rawXp = Number(member?.lifetimeXP)` |
| 327 | `xpTotal` | calculate | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const xpTotal = hasXpFallback ? Math.max(0, Math.floor(rawXp)) : 0` |
| 329 | `levelProgressForXp` | read | in-memory / derived | Canonical level formula | `? levelProgressForXp(xpTotal, XP_PER_LEVEL)` |
| 329 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `? levelProgressForXp(xpTotal, XP_PER_LEVEL)` |
| 330 | `level` | read | in-memory / derived | Member level | `: { level: 1, xpToNextLevel: XP_PER_LEVEL, xpIntoLevel: 0 }` |
| 330 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `: { level: 1, xpToNextLevel: XP_PER_LEVEL, xpIntoLevel: 0 }` |
| 332 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal,` |
| 334 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `xpToNextLevel: progress.xpToNextLevel,` |
| 335 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `xpProgressInLevel: progress.xpIntoLevel,` |
| 336 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `currentStreak: nonNegativeInteger(member?.currentStreak),` |
| 337 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `bestStreak: nonNegativeInteger(member?.longestStreak),` |
| 337 | `longestStreak` | read | users.longestStreak | Legacy best-streak counter on the user doc | `bestStreak: nonNegativeInteger(member?.longestStreak),` |

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
| 43 | `approveTaskCompletion` | test | in-memory / derived | V4 task completion command (RP + XP credit) | `approveTaskCompletion,` |
| 45 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `redeemReward,` |
| 102 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'Muhammed', rewardPoints: 0, lifetimeXP: 0, lastActiveDate: null },` |
| 102 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'Muhammed', rewardPoints: 0, lifetimeXP: 0, lastActiveDate: null },` |
| 120 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `'users/child-1': { familyId: 'fam1', role: 'child', rewardPoints: 5, lifetimeXP: 0 },` |
| 120 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `'users/child-1': { familyId: 'fam1', role: 'child', rewardPoints: 5, lifetimeXP: 0 },` |
| 123 | `approveTaskCompletion` | test | in-memory / derived | V4 task completion command (RP + XP credit) | `await approveTaskCompletion('fam1', 'c1', 'Great');` |
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
| 388 | `approveTaskCompletion` | test | in-memory / derived | V4 task completion command (RP + XP credit) | `await approveTaskCompletion('fam1', 'c1', 'Great');` |

#### `src/lib/notifications.ts` — KEEP · Phase 4 · risk Low

> Notification copy only

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 58 | `claimChallenge` | calculate | in-memory / derived | Family challenge claim (RP + XP credit) | `// the authoritative claimChallenge transaction, and this row's per-user read` |

#### `src/lib/requestActions.ts` — KEEP · n/a · risk Low

> Unclassified — review before Phase 1

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 10 | `approveTaskCompletion` | read | in-memory / derived | V4 task completion command (RP + XP credit) | `approveTaskCompletion,` |
| 42 | `approveTaskCompletion` | read | in-memory / derived | V4 task completion command (RP + XP credit) | `approve: (familyId, id, comment) => approveTaskCompletion(familyId, id, comment ?? ''),` |

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
| 367 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `reversal?: ReversalRecord,` |
| 369 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `const status: TransactionStatus = reversal ? 'reversed' : seed.status;` |
| 377 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `const reversalId = reversal ? stringValue(reversal.reversalId) ?? reversal.id : undefined;` |
| 378 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `const reversalOccurredAt = reversal` |
| 379 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `? timestampFrom(reversal.completedAt, reversal.createdAt)` |
| 407 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `reversalReason: reversal ? stringValue(reversal.reason) : undefined,` |
| 408 | `reversal` | read | families/{f}/reversals | Reversal / compensation path | `reversalActorName: reversal ? stringValue(reversal.actorName) : undefined,` |

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
| 253 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1500,` |
| 254 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 255 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 1,` |
| 256 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 3,` |
| 309 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 1500,` |
| 310 | `level` | test | in-memory / derived | Member level | `level: 2,` |
| 311 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 1,` |
| 312 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 3,` |

#### `src/pages/Dashboard.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 119 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `<span className="font-bold text-gray-900">{currentUser.rewardPoints \|\| 0}</span>` |
| 124 | `currentStreak` | calculate | users.currentStreak | Consecutive qualifying days | `<span className="font-bold text-gray-900">{currentUser.currentStreak \|\| 0}</span>` |

#### `src/pages/Family.test.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 7 | `claimChallenge` | test | in-memory / derived | Family challenge claim (RP + XP credit) | `import { claimChallenge } from '../lib/api';` |
| 21 | `createChallenge` | test | in-memory / derived | Family challenge configuration | `// action. We mock it (and createChallenge, which the component also imports)` |
| 24 | `createChallenge` | test | in-memory / derived | Family challenge configuration | `createChallenge: vi.fn(),` |
| 25 | `claimChallenge` | test | in-memory / derived | Family challenge claim (RP + XP credit) | `claimChallenge: vi.fn(),` |
| 54 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{ id: 'c', displayName: 'Kid', role: 'child', avatarUrl: '', lifetimeXP: 0 },` |
| 68 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{ id: 'auth_child', displayName: 'AuthChild', role: 'child', avatarUrl: '', lifetimeXP: 0 },` |
| 69 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{ id: 'managed_child', displayName: 'ManagedChild', role: 'child', avatarUrl: '', lifetimeXP: 0 },` |
| 70 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{ id: 'weird', displayName: 'Weird', role: 'unknown', avatarUrl: '', lifetimeXP: 0 },` |
| 114 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// taskCompletions only (never from behaviourEvents, lifetimeXP, or wallet).` |
| 118 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{ id: 'c1', displayName: 'Child', role: 'child', lifetimeXP: 5000, rewardPoints: 200 }` |
| 118 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `{ id: 'c1', displayName: 'Child', role: 'child', lifetimeXP: 5000, rewardPoints: 200 }` |
| 134 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{ id: 'c1', displayName: 'Child', role: 'child', lifetimeXP: 100, rewardPoints: 50 }` |
| 134 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `{ id: 'c1', displayName: 'Child', role: 'child', lifetimeXP: 100, rewardPoints: 50 }` |
| 155 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{ id: 'c1', displayName: 'Alice', role: 'child', lifetimeXP: 0 },` |
| 156 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{ id: 'c2', displayName: 'Bob', role: 'child', lifetimeXP: 0 }` |
| 228 | `claimChallenge` | test | in-memory / derived | Family challenge claim (RP + XP credit) | `// challenge data sources and the EXISTING claimChallenge action. They must NOT` |
| 237 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `const child = (lifetimeXP: number) => ({` |
| 242 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP,` |
| 250 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 100,` |
| 299 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// rewardPoints / lifetimeXP itself.` |
| 299 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `// rewardPoints / lifetimeXP itself.` |
| 301 | `claimChallenge` | test | in-memory / derived | Family challenge claim (RP + XP credit) | `expect(claimChallenge).toHaveBeenCalledWith('f1', 'ch-ready'),` |
| 315 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 100,` |

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
| 99 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `// Authoritative family XP = sum of each eligible child's gamification_summaries.xpTotal` |
| 99 | `xpTotal` | read | families/{f}/gamification_summaries | Projection lifetime XP counter (authoritative today) | `// Authoritative family XP = sum of each eligible child's gamification_summaries.xpTotal` |
| 100 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// (users.lifetimeXP is only a compatibility mirror and must not be used — see` |
| 102 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `const xpByChild = new Map((gamificationSummaries \|\| []).map((s: any) => [s.id, s.xpTotal ?? 0]))` |
| 105 | `lifetimeXP` | calculate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `return acc + (typeof summaryXp === 'number' ? summaryXp : (child.lifetimeXP \|\| 0))` |
| 130 | `createChallenge` | read | in-memory / derived | Family challenge configuration | `await createChallenge(currentUser.familyId, challengeData.title, Number(challengeData.targetXP), Number(challengeData.rewardPoints), totalFamilyXP);` |
| 130 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `await createChallenge(currentUser.familyId, challengeData.title, Number(challengeData.targetXP), Number(challengeData.rewardPoints), totalFamilyXP);` |
| 146 | `claimChallenge` | read | in-memory / derived | Family challenge claim (RP + XP credit) | `await claimChallenge(currentUser.familyId, activeChallenge.id);` |
| 234 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `<p className="mt-0.5 text-sm font-semibold">{t('challenge.rewardValue', { points: activeChallenge.rewardPoints })}</p>` |
| 257 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `{t('challenge.claimHint', { points: activeChallenge.rewardPoints })}` |
| 277 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `<p className="mt-1 text-sm text-gray-600">{t('challenge.completedSummary', { points: completedChallenge.rewardPoints })}</p>` |
| 370 | `weeklyXP` | calculate | derived (client-computed today) | Client-computed weekly leaderboard score | `<p className="text-sm text-gray-500 font-medium mt-0.5">{t('ptsThisWeek', { value: formatNumber(member.weeklyXP) })}</p>` |
| 421 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `<input type="number" required min="1" value={challengeData.rewardPoints} onChange={e => setChallengeData({...challengeData, rewardPoints: Number(e.target.value)` |

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
| 271 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('P0 REQUIRED: dirty summary (xpTotal=361) wins over member lifetimeXP=86 — renders 361/1/1', () => {` |
| 271 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `it('P0 REQUIRED: dirty summary (xpTotal=361) wins over member lifetimeXP=86 — renders 361/1/1', () => {` |
| 273 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Test Child', rewardPoints: 100, lifetimeXP: 86, currentStreak: 2, longestStreak: 2 }],` |
| 273 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Test Child', rewardPoints: 100, lifetimeXP: 86, currentStreak: 2, longestStreak: 2 }],` |
| 273 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Test Child', rewardPoints: 100, lifetimeXP: 86, currentStreak: 2, longestStreak: 2 }],` |
| 273 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Test Child', rewardPoints: 100, lifetimeXP: 86, currentStreak: 2, longestStreak: 2 }],` |
| 280 | `xpTotal` | test | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `xpTotal: 361,` |
| 281 | `level` | test | in-memory / derived | Member level | `level: 1,` |
| 282 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `currentStreak: 1,` |
| 283 | `bestStreak` | test | summary.bestStreak | Projection best-streak counter | `bestStreak: 1,` |
| 302 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// XP 361 from the summary, NOT the member's lifetimeXP=86.` |
| 313 | `currentStreak` | test | users.currentStreak | Consecutive qualifying days | `familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Test Child', rewardPoints: 100, lifetimeXP: 86, currentStreak: 2, longestStreak: 2 }],` |
| 313 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Test Child', rewardPoints: 100, lifetimeXP: 86, currentStreak: 2, longestStreak: 2 }],` |
| 313 | `longestStreak` | test | users.longestStreak | Legacy best-streak counter on the user doc | `familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Test Child', rewardPoints: 100, lifetimeXP: 86, currentStreak: 2, longestStreak: 2 }],` |
| 313 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Test Child', rewardPoints: 100, lifetimeXP: 86, currentStreak: 2, longestStreak: 2 }],` |

#### `src/pages/MemberProfile.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 48 | `gamification_summaries` | read | families/{f}/gamification_summaries | Legacy projection collection | `// - Parents read the whole ˋgamification_summariesˋ collection. Documents are` |
| 60 | `currentStreak` | calculate | users.currentStreak | Consecutive qualifying days | `// when dirty/rebuilding; the legacy ˋlifetimeXPˋ/ˋcurrentStreakˋ/ˋlongestStreakˋ` |
| 60 | `lifetimeXP` | calculate | users.lifetimeXP | Legacy duplicate lifetime XP counter | `// when dirty/rebuilding; the legacy ˋlifetimeXPˋ/ˋcurrentStreakˋ/ˋlongestStreakˋ` |
| 60 | `longestStreak` | calculate | users.longestStreak | Legacy best-streak counter on the user doc | `// when dirty/rebuilding; the legacy ˋlifetimeXPˋ/ˋcurrentStreakˋ/ˋlongestStreakˋ` |
| 64 | `currentStreak` | read | users.currentStreak | Consecutive qualifying days | `const currentStreak = view.currentStreak;` |
| 65 | `bestStreak` | read | summary.bestStreak | Projection best-streak counter | `const bestStreak = view.bestStreak;` |
| 67 | `xpProgressInLevel` | calculate | summary.xpProgressInLevel | XP accumulated inside the current level | `view.xpProgressInLevel + view.xpToNextLevel > 0` |
| 67 | `xpToNextLevel` | calculate | summary.xpToNextLevel | XP remaining until the next level | `view.xpProgressInLevel + view.xpToNextLevel > 0` |
| 68 | `xpProgressInLevel` | calculate | summary.xpProgressInLevel | XP accumulated inside the current level | `? Math.round((view.xpProgressInLevel / (view.xpProgressInLevel + view.xpToNextLevel)) * 100)` |
| 68 | `xpToNextLevel` | calculate | summary.xpToNextLevel | XP remaining until the next level | `? Math.round((view.xpProgressInLevel / (view.xpProgressInLevel + view.xpToNextLevel)) * 100)` |
| 89 | `level` | read | in-memory / derived | Member level | `{progression.level}` |
| 95 | `rewardPoints` | calculate | users.rewardPoints | Spendable Reward Points balance (RP) | `<p className="text-primary-600 font-bold">{t('profile:rewardPoints', { count: member.rewardPoints \|\| 0 })}</p>` |
| 99 | `lifetimeXP` | read | users.lifetimeXP | Legacy duplicate lifetime XP counter | `{/* Progression — always rendered from the projection or the lifetimeXP fallback */}` |
| 104 | `level` | read | in-memory / derived | Member level | `{t('profile:level', { level: progression.level })}` |
| 123 | `xpProgressInLevel` | read | summary.xpProgressInLevel | XP accumulated inside the current level | `{t('profile:currentXp', { count: progression.xpProgressInLevel })}` |
| 126 | `xpToNextLevel` | read | summary.xpToNextLevel | XP remaining until the next level | `{t('profile:toNextLevel', { count: progression.xpToNextLevel })}` |
| 136 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `{member.rewardPoints \|\| 0}` |
| 144 | `xpTotal` | read | summary.xpTotal | Projection lifetime XP counter (authoritative today) | `{view.xpTotal}` |
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
| 213 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `currentUser: { id: 'u1', familyId: 'fam', role: 'child', rewardPoints: 100 },` |
| 229 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `api.redeemReward.mockReturnValue(new Promise((r) => { resolve = r; }));` |
| 241 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `api.redeemReward.mockResolvedValue({` |
| 255 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `currentUser: { id: 'u1', familyId: 'fam', role: 'child', rewardPoints: 640 },` |
| 258 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `api.redeemReward.mockResolvedValue({` |
| 272 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `api.redeemReward.mockRejectedValue({` |
| 279 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `await waitFor(() => expect(api.redeemReward).toHaveBeenCalled());` |
| 287 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `api.redeemReward.mockReturnValue(new Promise((r) => { resolve = r; }));` |
| 295 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `expect(api.redeemReward).toHaveBeenCalledTimes(1);` |
| 299 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `expect(api.redeemReward).toHaveBeenCalledTimes(1);` |
| 303 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `api.redeemReward.mockResolvedValue({` |

#### `src/pages/Rewards.tsx` — DERIVE · Phase 4 · risk High

> UI must read the single reader and perform no arithmetic

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 11 | `redeemReward` | calculate | in-memory / derived | Reward redemption (RP debit) | `import { redeemReward, createReward, updateReward } from '../lib/api';` |
| 56 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `if (currentUser.rewardPoints < selectedReward.cost) {` |
| 71 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `const beforePoints = currentUser.rewardPoints \|\| 0;` |
| 76 | `redeemReward` | read | in-memory / derived | Reward redemption (RP debit) | `// Inventory is decremented atomically inside redeemReward's Firestore` |
| 78 | `redeemReward` | read | in-memory / derived | Reward redemption (RP debit) | `const result = await redeemReward(currentUser.familyId, currentUser.id, selectedReward.id);` |
| 90 | `redeemReward` | read | in-memory / derived | Reward redemption (RP debit) | `setError(mapTransactionError(e, { operation: 'redeemReward' }) \|\| t('errors:redeemFailed'));` |
| 166 | `rewardPoints` | read | users.rewardPoints | Spendable Reward Points balance (RP) | `{t('rewards:pointsBadge', { value: formatNumber(currentUser.rewardPoints) })}` |

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

#### `tests/e2e/challenge-claim.spec.ts` — MIGRATE · Phase 1-4 · risk Low

> Test rewritten against the V3 contract

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 25 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `type Points = { rewardPoints: number; lifetimeXP: number };` |
| 25 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `type Points = { rewardPoints: number; lifetimeXP: number };` |
| 34 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: Number(f.rewardPoints?.integerValue ?? 0),` |
| 35 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: Number(f.lifetimeXP?.integerValue ?? 0),` |
| 74 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(after1.rewardPoints).toBe(before1.rewardPoints + REWARD);` |
| 75 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `expect(after1.lifetimeXP).toBe(before1.lifetimeXP + REWARD);` |
| 76 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(after2.rewardPoints).toBe(before2.rewardPoints + REWARD);` |
| 77 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `expect(after2.lifetimeXP).toBe(before2.lifetimeXP + REWARD);` |

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

#### `tests/e2e/utils/seedChallenge.ts` — MIGRATE · Phase 1-4 · risk Low

> Test rewritten against the V3 contract

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 12 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 25,` |

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
| 401 | `approveTaskCompletion` | test | in-memory / derived | V4 task completion command (RP + XP credit) | `it('1. approveTaskCompletion', async () => {` |

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

#### `tests/firestore/firestore.rules.test.ts` — MIGRATE · Phase 1-5 · risk Medium

> Rules tests rewritten alongside the rules

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 60 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 100,` |
| 61 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 100,` |
| 87 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `// gamification_events (V4 immutable event ledger)` |
| 89 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `describe('gamification_events', () => {` |
| 90 | `gamification_events` | test | families/{f}/gamification_events | Existing XP event ledger | `const path = ˋfamilies/${familyId}/gamification_events/evt-1ˋ;` |
| 147 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `// gamification_state (V4 projection / rebuilt state)` |
| 149 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `describe('gamification_state', () => {` |
| 150 | `gamification_state` | test | in-memory / derived | New V4 projection state collection | `const path = ˋfamilies/${familyId}/gamification_state/${childId}ˋ;` |
| 165 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `setDoc(doc(db, path), { memberId: childId, familyId, rewardPoints: 100 }),` |
| 172 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `setDoc(doc(db, path), { memberId: childId, familyId, rewardPoints: 999 }),` |
| 190 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `setDoc(doc(db, path), { memberId: childId, familyId, rewardPoints: 100, lifetimeXP: 100 }),` |
| 190 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `setDoc(doc(db, path), { memberId: childId, familyId, rewardPoints: 100, lifetimeXP: 100 }),` |

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

#### `tests/firestore/gamificationV3.rules.test.ts` — MIGRATE · Phase 1-5 · risk Medium

> Rules tests rewritten alongside the rules

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 39 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 100,` |
| 40 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 100,` |
| 104 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 100,` |

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

#### `tests/firestore/p0-live-repro.rules.test.ts` — MIGRATE · Phase 1-5 · risk Medium

> Rules tests rewritten alongside the rules

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 176 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: Number(child.rewardPoints ?? 0),` |
| 177 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: Number(child.lifetimeXP ?? 0),` |
| 183 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `const eventRef = doc(collection(db, ˋfamilies/${FAMILY_ID}/behaviour_eventsˋ))` |
| 262 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `ˋfamilies/${FAMILY_ID}/{behaviour_events,wallets,wallet_transactions,feed,notifications}ˋ,` |
| 287 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `ˋbehaviour:${type} isolated behaviour_events createˋ,` |
| 363 | `redeemReward` | test | in-memory / derived | Reward redemption (RP debit) | `// Flow 4 — child redeems a reward: mirrors api.ts redeemReward` |
| 371 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `Number((r as { cost?: number }).cost ?? 0) <= Number(snap.users[CHILD].rewardPoints ?? 0),` |
| 376 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const currentPoints = Number(snap.users[CHILD].rewardPoints ?? 0)` |
| 409 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const userUpdate = { rewardPoints: currentPoints - cost, lastRedemptionId: redemptionRef.id }` |
| 537 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `await setDoc(doc(sdb, 'users/child'), { familyId: FAM, role: 'child', displayName: 'Child', rewardPoints: 100, lifetimeXP: 0, walletBalance: 0 })` |
| 537 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `await setDoc(doc(sdb, 'users/child'), { familyId: FAM, role: 'child', displayName: 'Child', rewardPoints: 100, lifetimeXP: 0, walletBalance: 0 })` |
| 541 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `const eventRef = doc(collection(db, ˋfamilies/${FAM}/behaviour_eventsˋ))` |
| 635 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 100,` |
| 636 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 0,` |
| 656 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `const eventRef = doc(collection(db, ˋfamilies/${FAMILY_ID}/behaviour_eventsˋ))` |

#### `tests/firestore/p0-production-flows.rules.test.ts` — MIGRATE · Phase 1-5 · risk Medium

> Rules tests rewritten alongside the rules

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 57 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 100,` |
| 58 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 0,` |
| 70 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 5,` |
| 71 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `lifetimeXP: 0,` |
| 124 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `const ref = doc(collection(db, ˋfamilies/${FAMILY_ID}/behaviour_eventsˋ));` |
| 129 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `const ref = doc(collection(db, ˋfamilies/${FAMILY_ID}/behaviour_eventsˋ));` |
| 134 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `const eventRef = doc(collection(db, ˋfamilies/${FAMILY_ID}/behaviour_eventsˋ));` |
| 170 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `const ref = doc(collection(db, ˋfamilies/${FAMILY_ID}/behaviour_eventsˋ));` |
| 178 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `const ref = doc(collection(db, ˋfamilies/${FAMILY_ID}/behaviour_eventsˋ));` |
| 269 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const currentPoints = userDoc.data()?.rewardPoints ?? 0;` |
| 272 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: currentPoints - cost,` |
| 311 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const currentPoints = userDoc.data()?.rewardPoints ?? 0;` |
| 314 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: currentPoints - cost,` |
| 348 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const currentPoints = userDoc.data()?.rewardPoints ?? 0;` |
| 351 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: currentPoints - cost,` |
| 386 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const currentPoints = userDoc.data()?.rewardPoints ?? 0;` |
| 389 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: currentPoints - cost,` |
| 417 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(after.data()?.rewardPoints).toBe(100); // unchanged` |
| 427 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const currentPoints = userDoc.data()?.rewardPoints ?? 0;` |
| 430 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: currentPoints - cost,` |
| 459 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(after.data()?.rewardPoints).toBe(90); // deducted exactly once` |
| 466 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `const ref = doc(collection(db, ˋfamilies/${FAMILY_ID}/behaviour_eventsˋ));` |
| 476 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const currentPoints = userDoc.data()?.rewardPoints ?? 0;` |
| 479 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: currentPoints - cost,` |

#### `tests/firestore/penaltyFullWriteSet.rules.test.ts` — MIGRATE · Phase 1-5 · risk Medium

> Rules tests rewritten alongside the rules

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 8 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `*   2. families/{familyId}/behaviour_events/{eventId}        (create)` |
| 82 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `rewardPoints: 100, lifetimeXP: 0,` |
| 82 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `rewardPoints: 100, lifetimeXP: 0,` |
| 101 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `/** Skip the behaviour_events create (case 8). */` |
| 121 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `const eventRef = doc(collection(db, ˋfamilies/${familyId}/behaviour_eventsˋ));` |
| 328 | `behaviour_events` | test | families/{f}/behaviour_events | Behaviour intent log | `for (const path of ['behaviour_events', 'wallet_transactions', 'feed', 'notifications']) {` |

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

#### `tests/firestore/redeem-managed-child.rules.test.ts` — MIGRATE · Phase 1-5 · risk Medium

> Rules tests rewritten alongside the rules

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 81 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `familyId: FAMILY_ID, role: 'child', displayName: 'Normal', rewardPoints: 100, lifetimeXP: 0,` |
| 81 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `familyId: FAMILY_ID, role: 'child', displayName: 'Normal', rewardPoints: 100, lifetimeXP: 0,` |
| 85 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `displayName: 'Managed', rewardPoints: 100, lifetimeXP: 0, requiresPasswordChange: false,` |
| 85 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `displayName: 'Managed', rewardPoints: 100, lifetimeXP: 0, requiresPasswordChange: false,` |
| 89 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `displayName: 'Managed2', rewardPoints: 100, lifetimeXP: 0, requiresPasswordChange: false,` |
| 89 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `displayName: 'Managed2', rewardPoints: 100, lifetimeXP: 0, requiresPasswordChange: false,` |
| 93 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `displayName: 'Cross', rewardPoints: 100, lifetimeXP: 0, requiresPasswordChange: false,` |
| 93 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `displayName: 'Cross', rewardPoints: 100, lifetimeXP: 0, requiresPasswordChange: false,` |
| 119 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const currentPoints = userDoc.data()?.rewardPoints ?? 0;` |
| 141 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const userUpdate = { rewardPoints: currentPoints - cost, lastRedemptionId: redemptionRef.id };` |
| 218 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(after.data()?.rewardPoints).toBe(100); // unchanged` |
| 229 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `const currentPoints = userDoc.data()?.rewardPoints ?? 0;` |
| 230 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `tx.update(userRef, { rewardPoints: currentPoints - 10, lastRedemptionId: 'dup-id' });` |
| 253 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `expect(user.data()?.rewardPoints).toBe(90);` |

#### `tests/firestore/repro-task-approval-bug.test.ts` — MIGRATE · Phase 1-5 · risk Medium

> Rules tests rewritten alongside the rules

| Line | Term | Operation | Source | Semantic meaning | Code |
|---|---|---|---|---|---|
| 45 | `approveTaskCompletion` | test | in-memory / derived | V4 task completion command (RP + XP credit) | `// This simulates the ACTUAL code in approveTaskCompletion` |

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
| 33 | `approveTaskCompletion` | test | in-memory / derived | V4 task completion command (RP + XP credit) | `import { approveTaskCompletion, createFamilyAndParent, createTask, signUp } from '../../src/lib/api'` |
| 91 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `displayName: 'Test Child', rewardPoints: 0, lifetimeXP: 0,` |
| 91 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `displayName: 'Test Child', rewardPoints: 0, lifetimeXP: 0,` |
| 125 | `lifetimeXP` | test | users.lifetimeXP | Legacy duplicate lifetime XP counter | `it('awards rewardPoints, lifetimeXP and a summary for a family created today', async () => {` |
| 125 | `rewardPoints` | test | users.rewardPoints | Spendable Reward Points balance (RP) | `it('awards rewardPoints, lifetimeXP and a summary for a family created today', async () => {` |
| 129 | `approveTaskCompletion` | test | in-memory / derived | V4 task completion command (RP + XP credit) | `await approveTaskCompletion(familyId, completionId)` |
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
