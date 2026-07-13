# Legacy Wallet Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Atomically migrate legacy wallet balances into canonical family wallet documents and require every wallet-affecting API to use the same compatibility contract.

**Architecture:** A focused `walletCompatibility` module validates preloaded profile/wallet snapshots and returns a canonical balance plus a migration-aware writer. API transactions preload all documents before resolving wallets, then perform only wallet-document balance writes. Firestore rules independently enforce exact legacy-or-zero creates and operation linkage.

**Tech Stack:** TypeScript 6, Firebase Web SDK transactions, Firestore Security Rules, Vitest, Firebase Rules Unit Testing.

## Global Constraints

- Preserve a present integer `users/{uid}.walletBalance` exactly when the wallet document is missing.
- Treat a genuinely absent optional `walletBalance` as zero for any valid same-family child.
- Existing wallet documents always take precedence over legacy profile data.
- Identify managed accounts only with `isManaged === true`; never infer managed status from missing auth, email, or profile fields.
- Children cannot read sibling wallet documents or write their own or sibling wallets directly.
- All transaction reads must occur before the first write.
- Do not directly mutate legacy `walletBalance` in financial operations.

---

### Task 1: Shared wallet compatibility contract

**Files:**
- Create: `src/lib/walletCompatibility.ts`
- Create: `src/lib/walletCompatibility.test.ts`

**Interfaces:**
- Consumes: preloaded Firestore-like user and wallet snapshots, a transaction, wallet reference, family ID, and user ID.
- Produces: `getOrMigrateWallet(input): WalletContract`, where `WalletContract` exposes `balance`, `existed`, `isManaged`, and `write(fields)`.

- [ ] **Step 1: Write failing contract tests**

```ts
it('preserves an exact legacy balance only when the wallet is missing', () => {
  const wallet = getOrMigrateWallet(input({ user: { familyId: 'f1', role: 'child', walletBalance: 25700 }, wallet: undefined }))
  expect(wallet.balance).toBe(25700)
  wallet.write({ balance: 25600 })
  expect(transaction.set).toHaveBeenCalledWith(walletRef, {
    balance: 25600, createdAt: timestamp, migratedFromLegacy: true,
  }, { merge: true })
})

it('uses zero for an absent optional field and rejects a malformed present field', () => {
  expect(getOrMigrateWallet(input({ user: { familyId: 'f1', role: 'child' }, wallet: undefined })).balance).toBe(0)
  expect(() => getOrMigrateWallet(input({ user: { familyId: 'f1', role: 'child', walletBalance: '10' }, wallet: undefined }))).toThrow('legacy walletBalance')
})

it('uses an existing wallet and identifies managed accounts only by isManaged true', () => {
  expect(getOrMigrateWallet(input({ user: { familyId: 'f1', role: 'child', walletBalance: 900 }, wallet: { balance: 125 } })).balance).toBe(125)
  expect(getOrMigrateWallet(input({ user: { familyId: 'f1', role: 'child' }, wallet: { balance: 0 } })).isManaged).toBe(false)
  expect(getOrMigrateWallet(input({ user: { familyId: 'f1', role: 'child', isManaged: true }, wallet: { balance: 0 } })).isManaged).toBe(true)
})
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/lib/walletCompatibility.test.ts`
Expected: FAIL because `walletCompatibility.ts` does not exist.

- [ ] **Step 3: Implement the contract**

```ts
export function getOrMigrateWallet(input: WalletCompatibilityInput): WalletContract {
  if (!input.userSnapshot.exists()) throw new Error('Wallet user not found')
  const user = input.userSnapshot.data()
  if (user.familyId !== input.familyId || user.role !== 'child') throw new Error('Wallet user must be a child in this family')
  const existed = input.walletSnapshot.exists()
  const balance = existed
    ? requireInteger(input.walletSnapshot.data().balance, 'wallet balance')
    : Object.prototype.hasOwnProperty.call(user, 'walletBalance')
      ? requireInteger(user.walletBalance, 'legacy walletBalance')
      : 0
  return {
    balance, existed, isManaged: user.isManaged === true,
    write(fields) {
      input.transaction.set(input.walletRef, {
        ...(!existed ? { createdAt: input.timestamp(), migratedFromLegacy: true } : {}),
        ...fields,
      }, { merge: true })
    },
  }
}
```

