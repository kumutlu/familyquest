# Live Production Smoke Suite — Queki

How to seed disposable QA fixtures and run the authenticated production smoke
tests against the live deployment. **No real family accounts or real family
data may be used.**

## Targets

- Live domain: `https://queki.app`
- Firebase project: `familyquest-beta-402cb`

## 1. Credentials (never committed)

All credentials come from environment variables. Copy [`.env.example`](../.env.example)
to `.env` (git-ignored) and set strong temporary values, or export them in your
shell / local secret store:

| Variable | Purpose |
| --- | --- |
| `QUEKI_SMOKE_PARENT_EMAIL` | Disposable owner/parent email |
| `QUEKI_SMOKE_PARENT_PASSWORD` | Disposable owner/parent password (secret) |
| `QUEKI_SMOKE_CHILD_EMAIL` | Disposable child email |
| `QUEKI_SMOKE_CHILD_PASSWORD` | Disposable child password (secret) |
| `QUEKI_SMOKE_UNRELATED_EMAIL` | Optional unrelated adult for isolation checks |
| `QUEKI_SMOKE_UNRELATED_PASSWORD` | Optional unrelated adult password |
| `QUEKI_SMOKE_FAMILY_CODE` | Optional fixture family invite/join code |
| `QUEKI_SMOKE_BASE_URL` | Optional override; defaults to `https://queki.app` |

The spec and seeder validate that required variables are present and fail fast
with a clear message if any are missing. No credentials are ever printed.

## 2. Seed / refresh the disposable fixture (idempotent)

The fixture is a single dedicated family tagged `smokeTest: true`:

- family: `smoke-test-family` ("Smoke Test Family")
- parent uid `smoke-test-parent`, child uid `smoke-test-child`
- child wallet initialised to `0`

Seeding is idempotent — existing auth users are reused/updated and documents are
re-`set`, so re-running never duplicates the fixture.

```bash
export GOOGLE_APPLICATION_CREDENTIALS=./familyquest-beta-402cb-firebase-adminsdk.json
export QUEKI_SMOKE_PARENT_PASSWORD='<strong-temp-password>'
export QUEKI_SMOKE_CHILD_PASSWORD='<strong-temp-password>'
npx tsx scripts/smoke-setup.ts --project familyquest-beta-402cb
```

Verify the fixture landed correctly:

```bash
npx tsx scripts/verify-smoke-data.ts
```

> The Admin SDK is used only for the initial Auth bootstrap and the
> `smokeTest`-tagged fixture documents. This is the minimum required to create
> managed test identities; application invariants are otherwise exercised
> through normal app flows during the suite.

## 3. Run the live smoke suite

```bash
npm run test:smoke        # targets https://queki.app by default
```

Local variant (app served locally but talking to production Firebase):

```bash
export QUEKI_SMOKE_BASE_URL=http://localhost:5174
npm run dev -- --port 5174     # in a separate shell, NO emulator flag
npm run test:smoke
```

## 4. Cleanup (documented, run after QA)

Remove all disposable fixture data (auth users, family-scoped and root docs,
tasks, completions, goals, idempotency docs):

```bash
export GOOGLE_APPLICATION_CREDENTIALS=./familyquest-beta-402cb-firebase-adminsdk.json
npx tsx scripts/cleanup-smoke.ts
```

Cleanup only touches documents tagged `smokeTest: true` under the disposable
fixture family and the known fixture UIDs. Real user and family data are never
modified.

## Secret hygiene

- `.env`, `.env.local`, service-account keys and `test-results/` browser auth
  state are git-ignored — see [`.gitignore`](../.gitignore).
- Do not commit passwords, tokens, family codes, service-account keys, or
  screenshots containing secrets.
