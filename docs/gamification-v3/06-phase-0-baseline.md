# Gamification V3 — Phase 0 Baseline

Status: **Phase 0 artefact. Behaviour-neutral. No runtime code, data or deployment changed.**

This is the **shrink-to-zero baseline**. Every count below must be non-increasing for the rest
of the programme, and every count must reach its target before the phase named beside it can
be declared complete. CI fails if any of them grows.

Sources of truth for these numbers:

- [`05-current-state-inventory.md`](docs/gamification-v3/05-current-state-inventory.md:1) — the exhaustive occurrence table.
- `node tools/eslint-rules/lint-gamification.cjs --json` — the enforced counts.
- `node scripts/gamification-inventory.cjs --check` — proves the inventory is current.

---

## 1. Headline counts

| Metric | Count | Target | Target phase |
|---|---|---|---|
| Client-side gamification writers | 11 | 0 | Phase 3 |
| UI gamification calculations | 14 | 0 | Phase 4 |
| Direct UI Firestore / authoritative-field reads | 13 | 0 | Phase 4 |
| Legacy XP fallbacks | 5 | 0 | Phase 4 |
| Independent leaderboard calculations | 3 | 0 | Phase 4 |
| Duplicate authoritative-looking fields | 6 | 0 | Phase 6 |
| Server writer paths | 7 | 1 (the command pipeline) | Phase 2 |
| allowlist entries | 16 | 0 | Phase 4 |

The "client-side gamification writers" count is 7 balance mutations plus 4 field initialisers
(§2 of the inventory, rows W1–W11). "Duplicate authoritative-looking fields" counts the six
duplicated fields in §5 of the inventory; the seventh row there (`weeklyXP`) is a recomputed
value rather than a stored duplicate and is counted under leaderboard calculations.

---

## 2. Enforced violation counts (machine-measured)

Produced by the architecture gate at the Phase 0 commit:

```
$ node tools/eslint-rules/lint-gamification.cjs --json
```

| Violation kind | Count |
|---|---|
| `user-balance-read` | 57 |
| `local-level-formula` | 7 |
| `firestore-import` | 5 |
| `balance-write` | 2 |
| `summary-read` | 2 |
| `gamification-arithmetic` | 2 |
| `weekly-from-completions` | 1 |
| **Total** | **76** |

Files with violations: **16**. Allowlist entries: **16**. New (non-allowlisted) violations: **0**.

---

## 3. Raw inventory scale

From `node scripts/gamification-inventory.cjs`:

| Metric | Count |
|---|---|
| Gamification occurrences across the repository | 1863 |
| Files containing at least one occurrence | 147 |
| Occurrences classified `write` | 9 |
| Occurrences classified `initialise` | 36 |
| Occurrences classified `calculate` | 92 |
| Occurrences classified `read` | 333 |
| Occurrences classified `migrate` | 188 |
| Occurrences classified `test` | 1205 |
| Occurrences marked **REMOVE** | 124 |
| Occurrences marked **DERIVE** | 439 |
| Occurrences marked **MIGRATE** | 903 |
| Occurrences marked **KEEP** | 328 |
| Occurrences marked **TEMPORARY COMPATIBILITY** | 69 |

---

## 4. The allowlist at the Phase 0 baseline

16 entries, all pre-existing, all traceable to the inventory, all with a declared removal phase.
The allowlist may only shrink: CI fails if `entries.length > baselineEntryCount`, if a new
violation appears in a non-allowlisted file, if an allowlisted file gains a new violation kind,
or if an allowlist entry becomes stale.

| File | Violations | Removal phase |
|---|---|---|
| `src/lib/api.ts` | balance-write, firestore-import, user-balance-read | Phase 3 |
| `src/lib/reversalApi.ts` | balance-write, firestore-import, user-balance-read | Phase 3 |
| `src/lib/reversalHistory.ts` | user-balance-read | Phase 3 |
| `src/lib/behaviour.ts` | user-balance-read | Phase 3 |
| `src/lib/googleRedirectAuth.ts` | firestore-import | Phase 3 |
| `src/components/reversals/ReversalHistoryPanel.tsx` | user-balance-read | Phase 3 |
| `src/lib/bootstrapQueries.ts` | firestore-import, summary-read | Phase 4 |
| `src/lib/gamificationAdapters.ts` | local-level-formula, user-balance-read | Phase 4 |
| `src/lib/achievements.ts` | user-balance-read | Phase 4 |
| `src/pages/Family.tsx` | gamification-arithmetic, user-balance-read, weekly-from-completions | Phase 4 |
| `src/pages/MemberProfile.tsx` | user-balance-read | Phase 4 |
| `src/pages/Rewards.tsx` | user-balance-read | Phase 4 |
| `src/pages/Dashboard.tsx` | user-balance-read | Phase 4 |
| `src/components/dashboard/GamificationSummaryCard.tsx` | local-level-formula | Phase 4 |
| `src/components/parent/dashboard/ChildSummaryCard.tsx` | local-level-formula, user-balance-read | Phase 4 |
| `src/components/profile/ProfileEditorModal.tsx` | firestore-import, user-balance-read | Phase 4 |

Phase 3 clears 6 entries; Phase 4 clears the remaining 10 and the rule becomes absolute.

---

## 5. What Phase 0 does and does not change

Changed: four design documents, one inventory document, this baseline, one inventory generator
script, one architecture rule, one CI runner, one allowlist, two test files, one npm script.

Not changed: any `src/` runtime file, any `functions/` runtime file, `firestore.rules`,
`firestore.indexes.json`, any production data, any deployment. Runtime gamification behaviour
is byte-identical to the previous commit.

---

## 6. Exit condition

Phase 0 is complete when **no new gamification inconsistency can be introduced without CI
failing**. That is satisfied when all of the following hold:

1. `npm run test:gamification-architecture` is green and wired into the test pipeline.
2. The allowlist cannot grow (asserted by the gate and by a test).
3. Every allowlist entry cites the inventory and a removal phase (asserted by a test).
4. The inventory is provably current (`--check`).
5. A newly introduced violation in a non-allowlisted file fails the gate (asserted by a test).
