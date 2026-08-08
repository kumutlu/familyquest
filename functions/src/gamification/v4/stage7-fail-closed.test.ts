/**
 * Gamification V4 — Gap 2: the deployed Task Approval chain REQUIRES
 * STAGE7_GATE1_ARTIFACT and FAILS CLOSED when it is absent or invalid.
 *
 * This mirrors the exact wiring in `functions/src/index.ts`:
 *   - `loadProvisionedGate1Artifact()` reads the Firebase Functions string
 *     parameter `STAGE7_GATE1_ARTIFACT` and returns `null` when unset or not
 *     valid JSON.
 *   - That value is passed as `loadGate1Artifact` to `createStage7EvidenceProvider`.
 *   - The provider THROWS `Stage7EvidenceInvalidError` when the artifact is
 *     `null` (or invalid/stale/mismatched), so the verifier refuses and ZERO
 *     V4 writers run. There is no fallback to the legacy writer once the v4
 *     route is resolved.
 *
 * The artifact is non-secret evidence JSON (report hash + approval metadata +
 * family classification) — never a service-account key — so provisioning it to
 * the runtime is safe and fail-closed when missing.
 */

import { describe, expect, it } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'

import {
  createStage7EvidenceProvider,
  TASK_7_1_WRITER,
  Stage7EvidenceInvalidError,
  hashGate1Report,
  type Gate1Artifact,
} from './stage7EvidenceProvider'
import {
  loadProvisionedGate1Artifact,
  parseProvisionedGate1Artifact,
} from './provisionedGate1Artifact'

function validArtifact(): Gate1Artifact {
  const report = {
    gate: 'GATE_1_REACHED',
    schemaVersion: 4,
    families: [{ familyId: 'fam-A', classification: 'exact' }],
  }
  return { report, reportHash: hashGate1Report(report), approvedAt: new Date().toISOString() }
}

describe('Gap 2 — deployed Gate 1 evidence is REQUIRED and fails closed', () => {
  it('throws Stage7EvidenceInvalidError when no artifact is provisioned (loadGate1Artifact => null)', async () => {
    const provider = createStage7EvidenceProvider({
      db: {} as Firestore,
      writer: TASK_7_1_WRITER,
      loadGate1Artifact: async () => null,
    })
    await expect(provider('fam-A')).rejects.toBeInstanceOf(Stage7EvidenceInvalidError)
  })

  it('deployed parameter absent => null => fail closed', async () => {
    const provider = createStage7EvidenceProvider({
      db: {} as Firestore,
      writer: TASK_7_1_WRITER,
      loadGate1Artifact: async () => loadProvisionedGate1Artifact({ value: () => undefined }),
    })
    await expect(provider('fam-A')).rejects.toBeInstanceOf(Stage7EvidenceInvalidError)
  })

  it('mirrors deployed wiring: valid provisioned artifact + marker => resolves (can read/validate)', async () => {
    const artifact = validArtifact()
    const provider = createStage7EvidenceProvider({
      db: {} as Firestore,
      writer: TASK_7_1_WRITER,
      loadGate1Artifact: async () => loadProvisionedGate1Artifact({
        value: () => JSON.stringify(artifact),
      }),
      readMarker: async () => ({
        familyId: 'fam-A',
        status: 'MIGRATED',
        walletHashOk: true,
        walletHashBefore: 'h',
        walletHashAfter: 'h',
        reportHash: artifact.reportHash,
      }) as never,
    })
    const evidence = await provider('fam-A')
    expect(evidence.familyId).toBe('fam-A')
    expect(evidence.writer).toBe(TASK_7_1_WRITER)
  })

  it('malformed deployed parameter => null => fail closed (no crash, no write)', async () => {
    const provider = createStage7EvidenceProvider({
      db: {} as Firestore,
      writer: TASK_7_1_WRITER,
      loadGate1Artifact: async () => loadProvisionedGate1Artifact({ value: () => '{not-json' }),
    })
    await expect(provider('fam-A')).rejects.toBeInstanceOf(Stage7EvidenceInvalidError)
  })

  it('well-formed but wrong evidence fails closed', async () => {
    const artifact = validArtifact()
    const wrong = { ...artifact, reportHash: 'wrong-hash' }
    const provider = createStage7EvidenceProvider({
      db: {} as Firestore,
      writer: TASK_7_1_WRITER,
      loadGate1Artifact: async () => parseProvisionedGate1Artifact(JSON.stringify(wrong)),
    })
    await expect(provider('fam-A')).rejects.toBeInstanceOf(Stage7EvidenceInvalidError)
  })
})
