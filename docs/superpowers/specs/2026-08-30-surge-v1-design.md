# Surge + Daily Engagement Engine V1 — Design

Status: in progress (V1 implementation)
Base SHA: `1d58cf4` (Mascot Engine V1) on top of P0 task-completion SHAs `e5a8612`, `11974ce`, `fd75cf2` from `main`.
Target branch: `feat/surge-daily-engagement-v1`.

## 1. Core architectural law

> Engagement Engine creates opportunities.
> Gamification Engine awards value.

A Surge being active does NOT itself award anything.

The client must NEVER be trusted to claim:

- surge bonus points
- double XP
- surge eligibility
- completion time
- approval time

The **only** path that may write authoritative Surge bonuses is the existing
authoritative task-completion / gamification processor (`processApprovedCompletion`).

## 2. Existing architecture we are reusing

| Concern | Reused surface |
| --- | --- |
| Generic event window | `EventDefinition` (`src/domain/experience/types.ts`) with `status: 'active'` and `startsAt/endsAt` |
| Family opt-in | `ExperiencePreferences` (`weeklyThemes`, `seasonalEvents[key]`) |
| Authority / ledger | `gamification_events` (server-only), `task_completions` (Firestore) |
| Reversal | `processTaskInvalidation` + `reversals` collection |
| Mascot | `MascotContext` extension only — no logic in `<Mascot />` |
| UI completion | `QuestBoard` + `HoldToCompleteButton` + `completeTask()` |

The Surge event is **NOT** a separate parallel architecture. It is an
`EventDefinition` of a new `EventType: 'surge'`, carrying a structured
`surgeDefinition` payload. The same `events` resolver (`isEventLive`,
`pickLiveSeasonalEvent`) is reused.

## 3. Data model

### 3.1 `EventType` extension (`src/domain/experience/types.ts`)

```ts
export type EventType =
  | 'weekly_theme'
  | 'seasonal'
  | 'family_challenge'
  | 'special'
  | 'surge';        // ← new
```

A Surge event uses the existing `startsAt/endsAt/status` window.

### 3.2 Surge payload (`metadata.surge`)

```ts
interface SurgeEligibility {
  kind: 'task_bonus';
  eligibleTaskIds: string[];          // explicit list — never inferred client-side
  reward:
    | { type: 'bonus_points'; amount: number }
    | { type: 'xp_multiplier'; multiplier: number }; // model only; V1 disabled
}

interface SurgeEventMetadata {
  surge: SurgeEligibility;
}

interface SurgePreferenceKey extends 'surgeHours' { /* literal */ }
```

The full event document remains an `EventDefinition`. The `surge` payload
lives under `metadata.surge` so we never duplicate `startsAt/endsAt`.

### 3.3 Family opt-in (`engagementPreferences`)

The existing `ExperiencePreferences` gains a single new opt-in flag:
`surgeHours: boolean`. Defaults to `true` for new families. When `false`:

- no Surge UI,
- no Surge bonus eligibility for new completions,
- historical bonuses earned before the change are preserved (evidence is
  immutable — see §4).

### 3.4 Where Surge event definitions live (V1)

V1 ships fixtures in `src/domain/experience/fixtures/surges.ts` and a
companion `src/domain/surge/scheduler.ts` that produces candidate Surge
events deterministically from a seed. The server-side evaluator reads the
**same fixtures** through the pure domain modules — there is no parallel
state.

V1 deliberately does NOT write Surge event documents to Firestore. The
brief allows V1 to ship architecture; the operator-driven catalog will
arrive with the scheduling UI in a later package.

## 4. Surge eligibility — single source of truth

`src/domain/surge/eligibility.ts` exports:

```ts
interface SurgeEligibilityInput {
  now: number;                       // server clock
  surge: SurgeEligibility;
  task: { id: string; assigneeId: string | null; requiresApproval: boolean };
  completion: {
    id: string;
    childId: string;
    taskId: string;
    completedAt: number;             // authoritative server-stored timestamp
  };
  surgeWindow: { startsAt: number; endsAt: number };   // from EventDefinition
  familyPreferences: { surgeHours: boolean };
}

interface SurgeEligibilityResult {
  eligible: boolean;
  reason:
    | 'in_window'
    | 'outside_window'
    | 'task_not_eligible'
    | 'sibling_assigned'
    | 'preference_disabled'
    | 'duplicate'
    | 'invalid_completion';
  rewardSnapshot?: {
    rewardType: 'bonus_points';
    rewardAmount: number;
  };
}
```

Boundary semantics (pinned by tests):

```
window = [startsAt, endsAt)
completedAt ∈ [startsAt, endsAt)   → eligible
completedAt === endsAt              → not eligible
completedAt <  startsAt             → not eligible
```

