# Account and family deletion

This document describes the user-facing deletion surfaces, the server contracts
behind them, and the App Store / Play Store compliance position.

## User-facing surfaces

| Surface | Location | Who sees it |
| --- | --- | --- |
| **Delete account** | Settings → Security, below Sign Out | Every self-registered member (adults and teens). Hidden for managed child accounts. |
| **Delete family** | Settings → Family → Danger Zone | Family owner only. |
| **Leave family** | Settings → Family → Danger Zone | Non-owner, self-registered members. |
| Managed-child removal | Family Settings → Members | Parents/owner (existing `deleteChild` flow). |

All destructive flows are two-stage, explicitly distinguished from Sign Out, and
state that the action is irreversible.

## Account deletion contract (`deleteAccount`)

The server determines the caller's role — the client never supplies a familyId
or role. Four outcomes:

1. **Non-owner adult / teen** — profile, family projection and custom claims are
   purged; the Auth user is deleted last so the operation can be resumed safely.
2. **Owner with other eligible parents** — the caller must nominate a successor
   (`successorUid`). Eligibility (parent role, not managed, same family) is
   re-validated server-side inside the ownership-transfer transaction.
3. **Sole owner** — deleting the account cascades into full family deletion. The
   caller must type the exact, case-sensitive family name. The family is frozen
   and a family-deletion job is queued; the owner's account "rides" that job via
   `accountDeletionJobs/{uid}` and is purged in the job's `finalize` phase.
4. **Managed child** — rejected (`MANAGED_CHILD_ACCOUNT`); a managed child is
   removed only via the dedicated Danger Zone permanent child-deletion flow
   (owner/parent) or archived (parent/owner) in Family Settings. A managed
   child is **never** detached via "Remove from family" — see
   `docs/member-lifecycle-contract.md`.

**Recent-login requirement.** Deletion requires an authentication no older than
five minutes. Otherwise the callable returns `RECENT_LOGIN_REQUIRED` and the
client reauthenticates with password or Google, then resumes the *same* request.

**Sign in with Apple — not applicable.** The app does not offer Sign in with
Apple, so Apple's token-revocation requirement
(`REVOKE_APPLE_TOKENS` / `SignInWithApple` revocation endpoint) does not apply.
If Apple sign-in is added later, revocation must be performed as part of
`deleteAccount` before the Auth user is deleted.

## Family deletion contract

`deleteFamily` freezes the family and creates a resumable job; the
`processFamilyDeletion` Cloud Task executes eight ordered phases under a
five-minute lease, and `recoverFamilyDeletionJobs` re-enqueues stalled work.
Completion writes a sanitized 30-day receipt. Jobs, receipts and logs contain no
PII (no names, emails, invite codes or credentials).

## Deployment configuration

Public legal surfaces are supplied as build-time environment variables and
rendered in Settings → About. Any variable that is missing, blank or not an
absolute `http(s)` URL is omitted rather than rendered as a broken link:

```
VITE_PRIVACY_POLICY_URL=https://example.com/privacy
VITE_TERMS_URL=https://example.com/terms
VITE_ACCOUNT_DELETION_URL=https://example.com/delete-account
```

The account-deletion URL must document the same in-app path described above so
that reviewers (and users without the app installed) can find it.
