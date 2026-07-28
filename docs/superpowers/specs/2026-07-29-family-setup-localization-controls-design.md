# Family Setup and Localization Controls Design

## Scope

This change addresses five connected production issues:

1. Signup and login use distinct Google authentication labels.
2. Family setup uses authoritative loaded family data and persisted completion.
3. Pet Box becomes an owner-controlled, family-level optional feature.
4. Family timezone settings support canonical IANA timezones.
5. Mounted navigation and related controls react immediately to language changes.

The implementation reuses the existing authentication, managed-child, family invitation,
family-settings, store, and i18n systems. It does not introduce parallel member, settings,
or authentication models.

## Family Setup State

The family document gains an extensible `setup` object:

```ts
{
  setup: {
    welcomePromptCompleted: true,
    completedAt: serverTimestamp(),
    completedBy: uid,
  }
}
```

The object is intentionally suitable for future one-time setup milestones without another
root-schema redesign. Firestore rules permit only an owner to modify `setup`. The welcome
prompt update validates the known keys, boolean completion value, server timestamp, and
`completedBy == request.auth.uid`. Children and non-owner parents cannot modify setup state.

The prompt is evaluated only when `appReady` is true and the existing subscriptions have
authoritatively loaded the family document, family members, and any managed members
represented by the member subscription. An unresolved query can never be interpreted as
an empty family. The implementation reuses bootstrap state and subscriptions rather than
adding reads or listeners during navigation.

For an incomplete setup:

- Zero children: the primary action is “Add a child.”
- One or more children: the primary action is “Add another child.”
- The secondary action is “Add a parent or adult.”
- “Skip for now” remains available and does not block app access.

The child action reuses the existing secure managed-child wizard. Successful child creation
persists setup completion. A failed creation leaves the setup prompt incomplete.

The adult action opens the existing family invitation interface and exposes the current
invite code. It never creates a parent, assigns a role, or introduces another invitation
system. Opening the interface or copying the code does not complete the setup prompt.

“Skip for now” persists setup completion. If persistence fails, the app remains usable,
the prompt remains eligible to appear again, friendly non-blocking feedback is shown, and
the failure is logged. Repeated blocking dialogs are never shown. Local storage is not
authoritative for prompt visibility or completion.

## Pet Box Feature Setting

The family document gains a root-level `petBoxEnabled` boolean:

- Missing value means enabled.
- `true` means enabled.
- `false` means disabled.

This preserves existing production behavior and data for legacy families. Disabling Pet Box
never deletes funds, requests, transactions, reversals, or notifications.

Only owners can modify `petBoxEnabled`, through the existing allowlisted family-settings API.
Firestore validates its boolean type and retains existing owner-only family update security.

A shared feature resolver consumes the family document already held by the existing store.
It is reused by UI entry points, route guards, client APIs and helpers. Firestore rules and
any server/backend Pet Box entry points also enforce the setting, so direct API calls cannot
bypass it. No additional normal-navigation reads or listeners are introduced.

When disabled, Pet Box cards, widgets, request actions, and entry points are hidden for every
family member, including children. Direct navigation to the Pet Box route redirects safely.
Notification routes that would enter Pet Box resolve to a safe fallback. Pet Box writes are
denied while disabled; existing records remain readable where needed by existing history
and audit flows. Re-enabling the feature exposes the existing state again.

Server data reads remain non-destructive. Missing `petBoxEnabled` and missing `setup` are
legacy-compatible and require no migration. Existing family isolation, ledger validation,
role restrictions, and protected user balances remain unchanged.

## Timezone Selection

Timezone values remain canonical IANA identifiers. The selector uses
`Intl.supportedValuesOf('timeZone')` where supported and a bundled canonical fallback where
it is not. The fallback covers the UK, Europe, Türkiye, North America, Asia, the Middle East,
Africa, and Australia, including `Europe/Istanbul`.

Any valid existing saved timezone is retained in the options even if the current runtime
does not enumerate it. User-facing labels are derived from region and city names, with
localized formatting where practical; translated labels are never persisted.

No large timezone dependency is added.

## Localization

Signup uses `continueWithGoogle`; login continues to use `signInWithGoogle`. Both keys exist
in every supported locale and the underlying Google authentication behavior is unchanged.

Navigation configuration exposes translation keys instead of English display strings.
Desktop and mobile navigation translate those keys during render with the existing i18n
provider. Any sidebar, profile menus, settings navigation tabs, and mounted page headings
are audited to use the same reactive translation source. Changing language while remaining
on the current page updates every mounted navigation label without remounting `AppLayout`.
Changing language does not require a refresh, forced navigation, duplicated language state,
or timers.

## Error Handling

- Setup completion failures are logged and shown as friendly non-blocking feedback; the app
  remains usable and the prompt remains eligible to appear again.
- Child creation failures do not complete setup.
- Opening or copying invitation details does not complete setup.
- Pet Box setting failures leave the previous authoritative family value in effect.
- Invalid or unavailable timezone enumeration falls back to a maintained canonical list.
- Disabled Pet Box direct routes redirect without mutating data.

## Testing and Delivery

Focused regression coverage includes:

- Signup and login Google button wording in every locale.
- Mounted desktop and mobile navigation changing language immediately.
- Setup prompt suppression before authoritative loading completes.
- Zero-child and existing-child wording.
- Existing managed-child flow reuse.
- Existing invitation UI reuse without false completion.
- Skip and successful child completion persistence.
- Pet Box setting defaults, owner toggle, hidden entry points, route blocking, and child behavior.
- Pet Box client API, helper, Firestore rule, and backend enforcement when disabled.
- Family-settings API allowlisting and Firestore owner-only validation.
- Canonical timezone loading, `Europe/Istanbul`, selection, and persistence.
- Every mounted navigation label changing language without remounting `AppLayout`.

After focused tests, run:

1. The complete Firestore predeploy command configured in `firebase.json`.
2. `npm test`.
3. `npm run build`.
4. `git diff --check`.

Create scoped logical commits:

1. `feat(setup): improve family setup flow`
2. `feat(settings): add Pet Box family feature toggle`
3. `feat(i18n): complete reactive navigation localization`
4. `feat(settings): expand timezone support`

Because Firestore rules change, deploy rules and hosting together from this repository:

`firebase deploy --only firestore:rules,hosting`

Verify the deployed project is `familyquest-beta-402cb`.
