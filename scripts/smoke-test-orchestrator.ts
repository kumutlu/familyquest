// Phase 5 — Smoke Test Orchestrator for familyquest-beta-402cb.
//
// Coordinates the complete smoke test lifecycle: setup, verification, and cleanup.
// Provides synchronization mechanisms, comprehensive logging, and production data hygiene validation.
//
// Usage:
//   export GOOGLE_APPLICATION_CREDENTIALS=./familyquest-beta-402cb-...json
//   npx tsx scripts/smoke-test-orchestrator.ts --project familyquest-beta-402cb --mode setup|verify|cleanup|full

import { applicationDefault, getApps, initializeApp, type FirebaseApp } from 'firebase-admin/app'
import { getAuth, type Auth } from 'firebase-admin/auth'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

const PROJECT_ID = 'familyquest-beta-402cb'
const FAMILY_ID = 'smoke-test-family'
const PARENT_UID = 'smoke-test-parent'
const CHILD_UID = 'smoke-test-child'
const UNRELATED_FAMILY_ID = 'smoke-test-unrelated-family'
const UNRELATED_UID = 'smoke-test-unrelated'

interface OrchestratorOptions {
  projectId: string
  mode: 'setup' | 'verify' | 'cleanup' | 'full'
  skipVerification?: boolean
  skipCleanup?: boolean
  dryRun?: boolean
}

interface OrchestratorResult {
  setupCompleted: boolean
  setupVerified: boolean
  verificationCompleted: boolean
  cleanupCompleted: boolean
  errors: string[]
  logs: string[]
}

class SmokeTestOrchestrator {
  private options: OrchestratorOptions
  private result: OrchestratorResult
  private app: FirebaseApp
  private auth: Auth
  private db: Firestore
  private startTime: Date

  constructor(options: OrchestratorOptions) {
    this.options = options
    this.result = {
      setupCompleted: false,
      setupVerified: false,
      verificationCompleted: false,
      cleanupCompleted: false,
      errors: [],
      logs: []
    }
    this.startTime = new Date()
    
    // Initialize Firebase app
    const appName = `orchestrator-${options.projectId}`
    this.app = getApps().find((c) => c.name === appName)
      ?? initializeApp({ credential: applicationDefault(), projectId: options.projectId }, appName)
    
    this.auth = getAuth(this.app, options.projectId)
    this.db = getFirestore(this.app)
    
    this.log(`Orchestrator initialized for project: ${options.projectId}`)
    this.log(`Mode: ${options.mode}`)
  }

  private log(message: string): void {
    const timestamp = new Date().toISOString()
    const logEntry = `[${timestamp}] ${message}`
    console.log(logEntry)
    this.result.logs.push(logEntry)
  }

