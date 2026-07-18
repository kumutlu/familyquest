# Reversal History Controls Design

## Scope

Add parent/owner-only cancellation and reversal controls to existing history/detail surfaces without changing reversal financial semantics. Pending supported requests show `Cancel`; completed traceable actions show `Reverse` or `Refund`. Unsupported, legacy, and already-reversed actions show no action.

## Architecture

`reversalHistory.ts` defines one normalized history-action model. It maps wallet, fund, behaviour, task completion, reward redemption, transfer request, money request, and Pet Box records to their dispatcher source kind, signed original effect, affected target, predicted post-action value, action label, and eligibility. It joins immutable reversal records by deterministic `sourceKind/sourceId` and exposes the reversal reason, actor, and time for badges/details.

The store subscribes to `families/{familyId}/reversals` for every family member and exposes `reversals`. Existing source subscriptions remain authoritative; snapshot updates make completed reversals appear without refresh.

`ReversalActionModal` is the only confirmation workflow. It displays source summary, affected target, signed original effect, predicted post-balance, and the exact warning: “This creates a linked reversal record. The original action will remain in history.” It requires a trimmed reason of at least three characters, prevents duplicate submission synchronously, keeps the modal and input open on failure, shows the exact thrown error, and closes only after success.

## Surfaces

- Wallet transaction details: completed traceable wallet sources can be reversed/refunded; pending transfer, money, and Pet Box requests can be cancelled only through their supported cancellation API and identity contract.
- Fund history: traceable expenses and Pet Box fund effects can be reversed/refunded.
- Member behaviour history: traceable behaviour events can be reversed.
- Approval Center history: approved traceable task, transfer, money, and Pet Box sources can be reversed/refunded.
- Reversed items show a `Reversed` badge plus reason, actor name, and timestamp. Reversal ledger rows themselves never expose another reversal control.

## Eligibility and Safety

- Controls render only for current users with role `parent` or `owner` in the active family.
- A source needs a canonical `effectSnapshot`, a supported source kind, and no matching reversal record.
- Pending actions use cancellation, never reversal. Cancel availability follows the existing API/rules identity constraints; unsupported pending actions are hidden.
- Predicted values are computed from the current wallet, fund, or points balance and the exact inverse snapshot. Multi-target sources list every affected target and predicted value.
- The dispatcher and Firestore rules remain the final authority for debt, fund, points, identity, and duplicate protection. UI errors preserve exact dispatcher messages.

## Testing

- Pure normalization tests cover each source family, signed effects, predicted values, legacy/unsupported/already-reversed hiding, pending cancellation, and reversal metadata.
- Store tests prove the reversal listener is included, updates state immediately, and resets during family cleanup.
- Modal/component tests prove three-character validation, exact warning, signed preview, double-submit prevention, failed-action retention/exact error, success close, and Reversed badge metadata.
- Full non-rules tests, Firestore rules, scoped lint, and production build remain green.
