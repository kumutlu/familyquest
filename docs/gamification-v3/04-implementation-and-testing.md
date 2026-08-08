# Gamification V3 — Implementation Phases & Testing Strategy

---

## 1. Implementation phases

Each phase is independently shippable and independently revertible. Every phase states an
**Entry** criterion (what must already be true before work starts) and an **Exit** criterion
(what must be demonstrably true before the next phase may begin). A phase may not start until
the previous phase's Exit criterion is met.

### Phase 0 — Audit lock (no behaviour change)
- Machine-generated inventory of every gamification read/write (extends the audit in `01-architecture.md`).
- Add a **failing-by-default** ESLint rule `no-gamification-firestore` with an explicit allowlist of today's offenders. The allowlist may only shrink; CI fails if it grows.
- Entry: these four design documents are approved and committed; `main` is green.
- Exit: inventory reviewed and committed as [`05-current-state-inventory.md`](docs/gamification-v3/05-current-state-inventory.md:1); rule merged; `npm run test:gamification-architecture` green in CI; baseline counts recorded in [`06-phase-0-baseline.md`](docs/gamification-v3/06-phase-0-baseline.md:1); runtime behaviour unchanged.

### Phase 1 — Ledger + reducer (dark)
- Entry: Phase 0 exit met; the allowlist is frozen at its baseline size.
- `GamificationEventV3` types and Zod-style validators.
- Reducer extended from [`engine.ts`](src/domain/gamification/engine.ts:506) to fold `rewardPointsDelta`, `weeklyPointsDelta`, badges, daily goals, rank.
- Write `gamification_state` **shadow** documents; nothing reads them.
- Rules: new collections locked to Admin SDK; `gamification_summaries` becomes read-only.
- Exit: shadow state matches legacy values for >99% of members; divergences triaged.

### Phase 2 — Command handlers
- Entry: Phase 1 exit met; shadow projection running for at least one full week including a `WEEK_ROLLOVER`.
- Six callables in `functions/src/gamification/commands/`.
- Each appends to the ledger and updates the projection in one transaction.
- **Legacy mirror** writes `users.rewardPoints`/`lifetimeXP` from the projection so old clients stay correct.
- Exit: emulator tests green for all six commands including reversal.

### Phase 3 — Client writes switch to callables
- Entry: Phase 2 exit met; the legacy mirror is verified to keep `users.*` byte-equal to the projection.
- [`redeemReward`](src/lib/api.ts:1022), [`claimChallenge`](src/lib/api.ts:967), [`unlockAvatar`](src/lib/api.ts:3089), behaviour logging, task approval, and [`reversalApi`](src/lib/reversalApi.ts:116) call commands instead of mutating balances.
- Delete client-side balance maths in [`behaviour.ts`](src/lib/behaviour.ts:60) (server owns it).
- Exit: zero client writes to gamification fields observed in production logs for 48 h.

### Phase 4 — Single reader
- Entry: Phase 3 exit met; the ledger is the only source of new gamification deltas.
- Ship `useGamification` / `useFamilyGamification`.
- Convert screens in this order (lowest → highest risk): Achievements/Badges → Profile → Child Home → Parent Dashboard → Rewards → Family/Leaderboard → Settings.
- Delete `resolveProgression`, `adaptGamificationSummary`, `levelFromXp`, `xpProgressInLevel`; delete `membersWithWeeklyXP` and `totalFamilyXP` from [`Family.tsx`](src/pages/Family.tsx:59).
- ESLint allowlist reaches empty; the rule becomes absolute.
- Exit: golden test passes.

### Phase 5 — Migration
- Entry: Phase 4 exit met; ESLint allowlist is empty; a full export of `users` + `gamification_summaries` exists.
- Run `scripts/gamification-v3-migrate.ts` in dry-run, review divergence report, then execute per family cohort (internal → 5% → 50% → 100%).
- Exit: verification green for the whole estate.

### Phase 6 — Legacy deletion
- Entry: Phase 5 exit met; 7 consecutive days of green verification across the whole estate; no quarantined families.
- Remove the mirror, delete the six `users` fields, drop `gamification_summaries`, delete `TODO(gamification-legacy-fallback)`.
- Exit: repo grep for `lifetimeXP` returns only migration history and this document.

---

## 2. Testing strategy

### 2.1 Unit (pure, fast)
- Reducer property tests: **ledger permutation invariance** (stable sort ⇒ same result), **reversal cancellation** (`E + reverse(E) == ∅`), **non-negativity**, **replay idempotency** on duplicate `idempotencyKey`.
- Formula tests already present in [`level.test.ts`](src/domain/gamification/level.test.ts:1), [`xp.test.ts`](src/domain/gamification/xp.test.ts:1), [`streak.test.ts`](src/domain/gamification/streak.test.ts:1) — extended to reward and weekly points.

### 2.2 Rebuild-equality test (the anti-drift guard)
```
for each fixture family:
  live  = state after replaying commands
  rebuilt = reducer(all events)          // summaries deleted first
  assert deepEqual(live, rebuilt, ignore: ['updatedAt'])
```

### 2.3 Rules tests (emulator)
Child raising own points → denied. Parent writing another member's state → denied. Any client write to `gamification_events` → denied. Admin SDK → allowed.

### 2.4 Architecture tests (make regression impossible)
- `no-gamification-firestore` ESLint rule, allowlist empty.
- Grep test: no `lifetimeXP` outside migration code.
- Grep test: no arithmetic operators applied to `rewardPoints`/`xpTotal`/`weeklyPoints` outside `src/domain/gamification/` and `functions/src/gamification/`.

### 2.5 Golden end-to-end test (Part 11)

`tests/e2e/gamification-golden.spec.ts` — **blocks the build on any mismatch.**

Scenario:
```
create family → create child → approve 3 tasks → log 1 positive + 1 negative behaviour
→ redeem a reward → reverse that redemption → hard refresh → logout → login
→ open: Profile, Dashboard, Leaderboard, Family, Rewards, Achievements, Badges,
        Child Home, Parent Home, Settings
```

Assertion: for each of
`Reward Points`, `XP`, `Weekly Points`, `Level`, `Progress`, `Current Streak`, `Best Streak`, `Leaderboard Position`

collect the rendered value from **every** screen that displays it via a stable `data-gamification="<field>"` attribute, then:

```ts
const values = await collectAll(field);          // one entry per screen
expect(new Set(values).size).toBe(1);            // all screens identical
expect(values[0]).toBe(expectedFromLedger[field]); // and correct vs the ledger
```

Also asserts: reversal returns points to the pre-redemption value exactly; values survive refresh and re-login unchanged; deleting the projection and rebuilding changes nothing on screen.

A missing `data-gamification` attribute on a screen that shows a gamification value is itself a failure, detected by a coverage assertion listing required (screen, field) pairs.

### 2.6 Production monitoring
- Nightly rebuild-and-compare across all families; alert on any checksum mismatch.
- Dashboard: events/day by type, projection lag p95, command error rate, count of quarantined members.

---

## 3. Definition of done

1. One writer: six callables, zero client gamification writes.
2. One reader: `useGamification`, zero direct Firestore reads in components.
3. One copy of every value; `users` gamification fields deleted.
4. Deleting all projections and rebuilding changes nothing.
5. Leaderboard reads `weeklyPoints` only.
6. Golden test green; ESLint allowlist empty.

---

## 4. Approval gate

**APPROVED.** Phase 0 only is authorised: inventory + ESLint rule + CI gate. Phase 0 is
behaviour-neutral and immediately stops the problem from spreading. No further phase may
begin until the Phase 0 exit criterion above is met and separately approved.
