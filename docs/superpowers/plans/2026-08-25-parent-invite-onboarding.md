# Parent Invite + Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ambiguous adult-family join path with a secure opaque parent/adult invitation journey that survives authentication and prevents accidental family creation.

**Architecture:** Parent/adult invitations are server-owned one-time bearer credentials looked up by token hash. Global auth routing prioritizes pending invitation intent before family bootstrap or no-family onboarding, while family creation becomes an explicit user choice.

**Tech Stack:** React, TypeScript, Zustand, React Router, Firebase Auth, Firestore, Firebase Functions v2, Firestore Rules, Vitest, Firebase Emulator, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-25-parent-invite-onboarding-design.md`

## Global Constraints

- New adult invitation tokens use 32 cryptographically random bytes, unpadded base64url encoding, and SHA-256 hexadecimal Firestore document IDs.
- Raw tokens are returned only in the first successful creation response and never stored or logged.
- V2 intended roles are exactly `parent | adult`; `owner` and `child` are never accepted.
- V2 creation/revocation is owner-only; v2 acceptance is immediate, atomic, authenticated, and server-authoritative.
- An account belongs to at most one family.
- Invitation expiry is derived from `expiresAt`; no expiry scheduler or persisted `expired` status is introduced.
- `families.inviteCode` remains child/manual-only and never grants immediate parent/adult authority.
- Legacy six-character role invitations retain pending-owner-approval semantics only through their existing maximum seven-day TTL.
- Google authentication alone creates zero family documents.
- Family creation requires a UID-bound explicit `create-family` intent.
- Raw Firebase errors and sensitive token/family/account fields never render or appear in logs.
- Child join, managed-child login, and existing pending legacy requests remain behaviorally unchanged.
- No production-data migration is part of initial rollout.

## File and interface map

- `functions/src/adultInvitations.ts`: v2 token helpers, invitation repository logic, four callable implementations, rate limiting, and sanitized event emission.
- `functions/src/adultInvitations.test.ts`: pure/fake-Firestore RED→GREEN coverage.
- `functions/src/adultInvitations.emulator.test.ts`: real Firestore atomicity/concurrency coverage.
- `src/lib/adultInvitationApi.ts`: typed callable client.
- `src/auth/pendingInviteIntent.ts`: storage-only v2 resume envelope.
- `src/auth/createFamilyIntent.ts`: UID-bound explicit creation intent.
- `src/auth/AuthRoutingGate.tsx`: global auth/membership/intent priority.
- `src/pages/AdultInvite.tsx`: canonical `/invite/:token` journey.
- `src/pages/NoFamilyChoice.tsx`: authenticated Create/Join choice.
- `src/components/family/AdultInviteCard.tsx`: one owner-only invitation UI reused by all entry points.
- Existing `/join` and legacy invitation functions remain temporarily available.

---

### Task 1: Invitation v2 token domain and authoritative records

**Files:**
- Create: `functions/src/adultInvitations.ts`
- Create: `functions/src/adultInvitations.test.ts`
- Modify: `functions/package.json` only if a dedicated focused test script is needed

**Interfaces:**
- Produces: `type AdultRole = 'parent' | 'adult'`.
- Produces: `generateAdultInvitationToken(): string` using 32 random bytes and base64url.
- Produces: `hashAdultInvitationToken(token: string): string` returning 64 lowercase hex characters.
- Produces: `validateAdultRole(value: unknown): AdultRole`.
- Produces: `type AdultInvitationRecord` exactly matching the spec.
- Consumes later: Task 2 callable implementations import all four contracts.

- [ ] **Step 1: Write failing domain tests**

```ts
it('generates a token with 32 decoded random bytes and stores only its SHA-256 hash', () => {
  const token = generateAdultInvitationToken(() => Buffer.alloc(32, 7))
  expect(Buffer.from(token, 'base64url')).toHaveLength(32)
  expect(token).toBe('BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc')
  expect(hashAdultInvitationToken(token)).toMatch(/^[a-f0-9]{64}$/)
  expect(hashAdultInvitationToken(token)).not.toContain(token)
})

it.each(['owner', 'child', '', undefined])('rejects non-adult invitation role %s', value => {
  expect(() => validateAdultRole(value)).toThrow('INVALID_INTENDED_ROLE')
})
```

- [ ] **Step 2: Run RED and record the expected missing-module/export failure**

Run: `cd functions && npx vitest run src/adultInvitations.test.ts -t "generates a token|rejects non-adult"`

Expected: FAIL because `adultInvitations.ts` or its exported helpers do not exist.

- [ ] **Step 3: Implement the smallest token/domain module**

Implement `randomBytes(32).toString('base64url')`, strict token decoding/length validation before hashing, `createHash('sha256')`, the two-role allowlist, `INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000`, and the record type. Do not add callables yet.

- [ ] **Step 4: Run focused GREEN**

Run: `cd functions && npx vitest run src/adultInvitations.test.ts`

Expected: PASS with the token/hash/role tests green.

- [ ] **Step 5: Run relevant regression group**

Run: `cd functions && npx vitest run src/familyInvitations.test.ts src/familyMembership.test.ts src/adultInvitations.test.ts`

Expected: PASS; legacy invitation and family-code behavior is unchanged.

- [ ] **Step 6: Check the diff**

Run: `git diff --check && git diff -- functions/src/adultInvitations.ts functions/src/adultInvitations.test.ts functions/package.json`

- [ ] **Step 7: Commit exact files**

```bash
git add functions/src/adultInvitations.ts functions/src/adultInvitations.test.ts functions/package.json
git commit -m "feat(invites): add opaque adult invitation domain"
```

Omit `functions/package.json` from `git add` if unchanged.

---

### Task 2: Invitation v2 backend callables and atomic acceptance

**Files:**
- Modify: `functions/src/adultInvitations.ts`
- Modify: `functions/src/adultInvitations.test.ts`
- Create: `functions/src/adultInvitations.emulator.test.ts`
- Modify: `functions/src/index.ts`

**Interfaces:**
- Produces: `createAdultInvitationImpl(input, request, context): Promise<CreatedAdultInvitation>`.
- Produces: `previewAdultInvitationImpl(input, request, context): Promise<AdultInvitationPreview>`.
- Produces: `acceptAdultInvitationImpl(input, request, context): Promise<AdultInvitationAcceptance>`.
- Produces: `revokeAdultInvitationImpl(input, request, context): Promise<{success: true}>`.
- Produces callables: `createAdultInvitation`, `previewAdultInvitation`, `acceptAdultInvitation`, `revokeAdultInvitation` in `europe-west1`.
- Consumes: Task 1 token/hash/role contracts.
- Acceptance result is exactly `{result: 'joined' | 'already_member', familyId, role, destination: '/'}`.

- [ ] **Step 1: Write failing callable and transaction tests**

Add literal fixtures asserting:

```ts
it('allows only an active family owner to create parent or adult invitations', async () => {
  const result = await create({ intendedRole: 'parent', clientReqId: 'req-create-0001' }, 'owner-1')
  expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  const stored = documents.get(`familyInvitations/${result.invitationId}`)
  expect(stored).toMatchObject({ version: 2, familyId: 'family-1', intendedRole: 'parent', status: 'active', createdBy: 'owner-1' })
  expect(JSON.stringify(stored)).not.toContain(result.token)
})

it.each(['parent-1', 'adult-1', 'child-1'])('denies non-owner creator %s', async uid => {
  await expect(create(validCreateInput, uid)).rejects.toMatchObject({ message: 'OWNER_REQUIRED' })
})

it('rejects preview and acceptance when the family is deleting', async () => {
  seedV2({ lifecycleState: 'deleting' })
  await expect(preview(token)).rejects.toMatchObject({ message: 'FAMILY_UNAVAILABLE' })
  await expect(accept(token, 'joiner-1')).rejects.toMatchObject({ message: 'FAMILY_UNAVAILABLE' })
})

it('derives membership role from the invitation and ignores forged payload authority', async () => {
  seedV2({ intendedRole: 'parent' })
  const result = await acceptAdultInvitationImpl({ token, clientReqId: 'req-accept-001', role: 'owner', familyId: 'attacker-family' } as any, auth('joiner-1'), context)
  expect(result).toEqual({ result: 'joined', familyId: 'family-1', role: 'parent', destination: '/' })
  expect(documents.get('users/joiner-1')).toMatchObject({ familyId: 'family-1', role: 'parent', lifecycle: 'active' })
  expect(documents.get('families/family-1/users/joiner-1')).toMatchObject({ role: 'parent', lifecycle: 'active' })
})

