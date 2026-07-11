# Task 3 Report — Firestore Security Rules

## Status

Complete. Phase 3 security rules and emulator tests are implemented with a captured RED/GREEN cycle.

## Exact rule diff summary

- Added `isBehaviourManager`, authorizing authenticated family members whose stored role is `parent` or `owner`.
- Added child membership/role validation through `isChildInFamily`.
- Added trimmed, minimum-three-character reason validation.
- Added creator identity and `createdByName` snapshot validation against the authenticated user's stored profile.
- Added exact behaviour-event key validation, scalar type checks, integer delta checks, event-type sign/zero rules, family-path equality, child membership, and timestamp validation.
- Changed behaviour events from broad parent writes to validated parent/owner creates only; updates and deletes are denied.
- Added exact `financial_penalty` ledger key/type validation, including required non-empty `behaviourEventId`, child membership, positive integer amount, reason, creator snapshot, and timestamp.
- Kept wallet ledger documents immutable after creation. Existing non-penalty ledger creation remains compatible.
- Removed child self-update access to `rewardPoints`, `lifetimeXP`, and `walletBalance`; parent/owner transaction updates remain authorized by the surrounding current rules.
- Preserved all pre-existing uncommitted `firestore.rules` changes in the working tree and constructed a Phase-3-only staged rules blob for the commit.

## Emulator tests

`tests/firestore/behaviour.rules.test.ts` contains 38 tests covering:

- family-member behaviour reads and cross-family read denial;
- valid parent and owner event creation;
- child and cross-family creation denial;
- positive, negative, and financial delta sign/zero rules;
- integer-only points, wallet deltas, and ledger amounts;
- short/blank reasons;
- forged creator IDs and creator-name snapshots;
- wrong family IDs, non-child/unknown targets, unknown event types;
- exact required/allowed keys and timestamp types;
- behaviour-event update/delete denial;
- valid financial-penalty ledger creation;
- required `behaviourEventId` and exact financial ledger shape;
- wallet-ledger update/delete denial;
- child direct write denial for all three protected balances;
- preservation of unrelated child self-service updates.

## RED output

Command (JDK 21 selected because the machine default is JDK 11):

```text
JAVA_HOME=/opt/homebrew/Cellar/openjdk@21/21.0.11/libexec/openjdk.jdk/Contents/Home \
PATH=/opt/homebrew/Cellar/openjdk@21/21.0.11/libexec/openjdk.jdk/Contents/Home/bin:$PATH \
npm run test:rules
```

Result before rule changes:

```text
Test Files  1 failed (1)
Tests       31 failed | 7 passed (38)
Duration    4.75s
Error: Script "vitest run tests/firestore" exited with code 1
```

Failures were the intended missing protections: invalid event/ledger shapes succeeded, event updates succeeded, and child reward-point/lifetime-XP updates succeeded.

An earlier invocation using the system-default JDK failed before tests because Firebase Tools requires Java 21 or newer; this was an environment error and is not counted as the TDD RED result.

## GREEN output

First GREEN result after minimal rules implementation:

```text
Test Files  1 passed (1)
Tests       38 passed (38)
Duration    3.40s
Script exited successfully (code 0)
```

Fresh final verification:

```text
Test Files  1 passed (1)
Tests       38 passed (38)
Duration    3.45s
Script exited successfully (code 0)
```

The exact Phase-3-only staged rules blob was also verified independently (using `FIRESTORE_RULES_FILE`) and passed all 38 tests in 4.09s.

## Build result

`npm run build` exited 0. Vite built 1,835 modules and generated the PWA output. Existing non-fatal warnings remain for mixed static/dynamic imports of `src/lib/api.ts` and a JavaScript chunk larger than 500 kB.

## Security confirmations

- Behaviour events are append-only: create is validated; update/delete are unconditionally denied.
- Wallet ledger entries are immutable: update/delete remain unconditionally denied.
- Children cannot directly modify `rewardPoints`, `lifetimeXP`, or `walletBalance`.
- Financial-penalty ledger entries require an event audit link and an authenticated creator ID/name snapshot.
- Parent/owner valid transaction writes remain authorized.

## Commits

- `7937970` — `security: enforce behaviour v2 writes`

## Concerns

- Firebase Tools requires JDK 21+, while the machine's default Java is JDK 11; rule-test invocations need the JDK 21 environment override unless the default is upgraded.
- Build warnings described above are pre-existing/outside Phase 3 and were not changed.
