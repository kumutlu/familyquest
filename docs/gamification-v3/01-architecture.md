# Gamification V3 — Architecture Document

Status: **APPROVED.** Phase 0 authorised (inventory + architecture guards only). No runtime behaviour changed.
Scope: Breaking change permitted. Full refactor of gamification read/write paths.

Companion documents: [`02-data-model.md`](docs/gamification-v3/02-data-model.md:1) ·
[`03-migration-and-rollback.md`](docs/gamification-v3/03-migration-and-rollback.md:1) ·
[`04-implementation-and-testing.md`](docs/gamification-v3/04-implementation-and-testing.md:1) ·
[`05-current-state-inventory.md`](docs/gamification-v3/05-current-state-inventory.md:1) ·
[`06-phase-0-baseline.md`](docs/gamification-v3/06-phase-0-baseline.md:1)

Terminology is normative in [`02-data-model.md §0`](docs/gamification-v3/02-data-model.md:7):
**Reward Points** are a spendable balance; **XP** is a monotonic lifetime score. They are
never interchangeable.

---

## 1. Problem Statement (evidence from the current repository)

The audit below is drawn from the actual codebase, not from assumption.

| # | Failure | Evidence |
|---|---|---|
| F1 | Reward points live on the user document and are mutated by the client inside Firestore transactions. | [`redeemReward()`](src/lib/api.ts:1046), [`claimChallenge()`](src/lib/api.ts:984), [`unlockAvatar()`](src/lib/api.ts:3089), [`api.ts`](src/lib/api.ts:1087) |
| F2 | Two XP counters exist: `users.lifetimeXP` and `gamification_summaries.xpTotal`. | [`resolveProgression()`](src/lib/gamificationAdapters.ts:116) explicitly falls back between them |
| F3 | A documented "temporary" legacy fallback is load-bearing in the UI. | `TODO(gamification-legacy-fallback)` in [`gamificationAdapters.ts`](src/lib/gamificationAdapters.ts:99) |
| F4 | Leaderboard computes weekly points client-side by scanning task completions. | [`Family.tsx`](src/pages/Family.tsx:59) — `membersWithWeeklyXP` |
| F5 | Family XP is a client-side reduce over `lifetimeXP`. | [`Family.tsx`](src/pages/Family.tsx:85) |
| F6 | Screens read raw `currentUser.rewardPoints` directly. | [`Rewards.tsx`](src/pages/Rewards.tsx:45), [`Dashboard.tsx`](src/pages/Dashboard.tsx:115), [`MemberProfile.tsx`](src/pages/MemberProfile.tsx:136), [`ChildSummaryCard.tsx`](src/components/parent/dashboard/ChildSummaryCard.tsx:39), [`ProfileEditorModal.tsx`](src/components/profile/ProfileEditorModal.tsx:54) |
| F7 | Behaviour maths is duplicated client-side and server-side. | [`behaviour.ts`](src/lib/behaviour.ts:60) vs [`behaviourProcessor.ts`](functions/src/behaviourProcessor.ts) |
| F8 | Reversals write balances directly. | [`reversalApi.ts`](src/lib/reversalApi.ts:116) |
| F9 | Level/progress formulas exist in more than one place. | [`levelFromXp()`](src/lib/gamificationAdapters.ts:183), [`xpProgressInLevel()`](src/lib/gamificationAdapters.ts:190), [`level.ts`](src/domain/gamification/level.ts:1) |
| F10 | Badge unlocking mixes projection XP with user-doc reward points. | [`MemberProfile.tsx`](src/pages/MemberProfile.tsx:219), [`achievements.ts`](src/lib/achievements.ts:32) |

**Root cause:** there is no single writer and no single reader. There is a *good* event-sourced core in [`src/domain/gamification/`](src/domain/gamification/engine.ts:1) that is only partially wired: XP flows through it, reward points do not.

---

## 2. Target Architecture

