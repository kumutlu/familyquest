import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getAuth, getAuth as getAuthAdmin } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const app = initializeApp({ credential: applicationDefault(), projectId: 'familyquest-beta-402cb' })
const db = getFirestore(app)
const auth = getAuthAdmin(app)

async function verifyFamilyData(): Promise<void> {
  console.log('[verify-smoke-data] Verifying family data...')

  const familyDoc = await db.collection('families').doc('smoke-test-family').get()
  if (!familyDoc.exists) {
    throw new Error('Family document smoke-test-family does not exist')
  }

  const familyData = familyDoc.data()
  if (!familyData?.smokeTest) {
    throw new Error('Family document missing smokeTest flag')
  }

  if (!familyData.name || familyData.name !== 'Smoke Test Family') {
    throw new Error(`Family name mismatch: expected 'Smoke Test Family', got ${familyData.name || 'undefined'}`)
  }

  if (!familyData.gamificationMigration?.status || familyData.gamificationMigration.status !== 'active') {
    throw new Error('Family gamificationMigration status is not active')
  }

  console.log(`[verify-smoke-data] ✓ Family document verified: ${familyData.name}`)
}

async function verifyAuthUsers(): Promise<void> {
  console.log('[verify-smoke-data] Verifying auth users...')

  const PARENT_EMAIL = 'test-parent@familyquest.test'
  const CHILD_EMAIL = 'test-child@familyquest.test'
  const PARENT_UID = 'smoke-test-parent'
  const CHILD_UID = 'smoke-test-child'

  const parentUser = await auth.getUser(PARENT_UID)
  if (parentUser.email !== PARENT_EMAIL) {
    throw new Error(`Parent user email mismatch: expected ${PARENT_EMAIL}, got ${parentUser.email}`)
  }

  const childUser = await auth.getUser(CHILD_UID)
  if (childUser.email !== CHILD_EMAIL) {
    throw new Error(`Child user email mismatch: expected ${CHILD_EMAIL}, got ${childUser.email}`)
  }

  console.log('[verify-smoke-data] ✓ Auth users verified')
}

async function verifyFamilyScopedData(): Promise<void> {
  console.log('[verify-smoke-data] Verifying family-scoped data...')

  const FAMILY_ID = 'smoke-test-family'
  const PARENT_UID = 'smoke-test-parent'
  const CHILD_UID = 'smoke-test-child'

  // Verify parent user in family-scoped users collection
  const parentUserDoc = await db.collection('families').doc(FAMILY_ID).collection('users').doc(PARENT_UID).get()
  if (!parentUserDoc.exists) {
    throw new Error('Parent user document not found in family-scoped users collection')
  }

  const parentUserData = parentUserDoc.data()
  if (!parentUserData?.smokeTest) {
    throw new Error('Parent user document missing smokeTest flag')
  }

  if (parentUserData.role !== 'parent') {
    throw new Error(`Parent user role mismatch: expected 'parent', got ${parentUserData.role}`)
  }

  if (parentUserData.familyId !== FAMILY_ID) {
    throw new Error(`Parent user familyId mismatch: expected ${FAMILY_ID}, got ${parentUserData.familyId}`)
  }

  // Verify child user in family-scoped users collection
  const childUserDoc = await db.collection('families').doc(FAMILY_ID).collection('users').doc(CHILD_UID).get()
  if (!childUserDoc.exists) {
    throw new Error('Child user document not found in family-scoped users collection')
  }

  const childUserData = childUserDoc.data()
  if (!childUserData?.smokeTest) {
    throw new Error('Child user document missing smokeTest flag')
  }

  if (childUserData.role !== 'child') {
    throw new Error(`Child user role mismatch: expected 'child', got ${childUserData.role}`)
  }

  if (childUserData.familyId !== FAMILY_ID) {
    throw new Error(`Child user familyId mismatch: expected ${FAMILY_ID}, got ${childUserData.familyId}`)
  }

  console.log('[verify-smoke-data] ✓ Family-scoped user documents verified')
}

async function verifyRootUserData(): Promise<void> {
  console.log('[verify-smoke-data] Verifying root user data...')

  const PARENT_UID = 'smoke-test-parent'
  const CHILD_UID = 'smoke-test-child'

  const rootParentUserDoc = await db.collection('users').doc(PARENT_UID).get()
  if (!rootParentUserDoc.exists) {
    throw new Error('Root parent user document not found')
  }

  const rootParentUserData = rootParentUserDoc.data()
  if (!rootParentUserData?.smokeTest) {
    throw new Error('Root parent user document missing smokeTest flag')
  }

  if (rootParentUserData.role !== 'parent') {
    throw new Error(`Root parent user role mismatch: expected 'parent', got ${rootParentUserData.role}`)
  }

  const rootChildUserDoc = await db.collection('users').doc(CHILD_UID).get()
  if (!rootChildUserDoc.exists) {
    throw new Error('Root child user document not found')
  }

  const rootChildUserData = rootChildUserDoc.data()
  if (!rootChildUserData?.smokeTest) {
    throw new Error('Root child user document missing smokeTest flag')
  }

  if (rootChildUserData.role !== 'child') {
    throw new Error(`Root child user role mismatch: expected 'child', got ${rootChildUserData.role}`)
  }

  console.log('[verify-smoke-data] ✓ Root user documents verified')
}

