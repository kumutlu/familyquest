import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue, DocumentData } from 'firebase-admin/firestore'
import { getAuth, getAuth as getAuthAdmin } from 'firebase-admin/auth'

const app = initializeApp({ credential: applicationDefault(), projectId: 'familyquest-beta-402cb' })
const db = getFirestore(app)
const auth = getAuthAdmin(app)

interface CleanupResult {
  familyDeleted: boolean
  authUsersDeleted: number
  familyScopedDocsDeleted: number
  rootDocsDeleted: number
  tasksDeleted: number
  taskCompletionsDeleted: number
  goalsDeleted: number
  idempotencyDocsDeleted: number
  errors: string[]
}

async function verifyDocumentExists(path: string, documentId: string): Promise<boolean> {
  try {
    const docRef = db.doc(path)
    const doc = await docRef.get()
    return doc.exists
  } catch (error) {
    console.error(`[cleanup-smoke] Error verifying document ${path}/${documentId}:`, error)
    return false
  }
}

async function verifyAuthUserExists(uid: string): Promise<boolean> {
  try {
    await auth.getUser(uid)
    return true
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'auth/user-not-found') {
      return false
    }
    console.error(`[cleanup-smoke] Error verifying auth user ${uid}:`, error)
    return false
  }
}

async function deleteWithRetry(
  deleteFn: () => Promise<void>, 
  maxRetries: number = 3, 
  retryDelay: number = 1000
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await deleteFn()
      return true
    } catch (error) {
      console.error(`[cleanup-smoke] Delete attempt ${attempt} failed:`, error)
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay))
      } else {
        throw error
      }
    }
  }
  return false
}

