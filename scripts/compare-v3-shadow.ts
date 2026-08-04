/**
 * V3 Shadow comparison script.
 *
 * Scans all members, compares legacy state against V3 shadow projection,
 * and produces a classification report.
 *
 * Amendment 6 — comparison denominator:
 * Reports both:
 *   1. Member-state exact-match rate
 *   2. Changed-member/event exact-match rate
 *
 * Excludes only: insufficient_ledger_history, malformed_data
 * Reports excluded counts separately.
 */
import { getFirestore } from 'firebase-admin/firestore'
import { initializeApp, cert } from 'firebase-admin/app'
import { AdminV3EventRepository } from '../functions/src/gamificationV3/eventRepository'
import { AdminV3ProjectionRepository } from '../functions/src/gamificationV3/projectionRepository'
import { compareMember, type ComparisonReport } from '../functions/src/gamificationV3/comparison'
import { DEFAULT_WEEKLY_CONTEXT } from '../src/domain/gamification/v3/weeklyWindow'

interface ComparisonSummary {
  readonly totalMembers: number
  readonly comparableMembers: number
  readonly exactMatch: number
  readonly rewardPointsMismatch: number
  readonly xpMismatch: number
  readonly weeklyPointsMismatch: number
  readonly streakMismatch: number
  readonly insufficientHistory: number
  readonly malformedData: number
  readonly exactMatchRate: string
  readonly comparableExactMatchRate: string
  readonly reports: readonly ComparisonReport[]
}

async function main(): Promise<void> {
  if (process.env.FCM_SERVICE_ACCOUNT_PATH) {
    initializeApp({ credential: cert(process.env.FCM_SERVICE_ACCOUNT_PATH) })
  } else {
    initializeApp()
  }
  const db = getFirestore()

  const eventRepo = new AdminV3EventRepository(db)
  const projectionRepo = new AdminV3ProjectionRepository(db)
  const deps = { eventRepo, projectionRepo, db }
  const context = { weekly: DEFAULT_WEEKLY_CONTEXT, asOf: new Date().toISOString() }

  const families = await db.collection('families').get()
  const reports: ComparisonReport[] = []

  for (const familyDoc of families.docs) {
    const familyId = familyDoc.id
    const members = await db.collection('users')
      .where('familyId', '==', familyId)
      .where('role', '==', 'child')
      .get()

    for (const memberDoc of members.docs) {
      const report = await compareMember(deps, familyId, memberDoc.id, context)
      reports.push(report)
    }
  }

  const total = reports.length
  const exact = reports.filter(r => r.classification === 'exact_match').length
  const insufficient = reports.filter(r => r.classification === 'insufficient_ledger_history').length
  const malformed = reports.filter(r => r.classification === 'malformed_data').length
  const comparable = total - insufficient - malformed
  const mismatches = reports.filter(r =>
    r.classification !== 'exact_match' &&
    r.classification !== 'insufficient_ledger_history' &&
    r.classification !== 'malformed_data',
  )

  const summary: ComparisonSummary = {
    totalMembers: total,
    comparableMembers: comparable,
    exactMatch: exact,
    rewardPointsMismatch: mismatches.filter(r => r.classification === 'reward_points_mismatch').length,
    xpMismatch: mismatches.filter(r => r.classification === 'xp_mismatch').length,
    weeklyPointsMismatch: mismatches.filter(r => r.classification === 'weekly_points_mismatch').length,
    streakMismatch: mismatches.filter(r => r.classification === 'streak_mismatch').length,
    insufficientHistory: insufficient,
    malformedData: malformed,
    exactMatchRate: total > 0 ? `${((exact / total) * 100).toFixed(2)}%` : 'N/A',
    comparableExactMatchRate: comparable > 0 ? `${((exact / comparable) * 100).toFixed(2)}%` : 'N/A',
    reports,
  }

  console.log(JSON.stringify(summary, null, 2))
}

main().catch(console.error)