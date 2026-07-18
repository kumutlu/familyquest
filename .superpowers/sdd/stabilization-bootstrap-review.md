# Bootstrap stabilization independent final-tree review

Reviewed through: `8a1b3c6` (`fix: close reversal history review blockers`), including bootstrap compatibility commit `9ac1278`.

Baseline: prior bootstrap audit, implementation report, previous changes-required review, integrated query plan, store consumers, Firestore rules/index configuration, production writers, and committed tests.

Tests: not rerun for this review. Reported verification is treated as implementation evidence.

## Verdict: APPROVED

No Critical, Important, or Minor findings remain in the integrated final tree.

The final query plan is rules-compatible for parent, owner, and child roles; preserves complete shared feed/history data; normalizes mixed legacy and current timestamps; and declares every required composite index in source-controlled Firebase configuration. The later `8a1b3c6` correction also aligns the reversal listener with the persisted `completedAt` field.

## Prior-finding resolution matrix

| Prior finding | Result | Final conclusion |
|---|---|---|
| C1 child feed listener permission denial | Resolved | Feed is now an explicitly shared family resource. Every role uses the same `timestamp`-ordered query, and reads require family membership. Current production feed writers persist `timestamp`, including records without `visibleTo`. |
| I1 child savings ownership field | Resolved | Child savings queries use `childId == uid`, matching the production writer and rule contract. |
| I2 production query-plan/schema coverage | Resolved | Wallet and behaviour queries no longer order by fields absent from legacy/current records. The store normalizes `createdAt` to `timestamp` when needed and sorts descending client-side. Parent, owner, and child plans share one factory and are exercised by the rules-backed suite. |
| I3 production index configuration | Resolved | `firestore.indexes.json` is referenced by `firebase.json` and exactly covers the four remaining equality-plus-order query shapes: transfer requests, Pet Box requests, and both money-request branches. Wallet ordering was removed and therefore needs no composite index. |
| Integrated reversal history query | Resolved | `8a1b3c6` orders reversals by `completedAt`, matching immutable reversal records and the completed-only emulator fixture. |

## Security review

- The bootstrap compatibility commit broadens reads only for `families/{familyId}/feed/{feedId}`.
- That broadening is deliberate: feed is now shared among authenticated members of the same family. It does not expose feed data across families or to unauthenticated users.
- Wallet transaction queries remain scoped to `childId == request.auth.uid` for children, and the rules-backed fixture confirms sibling wallet records are excluded.
- No other read, create, update, or delete authorization was broadened by the bootstrap compatibility change.

## Index and query-plan verification

The committed manifest matches all final composite query requirements:

| Collection group | Equality field | Order field |
|---|---|---|
| `transfer_requests` | `fromChildId` | `createdAt DESC` |
| `petbox_requests` | `childId` | `createdAt DESC` |
| `money_requests` | `requesterId` | `createdAt DESC` |
| `money_requests` | `requestedFromId` | `createdAt DESC` |

All other final bootstrap queries are document reads, collection reads, single-field filters, or single-field ordering and do not require an additional composite index.

## Confirmed integrated behavior

- A truly field-absent public feed fixture and formerly audience-tagged feed fixtures are returned for every family role under the shared-feed contract.
- Mixed `createdAt`/`timestamp` wallet and behaviour records are both retained and deterministically ordered.
- Both child money-request listeners retain their merge barrier and jointly gate the single readiness resource.
- Reversal records ordered by `completedAt` are included in bootstrap reconciliation.
- Firebase deploy configuration points at both the committed rules and index manifests.

No files other than this review were changed, and no tests were rerun during the independent final-tree review.
