# Production Hosting rollback: onboarding initial-task regression

- Current production SHA: `bd175a50cb76569ca65483d20af04e1b6e6bfab9`
- Approved rollback SHA: `7316472f933cc6e8e1b963927f9d0c39b33a64f1`
- Owner: production release operator
- Reason: verified onboarding created the family, managed child, and wallet but skipped the required initial-task flow and landed on the dashboard with zero task/feed setup records.
- Expected outcome: restore the previous verified Hosting release without changing Functions, Firestore Rules, indexes, Storage, Firebase configuration, or QA data.

The one-purpose recovery script verifies both full SHAs, builds the rollback target
in an isolated worktree, deploys Hosting only, and verifies the uncached live
embedded SHA after release.
