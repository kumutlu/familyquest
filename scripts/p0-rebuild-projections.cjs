#!/usr/bin/env node
/**
 * P0 PROJECTION REBUILD DRIVER
 *
 * Drives the EXISTING canonical rebuild path
 * (AdminGamificationRepository.repairGamificationPage, exposed via
 * functions/src/gamificationRepair.ts) for every child member whose
 * gamification_summaries doc is still projectionStatus == 'rebuilding' or
 * rebuildRequired == true.
 *
 * SAFETY:
 *   - Defaults to dry-run. Requires --execute for writes.
 *   - No direct users.rewardPoints / gamification_summaries patches: the
 *     canonical repair transaction re-folds the authoritative streams.
 *   - The money wallet is never touched.
 *
 * Usage:
 *   node scripts/p0-rebuild-projections.cjs            # dry-run
 *   node scripts/p0-rebuild-projections.cjs --execute
 */
const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const svc = require('./../firebase-key.json')

const EXECUTE = process.argv.includes('--execute')
const FAMILY = (process.argv.find((a) => a.startsWith('--family=')) || '').split('=')[1] || null
const MAX_PAGES = 200

initializeApp({ credential: cert(svc), projectId: svc.project_id || 'familyquest-beta-402cb' })
const db = getFirestore()

const { AdminGamificationRepository } = require('./../functions/lib/functions/src/gamificationRepository')
const { repairGamificationPage } = require('./../functions/lib/functions/src/gamificationRepair')

async function main() {
  const repository = new AdminGamificationRepository(db)
  const families = FAMILY
    ? [await db.doc(`families/${FAMILY}`).get()]
    : (await db.collection('families').get()).docs

  const targets = []
  for (const family of families) {
    if (!family.exists) continue
    const summaries = await db.collection(`families/${family.id}/gamification_summaries`).get()
    for (const summary of summaries.docs) {
      const data = summary.data()
      if (data.rebuildRequired === true || data.projectionStatus !== 'ready') {
        targets.push({ familyId: family.id, childId: summary.id, status: data.projectionStatus, rebuildRequired: data.rebuildRequired === true })
      }
    }
  }

  console.log(`MODE: ${EXECUTE ? 'EXECUTE (production writes)' : 'DRY-RUN (no writes)'}`)
  console.log(`Rebuild targets: ${targets.length}`)

  const results = []
  for (const target of targets) {
    if (!EXECUTE) {
      results.push({ ...target, action: 'would_rebuild' })
      continue
    }
    let pages = 0
    let status = 'unknown'
    try {
      for (; pages < MAX_PAGES; pages += 1) {
        const page = await repairGamificationPage(
          { repository, now: () => Date.now() },
          { familyId: target.familyId, childId: target.childId },
        )
        status = page.status
        if (page.status !== 'checkpointed') break
      }
      const after = await db.doc(`families/${target.familyId}/gamification_summaries/${target.childId}`).get()
      const data = after.data() || {}
      results.push({ ...target, pages: pages + 1, status, afterStatus: data.projectionStatus, afterRebuildRequired: data.rebuildRequired === true, xpTotal: data.xpTotal, level: data.level })
    } catch (error) {
      results.push({ ...target, pages, status: 'error', error: error.message })
    }
  }

  console.log(JSON.stringify({ mode: EXECUTE ? 'EXECUTE' : 'DRY_RUN', totals: { targets: targets.length, errors: results.filter((r) => r.status === 'error').length }, results }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
