# Task 7.1 Production Runbook — Final Pre-Runbook Corrections

This document replaces only Step G, Step K, and the partial-migration recovery
section. It does not authorize a deployment, migration, writer activation, or
Stage 7.2+ work.

## Step G — Deploy and provision Gate-1 evidence before activation

### What deployed production actually executes

The deployed task-approval chain is:

1. `functions/src/index.ts` exports `onTaskCompletionWritten`.
2. `createGamificationTriggers()` invokes
   `gamificationProcessor.processApprovedCompletion()`.
3. `processApprovedCompletion()` calls `resolveWriterRouteSafe()` exactly once.
4. For `route === "v4"`, it invokes the injected engine from
   `createV4TaskApprovalEngine()`; it never falls back to the legacy repository.
5. The engine invokes `createStage7WriterVerifier()` before entering the trusted
   V4 write scope.
6. The verifier calls `createStage7EvidenceProvider()`.
7. `functions/src/gamification/v4/provisionedGate1Artifact.ts` reads the
   Firebase Functions string parameter named `STAGE7_GATE1_ARTIFACT`.
8. The evidence provider validates the JSON object, report hash, owner approval
   freshness, pilot-family classification, and the matching `MIGRATED` marker.

`STAGE7_GATE1_ARTIFACT` is therefore required by the deployed runtime. Missing,
empty, malformed, wrong-hash, stale, wrong-family, or marker-mismatched evidence
fails closed before `applyTaskApprovalV4()` is called. Once the route is V4,
failure does not run the legacy writer.

### Supported provisioning mechanism

The code declares the value with Firebase Functions parameterized configuration
(`defineString` from `firebase-functions/params`). The Firebase CLI provisions
the parameter from `functions/.env.<project-id>` into the Gen-2 function runtime.
This repository ignores `.env.*`; the evidence value must never be committed.
Do not add a `functions.env` array to `firebase.json`, do not use deprecated
`functions.config()`, and do not use a service-account JSON file.

Set the operator inputs:

```bash
export PROJECT_ID="familyquest-beta-402cb"
export REGION="europe-west1"
export PILOT_FAMILY="<exact-pilot-family-id>"
export GATE1_ARTIFACT="backups/gate1/task-7.1-gate1-artifact.json"
export FUNCTIONS_ENV="functions/.env.${PROJECT_ID}"
```

Generate the owner-approved evidence into the ignored backup directory. The
real approver, approval instant, and approval reference have no defaults:

```bash
mkdir -p backups/gate1
npx tsx scripts/gate1/build-gate1-artifact.ts \
  --report docs/gamification-v4/03-production-replay-report.json \
  --approved-by "<real-owner-identity>" \
  --approved-at "<real-owner-approval-ISO-instant>" \
  --approval-ref "<approval-ticket-or-message-id>" \
  --out "$GATE1_ARTIFACT"
```

Create the Firebase parameter file without shell JSON interpolation. This file
contains evidence, not credentials, but remains local and mode `0600`:

```bash
PROJECT_ID="$PROJECT_ID" GATE1_ARTIFACT="$GATE1_ARTIFACT" node <<'NODE'
const fs = require('node:fs')
const project = process.env.PROJECT_ID
const artifactPath = process.env.GATE1_ARTIFACT
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
const json = JSON.stringify(artifact)
const dotenvQuoted = JSON.stringify(json)
const envPath = `functions/.env.${project}`
fs.writeFileSync(envPath, `STAGE7_GATE1_ARTIFACT=${dotenvQuoted}\n`, { mode: 0o600 })
console.log(`wrote ${envPath}; artifact JSON was not printed`)
NODE
```

Validate the exact local value through the same parser used by the deployed
entrypoint and through the Gate-1 family validator:

```bash
PROJECT_ID="$PROJECT_ID" PILOT_FAMILY="$PILOT_FAMILY" \
GATE1_ARTIFACT="$GATE1_ARTIFACT" npx tsx -e '
  import fs from "node:fs";
  import { parseProvisionedGate1Artifact } from "./functions/src/gamification/v4/provisionedGate1Artifact";
  import { validateGate1Artifact } from "./scripts/gate1/gate1-artifact";
  const expected = JSON.parse(fs.readFileSync(process.env.GATE1_ARTIFACT!, "utf8"));
  const line = fs.readFileSync(`functions/.env.${process.env.PROJECT_ID}`, "utf8").trim();
  const raw = JSON.parse(line.slice(line.indexOf("=") + 1));
  const parsed = parseProvisionedGate1Artifact(raw);
  if (!parsed || JSON.stringify(parsed) !== JSON.stringify(expected)) throw new Error("parameter value mismatch");
  const verdict = validateGate1Artifact(parsed as never, { familyId: process.env.PILOT_FAMILY!, maxAgeMs: 7 * 24 * 60 * 60 * 1000 });
  if (!verdict.valid) throw new Error(`Gate 1 invalid: ${verdict.reason}`);
  console.log(`Gate 1 local parameter valid for ${process.env.PILOT_FAMILY}`);
'
```

