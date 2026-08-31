# Smart Notifications V1 — Design & Trust-Boundary Note

**Date:** 2026-08-31
**Package:** Smart Notifications V1 + Weather-aware Morning Brief
**Branch base:** `integration/engagement-foundation` @ `6c2eaae`
**Author:** Notifications workstream

## 1. Architectural law (pinned)

The three engines stay separate:

| Engine              | Decides                       | Authority |
|---------------------|-------------------------------|-----------|
| Engagement Engine   | is something worth surfacing? | read-only |
| Notification Engine | whether/when/how to deliver?   | delivery  |
| Gamification Engine  | awards value                   | authoritative |

**Notifications NEVER:**

- award XP
- award points
- create completion records
- mutate streaks
- mutate Surge eligibility
- bypass task approval
- create gamification events

The Notification Engine consumes state (Surge, streak, family progress,
seasonal, quests remaining, weather). It does not create value.

## 2. Existing foundations reused

- `src/domain/engagement/preferences.ts` — closed-shape preference pattern.
- `src/domain/engagement/resolver.ts` — read-only Daily Engagement output.
- `src/domain/surge/types.ts` — Surge catalog & `isInWindow`.
- `firestore.rules:isValidEngagementPreferences` — closed-key write validator.
- `firestore.rules:1953–1975` — family `isParent(familyId)` update surface.
- `functions/src/pushDelivery.ts` — existing FCM in-app notification delivery
  (consumer of `families/{familyId}/notifications`). This V1 does NOT
  re-route Smart Notifications through FCM; we keep the domain + scheduling
  + delivery record abstraction so production push enablement is a
  focused future change.

## 3. New closed-shape surface

`families/{familyId}/notificationPreferences` (single document, server-validated shape).

Key set (closed):
`enabled, intensity, quietHours, morningBrief, weather, questReminders,
surgeAlerts, streakAlerts, familyProgress, seasonalEvents, weatherLocation`

Rules: parent-writable, closed shape, intensities constrained to a string
union, quietHours HH:mm, weatherLocation only coarse fields (countryCode,
postalArea, city, timezone). No latitude / longitude. `notificationPreferences`
writes cannot include changes to other family fields; the family-update
clause `request.resource.data.diff(resource.data).affectedKeys().hasOnly`
rejects unrelated mutations in the same write.

`families/{familyId}/notification_state/{childId}` — server-owned delivery
counter. `allow read: if isParent(familyId) || (isAuthenticated() &&
authProfileId() == childId)`, `allow write: if false` (server-only).

`families/{familyId}/notification_delivery/{dedupeKey}` — server-owned
delivery reservation. `allow read, write: if false` (server-only).

## 4. Notification decision engine — pure

Path: `src/domain/notifications/`.

No Firebase imports. No push API imports. No `Date.now()` inside the
resolver. Clock + timezone injected.

Required deterministic tests (see §29 of the spec):

- disabled → suppressed
- intensity off → suppressed
- quiet hour → suppressed (boundary: 20:29 allowed, 20:30 suppressed,
  06:59 suppressed, 07:00 allowed; cross-midnight pinned)
- daily cap reached → suppressed
- duplicate → suppressed
- active Surge beats normal quest reminder
- streak risk beats family progress
- family progress beats seasonal
- seasonal beats morning brief
- morning brief beats generic quest reminder
- morning brief outside morning window → no morning brief
- weather unavailable → morning brief can still send
- weather available → included
- intensity caps: high=3, normal=2, low=1, off=0

## 5. Priority order (pinned)

1. Time-sensitive Surge
2. Streak at risk
3. Family progress (child could finish today)
4. Seasonal discovery
5. Morning brief (07:00–10:30 local only)
6. Generic quest reminder

One evaluation cycle returns at most ONE selected notification.

## 6. Daily cap (pinned)

Derived from `intensity` via `intensityToMaxPerDay(intensity)`. Never
trust a client-provided numeric `maxPerDay` — the resolver ignores any
such input.

```
off    → 0
low    → 1
normal → 2
high   → 3
```

A critical Surge MUST NOT exceed the family cap. No "emergency override"
in V1.

## 7. Quiet hours

`quietHours` is interpreted in **family local time** (timezone comes from
`weatherLocation.timezone` or family.defaultTimezone; default
`Europe/London` for UK). Cross-midnight windows handled explicitly by
splitting into [start, 24h) ∪ [0h, end) for boundary check. Pinned by
test cases 20:29 / 20:30 / 23:45 / 00:15 / 06:59 / 07:00.

