# Queki Daily Check-ins Design

## Purpose

Queki Daily Check-ins let a family member optionally record the animal that best represents how they feel today. The experience is a lightweight act of self-expression, not a diagnosis, assessment, prediction, reward mechanic, or prerequisite for using Queki.

The first version supports children by default and lets each owner or parent opt in for themselves. It records only a stable animal selection; it does not collect free text or infer psychological states.

## Product constraints

- Children are enabled by default at family level. A child sees the prompt only after all eligibility inputs are resolved and only when no check-in or skip exists for that family-local day.
- Parent participation is disabled by default and controlled independently by each owner or parent on their own user document.
- Family history visibility is enabled by default. Owners and regular parents may view same-family history when it is enabled; only the owner may change it.
- Check-ins are always optional. Close, Escape, and **Skip for today** persist the same daily skip state.
- A check-in takes one animal-selection tap after the modal opens and has no separate submit action.
- Check-ins never affect points, XP, streaks, wallets, achievements, task completion, rewards, feed activity, or access to any feature.
- The feature reports only explicit selections. It must not use diagnostic or inferential labels such as depressed, anxious, mentally unwell, abnormal, or at risk.
- The initial animal artwork uses emoji and existing UI primitives. No illustration dependency is added.
- All user-facing content is localized in English and Turkish through the existing typed, lazy namespace system.

## Architecture

The implementation adds a focused daily-check-in domain module, a Firestore API module, role-aware subscriptions in the Zustand bootstrap store, a shared dashboard experience, a parent history component, and a Settings card. It reuses the family timezone convention, existing `Modal`, cards, toggles, toast system, role helpers, and test patterns.

The feature is independent from the gamification domain. No daily-check-in operation calls a gamification API or writes to a gamification, task, wallet, reward, achievement, feed, or notification collection.

### Settings ownership

The family document contains:

```ts
interface FamilyDailyCheckinSettings {
  childrenEnabled: boolean;
  historyVisibleToParents: boolean;
}

// families/{familyId}
dailyCheckins: FamilyDailyCheckinSettings
```

Only the family owner can change these fields, following the existing family-settings convention. Missing legacy values resolve to `{ childrenEnabled: true, historyVisibleToParents: true }` without requiring a migration.

Each user document contains:

```ts
interface UserDailyCheckinPreferences {
  parentParticipationEnabled: boolean;
}

// users/{userId}
dailyCheckins: UserDailyCheckinPreferences
```

An owner or regular parent can change only their own preference. Missing values resolve to `false`. Children cannot change any check-in setting. Regular-parent Settings omit owner-only family controls, matching the existing convention; they see only their own participation control.

### Daily records

Submitted selections live at:

```text
families/{familyId}/daily_checkins/{userId}_{YYYY-MM-DD}
```

