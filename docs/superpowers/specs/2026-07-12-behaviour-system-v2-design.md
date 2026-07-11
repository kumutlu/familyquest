# FamilyQuest Behaviour System V2 Design

## Goal

Extend the existing Behaviour Events system with positive, negative, and financial-penalty events. Reuse the current behavior collection, wallet balance, immutable wallet ledger, family membership, and parent/owner authorization model. Do not introduce a separate punishment module.

## Event Model

Behavior events remain under `families/{familyId}/behaviour_events/{eventId}` and use this model:

```ts
type BehaviourEventType = 'positive' | 'negative' | 'financial';

interface BehaviourEvent {
  id: string;
  familyId: string;
  childId: string;
  type: BehaviourEventType;
  reason: string;
  pointsDelta: number;
  walletDelta: number;
  createdBy: string;
  createdByName: string;
  createdAt: Timestamp;
}
```

`createdByName` is stored when the event is created so history remains accurate if the creator later changes their display name or leaves the family. New code reads the V2 fields while history rendering retains a small compatibility path for existing V1 documents that use `userId`, `authorId`, `title`, and `timestamp`.

## Business Rules

### Positive

- Input `pointsDelta` must be greater than zero.
- `walletDelta` must be zero.
- Add `pointsDelta` to both `rewardPoints` and `lifetimeXP`.
- The stored event delta equals the requested delta.

### Negative

- Input `pointsDelta` must be less than zero.
- `walletDelta` must be zero.
- Add the delta to `rewardPoints`, clamping the resulting balance at zero.
- Do not change `lifetimeXP`.
- Store the actual applied delta. For example, applying `-25` to a balance of `10` stores `pointsDelta: -10` and leaves `rewardPoints: 0`.
- Only the applied delta is stored. Requested values are intentionally discarded in V1.

### Financial Penalty

- `walletDelta` must be less than zero.
- `pointsDelta` must be zero.
- Add `walletDelta` to `walletBalance`.
- Do not change `rewardPoints` or `lifetimeXP`.
- Wallet balances may become negative, subject to the family debt limit.

All event reasons are trimmed, required, and at least three characters long.

## Family Debt Limit

Store `debtLimitPence` on `families/{familyId}`. New families and settings use `-5000`, representing a maximum debt of £50 in the family's configured currency. Existing families without the field use `-5000` at runtime for backward compatibility. When the limit is changed, also store `updatedBy` with the owner's user ID and `updatedAt` with a server timestamp on the family document.

For a financial penalty, calculate:

```ts
const newBalance = currentBalance + walletDelta;
```

Reject the transaction with a clear validation error when `newBalance < debtLimitPence`. Ordinary wallet withdrawals retain their existing insufficient-funds behavior; only financial penalties may create debt.

## Atomic Data Flow

Extend the existing `addBehaviourEvent` API into one Firestore transaction. The transaction reads the family, child, and creator records; verifies family membership, child role, event shape, signs, reason, and debt limit; then performs all applicable writes:

1. Update either the child's point fields or wallet balance.
2. Create the behavior event.
3. For a financial event, create an immutable wallet ledger entry.

No client-side sequence of independent writes is permitted. A failed validation or Firestore operation leaves the child, event history, and ledger unchanged.

The financial ledger entry remains in `families/{familyId}/wallet_transactions/{transactionId}`:

```ts
interface FinancialPenaltyLedgerEntry {
  type: 'financial_penalty';
  behaviourEventId: string;
  childId: string;
  amount: number; // positive pence
  reason: string;
  createdBy: string;
  createdByName: string;
  createdAt: Timestamp;
}
```

The transaction allocates the behavior-event document reference before writing either record and stores that document ID as `behaviourEventId` on the ledger entry. This provides a stable audit link from the financial transaction to its originating behavior event.

Wallet history supports both `createdAt` on V2 penalty entries and the legacy `timestamp` field on existing entries.

## Financial Storage

All financial values are stored as integer pence. This applies to wallet balances, debt limits, financial penalties, and wallet ledger entries. Currency conversion occurs only at the UI boundary:

- `£5.00` in the UI is stored as `500`.
- `-£12.50` in the UI is stored as `-1250`.
- A financial event stores its signed penalty in `walletDelta`, while its ledger entry stores the corresponding `amount` as a positive integer.

## Authorization and Firestore Rules

Family members may read behavior history and wallet ledger entries. Only authenticated members whose user role is `parent` or `owner` may create behavior events or financial-penalty ledger entries. Children cannot create, update, or delete behavior events.

Rules validate allowed keys, event type, child and creator identifiers, reason length, delta signs, zero values for unrelated deltas, and timestamp fields. Behavior events are append-only in V2: updates and deletes are denied. Wallet ledger entries remain immutable.

Child self-service writes must not change `rewardPoints`, `lifetimeXP`, or `walletBalance`. Existing parent/owner writes needed by the transaction remain authorized. UI visibility is only a convenience; Firestore rules are the enforcement boundary.

## Parent/Owner UI

Extend the existing Log Behaviour modal with an event-type selector for Positive, Negative, and Financial Penalty. Show only the relevant input:

- Positive: positive whole-number points.
- Negative: positive whole-number magnitude in the form, converted to a negative delta by the API.
- Financial: positive currency amount, converted to negative pence by the API.

The reason input is required with a three-character minimum. Submission errors, including debt-limit rejection, remain visible in the modal. Creation controls render only for `parent` and `owner` users.

## History UI

All family members, including children, can view behavior history. Each item shows:

- Type-specific icon and color: green positive, red negative, orange financial.
- Reason.
- Signed points or localized currency amount.
- Creation date.
- `createdByName` snapshot.

The child profile history filters by `childId`, with V1 `userId` fallback. The shared history/feed integration uses the same presentation fields so financial events are visible without creating a new history module.

All histories are newest first. V2 behavior history, child history, shared family feed entries created for behavior events, and financial-penalty history sort by `createdAt DESC`. Compatibility readers normalize legacy `timestamp` values to the same descending order.

## Negative Wallet Balance Presentation

Centralize wallet balance styling/formatting so every balance below zero is red. Apply it to the dashboard, family cards, wallet page, child profiles, Funds/Pet Box views, and wallet selectors. Zero and positive balances keep their current styling. Signed currency formatting must render debt naturally, for example `-£5.00` rather than `£-5.00`.

## Settings UI

Expose one family-level debt-limit setting to owners using a positive currency magnitude in the form (for example `50.00`) and persist it as negative pence (`-5000`). All children inherit it. Parent users may use the configured limit when creating penalties but do not change owner-managed family settings.

## Error Handling

Reject malformed types, deltas, short reasons, non-child targets, cross-family targets, unauthorized creators, non-finite values, and penalties beyond the debt limit before writing. Surface concise messages in the modal. Firestore transaction conflicts use the SDK's normal retry behavior.

## Testing

Use test-driven development for pure validation/calculation helpers, transaction orchestration, security rules, and rendered UI states. Cover:

- Positive, negative, and financial validation.
- Reward-point and XP calculations.
- Actual applied negative delta and zero clamping.
- Negative wallet calculations and exact debt-limit boundary.
- Rejection below the debt limit with no partial writes.
- Financial ledger entry shape and positive stored amount.
- Parent/owner creation and child write rejection.
- History rendering, creator snapshots, compatibility fields, icons, colors, dates, and signed amounts.
- Red styling and correct formatting anywhere a negative wallet balance appears.

## Scope

V1 uses one debt limit for the entire family. Per-child debt limits, event editing/deletion, reversals, approval workflows, and a separate punishment module are out of scope.
