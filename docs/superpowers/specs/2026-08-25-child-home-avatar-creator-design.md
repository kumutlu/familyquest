# Child Home Enrichment and Avatar Creator Design

## Scope

Enrich Child Home with canonical Goals and Pet Box summaries, and replace the limited child avatar choice with a safe composable creator. Preserve Parent behavior, legacy avatars, premium avatar ownership, accounting, and the existing child-to-parent profile approval workflow.

## Child Home

`ChildLivingHome` consumes the already-published Zustand `savingsGoals`, `funds`, `fundTransactions`, and `familyData`. A pure selector chooses one active/reached goal from the child's already-filtered goal set, preferring the highest completion ratio with stable tie-breaking. It never queries Firestore and never receives sibling goals.

After the existing focus and encouragement content, a `Your goals` section renders a live goal summary and, when `isPetBoxEnabled(familyData)` is true, a Pet Box summary. Cards use semantic links to `/goals` and `/pet-box`. They form two columns at tablet/desktop widths and one column on mobile. Pet Box disappears rather than showing a disabled placeholder. Goal values retain the existing goal privacy boundary.

## Avatar configuration

```ts
interface AvatarConfigV1 {
  version: 1;
  base: 'round' | 'soft' | 'bold';
  skinTone: 'porcelain' | 'fair' | 'warm' | 'tan' | 'brown' | 'deep';
  hairStyle: 'short' | 'crop' | 'bob' | 'waves' | 'long' | 'curls' | 'coils' | 'ponytail';
  hairColor: 'black' | 'brown' | 'chestnut' | 'blonde' | 'copper' | 'pink' | 'purple' | 'blue';
  face: 'smile' | 'happy' | 'bright' | 'calm' | 'cheeky';
  accessory: 'none' | 'glasses' | 'round-glasses' | 'cap' | 'beanie' | 'headband';
  outfit: 'tee' | 'hoodie' | 'jacket' | 'sweater';
  outfitColor: 'purple' | 'indigo' | 'blue' | 'teal' | 'green' | 'coral' | 'pink' | 'gold';
  background: 'lilac' | 'sky' | 'mint' | 'peach' | 'sunny' | 'berry';
}
```

Every value is validated against a closed allowlist. Unknown keys, missing keys, wrong versions, non-string values, and unknown enum values are invalid. No URL, SVG, CSS, upload, or free-form value is accepted.

## Rendering and compatibility

A pure canonical avatar module validates the config and produces deterministic SVG markup/data URLs from bundled layer definitions. SVG values originate only from code-owned palettes and paths. The resolution order is:

1. Valid `avatarConfig`
2. Valid legacy `avatarId`
3. Existing `avatarUrl`
4. Initials/default fallback

Profile normalization derives the displayed `avatarUrl` from this resolver so existing avatar consumers remain consistent. Legacy profiles without `avatarConfig` render exactly as before. Premium catalog selection and point ownership remain unchanged and available as classic avatars.

## Creator UX

The existing profile editor hosts a large preview and category-chip editor. One category's options are visible at a time. Save, Cancel, and Surprise Me are explicit. Cancel never mutates persistence. Surprise Me chooses only allowed values. Child saves continue to create a `profile_update_requests` document; adults retain their current safe direct-edit behavior.

## Persistence and security

User documents may contain `avatarConfig`. Profile requests add `requestedAvatarConfig` and `currentAvatarConfig`. Rules validate both with closed key and enum checks. Create remains restricted to `childId == authProfileId()` in the same active family. Children still cannot directly write profile avatar fields. Parent approval may update only `displayName`, `avatarUrl`, `avatarId`, and `avatarConfig`; unrelated profile fields remain prohibited.

Approval code revalidates the request before applying it. Archive/restore lifecycle snapshots preserve `avatarConfig`. No creator option uses reward points and no unlock documents are written.

## Verification

TDD covers selectors, routes, responsive structure, privacy preservation, deterministic rendering, malformed fallback, category changes, save/cancel, approval payloads, legacy fallback, and shared presentation. Firestore emulator tests cover valid configs; invalid version, keys, values, and shapes; direct child writes; sibling requests; cross-family requests; and parent approval boundaries. Authenticated emulator browser QA covers Parent and Child accounts at 1440×900, 768×1024, 390×844, and 412×915 in light and dark modes.

## Safety

No wallet, ledger, points, XP, goal accounting, Pet Box accounting, index, migration, or service-worker behavior changes. The Rules and lifecycle changes are confined to the new presentation-only avatar configuration.