A `task.assigneeId === completion.childId` OR `task.assigneeId === null`
qualifies. A `task.assigneeId === "sibling"` never qualifies.

The family `surgeHours` preference MUST be `true` at evaluation time.

## 5. Idempotency

Event id:

```
surge:{surgeId}:completion:{completionId}
```

- `{surgeId}` is the catalog Surge event id (stable).
- `{completionId}` is the authoritative task completion id.

The same `{surgeId, completionId}` pair is therefore impossible to mint
twice. The server-side evaluator calls `transaction.create` on the
`gamification_events` document; a duplicate retry sees `alreadyExists`
and is a no-op.

A reverse idempotency token:

```
surge:{surgeId}:completion:{completionId}:reversal
```

exists when the Surge bonus is reversed (see §7).

## 6. Reward flow

`processApprovedCompletion` already reads `completedAt`, `assigneeId`,
`taskId` and decides whether to award. We extend it with a single,
isolated call:

```ts
// inside the existing transaction
const surgeResult = await evaluateAndAwardSurgeBonus(transaction, {
  familyId,
  childId,
  taskId,
  completion,
  now: args.processingAt,
  surgeCatalog: SURGE_CATALOG,
  familyPreferences,
})
```

The evaluator:

1. looks up candidate Surges whose `eligibleTaskIds` includes `taskId`
   AND whose window covers `completion.completedAt`;
2. applies the family `surgeHours` opt-in;
3. applies the assignee rule (no sibling completion);
4. computes a deterministic `surgeEventId = surge:{surgeId}:completion:{completionId}`;
5. attempts `transaction.create(gamification_events.doc(surgeEventId), …)`;
6. catches `alreadyExists` and returns `'duplicate'`.

The base `task_reward` event is **untouched** — it remains the canonical
`TASK_APPROVED` reward already minted by the existing pipeline. The
Surge bonus is a separate immutable event in the same ledger, with
`rewardType: 'bonus_points'` recorded in `metadata.rewardType`.

### 6.1 XP multiplier

The reward type `xp_multiplier` is added to the type system so future
fixtures can declare it, parsing/validation is covered by tests, but the
V1 evaluator **rejects** multipliers and refuses to mint an event for
them. The brief explicitly forbids destabilising the XP rebuild code.

## 7. Reversal linkage

`processTaskInvalidation` already exists and reverses every effect
attributed to the completion via `reversalId = task_completion__{completionId}`.

When the original base reward is reversed, the Surge bonus is reversed
in the same transaction by:

1. reading the existing `surge:{surgeId}:completion:{completionId}` event,
2. writing a `TASK_REVERSED`-equivalent event
   `surge:{surgeId}:completion:{completionId}:reversal` with negative
   `rewardPointsDelta` and `reversalOfEventId` pointing at the Surge
   bonus event id,
3. using the same `reversalRef` so a parent view can render the two as
   one logical reversal.

This matches the existing audit taxonomy (the Surge bonus is a separate
ledger event, but both are reversed under the same `task_completion__{id}`
reversal document).

## 8. Evidence stability under event mutation

The Surge bonus event embeds the **snapshot** of the bonus that was
evaluated, not a pointer to a live document:

```ts
metadata = {
  surgeId,
  eventVersion: 1,          // bumped if the surge shape changes
  completedWithinWindow: true,
  completedAt: <ms>,
  rewardType: 'bonus_points',
  rewardAmount: 10,
  taskId,
  childId,
}
```

If the operator later edits the Surge catalog (`reward.amount` becomes
20) or deletes the Surge entirely, every previously-evaluated bonus keeps
its captured amount and remains auditable.

## 9. Daily Engagement resolver

`src/domain/engagement/resolver.ts` exports a pure read-only resolver:

```ts
interface DailyEngagementInput {
  now: number;
  activeSurges: SurgeEligibility[];
  availableTasks: Array<{
    id: string;
    title: string;
    pointsReward: number;
    assigneeId: string | null;
    isCompleted: boolean;
  }>;
  activeStreak?: number;
  activeEvent?: EventDefinition;
  familyPreferences: { surgeHours: boolean };
}

interface DailyEngagementPresentation {
  primaryOpportunity?:
    | { kind: 'surge'; surge: SurgeEligibility; eligibleTasks: TaskSummary[]; endsAt: number }
    | { kind: 'streak'; streak: number; questsRemaining: number }
    | { kind: 'seasonal'; event: EventDefinition };
  urgency: 'normal' | 'soon' | 'ending';
  nextRefreshAt?: number;
}
```

Precedence (top wins):
1. **Surge** with ending-soon window (`endsAt - now < 10 min`)
2. **Surge** (regular)
3. **Streak at risk** (carry-over from Mascot logic)
4. **Seasonal event**
5. **Default** (no primary opportunity)

## 10. UI integration