it('returns already_member for the same family and rejects a different family without consuming', async () => { /* two literal fixtures */ })
it('rejects expired, revoked, accepted-by-other, invalid and deleting-family tokens', async () => { /* table of stable codes */ })
it('same-user acceptance replay is idempotent and concurrent different-user acceptance has one winner', async () => { /* emulator transaction */ })
it('revokes only an active invitation owned by the caller family owner', async () => { /* active, repeated, accepted cases */ })
it('rate-limits repeated unauthenticated preview failures without storing the raw token', async () => { /* 10 allowed, 11th rejected */ })
```

- [ ] **Step 2: Run RED and record the missing callable failures**

Run: `cd functions && npx vitest run src/adultInvitations.test.ts`

Expected: FAIL because the four `*Impl` functions and transaction behavior are absent.

Run emulator RED: `firebase emulators:exec --only firestore,auth "cd functions && npx vitest run src/adultInvitations.emulator.test.ts"`

Expected: FAIL because atomic acceptance/export wiring is absent.

- [ ] **Step 3: Implement the smallest complete backend**

Use dependency-injected Firestore/time/random/event context. Creation reads owner and family, rejects non-owner/deleting/missing family, writes `familyInvitations/{hash}` and a safe creation-idempotency record, and never persists token. Preview validates/rate-limits and returns only the minimal projection. Acceptance re-reads invitation, family, profile, membership projection, and idempotency record in one transaction; it writes profile, projection, invitation consumption, idempotency, and sanitized audit state atomically. Revocation resolves only by `invitationId` and owner family. Export all callables from `functions/src/index.ts`.

- [ ] **Step 4: Run focused GREEN**

Run: `cd functions && npx vitest run src/adultInvitations.test.ts`

Run: `firebase emulators:exec --only firestore,auth "cd functions && npx vitest run src/adultInvitations.emulator.test.ts"`

Expected: both commands PASS, including same-token concurrency.

- [ ] **Step 5: Run relevant regression group**

Run: `cd functions && npx vitest run src/familyInvitations.test.ts src/familyMembership.test.ts src/memberLifecycle.test.ts src/adultInvitations.test.ts`

Run: `cd functions && npm run build`

Expected: PASS and TypeScript build exit 0.

- [ ] **Step 6: Check the diff**

Run: `git diff --check && git diff -- functions/src/adultInvitations.ts functions/src/adultInvitations.test.ts functions/src/adultInvitations.emulator.test.ts functions/src/index.ts`

- [ ] **Step 7: Commit exact files**

```bash
git add functions/src/adultInvitations.ts functions/src/adultInvitations.test.ts functions/src/adultInvitations.emulator.test.ts functions/src/index.ts
git commit -m "feat(invites): add server-authoritative adult invitations"
```

---

### Task 3: Firestore membership-authority security boundary

**Files:**
- Modify: `firestore.rules`
- Create: `tests/firestore/adultInvitations.rules.test.ts`
- Modify: `tests/firestore/approvalCenter.rules.test.ts`
- Modify: `tests/firestore/familyInvitations.rules.test.ts`

**Interfaces:**
- Produces: server-only rules for `familyInvitations`, `adultInvitationCreationIdempotency`, `adultInvitationAcceptanceIdempotency`, and `adultInvitationRateLimits`.
- Preserves: legacy `families/{familyId}/join_requests/{uid}` approval rules.
- Preserves: owner bootstrap creation but denies any unrelated client `familyId`, `role`, or membership-projection authority write.

- [ ] **Step 1: Write failing rules tests**

```ts
it.each(['owner', 'parent', 'joiner'])('denies %s every direct read/write of v2 invitation records', async identity => {
  const db = contextFor(identity).firestore()
  await assertFails(getDoc(doc(db, `familyInvitations/${HASH}`)))
  await assertFails(setDoc(doc(db, `familyInvitations/${HASH}`), forgedRecord))
  await assertFails(updateDoc(doc(db, `familyInvitations/${HASH}`), { intendedRole: 'owner' }))
})

it('denies a no-family user directly assigning familyId or owner role', async () => {
  const db = testEnv.authenticatedContext('joiner').firestore()
  await assertFails(updateDoc(doc(db, 'users/joiner'), { familyId: FAMILY, role: 'owner' }))
})

it('denies every client write to canonical families/{familyId}/users projection', async () => {
  await assertFails(setDoc(doc(ownerDb, `families/${FAMILY}/users/joiner`), { role: 'parent' }))
})
```

Also retain a passing legacy pending-request approval fixture and a passing atomic owner-bootstrap fixture so tightening cannot break them.

- [ ] **Step 2: Run RED**

Run: `firebase emulators:exec --only firestore,auth "npx vitest run tests/firestore/adultInvitations.rules.test.ts tests/firestore/approvalCenter.rules.test.ts tests/firestore/familyInvitations.rules.test.ts"`

Expected: the new v2 collection tests fail until explicit deny blocks exist or a discovered broad match is tightened; existing legacy tests remain green.

- [ ] **Step 3: Implement minimal rules changes**

Add explicit root server-only matches for all four v2 collections. Tighten only membership-authority branches proven permissive by RED. Do not remove `isValidOwnerBootstrap`, `isValidJoinProfileUpdate`, or legacy join approval during the compatibility window.

- [ ] **Step 4: Run focused GREEN**

Run the same emulator command.

Expected: all adult invitation, direct-forgery, and legacy approval assertions PASS.

- [ ] **Step 5: Run relevant regression group**

Run: `firebase emulators:exec --only firestore,auth "npx vitest run tests/firestore/ownerBootstrap.rules.test.ts tests/firestore/childJoinRequest.rules.test.ts tests/firestore/approvalCenter.rules.test.ts tests/firestore/familyInvitations.rules.test.ts tests/firestore/adultInvitations.rules.test.ts"`

- [ ] **Step 6: Check the diff**

Run: `git diff --check && git diff -- firestore.rules tests/firestore/adultInvitations.rules.test.ts tests/firestore/approvalCenter.rules.test.ts tests/firestore/familyInvitations.rules.test.ts`

- [ ] **Step 7: Commit exact files**

```bash
git add firestore.rules tests/firestore/adultInvitations.rules.test.ts tests/firestore/approvalCenter.rules.test.ts tests/firestore/familyInvitations.rules.test.ts
git commit -m "test(rules): lock adult membership authority to server"
```

---

### Task 4: Pending adult invite intent module

**Files:**
- Create: `src/auth/pendingInviteIntent.ts`
- Create: `src/auth/pendingInviteIntent.test.ts`

**Interfaces:**
- Produces: `type PendingInviteIntent = {version: 2; token: string; capturedAt: number; authUid?: string}`.
- Produces: `capturePendingInvite(token, now?): PendingInviteIntent`.
- Produces: `readPendingInvite(now?): PendingInviteIntent | null`.
- Produces: `bindPendingInviteToUid(uid): PendingInviteIntent | null`.
- Produces: `clearPendingInvite(reason: PendingInviteClearReason): void`.
- Produces: `isPendingInviteFresh(intent, now?): boolean`.
- Storage key: `queki.pendingAdultInvite.v2`; no preview metadata permitted.

- [ ] **Step 1: Write failing storage/identity tests**

```ts
it('mirrors only token intent and survives session loss', () => {
  capturePendingInvite(TOKEN, 1_000)
  sessionStorage.clear()
  expect(readPendingInvite(2_000)).toEqual({ version: 2, token: TOKEN, capturedAt: 1_000 })
  expect(localStorage.getItem(KEY)).not.toMatch(/familyId|familyName|role|email/)
})

it('clears stale or malformed intent after seven days', () => {
  capturePendingInvite(TOKEN, 1_000)
  expect(readPendingInvite(1_000 + 7 * 86_400_000 + 1)).toBeNull()
})

