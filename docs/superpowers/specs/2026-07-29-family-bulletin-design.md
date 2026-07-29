# Family Bulletin Design

## Existing architecture

The Home route renders `ParentDashboard` for owners/parents and `Dashboard` for children. Both already receive the authoritative profile, family members, tasks, and family document through the existing Zustand bootstrap. Notifications use a family-scoped collection plus per-user read documents. Tasks are family-scoped and the existing `createTask` API creates tasks and feed entries atomically. Firestore role helpers enforce family isolation.

## Data model

Announcements live at `families/{familyId}/announcements/{announcementId}` with:

- `familyId`, `title`, `message`
- `type`: `general | rule_change | consequence | new_task | reward_update | event | urgent`
- `audienceType`: `family | children | adults | selected`
- `audienceUserIds`: validated same-family user IDs (empty for broad audiences)
- `priority`: `normal | important | urgent`
- optional `linkedTaskId`, `linkedRewardId`, `linkedSettingChangeId`
- optional `startsAt`, `expiresAt`
- `pinned`, `status`: `active | archived`
- `createdBy`, `createdAt`, `updatedAt`

Read state lives at
`families/{familyId}/announcement_reads/{announcementId_userId}` with
`familyId`, `announcementId`, `userId`, `readAt`. It is never embedded into
the announcement. The deterministic ID prevents duplicate receipts and allows
one bounded current-user query instead of one listener per announcement.

## Reads and subscriptions

Parents/owners subscribe once to the family announcement collection. Children use three rule-compatible queries and merge them: family-wide, all-children, and `audienceUserIds array-contains childId`. This prevents downloading adult-only or other-child announcements. Read state uses one current-user collection-group listener under the visible announcement documents only when needed; initial implementation writes and derives local read state without creating notifications.

Active visibility is derived from authoritative fields: status active, start reached, expiry not reached, and audience match. Pinned sorts first, then priority, then creation time. Expired records remain in Firestore history.

## Authoring and task integration

Owners and parents get a “Create announcement” action immediately below the dashboard header. The form validates title/message/type/audience/priority/schedule/pinning. It can link an existing family task. A compact “create one-time task” section calls the existing task API, receives the new task ID, and stores only that reference on the announcement.

Free text never changes rewards, XP, penalties, or settings. A rule-change announcement is informational unless it links to an existing authoritative setting-change ID.

## Security

Firestore rules:

- permit only same-family owner/parent create/update/delete;
- require a closed field/type/status/priority/audience allowlist;
- require `createdBy` to be the authenticated profile identity;
- validate selected recipients and linked task/reward documents belong to the same family path;
- allow parents to read all family announcements;
- allow children to read only family-wide, all-child, or explicitly selected announcements;
- allow only a user to create/update their own read document, with `readAt == request.time`;
- deny cross-family access and child authoring.

Managed-child identity continues to resolve through trusted claims. The password-change restricted state remains unable to read announcements because `isFamilyMember` is false while restricted.

## Localization and compatibility

All chrome, labels, type names, audience names, actions, validation, and empty states use the existing i18n provider. Parent-authored title/message remain unchanged. No migration is required; families without announcements render no bulletin.

## Notifications

Announcement notifications are deliberately deferred. They are optional in the request, and omitting them avoids duplicate activation notifications for scheduled announcements without adding a trusted scheduler.
