/**
 * Family Challenge claim — trusted server path.
 *
 * This is the SINGLE authoritative entry point for claiming a Family Challenge.
 * The client `claimChallenge` (src/lib/api.ts) only invokes this callable; it
 * never writes `rewardPoints` / `lifetimeXP` itself (Firestore rules correctly
 * reject those client writes, which is what broke the production Claim button).
 *
 * Server-side guarantees (all verified here, never trusting client input):
 *   - requester is an authenticated parent/owner of the family
 *   - the challenge belongs to that family (path-scoped read)
 *   - the challenge is still active
 *   - the challenge target has actually been reached (server-computed family XP)
 *   - eligible children are computed server-side (never from client childIds)
 *   - the reward is distributed exactly once per child (deterministic event id)
 *   - the claim is idempotent (challenge re-checked inside the close transaction)
 *   - the challenge is closed (completed/claimed state)
 *   - a `challenge_completed` notification is created for each rewarded child
 *
 * Reward distribution reuses the EXISTING authoritative gamification/write
 * mechanism: `AdminBehaviourRepository.processChallengeClaim`, which applies the
 * same `planBehaviourAward` pipeline used by behaviour events. No parallel
 * reward engine is introduced.
 */
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'
import { getFirestore, FieldValue, type Firestore } from 'firebase-admin/firestore'
import { AdminBehaviourRepository } from './behaviourRepository'

export interface ClaimChallengeInput {
  familyId: string
  challengeId: string
}

export interface ClaimChallengeResult {
  /** True when THIS invocation performed the close + award (false on a no-op retry). */
  claimed: boolean
  /** Child ids that received the reward in THIS invocation. */
  rewardedChildren: string[]
}

export interface ClaimChallengeDeps {
  readonly db: Firestore
  readonly behaviourRepository: AdminBehaviourRepository
}

function integer(value: unknown, fallback = 0): number {
  return Number.isSafeInteger(value) ? (value as number) : fallback
}

/**
 * Pure-ish core of the claim. Extracted from the `onCall` wrapper so it can be
 * unit-tested without the Functions runtime. Throws `HttpsError` for any
 * authorization / precondition failure so the wrapper can pass it straight
 * through to the client.
 */