it('does not silently rebind an invite to a different authenticated account', () => {
  capturePendingInvite(TOKEN, 1_000)
  bindPendingInviteToUid('uid-a')
  expect(() => bindPendingInviteToUid('uid-b')).toThrow('INVITE_ACCOUNT_MISMATCH')
  expect(readPendingInvite(2_000)?.authUid).toBe('uid-a')
})
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/auth/pendingInviteIntent.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement minimal storage module**

Validate v2 envelope shape and base64url 32-byte token syntax, prefer session value, fall back to local value, mirror writes, remove both on terminal/stale cleanup, and throw a stable account-mismatch error without rebinding.

- [ ] **Step 4: Run focused GREEN**

Run: `npx vitest run src/auth/pendingInviteIntent.test.ts`

- [ ] **Step 5: Run relevant regression group**

Run: `npx vitest run src/lib/inviteLink.test.ts src/auth/pendingInviteIntent.test.ts src/lib/googleRedirectAuth.test.ts`

- [ ] **Step 6: Check the diff**

Run: `git diff --check && git diff -- src/auth/pendingInviteIntent.ts src/auth/pendingInviteIntent.test.ts`

- [ ] **Step 7: Commit exact files**

```bash
git add src/auth/pendingInviteIntent.ts src/auth/pendingInviteIntent.test.ts
git commit -m "feat(auth): persist adult invitation intent"
```

---

### Task 5: Canonical `/invite/:token` recipient route

**Files:**
- Create: `src/lib/adultInvitationApi.ts`
- Create: `src/lib/adultInvitationApi.test.ts`
- Create: `src/pages/AdultInvite.tsx`
- Create: `src/pages/AdultInvite.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/i18n/locales/en/family.json`
- Modify: `src/i18n/locales/tr/family.json`

**Interfaces:**
- Client callables mirror Task 2 contracts exactly.
- Route: `/invite/:token`.
- Consumes: Task 4 capture/read/bind/clear functions.
- Produces phases: `validating | unauthenticated | confirming | accepting | success | terminal | conflict`.

- [ ] **Step 1: Write failing API and route tests**

```tsx
it('previews the URL token before rendering family data or generic onboarding', async () => {
  preview.mockReturnValue(new Promise(() => {}))
  renderRoute('/invite/' + TOKEN)
  expect(screen.getByRole('status')).toHaveTextContent('Checking your invitation')
  expect(screen.queryByText('The Smiths')).not.toBeInTheDocument()
  expect(readPendingInvite()?.token).toBe(TOKEN)
})

it('requires explicit Join family and sends no client familyId or role', async () => {
  preview.mockResolvedValue({ familyDisplayName: 'The Smiths', intendedRole: 'parent', expiresAt: ISO, status: 'active' })
  await user.click(await screen.findByRole('button', { name: 'Join family' }))
  expect(accept).toHaveBeenCalledWith({ token: TOKEN, clientReqId: expect.any(String) })
  expect(accept.mock.calls[0][0]).not.toHaveProperty('role')
  expect(accept.mock.calls[0][0]).not.toHaveProperty('familyId')
})

it.each(['INVITATION_EXPIRED', 'INVITATION_REVOKED', 'INVITATION_ALREADY_USED', 'FAMILY_UNAVAILABLE'])('renders terminal UX for %s without onboarding', async code => { /* literal translated copy */ })
it('renders same-family already_member success and different-family conflict', async () => { /* separate fixtures */ })
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/lib/adultInvitationApi.test.ts src/pages/AdultInvite.test.tsx`

Expected: FAIL because the API, route, and page do not exist.

- [ ] **Step 3: Implement minimal client API and route**

Register the public route outside `AppLayout`. Preview before family copy, show Google/email choices when unauthenticated, bind intent after auth, require confirmation, call acceptance, refresh the Firebase ID token/profile, clear on success/decline/acknowledged terminal state, and never navigate a still-no-family successful result through generic onboarding.

- [ ] **Step 4: Run focused GREEN**

Run: `npx vitest run src/lib/adultInvitationApi.test.ts src/pages/AdultInvite.test.tsx src/App.test.tsx`

- [ ] **Step 5: Run relevant regression group**

Run: `npx vitest run src/pages/JoinInvite.test.tsx src/pages/JoinFamily.test.tsx src/lib/inviteLink.test.ts src/pages/AdultInvite.test.tsx`

- [ ] **Step 6: Check the diff**

Run: `git diff --check && git diff -- src/lib/adultInvitationApi.ts src/lib/adultInvitationApi.test.ts src/pages/AdultInvite.tsx src/pages/AdultInvite.test.tsx src/App.tsx src/i18n/locales/en/family.json src/i18n/locales/tr/family.json`

- [ ] **Step 7: Commit exact files**

```bash
git add src/lib/adultInvitationApi.ts src/lib/adultInvitationApi.test.ts src/pages/AdultInvite.tsx src/pages/AdultInvite.test.tsx src/App.tsx src/i18n/locales/en/family.json src/i18n/locales/tr/family.json
git commit -m "feat(invites): add canonical adult invitation route"
```

---

### Task 6: Authentication return-intent persistence

**Files:**
- Modify: `src/lib/googleRedirectAuth.ts`
- Modify: `src/lib/googleRedirectAuth.test.ts`
- Modify: `src/pages/Login.tsx`
- Modify: `src/pages/Login.test.tsx`
- Modify: `src/pages/Signup.tsx`
- Modify: `src/pages/Signup.test.tsx`
- Modify: `src/pages/AdultInvite.tsx`
- Modify: `src/pages/AdultInvite.test.tsx`

**Interfaces:**
- Produces: `safeInternalReturnPath(value: string | null): string | null`.
- Login/Signup consume `next=/invite/<encoded-token>` only after same-origin path validation.
- Google popup keeps route state; redirect resumes from the v2 envelope and validated `next`.
- Signup ↔ Login links preserve `next` and pending intent.

- [ ] **Step 1: Write failing popup/redirect/email-switch tests**

```tsx
it('keeps the parent invite after popup authentication', async () => {
  capturePendingInvite(TOKEN)
  renderLogin('/login?next=' + encodeURIComponent(`/invite/${TOKEN}`))
  await user.click(screen.getByRole('button', { name: /Google/ }))
  fireAuthenticated('uid-1')
  expect(navigate).toHaveBeenCalledWith(`/invite/${TOKEN}`, { replace: true })
  expect(readPendingInvite()?.token).toBe(TOKEN)
})

it('resumes the invite after a mobile redirect bootstrap', async () => {
  capturePendingInvite(TOKEN)
  getRedirectResult.mockResolvedValue({ user: user('uid-1') })
  await consumeGoogleRedirectResult()
  expect(readPendingInvite()?.token).toBe(TOKEN)
})

it('preserves next and token when switching Signup to Login', async () => {
  renderSignup(`/signup?next=${encodeURIComponent(`/invite/${TOKEN}`)}`)
  expect(screen.getByRole('link', { name: /Sign in/ })).toHaveAttribute('href', `/login?next=${encodeURIComponent(`/invite/${TOKEN}`)}`)
})
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/lib/googleRedirectAuth.test.ts src/pages/Login.test.tsx src/pages/Signup.test.tsx src/pages/AdultInvite.test.tsx`

Expected: FAIL because Login ignores return query, Signup drops it on cross-link, and redirect binding is incomplete.

- [ ] **Step 3: Implement minimal validated return handling**

Accept only paths beginning with one `/`, reject `//`, schemes, and external origins. Prefer a fresh v2 pending intent destination over generic fallback. Preserve `next` across links and errors. Bind the invite to the resolved UID after authentication; surface account mismatch in the invite route rather than clearing silently.

- [ ] **Step 4: Run focused GREEN**

Run the RED command again; expected PASS.

- [ ] **Step 5: Run relevant regression group**

Run: `npx vitest run src/store/authBootstrap.test.tsx src/lib/googleRedirectAuth.test.ts src/pages/Login.test.tsx src/pages/Signup.test.tsx src/pages/AdultInvite.test.tsx`

- [ ] **Step 6: Check the diff**

Run: `git diff --check && git diff -- src/lib/googleRedirectAuth.ts src/lib/googleRedirectAuth.test.ts src/pages/Login.tsx src/pages/Login.test.tsx src/pages/Signup.tsx src/pages/Signup.test.tsx src/pages/AdultInvite.tsx src/pages/AdultInvite.test.tsx`