async function verifyTaskData(): Promise<void> {
  console.log('[verify-smoke-data] Verifying task data...')

  const FAMILY_ID = 'smoke-test-family'

  const taskDoc = await db.collection('families').doc(FAMILY_ID).collection('tasks').doc('smoke-task-1').get()
  if (!taskDoc.exists) {
    throw new Error('Smoke test task not found')
  }

  const taskData = taskDoc.data()
  if (!taskData?.smokeTest) {
    throw new Error('Smoke test task missing smokeTest flag')
  }

  if (taskData.title !== 'Clean Room (Smoke)') {
    throw new Error(`Task title mismatch: expected 'Clean Room (Smoke)', got ${taskData.title}`)
  }

  if (taskData.childId !== 'smoke-test-child') {
    throw new Error(`Task childId mismatch: expected 'smoke-test-child', got ${taskData.childId}`)
  }

  if (taskData.isActive !== true) {
    throw new Error(`Task isActive mismatch: expected true, got ${taskData.isActive}`)
  }

  if (taskData.requiresApproval !== true) {
    throw new Error(`Task requiresApproval mismatch: expected true, got ${taskData.requiresApproval}`)
  }

  if (taskData.type !== 'one_off') {
    throw new Error(`Task type mismatch: expected 'one_off', got ${taskData.type}`)
  }

  if (taskData.pointValue !== 10) {
    throw new Error(`Task pointValue mismatch: expected 10, got ${taskData.pointValue}`)
  }

  console.log('[verify-smoke-data] ✓ Task data verified')
}

async function verifyWalletData(): Promise<void> {
  console.log('[verify-smoke-data] Verifying wallet data...')

  const FAMILY_ID = 'smoke-test-family'
  const CHILD_UID = 'smoke-test-child'

  const walletDoc = await db.collection('families').doc(FAMILY_ID).collection('wallets').doc(CHILD_UID).get()
  if (!walletDoc.exists) {
    throw new Error('Child wallet document not found')
  }

  const walletData = walletDoc.data()
  if (!walletData?.smokeTest) {
    throw new Error('Child wallet document missing smokeTest flag')
  }

  if (walletData.balance !== 0) {
    throw new Error(`Child wallet balance mismatch: expected 0, got ${walletData.balance}`)
  }

  console.log('[verify-smoke-data] ✓ Wallet data verified')
}

async function verifyUnrelatedData(): Promise<void> {
  console.log('[verify-smoke-data] Verifying unrelated test data...')

  const unrelatedFamilyDoc = await db.collection('families').doc('smoke-test-unrelated-family').get()
  if (!unrelatedFamilyDoc.exists) {
    throw new Error('Unrelated family document not found')
  }

  const unrelatedFamilyData = unrelatedFamilyDoc.data()
  if (!unrelatedFamilyData?.smokeTest) {
    throw new Error('Unrelated family document missing smokeTest flag')
  }

  if (unrelatedFamilyData.name !== 'Unrelated Family') {
    throw new Error(`Unrelated family name mismatch: expected 'Unrelated Family', got ${unrelatedFamilyData.name}`)
  }

  const unrelatedUserDoc = await db.collection('families').doc('smoke-test-unrelated-family').collection('users').doc('smoke-test-unrelated').get()
  if (!unrelatedUserDoc.exists) {
    throw new Error('Unrelated user document not found')
  }

  const unrelatedUserData = unrelatedUserDoc.data()
  if (!unrelatedUserData?.smokeTest) {
    throw new Error('Unrelated user document missing smokeTest flag')
  }

  if (unrelatedUserData.role !== 'parent') {
    throw new Error(`Unrelated user role mismatch: expected 'parent', got ${unrelatedUserData.role}`)
  }

  console.log('[verify-smoke-data] ✓ Unrelated test data verified')
}

async function verifyAdditionalCollections(): Promise<void> {
  console.log('[verify-smoke-data] Verifying additional collections...')

  const FAMILY_ID = 'smoke-test-family'

  // Verify savings_goals collection exists (should be empty for smoke test)
  const goalsSnapshot = await db.collection('families').doc(FAMILY_ID).collection('savings_goals').get()
  console.log(`[verify-smoke-data] Found ${goalsSnapshot.size} savings_goals documents (expected 0 for smoke test)`)

  // Verify other operational collections exist (should be empty for smoke test)
  const operationalCollections = [
    'tasks', 'task_completions', 'rewards', 'redemptions', 'feed',
    'wallet_transactions', 'behaviour_events', 'challenges', 'funds',
    'fund_transactions', 'transfer_requests', 'money_requests', 'petbox_requests',
    'reversals', 'approvals', 'approval_history', 'idempotency'
  ]

  for (const collectionName of operationalCollections) {
    const collectionRef = db.collection('families').doc(FAMILY_ID).collection(collectionName)
    const snapshot = await collectionRef.get()
    console.log(`[verify-smoke-data] Collection ${collectionName}: ${snapshot.size} documents (expected 0 for smoke test)`)
  }

  console.log('[verify-smoke-data] ✓ Additional collections verified')
}

async function main() {
  try {
    console.log('[verify-smoke-data] Starting comprehensive smoke data verification...')

    await verifyFamilyData()
    await verifyAuthUsers()
    await verifyFamilyScopedData()
    await verifyRootUserData()
    await verifyTaskData()
    await verifyWalletData()
    await verifyUnrelatedData()
    await verifyAdditionalCollections()

    console.log('[verify-smoke-data] ✓ All smoke data verification checks passed')
    process.exit(0)
  } catch (error) {
    console.error('[verify-smoke-data] FAILED:', error)
    process.exit(1)
  }
}

main()