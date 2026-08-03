# Repository-local architecture rules

## `no-gamification-firestore`

Phase 0 guard for the Gamification V3 refactor
([`01-architecture.md`](../../docs/gamification-v3/01-architecture.md)). It prevents **new**
architectural violations from being introduced while V3 is implemented. It changes no runtime
behaviour and never auto-fixes.

### What it forbids in frontend code (`src/**`, excluding tests, `src/domain/**` and `src/services/gamification/**`)

| Kind | Forbidden |
|---|---|
| `firestore-import` | Importing `firebase/firestore` in a file that touches gamification paths |
| `summary-read` | Referencing `gamification_summaries` / `gamification_state` / `gamification_events` outside the approved data-access layer |
| `user-balance-read` | Reading `rewardPoints`, `lifetimeXP`, `xpTotal`, `weeklyPoints`, `weeklyXP`, `currentStreak`, `longestStreak`, `bestStreak`, `perfectDayCount` off a user/member object |
| `balance-write` | Writing any of those fields (or `level`) through `setDoc` / `updateDoc` / `transaction.update` |
| `gamification-arithmetic` | Arithmetic on gamification values inside `src/pages/**` or `src/components/**` |
| `weekly-from-completions` | Deriving a weekly leaderboard value from task completions |
| `local-level-formula` | Reimplementing the level or level-progress formula locally |

Values obtained from the approved read model (`const g = useGamification(id)`) may be formatted
freely — only the boundary is enforced, not the display.

### Files

| File | Purpose |
|---|---|
| `no-gamification-firestore.cjs` | The rule. Exports an ESLint-compatible `rule` object **and** a pure `analyze(filename, source)` function. Zero dependencies. |
| `lint-gamification.cjs` | CI runner: applies the rule across the frontend and enforces the allowlist. |
| `gamification-allowlist.json` | The shrink-only allowlist of pre-existing violations. |
| `no-gamification-firestore.test.ts` | Structural tests for the rule. |
| `allowlist.consistency.test.ts` | Inventory ↔ allowlist consistency tests. |

### Running

```bash
npm run test:gamification-architecture   # rule tests + consistency tests + lint gate
node tools/eslint-rules/lint-gamification.cjs --json
```

### The allowlist is shrink-only

The allowlist records the violations that existed at the Phase 0 baseline. CI fails if:

- a violation appears in a file that is not allowlisted;
- an allowlisted file gains a violation *kind* it is not allowlisted for;
- the number of entries exceeds `baselineEntryCount`;
- an entry is stale (its violation has been fixed — delete the entry);
- an entry lacks an inventory reference or a valid removal phase, is a wildcard, is duplicated,
  or points at a missing file.

**Never add an entry.** Fix the violation, or route the access through
`src/services/gamification/`.

### Using it from ESLint

The rule object is a standard ESLint rule and can be registered in a flat config without
modification once ESLint is adopted:

```js
import rules from './tools/eslint-rules/no-gamification-firestore.cjs'
import allowlist from './tools/eslint-rules/gamification-allowlist.json' with { type: 'json' }

export default [
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { architecture: { rules: { 'no-gamification-firestore': rules.rule } } },
    rules: {
      'architecture/no-gamification-firestore': ['error', { allowlist: allowlist.entries }],
    },
  },
]
```

The repository currently lints with `oxlint`, which does not load custom JavaScript rules, so
the gate runs through `lint-gamification.cjs`. The enforcement logic is identical — both call
the same `analyze()`.
