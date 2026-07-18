# Reversal Integrity Completion Design

## Goal

Make every supported reversal canonical, atomic, exact, and one-shot at both the client transaction and Firestore rules boundary; restore all reward redemption effects; and retain audited cancellation reasons with immediate UI reconciliation.

## Authority and canonical sources

The TypeScript dispatcher and Firestore rules will enforce the same closed source matrix. Each source kind has one allowed collection, entity type, terminal state, and record type:

- wallet transaction: `wallet_transaction` or `wallet_transfer`, never `type: reversal`, completed or inherently completed, and no foreign request link;
- fund transaction: `fund_transaction`, never `type: reversal`, completed or inherently completed, and no foreign request link;
- behaviour event: `behaviour_event` and completed/applied;
- task completion: `task_completion` and `approved`;
- reward redemption: `reward_redemption` and completed/redeemed;
- transfer request: `transfer_request`, `approved`, and `sourceRequestId == sourceId`;
- money request: `money_request`, `approved`, and `sourceRequestId == sourceId`;
- Pet Box request: `petbox_donation`, `approved`, and `sourceRequestId == sourceId`.

Missing snapshots retain the exact legacy error. All other ineligible sources fail before balance reads or writes. Approval-derived wallet/fund legs and prior reversal ledgers are rejected even if they carry a valid-looking effect snapshot.

## Atomic rules protocol

The deterministic reversal record remains the transaction anchor. Its create rule will require:

1. the record did not exist before the request;
2. the canonical source and exact inverse are valid;
3. the deterministic reversal event is created in the same request with exact fields;
4. every nonzero wallet, counter-wallet, fund, points, and reward-inventory inverse is present in the same request;
5. every required deterministic inverse ledger is created in the same request;
6. each affected target has the exact prior-to-after delta and `lastReversalId` marker.

Every target and inverse-ledger validator will independently require that the reversal record was absent before the request and exists after it. A completed record therefore cannot authorize a delayed or replayed balance mutation. Append-only record/event/ledger rules preserve immutable evidence.

## Reward inventory

Finite inventory consumption moves inside `redeemReward`'s transaction. The redemption snapshot records the exact applied inventory delta and reward ID. Unlimited rewards record no inventory delta. A reward reversal restores the exact inverse inventory amount in the same transaction as points, evidence, and the reversal record. Rules require the reward after-state and `lastReversalId` whenever the snapshot contains a nonzero inventory delta.

## Cancellation audit and reconciliation

`cancelPendingApproval` accepts a trimmed reason and writes `cancellationReason`, `cancelledBy`, `cancelledByName`, and `cancelledAt` together with the pending-to-cancelled status transition. Rules require the authenticated actor identity, request-time timestamp, nonempty reason, allowed exact changed fields, and unchanged financial/source fields for task, transfer, money-request, and Pet Box cancellations.

The normalized history model exposes stored or optimistic cancellation audit metadata. `HistoryActionControl` immediately replaces the action with a reason-bearing Cancelled badge. `ReversalHistoryPanel` keeps an optimistic cancellation keyed by source kind and ID, includes cancelled rows in its filter, and replaces the optimistic audit when the source listener supplies the persisted fields.

## Error handling and compatibility

- Duplicate dispatcher retries return `already_reversed` without writes.
- Direct record-only, missing-artifact, altered-effect, delayed-effect, and replay attempts are denied by rules.
- Existing legacy sources remain visible but cannot be automatically reversed.
- Existing unlimited rewards remain redeemable without inventory mutation.
- Existing cancellation callers must supply a reason; the UI already requires one.

## Testing

Tests are written first and observed failing before production changes:

- dispatcher/API: wrong entity type, derived request leg, reversal ledger, ineligible status, altered request link, reward inventory decrement/restoration, cancellation reason/audit for all families;
- Firestore emulator: record-only, missing event/effect/ledger, delayed inverse, replay, duplicate, altered effect, derived/wrong/ineligible sources, reward inventory omission/alteration, exact cancellation audit transitions;
- components: immediate cancellation reason badge in row controls and consolidated history, followed by listener reconciliation;
- final gates: focused tests, complete non-rules suite, complete rules suite on JDK 21, repository lint, production build, and independent read-only review.

## Scope

No backend service, new reversal family, XP reversal, allowance action, or direct contribution reversal is introduced. Unrelated dirty-worktree changes remain untouched.
