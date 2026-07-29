# Family Bulletin Implementation Plan

1. Add announcement types, audience/active/sort helpers, Firestore APIs, and focused unit tests.
2. Add Firestore announcement/read rules and emulator tests for family-wide, child-specific, adult-only, cross-family, child writes, own read state, and linked-resource validation.
3. Add the audience-safe realtime hook and reusable bulletin card with unread state, expansion, scheduling, pin ordering, and linked task/reward navigation.
4. Add the localized authoring modal, existing-task linking, and one-time task creation through the existing task API.
5. Mount the bulletin below both parent and child dashboard headers, with parent authoring controls only.
6. Add mounted-language, scheduling, ordering, task-link, and no-gamification-side-effect regression tests.
7. Run focused tests, the full Firestore predeploy suite, `npm test`, `npm run build`, and `git diff --check`.
8. Commit as `feat(home): add family bulletin announcements`.
9. Deploy Firestore rules and hosting to `familyquest-beta-402cb`, then verify the production URL.
