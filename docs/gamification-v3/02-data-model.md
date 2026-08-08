# Gamification V3 — Data Model & Field Disposition

---

## 0. Two distinct currencies (normative)

Reward Points and XP are **different quantities with different rules**. They are never
interchangeable, never summed together, and never derived from one another.

| | **Reward Points (RP)** | **Experience Points (XP)** |
|---|---|---|
| Meaning | A *spendable balance*. The child's purchasing power. | A *lifetime achievement score*. A record of everything ever earned. |
| Monotonic? | **No.** Decreases on `REWARD_REDEEM`, `AVATAR_UNLOCK`, `REVERSAL`. | **Yes.** Only `REVERSAL` may decrease it, and only to undo a specific prior credit. |
| Can be negative? | **Never.** Non-negativity is asserted server-side; a redeem that would go negative **fails**, it does not clamp. | **Never.** |
| Ledger field | `rewardPointsDelta` (may be negative) | `xpDelta` (>= 0 except `REVERSAL`) |
| Projection field | `gamification_state.rewardPoints` | `gamification_state.xpTotal` |
| Drives | Reward catalogue affordability, avatar unlocks, challenge claims | `level`, `xpIntoLevel`, `xpToNextLevel`, `progress`, badges |
| Does **not** drive | Level or progress — ever. | Affordability — ever. |
| Weekly variant | `weeklyPoints` — the **sole** leaderboard input, reset by `WEEK_ROLLOVER`. | none |

`weeklyPoints` is a *windowed view of RP earnings only*: it accrues from positive
`weeklyPointsDelta` and is reset, never carried over. It is not a third currency and
is never used for levels.

Any code that adds an RP value to an XP value, or computes a level from RP, is a defect.
This is one of the violations enforced by the `no-gamification-firestore` ESLint rule.

---

## 1. Collections

### 1.1 Ledger (new, authoritative, append-only)

`families/{familyId}/gamification_events/{eventId}`

```ts
interface GamificationEventV3 {
  schemaVersion: 3;
  id: string;                 // == document id
  memberId: string;
  familyId: string;
  type: GamificationEventType;
  occurredAt: number;         // epoch ms, business time
  recordedAt: number;         // epoch ms, server time
  timezone: string;           // IANA, captured at write time
  dayKey: string;             // YYYY-MM-DD in `timezone`
  weekKey: string;            // YYYY-Www, Monday-based
  rewardPointsDelta: number;  // integer, may be negative
  xpDelta: number;            // integer, >= 0 except REVERSAL
  weeklyPointsDelta: number;  // integer, may be negative
  dailyWeight: number;        // integer >= 0, feeds daily goal / perfect day
  idempotencyKey: string;     // unique per family, enforced by doc id derivation
  actorId: string;            // who caused it
  reversesEventId: string | null;
  metadata: Readonly<Record<string, string | number | boolean>>;
}

type GamificationEventType =
  | 'TASK_APPROVED'
  | 'BEHAVIOUR'
  | 'REWARD_REDEEM'
  | 'AVATAR_UNLOCK'
  | 'CHALLENGE_CLAIM'
  | 'DAILY_GOAL'
  | 'PERFECT_DAY'
  | 'WEEK_ROLLOVER'
  | 'MANUAL_ADJUSTMENT'
  | 'MIGRATION_BASELINE'
  | 'REVERSAL';
```

Rules: never updated, never deleted. Document id = `sha256(familyId + idempotencyKey)` truncated — makes replay a no-op `create` failure.

### 1.2 Projection (new, replaces `gamification_summaries`)

`families/{familyId}/gamification_state/{memberId}`

```ts
interface GamificationStateV3 {
  schemaVersion: 3;
  familyId: string;
  memberId: string;

  // Balances — folded from the ledger
  rewardPoints: number;
  xpTotal: number;
  weeklyPoints: number;
  weekKey: string;

  // Derived — computed by the reducer, never by the UI
  level: number;
  xpIntoLevel: number;
  xpToNextLevel: number;
  progress: number;            // 0..1

  // Streaks
  currentStreak: number;
  bestStreak: number;
  lastQualifiedDayKey: string | null;

  // Daily
  dailyGoalTarget: number;
  dailyGoalProgress: number;
  dailyGoalMet: boolean;
  perfectDayCount: number;

  badges: readonly string[];   // unlocked badge ids, computed by reducer
  leaderboardRank: number;     // 1-based, within family children

  lastEventId: string;
  eventCount: number;
  ledgerChecksum: string;      // sha256 over ordered event ids
  rebuildRequired: boolean;
  updatedAt: number;
}
```

Client access: **read-only**. Written only by the projection writer.

### 1.3 Family aggregate (new)

`families/{familyId}/gamification_state/__family`
`{ totalXP, totalRewardPoints, weeklyPoints, weekKey, championMemberId, updatedAt }`

Removes the client-side `totalFamilyXP` reduce in [`Family.tsx`](src/pages/Family.tsx:85).

### 1.4 Surviving / retired collections

| Collection | Verdict |
|---|---|
| `families/{f}/gamification_events` (existing XP events) | **MIGRATE** into the V3 ledger |
| `families/{f}/gamification_summaries` | **REMOVE** after cutover (superseded by `gamification_state`) |
| `families/{f}/gamification_eligibility` | **KEEP** — input snapshots for streak/perfect-day |
| `families/{f}/tasks`, `task_completions` | **KEEP** — but no longer a gamification source of truth |
| `families/{f}/behaviour_events` | **KEEP** as intent log; deltas move to the ledger |
| `families/{f}/reversals` | **KEEP** — emits `REVERSAL` ledger events instead of writing balances |
| `users/{id}` gamification fields | **REMOVE** (see §2) |

