# Production Hosting rollback: duplicate Create/Join

- Current production SHA: `eccfcd897be873eeca3d4057c5510f30c56ed717`
- Approved rollback SHA: `8d07040cda23200e4567588477eece1537421998`
- Owner: production release operator
- Reason: production onboarding timed out and Retry exposed the second Create/Join screen.
- Expected outcome: restore the previous known-good Hosting release without changing Functions, Firestore Rules, indexes, or Storage.

The one-purpose recovery script verifies both full SHAs, builds the rollback target
in an isolated worktree, deploys Hosting only, and verifies the uncached live
embedded SHA after release.