- [ ] **Step 7: Commit exact files**

```bash
git add src/lib/googleRedirectAuth.ts src/lib/googleRedirectAuth.test.ts src/pages/Login.tsx src/pages/Login.test.tsx src/pages/Signup.tsx src/pages/Signup.test.tsx src/pages/AdultInvite.tsx src/pages/AdultInvite.test.tsx
git commit -m "fix(auth): resume adult invites across authentication"
```

---

### Task 7: Global `AuthRoutingGate`

**Files:**
- Create: `src/auth/AuthRoutingGate.tsx`
- Create: `src/auth/AuthRoutingGate.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/layout/AppLayout.tsx`
- Modify: `src/components/layout/AppLayout.test.tsx`
- Modify: `src/store/useStore.ts`
- Modify: `src/store/authBootstrap.test.tsx`

**Interfaces:**
- Consumes store fields: `authStatus`, `authUser`, `currentUser`, `profileServerConfirmed`, `appReady`, `bootstrapError`.
- Consumes pending v2/legacy intent and explicit creation intent.
- Produces route decisions: `startup | invite | app | pendingMembership | noFamily | createOnboarding | publicOnboarding | login`.
- `AppLayout` retains visual shell and managed-child password gate but no longer owns no-family routing policy.

- [ ] **Step 1: Write failing routing-priority tests**

```tsx
it('routes authenticated no-family invite recipient to invite, never creation onboarding', () => {
  seedAuth({ uid: 'u1', familyId: undefined })
  capturePendingInvite(TOKEN)
  renderGate('/')
  expect(currentPath()).toBe(`/invite/${TOKEN}`)
  expect(screen.queryByTestId('onboarding-flow')).not.toBeInTheDocument()
})

it('routes an authenticated no-family user without invite to /no-family', () => {
  seedAuth({ uid: 'u1', familyId: undefined })
  renderGate('/')
  expect(currentPath()).toBe('/no-family')
})

it('existing active membership outranks stale create draft', () => { /* familyId family-1 + stale draft => / */ })
it('pending legacy membership recovery never enters creation onboarding', () => { /* pending state => /join/pending */ })
it('Google auth state transition alone causes zero createFamilyAndParent calls', async () => { /* fire listener; assert datastore family collection empty */ })
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/auth/AuthRoutingGate.test.tsx src/components/layout/AppLayout.test.tsx src/store/authBootstrap.test.tsx`

Expected: FAIL because `AppLayout` still redirects every no-family user to `/onboarding`.

- [ ] **Step 3: Implement the focused gate**

Extract pure `deriveAuthRouteDecision(input)` plus a thin React navigation wrapper. Install it at the protected/public routing boundary in `App.tsx`. Remove only superseded redirects from `AppLayout`. Add the minimum pending/recovery store signal required to recognize an existing pending legacy request without changing its approval behavior.

- [ ] **Step 4: Run focused GREEN**

Run the RED command again; expected PASS.

- [ ] **Step 5: Run relevant regression group**

Run: `npx vitest run src/App.test.tsx src/auth/AuthRoutingGate.test.tsx src/components/layout/AppLayout.test.tsx src/store/authBootstrap.test.tsx src/onboarding/onboarding.existingFamilyRegression.test.tsx`

- [ ] **Step 6: Check the diff**

Run: `git diff --check && git diff -- src/auth/AuthRoutingGate.tsx src/auth/AuthRoutingGate.test.tsx src/App.tsx src/components/layout/AppLayout.tsx src/components/layout/AppLayout.test.tsx src/store/useStore.ts src/store/authBootstrap.test.tsx`

- [ ] **Step 7: Commit exact files**

```bash
git add src/auth/AuthRoutingGate.tsx src/auth/AuthRoutingGate.test.tsx src/App.tsx src/components/layout/AppLayout.tsx src/components/layout/AppLayout.test.tsx src/store/useStore.ts src/store/authBootstrap.test.tsx
git commit -m "refactor(auth): prioritize invitation and membership routing"
```

---

### Task 8: Explicit no-family choice and family-creation intent

**Files:**
- Create: `src/auth/createFamilyIntent.ts`
- Create: `src/auth/createFamilyIntent.test.ts`
- Create: `src/pages/NoFamilyChoice.tsx`
- Create: `src/pages/NoFamilyChoice.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/onboarding/OnboardingFlow.tsx`
- Modify: `src/onboarding/OnboardingFlow.test.tsx`
- Modify: `src/onboarding/postauth/FamilyComposition.tsx`
- Modify: `src/onboarding/OnboardingStabilization.test.tsx`
- Modify: `src/i18n/locales/en/onboarding.json`
- Modify: `src/i18n/locales/tr/onboarding.json`

**Interfaces:**
- Produces: `CreateFamilyIntent = {version: 1; kind: 'create-family'; authUid: string; createdAt: number}`.
- Produces: `startCreateFamilyIntent(uid)`, `readCreateFamilyIntent(uid, now?)`, `clearCreateFamilyIntent()`.
- Route: `/no-family` with explicit Create and Join actions.
- `FamilyComposition` calls setup only when valid intent is supplied for current UID.

- [ ] **Step 1: Write failing explicit-action tests**

```tsx
it('renders Create a family and Join an existing family without writing', () => {
  renderChoice(noFamilyUser)
  expect(screen.getByRole('button', { name: 'Create a family' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Join an existing family' })).toBeVisible()
  expect(createFamilyAndParent).not.toHaveBeenCalled()
})

it('records a UID-bound intent only after explicit Create', async () => {
  await user.click(screen.getByRole('button', { name: 'Create a family' }))
  expect(readCreateFamilyIntent('u1')).toMatchObject({ kind: 'create-family', authUid: 'u1' })
  expect(navigate).toHaveBeenCalledWith('/onboarding?mode=create')
})

it('Google auth and stale p1 draft create zero family documents without explicit intent', async () => {
  seedDraft({ step: 'p1', familyName: 'Accidental' })
  renderOnboarding(authenticatedNoFamilyUser)
  await settleBootstrap()
  expect(createFamilyAndParent).not.toHaveBeenCalled()
  expect(firestoreFamilies()).toHaveLength(0)
})
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/auth/createFamilyIntent.test.ts src/pages/NoFamilyChoice.test.tsx src/onboarding/OnboardingFlow.test.tsx src/onboarding/OnboardingStabilization.test.tsx`

Expected: FAIL because `/no-family` and create intent do not exist and `p1` still auto-creates.

- [ ] **Step 3: Implement minimal explicit creation gate**

Persist create intent in session storage only, bind to UID, expire after 30 minutes, and clear on completion/sign-out/account mismatch. Register `/no-family`. Create button starts intent; Join goes to the authenticated manual join entry. Gate post-auth onboarding and `FamilyComposition` setup on the valid intent. A missing/invalid intent redirects back to `/no-family` without writes.

- [ ] **Step 4: Run focused GREEN**

Run the RED command again; expected PASS.

- [ ] **Step 5: Run relevant regression group**

Run: `npx vitest run src/onboarding/OnboardingFlow.test.tsx src/onboarding/OnboardingStabilization.test.tsx src/onboarding/onboarding.existingFamilyRegression.test.tsx src/lib/api.familyCreation.test.ts src/pages/NoFamilyChoice.test.tsx`

- [ ] **Step 6: Check the diff**

Run: `git diff --check && git diff -- src/auth/createFamilyIntent.ts src/auth/createFamilyIntent.test.ts src/pages/NoFamilyChoice.tsx src/pages/NoFamilyChoice.test.tsx src/App.tsx src/onboarding/OnboardingFlow.tsx src/onboarding/OnboardingFlow.test.tsx src/onboarding/postauth/FamilyComposition.tsx src/onboarding/OnboardingStabilization.test.tsx src/i18n/locales/en/onboarding.json src/i18n/locales/tr/onboarding.json`

- [ ] **Step 7: Commit exact files**

