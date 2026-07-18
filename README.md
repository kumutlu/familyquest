# FamilyQuest

A family gamification platform for chores, habits, rewards, behaviour tracking and family goals.

## Features
- **Chores & Habits:** Track daily, weekly, and one-off tasks.
- **Rewards System:** Earn points and redeem them for real-world rewards.
- **Behaviour Tracking:** Ad-hoc positive and negative points adjustments.
- **Wallet & Ledger:** Separate real-money allowance tracking with savings goals.
- **Family Hub:** Shared leaderboard and activity feed.

## Getting Started
1. `npm install`
2. `npm run dev`

## Family data maintenance

The only supported production-data utilities are the reviewed Admin SDK tools in `scripts/export-family-data.ts` and `scripts/reset-family-data.ts`. They require explicit project and family identifiers and Application Default Credentials. Generated exports are written with restricted permissions under the gitignored `family-data-exports/` directory.

Export a family before maintenance:

```bash
npm run data:export -- --project PROJECT_ID --family-id FAMILY_ID
```

Preview a reset without writing data:

```bash
npm run data:reset:dry-run -- --project PROJECT_ID --family-id FAMILY_ID --confirm-family-name "Exact Family Name"
```

The reset defaults to dry-run and fails closed on unknown, duplicate, or conflicting flags. `npm run data:reset` is the explicit execute path; use it only after reviewing the dry-run manifest and backup requirements. Ad hoc root-level repair, migration, investigation, and live-probe scripts are not supported.
