# Mystery Drops + Comeback Missions V1 — Design / Trust Boundary Note

Branch: `integration/engagement-foundation`
Base SHA: `ab205aa`

## 1. Core law (engagement vs. gamification)

> Engagement creates opportunities. Gamification remains the only authority that
> awards value.

The Mystery Drop / Comeback package NEVER:
- mints spendable points
- mutates `xpTotal` directly
- bypasses parent approval
- fabricates a task completion
- creates untracked value

It MAY:
- surface opportunities via notification candidates
- drive Mascot mood/presentation context
- schedule a deterministic, server-verifiable eligibility window
- write an authoritative evidence record on the SAME transactional pipeline
  that already awards task XP / Surge bonus / thresholds

## 2. Layering

```
src/domain/mysteryDrop/      ← pure V1 resolver (no Firebase, no Date.now())
src/domain/comeback/         ← pure V1 resolver (no Firebase, no Date.now())
functions/src/mysteryDrop/   ← authoritative XP / cosmetic / collection writer
functions/src/comeback/      ← authoritative comeback XP writer
```

The pure modules are imported by BOTH the client presentation layer and the
authoritative server writer. Identical to the existing Surge pattern.

## 3. Mystery Drop model — reuse, not parallel infrastructure

`MysteryDropDefinition` is modelled as a generic Event subtype
(`EventType = 'mystery_drop'`). It piggy-backs on the existing
`EventDefinition` `startsAt` / `endsAt` / `status` infrastructure so the
Event Engine does NOT grow parallel date-window logic. The mystery-drop-
specific payload lives under `metadata.mysteryDrop`.

Reward shapes (V1):
- `cosmetic_unlock` → immutable `users/{uid}/inventory/{itemId}` write
- `collection_item` → immutable collection ownership (same write target)
- `xp_bonus` → dedicated gamification event `MYSTERY_DROP_XP_AWARDED`

Deliberately NOT supported in V1:
- cash / wallet money
- random paid loot boxes
- purchasable chance mechanics
- direct spendable-point jackpots

## 4. Deterministic eligibility

Eligibility is resolved SERVER-SIDE inside the `processApprovedCompletion`
transaction (same read phase used for Surge). A drop is assigned to a
child through a stable hash on `(dropId, childId)` so:

- Same child + same drop definition ⇒ same eligibility result.
- No client-side `Math.random()`.
- Approval-required tasks only count after authoritative approval.

The idempotency anchor for the authoritative event is:

```
mystery-drop:{dropId}:child:{childId}
```

A duplicate processor run fails closed (`alreadyExists`).

## 5. Mystery Drop lifecycle

```
unavailable → available → discovered → unlock_condition_met → claimed → revealed
                                                                  → expired
```

State transitions are derived from authoritative documents, not client state:
- `mystery_drop_evidence/{dropId}__{childId}` — server-owned evidence
- `users/{uid}/inventory/{itemId}` — owned cosmetic / collection item

## 6. Expiration

If the qualifying `completedAt` falls in `[startsAt, endsAt)`, the drop
is eligible. `processingAt` is irrelevant to eligibility (mirrors Surge).
A drop that completes before `endsAt` but is processed later still awards.

## 7. Comeback Mission model

Comeback is USER-STATE-DERIVED. It is NOT a global EventDefinition. The
tier is computed on demand from `lastActiveAt` using family-local
calendar-day arithmetic. No persistent per-user mission document is
required — only an authoritative `comeback_evidence/{childId}_{localDate}_{tier}`
record for idempotency.

Tiers:
- `<1 day` → `none`
- `≥1 day, <3` → `return_1d` (no economic reward)
- `≥3 days, <7` → `return_3d` (+25 XP, fixed)
- `≥7 days` → `return_7d` (+50 XP, fixed)

`meaningful activity` is defined narrowly:
- authoritative task approval (`completion.status === 'approved'`)
- no foreground/lastActiveAt bumps from notification opens / re-renders

This keeps `lastActiveAt` semantics unchanged. The inactivity window
is computed at evaluation time using the child user's existing
`lastTaskCompletionApprovedAt` (a derived field written by the existing
approval pipeline). If absent → treated as `>=7d` for first evaluation.

## 8. Idempotency (comeback)

