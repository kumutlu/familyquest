/**
 * Firestore adapter + CLI for the legacy XP baseline migration.
 *
 * All decision logic lives in `./legacy-xp-baseline` (pure, unit-tested).
 * This file only maps Firestore documents onto that port.
 *
 * Usage:
 *   tsx scripts/legacy-xp-baseline.firestore.ts                 # dry-run, all families
 *   tsx scripts/legacy-xp-baseline.firestore.ts --family=abc    # dry-run, one family
 *   tsx scripts/legacy-xp-baseline.firestore.ts --execute       # writes (requires approval)
 *
 * Never writes `users/{id}.rewardPoints`: the users collection is only read.
 */

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore'
import {
  formatBaselineReport,
  legacyBaselineEventId,
  parseBaselineArgs,
  runBaselineMigration,
  LEGACY_BASELINE_SOURCE,
  LEGACY_BASELINE_VERSION,
  type BaselineAuditMarker,
  type BaselineStore,
  type FamilyRecord,
  type MemberActivity,
  type MemberRecord,
  type SummaryRecord,
} from './legacy-xp-baseline'
import type { GamificationMigrationStatus } from '../src/domain/gamification/migrationState'

/** Immutable audit collection; one document per baselined member. */
const AUDIT_COLLECTION = 'gamification_migration_audit'

function millis(value: unknown): number | undefined {
  if (value !== null && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as Timestamp).toMillis()
  }
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

