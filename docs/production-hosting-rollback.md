# Production Hosting rollback recovery

The normal production Hosting deploy command must never be used for a rollback.
It intentionally blocks candidates older than or diverged from the live build.

If a rollback is genuinely required:

1. Open a production incident recording the current full SHA, proposed rollback
   full SHA, reason, owner, and expected recovery outcome.
2. Obtain explicit review approval for that exact rollback SHA.
3. Create a dedicated recovery PR containing a one-purpose rollback script. The
   script must not modify the normal deploy guard and must require both the
   acknowledged current-production full SHA and exact rollback full SHA.
4. Run the reviewed script only from a fresh, clean isolated checkout. It must
   verify the live full SHA, verify the rollback target is the approved commit,
   build that exact commit, and invoke Firebase with `--only hosting --project
   familyquest-beta-402cb`.
5. Fetch uncached production `index.html` and its main JavaScript bundle after
   release. Verify the stable embedded full SHA equals the approved rollback
   target and attach the evidence to the incident.
6. Remove the one-purpose recovery mechanism in a follow-up PR after recovery.

Functions, Firestore Rules, indexes, and Storage are outside this procedure and
must not be deployed by the Hosting rollback script.
