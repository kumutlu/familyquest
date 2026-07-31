// Phase 5 — Production smoke-test setup for familyquest-beta-402cb.
//
// Creates REAL test accounts (parent + child) and a dedicated test family in the
// LIVE project so the 16 Goals smoke scenarios can be exercised against
// production rules. Uses trivial amounts only (no meaningful real money).
//
// All created documents are tagged with `smokeTest: true` and a known
// familyId so the cleanup script can delete them completely afterward.
//
// Usage:
//   export GOOGLE_APPLICATION_CREDENTIALS=./familyquest-beta-402cb-...json
//   npx tsx scripts/smoke-setup.ts --project familyquest-beta-402cb

import { applicationDefault, getApps, initializeApp, type FirebaseApp } from 'firebase-admin/app'
import { getAuth, type Auth } from 'firebase-admin/auth'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

// Disposable QA fixture identities. Emails/UIDs are clearly QA-only and safe
// to keep in source; the PASSWORD is a secret and MUST come from the
// environment (never committed). See docs/production-smoke.md.
function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || value.trim() === '') {
    throw new Error(
      `[smoke-setup] Missing required env var ${name}. Supply a strong ` +
      `temporary password via environment / local secret storage. ` +
      `Never hard-code or commit fixture credentials.`,
    )
  }
  return value
}

const PARENT_EMAIL = process.env.QUEKI_SMOKE_PARENT_EMAIL || 'test-parent@familyquest.test'
const CHILD_EMAIL = process.env.QUEKI_SMOKE_CHILD_EMAIL || 'test-child@familyquest.test'
const PARENT_PASSWORD = requireEnv('QUEKI_SMOKE_PARENT_PASSWORD')
const CHILD_PASSWORD = process.env.QUEKI_SMOKE_CHILD_PASSWORD || PARENT_PASSWORD
const FAMILY_ID = 'smoke-test-family'
const PARENT_UID = 'smoke-test-parent'
const CHILD_UID = 'smoke-test-child'

function getApp(projectId: string): FirebaseApp {
  const name = `smoke-setup-${projectId}`
  return getApps().find((c) => c.name === name)
    ?? initializeApp({ credential: applicationDefault(), projectId }, name)
}

async function main() {
  let projectId = 'familyquest-beta-402cb'
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === '--project') { projectId = process.argv[i + 1]; i += 1 }
  }
  const app = getApp(projectId)
  const auth: Auth = getAuth(app, projectId)
  const db: Firestore = getFirestore(app)

  console.log(`[smoke-setup] project=${projectId} family=${FAMILY_ID}`)

  async function ensureUser(uid: string, email: string, password: string, displayName: string) {
    try {
      await auth.createUser({ uid, email, password, displayName })
      console.log(`[smoke-setup] created auth user ${uid} <${email}>`)
    } catch (err: any) {
      if (err?.code === 'auth/uid-already-exists' || err?.errorInfo?.code === 'auth/uid-already-exists') {
        await auth.updateUser(uid, { email, password, displayName })
        console.log(`[smoke-setup] reused auth user ${uid} <${email}>`)
      } else {
        throw err
      }
    }
  }
  await ensureUser(PARENT_UID, PARENT_EMAIL, PARENT_PASSWORD, 'Smoke Parent')
  await ensureUser(CHILD_UID, CHILD_EMAIL, CHILD_PASSWORD, 'Smoke Child')

  const familyRef = db.collection('families').doc(FAMILY_ID)
  await familyRef.set({ name: 'Smoke Test Family', smokeTest: true, createdAt: new Date() })

  await familyRef.collection('users').doc(PARENT_UID).set({
    uid: PARENT_UID, familyId: FAMILY_ID, role: 'parent', displayName: 'Smoke Parent',
    email: PARENT_EMAIL, smokeTest: true,
  })
  await familyRef.collection('users').doc(CHILD_UID).set({
    uid: CHILD_UID, familyId: FAMILY_ID, role: 'child', displayName: 'Smoke Child',
    email: CHILD_EMAIL, smokeTest: true,
  })
  await familyRef.collection('wallets').doc(CHILD_UID).set({ balance: 0, smokeTest: true })

  // The app's auth bootstrap reads the profile from the ROOT `users/{uid}`
  // collection (see src/store/useStore.ts: doc(db, 'users', user.uid)),
  // NOT the family-scoped path. Write root user docs too so the
  // profile resolves after login.
  const rootUsers = db.collection('users')
  await rootUsers.doc(PARENT_UID).set({
    uid: PARENT_UID, familyId: FAMILY_ID, role: 'parent', displayName: 'Smoke Parent',
    email: PARENT_EMAIL, smokeTest: true,
  })
  await rootUsers.doc(CHILD_UID).set({
    uid: CHILD_UID, familyId: FAMILY_ID, role: 'child', displayName: 'Smoke Child',
    email: CHILD_EMAIL, smokeTest: true,
  })

  console.log('[smoke-setup] DONE')
  console.log(`  parent: ${PARENT_EMAIL} / <redacted> (uid=${PARENT_UID})`)
  console.log(`  child:  ${CHILD_EMAIL} / <redacted> (uid=${CHILD_UID})`)
  console.log(`  family: ${FAMILY_ID}`)
}

main().catch((err) => {
  console.error('[smoke-setup] FAILED:', err)
  process.exit(1)
})
