# Stage A deployment record & Stage B revised dry-run (READ-ONLY)

Generated: 2026-08-03T20:29Z · Project `familyquest-beta-402cb`

**No repair writes have been executed. Nothing in Stage B has been applied.**

---

## 1. Stage A — verification and deployment

### 1.1 Permanent emulator E2E

New permanent suite: `tests/functions/gamificationSharedTask.e2e.test.ts` (5 passed),
driving the real repository/processor paths against the Firestore emulator.

| # | Scenario | Result |
|---|----------|--------|
| 1 | Shared task (no `assigneeId`), active child completes, parent approves | `processed`; `rewardPoints` +20 once; `xpTotal` equals the immutable ledger sum exactly; exactly one `xp_awarded` (20); level/progress recomputed via `levelProgressForXp`; 1 occurrence; retry → `duplicate`; sibling untouched |
| 2 | Explicitly assigned task | Matching child → `processed` (+20). Different child → `{ status: 'failed', reason: 'task_assigned_to_another_child' }` plus a deterministic dead-letter at `families/{f}/gamification_processor_failures/{completionId}` |
| 3 | Positive behaviour +20 | Client writes only the behaviour event (balances unchanged before processing); `onBehaviourEventCreated` path → `rewardPoints` +20, `summary.xpTotal` +20, `users.lifetimeXP` mirror +20, exactly one `behaviour_positive` event; retry → `duplicate` |
| 4 | Negative behaviour | `rewardPoints` −5 then clamped at 0 for −100; `xpTotal` and `lifetimeXP` never decrease; all `behaviour_negative` events carry `xpDelta: 0` |
| 5 | Daily eligibility | `taskWeights = { shared: 20, mine: 10 }`, `eligiblePoints: 30` — shared task included, the sibling's assigned task excluded |

### 1.2 Gate results

| Gate | Result |
|------|--------|
| Full test battery (`npm test`) | 162 files / 1723 tests green (two stale `MemberProfile` i18n assertions were corrected to the shipped progression labels) |
| Functions unit suites (`vitest --dir functions/src`) | 18 files, 303 passed, 6 skipped |
| Shared-task + onboarding integration (emulator) | 2 files, 19 passed |
| Permanent emulator E2E | 5 passed |
| `npm --prefix functions run build` | pass |
| `npm run typecheck` / `npm run build` | pass |
| `git diff --check` | clean |
| Firestore Rules | **not deployed** (as instructed) |

### 1.3 Deployment

- Deployed commit SHA: **`b37c8eeb2f8133c62d6d1690ca6348a4dc5eade1`** (branch `todo-theme`;
  functional fix in `3c59a93894997567ce172272d67e8944ed87752f`)
- Cloud Build for all four functions: `94c925c0-ccb6-4cf4-8dae-01904c8eec8a`
- Functions hash: `583c1ae2909166daaf666a7b7e92970b9eb8641f`

| Function | Revision | Update time (UTC) |
|----------|----------|-------------------|
| `onTaskCompletionWritten` | `ontaskcompletionwritten-00010-cim` | 2026-08-03T20:23:05.649Z |
| `onGamificationReversalCreated` | `ongamificationreversalcreated-00010-sid` | 2026-08-03T20:23:05.731Z |
| `finalizeGamificationDays` | `finalizegamificationdays-00010-cor` | 2026-08-03T20:23:06.053Z |
| `onBehaviourEventCreated` | `onbehavioureventcreated-00001-det` (new) | 2026-08-03T20:23:13.882Z |

Hosting (required, because `src/lib/api.ts` no longer writes client balances):

- Site `familyquest-beta-402cb`
- Version `projects/883349088062/sites/familyquest-beta-402cb/versions/b55b15dbd8af2f99`
- Release `.../channels/live/releases/1785788599899000`, released 2026-08-03T20:23:19.899Z

---

## 2. Post-deploy verification

1. **Disposable emulator family** — `scripts/verify-deployed-build-contract.cjs` runs against the
   *compiled* artefact that was uploaded (`functions/lib/**`), in a throwaway project id and family:
   shared-task award `processed`/`duplicate` with `rewardPoints 20`; behaviour `processed`/`duplicate`
   with `rewardPoints 20`, `lifetimeXP 20`, `xpTotal 20` (no divergence). **PASS.**
2. **Production read-only scan** — `scripts/scan-post-deploy-approvals.cjs --since=2026-08-03T20:23:20Z`:
   `approvalCount: 0`, `behaviourCount: 0`, `processorFailures: []`.
   No new production traffic has occurred since the deploy, so contracts 3 and 4 hold vacuously;
   they are proven only on the disposable emulator so far and should be re-run after real traffic.
3. No test records were created in any real family.

---

## 3. Stage B — post-baseline ledger (read-only, `scripts/reconcile-xp-ledger.cjs`)

Identity used for every member:

```
current summary.xpTotal − legacy baseline event xpDelta = post-baseline XP already represented
```

Baseline events (`legacy_xp_baseline:{familyId}:{childId}`) all carry `rewardPointsDelta: 0`,
so they explain XP only, never spendable points.

| Member | rewardPoints | lifetimeXP | xpTotal | baseline xpDelta | post-baseline XP represented | XP explained by non-baseline events | **Unattributed XP** | legacy-vs-projection gap |
|--------|-------------:|-----------:|--------:|-----------------:|-----------------------------:|------------------------------------:|--------------------:|-------------------------:|
| Alisya (`NuyIJDP…ur5N2`) | 81 | 86 | 171 | 86 | **85** | 85 | **0** | −85 |
| Mostium (`T7ZsdaN…DZE13`) | 75 | 90 | 90 | 90 | 0 | 0 | **0** | 0 |
| Mnalium (`vc0iyHV…JEkp2`) | 370 | 400 | 380 | 380 | 0 | 0 | **0** | **+20** |
| Omar Serdar (Blackirons) | 5 | 0 | 5 | 0 (none) | 5 | 5 | **0** | −5 |
| Child 1 (`izrLLHmy…`) | 50 | 50 | 50 | 50 | 0 | 0 | **0** | 0 |
| All other members (13) | 0 | 0 | 0 | 0 | 0 | 0 | **0** | 0 |

Every member's XP is fully attributable: **unattributed XP is 0 everywhere.** Therefore a
missing occurrence/event now *is* corroborated evidence rather than the sole evidence — the
projection contains no unexplained XP that could silently already include a candidate.

### 3.1 Alisya — why `xpTotal` is 171

`171 = 86 (baseline) + 85 post-baseline`, and the 85 is explained exactly by four events:

| Event id | Type | xpDelta | Effective |
|---|---|---:|---|
| `task_xp:task_v1\|NuyIJDP…\|ReAhu…\|2026-08-03` | `xp_awarded` (Duo lingo) | 10 | 2026-08-03T19:35:40.960Z |
| `daily_goal:5s4Npeu…:NuyIJDP…` | `daily_goal_awarded` | 25 | 2026-08-03T19:35:40.960Z |
| `perfect_day:5s4Npeu…:NuyIJDP…` | `perfect_day_awarded` | 50 | 2026-08-03T19:35:40.960Z |
| 4 × `*_qualification_changed` | state transitions | 0 | — |

Total 10 + 25 + 50 = **85**. Reward points: baseline 71 + the single processed Duo lingo award
(`awardedPoints: 10`) = **81** = current balance. So the 70 points of the seven previously listed
candidates are absent from **both** sides. (One of the original seven — Duo lingo, 2026-08-03T19:35:40Z —
is now proven **already applied**: it has an occurrence, an effect snapshot, `processedAt` and
`awardedPoints: 10`. It must not be repaired.)

### 3.2 Mnalium

- `rewardPoints 370 = 350 (post-baseline start) + 20` → the "bug report" behaviour's **points side is
  already applied** by the old client path.
- `lifetimeXP 400` vs `baseline 380` → legacy mirror gained +20 that the projection never received:
  the gap of **+20** is exactly the "bug report" behaviour of 2026-08-03T19:36:36.461Z (post-cutover,
  no projection event, no `gamificationProcessedAt`).
- The two July "+100" positive behaviours (Math Top Set, Science top set) are **pre-cutover** and are
  inside the adopted baseline of 380 → already applied, never to be repaired.
- "Riding bike 30 miny" (20 pts, approved 2026-08-03T19:46:45.038Z, shared task) has no occurrence,
  no event, no snapshot, no `processedAt`, no `awardedPoints`; its 20 points are not in the 370
  balance and its 20 XP are not in the 380 projection → absent on both sides.

### 3.3 Mostium

`xpTotal 90 = baseline 90`, gap 0, unattributed 0, zero post-cutover unapplied completions.
His only positive behaviour ("Test", +10, 2026-07-30) is **pre-cutover** and therefore already
represented inside the baseline. **No repair candidates.**

### 3.4 Every other candidate member

All remaining members have `xpTotal = baseline` (or 0) with unattributed XP 0 and no post-cutover
unprocessed completion, except Omar Serdar (Blackirons) whose single completion is proven applied
(occurrence + snapshot + `processedAt` + `awardedPoints: 5`).

---

## 4. Revised dry-run — repair groups

### Group A — task completions definitely absent from both balances

Deterministic identity for every one of these: the deployed processor derives occurrence
`{childId}__{taskId}__{dayKey}` and event `task_xp:task_v1|{childId}|{taskId}|{dayKey}`, created with
`transaction.create`, so replay can never double-award. Proposed mechanism: stamp
`sharedTaskAwardRepairV1` on the completion so `onTaskCompletionWritten` replays it once.