```bash
git add src/auth/createFamilyIntent.ts src/auth/createFamilyIntent.test.ts src/pages/NoFamilyChoice.tsx src/pages/NoFamilyChoice.test.tsx src/App.tsx src/onboarding/OnboardingFlow.tsx src/onboarding/OnboardingFlow.test.tsx src/onboarding/postauth/FamilyComposition.tsx src/onboarding/OnboardingStabilization.test.tsx src/i18n/locales/en/onboarding.json src/i18n/locales/tr/onboarding.json
git commit -m "fix(onboarding): require explicit family creation choice"
```

---

### Task 9: Canonical owner Invite Parent/Adult UI

**Files:**
- Create: `src/components/family/AdultInviteCard.tsx`
- Create: `src/components/family/AdultInviteCard.test.tsx`
- Modify: `src/components/dashboard/InviteMemberCard.tsx`
- Modify: `src/components/dashboard/InviteMemberCard.test.tsx`
- Modify: `src/components/family/FamilySettings.tsx`
- Modify: `src/components/family/FamilySettings.test.tsx`
- Modify: `src/onboarding/postauth/FamilyComposition.tsx`
- Modify: `src/onboarding/OnboardingFlow.test.tsx`
- Modify: `src/i18n/locales/en/family.json`
- Modify: `src/i18n/locales/tr/family.json`
- Modify: `src/i18n/locales/en/settings.json`
- Modify: `src/i18n/locales/tr/settings.json`

**Interfaces:**
- `AdultInviteCard({ defaultRole?: 'parent' | 'adult'; onClose?(): void })`.
- Consumes Task 5 `createAdultInvitation` and `revokeAdultInvitation`.
- Generates `/invite/${encodeURIComponent(token)}` from the live origin.
- Owner-only; Parent is default; no family code is a primary adult action.

- [ ] **Step 1: Write failing canonical-UI tests**

```tsx
it('creates a real v2 parent invitation from Settings Add Parent', async () => {
  renderSettings(ownerState)
  await user.click(screen.getByRole('button', { name: 'Add parent or adult' }))
  await user.click(screen.getByRole('button', { name: 'Create private invitation' }))
  expect(createAdultInvitation).toHaveBeenCalledWith({ intendedRole: 'parent', clientReqId: expect.any(String) })
  expect(await screen.findByRole('button', { name: 'Copy private link' })).toBeEnabled()
})

it('uses the same AdultInviteCard primitive from Family Hub', async () => {
  renderInviteMember(ownerState)
  await user.click(screen.getByRole('button', { name: /Another Parent/ }))
  expect(screen.getByTestId('adult-invite-card')).toBeVisible()
})

it('does not create adult invites for a non-owner', () => {
  renderInviteMember(parentState)
  expect(screen.queryByRole('button', { name: /Another Parent/ })).not.toBeInTheDocument()
})

it('FamilyComposition never builds a parent URL from familyData.inviteCode', async () => {
  renderComposition(explicitCreateState)
  await user.click(screen.getByRole('button', { name: 'Invite another parent' }))
  expect(createAdultInvitation).toHaveBeenCalled()
  expect(buildJoinUrl).not.toHaveBeenCalledWith('ABC123')
})
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/components/family/AdultInviteCard.test.tsx src/components/dashboard/InviteMemberCard.test.tsx src/components/family/FamilySettings.test.tsx src/onboarding/OnboardingFlow.test.tsx`

Expected: FAIL because Settings still exposes the reusable code and onboarding still calls `buildJoinUrl(familyData.inviteCode)`.

- [ ] **Step 3: Implement the shared owner component**

Build one component with Parent/Adult selector, create/share/copy/revoke states, one in-memory raw token, safe invitation ID, and unavailable retry. Replace Settings and Family Hub adult actions with it. Keep child-with-device and managed-child choices unchanged. Open the same component from `FamilyComposition`; remove the family-code link construction.

- [ ] **Step 4: Run focused GREEN**

Run the RED command again; expected PASS.

- [ ] **Step 5: Run relevant regression group**

Run: `npx vitest run src/pages/Family.test.tsx src/components/dashboard/InviteMemberCard.test.tsx src/components/family/FamilySettings.test.tsx src/components/family/FamilySettings.lifecycle.test.tsx src/onboarding/OnboardingFlow.test.tsx`

- [ ] **Step 6: Check the diff**

Run: `git diff --check && git diff -- src/components/family/AdultInviteCard.tsx src/components/family/AdultInviteCard.test.tsx src/components/dashboard/InviteMemberCard.tsx src/components/dashboard/InviteMemberCard.test.tsx src/components/family/FamilySettings.tsx src/components/family/FamilySettings.test.tsx src/onboarding/postauth/FamilyComposition.tsx src/onboarding/OnboardingFlow.test.tsx src/i18n/locales/en/family.json src/i18n/locales/tr/family.json src/i18n/locales/en/settings.json src/i18n/locales/tr/settings.json`

- [ ] **Step 7: Commit exact files**

```bash
git add src/components/family/AdultInviteCard.tsx src/components/family/AdultInviteCard.test.tsx src/components/dashboard/InviteMemberCard.tsx src/components/dashboard/InviteMemberCard.test.tsx src/components/family/FamilySettings.tsx src/components/family/FamilySettings.test.tsx src/onboarding/postauth/FamilyComposition.tsx src/onboarding/OnboardingFlow.test.tsx src/i18n/locales/en/family.json src/i18n/locales/tr/family.json src/i18n/locales/en/settings.json src/i18n/locales/tr/settings.json
git commit -m "feat(family): unify owner adult invitation UI"
```

---

### Task 10: Legacy invitation compatibility window

**Files:**
- Modify: `src/lib/inviteLink.ts`
- Modify: `src/lib/inviteLink.test.ts`
- Modify: `src/pages/JoinInvite.tsx`
- Modify: `src/pages/JoinInvite.test.tsx`
- Modify: `functions/src/familyInvitations.ts`
- Modify: `functions/src/familyInvitations.test.ts`
- Modify: `functions/src/familyMembership.test.ts`
- Modify: `src/auth/AuthRoutingGate.tsx`
- Modify: `src/auth/AuthRoutingGate.test.tsx`

**Interfaces:**
- Legacy route remains `/join?code=<six-character-role-invitation>`.
- Legacy storage key remains read-only compatibility input `queki.pendingInviteCode`.
- Legacy acceptance result remains `{familyId, status: 'pending', intendedRole}`.
- Family-code manual join result remains pending with no requester-controlled role.
- No new owner UI calls `createFamilyInvitation`.

- [ ] **Step 1: Write failing compatibility and non-authority tests**

```ts
it('resumes an already-issued six-character role invitation through the legacy route', () => {
  localStorage.setItem('queki.pendingInviteCode', '7ZXWRZ')
  expect(legacyInviteDestination()).toBe('/join?code=7ZXWRZ')
})

it('keeps legacy acceptance pending rather than applying v2 immediate membership', async () => {
  const result = await acceptLegacyInvite('7ZXWRZ', 'joiner')
  expect(result.status).toBe('pending')
  expect(documents.get('users/joiner')?.familyId).toBeUndefined()
})

it('family inviteCode creates only a role-less pending request and cannot confer parent/adult', async () => {
  const result = await requestFamilyJoinImpl({ familyCode: 'ABC123', clientReqId: 'req-manual-01' }, auth('joiner'), context)
  expect(result.status).toBe('pending')
  expect(documents.get('families/family-1/join_requests/joiner')).not.toHaveProperty('intendedRole')
  expect(documents.get('users/joiner')).not.toHaveProperty('familyId')
})
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/lib/inviteLink.test.ts src/pages/JoinInvite.test.tsx src/auth/AuthRoutingGate.test.tsx`

Run: `cd functions && npx vitest run src/familyInvitations.test.ts src/familyMembership.test.ts`

Expected: at least the new compatibility routing/storage-version assertions fail before explicit coexistence logic is added.

- [ ] **Step 3: Implement minimal coexistence logic**

Classify only strict six-character codes as legacy role invitations, preserve their existing route and pending semantics, and clear legacy storage on terminal completion/expiry. Do not let `/invite/:token` call legacy functions. Add a documented compatibility cutoff constant used only to stop resuming stale local legacy intent after the operational window; server `expiresAtMs` remains authoritative.

- [ ] **Step 4: Run focused GREEN**

Run both RED commands again; expected PASS.

- [ ] **Step 5: Run relevant regression group**