async function cleanupFamilyData(): Promise<CleanupResult> {
  const result: CleanupResult = {
    familyDeleted: false,
    authUsersDeleted: 0,
    familyScopedDocsDeleted: 0,
    rootDocsDeleted: 0,
    tasksDeleted: 0,
    taskCompletionsDeleted: 0,
    goalsDeleted: 0,
    idempotencyDocsDeleted: 0,
    errors: []
  }

  console.log('[cleanup-smoke] Starting comprehensive smoke test cleanup...')
  
  // Verify smoke test family exists before attempting cleanup
  const familyDoc = await db.collection('families').doc('smoke-test-family').get()
  if (!familyDoc.exists) {
    console.log('[cleanup-smoke] Smoke test family not found - cleanup may have already been completed')
    result.familyDeleted = true
    return result
  }

  // Delete all subcollections under savings_goals first
  const goals = await db.collection('families').doc('smoke-test-family').collection('savings_goals').get()
  for (const goalDoc of goals.docs) {
    console.log(`[cleanup-smoke] Processing goal: ${goalDoc.id}`)
    
    // Delete all subcollections for this goal
    const subcollections = ['contributions', 'goal_ledger', 'match_proposals', 'goal_requests']
    for (const subcollectionName of subcollections) {
      try {
        const subcollectionDocs = await goalDoc.ref.collection(subcollectionName).get()
        for (const subDoc of subcollectionDocs.docs) {
          await deleteWithRetry(() => subDoc.ref.delete())
          result.familyScopedDocsDeleted++
          console.log(`[cleanup-smoke] Deleted ${subcollectionName} document: ${subDoc.id}`)
        }
      } catch (error) {
        result.errors.push(`Failed to delete subcollection ${subcollectionName} for goal ${goalDoc.id}: ${error}`)
      }
    }
    
    // Delete the goal document itself
    try {
      await deleteWithRetry(() => goalDoc.ref.delete())
      result.goalsDeleted++
      console.log(`[cleanup-smoke] Deleted goal document: ${goalDoc.id}`)
    } catch (error) {
      result.errors.push(`Failed to delete goal document ${goalDoc.id}: ${error}`)
    }
  }

  console.log(`[cleanup-smoke] Cleaned up ${goals.size} goal(s)`)

  // Cleanup goal-create idempotency docs
  try {
    const idem = await db.collection('families').doc('smoke-test-family').collection('idempotency')
      .where('operationType', '==', 'goal_create').get()
    
    for (const doc of idem.docs) {
      await deleteWithRetry(() => doc.ref.delete())
      result.idempotencyDocsDeleted++
      console.log(`[cleanup-smoke] Deleted idempotency document: ${doc.id}`)
    }
    
    console.log(`[cleanup-smoke] Cleared ${idem.size} goal_create idempotency doc(s)`)
  } catch (error) {
    result.errors.push(`Failed to cleanup idempotency documents: ${error}`)
  }

  // Cleanup gamification task completions
  try {
    const completions = await db.collection('families').doc('smoke-test-family')
      .collection('task_completions').where('smokeTest', '==', true).get()
    
    for (const doc of completions.docs) {
      await deleteWithRetry(() => doc.ref.delete())
      result.taskCompletionsDeleted++
      console.log(`[cleanup-smoke] Deleted task completion: ${doc.id}`)
    }
    
    console.log(`[cleanup-smoke] Cleared ${completions.size} task completion(s)`)
  } catch (error) {
    result.errors.push(`Failed to cleanup task completions: ${error}`)
  }

  // Cleanup tasks with smokeTest flag
  try {
    const tasks = await db.collection('families').doc('smoke-test-family')
      .collection('tasks').where('smokeTest', '==', true).get()
    
    for (const doc of tasks.docs) {
      await deleteWithRetry(() => doc.ref.delete())
      result.tasksDeleted++
      console.log(`[cleanup-smoke] Deleted task: ${doc.id} (${doc.data()?.title || 'Untitled'})`)
    }
    
    console.log(`[cleanup-smoke] Cleared ${tasks.size} task(s)`)
  } catch (error) {
    result.errors.push(`Failed to cleanup tasks: ${error}`)
  }

  // Cleanup family-scoped user documents
  const familyScopedUsers = await db.collection('families').doc('smoke-test-family').collection('users').get()
  for (const doc of familyScopedUsers.docs) {
    try {
      await deleteWithRetry(() => doc.ref.delete())
      result.familyScopedDocsDeleted++
      console.log(`[cleanup-smoke] Deleted family-scoped user: ${doc.id}`)
    } catch (error) {
      result.errors.push(`Failed to delete family-scoped user ${doc.id}: ${error}`)
    }
  }

  // Cleanup root user documents
  const rootUsers = ['smoke-test-parent', 'smoke-test-child']
  for (const uid of rootUsers) {
    try {
      await deleteWithRetry(() => db.collection('users').doc(uid).delete())
      result.rootDocsDeleted++
      console.log(`[cleanup-smoke] Deleted root user document: ${uid}`)
    } catch (error) {
      result.errors.push(`Failed to delete root user document ${uid}: ${error}`)
    }
  }

  // Cleanup auth users
  const authUsers = ['smoke-test-parent', 'smoke-test-child']
  for (const uid of authUsers) {
    try {
      await deleteWithRetry(() => auth.deleteUser(uid))
      result.authUsersDeleted++
      console.log(`[cleanup-smoke] Deleted auth user: ${uid}`)
    } catch (error) {
      // User might not exist, which is fine for cleanup
      if (error && typeof error === 'object' && 'code' in error && error.code === 'auth/user-not-found') {
        console.log(`[cleanup-smoke] Auth user not found (already deleted): ${uid}`)
      } else {
        result.errors.push(`Failed to delete auth user ${uid}: ${error}`)
      }
    }
  }

  // Finally, delete the family document itself
  try {
    await deleteWithRetry(() => db.collection('families').doc('smoke-test-family').delete())
    result.familyDeleted = true
    console.log('[cleanup-smoke] Deleted smoke test family document')
  } catch (error) {
    result.errors.push(`Failed to delete family document: ${error}`)
  }

  // Cleanup unrelated test data
  try {
    const unrelatedFamilyDoc = await db.collection('families').doc('smoke-test-unrelated-family').get()
    if (unrelatedFamilyDoc.exists) {
      const unrelatedUsers = await unrelatedFamilyDoc.ref.collection('users').get()
      for (const userDoc of unrelatedUsers.docs) {
        await deleteWithRetry(() => userDoc.ref.delete())
        result.familyScopedDocsDeleted++
        console.log(`[cleanup-smoke] Deleted unrelated user: ${userDoc.id}`)
      }
      
      await deleteWithRetry(() => unrelatedFamilyDoc.ref.delete())
      console.log('[cleanup-smoke] Deleted unrelated family document')
    }
  } catch (error) {
    result.errors.push(`Failed to cleanup unrelated test data: ${error}`)
  }

  return result
}