## 8. Weather provider abstraction

`src/lib/weather/WeatherProvider.ts`:

```
interface WeatherProvider {
  getDailyWeather(input: { location; localDate }): Promise<WeatherContext | null>
}
```

Implementations shipped in V1:

- `FakeWeatherProvider` — fully deterministic, used in tests.
- `DisabledWeatherProvider` — always returns `null`, used when the family
  has no `weatherLocation` or when the operator has not configured a
  provider secret.

V1 does NOT integrate a live vendor. No API keys are read at runtime.
The provider secret path is documented and the live adapter is a
scaffold-only stub that is NOT exported from the production index.

## 9. Cache

`weather_cache/{locationKey}_{yyyy-mm-dd}`. TTL: 2 hours. Family-level
key — a household with N children causes ONE weather fetch.

## 10. Delivery abstraction

`src/domain/notifications/delivery.ts`:

```
interface NotificationDeliveryProvider {
  send(payload): Promise<DeliveryResult>
}
```

`FakeDeliveryProvider` is shipped for tests. Production wiring is left
as a focused future PR (FCM tokens, service worker, permission UX).
This V1 explicitly does not bolt on production push.

## 11. Idempotency / concurrency

Reservation contract (`families/{familyId}/notification_delivery/{dedupeKey}`):

```
status: 'reserved' → 'sent' | 'failed'
```

Server-only writes. Two evaluators racing for the same dedupe key: only
one wins; the other observes `alreadyExists` and exits. Retries only
occur for `failed` records whose `reservedAt` is within the retry window.

## 12. Rollout behaviour

Per spec §28, for existing families with no explicit notification
preference:

> "Notifications remain disabled until parent opts in."

So the rollout default is `notifications.enabled = false`, with the
product docs saying `enabled=true,intensity='high'` is the AUTHORITATIVE
preferred state once a parent opts in. The Decision Engine must treat
`!prefs.enabled` as a hard "suppressed (disabled)" reason.

This package ships the surface but does NOT enable notifications for
existing families automatically. The next rollout PR must run a one-time
backfill that writes `{ enabled: false, intensity: 'high', ... }` for
families that have not opted in — and only AFTER parent notification
permission UX is in place. No backfill is shipped in this V1.

## 13. Settings UI

Parent Settings exposes (parent-facing copy, no internal jargon):

- Master toggle (On / Off)
- Frequency: Low / Normal / High
- Morning brief (toggle)
- Weather in morning brief (toggle)
- Quest reminders (toggle)
- Surge alerts (toggle)
- Streak reminders (toggle)
- Family progress (toggle)
- Seasonal events (toggle)
- Quiet hours (HH:mm → HH:mm)
- Weather location: city / postal area (coarse)

Child UI exposes none of these.

## 14. Permission UX (documented only)

V1 does NOT request browser notification permission on first load. The
documented flow: parent enables notifications in Settings → app
explains what they are for → user taps "Enable notifications" → browser
permission request. No dark patterns.

## 15. What V1 explicitly does NOT do

(Listed in spec §34.) Repeated here for traceability:

- AI-generated notification messages
- School timetable/calendar
- Birthday automation
- Mystery Drops
- Comeback missions
- Sibling competition notifications
- Rich image push
- Notification sounds customization
- Per-child custom schedules
- A/B experiments
- ML ranking
- Exact GPS weather

## 16. Integration constraint (pinned)

Smart Notifications V1 MUST NOT modify:

- `processApprovedCompletion`
- `rewardPoints`
- `xpTotal`
- `gamification_events` award semantics
- Surge award evaluator
- task completion Rules

If any of these need to change, STOP and explain.

## 17. Verification gates

- New: Decision Engine tests, message catalog tests, quiet-hours/timezone
  tests, dedupe/idempotency tests, Rules tests, weather provider/cache
  tests, delivery state tests, parent Settings tests.
- Regression: full relevant Firestore Rules, Surge, Daily Engagement,
  Hold-to-Complete, managed child, parent approval, gamification
  Functions suite.
- Build: `npm run typecheck`, `npm run lint`, `npm run build`,
  `git diff --check`.
- For repo-wide baseline failures: NEW_FAILURES must equal 0.

## 18. NO DEPLOY

This package merges to the integration branch; production deployment is
explicitly out of scope and is performed by a separate rollout PR.