Run: `npx vitest run src/lib/inviteLink.test.ts src/pages/JoinInvite.test.tsx src/pages/AdultInvite.test.tsx src/auth/AuthRoutingGate.test.tsx`

Run: `cd functions && npx vitest run src/familyInvitations.test.ts src/familyMembership.test.ts src/adultInvitations.test.ts`

- [ ] **Step 6: Check the diff**

Run: `git diff --check && git diff -- src/lib/inviteLink.ts src/lib/inviteLink.test.ts src/pages/JoinInvite.tsx src/pages/JoinInvite.test.tsx functions/src/familyInvitations.ts functions/src/familyInvitations.test.ts functions/src/familyMembership.test.ts src/auth/AuthRoutingGate.tsx src/auth/AuthRoutingGate.test.tsx`

- [ ] **Step 7: Commit exact files**

```bash
git add src/lib/inviteLink.ts src/lib/inviteLink.test.ts src/pages/JoinInvite.tsx src/pages/JoinInvite.test.tsx functions/src/familyInvitations.ts functions/src/familyInvitations.test.ts functions/src/familyMembership.test.ts src/auth/AuthRoutingGate.tsx src/auth/AuthRoutingGate.test.tsx
git commit -m "fix(invites): preserve bounded legacy invitation compatibility"
```

---

### Task 11: Invite-aware auth error normalization

**Files:**
- Create: `src/auth/authErrorMessage.ts`
- Create: `src/auth/authErrorMessage.test.ts`
- Modify: `src/pages/Login.tsx`
- Modify: `src/pages/Login.test.tsx`
- Modify: `src/pages/Signup.tsx`
- Modify: `src/pages/Signup.test.tsx`
- Modify: `src/pages/AdultInvite.tsx`
- Modify: `src/i18n/locales/en/auth.json`
- Modify: `src/i18n/locales/tr/auth.json`
- Modify: `src/lib/api.ts`
- Modify: `src/lib/authErrors.test.ts`

**Interfaces:**
- Produces: `mapAuthErrorKey(error, context: {pendingInvite: boolean}): AuthErrorKey`.
- Stable keys cover `email-already-in-use`, `invalid-credential`, `popup-closed-by-user`, `account-exists-with-different-credential`, network, throttling, and generic.
- Existing `mapAuthErrorMessage` delegates to the shared mapper or is retired after all call sites migrate.

- [ ] **Step 1: Write failing friendly-error tests**

```ts
it('maps email-already-in-use to invite-aware sign-in guidance', () => {
  expect(mapAuthErrorKey({ code: 'auth/email-already-in-use', message: 'Firebase: raw' }, { pendingInvite: true })).toBe('auth:errors.emailAlreadyUsedInvite')
})

it.each(['auth/invalid-credential', 'auth/popup-closed-by-user', 'auth/account-exists-with-different-credential'])('never returns raw Firebase text for %s', async code => {
  authCall.mockRejectedValue({ code, message: `Firebase raw ${code}` })
  renderAuthWithInvite()
  await submit()
  expect(screen.queryByText(/Firebase raw|auth\//)).not.toBeInTheDocument()
  expect(readPendingInvite()?.token).toBe(TOKEN)
})
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run src/auth/authErrorMessage.test.ts src/pages/Login.test.tsx src/pages/Signup.test.tsx src/lib/authErrors.test.ts`

Expected: FAIL because Login/Signup currently render `err.message` and email-already-in-use lacks invite copy.

- [ ] **Step 3: Implement minimal shared mapper and translated copy**

Map by `error.code`, return translation keys, never interpolate raw `message`, retain pending intent on every auth error, and add an invite-preserving Sign in link for email-already-in-use.

- [ ] **Step 4: Run focused GREEN**

Run the RED command again; expected PASS.

- [ ] **Step 5: Run relevant regression group**

Run: `npx vitest run src/i18n/i18n.auth.test.ts src/pages/Login.test.tsx src/pages/Signup.test.tsx src/pages/AdultInvite.test.tsx src/lib/authErrors.test.ts`

- [ ] **Step 6: Check the diff**

Run: `git diff --check && git diff -- src/auth/authErrorMessage.ts src/auth/authErrorMessage.test.ts src/pages/Login.tsx src/pages/Login.test.tsx src/pages/Signup.tsx src/pages/Signup.test.tsx src/pages/AdultInvite.tsx src/i18n/locales/en/auth.json src/i18n/locales/tr/auth.json src/lib/api.ts src/lib/authErrors.test.ts`

- [ ] **Step 7: Commit exact files**

```bash
git add src/auth/authErrorMessage.ts src/auth/authErrorMessage.test.ts src/pages/Login.tsx src/pages/Login.test.tsx src/pages/Signup.tsx src/pages/Signup.test.tsx src/pages/AdultInvite.tsx src/i18n/locales/en/auth.json src/i18n/locales/tr/auth.json src/lib/api.ts src/lib/authErrors.test.ts
git commit -m "fix(auth): normalize invitation authentication errors"
```

---

### Task 12: Child-flow and pending-legacy regression protection

**Files:**
- Modify: `src/pages/JoinFamily.test.tsx`
- Modify: `src/components/auth/MandatoryChildPasswordChange.test.tsx`
- Modify: `src/lib/childJoinApi.test.ts`
- Modify: `src/lib/childLoginApi.test.ts`
- Modify: `functions/src/childJoinRequest.test.ts`
- Modify: `functions/src/childLogin.test.ts`
- Modify: `tests/firestore/childJoinRequest.rules.test.ts`
- Modify: `tests/firestore/approvalCenter.rules.test.ts`

**Interfaces:**
- Preserves all existing child callable payloads and return types.
- Preserves family-code child lookup and pending approval.
- Preserves managed-child custom-token and password-change claims.
- Preserves pending legacy adult request approval transaction.

- [ ] **Step 1: Write the failing behavior-focused regression tests before any compatibility cleanup**

```tsx
it('submits the existing child join payload without adult invitation fields', async () => {
  await completeChildJoin({ familyCode: 'ABC123', username: 'sam', password: 'Password1!' })
  expect(submitChildJoinRequest).toHaveBeenCalledWith({ familyCode: 'ABC123', username: 'sam', password: 'Password1!' })
  expect(submitChildJoinRequest.mock.calls[0][0]).not.toHaveProperty('token')
})

it('managed-child login still exchanges family code, username and password for a custom token', async () => { /* assert returned customToken and claims */ })
it('owner can still approve an existing pending legacy join request atomically', async () => { /* assert profile/request/feed write set */ })
```

- [ ] **Step 2: Run RED through a deliberate contract mutation and record the expected assertion failure**

Temporarily run the focused tests against the current branch: `npx vitest run src/pages/JoinFamily.test.tsx src/lib/childJoinApi.test.ts src/lib/childLoginApi.test.ts`

Then perform the mutation check by locally changing the child API test double to receive `{token: TOKEN}` instead of `familyCode`, run the focused assertion, and record the expected FAIL proving the new regression test detects adult-invite leakage into the child contract. Immediately revert only that deliberate test mutation with `apply_patch`.

For function/rules coverage run: `cd functions && npx vitest run src/childJoinRequest.test.ts src/childLogin.test.ts` and `firebase emulators:exec --only firestore,auth "npx vitest run tests/firestore/childJoinRequest.rules.test.ts tests/firestore/approvalCenter.rules.test.ts"`.

- [ ] **Step 3: Make only compatibility fixes exposed by the regression suite**

If Task 1–11 changed a child contract, restore the old child payload/route/rules rather than adapting child tests to adult semantics. Keep adult and child modules separate. If all assertions already pass, make no production change in this task.

- [ ] **Step 4: Run focused GREEN**

Run all three commands from Step 2 with the deliberate mutation removed; expected PASS.

- [ ] **Step 5: Run relevant regression group**

Run: `npx vitest run src/pages/JoinFamily.test.tsx src/pages/Login.test.tsx src/components/auth/MandatoryChildPasswordChange.test.tsx src/lib/childJoinApi.test.ts src/lib/childLoginApi.test.ts`

Run: `cd functions && npx vitest run src/childJoinRequest.test.ts src/childLogin.test.ts src/familyMembership.test.ts`

- [ ] **Step 6: Check the diff**