Deploy while the writer route is still legacy. This is the first point at which
the parameter is copied into the deployed revision:

```bash
npx firebase deploy --only functions --project "$PROJECT_ID"
```

Verify that the deployed Gen-2 revision received the exact value, without
printing it:

```bash
export DEPLOYED_GATE1_ARTIFACT="$(
  gcloud functions describe onTaskCompletionWritten \
    --gen2 --project "$PROJECT_ID" --region "$REGION" \
    --format='value(serviceConfig.environmentVariables.STAGE7_GATE1_ARTIFACT)'
)"

DEPLOYED_GATE1_ARTIFACT="$DEPLOYED_GATE1_ARTIFACT" \
GATE1_ARTIFACT="$GATE1_ARTIFACT" PILOT_FAMILY="$PILOT_FAMILY" npx tsx -e '
  import fs from "node:fs";
  import { parseProvisionedGate1Artifact } from "./functions/src/gamification/v4/provisionedGate1Artifact";
  import { validateGate1Artifact } from "./scripts/gate1/gate1-artifact";
  const expected = JSON.parse(fs.readFileSync(process.env.GATE1_ARTIFACT!, "utf8"));
  const actual = parseProvisionedGate1Artifact(process.env.DEPLOYED_GATE1_ARTIFACT);
  if (!actual || JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("deployed Gate 1 value mismatch");
  const verdict = validateGate1Artifact(actual as never, { familyId: process.env.PILOT_FAMILY!, maxAgeMs: 7 * 24 * 60 * 60 * 1000 });
  if (!verdict.valid) throw new Error(`deployed Gate 1 invalid: ${verdict.reason}`);
  console.log(`deployed Gate 1 parameter valid for ${process.env.PILOT_FAMILY}`);
'
unset DEPLOYED_GATE1_ARTIFACT
```

STOP if deployment fails, the environment variable is absent, the exact JSON
comparison fails, or family validation fails. Do not activate the writer. The
runtime remains fail-closed.

## Step K — One-operation production smoke and no-dual-write proof

The V4 facts loader derives both deltas from
`families/{FAMILY}/tasks/{TASK}.pointsReward`. For this smoke operation,
`expectedRewardPointsDelta === expectedXpDelta === pointsReward`. The
deterministic event identity is
`eventIdFor(FAMILY, MEMBER, "TASK_APPROVED", COMPLETION)`.

The legacy Task Approval writer can mutate all of the following, so Step K
captures and compares them explicitly:

- `users/{MEMBER}.rewardPoints`
- `users/{MEMBER}.lifetimeXP`
- `users/{MEMBER}.lastTaskCompletionId`
- the complete `families/{FAMILY}/gamification_summaries/{MEMBER}` projection:
  `schemaVersion`, `familyId`, `childId`, `xpTotal`, `level`, `currentStreak`,
  `bestStreak`, `perfectDayCount`, `lastQualifiedDayKey`,
  `projectionRevision`, `foldedThrough`, `rebuildRequired`,
  `earliestDirtyCursor`, `projectionStatus`, and `updatedAt`
- the member event count under `families/{FAMILY}/gamification_events`
- the complete `families/{FAMILY}/gamification_state_v3/{MEMBER}` document,
  with `memberId`, `familyId`, `rewardPoints`, `xpTotal`, `weeklyPoints`,
  `currentStreak`, `bestStreak`, `lastQualifiedDayKey`, `unlockedAvatarIds`,
  `weeklyWindowKey`, `level`, `xpProgressInLevel`, `xpToNextLevel`,
  `levelProgressPercentage`, `projectionVersion`, `foldedThroughEventId`, and
  `updatedAt`
- the member event count under `families/{FAMILY}/gamification_events_v3`

Under `route=v4`, every item above must be value-identical BEFORE and AFTER.
There is no permitted compatibility transformation for Task Approval on these
paths: the V4 branch never calls the legacy repository or V3 shadow writer.

Set the exact smoke identity and ignored local evidence paths:

```bash
export PROJECT_ID="familyquest-beta-402cb"
export FAMILY="<pilot-family-id>"
export MEMBER="<pilot-member-id>"
export TASK="<single-smoke-task-id>"
export COMPLETION="<single-pending-completion-id>"
export OPERATOR="<identified-operator>"
export BEFORE_FILE="backups/gate1/task-7.1-smoke-before.json"
export AFTER_FILE="backups/gate1/task-7.1-smoke-after.json"
```

Immediately before the one approval, capture a SHA-256-sealed BEFORE snapshot.
The command refuses to overwrite an existing file, refuses a non-V4 route, and
refuses if the deterministic event already exists:

```bash
npx tsx scripts/cutover/task-approval-smoke.ts --capture-before \
  --project "$PROJECT_ID" --family "$FAMILY" --member "$MEMBER" \
  --task "$TASK" --completion "$COMPLETION" --operator "$OPERATOR" \
  --before-file "$BEFORE_FILE"
```