| # | Member | Completion | Task | rewardPointsDelta | xpDelta | Evidence |
|---|--------|-----------|------|------------------:|--------:|----------|
| A1 | Alisya | `Nuy…__QhCM9J5qbWYa1QGfQnYx__2026-08-03` | Cat food reloading | +5 | +5 | shared task, post-cutover 19:35:47Z, no occurrence/event/snapshot/processedAt/awardedPoints; unattributed XP 0 |
| A2 | Alisya | `Nuy…__W8EVEBwG8LvMBhBFjGK3__2026-08-03` | Reading Book 30 minutes | +30 | +30 | as above, 19:36:38Z |
| A3 | Alisya | `Nuy…__nJybubHDICMMJ1LuFMxN__2026-08-03` | Taking Laundry Upstairs | +5 | +5 | as above, 19:41:43Z |
| A4 | Alisya | `Nuy…__vwTyJHofSG1IfLiJuMDc__2026-08-03` | Put pajamas in the drawer | +10 | +10 | as above, 19:36:03Z |
| A5 | Alisya | `Nuy…__wMoDwTOoUAkgqpjBtL6U__2026-08-03` | Brush teeth morning | +10 | +10 | as above, 19:36:01Z |
| A6 | Alisya | `Nuy…__xzSLSQeo0izEncCprMe8__2026-08-03` | Change your pajamas | +10 | +10 | as above, 19:36:04Z |
| A7 | Mnalium | `vc0…__c3WmeyXGkvhwVe7mWTiq__2026-08-03` | Riding bike 30 miny | +20 | +20 | shared task, 19:46:45Z, no trace; 370 = 350 + behaviour 20 leaves no room for it |

Before → after (task side only): Alisya `rewardPoints 81 → 151`, `xpTotal 171 → 241` (+70/+70,
before any day-bonus recomputation the processor may legitimately add);
Mnalium `rewardPoints 370 → 390`, `xpTotal 380 → 400`.

> Note: replaying these through the real processor may additionally (and correctly) award
> `daily_goal_*` / `perfect_day_*` bonuses for 2026-08-03. That is product-correct but means the
> final xpTotal may exceed the flat +70 / +20. Confirm whether bonuses should be recomputed or
> suppressed before execution.

### Group B — behaviour events partially applied (legacy/user balances only), missing from the projection

The deployed `onBehaviourEventCreated` handles only **future** events. Group B needs a separate,
idempotent projection-only reconciliation.

| # | Member | Behaviour event | Type | rewardPointsDelta | xpDelta | Proposed deterministic event id |
|---|--------|-----------------|------|------------------:|--------:|---------------------------------|
| B1 | Mnalium | `SXkg6R4vxWTJowdJXdLA` ("bug report", 2026-08-03T19:36:36.461Z) | positive +20 | **0** | **+20** | `behaviour_xp_backfill:SXkg6R4vxWTJowdJXdLA` |

Why each delta is safe:
- `rewardPointsDelta 0` — 370 = 350 + 20 proves the points side is already applied; re-applying
  would double-credit.
- `xpDelta +20` — `lifetimeXP 400 − baseline 380 = +20` legacy-only XP with no projection event,
  and unattributed XP is 0, so the projection provably lacks it.
- Duplicate prevention: `transaction.create` on a deterministic id distinct from the live pipeline's
  `behaviour_xp:{id}`; the migration event must also stamp `gamificationProcessedAt` on the
  behaviour event so the live pipeline treats it as already processed. No feed or notification is
  written (the original client already produced those).

Expected Mnalium outcome after A7 + B1: `rewardPoints 370 → 390`, `xpTotal 380 → 420` — matching the
expectation in the brief.

### Group C — already applied (must never be repaired)

- Alisya: Duo lingo `2026-08-03T19:35:40.960Z` (occurrence + snapshot + `processedAt` + `awardedPoints 10`)
  and all 14 pre-cutover completions (inside baseline 86).
- Mnalium: all 25 pre-cutover completions; both July "+100" behaviours; the points side of B1.
- Mostium: all 7 completions and the pre-cutover "+10" behaviour.
- Omar Serdar (Blackirons): "Maths Practice" (fully processed by the live pipeline).
- Every negative/financial behaviour: no XP impact by rule.
- **The pre-cutover 95 points are NOT included anywhere in Groups A or B.**

### Group D — ambiguous / skipped

Empty. Because unattributed XP is 0 for every member, no candidate is unprovable in either
direction; nothing is being proposed on the strength of missing documents alone.

---

## 5. Reproduction commands (all read-only)

```bash
node scripts/reconcile-xp-ledger.cjs                              # full ledger, all families
node scripts/reconcile-xp-ledger.cjs --family=5s4Npeu55wPphLCsGAMP
node scripts/scan-post-deploy-approvals.cjs --since=2026-08-03T20:23:20Z
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/verify-deployed-build-contract.cjs
```

**Stage B remains unexecuted and awaits explicit approval.**