- New `<SurgeBanner />` shown inside `QuestBoard` above the existing quest list.
- `SurgeBanner` selects the highest-priority active Surge and renders a
  list of eligible tasks.
- Tapping a Surge task pre-selects it in `QuestBoard`; the existing
  `HoldToCompleteButton` is reused. **No second completion implementation.**
- The countdown is derived from `endsAt`; an expired Surge disappears on
  the next snapshot tick.

## 11. Mascot integration

`MascotContext` gets one new optional block:

```ts
engagement?: {
  activeSurge?: boolean;
  surgeEndingSoon?: boolean;
}
```

The mascot resolver gains two new `priorityTag`s:

- `surge-active` — placed below `streak-at-risk`, above `new-user`
- `surge-ending-soon` — placed below `level-up`, above `all-quests-complete`
  only when `surgeEndingSoon` AND a major achievement is NOT present

The mascot itself NEVER branches on Surge content; the resolver carries
the message key. A new `mascot.surge.active` and `mascot.surge.ending`
message set is added to the existing curated catalog.

## 12. Frequency / anti-gaming

V1 ships a deterministic scheduler (`src/domain/surge/scheduler.ts`):

```ts
interface SchedulerInput {
  seed: string;            // family id + day key
  familyPreferences: { surgeHours: boolean };
  todaysSurges: number;
  weeksSurges: number;
  lastSurgeEndedAt: number | null;
  now: number;
}

interface SchedulerDecision {
  mayEmit: boolean;
  candidateSurge?: SurgeEligibility;
  reason:
    | 'preference_disabled'
    | 'daily_quota_exhausted'
    | 'weekly_quota_exhausted'
    | 'gap_too_short'
    | 'seed_selected_none';
}
```

Defaults (testable, no `Math.random`):

- `maxSurgesPerDay = 3`
- `maxSurgesPerWeek = 12`
- `minimumGapBetweenSurges = 90 min`

The decision is a pure function — no client clock dependency.

## 13. Firestore Rules changes

We add one server-owned, read-only collection for the catalogue exposure:

```rules
match /surge_catalog/{surgeId} {
  allow read: if isFamilyMember(familyId);
  allow write: if false;
}
```

V1 does NOT write Surge documents to Firestore. The read path stays
gated for future work. For V1, Surge UI is fed by fixtures the resolver
composes client-side; the authoritative evaluator is fed by the same
fixtures at server-eval time, so client and server agree.

We add one tiny piece of write protection on `gamification_events` — the
document already disallows client writes; we add a
`isImmutableSurgeEvent` guard so a future regression cannot accidentally
allow client updates to a Surge bonus document. (The existing
`allow write: if false` already covers this, so no actual change.)

We do NOT modify `task_completions` rules — that path is owned by the
P0 security commit.

## 14. Security tests

Mandatory coverage (all in `tests/firestore/surge.rules.test.ts`):

- child cannot create a Surge event
- child cannot extend Surge endsAt
- child cannot change Surge reward amount
- child cannot write `surge_catalog`
- child cannot write `gamification_events`
- cross-family child cannot trigger Surge bonus for sibling-family task
- duplicate `surge:{id}:completion:{id}` write is rejected (already
  covered by `gamification_events` write deny — added regression test)
- assigneeId = null still works
- managed child behaviour matches normal child behaviour
- preference disabled ⇒ no new Surge bonus mint

## 15. Core functional tests

`src/domain/surge/eligibility.test.ts` and `src/domain/surge/scheduler.test.ts`:

- Within window / last moment (17:59:59) / outside (18:00:00)
- Approval delay (hours later) → bonus preserved
- Rejected completion → no award
- Duplicate processing → exactly one event
- Sibling-assigned task → denied
- Unassigned family task → eligible
- Disabled preference → no award
- Event mutation (`reward.amount: 10 → 20`) → earned result keeps 10
- Event deletion after completion → existing bonus still processable

## 16. Out of scope (V1)

- Push notifications
- Weather morning brief
- Mystery Drops
- Complex Daily Quest generation
- AI-generated engagement text
- 2× XP production path (modelled, parsed, disabled)

## 17. Verification gates

1. `vitest run --dir src/domain/surge`
2. `vitest run --dir src/domain/engagement`
3. Mascot resolver regression (`src/domain/mascot`)
4. Event + Theme Engine regression (`src/domain/experience`)
5. Task completion tests (existing P0 suite)
6. Reversal tests (existing)
7. `tests/firestore/surge.rules.test.ts`
8. `npm run test` (full vitest sweep)
9. `npm run typecheck`
10. `npm run build`
11. `npm run lint` on changed files
12. `git diff --check`

## 18. Git discipline

- One commit per logical layer (domain, evaluator, scheduler, UI, mascot,
  rules, tests).
- No mixed dirty files.
- NO DEPLOY. The branch is local; no push.