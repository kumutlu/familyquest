#!/usr/bin/env node

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { pathToFileURL } from 'node:url'
import { GAMIFICATION_CONFIG_V1 } from '../src/domain/gamification/config'
import { levelProgressForXp } from '../src/domain/gamification/level'
import { normalizeXpLedger, type RawXpDocument } from '../src/domain/gamification/rebuildNormalization'

export interface DryRunChildReport {
  readonly childId: string
  readonly currentXp: number
  readonly canonicalXp: number
  readonly delta: number
  readonly eventCount: number
  readonly legacyNormalized: number
  readonly unknownEvents: 0
  readonly duplicateRewardApplications: number
  readonly level: number
  readonly xpToNextLevel: number
}

export function buildDryRunChildReport(input: {
  readonly familyId: string
  readonly childId: string
  readonly currentXp: number
  readonly processingAt: number
  readonly events: readonly RawXpDocument[]
}): DryRunChildReport {
  const normalized = normalizeXpLedger({ familyId: input.familyId, documents: input.events })
  const canonicalXp = normalized.reduce((sum, document) => sum + document.event.xpDelta, 0)
  if (!Number.isSafeInteger(canonicalXp) || canonicalXp < 0) throw new Error(`Invalid canonical XP for ${input.childId}`)
  const seen = new Set<string>()
  let duplicateRewardApplications = 0
  for (const document of normalized) {
    if (seen.has(document.event.idempotencyKey)) duplicateRewardApplications += 1
    seen.add(document.event.idempotencyKey)
  }
  const progress = levelProgressForXp(canonicalXp, GAMIFICATION_CONFIG_V1.xpPerLevel)
  return {
    childId: input.childId,
    currentXp: input.currentXp,
    canonicalXp,
    delta: canonicalXp - input.currentXp,
    eventCount: normalized.length,
    legacyNormalized: normalized.filter(document => document.normalization === 'legacy').length,
    unknownEvents: 0,
    duplicateRewardApplications,
    level: progress.level,
    xpToNextLevel: progress.xpToNextLevel,
  }
}

export async function dryRunProductionFamily(familyId: string, childIds: readonly string[]): Promise<readonly DryRunChildReport[]> {
  if (getApps().length === 0) initializeApp({ credential: applicationDefault(), projectId: 'familyquest-beta-402cb' })
  const db = getFirestore()
  const reports: DryRunChildReport[] = []
  for (const childId of childIds) {
    const [summary, events] = await Promise.all([
      db.doc(`families/${familyId}/gamification_summaries/${childId}`).get(),
      db.collection(`families/${familyId}/gamification_events`).where('childId', '==', childId).get(),
    ])
    if (!summary.exists) throw new Error(`Missing summary for ${childId}`)
    const currentXp = summary.data()?.xpTotal
    if (!Number.isSafeInteger(currentXp) || currentXp < 0) throw new Error(`Invalid current summary XP for ${childId}`)
    reports.push(buildDryRunChildReport({
      familyId,
      childId,
      currentXp,
      processingAt: Date.now(),
      events: events.docs.map(document => ({ id: document.id, data: document.data() })),
    }))
  }
  return reports
}

const FAMILY = '5s4Npeu55wPphLCsGAMP'
const CHILDREN = [
  'NuyIJDP9fDNP2LiKynlsEyzur5N2',
  'T7ZsdaN8ixUOnzRAX9jNQqUDZE13',
  'vc0iyHVfAcXnXQQbmFkr5HfJEkp2',
] as const

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  dryRunProductionFamily(FAMILY, CHILDREN)
    .then(reports => console.log(JSON.stringify({ mode: 'read-only', familyId: FAMILY, reports }, null, 2)))
    .catch(error => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
}
