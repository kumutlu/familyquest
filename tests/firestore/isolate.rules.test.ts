import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc } from 'firebase/firestore'
import { readFileSync } from 'node:fs'

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'familyquest-isolated-wallet-regression',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  })
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users/child1'), { familyId: 'family1', role: 'child' })
    await setDoc(doc(context.firestore(), 'families/family1/wallets/child1'), { balance: 500 })
  })
})

afterAll(async () => { await testEnv.cleanup() })

describe('isolated wallet bypass regression', () => {
  it('denies an unauthenticated direct wallet update', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    const failure = assertFails(updateDoc(doc(db, 'families/family1/wallets/child1'), { balance: 999999 }))
    await expect(failure).resolves.toBeDefined()
  })
})