- [ ] **Step 4: Run GREEN**

Run: `npx vitest run src/lib/walletCompatibility.test.ts`
Expected: PASS.

### Task 2: Explicit migration API and exact rules

**Files:**
- Modify: `src/lib/api.ts`
- Create: `src/lib/api.walletCompatibility.test.ts`
- Modify: `firestore.rules`
- Create: `tests/firestore/walletCompatibility.rules.test.ts`

**Interfaces:**
- Consumes: `getOrMigrateWallet` from Task 1.
- Produces: `migrateWallet(familyId: string, childId: string): Promise<{ balance: number; migrated: boolean }>`.

- [ ] **Step 1: Write failing API and emulator tests**

```ts
it.each(['parent', 'owner'])('allows a same-family %s to migrate an exact legacy balance', async role => {
  // Seed actor, child walletBalance: 25700, and no wallet; call/commit exact migration.
  expect((await getDoc(walletRef)).data()?.balance).toBe(25700)
})

it('creates zero when walletBalance is genuinely absent', async () => {
  // Seed a same-family child without walletBalance.
  expect((await getDoc(walletRef)).data()?.balance).toBe(0)
})

it.each(['child', 'wrong-family-parent'])('denies %s migration', async actor => {
  await assertFails(setDoc(walletRef, exactMigrationPayload))
})
```

