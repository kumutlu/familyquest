/**
 * End-to-end regression for the "new families never earn points" bug.
 *
 * The onboarding path is exercised through the REAL client API in
 * `src/lib/api.ts` (the same code the app ships), against the Auth + Firestore
 * emulators:
 *
 *   create account -> create family -> create task -> approve completion
 *     -> gamification processor -> rewardPoints / lifetimeXP / summary
 *
 * Only two things are seeded with the Admin SDK rather than driven through the
 * UI flow: the child profile (joining a family is a custom-token Cloud Function
 * flow that is out of scope here) and the child's `pending_approval` completion
 * document. Everything on the parent side — signup, family creation, task
 * creation and approval — is the production client code path, which is where
 * the bug lived.
 *
 * Before the fix this test fails: `createFamilyAndParent` wrote no
 * `gamificationMigration`, so the processor returned `ignored` and points never
 * moved.
 */
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { connectAuthEmulator } from 'firebase/auth'
import { connectFirestoreEmulator } from 'firebase/firestore'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { processApprovedCompletion } from '../../functions/src/gamificationProcessor'
import { AdminGamificationRepository } from '../../functions/src/gamificationRepository'
import { ensureFamilyGamificationInitialized } from '../../functions/src/familyGamificationInit'
import { GAMIFICATION_READY_STATUSES } from '../../src/domain/gamification/migrationState'
import { repairGamificationMigrations } from '../../scripts/repair-gamification-migration'
import { auth, db as clientDb } from '../../src/lib/firebase'
import { approveTaskCompletion, createFamilyAndParent, createTask, signUp } from '../../src/lib/api'

// Must match the project the client SDK uses: the Firestore emulator keeps a
// separate namespace per project, so an Admin app on a different project id
// would silently read an empty database.
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID as string

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'

function admin() {
  const name = `onboarding-gamification-${PROJECT_ID}`
  const app = getApps().find(candidate => candidate.name === name)
    ?? initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID }, name)
  return getFirestore(app)
}

function repo() { return new AdminGamificationRepository(admin()) }

let connected = false
function connectClient() {
  if (connected) return
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(clientDb, '127.0.0.1', 8080)
  connected = true
}