async function verifyCleanup(result: CleanupResult): Promise<void> {
  console.log('[cleanup-smoke] Verifying cleanup completion...')
  
  // Verify family document is deleted
  const familyExists = await verifyDocumentExists('families', 'smoke-test-family')
  if (familyExists) {
    throw new Error('Smoke test family document still exists after cleanup')
  }
  
  // Verify auth users are deleted
  const parentUserExists = await verifyAuthUserExists('smoke-test-parent')
  if (parentUserExists) {
    throw new Error('Parent auth user still exists after cleanup')
  }
  
  const childUserExists = await verifyAuthUserExists('smoke-test-child')
  if (childUserExists) {
    throw new Error('Child auth user still exists after cleanup')
  }
  
  // Verify family-scoped documents are deleted
  const familyScopedUsersExist = await verifyDocumentExists(
    'families/smoke-test-family/users', 'smoke-test-parent'
  )
  if (familyScopedUsersExist) {
    throw new Error('Family-scoped user documents still exist after cleanup')
  }
  
  // Verify root user documents are deleted
  const rootParentExists = await verifyDocumentExists('users', 'smoke-test-parent')
  if (rootParentExists) {
    throw new Error('Root parent user document still exists after cleanup')
  }
  
  const rootChildExists = await verifyDocumentExists('users', 'smoke-test-child')
  if (rootChildExists) {
    throw new Error('Root child user document still exists after cleanup')
  }
  
  // Verify unrelated test data is cleaned up
  const unrelatedFamilyExists = await verifyDocumentExists('families', 'smoke-test-unrelated-family')
  if (unrelatedFamilyExists) {
    throw new Error('Unrelated family document still exists after cleanup')
  }
  
  console.log('[cleanup-smoke] ✓ All cleanup verifications passed')
}

async function main() {
  try {
    console.log('[cleanup-smoke] Starting smoke test cleanup process...')
    
    const result = await cleanupFamilyData()
    
    // Verify cleanup was successful
    await verifyCleanup(result)
    
    // Log summary
    console.log('\n[cleanup-smoke] CLEANUP SUMMARY:');
    console.log(`  Family document deleted: ${result.familyDeleted ? '✓' : '✗'}`);
    console.log(`  Auth users deleted: ${result.authUsersDeleted}`);
    console.log(`  Family-scoped docs deleted: ${result.familyScopedDocsDeleted}`);
    console.log(`  Root docs deleted: ${result.rootDocsDeleted}`);
    console.log(`  Tasks deleted: ${result.tasksDeleted}`);
    console.log(`  Task completions deleted: ${result.taskCompletionsDeleted}`);
    console.log(`  Goals deleted: ${result.goalsDeleted}`);
    console.log(`  Idempotency docs deleted: ${result.idempotencyDocsDeleted}`);
    
    if (result.errors.length > 0) {
      console.log('\n[cleanup-smoke] WARNINGS/ERRORS ENCOUNTERED:')
      result.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error}`);
      })
    }
    
    console.log('\n[cleanup-smoke] ✓ Smoke test cleanup completed successfully')
    process.exit(0)
    
  } catch (error) {
    console.error('[cleanup-smoke] FAILED:', error)
    process.exit(1)
  }
}

main()