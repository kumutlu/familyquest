# FamilyQuest Stage 1 Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the existing Family Settings, locale, currency, and Transaction History working tree into small production-safe commits without deploying or losing user work.

**Architecture:** Family settings reuse the existing Firestore client transaction and owner-only rule model. Currency is represented by an ISO code resolved through one pure compatibility helper. Transaction History remains a separate adapter-driven feature and is integrated only when every completion gate passes.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Vitest, i18next, Firebase Web SDK, Firestore Rules.

## Global Constraints

- Do not deploy until all requested work is complete and verified.
- Do not discard any pre-existing user work or use destructive Git commands.
- New family writes persist `currencyCode` only; legacy `currency` is read-only compatibility data.
- Currency resolution order is valid `currencyCode`, legacy `currency`, then `GBP`.
- Monetary values remain integer minor units.
- English and Turkish changed namespaces require exact recursive key parity.
- Transaction History UI must be routed, tested, typed, browser-global-free, and building before it may enter a production-ready commit.
- Every commit must be independently coherent and pass its scoped checks.

---

### Task 1: Locale parity and copy corrections

**Files:**
- Modify: `src/i18n/locales/en/{common,family,goals,rewards,settings,wallet}.json`
- Modify: `src/i18n/locales/tr/{common,family,goals,rewards,settings,wallet}.json`
- Modify: `src/i18n/i18n.test.ts`
- Modify: `src/i18n/types.ts` only if a changed namespace type requires it

**Interfaces:**
- Produces: recursive locale-key parity invariant for every `NAMESPACES` entry.

- [ ] Add a failing test that recursively flattens every EN/TR namespace and expects identical sorted key arrays; assert the two corrected Turkish `ailede` strings.
- [ ] Run `npx vitest run src/i18n/i18n.test.ts` and confirm the test fails for the current key mismatch/typos.
- [ ] Translate missing Turkish values, fix the two `aidede` typos, remove duplicate JSON keys, and remove only keys proven unused with `rg`.
- [ ] Run `npx vitest run src/i18n/i18n.test.ts src/i18n/phase2e.i18n.test.ts` and confirm all pass.
- [ ] Run `npx tsc -b --pretty false`, `git diff --check`, and `npm run build`; classify any remaining error against the recorded baseline.
- [ ] Commit only locale/test files as `chore(i18n): align English and Turkish locale keys`.

### Task 2: Shared child colour configuration

**Files:**
- Create: `src/config/childColours.ts`
- Create: `src/config/childColours.test.ts`
- Modify: `src/components/family/EditMemberModal.tsx`
- Modify: `src/components/family/AddChildModal.tsx`
- Modify: `src/pages/ChildOnboarding.tsx`

**Interfaces:**
- Produces: `CHILD_COLOUR_SWATCHES` as a readonly typed array and `ChildColour` inferred from it.

- [ ] Add a failing test asserting the canonical swatch order, unique values, and readonly exported shape.
- [ ] Run `npx vitest run src/config/childColours.test.ts` and confirm the missing-module failure.
- [ ] Implement the typed constant and replace all three local arrays with imports; remove unused `Loader2` and dead local helpers from `AddChildModal`.
- [ ] Run the colour test plus `ChildOnboarding` and Family Settings tests.
- [ ] Run TypeScript, build, and `git diff --check`.
- [ ] Commit only these files as `refactor(family): share child colour options`.

### Task 3: Canonical currency compatibility helper

**Files:**
- Modify: `src/i18n/format.ts`
- Modify: `src/i18n/i18n.test.ts` or create `src/i18n/format.currency.test.ts`
- Modify currency consumers in `src/pages/Wallet.tsx`, `src/pages/Wallets.tsx`, `src/pages/Goals.tsx`, `src/pages/GoalDetail.tsx`, `src/pages/Rewards.tsx`, `src/pages/FundsDashboard.tsx`, and relevant wallet/goal/reward components.

**Interfaces:**
- Produces: `type SupportedCurrencyCode = 'GBP' | 'EUR' | 'USD' | 'TRY'`.
- Produces: `resolveFamilyCurrencyCode(family?: { currencyCode?: unknown; currency?: unknown }): SupportedCurrencyCode`.
- Consumes: `formatPence(pence, currencyCode, locale)` without changing integer minor units.

- [ ] Add failing tests for valid GBP, valid TRY, legacy symbols/codes, invalid values, missing values, and unchanged integer-pence formatting.
- [ ] Run the focused currency test and confirm failures precede implementation.
- [ ] Implement strict code validation and deterministic legacy normalization.
- [ ] Replace direct family symbol fallbacks in Wallet, Goals, Rewards, Funds, and History-facing components with the shared resolver.
- [ ] Run focused Wallet/Goals/Rewards tests, TypeScript, build, and `git diff --check`.
- [ ] Keep these changes uncommitted until Task 4 so no consumer imports an unavailable Family Settings API.

### Task 4: Complete Family and regional settings

**Files:**
- Modify: `src/lib/api.ts`
- Modify: `src/lib/api.familyCreation.test.ts` or create `src/lib/api.familySettings.test.ts`
- Modify: `src/components/family/FamilySettings.tsx`
- Modify: `src/components/family/AddChildModal.tsx`
- Modify: `src/pages/Settings.tsx`
- Modify: `src/config/navigation.ts`
- Modify: `firestore.rules` and focused rule tests only if the existing owner-only family rule does not already safely cover the allowlisted update.