export function createFirestoreBaselineStore(db: Firestore): BaselineStore {
  const family = (familyId: string) => db.collection('families').doc(familyId)
  const auditId = (familyId: string, memberId: string) => `${familyId}_${memberId}_v${LEGACY_BASELINE_VERSION}`

  return {
    async listFamilies(): Promise<readonly FamilyRecord[]> {
      const snapshot = await db.collection('families').get()
      return snapshot.docs.map(document => {
        const migration = document.data().gamificationMigration as DocumentData | undefined
        return {
          id: document.id,
          hasMigrationMetadata: migration !== undefined && migration !== null,
          migrationStatus: typeof migration?.status === 'string' ? migration.status : undefined,
          cutoverAtMillis: millis(migration?.cutoverAt),
        }
      })
    },

    async listChildren(familyId: string): Promise<readonly MemberRecord[]> {
      const snapshot = await db.collection('users').where('familyId', '==', familyId).get()
      return snapshot.docs
        .map(document => {
          const data = document.data()
          return {
            id: document.id,
            familyId: typeof data.familyId === 'string' ? data.familyId : '',
            displayName: typeof data.displayName === 'string' ? data.displayName : document.id,
            role: typeof data.role === 'string' ? data.role : 'unknown',
            // Raw: validation is the pure module's responsibility.
            lifetimeXP: data.lifetimeXP,
            rewardPoints: integer(data.rewardPoints),
          }
        })
        .filter(m => m.role === 'child')
    },

    async getSummary(familyId: string, memberId: string): Promise<SummaryRecord | undefined> {
      const document = await family(familyId).collection('gamification_summaries').doc(memberId).get()
      if (!document.exists) return undefined
      const data = document.data()!
      return {
        xpTotal: integer(data.xpTotal) ?? Number.NaN,
        projectionStatus: typeof data.projectionStatus === 'string' ? data.projectionStatus : 'rebuilding',
        rebuildRequired: data.rebuildRequired === true,
        currentStreak: integer(data.currentStreak) ?? 0,
        bestStreak: integer(data.bestStreak) ?? 0,
      }
    },

    async getActivity(familyRecord: FamilyRecord, memberId: string): Promise<MemberActivity> {
      try {
        const root = family(familyRecord.id)
        // Single-field equality queries only: no composite index is required,
        // so a missing index can never masquerade as "no activity".
        const [events, occurrences, completions, baselineEvent] = await Promise.all([
          root.collection('gamification_events').where('childId', '==', memberId).get(),
          root.collection('task_occurrences').where('assigneeId', '==', memberId).get(),
          root.collection('task_completions').where('assigneeId', '==', memberId).get(),
          root.collection('gamification_events').doc(legacyBaselineEventId(familyRecord.id, memberId)).get(),
        ])

        // Decision 1: only a non-zero xpDelta proves authoritative XP exists.
        // `daily_goal_qualification_changed` / `perfect_day_qualification_changed`
        // carry xpDelta === 0 and are informational transitions.
        const xpBearing = events.docs.filter(document => {
          const delta = document.data().xpDelta
          return typeof delta === 'number' && delta !== 0
        })

        const cutover = familyRecord.cutoverAtMillis
        // Only completions the processor has already turned into authoritative
        // XP (or whose safety cannot be proven) block a baseline.
        const postCutoverAwards = cutover === undefined
          ? 0
          : completions.docs.filter(document => {
            const data = document.data()
            if (data.status !== 'approved') return false
            const approvedAt = millis(data.approvedAt)
            if (approvedAt !== undefined && approvedAt < cutover) return false
            // Unusable timestamp => cannot be proven safe.
            if (approvedAt === undefined) return true
            return data.gamificationProcessedAt !== undefined
          }).length

        const reversalEvidence = events.docs.some(document => {
          const data = document.data()
          return data.eventType === 'reversal'
            || (typeof data.xpDelta === 'number' && data.xpDelta < 0)
        }) || completions.docs.some(document => {
          const data = document.data()
          return data.gamificationRewardRevokedBy !== undefined || data.reversedBy !== undefined
        })

        return {
          gamificationEventCount: events.size,
          nonZeroXpEventCount: xpBearing.length,
          zeroXpEventCount: events.size - xpBearing.length,
          taskOccurrenceCount: occurrences.size,
          postCutoverAwardCount: postCutoverAwards,
          reversalEvidence,
          baselineEventPresent: baselineEvent.exists,
          // A missing cutover makes post-cutover awards undecidable.
          indeterminate: familyRecord.cutoverAtMillis === undefined ? 'missing_cutoverAt' : undefined,
        }
      } catch (error) {
        return {
          gamificationEventCount: 0,
          nonZeroXpEventCount: 0,
          zeroXpEventCount: 0,
          taskOccurrenceCount: 0,
          postCutoverAwardCount: 0,
          reversalEvidence: false,
          indeterminate: `activity_query_failed:${(error as Error).message}`,
        }
      }
    },

    async getAuditMarker(familyId: string, memberId: string): Promise<BaselineAuditMarker | undefined> {
      const document = await db.collection(AUDIT_COLLECTION).doc(auditId(familyId, memberId)).get()
      if (!document.exists) return undefined
      const data = document.data()!
      return {
        familyId,
        memberId,
        baselineXp: integer(data.baselineXp) ?? -1,
        source: LEGACY_BASELINE_SOURCE,
        cutoverAtMillis: millis(data.cutoverAt) ?? 0,
        migratedAtMillis: millis(data.migratedAt) ?? 0,
        scriptVersion: integer(data.scriptVersion) ?? 0,
        priorSummaryXpTotal: integer(data.priorSummaryXpTotal) ?? 0,
      }
    },

    async applyBaseline(familyId, memberId, write): Promise<'written' | 'noop'> {
      const summaryRef = family(familyId).collection('gamification_summaries').doc(memberId)
      const auditRef = db.collection(AUDIT_COLLECTION).doc(auditId(familyId, memberId))
      const eventRef = family(familyId).collection('gamification_events').doc(write.event.id)

      return db.runTransaction(async transaction => {
        const [current, audit, event] = await Promise.all([
          transaction.get(summaryRef),
          transaction.get(auditRef),
          transaction.get(eventRef),
        ])
        // Strict no-op on re-execution: matching event + marker.
        if (audit.exists && event.exists) {
          if (integer(audit.data()!.baselineXp) !== write.event.xpDelta
            || integer(event.data()!.xpDelta) !== write.event.xpDelta) {
            throw new Error(`Conflicting legacy baseline for ${familyId}/${memberId}: refusing to write`)
          }
          return 'noop' as const
        }
        // A half-written pair is unsafe: stop and report rather than guess.
        if (audit.exists !== event.exists) {
          throw new Error(`Inconsistent legacy baseline state for ${familyId}/${memberId}: refusing to write`)
        }
        if (!current.exists) return 'noop' as const

        const data = current.data()!
        // Re-assert eligibility inside the transaction so a concurrent award
        // can never be overwritten.
        if (data.projectionStatus !== 'ready' || data.rebuildRequired === true) return 'noop' as const
        if (integer(data.xpTotal) !== 0) return 'noop' as const

        // Only XP-derived projection fields are written. Streaks, perfect-day
        // and every unrelated field are preserved by using a merge update.
        transaction.update(summaryRef, {
          xpTotal: write.projection.xpTotal,
          level: write.projection.level,
          xpProgressInLevel: write.projection.xpProgressInLevel,
          xpToNextLevel: write.projection.xpToNextLevel,
          levelProgressPercentage: write.projection.percentage,
          updatedAt: Timestamp.fromMillis(write.marker.migratedAtMillis),
        })
        // Immutable ledger entry: the projection total is explained by events,
        // never by a hidden summary-only offset. No rewardPoints, occurrence,
        // feed, notification, achievement or streak effect is produced.
        transaction.create(eventRef, {
          schemaVersion: write.event.schemaVersion,
          familyId: write.event.familyId,
          childId: write.event.childId,
          memberId: write.event.childId,
          eventType: write.event.eventType,
          xpDelta: write.event.xpDelta,
          sourceType: write.event.sourceType,
          sourceId: write.event.sourceId,
          source: write.event.source,
          idempotencyKey: write.event.idempotencyKey,
          causalGroupId: write.event.causalGroupId,
          transitionRank: write.event.transitionRank,
          effectiveAt: Timestamp.fromMillis(write.event.effectiveAt),
          cutoverAt: Timestamp.fromMillis(write.event.cutoverAtMillis),
          createdAt: Timestamp.fromMillis(write.event.createdAtMillis),
          migratedAt: Timestamp.fromMillis(write.event.migratedAtMillis),
          configSchemaVersion: write.event.configSchemaVersion,
          createdBy: write.event.createdBy,
          scriptVersion: write.event.scriptVersion,
          priorSummaryXpTotal: write.event.priorSummaryXpTotal,
          rewardPointsDelta: write.event.rewardPointsDelta,
        })
        transaction.create(auditRef, {
          familyId: write.marker.familyId,
          memberId: write.marker.memberId,
          baselineXp: write.marker.baselineXp,
          source: write.marker.source,
          cutoverAt: Timestamp.fromMillis(write.marker.cutoverAtMillis),
          migratedAt: Timestamp.fromMillis(write.marker.migratedAtMillis),
          scriptVersion: write.marker.scriptVersion,
          priorSummaryXpTotal: write.marker.priorSummaryXpTotal,
        })
        return 'written' as const
      })
    },

    async setMigrationStatus(familyId: string, status: GamificationMigrationStatus): Promise<void> {
      await family(familyId).update({
        'gamificationMigration.status': status,
        'gamificationMigration.baselineCompletedAt': Timestamp.now(),
      })
    },
  }
}

async function main(): Promise<void> {
  const args = parseBaselineArgs(process.argv.slice(2), Date.now())
  const app = getApps()[0] ?? initializeApp({ credential: applicationDefault() })
  const result = await runBaselineMigration(createFirestoreBaselineStore(getFirestore(app)), args)
  console.log(formatBaselineReport(result))
}

if (process.argv[1]?.endsWith('legacy-xp-baseline.firestore.ts')) {
  main().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
