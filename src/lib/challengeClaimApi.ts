// ---------------------------------------------------------------------------
// Thin client wrapper around the trusted `claimFamilyChallenge` callable.
//
// The server is the single source of truth for the entire Family Challenge
// claim: parent authorization, family ownership, challenge active/target state,
// eligible children, and the exactly-once reward distribution. The client only
// supplies `familyId` + `challengeId` and never writes `rewardPoints` /
// `lifetimeXP` (those writes are server-only via the Admin SDK, which is why
// Firestore rules correctly reject them from the client).
// ---------------------------------------------------------------------------
import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

export interface ClaimFamilyChallengeInput {
  familyId: string
  challengeId: string
}

export interface ClaimFamilyChallengeResult {
  /** True when this invocation performed the close + award (false on a no-op retry). */
  claimed: boolean
  /** Child ids that received the reward in this invocation. */
  rewardedChildren: string[]
}

export async function claimFamilyChallenge(
  familyId: string,
  challengeId: string,
): Promise<ClaimFamilyChallengeResult> {
  const callable = httpsCallable<ClaimFamilyChallengeInput, ClaimFamilyChallengeResult>(
    functions,
    'claimFamilyChallenge',
  )
  const result = await callable({ familyId, challengeId })
  return result.data
}
