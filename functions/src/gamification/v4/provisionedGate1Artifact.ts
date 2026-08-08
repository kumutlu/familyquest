import { defineString } from 'firebase-functions/params'

import type { Gate1Artifact } from './stage7EvidenceProvider'

/**
 * Supported Firebase Functions parameter for the deployed Gate-1 evidence.
 * Firebase CLI provisions this from `functions/.env.<projectId>` (or its
 * interactive parameter prompt) and exposes it to the deployed Gen-2 runtime.
 */
export const STAGE7_GATE1_ARTIFACT = defineString('STAGE7_GATE1_ARTIFACT', {
  description: 'Approved non-secret Stage 7 Gate-1 evidence JSON; required before V4 writer activation',
})

export interface Gate1ArtifactParameter {
  value(): string | undefined
}

/** Parse only JSON objects. Shape/hash/family/freshness validation is performed by the evidence provider. */
export function parseProvisionedGate1Artifact(raw: unknown): Gate1Artifact | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Gate1Artifact
      : null
  } catch (error) {
    console.error('[stage7-evidence] STAGE7_GATE1_ARTIFACT is not valid JSON; failing closed', error)
    return null
  }
}

/** Runtime loading path used by the deployed function entrypoint. */
export function loadProvisionedGate1Artifact(
  parameter: Gate1ArtifactParameter = STAGE7_GATE1_ARTIFACT,
): Gate1Artifact | null {
  return parseProvisionedGate1Artifact(parameter.value())
}