  private error(message: string, error?: any): void {
    const errorEntry = `[${new Date().toISOString()}] ERROR: ${message}`
    console.error(errorEntry)
    if (error) {
      console.error('Stack trace:', error.stack)
    }
    this.result.errors.push(`${message}${error ? `: ${error.message}` : ''}`)
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private async checkExistingData(): Promise<void> {
    this.log('Checking for existing smoke test data...')
    
    // Check if family already exists
    const familyDoc = await this.db.collection('families').doc(FAMILY_ID).get()
    if (familyDoc.exists) {
      this.log(`WARNING: Family ${FAMILY_ID} already exists - this may indicate a previous incomplete run`)      
      // Check if it's a smoke test family
      if (familyDoc.data()?.smokeTest) {
        this.log('Existing smoke test family detected - cleanup may be needed before proceeding')
      }
    }
    
    // Check if auth users already exist
    try {
      await this.auth.getUser(PARENT_UID)
      this.log('WARNING: Parent auth user already exists')
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'auth/user-not-found') {
        this.log('Parent auth user does not exist - good for clean setup')
      }
    }
    
    try {
      await this.auth.getUser(CHILD_UID)
      this.log('WARNING: Child auth user already exists')
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'auth/user-not-found') {
        this.log('Child auth user does not exist - good for clean setup')
      }
    }
  }

  private async runSetup(): Promise<void> {
    this.log('Starting smoke test setup...')
    
    if (this.options.dryRun) {
      this.log('DRY RUN: Skipping actual setup')
      this.result.setupCompleted = true
      return
    }
    
    // Run the smoke-setup.ts script
    try {
      this.log('Executing smoke-setup.ts script...')
      const scriptPath = join(__dirname, 'smoke-setup.ts')
      
      if (!existsSync(scriptPath)) {
        throw new Error(`smoke-setup.ts not found at ${scriptPath}`)
      }
      
      // Execute the setup script
      const setupOutput = execSync('npx tsx smoke-setup.ts --project familyquest-beta-402cb', {
        encoding: 'utf8',
        timeout: 300000, // 5 minutes timeout
        cwd: __dirname
      })
      
      this.log('Setup script completed successfully')
      this.log('Setup output:', setupOutput)
      this.result.setupCompleted = true
      
    } catch (error) {
      this.error('Setup script failed', error)
      throw error
    }
  }

  private async runVerification(): Promise<void> {
    this.log('Starting smoke test verification...')
    
    if (this.options.dryRun) {
      this.log('DRY RUN: Skipping actual verification')
      this.result.verificationCompleted = true
      return
    }
    
    // Run the verify-smoke-data.ts script
    try {
      this.log('Executing verify-smoke-data.ts script...')
      const scriptPath = join(__dirname, 'verify-smoke-data.ts')
      
      if (!existsSync(scriptPath)) {
        throw new Error(`verify-smoke-data.ts not found at ${scriptPath}`)
      }
      
      // Execute the verification script
      const verifyOutput = execSync('npx tsx verify-smoke-data.ts', {
        encoding: 'utf8',
        timeout: 180000, // 3 minutes timeout
        cwd: __dirname
      })
      
      this.log('Verification script completed successfully')
      this.log('Verification output:', verifyOutput)
      this.result.verificationCompleted = true
      
    } catch (error) {
      this.error('Verification script failed', error)
      throw error
    }
  }

  private async runCleanup(): Promise<void> {
    this.log('Starting smoke test cleanup...')
    
    if (this.options.dryRun) {
      this.log('DRY RUN: Skipping actual cleanup')
      this.result.cleanupCompleted = true
      return
    }
    
    // Run the cleanup-smoke.ts script
    try {
      this.log('Executing cleanup-smoke.ts script...')
      const scriptPath = join(__dirname, 'cleanup-smoke.ts')
      
      if (!existsSync(scriptPath)) {
        throw new Error(`cleanup-smoke.ts not found at ${scriptPath}`)
      }
      
      // Execute the cleanup script
      const cleanupOutput = execSync('npx tsx cleanup-smoke.ts', {
        encoding: 'utf8',
        timeout: 300000, // 5 minutes timeout
        cwd: __dirname
      })
      
      this.log('Cleanup script completed successfully')
      this.log('Cleanup output:', cleanupOutput)
      this.result.cleanupCompleted = true
      
    } catch (error) {
      this.error('Cleanup script failed', error)
      throw error
    }
  }

  private async validateProductionDataHygiene(): Promise<void> {
    this.log('Validating production data hygiene...')
    
    // Check for any non-smoke test data that might have been affected
    try {
      const allFamilies = await this.db.collection('families').get()
      const smokeTestFamilies = allFamilies.docs.filter(doc => doc.data().smokeTest)
      
      this.log(`Found ${smokeTestFamilies.length} smoke test families (expected: 1 or 0 if cleaned up)`)
      
      if (smokeTestFamilies.length > 1) {
        this.log('WARNING: Multiple smoke test families found - potential data contamination')
      }
      
      // Check for any auth users with smokeTest-like patterns
      const authUsers = ['smoke-test-parent', 'smoke-test-child', 'smoke-test-unrelated']
      for (const uid of authUsers) {
        try {
          await this.auth.getUser(uid)
          this.log(`WARNING: Auth user ${uid} still exists - cleanup may be incomplete`)
        } catch (error) {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'auth/user-not-found') {
            this.log(`Auth user ${uid} properly cleaned up`)          }
        }
      }
      
    } catch (error) {
      this.error('Failed to validate production data hygiene', error)
    }
  }

  private async executeMode(mode: string): Promise<void> {
    switch (mode) {
      case 'setup':
        await this.checkExistingData()
        await this.runSetup()
        if (!this.options.skipVerification) {
          await this.runVerification()
        }
        break
        
      case 'verify':
        await this.runVerification()
        break
        
      case 'cleanup':
        await this.checkExistingData()
        await this.runCleanup()
        break
        
      case 'full':
        await this.checkExistingData()
        await this.runSetup()
        if (!this.options.skipVerification) {
          await this.runVerification()
        }
        await this.runCleanup()
        await this.validateProductionDataHygiene()
        break
        
      default:
        throw new Error(`Unknown mode: ${mode}`)
    }
  }

  public async run(): Promise<OrchestratorResult> {
    this.log(`Starting smoke test orchestration in ${this.options.mode} mode`)    
    
    try {
      await this.executeMode(this.options.mode)
      
      this.log('Orchestration completed successfully')
      
    } catch (error) {
      this.error('Orchestration failed', error)
      throw error
    }
    
    return this.result
  }
}

