#!/usr/bin/env node
/**
 * P0 RECOVERY DRIVER — reprocess approved task completions missed during the
 * read-after-write bug window.
 *
 * SAFETY:
 *   - Defaults to --dry-run (NO writes). Requires explicit --execute to write.
 *   - Reuses the EXISTING deployed server processor `processApprovedCompletion`
 *     (functions/src/gamificationProcessor.ts, implemented by
 *     AdminGamificationRepository.processApprovedCompletion in
 *     functions/src/gamificationRepository.ts). It is idempotent: it checks the
 *     task_occurrences/{logicalKey} immutable reservation and returns `duplicate`
 *     (no re-award) if an effect already exists.
 *   - No direct users.rewardPoints / summary / shadow patches. The processor
 *     writes authoritative balance, summary, gamification_events, daily
 *     progress and the V3 shadow atomically, and sets
 *     gamificationProcessedAt + gamificationEffectSnapshot on the completion.
 *   - The money wallet is never touched by the processor.
 *
 * Targets are taken from the read-only scan output (scripts/p0-scan-unprocessed-
 * approvals.cjs): only completions where wouldAward === true AND no idempotent
 * effect already exists.
 *
 * Usage:
 *   node scripts/p0-recover-unprocessed-approvals.cjs                 # dry-run
 *   node scripts/p0-recover-unprocessed-approvals.cjs --execute       # real writes
 *   node scripts/p0-recover-unprocessed-approvals.cjs --targets=file.json
 */
const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const fs = require('fs')
const svc = require('./../firebase-key.json')

const EXECUTE = process.argv.includes('--execute')
const TARGETS_FILE = (process.argv.find((a) => a.startsWith('--targets=')) || '').split('=')[1] || '/tmp/p0-scan-output.json'

initializeApp({ credential: cert(svc), projectId: svc.project_id || 'familyquest-beta-402cb' })
const db = getFirestore()

// Reuse the EXACT deployed processor build.
const { AdminGamificationRepository } = require('./../functions/lib/functions/src/gamificationRepository')
const { processApprovedCompletion } = require('./../functions/lib/functions/src/gamificationProcessor')

async function main() {
  if (!fs.existsSync(TARGETS_FILE)) {
    console.error(`Targets file not found: ${TARGETS_FILE}. Run scripts/p0-scan-unprocessed-approvals.cjs first.`)
    process.exit(1)
  }
  const scan = JSON.parse(fs.readFileSync(TARGETS_FILE, 'utf8'))
  const targets = scan.completions.filter((c) => c.wouldAward && !c.idempotentEffectExists)

  console.log(`MODE: ${EXECUTE ? 'EXECUTE (production writes)' : 'DRY-RUN (no writes)'}`)
  console.log(`Targets: ${targets.length} completions, expected ${targets.reduce((s, c) => s + c.expectedAward, 0)} points`)

  const repository = new AdminGamificationRepository(db)
  const results = []

  for (const t of targets) {
    if (!EXECUTE) {
      results.push({ completionId: t.completionId, familyId: t.familyId, childId: t.assigneeId, expectedAward: t.expectedAward, action: 'would_process' })
      continue
    }
    try {
      const result = await processApprovedCompletion(
        { repository, now: () => Date.now() },
        { familyId: t.familyId, completionId: t.completionId },
      )
      results.push({ completionId: t.completionId, familyId: t.familyId, childId: t.assigneeId, expectedAward: t.expectedAward, status: result.status, logicalCompletionKey: result.logicalCompletionKey })
    } catch (error) {
      results.push({ completionId: t.completionId, familyId: t.familyId, childId: t.assigneeId, expectedAward: t.expectedAward, status: 'error', error: error.message })
    }
  }

  const processed = results.filter((r) => r.status === 'processed').length
  const duplicates = results.filter((r) => r.status === 'duplicate').length
  const errors = results.filter((r) => r.status === 'error').length
  console.log(JSON.stringify({ mode: EXECUTE ? 'EXECUTE' : 'DRY_RUN', totals: { targets: targets.length, processed, duplicates, errors }, results }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