Run: `git diff --check && git diff -- src/pages/JoinFamily.test.tsx src/components/auth/MandatoryChildPasswordChange.test.tsx src/lib/childJoinApi.test.ts src/lib/childLoginApi.test.ts functions/src/childJoinRequest.test.ts functions/src/childLogin.test.ts tests/firestore/childJoinRequest.rules.test.ts tests/firestore/approvalCenter.rules.test.ts`

- [ ] **Step 7: Commit exact changed files**

```bash
git add src/pages/JoinFamily.test.tsx src/components/auth/MandatoryChildPasswordChange.test.tsx src/lib/childJoinApi.test.ts src/lib/childLoginApi.test.ts functions/src/childJoinRequest.test.ts functions/src/childLogin.test.ts tests/firestore/childJoinRequest.rules.test.ts tests/firestore/approvalCenter.rules.test.ts
git commit -m "test(auth): protect child and legacy join flows"
```

Omit unchanged files. If no file needed a change because existing coverage already proves every requirement, record that evidence in the task execution log and do not create an empty commit.

---

### Task 13: Browser E2E invitation and zero-family-creation matrix

**Files:**
- Create: `tests/e2e/adult-invite.spec.ts`
- Create: `tests/e2e/utils/adultInvite.ts`
- Modify: `tests/e2e/utils/seed.ts`
- Modify: `tests/e2e/sw-lifecycle.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `playwright.mobile.config.ts`

**Interfaces:**
- E2E helper creates/revokes v2 invitations only through callable HTTP/API boundary, returning raw token to the test process without logging it.
- Uses disposable emulator users/families and counts `families` before/after auth.
- Mobile project exercises redirect-equivalent auth restoration; SW project exercises controlled reload.

- [ ] **Step 1: Write failing real-browser scenarios**

```ts
test('Settings owner invite → email signup → immediate parent dashboard', async ({ page, context }) => { /* create link in UI, new context opens it, signs up, confirms, dashboard */ })
test('Family Hub uses the same v2 link shape and callable', async ({ page }) => { /* /invite/43-char-token */ })
test('popup auth retains invitation token', async ({ page }) => { /* supported emulator auth equivalent */ })
test('mobile redirect auth retains invitation token', async ({ page }) => { /* redirect bootstrap hook */ })
test('refresh and SW-controlled reload retain invitation and never show creation onboarding', async ({ page }) => { /* reload at auth and confirmation */ })
test('Signup → Login preserves an existing-account invitation', async ({ page }) => { /* email-already-used then sign in */ })
test('same-family is harmless and other-family is conflict', async ({ browser }) => { /* two contexts */ })
test('expired, revoked and used tokens render their terminal state', async ({ page }) => { /* server fixtures */ })
test('no invite renders Create/Join choice', async ({ page }) => { /* authenticated no family */ })
test('Google auth success creates zero family documents', async ({ page }) => {
  const before = await countFamilies()
  await completeGoogleEquivalent(page, 'new-google-user')
  await expect(page).toHaveURL('/no-family')
  expect(await countFamilies()).toBe(before)
})
test('stale creation draft cannot create until Create a family is clicked', async ({ page }) => { /* seed local draft; assert zero writes */ })
```

- [ ] **Step 2: Run RED**

Run: `firebase emulators:exec --only firestore,auth,functions "npx playwright test tests/e2e/adult-invite.spec.ts --project=chromium"`

Expected: FAIL on missing route/UI/gate or any uncovered integration mismatch; record each failing scenario rather than weakening assertions.

- [ ] **Step 3: Implement only E2E fixtures and minimal integration corrections**

Add deterministic emulator seeding and auth hooks. Fix product code only when the browser exposes an integration defect, and first add or identify the narrower unit/integration RED test that reproduces it. Never bypass callable authorization by writing v2 invitation records from the browser.

- [ ] **Step 4: Run focused GREEN**

Run: `firebase emulators:exec --only firestore,auth,functions "npx playwright test tests/e2e/adult-invite.spec.ts --project=chromium"`

Run mobile: `firebase emulators:exec --only firestore,auth,functions "npx playwright test tests/e2e/adult-invite.spec.ts --config playwright.mobile.config.ts"`

Expected: all adult invitation scenarios PASS.

- [ ] **Step 5: Run relevant regression group**

Run: `firebase emulators:exec --only firestore,auth,functions "npx playwright test tests/e2e/inviteMember.spec.ts tests/e2e/onboarding.spec.ts tests/e2e/onboardingLoop.spec.ts tests/e2e/adult-invite.spec.ts --project=chromium"`

Run SW: `npx playwright test tests/e2e/sw-lifecycle.spec.ts --config playwright.sw-lifecycle.config.ts`.

- [ ] **Step 6: Check the diff**

Run: `git diff --check && git diff -- tests/e2e/adult-invite.spec.ts tests/e2e/utils/adultInvite.ts tests/e2e/utils/seed.ts tests/e2e/sw-lifecycle.spec.ts playwright.config.ts playwright.mobile.config.ts`

- [ ] **Step 7: Commit exact files plus any separately tested integration correction**

```bash
git add tests/e2e/adult-invite.spec.ts tests/e2e/utils/adultInvite.ts tests/e2e/utils/seed.ts tests/e2e/sw-lifecycle.spec.ts playwright.config.ts playwright.mobile.config.ts
git commit -m "test(e2e): cover adult invitation authentication journey"
```

Any production correction discovered here must include its narrower RED test and be listed explicitly in this commit rather than hidden as an untested E2E-only fix.

---

### Task 14: Sanitized invitation and onboarding observability

**Files:**
- Create: `functions/src/adultInvitationEvents.ts`
- Create: `functions/src/adultInvitationEvents.test.ts`
- Modify: `functions/src/adultInvitations.ts`
- Modify: `functions/src/adultInvitations.test.ts`
- Create: `src/auth/inviteAnalytics.ts`
- Create: `src/auth/inviteAnalytics.test.ts`
- Modify: `src/pages/AdultInvite.tsx`
- Modify: `src/pages/NoFamilyChoice.tsx`
- Modify: `src/onboarding/OnboardingFlow.tsx`

**Interfaces:**
- Server `recordAdultInvitationEvent(eventName, fields)` allowlists version, role, outcome category, latency bucket, build/correlation ID.
- Client `recordInviteEvent(name, fields)` allowlists auth provider category, role, outcome, and build SHA.
- Required events: `invitation_created`, `invitation_preview_failed`, `invitation_accepted`, `invitation_conflict`, `invitation_expired`, `invite_auth_resumed`, `no_family_choice_rendered`, `family_creation_explicitly_started`.

- [ ] **Step 1: Write failing sanitization tests**

```ts
it('drops token, hash, invitation id, uid, family id, email and display name from server events', () => {
  recordAdultInvitationEvent('invitation_created', sensitiveFixture)
  expect(logger.info).toHaveBeenCalledWith('adult_invitation_event', {
    eventName: 'invitation_created', version: 2, intendedRole: 'parent', outcome: 'success'
  })
  expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/rawToken|tokenHash|smith@example|family-1|uid-1|Smith/)
})

