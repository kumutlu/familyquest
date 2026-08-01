# Queki Daily Check-ins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional, private, animal-based daily check-ins for children and opted-in parents, with owner-managed family settings, current-day dashboard feedback, parent history, strict access control, and no gamification effects.

**Architecture:** A pure `dailyCheckins` domain module owns catalog, date, eligibility, and summary rules. A focused Firestore API owns deterministic transaction paths and settings writes; Zustand owns role-aware current-day and bounded-history listeners; shared React components own the modal, badge, settings, and history presentation. Firestore rules and deletion/export/reset registries enforce privacy and lifecycle behavior independently of the UI.

**Tech Stack:** React 19, TypeScript 6, Zustand 5, Firebase Auth/Firestore 12, React i18next, Tailwind CSS, Vitest, Testing Library, Firebase Rules Unit Testing.

## Global Constraints

- Children are enabled by default; parent participation is disabled by default; family history is enabled by default.
- Family-level settings are owner-only. Each owner/parent can update only their own participation preference. Children cannot change check-in settings.
- A user is eligible only after all inputs resolve and only when `!checkinExists && !skipExists`.
- Every record contains `catalogVersion: 1`; skips remain a separate interaction-control collection and never enter history.
- Check-in submission atomically supersedes the same-day skip. A valid check-in always takes precedence over a skip.
- The family IANA timezone defines day identity and seven-day windows; missing/invalid legacy values fall back to `Europe/London`.
- Close, Escape, backdrop, and **Skip for today** persist the same skip operation.
- One experience-wide mutation lock prevents races between every selection and dismissal route.
- Do not show success, close as completed, or update the badge until persisted listener state truthfully reflects the accepted operation.
- The current app has no analytics SDK; add no Daily Check-in analytics in V1.
- Use existing Firebase behavior; add no custom offline queue and never claim unresolved in-memory writes are saved offline.
- Add no points, XP, streak, wallet, achievement, reward, task, feed, notification, diagnosis, prediction, emotional inference, free text, AI summary, or new illustration dependency.
- Localize all UI and accessible copy in English and Turkish.
- Preserve the user's existing uncommitted changes in `package.json`, `vite.config.ts`, `src/buildInfo.ts`, `src/buildInfo.test.ts`, `src/pages/Settings.tsx`, `src/pages/Settings.test.tsx`, and `src/vite-env.d.ts`; inspect overlapping Settings hunks before each commit.

---

## File map

**Create**

- `src/lib/dailyCheckins.ts` — immutable catalog, settings defaults, date/ID helpers, eligibility state, history summary.
- `src/lib/dailyCheckins.test.ts` — pure domain contract.
- `src/lib/dailyCheckinsApi.ts` — settings writes and deterministic Firestore transactions.
- `src/lib/dailyCheckinsApi.test.ts` — transaction and write-shape tests.
- `src/components/checkins/DailyCheckinModal.tsx` — accessible one-tap animal chooser.
- `src/components/checkins/DailyCheckinModal.test.tsx` — modal interaction, lock, and failure tests.
- `src/components/checkins/DailyCheckinExperience.tsx` — resolved eligibility, persisted dismissal/submission, badge, confirmation.
- `src/components/checkins/DailyCheckinExperience.test.tsx` — unresolved-state, rollover, persistence, and isolation tests.
- `src/components/checkins/DailyCheckinBadge.tsx` — current-day non-intrusive badge.
- `src/components/checkins/DailyCheckinHistory.tsx` — parent filter, recent list, summary, disabled/empty states.
- `src/components/checkins/DailyCheckinHistory.test.tsx` — parent-history presentation tests.
- `src/components/settings/DailyCheckinSettings.tsx` — role-aware settings card.
- `src/components/settings/DailyCheckinSettings.test.tsx` — owner/parent/child visibility and failure tests.
- `tests/firestore/dailyCheckins.rules.test.ts` — emulator permission/schema/precedence coverage.

**Modify**

- `src/store/useStore.ts` and focused store tests — current-day/check-in/skip/history state and listeners.
- `src/lib/api.ts`, `src/lib/api.familySettings.test.ts` — allowlisted family settings and self preference API wiring.
- `src/pages/Dashboard.tsx`, `src/pages/Dashboard.test.tsx` — mount shared experience around both dashboard branches.
- `src/components/parent/ParentDashboard.tsx`, `src/components/parent/ParentDashboard.test.tsx` — mount parent history.
- `src/pages/Settings.tsx`, `src/pages/Settings.test.tsx` — mount Daily Check-in settings without overwriting existing local changes.
- `src/components/ui/Modal.tsx`, `src/components/ui/Modal.test.tsx` — add lock-aware close/Escape/backdrop handling; the current API has no dismissal lock.
- `src/i18n/config.ts`, `src/i18n/types.ts`, `src/i18n/locales/en/checkins.json`, `src/i18n/locales/tr/checkins.json`, `src/i18n/i18n.test.ts` — typed lazy namespace and parity.
- `firestore.rules`, `tests/firestore/familySettings.rules.test.ts` — exact role and document validation.
- `functions/src/familyDeletion.ts`, `functions/src/familyDeletion.test.ts` — reviewed family registry.
- `functions/src/childDeletion.ts`, `functions/src/childDeletion.test.ts` — per-child record cleanup.
- `functions/src/accountDeletion.ts`, `functions/src/accountDeletion.test.ts` — self-account record cleanup.
- `scripts/lib/family-data-tools.ts`, `tests/scripts/resetFamilyData.test.ts` — reset registry and export/reset assertions.
- Inspect without modifying: `firestore.indexes.json`; the planned history query uses the automatic single-field `createdAt` index.

---

### Task 1: Pure Daily Check-in domain

**Files:**
- Create: `src/lib/dailyCheckins.test.ts`
- Create: `src/lib/dailyCheckins.ts`

**Interfaces:**
- Produces: `DAILY_CHECKIN_CATALOG`, `DailyCheckinAnimal`, `DailyCheckinRecord`, `DailyCheckinSkip`, `resolvedDailyCheckinSettings`, `resolvedParentParticipation`, `familyDayKey`, `dailyCheckinDocumentId`, `resolveDailyCheckinEligibility`, `summarizeDailyCheckins`.
- Consumes: no Firebase or React dependency.

