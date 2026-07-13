# Legacy Wallet Compatibility Design

## Goal

Make `families/{familyId}/wallets/{uid}.balance` the canonical balance for every financial operation without losing balances that still exist only in `users/{uid}.walletBalance`.

## Canonical contract

A dedicated `walletCompatibility` module owns transaction-scoped wallet resolution. Callers must preload the target user and wallet snapshots before any transaction write. This preserves Firestore's read-before-write requirement for operations involving multiple wallets.

For an existing wallet, the helper requires an integer `balance` and returns it unchanged. It never consults or overwrites from the legacy profile field. For a missing wallet, it requires an existing same-family child profile. A present `walletBalance` must be an integer and is preserved exactly; a genuinely absent field initializes the wallet at zero. Invalid present values are rejected instead of silently converted to zero.

Managed status is identified only by `user.isManaged === true`. Missing authentication metadata, email, or other profile fields never imply that an account is managed and never change balance resolution.

The returned wallet contract supplies the canonical reference and a write operation. For a missing wallet, that write includes `createdAt` and `migratedFromLegacy: true` in the same atomic operation as the financial delta. Existing wallets receive only the operation-specific fields.

## API integration

An idempotent `migrateWallet(familyId, childId)` API authenticates the caller, verifies parent/owner membership in the requested family, resolves the target through the shared contract, and creates only a missing wallet. Existing wallets are returned without mutation.

Every wallet-affecting API uses the same contract:

- financial behaviour events;
- manual deposit and withdrawal;
- manual child-to-child transfer;
- Pet Box donation approval;
- transfer-request approval;
- money-request approval; and
- wallet-affecting reversal.

Each operation preloads all user and wallet documents it may need before resolving any wallet. After resolution, calculations and writes use wallet-document balances only. No operation directly mutates `users/{uid}.walletBalance`.

Account-creation flows may still create a zero wallet directly because there is no legacy balance to migrate. Fund-only and reward-point-only operations are outside this contract.

## Rules and privacy

Firestore rules independently enforce the migration baseline. A standalone wallet create is allowed only to a parent or owner in the target family, only for a same-family child, and only with the exact legacy integer balance or zero when `walletBalance` is absent. The create payload is limited to the canonical migration fields and server timestamp.

Operation-linked missing-wallet creates remain tied to their request, ledger, and exact balance delta. Wallet-affecting reversals gain equivalent missing-wallet create validation when required.

Wallet reads remain parent/owner-or-self. Sibling wallet reads, collection reads by children, child self-writes, sibling writes, and wrong-family migration attempts remain denied. The compatibility API performs matching checks before writes, but rules remain authoritative.

## Error handling

The contract rejects missing profiles, wrong-family targets, non-child targets, malformed existing balances, and malformed present legacy balances with explicit errors. Financial APIs preserve their existing insufficient-funds and debt-limit behavior after canonical balance resolution.

## Testing

Unit tests cover existing-wallet precedence, exact legacy preservation, absent optional legacy field as zero, invalid present legacy values, and `isManaged`-only classification. Migration API tests cover parent, owner, child, wrong-family, existing wallet, missing wallet, and read-before-write behavior.

Traceability tests exercise every wallet-affecting API and assert that wallet documents—not user balance fields—receive the operation result. Emulator tests prove exact migration creates and denials for child, sibling, self-write, and wrong-family access. The final gate is the complete unit suite, Firestore rules suite, lint, and production build.