```
                     ┌──────────────────────────────────────┐
   COMMANDS          │            CLIENT (React)            │
   (callable only)   │  no Firestore writes to gamification │
                     └───────────────┬──────────────────────┘
                                     │  httpsCallable
                                     ▼
                     ┌──────────────────────────────────────┐
                     │      COMMAND HANDLERS (Functions)    │  ← THE ONLY WRITER
                     │  validate → authorise → dedupe       │
                     └───────────────┬──────────────────────┘
                                     │ append (transaction)
                                     ▼
                     ┌──────────────────────────────────────┐
                     │   LEDGER  gamification_events/{id}   │  append-only, immutable
                     └───────────────┬──────────────────────┘
                                     │ onCreate trigger / rebuild job
                                     ▼
                     ┌──────────────────────────────────────┐
                     │  PROJECTION  gamification_state/{m}  │  read-only to clients
                     └───────────────┬──────────────────────┘
                                     │ single onSnapshot subscription
                                     ▼
                     ┌──────────────────────────────────────┐
                     │  READ MODEL  useGamification(id)     │  ← THE ONLY READER
                     └───────────────┬──────────────────────┘
                                     ▼
             Profile · Dashboard · Leaderboard · Family · Rewards ·
             Achievements · Badges · Child Home · Parent Home · Settings
```

### Layer contracts

| Layer | Rule |
|---|---|
| Immutable ledger | Append-only. Never updated, never deleted. Corrections are new `REVERSAL` / `MANUAL_ADJUSTMENT` events. |
| Projection | 100% a pure function of the ledger. Deletable and rebuildable at any moment. |
| Derived values | `level`, `progress`, `xpToNext`, `rank` are computed **once**, inside the projection reducer, from canonical formulas in `src/domain/gamification/`. |
| UI read model | One hook. One shape. No optional fallbacks. |
| Legacy compatibility | A **write-only mirror** owned by the projection writer, kept for exactly one release, then deleted. Never read by the app. |

### The invariant that makes the bug class impossible

> **A value may exist in exactly one place, be written by exactly one process, and be read through exactly one function.**

Enforced mechanically by:
1. Firestore Rules — clients cannot write gamification fields (Part 10).
2. An ESLint boundary rule — only `src/services/gamification/**` may import Firestore for gamification paths (Part 5).
3. A `rebuild === live` equality test in CI (Part 11).

---

## 3. Single Writer — Command Pipeline

All six entry points collapse into one pipeline:

```
Task Approved ─┐
Behaviour Logged ─┐
Reward Redeemed ─┤
Manual Adjustment ─┼─► callable command ─► authorise ─► build event(s)
Daily Bonus ─┤                                   │
Reversal ─┘                                      ▼
                                    ledger append (idempotencyKey)
                                                 │
                                                 ▼
                                    projection update (transactional)
                                                 │
                                                 ▼
                                                UI
```

Callables (all in `functions/src/gamification/commands/`):

| Callable | Emits |
|---|---|
| `gamificationApproveTask` | `TASK_APPROVED` |
| `gamificationLogBehaviour` | `BEHAVIOUR` |
| `gamificationRedeemReward` | `REWARD_REDEEM` |
| `gamificationAdjust` | `MANUAL_ADJUSTMENT` |
| `gamificationReverse` | `REVERSAL` |
| scheduled `gamificationDailyRollup` | `DAILY_GOAL`, `PERFECT_DAY` |

Guarantees: idempotency key required; single Firestore transaction appends event + updates projection; balance non-negativity asserted server-side (redeem fails, it does not clamp).

---

## 4. Single Reader

```ts
// src/services/gamification/useGamification.ts
const g = useGamification(memberId);
// g.status: 'loading' | 'ready' | 'rebuilding' | 'error'
// g.rewardPoints, g.xpTotal, g.weeklyPoints, g.level, g.progress,
// g.xpIntoLevel, g.xpToNextLevel, g.currentStreak, g.bestStreak,
// g.perfectDays, g.badges, g.dailyGoal, g.leaderboardRank
```

Plus `useFamilyGamification(familyId)` returning the pre-sorted leaderboard array produced by the same projection data.

Hard rules:
- No component may import `firebase/firestore` for gamification.
- No component may perform arithmetic on a gamification value. Formatting only.
- No `|| 0` fallbacks — `status` handles absence explicitly.

Deleted on migration: `resolveProgression`, `adaptGamificationSummary`, `levelFromXp`, `xpProgressInLevel` from [`gamificationAdapters.ts`](src/lib/gamificationAdapters.ts:1) (logic absorbed into the projection reducer).

---

## 5. Leaderboard

Reads `gamification_state/{memberId}.weeklyPoints` and `.leaderboardRank`, both written by the projection. `Family.tsx` loses its `membersWithWeeklyXP` map, its `sortedMembers` sort, and its `totalFamilyXP` reduce. Weekly rollover is a scheduled ledger event (`WEEK_ROLLOVER`), not a client clock.

---

## 6. Non-goals

- No change to task/reward/wallet money domains beyond removing their gamification side effects.
- No visual redesign.
- No change to the canonical XP-per-level constant.