async function main() {
  const args = process.argv.slice(2)
  let mode: 'setup' | 'verify' | 'cleanup' | 'full' = 'full'
  let projectId = PROJECT_ID
  let skipVerification = false
  let skipCleanup = false
  let dryRun = false
  
  // Parse command line arguments
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    switch (arg) {
      case '--mode':
        mode = args[i + 1] as any
        i += 1
        break
      case '--project':
        projectId = args[i + 1]
        i += 1
        break
      case '--skip-verification':
        skipVerification = true
        break
      case '--skip-cleanup':
        skipCleanup = true
        break
      case '--dry-run':
        dryRun = true
        break
      case '--help':
        console.log(`
Smoke Test Orchestrator

Usage: npx tsx smoke-test-orchestrator.ts [options]

Options:
  --mode <mode>              Mode: setup, verify, cleanup, or full (default: full)
  --project <project-id>      Project ID (default: ${PROJECT_ID})
  --skip-verification         Skip verification step
  --skip-cleanup             Skip cleanup step
  --dry-run                   Dry run mode (no actual operations)
  --help                      Show this help message

Modes:
  setup     - Run setup only
  verify    - Run verification only
  cleanup   - Run cleanup only
  full      - Run complete lifecycle (setup -> verify -> cleanup)

Examples:
  npx tsx smoke-test-orchestrator.ts --mode full
  npx tsx smoke-test-orchestrator.ts --mode setup --skip-verification
  npx tsx smoke-test-orchestrator.ts --mode full --dry-run
        `)
        process.exit(0)
    }
  }
  
  const options: OrchestratorOptions = {
    projectId,
    mode,
    skipVerification,
    skipCleanup,
    dryRun
  }
  
  const orchestrator = new SmokeTestOrchestrator(options)
  
  try {
    const result = await orchestrator.run()
    
    console.log('\n' + '='.repeat(60))
    console.log('ORCHESTRATION SUMMARY')
    console.log('='.repeat(60))
    console.log(`Mode: ${mode}`)
    console.log(`Project: ${projectId}`)
    console.log(`Setup completed: ${result.setupCompleted ? '✓' : '✗'}`)
    console.log(`Setup verified: ${result.setupVerified ? '✓' : '✗'}`)
    console.log(`Verification completed: ${result.verificationCompleted ? '✓' : '✗'}`)
    console.log(`Cleanup completed: ${result.cleanupCompleted ? '✓' : '✗'}`)
    console.log(`Errors encountered: ${result.errors.length}`)
    console.log(`Total logs: ${result.logs.length}`)
    
    if (result.errors.length > 0) {
      console.log('\nERRORS:')
      result.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error}`)
      })
    }
    
    if (result.logs.length > 0) {
      console.log('\nLATEST LOGS:')
      const recentLogs = result.logs.slice(-10) // Show last 10 logs
      recentLogs.forEach((log, index) => {
        console.log(`  ${index + 1}. ${log}`)
      })
    }
    
    console.log('\n' + '='.repeat(60))
    
    if (result.errors.length > 0) {
      process.exit(1)
    } else {
      process.exit(0)
    }
    
  } catch (error) {
    console.error('Fatal orchestration error:', error)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}

export { SmokeTestOrchestrator, OrchestratorOptions, OrchestratorResult }