export async function processChallengeClaimRequest(
  deps: ClaimChallengeDeps,
  authUid: string,
  input: ClaimChallengeInput,
): Promise<ClaimChallengeResult> {
  const { db, behaviourRepository } = deps

  // 1. Authorize the caller. The caller's own family membership and role are
  //    read from the server's records — never from anything the client sent.
  const callerSnap = await db.doc(`users/${authUid}`).get()
  if (!callerSnap.exists) {
    throw new HttpsError('permission-denied', 'Caller is not a known user.')
  }
  const caller = callerSnap.data() as { familyId?: string; role?: string }
  if (caller.familyId !== input.familyId) {
    // Wrong-family parent: the challenge path is family-scoped, so this also
    // means the challenge document will not be found, but we fail fast here.
    throw new HttpsError('permission-denied', 'Caller is not a member of the requested family.')
  }
  if (caller.role !== 'parent' && caller.role !== 'owner') {
    throw new HttpsError('permission-denied', 'Only a parent or owner can claim a family challenge.')
  }

  // 2. Load the challenge. Reading `families/{familyId}/challenges/{challengeId}`
  //    means a challenge can only ever be claimed within its own family — family
  //    ownership is enforced by the document path, not by client-supplied data.
  const challengeRef = db.doc(`families/${input.familyId}/challenges/${input.challengeId}`)
  const challengeSnap = await challengeRef.get()
  if (!challengeSnap.exists) {
    throw new HttpsError('not-found', 'Challenge not found.')
  }
  const challenge = challengeSnap.data() as {
    isActive?: boolean
    targetXP?: number
    startXP?: number
    rewardPoints?: number
    title?: string
  }

  // 3. Idempotency at the challenge level: if it is already closed, this is a
  //    harmless no-op retry. The close transaction below re-checks as well.
  if (!challenge.isActive) {
    return { claimed: false, rewardedChildren: [] }
  }

  // 4. Compute eligible children SERVER-SIDE. Never trust client childIds.
  const childrenSnap = await db
    .collection('users')
    .where('familyId', '==', input.familyId)
    .where('role', '==', 'child')
    .get()
  const eligible = childrenSnap.docs.filter((d) => {
    const c = d.data() as { status?: string; disabled?: boolean }
    return c.status !== 'deleted' && c.status !== 'disabled' && !c.disabled
  })

  // 5. Verify the target has actually been reached, using the SAME family-XP
  //    definition the client uses to show the Claim button. The authoritative XP
  //    source is `gamification_summaries.xpTotal` — `users.lifetimeXP` is only a
  //    compatibility mirror and must never be treated as authoritative (see
  //    behaviourRepository). We read the family's summaries once and sum the
  //    authoritative xpTotal per eligible child. This is server-computed; the
  //    client cannot fake completion.
  const summarySnap = await db
    .collection(`families/${input.familyId}/gamification_summaries`)
    .get()
  const xpByChild = new Map<string, number>()
  for (const d of summarySnap.docs) {
    xpByChild.set(d.id, integer((d.data() as { xpTotal?: number }).xpTotal))
  }
  const totalFamilyXP = eligible.reduce((acc, d) => {
    const summaryXp = xpByChild.get(d.id)
    // Fall back to the lifetimeXP mirror only if a summary is missing, so a
    // transient gap can never make the server over-reject a legitimately
    // completed challenge.
    return acc + (typeof summaryXp === 'number' ? summaryXp : integer((d.data() as { lifetimeXP?: number }).lifetimeXP))
  }, 0)
  const earnedSinceStart = Math.max(0, totalFamilyXP - integer(challenge.startXP))
  if (earnedSinceStart < integer(challenge.targetXP)) {
    throw new HttpsError('failed-precondition', 'Challenge target has not been reached yet.')
  }

  const rewardPoints = integer(challenge.rewardPoints)
  const processingAt = Date.now()
  const title = typeof challenge.title === 'string' ? challenge.title : 'Family Challenge'

  // 6. Distribute the reward exactly once per eligible child. Each child's award
  //    is idempotent via a deterministic event id inside processChallengeClaim.
  const rewardedChildren: string[] = []
  const unconfirmedChildren: string[] = []
  for (const childDoc of eligible) {
    const res = await behaviourRepository.processChallengeClaim({
      familyId: input.familyId,
      childId: childDoc.id,
      challengeId: input.challengeId,
      points: rewardPoints,
      processingAt,
    })
    if (res.status === 'processed' || res.status === 'duplicate') rewardedChildren.push(childDoc.id)
    else unconfirmedChildren.push(childDoc.id)
  }
  if (unconfirmedChildren.length > 0 || rewardedChildren.length !== eligible.length) {
    throw new HttpsError(
      'failed-precondition',
      'Challenge rewards are not yet confirmed for every eligible child; retry is safe.',
    )
  }

  // 7. Close the challenge + write the celebration notification + feed entry.
  //    Re-checks isActive inside the transaction so a concurrent claim (or a
  //    retried call) can never double-close or double-notify.
  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(challengeRef)
    const data = current.data() as { isActive?: boolean } | undefined
    if (!data || !data.isActive) return // already closed by a concurrent claim

    transaction.update(challengeRef, {
      isActive: false,
      completedAt: FieldValue.serverTimestamp(),
      claimedBy: authUid,
      claimedAt: FieldValue.serverTimestamp(),
    })

    // Deterministic id => a retried claim can never create a second marker.
    const notifId = `challenge_completed_${input.challengeId}`
    transaction.set(db.doc(`families/${input.familyId}/notifications/${notifId}`), {
      familyId: input.familyId,
      type: 'challenge_completed',
      actorId: authUid,
      recipientIds: rewardedChildren,
      title: 'Challenge complete!',
      body: `You earned +${rewardPoints} points`,
      entityType: 'challenge',
      entityId: input.challengeId,
      actionUrl: '/family',
      dedupeKey: notifId,
      metadata: { challengeTitle: title, rewardPoints },
      createdAt: FieldValue.serverTimestamp(),
    })

    transaction.set(db.collection(`families/${input.familyId}/feed`).doc(), {
      actorId: authUid,
      text: `Family Challenge Completed: ${title}! Everyone got +${rewardPoints} pts!`,
      timestamp: FieldValue.serverTimestamp(),
    })
  })

  return { claimed: true, rewardedChildren }
}

const db = getFirestore()
const behaviourRepository = new AdminBehaviourRepository(db)

/**
 * Trusted callable. The client only supplies `familyId` + `challengeId`; every
 * other fact (eligible children, reward amount, completion state, family
 * ownership) is derived server-side.
 */
export const claimFamilyChallenge = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  async (request: CallableRequest<ClaimChallengeInput>): Promise<ClaimChallengeResult> => {
    const authUid = request.auth?.uid
    if (!authUid) {
      throw new HttpsError('unauthenticated', 'Authentication required.')
    }
    const input = request.data ?? {}
    if (typeof input.familyId !== 'string' || typeof input.challengeId !== 'string') {
      throw new HttpsError('invalid-argument', 'familyId and challengeId are required.')
    }
    return processChallengeClaimRequest({ db, behaviourRepository }, authUid, input)
  },
)