---

## 2. Field-by-field disposition

Legend: **KEEP** · **REMOVE** · **DERIVED** (computed in reducer) · **MIGRATE** (becomes a ledger baseline)

| Field | Today | Verdict | Notes |
|---|---|---|---|
| `users.rewardPoints` | client-written balance | **MIGRATE → REMOVE** | Baseline event, then `gamification_state.rewardPoints`. Blocks [`api.ts:1046`](src/lib/api.ts:1046), [`api.ts:3089`](src/lib/api.ts:3089) |
| `users.lifetimeXP` | duplicate XP | **MIGRATE → REMOVE** | Duplicate of `xpTotal` (F2) |
| `users.currentStreak` | legacy | **REMOVE / DERIVED** | Ledger-derived |
| `users.longestStreak` | legacy | **REMOVE / DERIVED** | Ledger-derived; used today at [`MemberProfile.streakBadges`](src/pages/MemberProfile.streakBadges.test.tsx:58) |
| `users.lastActiveDate` | legacy streak input | **REMOVE** | Superseded by `dayKey` on events |
| `users.lastRedemptionId` | write marker | **REMOVE** | Ledger event id is the marker |
| `users.lastReversalId` | write marker | **REMOVE** | Ledger `reversesEventId` |
| `users.walletBalance` | money | **KEEP** | Out of gamification scope |
| `summary.xpTotal` | projection | **KEEP** → renamed into `gamification_state.xpTotal` | |
| `summary.level` | projection | **DERIVED** | From `xpTotal` via [`level.ts`](src/domain/gamification/level.ts:1) only |
| `summary.progress` | mixed | **DERIVED** | Reducer only |
| `summary.rewardPoints` | absent/partial | **NEW, authoritative** | |
| `summary.weeklyPoints` | absent | **NEW, authoritative** | Sole leaderboard input |
| `summary.currentStreak` / `bestStreak` | projection | **KEEP** (derived) | |
| `summary.perfectDayCount` | projection | **KEEP** (derived) | |
| `badges` | computed in UI | **DERIVED** | Moves out of [`achievements.ts`](src/lib/achievements.ts:32) into reducer; UI keeps only labels/icons |
| daily goals | scattered | **DERIVED** | From `dailyWeight` sums per `dayKey` |
| `challenges.rewardPoints` | config | **KEEP** | Configuration, not a balance |
| `tasks.pointsReward` | config | **KEEP** | Snapshotted into the event at approval |
| `rewards.cost` | config | **KEEP** | Snapshotted into `REWARD_REDEEM` metadata |

**Nothing above appears twice after cutover.**

---

## 2.1 Breaking changes

Every item below is a **BREAKING CHANGE**. Each is gated behind the phase named in
[`04-implementation-and-testing.md`](docs/gamification-v3/04-implementation-and-testing.md:5).

| # | **BREAKING** change | Phase | Who breaks | Mitigation |
|---|---|---|---|---|
| B1 | Clients may no longer write `users.rewardPoints` / `lifetimeXP` (Rules deny). | 5 (freeze) | Any client older than Phase 3 | Legacy write paths replaced by callables in Phase 3; mirror keeps reads correct |
| B2 | `gamification_summaries` becomes read-only. | 1 | Any writer outside the projection writer | Projection writer owns it |
| B3 | `gamification_summaries` is deleted. | 6 | Any remaining reader | Phase 4 removes all readers; ESLint allowlist must be empty first |
| B4 | The six `users` gamification fields are deleted. | 6 | Any remaining reader | Point of no return; 7 days of green verification required |
| B5 | `resolveProgression`, `adaptGamificationSummary`, `levelFromXp`, `xpProgressInLevel` are deleted from `gamificationAdapters.ts`. | 4 | Importers | Replaced by `useGamification` |
| B6 | Existing `gamification_events` documents are upcast to `schemaVersion: 3`. | 5 | Readers of the V2 event shape | Upcast is in-place and additive; V2 fields retained |
| B7 | Client-side balance maths in `behaviour.ts` is removed. | 3 | Offline optimistic UI | Callables are online-only (R7) |
| B8 | `Family.tsx` stops computing `membersWithWeeklyXP` / `totalFamilyXP`. | 4 | Leaderboard | Served by `gamification_state` + `__family` aggregate |

---

## 3. Collection diagram

```
families/{familyId}
├── gamification_events/{eventId}        ← APPEND ONLY (source of truth)
│      memberId, type, deltas, dayKey, weekKey, idempotencyKey
├── gamification_state/{memberId}        ← PROJECTION (read-only to clients)
├── gamification_state/__family          ← family aggregate
├── gamification_eligibility/{dayKey}    ← reducer input
├── gamification_summaries/{memberId}    ← DEPRECATED, deleted in Phase 6
├── tasks/, task_completions/            ← config + intent
├── behaviour_events/                    ← intent
├── rewards/, redemptions/               ← config + intent
└── reversals/                           ← intent

users/{userId}
└── displayName, avatarUrl, role, walletBalance      ← gamification fields REMOVED
```

## 4. Reducer purity contract

```
state = fold(events.sortedBy(occurredAt, recordedAt, id), eligibilitySnapshots)
```

- No wall-clock reads inside the reducer (`processingAt` is an explicit argument — already the pattern in [`engine.ts`](src/domain/gamification/engine.ts:506)).
- Integer arithmetic only; `BigInt` accumulation as already done in [`xp.ts`](src/domain/gamification/xp.ts:74), extended to reward points and weekly points.
- Same input ⇒ byte-identical output. Enforced by the rebuild-equality test.