- [ ] **Step 1: Write failing catalog/default/identity tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  DAILY_CHECKIN_CATALOG,
  dailyCheckinDocumentId,
  familyDayKey,
  resolvedDailyCheckinSettings,
  resolvedParentParticipation,
} from './dailyCheckins';

describe('daily check-in domain', () => {
  it('defines the immutable V1 animal catalog', () => {
    expect(DAILY_CHECKIN_CATALOG.map(item => item.id)).toEqual([
      'cheetah', 'lion', 'monkey', 'owl', 'fox', 'panda', 'turtle', 'sloth',
    ]);
    expect(DAILY_CHECKIN_CATALOG.every(item => item.catalogVersion === 1 && item.emoji)).toBe(true);
  });

  it('uses safe legacy defaults', () => {
    expect(resolvedDailyCheckinSettings(undefined)).toEqual({
      childrenEnabled: true,
      historyVisibleToParents: true,
    });
    expect(resolvedParentParticipation(undefined)).toBe(false);
  });

  it('builds the family-local deterministic identity across DST', () => {
    const instant = new Date('2026-03-29T00:30:00Z');
    expect(familyDayKey(instant, 'Europe/London')).toBe('2026-03-29');
    expect(dailyCheckinDocumentId('child-1', '2026-03-29')).toBe('child-1_2026-03-29');
  });

  it('falls back to Europe/London for invalid legacy timezone data', () => {
    expect(familyDayKey(new Date('2026-08-01T23:30:00Z'), 'invalid')).toBe('2026-08-02');
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx vitest run src/lib/dailyCheckins.test.ts`

Expected: FAIL because `./dailyCheckins` does not exist.

- [ ] **Step 3: Implement catalog, types, defaults, and date/ID helpers**

```ts
export const DAILY_CHECKIN_CATALOG_VERSION = 1 as const;
export const DAILY_CHECKIN_CATALOG = [
  { id: 'cheetah', emoji: '🐆', nameKey: 'animals.cheetah.name', feelingKey: 'animals.cheetah.feeling', ariaKey: 'animals.cheetah.aria', catalogVersion: 1 },
  { id: 'lion', emoji: '🦁', nameKey: 'animals.lion.name', feelingKey: 'animals.lion.feeling', ariaKey: 'animals.lion.aria', catalogVersion: 1 },
  { id: 'monkey', emoji: '🐒', nameKey: 'animals.monkey.name', feelingKey: 'animals.monkey.feeling', ariaKey: 'animals.monkey.aria', catalogVersion: 1 },
  { id: 'owl', emoji: '🦉', nameKey: 'animals.owl.name', feelingKey: 'animals.owl.feeling', ariaKey: 'animals.owl.aria', catalogVersion: 1 },
  { id: 'fox', emoji: '🦊', nameKey: 'animals.fox.name', feelingKey: 'animals.fox.feeling', ariaKey: 'animals.fox.aria', catalogVersion: 1 },
  { id: 'panda', emoji: '🐼', nameKey: 'animals.panda.name', feelingKey: 'animals.panda.feeling', ariaKey: 'animals.panda.aria', catalogVersion: 1 },
  { id: 'turtle', emoji: '🐢', nameKey: 'animals.turtle.name', feelingKey: 'animals.turtle.feeling', ariaKey: 'animals.turtle.aria', catalogVersion: 1 },
  { id: 'sloth', emoji: '🦥', nameKey: 'animals.sloth.name', feelingKey: 'animals.sloth.feeling', ariaKey: 'animals.sloth.aria', catalogVersion: 1 },
] as const;

export type DailyCheckinAnimal = typeof DAILY_CHECKIN_CATALOG[number]['id'];
export type DailyCheckinRecord = {
  id: string; familyId: string; userId: string; localDate: string;
  animal: DailyCheckinAnimal; catalogVersion: 1; createdAt: unknown; updatedAt: unknown;
};
export type DailyCheckinSkip = {
  id: string; familyId: string; userId: string; localDate: string; createdAt: unknown;
};

export const resolvedDailyCheckinSettings = (value?: Partial<{ childrenEnabled: boolean; historyVisibleToParents: boolean }>) => ({
  childrenEnabled: value?.childrenEnabled ?? true,
  historyVisibleToParents: value?.historyVisibleToParents ?? true,
});
export const resolvedParentParticipation = (value?: Partial<{ parentParticipationEnabled: boolean }>) =>
  value?.parentParticipationEnabled ?? false;

const validTimezone = (value?: string) => {
  try { new Intl.DateTimeFormat('en-CA', { timeZone: value }).format(0); return value!; }
  catch { return 'Europe/London'; }
};
export const familyDayKey = (date: Date, timezone?: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: validTimezone(timezone), year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};
export const dailyCheckinDocumentId = (userId: string, localDate: string) => `${userId}_${localDate}`;
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `npx vitest run src/lib/dailyCheckins.test.ts`

Expected: PASS.

- [ ] **Step 5: Add failing eligibility and seven-day summary tests**

```ts
it.each([
  [{ resolved: false }, 'loading'],
  [{ resolved: true, role: 'child', childrenEnabled: true, checkinExists: false, skipExists: false }, 'eligible'],
  [{ resolved: true, role: 'parent', parentParticipationEnabled: false, checkinExists: false, skipExists: false }, 'resolved-ineligible'],
  [{ resolved: true, role: 'child', childrenEnabled: true, checkinExists: true, skipExists: false }, 'resolved-ineligible'],
])('resolves eligibility without flashing', (input, expected) => {
  expect(resolveDailyCheckinEligibility(input as any)).toBe(expected);
});

it('counts only explicit selections inside seven family days', () => {
  const records = [
    { userId: 'alex', localDate: '2026-08-01', animal: 'sloth' },
    { userId: 'alex', localDate: '2026-07-30', animal: 'sloth' },
    { userId: 'alex', localDate: '2026-07-25', animal: 'lion' },
  ] as DailyCheckinRecord[];
  expect(summarizeDailyCheckins(records, '2026-08-01')).toEqual([
    { userId: 'alex', animal: 'sloth', count: 2 },
  ]);
});
```

- [ ] **Step 6: Verify RED, implement minimal pure functions, and verify GREEN**

Run RED then GREEN: `npx vitest run src/lib/dailyCheckins.test.ts`

Implementation contract:

```ts
export type DailyCheckinEligibility = 'loading' | 'eligible' | 'resolved-ineligible';
export function resolveDailyCheckinEligibility(input: EligibilityInput): DailyCheckinEligibility {
  if (!input.resolved) return 'loading';
  const participating = input.role === 'child' ? input.childrenEnabled : input.parentParticipationEnabled;
  return participating && !input.checkinExists && !input.skipExists ? 'eligible' : 'resolved-ineligible';
}

export function summarizeDailyCheckins(
  records: readonly DailyCheckinRecord[], today: string,
): Array<{ userId: string; animal: DailyCheckinAnimal; count: number }> {
  // Compare parsed Gregorian day keys; include today and the previous six days.
}
```

- [ ] **Step 7: Commit the domain slice**

```bash
git add src/lib/dailyCheckins.ts src/lib/dailyCheckins.test.ts
git commit -m "feat(checkins): add daily check-in domain"
```

---

### Task 2: Settings and transaction APIs

**Files:**
- Create: `src/lib/dailyCheckinsApi.test.ts`
- Create: `src/lib/dailyCheckinsApi.ts`
- Modify: `src/lib/api.ts`
- Modify: `src/lib/api.familySettings.test.ts`

**Interfaces:**
- Consumes: `DailyCheckinAnimal`, `dailyCheckinDocumentId` from Task 1; exported `db` from `src/lib/firebase.ts`.
- Produces: `submitDailyCheckin(input): Promise<DailyCheckinWriteResult>`, `skipDailyCheckin(input): Promise<DailyCheckinWriteResult>`, `updateParentDailyCheckinPreference(userId, enabled): Promise<void>`, and extended `updateFamilySettings` support.

- [ ] **Step 1: Write failing family/self settings tests**

```ts
it('allowlists both family-level daily check-in settings', async () => {
  await updateFamilySettings('family-1', {
    dailyCheckins: { childrenEnabled: false, historyVisibleToParents: true },
  });
  expect(firestore.updateDoc).toHaveBeenCalledWith(
    { path: 'families/family-1', id: 'family-1' },
    { dailyCheckins: { childrenEnabled: false, historyVisibleToParents: true } },
  );
});

it('writes only the signed-in adult preference field', async () => {
  await updateParentDailyCheckinPreference('parent-1', true);
  expect(firestore.updateDoc).toHaveBeenCalledWith(
    { path: 'users/parent-1', id: 'parent-1' },
    { dailyCheckins: { parentParticipationEnabled: true } },
  );
});
```

- [ ] **Step 2: Verify RED, add the typed allowlist/API, verify GREEN**

Run: `npx vitest run src/lib/api.familySettings.test.ts src/lib/dailyCheckinsApi.test.ts`

Expected RED: missing setting field/API. Add:

```ts
export interface FamilySettingsUpdates {
  name?: string;
  currencyCode?: SupportedCurrencyCode;
  timezone?: string;
  weekStartsOn?: 0 | 1;
  petBoxEnabled?: boolean;
  gamificationConfig?: GamificationConfigInput;
  dailyCheckins?: { childrenEnabled: boolean; historyVisibleToParents: boolean };
}
// In updateFamilySettings:
if (updates.dailyCheckins !== undefined) allowedUpdates.dailyCheckins = updates.dailyCheckins;

export const updateParentDailyCheckinPreference = (userId: string, enabled: boolean) =>
  updateDoc(doc(db, 'users', userId), {
    dailyCheckins: { parentParticipationEnabled: enabled },
  });
```

- [ ] **Step 3: Write failing transaction tests with real transaction behavior assertions**

```ts
it('submits V1 check-in and deletes the same-day skip atomically', async () => {
  transaction.get.mockResolvedValueOnce(missingCheckin).mockResolvedValueOnce(existingSkip);
  await submitDailyCheckin({ familyId: 'family-1', userId: 'child-1', localDate: '2026-08-01', animal: 'cheetah' });
  expect(transaction.set).toHaveBeenCalledWith(checkinRef, expect.objectContaining({
    familyId: 'family-1', userId: 'child-1', localDate: '2026-08-01',
    animal: 'cheetah', catalogVersion: 1,
  }));
  expect(transaction.delete).toHaveBeenCalledWith(skipRef);
});

it('does not create a skip when a valid check-in exists', async () => {
  transaction.get.mockResolvedValue(existingCheckin);
  await expect(skipDailyCheckin({ familyId: 'family-1', userId: 'child-1', localDate: '2026-08-01' }))
    .resolves.toEqual({ status: 'already-checked-in' });
  expect(transaction.set).not.toHaveBeenCalled();
});

it('replays an existing matching check-in without duplicate writes', async () => {
  transaction.get.mockResolvedValueOnce(existingCheckin).mockResolvedValueOnce(existingSkip);
  await expect(submitDailyCheckin(input)).resolves.toEqual({ status: 'already-checked-in' });
  expect(transaction.set).not.toHaveBeenCalled();
  expect(transaction.delete).toHaveBeenCalledWith(skipRef);
});
```

- [ ] **Step 4: Verify RED, implement transactions, verify GREEN**

```ts
export type DailyCheckinWriteResult = { status: 'written' | 'already-checked-in' | 'already-skipped' };

export async function submitDailyCheckin(input: SubmitDailyCheckinInput): Promise<DailyCheckinWriteResult> {
  const id = dailyCheckinDocumentId(input.userId, input.localDate);
  const checkinRef = doc(db, `families/${input.familyId}/daily_checkins/${id}`);
  const skipRef = doc(db, `families/${input.familyId}/daily_checkin_skips/${id}`);
  return runTransaction(db, async transaction => {
    const [checkin, skip] = await Promise.all([transaction.get(checkinRef), transaction.get(skipRef)]);
    if (checkin.exists()) {
      if (skip.exists()) transaction.delete(skipRef);
      return { status: 'already-checked-in' };
    }
    const now = serverTimestamp();
    transaction.set(checkinRef, { ...input, catalogVersion: 1, createdAt: now, updatedAt: now });
    if (skip.exists()) transaction.delete(skipRef);
    return { status: 'written' };
  });
}
```

Implement `skipDailyCheckin` symmetrically: read check-in first; if it exists return `already-checked-in`; otherwise read/reuse the deterministic skip or create it with `serverTimestamp()`.

Run: `npx vitest run src/lib/api.familySettings.test.ts src/lib/dailyCheckinsApi.test.ts`

Expected: PASS with no gamification/feed API mocks called.

- [ ] **Step 5: Commit the API slice**

```bash
git add src/lib/dailyCheckinsApi.ts src/lib/dailyCheckinsApi.test.ts src/lib/api.ts src/lib/api.familySettings.test.ts
git commit -m "feat(checkins): add settings and daily write APIs"
```

---

### Task 3: Firestore rules and indexes

**Files:**
- Create: `tests/firestore/dailyCheckins.rules.test.ts`
- Modify: `tests/firestore/familySettings.rules.test.ts`
- Modify: `firestore.rules`
- Inspect without modifying: `firestore.indexes.json`

**Interfaces:**
- Consumes: exact V1 shapes and deterministic ID format from Tasks 1–2.
- Produces: owner-only family settings; self-only adult preferences; same-family self writes; conditional parent history reads; private skips.

- [ ] **Step 1: Add failing settings-rule tests**

```ts
it('allows only the owner to update family daily check-in settings', async () => {
  await assertSucceeds(updateDoc(familyRef('owner'), {
    dailyCheckins: { childrenEnabled: false, historyVisibleToParents: true },
  }));
  await assertFails(updateDoc(familyRef('parent'), {
    dailyCheckins: { childrenEnabled: true, historyVisibleToParents: false },
  }));
});

it('allows each adult to update only their own participation preference', async () => {
  await assertSucceeds(updateDoc(userRef('parent', 'parent'), {
    dailyCheckins: { parentParticipationEnabled: true },
  }));
  await assertFails(updateDoc(userRef('parent', 'owner'), {
    dailyCheckins: { parentParticipationEnabled: true },
  }));
  await assertFails(updateDoc(userRef('child', 'child'), {
    dailyCheckins: { parentParticipationEnabled: true },
  }));
});
```

- [ ] **Step 2: Run emulator tests and verify RED**

Run: `npm run test:rules -- --run tests/firestore/familySettings.rules.test.ts`

Expected: FAIL because the new schemas and role constraints are not validated.

- [ ] **Step 3: Add exact settings validation**

```rules
function isValidDailyCheckinFamilySettings(data) {
  return data.keys().hasOnly(['childrenEnabled', 'historyVisibleToParents'])
    && data.childrenEnabled is bool
    && data.historyVisibleToParents is bool;
}

function isValidParentDailyCheckinPreference(uid) {
  return authProfileId() == uid
    && resource.data.role in ['owner', 'parent']
    && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['dailyCheckins'])
    && request.resource.data.dailyCheckins.keys().hasOnly(['parentParticipationEnabled'])
    && request.resource.data.dailyCheckins.parentParticipationEnabled is bool;
}
```

Extend the existing family update rule with validation only when `dailyCheckins` changes. Add `isValidParentDailyCheckinPreference(uid)` as an explicit user-update branch before the generic benign self-update branch, and protect `dailyCheckins` in that generic branch's forbidden-field list.

- [ ] **Step 4: Add failing record/skip permission and schema tests**

Cover child self-create/read, adult self-create, enabled parent history read, disabled history denial, self-readable/private skips, cross-family denial, foreign-user denial, bad animal, missing/unsupported `catalogVersion`, wrong ID/date/user/family, extra fields, non-request-time timestamps, update/delete denial, and atomic check-in-create plus skip-delete.

Representative create:

```ts
await assertSucceeds(setDoc(doc(childDb, `families/${FAMILY_ID}/daily_checkins/child_2026-08-01`), {
  familyId: FAMILY_ID,
  userId: 'child',
  localDate: '2026-08-01',
  animal: 'cheetah',
  catalogVersion: 1,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
}));
```

- [ ] **Step 5: Verify RED, implement rules, verify GREEN**

```rules
function isDailyCheckinId(userId, localDate, documentId) {
  return documentId == userId + '_' + localDate
    && localDate.matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
}

match /daily_checkins/{checkinId} {
  allow read: if isAuthenticated()
    && resource.data.familyId == familyId
    && (resource.data.userId == authProfileId()
      || (isParent(familyId)
        && get(/databases/$(database)/documents/families/$(familyId)).data
          .get('dailyCheckins', {}).get('historyVisibleToParents', true) == true));
  allow create: if isFamilyMember(familyId)
    && request.resource.data.keys().hasOnly(['familyId','userId','localDate','animal','catalogVersion','createdAt','updatedAt'])
    && request.resource.data.familyId == familyId
    && request.resource.data.userId == authProfileId()
    && isDailyCheckinId(request.resource.data.userId, request.resource.data.localDate, checkinId)
    && request.resource.data.animal in ['cheetah','lion','monkey','owl','fox','panda','turtle','sloth']
    && request.resource.data.catalogVersion == 1
    && request.resource.data.createdAt == request.time
    && request.resource.data.updatedAt == request.time;
  allow update, delete: if false;
}
```

Implement `daily_checkin_skips` with self-only read/create, exact shape and ID validation, `createdAt == request.time`, and no update. Permit self-delete only when the corresponding check-in already exists or exists after the same atomic request; this supports both normal check-in-create-plus-skip-delete and cleanup of an admin-created inconsistent pair. Implement skip create so a same-day check-in cannot already exist.

Run: `npm run test:rules -- --run tests/firestore/dailyCheckins.rules.test.ts tests/firestore/familySettings.rules.test.ts`

Expected: PASS. If the actual history query needs a composite index, first add a failing query test and then add exactly that index to `firestore.indexes.json`; do not add speculative indexes.

- [ ] **Step 6: Commit the rules slice**

```bash
git add firestore.rules firestore.indexes.json tests/firestore/dailyCheckins.rules.test.ts tests/firestore/familySettings.rules.test.ts
git commit -m "feat(checkins): enforce daily check-in access rules"
```

---

### Task 4: Role-aware store subscriptions and rollover

**Files:**
- Modify: `src/store/useStore.ts`
- Modify: `src/store/authBootstrap.test.tsx`
- Create or modify: `src/store/useStore.dailyCheckins.test.tsx`

**Interfaces:**
- Consumes: `familyDayKey`, `dailyCheckinDocumentId`, record types from Task 1.
- Produces store fields `dailyCheckinDay`, `dailyCheckinStateResolved`, `todayDailyCheckin`, `todayDailyCheckinSkip`, `dailyCheckinHistory`, `dailyCheckinHistoryResolved`, and action `refreshDailyCheckinDay(now?: Date)`.

- [ ] **Step 1: Write failing store tests for fully resolved current-day state**

```ts
it('subscribes to deterministic current-day documents after profile and family resolve', async () => {
  hydrateProfile({ id: 'child-1', familyId: 'family-1', role: 'child' });
  emitFamily({ timezone: 'Europe/London', dailyCheckins: { childrenEnabled: true, historyVisibleToParents: true } });
  expect(onSnapshotPaths()).toContain('families/family-1/daily_checkins/child-1_2026-08-01');
  expect(onSnapshotPaths()).toContain('families/family-1/daily_checkin_skips/child-1_2026-08-01');
  expect(useStore.getState().dailyCheckinStateResolved).toBe(false);
  emitMissingCurrentDocuments();
  expect(useStore.getState().dailyCheckinStateResolved).toBe(true);
});

it('switches both listeners at family-local midnight', () => {
  useStore.getState().refreshDailyCheckinDay(new Date('2026-08-02T00:01:00Z'));
  expect(unsubscribedPaths()).toContain('families/family-1/daily_checkins/child-1_2026-08-01');
  expect(onSnapshotPaths()).toContain('families/family-1/daily_checkins/child-1_2026-08-02');
});
```

- [ ] **Step 2: Verify RED, add state and dynamic listeners, verify GREEN**

Run: `npx vitest run src/store/useStore.dailyCheckins.test.tsx src/store/authBootstrap.test.tsx`

Implementation state:

```ts
dailyCheckinDay: null,
dailyCheckinStateResolved: false,
todayDailyCheckin: null,
todayDailyCheckinSkip: null,
dailyCheckinHistory: [],
dailyCheckinHistoryResolved: false,
```

Use two named non-critical document listeners after both current profile and family timezone are known. Set `dailyCheckinStateResolved` only after both callbacks have fired for the active generation/day. Reset all fields on auth/family cleanup. `refreshDailyCheckinDay` compares a freshly computed family day and replaces listeners only when the key changes.

- [ ] **Step 3: Write failing conditional parent-history tests**

```ts
it('loads bounded newest-first history for owner and regular parent only when enabled', () => {
  hydrateAdult({ role: 'parent' }, { dailyCheckins: { historyVisibleToParents: true } });
  expect(lastQueryShape()).toEqual({ collection: 'daily_checkins', orderBy: ['createdAt', 'desc'], limit: 100 });
});

it('does not issue a history query when family history is disabled', () => {
  hydrateAdult({ role: 'parent' }, { dailyCheckins: { historyVisibleToParents: false } });
  expect(queryPaths()).not.toContain('families/family-1/daily_checkins');
  expect(useStore.getState().dailyCheckinHistoryResolved).toBe(true);
});
```

- [ ] **Step 4: Verify RED, implement conditional bounded history, verify GREEN**

Use `query(collection(db, \`families/${familyId}/daily_checkins\`), orderBy('createdAt', 'desc'), limit(100))`. Never subscribe children, never query when history is disabled, and clear previously loaded entries immediately when visibility changes off.

Run: `npx vitest run src/store/useStore.dailyCheckins.test.tsx src/store/authBootstrap.test.tsx src/store/retryBootstrap.test.ts`

- [ ] **Step 5: Commit the store slice**

```bash
git add src/store/useStore.ts src/store/useStore.dailyCheckins.test.tsx src/store/authBootstrap.test.tsx
git commit -m "feat(checkins): load daily check-in state"
```

---

### Task 5: Localized accessible modal and lockable dialog dismissal

**Files:**
- Create: `src/i18n/locales/en/checkins.json`
- Create: `src/i18n/locales/tr/checkins.json`
- Modify: `src/i18n/config.ts`
- Modify: `src/i18n/types.ts`
- Modify: `src/i18n/i18n.test.ts`
- Modify: `src/components/ui/Modal.tsx`
- Modify: `src/components/ui/Modal.test.tsx`
- Create: `src/components/checkins/DailyCheckinModal.tsx`
- Create: `src/components/checkins/DailyCheckinModal.test.tsx`

**Interfaces:**
- Consumes: `DAILY_CHECKIN_CATALOG`, `DailyCheckinAnimal` from Task 1.
- Produces `DailyCheckinModal({ open, locked, error, onSelect, onDismiss })`.

- [ ] **Step 1: Add failing namespace parity and required-copy tests**

Register `checkins` in the namespace list and typed resources, then assert English/Turkish key parity and prohibited wording absence. Required English shape:

```json
{
  "modal": { "title": "Who are you today?", "supporting": "Choose the animal that feels most like you today.", "skip": "Skip for today", "saving": "Saving your check-in…", "error": "We couldn't save that yet. Please try again." },
  "badge": { "today": "Today I'm a {{animal}}", "confirmation": "Today you're a {{animal}}." },
  "animals": {
    "cheetah": { "name": "Cheetah", "feeling": "Energetic", "aria": "Cheetah, energetic" }
  }
}
```

Include all eight animals plus settings/history/error/empty/disabled/filter/summary keys in both locale files.

Run RED then GREEN: `npx vitest run src/i18n/i18n.test.ts`

- [ ] **Step 2: Write failing Modal lock tests**

```tsx
it.each(['Escape', 'backdrop', 'close button'])('does not dismiss through %s while locked', async route => {
  const onClose = vi.fn();
  render(<Modal isOpen onClose={onClose} preventClose title="Title">Body</Modal>);
  await attemptDismiss(route);
  expect(onClose).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Verify RED, add `preventClose`, verify existing focus tests GREEN**

Extend `ModalProps` with `preventClose?: boolean`; guard Escape, backdrop, and Close, add `aria-disabled` to the close button, and preserve focus trapping/restoration. Do not change behavior when false.

Run: `npx vitest run src/components/ui/Modal.test.tsx src/components/wallet/TransactionDetailsModal.focus.test.tsx`

- [ ] **Step 4: Write failing one-tap, keyboard, dismissal, and lock tests**

```tsx
it('submits immediately with accessible animal and feeling text', async () => {
  const onSelect = vi.fn();
  render(<DailyCheckinModal open locked={false} error={null} onSelect={onSelect} onDismiss={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: /Cheetah, energetic/i }));
  expect(onSelect).toHaveBeenCalledOnce();
  expect(onSelect).toHaveBeenCalledWith('cheetah');
  expect(screen.queryByRole('button', { name: /submit/i })).not.toBeInTheDocument();
});

it.each(['close', 'escape', 'backdrop', 'skip'] as const)('routes %s through persisted dismissal', async route => {
  const onDismiss = vi.fn();
  render(<DailyCheckinModal open locked={false} error={null} onSelect={vi.fn()} onDismiss={onDismiss} />);
  if (route === 'close') await user.click(screen.getByRole('button', { name: /close/i }));
  if (route === 'escape') await user.keyboard('{Escape}');
  if (route === 'backdrop') await user.click(screen.getByTestId('modal-backdrop'));
  if (route === 'skip') await user.click(screen.getByRole('button', { name: /Skip for today/i }));
  expect(onDismiss).toHaveBeenCalledOnce();
});

it('locks every selection and dismissal control during a mutation', async () => {
  const onSelect = vi.fn();
  const onDismiss = vi.fn();
  render(<DailyCheckinModal open locked error={null} onSelect={onSelect} onDismiss={onDismiss} />);
  await user.click(screen.getByRole('button', { name: /Cheetah, energetic/i }));
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: /Skip for today/i }));
  expect(onSelect).not.toHaveBeenCalled();
  expect(onDismiss).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: Verify RED, implement responsive emoji grid, verify GREEN**

```tsx
<Modal isOpen={open} onClose={onDismiss} preventClose={locked} title={t('modal.title')}>
  <p>{t('modal.supporting')}</p>
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
    {DAILY_CHECKIN_CATALOG.map(option => (
      <button key={option.id} disabled={locked} aria-label={t(option.ariaKey)} onClick={() => onSelect(option.id)}>
        <span aria-hidden="true">{option.emoji}</span>
        <span>{t(option.nameKey)}</span><span>{t(option.feelingKey)}</span>
      </button>
    ))}
  </div>
  <button disabled={locked} onClick={onDismiss}>{t('modal.skip')}</button>
  <div role={error ? 'alert' : 'status'} aria-live="polite">{error ?? (locked ? t('modal.saving') : '')}</div>
</Modal>
```

Run: `npx vitest run src/components/checkins/DailyCheckinModal.test.tsx src/components/ui/Modal.test.tsx src/i18n/i18n.test.ts`

- [ ] **Step 6: Commit the modal/localization slice**

```bash
git add src/i18n src/components/ui/Modal.tsx src/components/ui/Modal.test.tsx src/components/checkins/DailyCheckinModal.tsx src/components/checkins/DailyCheckinModal.test.tsx
git commit -m "feat(checkins): add accessible daily check-in modal"
```

---

### Task 6: Shared dashboard experience and current-day badge

**Files:**
- Create: `src/components/checkins/DailyCheckinBadge.tsx`
- Create: `src/components/checkins/DailyCheckinExperience.tsx`
- Create: `src/components/checkins/DailyCheckinExperience.test.tsx`
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/pages/Dashboard.test.tsx`

**Interfaces:**
- Consumes: store fields from Task 4, domain eligibility from Task 1, APIs from Task 2, modal from Task 5.
- Produces: shared wrapper around both child and parent dashboard branches.

- [ ] **Step 1: Write failing unresolved/eligible/submitted tests**

```tsx
it('renders children and parents without flashing a modal until every input resolves', () => {
  seedStore({ dailyCheckinStateResolved: false, currentUser: child, familyData: enabledFamily });
  render(<DailyCheckinExperience><div>dashboard</div></DailyCheckinExperience>);
  expect(screen.getByText('dashboard')).toBeVisible();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('opens only when a fully resolved member is eligible', () => {
  seedStore({ dailyCheckinStateResolved: true, todayDailyCheckin: null, todayDailyCheckinSkip: null, currentUser: child, familyData: enabledFamily });
  renderExperience();
  expect(screen.getByRole('dialog', { name: /who are you today/i })).toBeVisible();
});

it('shows the badge only from persisted current-day record state', async () => {
  submitDailyCheckin.mockResolvedValue({ status: 'written' });
  renderExperience();
  await user.click(screen.getByRole('button', { name: /Cheetah/i }));
  expect(screen.queryByText(/Today I'm a Cheetah/i)).not.toBeInTheDocument();
  seedStoreUpdate({ todayDailyCheckin: cheetahRecord });
  expect(await screen.findByText(/Today I'm a Cheetah/i)).toBeVisible();
});
```

- [ ] **Step 2: Verify RED, implement eligibility and persisted-state rendering, verify GREEN**

Use a `useRef(false)` lock plus React state so same-tick rapid actions cannot race before rerender. Do not optimistically set check-in/skip. Close the modal only after the relevant store listener shows a persisted check-in/skip for the active day. Show one confirmation toast only when a selection initiated by this mounted experience becomes the persisted current-day record.

- [ ] **Step 3: Add failing full-lock, failure, offline-pending, and rollover tests**

```tsx
it('serializes animal, Escape, Close and Skip behind one lock', async () => {
  submitDailyCheckin.mockReturnValue(deferred.promise);
  renderExperience();
  await user.click(cheetahButton());
  await user.keyboard('{Escape}');
  await user.click(skipButton());
  expect(submitDailyCheckin).toHaveBeenCalledOnce();
  expect(skipDailyCheckin).not.toHaveBeenCalled();
});

it('retains the modal and retry after unavailable rejection', async () => {
  submitDailyCheckin.mockRejectedValue({ code: 'unavailable' });
  renderExperience();
  await user.click(cheetahButton());
  expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't save/i);
  expect(screen.getByRole('dialog')).toBeVisible();
  expect(cheetahButton()).toBeEnabled();
});
```

Also assert a pending promise shows neutral saving copy, no toast/badge/close; failed skip creates no session flag; `refreshDailyCheckinDay` is called by a short recurrence clock and the prior-day badge disappears.

- [ ] **Step 4: Verify RED, implement lock/failure/rollover behavior, verify GREEN**

Run: `npx vitest run src/components/checkins/DailyCheckinExperience.test.tsx src/pages/Dashboard.test.tsx`

- [ ] **Step 5: Mount once around both role branches**

Refactor `Dashboard` so both branches are children of the shared experience without duplicating eligibility logic:

```tsx
if (loading || !currentUser) return <PageLoader label={t('loading')} />;
return (
  <DailyCheckinExperience>
    {isParentRole(currentUser.role) ? <ParentDashboard /> : <ChildDashboardContent />}
  </DailyCheckinExperience>
);
```

Keep the existing child dashboard markup in a local focused component or function without unrelated styling changes.

- [ ] **Step 6: Add isolation regression assertions**

In the experience test, mock only `dailyCheckinsApi` and assert selection causes no calls to task, wallet, gamification, reward, feed, notification, or achievement APIs. Assert dashboard content remains accessible while the optional modal is open and after dismissal failure.

- [ ] **Step 7: Commit the shared experience slice**

```bash
git add src/components/checkins/DailyCheckinBadge.tsx src/components/checkins/DailyCheckinExperience.tsx src/components/checkins/DailyCheckinExperience.test.tsx src/pages/Dashboard.tsx src/pages/Dashboard.test.tsx
git commit -m "feat(checkins): add shared daily dashboard experience"
```

---

### Task 7: Parent history

**Files:**
- Create: `src/components/checkins/DailyCheckinHistory.tsx`
- Create: `src/components/checkins/DailyCheckinHistory.test.tsx`
- Modify: `src/components/parent/ParentDashboard.tsx`
- Modify: `src/components/parent/ParentDashboard.test.tsx`

**Interfaces:**
- Consumes: `dailyCheckinHistory`, resolution/settings/member data from Task 4; catalog/summary helpers from Task 1.
- Produces: owner/parent-only history section.

- [ ] **Step 1: Write failing disabled/empty/filter/chronology tests**

```tsx
it('shows a disabled state and no entries when family history is off', () => {
  renderHistory({ historyVisibleToParents: false, records: [record] });
  expect(screen.getByText(/history is turned off/i)).toBeVisible();
  expect(screen.queryByText('Alex')).not.toBeInTheDocument();
});

it('filters newest-first entries by member', async () => {
  renderHistory({ historyVisibleToParents: true, records: [olderAlex, newerSam] });
  await user.selectOptions(screen.getByRole('combobox', { name: /family member/i }), 'alex');
  expect(screen.getByText('Alex')).toBeVisible();
  expect(screen.queryByText('Sam')).not.toBeInTheDocument();
});

it('reports only explicit seven-day selections with neutral wording', () => {
  renderHistory({ records: threeTiredSelections });
  expect(screen.getByText("Alex selected ‘Tired’ three times in the last seven days.")).toBeVisible();
  expect(document.body).not.toHaveTextContent(/depress|anxious|risk|abnormal/i);
});
```

- [ ] **Step 2: Verify RED, implement the focused component, verify GREEN**

Render a settings-controlled disabled state before inspecting records; a resolved loading state; an all-members/member `<select>`; a seven-day `<ul>` summary; and a recent `<ol>` containing localized date, member, emoji/name, and feeling. Resolve member names from same-family store members and use a localized `unknownMember` fallback.

Run: `npx vitest run src/components/checkins/DailyCheckinHistory.test.tsx`

- [ ] **Step 3: Add failing role integration test and mount in ParentDashboard**

Assert owners and regular parents render history; child dashboard never imports/renders it. Place it after family summaries and before recent activity so it is visible but non-intrusive.

Run: `npx vitest run src/components/parent/ParentDashboard.test.tsx src/components/checkins/DailyCheckinHistory.test.tsx`

- [ ] **Step 4: Commit the history slice**

```bash
git add src/components/checkins/DailyCheckinHistory.tsx src/components/checkins/DailyCheckinHistory.test.tsx src/components/parent/ParentDashboard.tsx src/components/parent/ParentDashboard.test.tsx
git commit -m "feat(checkins): add parent check-in history"
```

---

### Task 8: Role-aware Settings card

**Files:**
- Create: `src/components/settings/DailyCheckinSettings.tsx`
- Create: `src/components/settings/DailyCheckinSettings.test.tsx`
- Modify carefully: `src/pages/Settings.tsx`
- Modify carefully: `src/pages/Settings.test.tsx`

**Interfaces:**
- Consumes: `updateFamilySettings` and `updateParentDailyCheckinPreference`; current user/family store data.
- Produces: owner controls for both family fields plus self participation; regular-parent self participation only; no child surface.

- [ ] **Step 1: Snapshot the user's overlapping Settings changes**

Run: `git diff -- src/pages/Settings.tsx src/pages/Settings.test.tsx`

Record the current hunks in the task notes and edit only imports plus the parent-settings render location. Do not stage unrelated pre-existing Settings hunks in the feature commit; if separation is impossible, stop and ask the user before committing.

- [ ] **Step 2: Write failing role-visibility tests**

```tsx
it('shows all three controls to the owner', () => {
  renderSettings({ role: 'owner' });
  expect(screen.getByRole('switch', { name: /Enable check-ins for children/i })).toBeVisible();
  expect(screen.getByRole('switch', { name: /Participate as a parent/i })).toBeVisible();
  expect(screen.getByRole('switch', { name: /Show check-in history/i })).toBeVisible();
});

it('omits owner-only controls for a regular parent', () => {
  renderSettings({ role: 'parent' });
  expect(screen.getByRole('switch', { name: /Participate as a parent/i })).toBeVisible();
  expect(screen.queryByRole('switch', { name: /Enable check-ins for children/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('switch', { name: /Show check-in history/i })).not.toBeInTheDocument();
});

it('renders no Daily Check-in settings for a child', () => {
  renderSettings({ role: 'child' });
  expect(screen.queryByText(/Daily Check-ins/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Verify RED, implement card using existing toggle/card patterns, verify GREEN**

Use one saving key per toggle, `role="switch"`, `aria-checked`, disabled pending state, and persisted store values as source of truth. Family toggles send the complete nested family setting so sibling values are preserved.

- [ ] **Step 4: Add failing write/failure tests**

Assert owner changes call only `updateFamilySettings`; parent preference calls only the self API with `currentUser.id`; rapid double click is locked; rejection displays localized error and restores persisted checked state.

Run: `npx vitest run src/components/settings/DailyCheckinSettings.test.tsx src/pages/Settings.test.tsx`

- [ ] **Step 5: Mount in Settings and commit only owned hunks**

```bash
git add src/components/settings/DailyCheckinSettings.tsx src/components/settings/DailyCheckinSettings.test.tsx
git add -p src/pages/Settings.tsx src/pages/Settings.test.tsx
git diff --cached --check
git commit -m "feat(checkins): add parent check-in settings"
```

---

### Task 9: Family, account, child, export, and reset lifecycle

**Files:**
- Modify: `functions/src/familyDeletion.ts`
- Modify: `functions/src/familyDeletion.test.ts`
- Modify: `functions/src/childDeletion.ts`
- Modify: `functions/src/childDeletion.test.ts`
- Modify: `functions/src/accountDeletion.ts`
- Modify: `functions/src/accountDeletion.test.ts`
- Modify: `scripts/lib/family-data-tools.ts`
- Modify: `tests/scripts/resetFamilyData.test.ts`

**Interfaces:**
- Consumes: collection names `daily_checkins`, `daily_checkin_skips`; record field `userId`.
- Produces: no orphaned records after family/account/child deletion; dynamic export inclusion; explicit reset inclusion.

- [ ] **Step 1: Write failing family-registry tests**

```ts
expect(FAMILY_SUBCOLLECTION_REGISTRY).toEqual(expect.arrayContaining([
  'daily_checkins', 'daily_checkin_skips',
]));
expect(new Set(FAMILY_SUBCOLLECTION_REGISTRY).size).toBe(FAMILY_SUBCOLLECTION_REGISTRY.length);
```

Seed both documents in the integration fixture and assert recursive family deletion removes them.

- [ ] **Step 2: Verify RED, add both registry entries, verify GREEN**

Run: `npx vitest run functions/src/familyDeletion.test.ts functions/src/familyDeletion.integration.test.ts`

- [ ] **Step 3: Write failing per-user deletion tests**

Seed check-in and skip documents for the target and another member. Assert managed-child deletion and self-account deletion remove only documents whose `userId` equals the deleted profile ID and preserve the other member's documents.

- [ ] **Step 4: Verify RED, implement bounded query cleanup, verify GREEN**

Do not add these collections to the existing `childSpecificCollections` loop because that loop filters on `childId`. Add a focused helper that queries `daily_checkins` and `daily_checkin_skips` with `where('userId', '==', childId).limit(500)`, then deletes returned refs through the existing batch flow. Add the equivalent helper to `accountDeletion.ts`; invoke it before `purgeProfile` in the no-family, non-owner, successor-transfer, and orphaned-owner completion branches. Sole-owner family deletion needs no per-user pass because recursive family deletion removes both collections.

Run: `npx vitest run functions/src/childDeletion.test.ts functions/src/accountDeletion.test.ts`

- [ ] **Step 5: Write failing export/reset tests**

```ts
expect(exported.subcollections).toHaveProperty('daily_checkins');
expect(exported.subcollections).toHaveProperty('daily_checkin_skips');
expect(OPERATIONAL_SUBCOLLECTIONS).toEqual(expect.arrayContaining(['daily_checkins', 'daily_checkin_skips']));
```

Seed both collections and assert reset dry-run reports their counts and execute deletes them. Export remains dynamic; add assertions, not a redundant special-case exporter.

- [ ] **Step 6: Verify RED, add reset registry entries, verify GREEN**

Run: `npx vitest run tests/scripts/resetFamilyData.test.ts`

- [ ] **Step 7: Commit lifecycle changes**

```bash
git add functions/src/familyDeletion.ts functions/src/familyDeletion.test.ts functions/src/childDeletion.ts functions/src/childDeletion.test.ts functions/src/accountDeletion.ts functions/src/accountDeletion.test.ts scripts/lib/family-data-tools.ts tests/scripts/resetFamilyData.test.ts
git commit -m "feat(checkins): clean up daily check-in data"
```

---

### Task 10: Cross-feature regression and full verification

**Files:**
- Modify focused tests only where a coverage gap remains.
- Do not add production behavior in this task; any discovered bug starts a new RED test in its owning task/file before the fix.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: release evidence for behavior, privacy, accessibility, rules, lifecycle, and isolation.

- [ ] **Step 1: Run focused unit/component suites**

```bash
npx vitest run \
  src/lib/dailyCheckins.test.ts \
  src/lib/dailyCheckinsApi.test.ts \
  src/store/useStore.dailyCheckins.test.tsx \
  src/components/checkins \
  src/components/settings/DailyCheckinSettings.test.tsx \
  src/pages/Dashboard.test.tsx \
  src/components/parent/ParentDashboard.test.tsx \
  src/i18n/i18n.test.ts
```

Expected: all PASS, no warnings or unhandled rejections.

- [ ] **Step 2: Run Firestore emulator suites**

```bash
npm run test:rules
```

Expected: all rules tests PASS, including same-family/cross-family, disabled history, exact V1 schema, request-time timestamps, and transaction precedence.

- [ ] **Step 3: Run Functions and lifecycle suites**

```bash
npx vitest run functions/src/familyDeletion.test.ts functions/src/childDeletion.test.ts functions/src/accountDeletion.test.ts
```

Run: `npx vitest run tests/scripts/resetFamilyData.test.ts`

Expected: PASS.

- [ ] **Step 4: Run project-wide quality gates**

```bash
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

Expected: every command exits 0. Investigate pre-existing failures separately; do not weaken tests or lint rules.

- [ ] **Step 5: Audit privacy, analytics, and gamification isolation**

```bash
rg -n "depress|anxious|mentally unwell|abnormal|at risk|logEvent|getAnalytics|rewardPoints|lifetimeXP|currentStreak|wallet|achievement" \
  src/components/checkins src/lib/dailyCheckins* src/i18n/locales/{en,tr}/checkins.json
```

Expected: no prohibited or analytics terms; gamification/wallet terms appear only in negative isolation tests if at all. Inspect every match.

- [ ] **Step 6: Inspect final scope and commit any test-only verification additions**

```bash
git status --short
git diff --stat HEAD~10..HEAD
git log --oneline -12
```

Confirm unrelated pre-existing changes remain unstaged/uncommitted. If verification required additions to the two feature regression suites, commit them as:

```bash
git add src/components/checkins/DailyCheckinExperience.test.tsx tests/firestore/dailyCheckins.rules.test.ts
git commit -m "test(checkins): cover daily check-in regressions"
```

- [ ] **Step 7: Apply completion verification skill**

Invoke `superpowers:verification-before-completion`, rerun any commands it requires, and report exact pass/fail evidence, commits, and any preserved unrelated working-tree changes.
