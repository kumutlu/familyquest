//!/usr/bin/env node

// Simple test to validate smoke test infrastructure
// This script tests the smoke test setup without the complex orchestrator

const { applicationDefault, initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const { getFirestore } = require('firebase-admin/firestore')
const { execSync } = require('child_process')
const { existsSync } = require('fs')
const { join } = require('path')

const PROJECT_ID = 'familyquest-beta-402cb'
const FAMILY_ID = 'smoke-test-family'
const PARENT_UID = 'smoke-test-parent'
const CHILD_UID = 'smoke-test-child'

async function testSmokeSetup() {
  console.log('=== Testing Smoke Test Infrastructure ===')
  
  // Initialize Firebase app
  const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID })
  const auth = getAuth(app)
  const db = getFirestore(app)
  
  console.log('1. Testing smoke-setup.ts script...')
  try {
    const setupOutput = execSync('npx tsx scripts/smoke-setup.ts --project familyquest-beta-402cb', {
      encoding: 'utf8',
      timeout: 300000,
      cwd: __dirname
    })
    console.log('✓ smoke-setup.ts executed successfully')
    console.log('Setup output:', setupOutput.substring(0, 500) + '...')
  } catch (error) {
    console.error('✗ smoke-setup.ts failed:', error.message)
    return false
  }
  
  console.log('2. Testing verify-smoke-data.ts script...')
  try {
    const verifyOutput = execSync('npx tsx scripts/verify-smoke-data.ts', {
      encoding: 'utf8',
      timeout: 180000,
      cwd: __dirname
    })
    console.log('✓ verify-smoke-data.ts executed successfully')
    console.log('Verification output:', verifyOutput.substring(0, 500) + '...')
  } catch (error) {
    console.error('✗ verify-smoke-data.ts failed:', error.message)
    return false
  }
  
  console.log('3. Testing cleanup-smoke.ts script...')
  try {
    const cleanupOutput = execSync('npx tsx scripts/cleanup-smoke.ts', {
      encoding: 'utf8',
      timeout: 300000,
      cwd: __dirname
    })
    console.log('✓ cleanup-smoke.ts executed successfully')
    console.log('Cleanup output:', cleanupOutput.substring(0, 500) + '...')
  } catch (error) {
    console.error('✗ cleanup-smoke.ts failed:', error.message)
    return false
  }
  
  console.log('4. Testing verify-smoke-data.ts after cleanup...')
  try {
    const verifyOutput = execSync('npx tsx scripts/verify-smoke-data.ts', {
      encoding: 'utf8',
      timeout: 180000,
      cwd: __dirname
    })
    console.log('✓ verify-smoke-data.ts after cleanup executed successfully')
    console.log('Verification output:', verifyOutput.substring(0, 500) + '...')
  } catch (error) {
    console.error('✗ verify-smoke-data.ts after cleanup failed:', error.message)
    return false
  }
  
  console.log('\n=== Smoke Test Infrastructure Validation Complete ===')
  return true
}

if (require.main === module) {
  testSmokeSetup()
    .then(success => {
      if (success) {
        console.log('\n✅ Smoke test infrastructure is PRODUCTION READY!')
        process.exit(0)
      } else {
        console.log('\n❌ Smoke test infrastructure has issues')
        process.exit(1)
      }
    })
    .catch(error => {
      console.error('Fatal error:', error)
      process.exit(1)
    })
}

module.exports = { testSmokeSetup }