```ts
type DailyCheckinAnimal =
  | 'cheetah'
  | 'lion'
  | 'monkey'
  | 'owl'
  | 'fox'
  | 'panda'
  | 'turtle'
  | 'sloth';

interface DailyCheckinRecord {
  id: string;
  familyId: string;
  userId: string;
  localDate: string;
  animal: DailyCheckinAnimal;
  catalogVersion: 1;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Daily dismissals live separately at:

```text
families/{familyId}/daily_checkin_skips/{userId}_{YYYY-MM-DD}
```

```ts
interface DailyCheckinSkip {
  id: string;
  familyId: string;
  userId: string;
  localDate: string;
  createdAt: Timestamp;
}
```

A skip is interaction-control state, not a mood entry. It is never returned by history or included in summaries.

`catalogVersion` is required and fixed at `1` so a future catalog can preserve the meaning and presentation contract of historical selections without changing V1 records.

Document IDs are deterministic and constructed from the authenticated profile ID plus the resolved local date. Submission runs in a Firestore transaction: it reads the same-day documents, writes or safely replays the check-in with server timestamp sentinels, and deletes an existing same-day skip. Skipping runs in a transaction that first reads the check-in and creates the skip only when no valid check-in exists. A check-in is authoritative and can never be suppressed or replaced by a skip.

The effective eligibility rule is:

```ts
eligible = participationEnabled && !checkinExists && !skipExists;
```

### Time and day boundaries

Every daily identity and seven-day window uses the family document's configured IANA timezone. Missing or invalid legacy timezone values fall back to `Europe/London`, matching the existing gamification day-key convention. A shared pure helper produces `YYYY-MM-DD` using `Intl.DateTimeFormat`, so DST transitions and browser timezone differences do not change family-day identity.

The experience re-evaluates at the next family-local midnight while the dashboard remains open. A badge is shown only when its record's `localDate` equals the current resolved family day.

## Data loading and eligibility

The shared dashboard experience has three explicit resolution states: `loading`, `eligible`, and `resolved-ineligible`. It renders nothing while any required input is unknown:

- authenticated member and role;
- family settings;
- the current parent preference for an owner or parent;
- current family-local date;
- today's deterministic check-in document;
- today's deterministic skip document.

Children participate when `childrenEnabled` resolves true. Owners and parents participate when their own `parentParticipationEnabled` resolves true. Missing settings use the defaults described above.

The store subscribes only to the current member's current-day record and skip for prompting and badge state. When the date changes, it tears down the old daily listeners and subscribes to the new deterministic documents. Parent history uses a separate bounded query and is not required to resolve modal eligibility.

## Shared check-in experience

`DailyCheckinExperience` is mounted once around the role-specific dashboard content so child and parent flows cannot drift. It owns eligibility, modal visibility, the current-day badge, submission feedback, and the full-experience mutation lock.

The modal contains:

- title: **Who are you today?**
- supporting copy: **Choose the animal that feels most like you today.**
- eight localized options:
  - Cheetah — Energetic
  - Lion — Brave
  - Monkey — Playful
  - Owl — Ready to learn
  - Fox — Curious
  - Panda — Calm
  - Turtle — Taking it slowly
  - Sloth — Tired
- **Skip for today**;
- a Close control.

Each option comes from one immutable animal definition containing its stable ID, localized name key, localized feeling key, emoji, and accessible-label key. Selecting an animal immediately starts submission. There is no separate Submit button.

The existing accessible `Modal` supplies dialog semantics, focus trapping, Escape handling, body scroll lock, initial focus, and focus restoration. Animal choices are semantic buttons in DOM reading order, usable by Tab/Shift+Tab and activation keys. Labels announce both animal and feeling. Motion classes respect the project's reduced-motion CSS treatment.

Close, Escape, backdrop dismissal, and **Skip for today** all call the same persisted skip operation. The mutation lock covers the entire experience: once any animal or dismissal action begins, animal buttons, Close, Escape, backdrop dismissal, and Skip cannot start a competing operation. Rapid taps produce one mutation and one confirmation.

After a successful selection the modal closes, the current-day badge appears, and a brief non-blocking accessible toast says, for example, **Today you're a Cheetah.** A failed selection keeps the modal open, releases the lock, and shows a localized neutral error. A failed dismissal also keeps the modal open; the UI never claims a skip succeeded when persistence failed.

After submission, both dashboards show a small card or badge reading **Today I'm a Cheetah** with the selected emoji. It does not restyle the dashboard and disappears at the next family-local day.

## Settings UI

Daily Check-ins is a dedicated card in the parent Settings page and uses the existing settings-card and toggle patterns.

Owners see:

- **Enable check-ins for children** — family-level, default on;
- **Participate as a parent** — self-level, default off;
- **Show check-in history** — family-level, default on.

Regular parents see only **Participate as a parent**. Children see no check-in settings. Each toggle persists independently, locks while saving, displays localized failure feedback, and changes visible state only after a successful write or rolls back on failure.

## Parent history

`DailyCheckinHistory` appears only on owner and regular-parent dashboards. When `historyVisibleToParents` is false, it shows a clear localized disabled state and performs no history query. When enabled, it reads a bounded recent set of same-family `daily_checkins`, ordered newest first.

The first version provides:

- an all-members option and a family-member filter;
- recent chronological entries with local date, member display name, animal, and feeling label;
- a seven-family-day summary grouped by member and explicit selection;
- a clear empty state.

The summary uses descriptive wording only, such as **Alex selected ‘Tired’ three times in the last seven days.** It makes no diagnosis, prediction, risk classification, or inferred-state statement. Unknown/deleted member IDs use a neutral localized fallback and never expose data outside the family.

## Security rules

Rules enforce the capabilities rather than trusting hidden UI:

- family `dailyCheckins` updates are owner-only and boolean-shaped;
- a user may update `dailyCheckins.parentParticipationEnabled` only on their own owner/parent profile;
- children cannot update check-in preferences;
- a member may create/read their own same-family daily record and skip;
- owners and parents may read same-family check-in records only when `historyVisibleToParents` resolves true;
- skips remain self-readable only and are never parent-history data;
- document IDs, `familyId`, `userId`, `localDate`, exact field sets, `catalogVersion == 1`, and animal allowlists are validated;
- clients cannot update or delete submitted check-ins except for the submission transaction's deletion of their own same-day skip;
- cross-family access is denied.

Firestore rules cannot prove an arbitrary client timestamp came from a server clock. Writes therefore use Firebase server timestamp sentinels and rules require request-time-compatible values where the existing rules model can enforce them (for example `createdAt == request.time`). The design does not claim stronger timestamp guarantees than Firestore provides. If a required atomic shape cannot be safely authorized client-side, the operation moves to a trusted callable backend rather than weakening validation.

Because rules cannot independently derive an IANA-local date from `request.time`, client writes are limited to deterministic self-owned paths and strictly shaped dates. Eligibility and UI day resolution use the family timezone. Tests explicitly document the enforceable boundary; the rules do not pretend to validate timezone conversion they cannot calculate.

## Lifecycle, export, and reset

Both `daily_checkins` and `daily_checkin_skips` are added to the reviewed family-subcollection registry. Family deletion already recursively enumerates real family subcollections, and regression tests prove both are removed.

Account/child deletion must delete that user's records and skips so family history cannot retain entries for a removed account. This work is added to the existing child/account deletion cleanup registries and covered by tests.

Family export dynamically includes family subcollections, so both record types appear without inventing a separate export format; tests lock in their inclusion. Operational family reset treats both collections as resettable interaction data and includes them in its explicit operational-subcollection registry and dry-run report.

## Error handling and concurrency

- Unresolved eligibility renders nothing and cannot flash a modal.
- One experience-wide lock serializes selection and every dismissal route.
- Deterministic paths make retry identity stable.
- Transactions give valid check-ins precedence over skips.
- Failures retain truthful UI state and expose localized, non-diagnostic recovery copy.
- History is bounded and skipped entirely while disabled.
- Subscription errors flow through the store's existing feature-error mechanism and do not block unrelated dashboard content.

## Analytics policy

The only analytics events that a future compatible analytics layer may emit are:

- Daily Check-in modal opened;
- Daily Check-in completed;
- Daily Check-in skipped.

They may measure aggregate feature usage only. They must never include the selected animal ID, animal name, feeling label, child identity, user identity, family identity, check-in document ID, free text, emotional information, or any value or combination of values that could reconstruct a member's selection.

The current application explicitly has no product analytics SDK. V1 therefore adds no Daily Check-in analytics. The three event names are an allowlist policy, not an instruction to add tracking. If a later existing analytics system cannot guarantee anonymous, selection-free events, Daily Check-in analytics must remain disabled.

## Offline behavior

The current Firebase initialization uses the Firestore web client's default in-memory local cache. It does not enable durable IndexedDB persistence, and the application has no custom offline write queue. V1 must not add a separate queue solely for Daily Check-ins.

The modal may appear during a same-session network interruption when all eligibility inputs are already available from local listener state. It must still wait for complete eligibility resolution; a network interruption does not permit assumptions about missing check-in or skip documents.

Selection and skip operations use the same Firestore client and transaction semantics as the rest of the application. Because both operations require authoritative reads and atomic check-in-versus-skip precedence, V1 does not claim an offline transaction is durably saved. While an operation is pending, the experience remains locked and shows neutral localized pending copy. It does not show the success toast, report server confirmation, close as successfully completed, or update the current-day badge merely from component state.

If Firestore accepts and resolves the transaction, the resulting persisted listener state drives modal closure, badge display, and confirmation. If Firestore rejects the transaction, including because authoritative reads cannot complete offline, the modal stays open, the experience-wide lock is released, retry remains available, and a localized non-diagnostic error is shown. A failed skip is never remembered in component state.

Reloading always derives completion and skip state from Firestore. Since the project does not configure durable browser persistence, V1 never describes an unresolved in-memory offline operation as “saved offline.” If the project later enables durable Firebase persistence, a separate approved design must define how pending-write metadata maps to neutral queued or saved-offline UI without implying server confirmation.

## Test strategy

Implementation follows strict red-green-refactor cycles. Each behavior is introduced by a focused failing test, observed failing for the expected missing behavior, implemented minimally, and run green before refactoring.

### Domain tests

- immutable animal IDs and complete presentation metadata;
- fixed `catalogVersion: 1` compatibility metadata;
- family timezone resolution, DST boundaries, fallback timezone, and date rollover;
- child and parent eligibility including unresolved state;
- deterministic daily IDs and check-in precedence;
- seven-day window boundaries and explicit-selection counts;
- neutral summary wording without prohibited diagnostic terms.

### API and store tests

- deterministic document paths;
- check-in transaction creates/replays a record and removes a skip;
- skip transaction refuses to replace a check-in;
- experience-wide mutation locking prevents competing calls and duplicate toasts;
- current-day listeners switch on family-local rollover;
- disabled history causes no history subscription;
- history queries are bounded and ordered;
- write failures do not create local success.
- offline/unavailable transaction states remain pending or fail truthfully without an in-memory completion flag.

### Firestore emulator tests

- owner-only family settings updates;
- self-only owner/parent participation updates and child denial;
- child, owner, and parent self-submission/skip permissions;
- parent history reads only when enabled;
- skip privacy and exclusion from history;
- cross-family denial;
- exact schemas, stable animal IDs, deterministic identity, immutable records, and request-time-compatible timestamps;
- required `catalogVersion == 1` and rejection of missing or unsupported catalog versions;
- check-in and skip transaction precedence.

### Component and accessibility tests

- no modal before all eligibility inputs resolve;
- one-tap submission and the eight localized animal choices;
- Close, Escape, backdrop, and Skip share persisted dismissal behavior;
- lock coverage across all actions;
- focus entry, trap, restoration, keyboard order, accessible labels, live feedback, and reduced motion;
- error retention and retry;
- current-day badge and rollover disappearance;
- owner versus regular-parent versus child Settings visibility;
- history member filter, chronology, seven-day summary, empty state, and disabled state;
- English and Turkish key parity;
- prohibited diagnostic language is absent.
- pending/offline copy does not imply server confirmation or durable offline storage.

### Isolation and lifecycle regression tests

- submission performs no gamification, task, wallet, reward, achievement, feed, streak, or XP write;
- check-ins are never required for dashboard or feature access;
- family/account/child deletion removes records and skips;
- export includes both collections;
- reset includes both collections and reports them in dry-run output.

## Delivery boundaries

This version does not add notes, AI summaries, diagnoses, predictions, inferred risk, notifications, themed dashboards, rewards, streaks, analytics, or new illustration packages. Those are outside the approved scope.

### Future Extensions (Out of Scope)

The following ideas are intentionally excluded from V1 and must not be implemented by this plan:

- separate emoji and animal presentation modes;
- alternative or custom family animal packs;
- optional follow-up questions such as “Why do you feel this way?”;
- free-text notes;
- AI-generated weekly summaries;
- psychological interpretation, diagnosis, prediction, alerts, or risk scoring;
- a family-wide daily mood board;
- seasonal animals or collectible packs;
- rewards, points, XP, streak incentives, achievements, or wallet benefits;
- notifications based on a selected animal or feeling;
- dashboard-wide theme changes based on the selection.

These may be evaluated in later, separately approved designs. Their mention here must not expand the current implementation scope.