The API mock test must also assert that actor, child, and wallet reads all occur before `transaction.set`, existing wallets are returned without writes, and a child/wrong-family actor is rejected.

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/lib/api.walletCompatibility.test.ts`
Expected: FAIL because `migrateWallet` is not exported.

Run: `npx firebase emulators:exec --only firestore "npx vitest run tests/firestore/walletCompatibility.rules.test.ts"`
Expected: FAIL for at least one new exact authorization assertion before rules are aligned.

- [ ] **Step 3: Implement the migration API and rules**

```ts
export async function migrateWallet(familyId: string, childId: string) {
  const actorId = auth.currentUser?.uid
  if (!actorId) throw new Error('Not authenticated')
  return runTransaction(db, async transaction => {
    const [actor, child, wallet] = await Promise.all([
      transaction.get(doc(db, 'users', actorId)),
      transaction.get(doc(db, 'users', childId)),
      transaction.get(doc(db, `families/${familyId}/wallets`, childId)),
    ])
    if (!actor.exists() || actor.data().familyId !== familyId || !['parent', 'owner'].includes(actor.data().role)) throw new Error('Only a parent or owner in this family can migrate wallets')
    const resolved = getOrMigrateWallet({ transaction, familyId, userId: childId, userSnapshot: child, walletSnapshot: wallet, walletRef: doc(db, `families/${familyId}/wallets`, childId), timestamp: serverTimestamp })
    if (!resolved.existed) resolved.write({ balance: resolved.balance })
    return { balance: resolved.balance, migrated: !resolved.existed }
  })
}
```

Rules must keep `allow read: if isParent(familyId) || request.auth.uid == childId`, keep all direct child updates denied, and accept only `{balance, createdAt, migratedFromLegacy}` for standalone migration with exact legacy-or-zero balance.

- [ ] **Step 4: Run GREEN**

Run both Task 2 commands. Expected: PASS.

### Task 3: Route every wallet-affecting API through the contract

**Files:**
- Modify: `src/lib/api.ts`
- Modify: `src/lib/reversalApi.ts`
- Modify: `src/lib/api.traceability.test.ts`
- Modify: `src/lib/api.approvals.test.ts`
- Modify: `src/lib/reversalApi.test.ts`
- Modify: `firestore.rules`
- Modify: `tests/firestore/behaviour.rules.test.ts`
- Modify: `tests/firestore/transfers.rules.test.ts`
- Modify: `tests/firestore/approvalCenter.rules.test.ts`
- Modify: `tests/firestore/reversals.rules.test.ts`

**Interfaces:**
- Consumes: `getOrMigrateWallet` and its migration-aware `write` method.
- Produces: financial behaviour, deposit, withdrawal, manual transfer, Pet Box, transfer approval, money approval, and reversal paths that all preserve legacy balances and write canonical wallets.

- [ ] **Step 1: Add failing traceability tests**

For each API, seed a missing wallet and a same-family child with a distinctive legacy balance, invoke the operation, and assert the final wallet `transaction.set` contains the exact legacy balance plus its delta and migration metadata. Add an absent-field case that begins at zero. Add existing-wallet cases proving conflicting legacy data is ignored. The manual transfer and reversal tests must cover two missing wallets and enforce no read occurs after a write.

```ts
expect(walletWrite('child-1')).toEqual(expect.objectContaining({
  balance: legacyBalance + expectedDelta,
  migratedFromLegacy: true,
}))
expect(tx.update).not.toHaveBeenCalledWith(expect.objectContaining({ path: 'users/child-1' }), expect.objectContaining({ walletBalance: expect.anything() }))
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/lib/api.traceability.test.ts src/lib/api.approvals.test.ts src/lib/reversalApi.test.ts`
Expected: FAIL on financial behaviour, manual transfer, and reversal missing-wallet compatibility.

- [ ] **Step 3: Implement API routing**

In each transaction, preload every participant profile and wallet snapshot before resolving any contract. Replace raw `walletDoc.exists() ? balance : 0`, direct wallet `update`, and the old `ensureWalletDocument` helper with:

```ts
const wallet = getOrMigrateWallet({
  transaction, familyId, userId: childId, userSnapshot: childDoc,
  walletSnapshot: walletDoc, walletRef, timestamp: serverTimestamp,
})
wallet.write({ balance: wallet.balance + delta, operationPointer: operationId })
```

Use the actual pointer fields required by each rule: `lastPenaltyTxId`, `lastManualTxId`, `lastTransferTxId` plus `lastTransferReqId`, or `lastReversalId`.

- [ ] **Step 4: Extend operation-linked wallet-create rules**

Add exact create validators for missing-wallet financial penalties, both legs of manual transfers, and wallet reversals. Each validator must require the matching newly created ledger/event/reversal, exact actor, exact participant, exact pointer, and exact `legacyBalance + delta`. Expand the wallet create key allowlist only for the corresponding pointer fields.

- [ ] **Step 5: Run focused GREEN**

Run the Task 3 unit command and:

`npx firebase emulators:exec --only firestore "npx vitest run tests/firestore/behaviour.rules.test.ts tests/firestore/transfers.rules.test.ts tests/firestore/approvalCenter.rules.test.ts tests/firestore/reversals.rules.test.ts"`

Expected: PASS.

### Task 4: Full verification and implementation report

**Files:**
- Create: `.superpowers/sdd/stabilization-legacy-wallets-implementation.md`

**Interfaces:**
- Consumes: all prior tasks and their RED/GREEN evidence.
- Produces: auditable implementation and verification record.

- [ ] **Step 1: Run all verification commands**

```bash
npm test
npm run test:rules
npm run lint
npm run build
```

Expected: all commands exit 0. Existing non-failing React `act(...)` or Vite chunk warnings must be recorded accurately.

- [ ] **Step 2: Write the report**

Document the financial API audit table, shared contract, rules parity, authorization matrix, TDD RED/GREEN commands and counts, and full verification results in `.superpowers/sdd/stabilization-legacy-wallets-implementation.md`.

- [ ] **Step 3: Review scope and commit**

Run `git diff --check`, inspect every scoped diff, stage only the wallet compatibility files, and commit with:

```bash
git commit -m "fix: migrate legacy wallets atomically"
```
