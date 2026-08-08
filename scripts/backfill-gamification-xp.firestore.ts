/**
 * Firestore adapter + CLI entry point for the historical gamification XP
 * backfill. All decision logic lives in `./backfill-gamification-xp` (pure and
 * unit-tested); this file only maps Firestore documents onto that port.
 *
 * Usage:
 *   tsx scripts/backfill-gamification-xp.firestore.ts                # dry-run, all families
 *   tsx scripts/backfill-gamification-xp.firestore.ts --family=abc   # dry-run, one family
 *   tsx scripts/backfill-gamification-xp.firestore.ts --execute      # writes
 *
 * Paging: `--limit=N --start-after=<familyId>` (families are processed in
 * sorted id order, so a run is resumable and deterministic).
 */

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore'
import {
  formatReport,
  parseArgs,
  runBackfill,
  type BackfillStore,
  type BehaviourEventRecord,
  type CompletionRecord,
  type FamilyRecord,
  type GamificationEventRecord,
  type MemberRecord,
  type SummaryRecord,
} from './backfill-gamification-xp'

function millis(value: unknown): number | undefined {
  if (value !== null && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as Timestamp).toMillis()
  }
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

export function createFirestoreStore(db: Firestore): BackfillStore {
  const family = (familyId: string) => db.collection('families').doc(familyId)

  return {
    async listFamilies(): Promise<readonly FamilyRecord[]> {
      const snapshot = await db.collection('families').get()
      return snapshot.docs.map(document => {
        const migration = document.data().gamificationMigration as DocumentData | undefined
        return {
          id: document.id,
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
            familyId,
            displayName: typeof data.displayName === 'string' ? data.displayName : document.id,
            role: typeof data.role === 'string' ? data.role : 'unknown',
            lifetimeXP: number(data.lifetimeXP),
            rewardPoints: number(data.rewardPoints),
          }
        })
        .filter(member => member.role === 'child')
    },

    async getSummary(familyId: string, memberId: string): Promise<SummaryRecord | undefined> {
      const document = await family(familyId).collection('gamification_summaries').doc(memberId).get()
      if (!document.exists) return undefined
      const data = document.data()!
      const marker = data.backfill as DocumentData | undefined
      return {
        xpTotal: number(data.xpTotal) ?? 0,
        level: number(data.level) ?? 1,
        projectionStatus: typeof data.projectionStatus === 'string' ? data.projectionStatus : 'rebuilding',
        rebuildRequired: data.rebuildRequired === true,
        currentStreak: number(data.currentStreak) ?? 0,
        bestStreak: number(data.bestStreak) ?? 0,
        backfill: marker === undefined ? undefined : {
          version: number(marker.version) ?? 0,
          source: typeof marker.source === 'string' ? marker.source : '',
          reconstructedXp: number(marker.reconstructedXp) ?? -1,
          appliedAtMillis: millis(marker.appliedAt) ?? 0,
        },
      }
    },

    async listApprovedCompletions(familyId: string, memberId: string): Promise<readonly CompletionRecord[]> {
      const snapshot = await family(familyId).collection('task_completions')
        .where('assigneeId', '==', memberId)
        .where('status', '==', 'approved')
        .get()
      return snapshot.docs.map(document => {
        const data = document.data()
        const snapshotEffect = data.gamificationEffectSnapshot as DocumentData | undefined
        return {
          id: document.id,
          assigneeId: memberId,
          status: 'approved',
          approvedAtMillis: millis(data.approvedAt),
          awardedPoints: number(data.awardedPoints),
          snapshotRewardPoints: number(snapshotEffect?.rewardPointsAward) ?? number(data.pointsRewardSnapshot),
          revoked: data.gamificationRewardRevokedBy !== undefined || data.reversedBy !== undefined,
        }
      })
    },

    async listBehaviourEvents(familyId: string, memberId: string): Promise<readonly BehaviourEventRecord[]> {
      const snapshot = await family(familyId).collection('behaviour_events')
        .where('userId', '==', memberId)
        .get()
      return snapshot.docs.map(document => {
        const data = document.data()
        return {
          id: document.id,
          userId: memberId,
          pointsDelta: number(data.pointsDelta) ?? Number.NaN,
          timestampMillis: millis(data.timestamp) ?? millis(data.createdAt),
          revoked: data.reversedBy !== undefined || data.revokedBy !== undefined,
        }
      })
    },

    async listGamificationEvents(familyId: string, memberId: string): Promise<readonly GamificationEventRecord[]> {
      const snapshot = await family(familyId).collection('gamification_events')
        .where('childId', '==', memberId)
        .get()
      return snapshot.docs.map(document => {
        const data = document.data()
        return {
          id: document.id,
          childId: memberId,
          eventType: typeof data.eventType === 'string' ? data.eventType : 'unknown',
          xpDelta: number(data.xpDelta) ?? 0,
        }
      })
    },

    async writeSummaryXp(familyId, memberId, write): Promise<void> {
      const summaryRef = family(familyId).collection('gamification_summaries').doc(memberId)
      await db.runTransaction(async transaction => {
        const current = await transaction.get(summaryRef)
        if (!current.exists) throw new Error(`Summary vanished for ${familyId}/${memberId}`)
        const data = current.data()!
        // Re-assert the eligibility invariants inside the transaction so a
        // concurrent award can never be overwritten.
        if (data.projectionStatus !== 'ready' || data.rebuildRequired === true) {
          throw new Error(`Summary no longer ready for ${familyId}/${memberId}`)
        }
        if (number(data.xpTotal) !== 0) throw new Error(`Summary XP changed for ${familyId}/${memberId}`)
        // Only XP-derived fields are written. rewardPoints lives on users/{id}
        // and is never touched; streaks are preserved as-is.
        transaction.update(summaryRef, {
          xpTotal: write.xpTotal,
          level: write.level,
          backfill: {
            version: write.backfill.version,
            source: write.backfill.source,
            reconstructedXp: write.backfill.reconstructedXp,
            appliedAt: Timestamp.fromMillis(write.backfill.appliedAtMillis),
          },
          updatedAt: Timestamp.fromMillis(write.backfill.appliedAtMillis),
        })
      })
    },
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), Date.now())
  const app = getApps()[0] ?? initializeApp({ credential: applicationDefault() })
  const result = await runBackfill(createFirestoreStore(getFirestore(app)), args)
  console.log(formatReport(result))
}

if (process.argv[1]?.endsWith('backfill-gamification-xp.firestore.ts')) {
  main().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