Approve exactly that completion once through the normal deployed application.
Do not approve any other task for that member between snapshots.

Immediately afterwards, capture AFTER and verify against the sealed BEFORE:

```bash
npx tsx scripts/cutover/task-approval-smoke.ts --verify-after \
  --project "$PROJECT_ID" --family "$FAMILY" --member "$MEMBER" \
  --task "$TASK" --completion "$COMPLETION" --operator "$OPERATOR" \
  --before-file "$BEFORE_FILE" --after-file "$AFTER_FILE"
```

Success prints `NO_DUAL_WRITE_PROVED` only after independently proving:

1. the route was V4 in both snapshots;
2. exactly one member V4 event was added;
3. its ID is exactly `FAMILY::MEMBER::TASK_APPROVED::COMPLETION`;
4. it is exactly `TASK_APPROVED`, `sourceType=task_completion`,
   `sourceId=COMPLETION`, with exact `taskId`, `completionId`,
   `awardedPoints`, `rewardPointsDelta`, `xpDelta`, and `estimated=false`;
5. both deltas equal the captured task `pointsReward` exactly;
6. the BEFORE authoritative V4 business state equals its captured ledger
   rebuild, and the complete AFTER authoritative business state (`rewardPoints`, `xpTotal`,
   `level`, `xpProgressInLevel`, `xpToNextLevel`,
   `levelProgressPercentage`, `currentStreak`, `bestStreak`,
   `lastQualifiedDayKey`, `unlockedAchievementIds`, and
   `unlockedAvatarIds`) equals BEFORE ledger plus exactly that event;
7. rebuilding from the complete AFTER member ledger produces the identical
   AFTER business state;
8. the user fields, complete V1 summary, V1 event count, complete V3 state, and
   V3 event count listed above are exactly unchanged.

STOP on any non-zero exit, legacy/V3 difference, unexpected V4 event count,
event mismatch, state-delta mismatch, rebuild mismatch, snapshot hash mismatch,
or intervening operation. Do not proceed to another writer or stage.

## Migration partial-failure recovery

`runFamilyMigration()` executes in this exact order:

1. validate family-scoped Gate-1 evidence and replay report;
2. refuse execute without an identified operator/trusted migration mode;
3. capture the wallet BEFORE manifest/hash;
4. write deterministic `MIGRATION_BASELINE` V4 events;
5. rebuild/write deterministic V4 member states;
6. capture and verify wallet AFTER;
7. read any prior marker;
8. write `families/{FAMILY}/gamification_migration_marker/marker` only after
   wallet verification succeeds.

An exception during step 6 can therefore leave exactly this partial state:

- deterministic documents under `families/{FAMILY}/gamification_events` and
  `families/{FAMILY}/gamification_state` are present;
- `families/{FAMILY}/gamification_migration_marker/marker` is absent;
- wallet documents are unchanged by the migration;
- Gate 2 remains closed, so V4 writer activation is forbidden.

The supported recovery is a rerun with the same family, approved replay report,
Gate-1 artifact, and operator contract. `writeMigrationLedger()` uses one
deterministic baseline event ID per member and the canonical state path, so it
reuses/overwrites identical documents instead of adding another event or award.

Production recovery procedure:

1. **STOP writer activation.** Confirm the family remains routed to legacy.
2. Do not manually delete any V4 document.
3. Do not call emulator-only `purgeV4FamilyData`.
4. Read `families/{FAMILY}/gamification_migration_marker/marker` and confirm it
   is absent. If it exists, STOP: this is not the documented partial state.
5. Read-only inspect the family V4 event IDs and member state paths and retain
   the failed run/error evidence. Expected partial data is deterministic
   `MIGRATION_BASELINE` events plus their rebuilt states only.
6. Resolve the wallet verification outage or concurrent wallet mutation.
7. Rerun the supported production migration command with the same family/input
   contract:

   ```bash
   GAMIFICATION_MIGRATION_MODE=production-trusted \
   npx tsx scripts/migrate/production-migration.ts \
     --project "$PROJECT_ID" --family "$FAMILY" --execute --operator "$OPERATOR" \
     --report docs/gamification-v4/03-production-replay-report.json \
     --gate1 "$GATE1_ARTIFACT"
   ```

8. Rerun the full Stage-6/pre-cutover migration verification.
9. Proceed only when wallet BEFORE equals AFTER, V4 state equals a complete
   ledger rebuild, event IDs/counts match the clean deterministic plan, and the
   marker exists with `status=MIGRATED`, `walletHashOk=true`, and the approved
   `reportHash`.

STOP and keep the writer legacy if the marker is present unexpectedly, wallet
verification still fails, any non-baseline V4 event exists before activation,
event IDs/counts differ from the deterministic plan, state differs from rebuild,
or the final marker is absent/unbound. Do not invent an operational workaround.
