# Parent invitation v2 rollout runbook

This is an additive, backend-first release for the canonical `/invite/:token`
parent/adult invitation flow. It has no production-data migration: existing
families, memberships, pending legacy requests, and six-character invitation
records are left in place.

## Release contract and preflight

Run from the repository root with the committed public frontend environment
loaded for every browser/build command:

```bash
set -a
source .env.production
set +a
npm run typecheck
npm run lint
node --test scripts/verify-parent-invite-v2-contract.test.cjs
npm run verify:parent-invite-v2
```

The verifier reads exported function/build manifests or the real compiled
artifacts. It checks all four v2 callables (`createAdultInvitation`,
`previewAdultInvitation`, `acceptAdultInvitation`, and
`revokeAdultInvitation`), the built `/invite/:token` route, explicit
server-only Firestore collections plus their deny-by-default emulator probe,
and the absence of a `families/{familyId}.inviteCode` adult-authority
fallback. A failed contract gate blocks deployment.

## Deploy gates (in this order)

1. Build and deploy the backend first. Deploy only the functions target after
   the Functions build has passed:

   ```bash
   set -a; source .env.production; set +a
   npm --prefix functions run build
   firebase deploy --only functions
   ```

2. Deploy Firestore rules/indexes if the release diff contains them, then run
   the emulator rules probe. Rules retain server-only authority for v2
   invitation, idempotency, rate-limit, and membership projection records:

   ```bash
   set -a; source .env.production; set +a
   npm run test:rules
   firebase deploy --only firestore:rules,firestore:indexes
   ```

3. Run backend, legacy, and child smoke probes against emulators. Confirm v2
   preview/accept, legacy six-character acceptance and owner approval, child
   join/login, and zero unauthorized family creation. Do not use production
   credentials or write production data for this gate.

4. Build and deploy Hosting only after the backend/rules gates pass:

   ```bash
   set -a; source .env.production; set +a
   npm run build
   firebase deploy --only hosting
   ```

5. Run desktop, mobile, and service-worker smoke tests against the deployed
   artifact. Validate `/invite/:token` on a fresh tab, refresh, popup/redirect
   auth, email signup-to-login, browser restart, and PWA reload. Existing child
   and legacy `/join?code=...` flows must remain usable.

## Observe and hold points

Hold the rollout at each gate until the preceding gate is green. For the first
24 hours, inspect categorized invitation events and callable errors at least
hourly, then at the normal release cadence. The required signals are:

- creation, preview failure, acceptance, conflict, expiry, and auth-resume
  outcome categories;
- callable latency/error rates split by create, preview, accept, and revoke;
- successful v2 joined/already-member results and legacy pending approvals;
- zero unauthorized family creation after authentication and zero client
  writes to server-only invitation/membership collections;
- no raw token, token hash, invitation ID, email, family ID, or Firebase error
  message in logs or rendered errors.

Pause creation rollout and keep acceptance available if conflict, expiry,
auth-resume, or error rates exceed the approved release baseline. Do not
disable v2 acceptance for links already issued.

## Rollback

Rollback is additive and target-specific. Keep the v2 preview/accept callables
and server-only rules active so already-issued links continue to work. First
disable new adult-invitation creation at the owner surface/configuration, then
redeploy the prior frontend if needed:

```bash
firebase deploy --only hosting
```

If a backend correction is required, deploy the known-good Functions source;
do not remove v2 preview/accept or relax rules. An old frontend may continue
its bounded legacy behavior. A new frontend encountering a temporarily
unavailable v2 callable must show a retry/error state. It must never fall back
to `families.inviteCode` as adult membership authority. Child/manual join and
existing pending legacy approval remain unchanged.

## Legacy cutoff

After the observation hold is green, disable creation of new adult links via
the legacy six-character route while retaining read/accept compatibility for
already-issued links. Record the cutoff timestamp and the latest possible
legacy `expiresAt` (existing TTL is seven days), then wait for that TTL plus a
documented safety margin. Re-run legacy pending-request and child-flow probes.
Only after the TTL and safety margin, with zero outstanding legacy adult links
and no pending compatibility incident, may legacy adult preview/accept code be
removed in a separately reviewed release. Never remove child/manual family
code support as part of this cutoff.

## Data and security ruling

Initial rollout performs no production-data migration and no backfill. V2
records are hash-keyed, single-use, expiring bearer credentials; raw tokens are
returned only on creation and are never persisted or logged. Family and role
come only from server-owned invitation records. Firestore clients cannot read
or write invitation, idempotency, rate-limit, audit, or canonical membership
projection records. Any verifier, rules probe, smoke test, or rollback step
that cannot prove these properties is a release blocker.