it('emits family_creation_explicitly_started only from the Create action', async () => {
  renderChoice()
  expect(recordInviteEvent).not.toHaveBeenCalledWith('family_creation_explicitly_started', expect.anything())
  await user.click(screen.getByRole('button', { name: 'Create a family' }))
  expect(recordInviteEvent).toHaveBeenCalledWith('family_creation_explicitly_started', { source: 'no_family_choice' })
})
```

- [ ] **Step 2: Run RED**

Run: `cd functions && npx vitest run src/adultInvitationEvents.test.ts src/adultInvitations.test.ts`

Run: `npx vitest run src/auth/inviteAnalytics.test.ts src/pages/AdultInvite.test.tsx src/pages/NoFamilyChoice.test.tsx`

Expected: FAIL because the allowlisted event modules do not exist.

- [ ] **Step 3: Implement minimal allowlisted emitters and call sites**

Construct new objects from explicit allowed fields; never spread caller payloads. Categorize errors before emission. Emit choice-rendered once per mount and creation-started only inside the explicit click handler. Do not add identifiers beyond the spec allowlist.

- [ ] **Step 4: Run focused GREEN**

Run both RED commands again; expected PASS.

- [ ] **Step 5: Run relevant regression group**

Run: `cd functions && npx vitest run src/adultInvitationEvents.test.ts src/adultInvitations.test.ts`

Run: `npx vitest run src/auth/inviteAnalytics.test.ts src/pages/AdultInvite.test.tsx src/pages/NoFamilyChoice.test.tsx src/onboarding/OnboardingFlow.test.tsx`

- [ ] **Step 6: Check the diff**

Run: `git diff --check && git diff -- functions/src/adultInvitationEvents.ts functions/src/adultInvitationEvents.test.ts functions/src/adultInvitations.ts functions/src/adultInvitations.test.ts src/auth/inviteAnalytics.ts src/auth/inviteAnalytics.test.ts src/pages/AdultInvite.tsx src/pages/NoFamilyChoice.tsx src/onboarding/OnboardingFlow.tsx`

- [ ] **Step 7: Commit exact files**

```bash
git add functions/src/adultInvitationEvents.ts functions/src/adultInvitationEvents.test.ts functions/src/adultInvitations.ts functions/src/adultInvitations.test.ts src/auth/inviteAnalytics.ts src/auth/inviteAnalytics.test.ts src/pages/AdultInvite.tsx src/pages/NoFamilyChoice.tsx src/onboarding/OnboardingFlow.tsx
git commit -m "feat(observability): add sanitized adult invitation events"
```

---

### Task 15: Deployment compatibility, release verification, and rollback gate

**Files:**
- Create: `docs/operations/parent-invite-v2-rollout.md`
- Create: `scripts/verify-parent-invite-v2-contract.cjs`
- Create: `scripts/verify-parent-invite-v2-contract.test.cjs`
- Modify: `package.json`
- Modify: `firebase.json` only if explicit function deployment grouping is required

**Interfaces:**
- Produces script command: `npm run verify:parent-invite-v2`.
- Script verifies exported callable names, canonical frontend route build artifact, server-only rules markers through behavior-oriented emulator probe configuration, and absence of v2 fallback to family-code authority.
- Operations document defines exact deploy/observe/rollback gates and legacy cutoff procedure.

- [ ] **Step 1: Write failing release-contract script tests**

```js
it('fails when the backend lacks any v2 callable export', () => {
  const result = runVerifier(fixtureWithout('acceptAdultInvitation'))
  assert.equal(result.exitCode, 1)
  assert.match(result.stderr, /missing callable: acceptAdultInvitation/)
})

it('fails when frontend parent invite configuration falls back to family inviteCode', () => {
  const result = runVerifier(fixtureWithAdultFallback())
  assert.equal(result.exitCode, 1)
  assert.match(result.stderr, /family code cannot authorize adult membership/)
})
```

The verifier must parse controlled manifest/contract fixtures or invoke build exports; it must not merely grep human documentation.

- [ ] **Step 2: Run RED**

Run: `node --test scripts/verify-parent-invite-v2-contract.test.cjs`

Expected: FAIL because the verifier does not exist.

- [ ] **Step 3: Implement the minimal verifier and rollout runbook**

Add a deterministic verifier with injectable filesystem/build-manifest inputs. Document rollout order:

1. deploy backend v2;
2. deploy rules if required;
3. run backend/legacy/child smoke probes;
4. deploy frontend;
5. run desktop/mobile/SW smoke tests;
6. observe categorized metrics and zero unauthorized family creation;
7. disable new legacy adult invitation creation;
8. remove legacy preview/accept only after TTL plus safety margin.

Document rollback: keep v2 preview/accept active for issued links, allow disabling creation, preserve server-only rules, let old frontend continue legacy behavior, let new frontend show retry when v2 is unavailable, and never use `families.inviteCode` as a fallback authority. State explicitly that initial rollout has no production-data migration.

- [ ] **Step 4: Run focused GREEN**

Run: `node --test scripts/verify-parent-invite-v2-contract.test.cjs && npm run verify:parent-invite-v2`

Expected: PASS against the completed implementation.

- [ ] **Step 5: Run full release verification**

Run in order and require exit 0 from each:

```bash
npm run typecheck
npm run lint
npm test
cd functions && npm run build && npm test
cd .. && npm run test:rules
firebase emulators:exec --only firestore,auth,functions "npx playwright test tests/e2e/adult-invite.spec.ts tests/e2e/inviteMember.spec.ts tests/e2e/onboarding.spec.ts --project=chromium"
npx playwright test tests/e2e/sw-lifecycle.spec.ts --config playwright.sw-lifecycle.config.ts
npm run build
npm run verify:parent-invite-v2
```

Read full output and record test counts/failures. Do not claim release readiness from a partial subset.

- [ ] **Step 6: Check the final diff and repository state**

Run: `git diff --check && git status --short && git diff -- docs/operations/parent-invite-v2-rollout.md scripts/verify-parent-invite-v2-contract.cjs scripts/verify-parent-invite-v2-contract.test.cjs package.json firebase.json`

Confirm unrelated pre-existing user files remain untouched.

- [ ] **Step 7: Commit exact files**

```bash
git add docs/operations/parent-invite-v2-rollout.md scripts/verify-parent-invite-v2-contract.cjs scripts/verify-parent-invite-v2-contract.test.cjs package.json
git add firebase.json  # only when changed for explicit deployment grouping
git commit -m "docs(ops): add adult invitation rollout gate"
```

## Acceptance-criterion coverage map

| Spec acceptance criterion | Implementing task(s) | Proving test/task |
|---|---|---|
| Owner-only create/revoke | 2, 9 | Function authorization; owner-only UI |
| 128+ bit token; hash-only storage | 1, 2 | Token literal/hash and Firestore-record absence tests |
| SHA-256 document key | 1, 2 | Domain hash and creation record tests |
| Minimal preview | 2, 5 | Callable projection and pre-auth route tests |
| Invalid lifecycle/status rejection | 2, 5, 13 | Function table and browser terminal states |
| Atomic immediate acceptance | 2, 13 | Emulator concurrency and browser dashboard journey |
| Server-derived role; owner forgery impossible | 2, 3 | Forged payload and Rules tests |
| Same-family/other-family behavior | 2, 5, 13 | Function, route, and browser tests |
| Auth/refresh/PWA persistence | 4, 6, 13 | Storage, auth, mobile, and SW tests |
| Invite outranks onboarding | 7, 13 | Gate and browser tests |
| No invite shows Create/Join | 7, 8, 13 | Route and browser tests |
| Google auth creates zero families | 7, 8, 13 | Bootstrap/datastore and E2E count assertions |
| Explicit UID-bound creation | 8 | Create-intent and stale-draft tests |
| Unified owner UI | 9, 13 | Shared component and two entry-point E2E tests |
| No `familyData.inviteCode` parent link | 9 | FamilyComposition regression test |
| Friendly auth errors | 11, 13 | Mapper/component and Signup→Login E2E tests |
| Legacy bounded support | 10, 15 | Legacy route/function tests and rollout gate |
| Family code lacks adult authority | 3, 10, 12 | Function and Rules tests |
| Pending legacy request remains operable | 3, 10, 12 | Approval rules/function regression |
| Child flows unchanged | 3, 12, 13 | Child callable/rules and E2E regression |
| Mixed-version deploy/rollback safety | 15 | Verifier tests and operations runbook |

## Plan self-review result

- Every approved product decision and all 22 spec acceptance criteria map to at least one implementation task and behavior test.
- The 23 critical RED requirements are covered explicitly across Tasks 1–13, including zero family creation after Google auth, invite priority, token persistence, server-derived role, owner-forgery rejection, same/different-family behavior, deleting/revoked/expired/used states, raw-token absence, unified UI, legacy compatibility, family-code non-authority, child preservation, friendly errors, pending legacy approval, and stale-draft gating.
- Callable names and shared types are consistent throughout: `createAdultInvitation`, `previewAdultInvitation`, `acceptAdultInvitation`, and `revokeAdultInvitation`; `AdultRole` is exactly `parent | adult`.
- V2 immediate acceptance never enters the legacy pending approval path. Legacy six-character acceptance retains pending approval semantics only during compatibility.
- Deployment is additive backend-first. Rollback keeps v2 acceptance available for already-issued links and never downgrades to family-code adult authority.
- Initial rollout requires no production-data migration.