**Interfaces:**
- Produces: `updateFamilySettings(familyId, updates)` using the existing Firestore API pattern and an explicit allowlist.
- Produces: `regenerateInviteCode(familyId)` using an existing transaction pattern.
- Consumes: `resolveFamilyCurrencyCode` from Task 3.

- [ ] Add failing API tests proving owner-oriented update payloads write `name`, `currencyCode`, `timezone`, and `weekStartsOn`, never legacy `currency`, and invite regeneration is transactional.
- [ ] Inspect existing transaction/callable/rule paths and implement the minimal compatible API operations without a parallel architecture.
- [ ] Remove dead `getFamilySettingsPath`, correct the Settings status comment, remove dead Add Parent state, and implement the existing invite-code explanation/copy UI.
- [ ] Persist selected GBP and TRY through `updateFamilySettings`; reset UI state from live family snapshots to prove reload compatibility.
- [ ] Run API tests, Family Settings tests, focused rule tests if rules changed, TypeScript, build, and `git diff --check`.
- [ ] Commit Tasks 3–4 coherent files as `feat(settings): complete family and regional settings`.

### Task 5: Strengthen Family Settings coverage

**Files:**
- Modify: `src/components/family/FamilySettings.test.tsx`
- Modify: `src/pages/Settings.test.tsx`

**Interfaces:**
- Verifies owner/parent/child visibility, child creation entry, supported Add Parent flow, GBP/TRY persistence, and snapshot-driven reload behavior.

- [ ] Replace the empty test with assertions and remove unused test variables/imports.
- [ ] Add role visibility assertions for owner, parent, and child.
- [ ] Add tests for Add Child modal entry and Add Parent invite-code behavior.
- [ ] Add persistence tests for GBP and TRY payloads plus re-render from updated store state.
- [ ] Run focused tests, TypeScript, build, and `git diff --check`.
- [ ] Commit test-only changes as `test(settings): cover family and regional settings`.

### Task 6: Implement the Transaction Adapter foundation

**Files:**
- Modify: `src/lib/transactionAdapter.ts`
- Modify: `src/lib/transactionAdapter.test.ts`
- Modify: `src/lib/transactionModel.ts` only for types required by real existing sources.

**Interfaces:**
- Produces implemented `adaptAllTransactions`, `filterTransactions`, `searchTransactions`, `groupTransactionsByDate`, `groupTransactionsByWeek`, and `groupTransactionsByMonth`.
- Consumes current wallet, reversal, goal-ledger, redemption, behaviour, petbox, transfer, and money-request source records.

- [ ] Repair fixtures so tests use real source schemas and contain no unused placeholders.
- [ ] Run the adapter suite and preserve the expected RED failures from the TODO skeleton.
- [ ] Implement normalization source-by-source with typed guards, stable newest-first sorting, and no browser globals.
- [ ] Implement filter, search, and date/week/month grouping as pure functions.
- [ ] Run adapter tests, all existing history-model tests, TypeScript excluding uncommitted UI only when necessary, and `git diff --check`.
- [ ] Commit model/adapter/tests as `test(history): verify transaction adapter behaviour` (or `feat(history): implement transaction adapter` if production implementation is the dominant diff).

### Task 7: Gate and integrate Transaction History UI

**Files:**
- Modify: `src/components/history/*.tsx`
- Create: `src/components/history/TransactionIcon.tsx`
- Create: `src/components/history/TransactionHistoryScreen.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/config/navigation.ts` or the appropriate Wallet entry component.
- Modify: `src/store/useStore.ts` only if an existing resource is not exposed to the resolver.

**Interfaces:**
- Consumes typed adapter source data and actual `rewards`, members, goals, funds, and current user from the store.
- Produces reachable `/history` route and a visible in-app navigation entry.

- [ ] Add failing screen tests for reachable routing, loading/error/empty states, reward resolution from store data, filtering/search, details opening, and negative amount presentation.
- [ ] Replace the broken `EmptyState` dependency with an existing shared state component or a scoped tested component.
- [ ] Remove `window.__REWARDS__`, duplicate icon renderers/imports, and feature-level `any`; add shared `TransactionIcon`.
- [ ] Wire the route and navigation entry and run screen/App/navigation tests.
- [ ] Run full unit tests, TypeScript, build, and `git diff --check`.
- [ ] If every gate passes, commit as `feat(history): integrate transaction history`.
- [ ] If any gate cannot safely pass, create a named preservation stash/branch containing only UI work, remove loose UI files from the production-ready tree without deleting the preserved copy, and report the preservation reference; do not make the feature commit.

### Task 8: Stage 1 verification checkpoint

**Files:** none unless a scoped regression fix is proven necessary.

- [ ] Run `git status`, `git diff --check`, `npx tsc -b --pretty false`, `npm test`, `npm run test:rules`, `npm run build`, locale parity, and relevant E2E tests.
- [ ] Compare every remaining failure with `/tmp/fq-stage1-unit.log` and `/tmp/fq-stage1-build.log`; fix only Stage 1 regressions.
- [ ] Record branch, starting/final SHA, commits/files, exact test counts, migrations/indexes, unfinished work, deployment safety, and cleanliness.
- [ ] Stop for the mandatory Stage 1 review checkpoint. Do not start Gamification Phase 1 and do not deploy.