/** Unique per run so repeated local runs never collide in the emulator. */
function unique(prefix: string) { return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}` }

/** Poll until `check` is true, or give up. Returns whether it converged. */
async function waitFor(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return true
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  return false
}

interface Onboarded {
  readonly familyId: string
  readonly childId: string
  readonly taskId: string
  readonly completionId: string
}

/** Drive the real onboarding flow and park a completion awaiting approval. */
async function onboardThroughRealFlow(): Promise<Onboarded> {
  const email = `${unique('parent')}@example.com`
  const parent = await signUp(email, 'password123', 'Test Parent')
  const { familyId } = await createFamilyAndParent(parent.uid, 'Test Parent', 'Test Family')

  // Child membership is established by a separate custom-token flow; seed the
  // resulting profile directly so this test stays focused on gamification.
  const childId = unique('child')
  await admin().doc(`users/${childId}`).set({
    uid: childId, familyId, role: 'child', status: 'active',
    displayName: 'Test Child', rewardPoints: 0, lifetimeXP: 0,
  })

  const taskRef = await createTask(familyId, {
    title: 'Tidy room',
    assigneeId: childId,
    pointsReward: 20,
    requiresApproval: true,
    type: 'daily',
  })

  // Product policy (`isTaskEligibleForDay`): a task only becomes eligible the
  // day AFTER it is created. Backdate creation by a day so the completion below
  // lands on an eligible day — this mirrors the normal case of a task set up
  // yesterday and done today, and keeps `completedAt` honest at "now".
  await admin().doc(`families/${familyId}/tasks/${taskRef.id}`).update({
    createdAt: Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000),
  })

  const completionId = unique('completion')
  await admin().doc(`families/${familyId}/task_completions/${completionId}`).set({
    taskId: taskRef.id,
    assigneeId: childId,
    status: 'pending_approval',
    completedAt: Timestamp.now(),
  })

  return { familyId, childId, taskId: taskRef.id, completionId }
}

beforeAll(() => { connectClient() })
afterAll(async () => { await auth.signOut().catch(() => undefined) })

describe('real onboarding flow is gamification-ready end to end (emulator)', () => {
  it('awards rewardPoints, lifetimeXP and a summary for a family created today', async () => {
    const { familyId, childId, completionId } = await onboardThroughRealFlow()

    // Approval via the real client API — the write the Cloud Function reacts to.
    await approveTaskCompletion(familyId, completionId)

    // When the Functions emulator is running, `onTaskCompletionWritten` picks
    // this up on its own; give it a chance to converge before stepping in.
    const processedByTrigger = await waitFor(async () => {
      const child = (await admin().doc(`users/${childId}`).get()).data()
      return child?.rewardPoints === 20
    })

    if (!processedByTrigger) {
      // No Functions emulator in this run: invoke the same processor entry
      // point the trigger calls, so the assertions below still cover the fix.
      const result = await processApprovedCompletion(
        { repository: repo(), now: () => Date.now() },
        { familyId, completionId },
      )
      // The regression: this was 'ignored' before the fix.
      expect(result.status).toBe('processed')
    }

    // Spendable balance still lives on the user document.
    const child = (await admin().doc(`users/${childId}`).get()).data()!
    expect(child.rewardPoints).toBe(20)

    // Lifetime XP is owned by the gamification summary. `users.lifetimeXP` is
    // the legacy client-written field and is intentionally no longer updated,
    // so the summary is the authoritative thing to assert on.
    const summary = await admin().doc(`families/${familyId}/gamification_summaries/${childId}`).get()
    expect(summary.exists).toBe(true)
    expect(summary.data()!.xpTotal).toBeGreaterThan(0)
    expect(summary.data()!.level).toBeGreaterThanOrEqual(1)

    // What the dashboard reads back.
    const completion = (await admin().doc(`families/${familyId}/task_completions/${completionId}`).get()).data()!
    expect(completion.awardedPoints).toBe(20)
  })

  it('initializes gamificationMigration at family creation, so the processor can never return ignored', async () => {
    const email = `${unique('parent')}@example.com`
    const parent = await signUp(email, 'password123', 'Fresh Parent')
    const { familyId } = await createFamilyAndParent(parent.uid, 'Fresh Parent', 'Fresh Family')

    const family = (await admin().doc(`families/${familyId}`).get()).data()!
    expect(family.gamificationMigration).toBeDefined()
    expect(family.gamificationMigration.schemaVersion).toBe(1)
    expect(family.gamificationMigration.status).not.toBe('inactive')
    expect(GAMIFICATION_READY_STATUSES).toContain(family.gamificationMigration.status)

    // cutoverAt must not be in the future, or completions approved now would be
    // silently dropped as pre-cutover.
    expect(family.gamificationMigration.cutoverAt.toMillis()).toBeLessThanOrEqual(Date.now())
  })
})

describe('repair path for families already stuck inactive (emulator)', () => {
  it('is idempotent and does not touch families that are already ready', async () => {
    const stuck = unique('family-stuck')
    const ready = unique('family-ready')
    await admin().doc(`families/${stuck}`).set({ name: 'Stuck' }) // no gamificationMigration
    await admin().doc(`families/${ready}`).set({
      name: 'Ready',
      gamificationMigration: { schemaVersion: 1, status: 'active', cutoverAt: Timestamp.fromMillis(1000) },
    })

    const dryRun = await repairGamificationMigrations(admin(), { familyId: stuck, execute: false })
    expect(dryRun.families[0].outcome).toBe('would_repair')
    expect((await admin().doc(`families/${stuck}`).get()).data()!.gamificationMigration).toBeUndefined()

    const first = await repairGamificationMigrations(admin(), { familyId: stuck, execute: true })
    expect(first.families[0].outcome).toBe('repaired')
    const repaired = (await admin().doc(`families/${stuck}`).get()).data()!.gamificationMigration
    expect(GAMIFICATION_READY_STATUSES).toContain(repaired.status)

    // Idempotent: a second run changes nothing, including the cutover.
    const second = await repairGamificationMigrations(admin(), { familyId: stuck, execute: true })
    expect(second.families[0].outcome).toBe('already_ready')
    expect((await admin().doc(`families/${stuck}`).get()).data()!.gamificationMigration).toEqual(repaired)

    const untouched = await repairGamificationMigrations(admin(), { familyId: ready, execute: true })
    expect(untouched.families[0].outcome).toBe('already_ready')
    expect((await admin().doc(`families/${ready}`).get()).data()!.gamificationMigration.cutoverAt.toMillis()).toBe(1000)
  })

  it('backstop initialization is idempotent and preserves an existing cutover', async () => {
    const familyId = unique('family-backstop')
    await admin().doc(`families/${familyId}`).set({ name: 'Backstop' })

    const first = await ensureFamilyGamificationInitialized(admin(), familyId, new Date())
    expect(first.outcome).toBe('initialized')
    const stamped = (await admin().doc(`families/${familyId}`).get()).data()!.gamificationMigration

    const second = await ensureFamilyGamificationInitialized(admin(), familyId, new Date(Date.now() + 60_000))
    expect(second.outcome).toBe('already_ready')
    expect((await admin().doc(`families/${familyId}`).get()).data()!.gamificationMigration).toEqual(stamped)
  })
})