`comeback:{childId}:{missionLocalDate}:{tier}` — deterministic. Duplicate
processor runs are a no-op (`alreadyExists`).

## 9. Streak coupling

Comeback NEVER mutates `currentStreak` / `bestStreak`. A broken streak
remains broken per existing rules. Comeback XP is a separate auditable
event (`COMEBACK_MISSION_XP_AWARDED`).

## 10. Reversal semantics

- **Mystery Drop XP** → tied to a qualifying completion. Reversed when
  the underlying completion is reversed.
- **Mystery Drop cosmetic / collection ownership** → PERMANENT in V1.
  Once legitimately revealed, ownership is never revoked. Reasoning: UX
  confusion + simpler inventory history.
- **Comeback XP** → tied to the day's qualifying completion. Reversed
  when that completion is reversed.

## 11. Mascot / Notification presentation

- Mascot Engine: only `engagement.mysteryDrop.{available, readyToReveal}` is
  read; existing moods (`curious`, `shocked`, `celebrating`,
  `welcome_back`, `grumpy`, `suspicious`) are reused. NO new mascot
  engine.
- Notifications: new candidate type `mystery_drop` (priority 35 — below
  `streak` (20) and `family_progress` (30), above `seasonal` (40)). Same
  candidate, but added to the catalog with safe wording.
- Comeback Notification: new candidate type `comeback` (priority 45 — below
  `seasonal` (40), above `morning_brief` (50)).

Cap/dedupe/quiet-hours/preferences are inherited from existing
`NotificationDecisionContext`. No new scheduler.

## 12. Trust boundaries (security)

- Client cannot:
  - create `mystery_drop_evidence` or `comeback_evidence` (Rules reject).
  - write `users/{uid}/inventory` directly (Rules reject — already gated).
  - mint XP / points via the engagement path.
  - claim another child or another family's drop (Rules reject).
  - forge a qualifying completion timestamp.
- Analytics are best-effort and never block eligibility or reward.

## 13. Integration points summary

| Concern            | Reused module                                | New module                      |
|--------------------|----------------------------------------------|---------------------------------|
| Date windows       | `src/domain/experience/resolver`             | —                               |
| Eligibility hash   | —                                             | `src/domain/mysteryDrop/eligibility.ts` |
| Tier computation   | —                                             | `src/domain/comeback/eligibility.ts`    |
| XP ledger          | `src/domain/gamification/xp.ts` (extended)   | `MYSTERY_DROP_XP_AWARDED`, `COMEBACK_MISSION_XP_AWARDED` event types |
| Inventory          | `users/{uid}/inventory` (existing)           | `source: 'mystery_drop'` extended in catalog |
| Mascot             | `src/domain/mascot`                          | read-only context field added   |
| Notification       | `src/domain/notifications`                   | new candidate type              |
| Approvals          | `functions/src/gamificationRepository.processApprovedCompletion` | new inside-transaction evaluator hooks |

## 14. Order of operations (server)

Inside the existing `processApprovedCompletion` transaction (so atomic
with the base task reward):

1. Read base completion + family prefs + child (existing).
2. **Surge** evaluation (existing, unchanged).
3. **Mystery Drop** evaluation — picks eligible drops whose
   `unlockCondition` is satisfied by THIS completion. Awards XP via
   `MYSTERY_DROP_XP_AWARDED` and/or writes
   `users/{uid}/inventory/{itemId}`.
4. **Comeback** evaluation — if THIS completion satisfies the
   comeback mission for the local date, writes
   `COMEBACK_MISSION_XP_AWARDED` and a `comeback_evidence` doc.
5. V3 shadow apply (existing, unchanged).
6. Persist plan events (existing, unchanged).
7. Persist mirror / summary / feed / engagement hooks.

Failure of any bonus path is isolated and MUST NOT block the base
task award (mirrors the existing Surge contract). Each bonus path
has its own try/catch and diagnostic log.

## 15. Regression safety net

- No changes to Firestore Rules for existing collections.
- No new client write paths.
- `processApprovedCompletion` adds only additive try/catch blocks and
  additive plan-event creation — the base `effect` and projection math
  are untouched.
- Mascot / Notification resolvers remain pure and add optional context
  fields; existing call sites that don't pass them behave identically.