# Historical gamification XP backfill — dry-run report

Status: **awaiting review. Nothing has been executed against production.**

Script: `scripts/backfill-gamification-xp.ts` (pure logic) +
`scripts/backfill-gamification-xp.firestore.ts` (Firestore adapter / CLI).
Command used (read-only): `npm run gamification:backfill:dry-run`.

## 1. Post-cutover awarding is proven (emulator)

| Suite | Result |
| --- | --- |
| `tests/functions/gamification.integration.test.ts` | 15 passed |
| `tests/functions/gamificationOnboarding.integration.test.ts` | 4 passed |

Covered by those suites, on an approved completion created after the family's
cutover: `users.rewardPoints` increment, `gamification_summaries/{memberId}`
`xpTotal` increment, level recalculation, streak/perfect-day projection update,
occurrence + idempotency record creation, gamification event creation, and
`duplicate` on a repeated trigger with no second award.

Conclusion: **no processor defect was found.** The processor is untouched.

The production disposable-family verification (a throwaway family/member, never
Mnalium or a real child) remains an operator gate before any execute run.

## 2. Dry-run result (production, read-only)

```
mode: dry-run
familiesScanned: 42
membersScanned: 18
proposedWrites: 0
discrepancies: 0
written: 0
```

No member currently satisfies the conservative eligibility + reconciliation
rule, therefore **there is nothing safe to execute yet**.

Skip reasons observed:

| Skip reason | Members |
| --- | --- |
| `no_pre_cutover_history` | 14 |
| `completion_missing_reward_snapshot` | 4 (Alisya, Mostium, Mnalium, `izrLLHmy…/Child 1`) |

## 3. Why the affected children are blocked (family `5s4Npeu55wPphLCsGAMP`)

Most pre-cutover approved completions in this family were written **without any
time-of-approval reward snapshot** (`awardedPoints` absent and no
`gamificationEffectSnapshot`). Only the task's *current* `pointsReward` remains,
which is not authoritative because tasks can be edited after approval. The
script therefore refuses to reconstruct XP from it.

Read-only measurements (pre-cutover approved completions only):

| Child | legacy `lifetimeXP` | `rewardPoints` | summary `xpTotal` | pre-cutover approvals | with authoritative award | Σ authoritative | only current task reward | Σ current task reward | Σ all sources |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mnalium | 380 | 350 | 0 | 25 | 2 | 30 | 23 | 325 | 355 |
| Alisya | 86 | 71 | 0 | 15 | 5 | 51 | 10 | 110 | 161 |
| Mostium | 90 | 75 | 0 | 7 | 5 | 60 | 2 | 20 | 80 |

Even the most permissive reconstruction (authoritative award + current task
reward + positive behaviour XP) does **not** reconcile with the legacy counter
(355 ≠ 380, 161 ≠ 86, 80 ≠ 90). Copying `lifetimeXP` blindly is explicitly out of
scope, so all three are classified and reported instead of written.

Additional observation: this family's `gamificationMigration.status` is
`prepared` (cutover `2026-08-02`), not `active`.

## 4. Decision required before any execute run

One of the following must be approved explicitly:

1. **Do nothing** — leave the historical XP at 0 and let XP accrue only from
   post-cutover awards (current script behaviour; the dry-run stays at 0 writes).
2. **Approve a documented secondary source** — e.g. allow the task's current
   `pointsReward` for completions with no snapshot, accepting that it is a
   best-effort estimate, and decide how to treat the residual difference vs
   `lifetimeXP`.
3. **Approve `lifetimeXP` adoption for a named allow-list** of members, treating
   the legacy counter as authoritative for pre-cutover history only.

No option is implemented as a default. `rewardPoints` is never written under any
option, and streaks are always preserved.

## 5. Post-execution verification checklist (unchanged, still pending)

- rerun dry-run → zero remaining safe candidates;
- Mnalium: `rewardPoints` stays 350; `xpTotal` non-zero and explainable;
  level/progress match `xpTotal`; streak display and badge agree;
- same for the other affected children;
- no `rewardPoints` duplication anywhere;
- one new approved post-cutover task raises both spendable `rewardPoints` and
  `xpTotal`.
