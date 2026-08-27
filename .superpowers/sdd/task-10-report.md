# Task 10 — Legacy invitation compatibility ledger

## Round 1 — bounded compatibility

Commit: `3e0d420b92c335c0d08423a026403440ad0eab1b`

- Strict six-character codes remain on `/join?code=...` and opaque v2 tokens
  remain on `/invite/:token`.
- Legacy pending storage is validated and bounded by a documented local
  compatibility cutoff; server `expiresAtMs` remains authoritative for URL
  validation.
- Legacy acceptance and family-code joining remain pending and do not write
  `users/{uid}.familyId`; family-code requests store no requester role.
- Terminal legacy outcomes clear pending storage; no parent/adult owner UI path
  calls the legacy creation callable.

## Round 1/5 — supplied journey priority and same-family cleanup

Commit: pending (this round).

- Any supplied `/join?code=...` (including malformed/opaque codes) now owns the
  route over stored v2 intent.
- Any supplied `/invite...` path (including malformed/opaque tokens) now owns
  the route over stored legacy intent, allowing its own invalid UX.
- `ALREADY_IN_THIS_FAMILY` is terminal for legacy acceptance and clears the
  pending legacy code.

## Verification

- RED observed for all three new P1 tests before implementation.
- `npx vitest run src/auth/AuthRoutingGate.test.tsx src/pages/JoinInvite.test.tsx src/lib/inviteLink.test.ts`: 67 passed.
- `npx tsc --noEmit`: passed.
- `git diff --check`: passed.

