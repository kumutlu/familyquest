#!/usr/bin/env node
/**
 * Migration script to link legacy pet box donations to their original petbox_requests.
 * 
 * Usage:
 *   npm exec tsx scripts/migrate-legacy-petbox-links.ts [--apply] [--family FAMILY_ID] [--verbose]
 * 
 * Modes:
 *   (default, no --apply): Dry-run mode - lists all unmatched donations and proposed fixes
 *   --apply: Actually updates the documents (creates backup first)
 *   --family FAMILY_ID: Process only specific family
 *   --verbose: Show detailed diagnostic output
 * 
 * Safety features:
 *   - Dry-run by default (no changes without --apply)
 *   - Creates backup before updates
 *   - Only updates sourceId/sourceRequestId linkage fields
 *   - Never changes amounts, balances, or other data
 *   - Requires exactly one safe match to proceed
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Query, CollectionReference } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = !args.includes('--apply');
const verbose = args.includes('--verbose');
const familyIdArg = args.find((arg, i) => args[i - 1] === '--family');
const familyId = familyIdArg || undefined;

console.log(`
╔════════════════════════════════════════════════════════════════════╗
║  Legacy Pet Box Donation Linkage Migration                         ║
║  Mode: ${dryRun ? 'DRY-RUN (no changes)        ' : 'APPLY (will modify DB)  '}                               ║
${verbose ? '║  Verbosity: VERBOSE                                              ║' : '║  Verbosity: NORMAL                                               ║'}
${familyId ? `║  Family Filter: ${familyId.padEnd(48, ' ')} ║` : '║  Family Filter: (all families)                                   ║'}
║                                                                    ║
║  ⚠️  WARNING: This script performs database operations.            ║
║  Review dry-run output carefully before using --apply              ║
╚════════════════════════════════════════════════════════════════════╝
`);

interface LegacyMatchResult {
  matched: boolean;
  petboxRequestId?: string;
  reason: string;
  matchCount: number;
  diagnostics: {
    fundTxId: string;
    searchCriteria: Record<string, any>;
    matchedIds: string[];
  };
}

interface MigrationRecord {
  fundTxId: string;
  familyId: string;
  fundId: string;
  fromUserId: string;
  amount: number;
  matchResult: LegacyMatchResult;
  shouldUpdate: boolean;
  reason?: string;
}

interface MigrationSummary {
  totalUnmatched: number;
  successfulMatches: number;
  multipleMatches: number;
  noMatches: number;
  updates: MigrationRecord[];
}

// Initialize Firebase Admin
function initializeFirebase() {
  // Look for service account key
  const keyPath = process.env.FIREBASE_KEY_PATH || 
    path.join(process.cwd(), 'firebase-key.json');
  
  if (!fs.existsSync(keyPath)) {
    console.error(`❌ Firebase service account key not found at: ${keyPath}`);
    console.error('Set FIREBASE_KEY_PATH environment variable or place firebase-key.json in project root');
    process.exit(1);
  }

  const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  
  initializeApp({
    credential: cert(serviceAccount),
  });

  return getFirestore();
}

/**
 * Match logic (same as in legacyPetboxMatcher.ts)
 */
function toDate(value: any): Date {
  if (!value) return new Date(0);
  if (value.toDate && typeof value.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  return new Date(value);
}

function findLegacyPetboxRequest(
  fundTxId: string,
  familyId: string,
  fundId: string,
  fromUserId: string,
  amount: number,
  createdAt: any,
  petboxRequests: any[]
): LegacyMatchResult {
  const fundTxCreatedAt = toDate(createdAt);

  const candidates = petboxRequests.filter(req => {
    if (req.familyId !== familyId) return false;
    if (req.fundId !== fundId) return false;
    if (req.childId !== fromUserId) return false;
    
    const reqAmount = typeof req.amountPence === 'number' ? req.amountPence : req.amount;
    if (reqAmount !== amount) return false;
    
    if (req.status !== 'approved') return false;
    
    const reqCreatedAt = toDate(req.createdAt);
    const timeDiff = fundTxCreatedAt.getTime() - reqCreatedAt.getTime();
    if (timeDiff < 0 || timeDiff > 5 * 60 * 1000) return false;
    
    return true;
  });

  const diagnostics = {
    fundTxId,
    searchCriteria: {
      familyId,
      fundId,
      fromUserId,
      amountPence: amount,
      status: 'approved',
    },
    matchedIds: candidates.map(c => c.id),
  };

  if (candidates.length === 0) {
    return {
      matched: false,
      reason: 'No approved petbox_request found matching criteria',
      matchCount: 0,
      diagnostics,
    };
  }

  if (candidates.length > 1) {
    return {
      matched: false,
      reason: `Multiple (${candidates.length}) approved petbox_requests match`,
      matchCount: candidates.length,
      diagnostics,
    };
  }

  return {
    matched: true,
    petboxRequestId: candidates[0].id,
    reason: 'Exactly one match found',
    matchCount: 1,
    diagnostics,
  };
}

/**
 * Main migration function
 */
async function runMigration(): Promise<void> {
  const db = initializeFirebase();
  const summary: MigrationSummary = {
    totalUnmatched: 0,
    successfulMatches: 0,
    multipleMatches: 0,
    noMatches: 0,
    updates: [],
  };

  // Get families to process
  let familiesRef = db.collection('families');
  if (familyId) {
    console.log(`Filtering to family: ${familyId}\n`);
    familiesRef = db.collection('families').where('__name__', '==', familyId) as any;
  }

  const familyDocs = await familiesRef.get();

  if (familyDocs.empty) {
    console.error('❌ No families found');
    process.exit(1);
  }

  console.log(`Found ${familyDocs.size} family/families to process\n`);

  for (const familyDoc of familyDocs.docs) {
    const fid = familyDoc.id;
    console.log(`Processing family: ${fid}`);
    
    // Get all petbox_requests for this family
    const petboxSnap = await db
      .collection(`families/${fid}/petbox_requests`)
      .where('status', '==', 'approved')
      .get();
    
    const petboxRequests = petboxSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    console.log(`  Found ${petboxRequests.length} approved petbox_requests`);

    // Get all fund_transactions without sourceId
    const txnSnap = await db
      .collection(`families/${fid}/fund_transactions`)
      .where('type', '==', 'contribution')
      .get();

    const legacyTxns = txnSnap.docs.filter(d => !d.data().sourceId);
    console.log(`  Found ${legacyTxns.length} legacy contribution transactions (no sourceId)\n`);

    summary.totalUnmatched += legacyTxns.length;

    // Try to match each legacy transaction
    for (const txnDoc of legacyTxns) {
      const tx = txnDoc.data() as any;
      const matchResult = findLegacyPetboxRequest(
        txnDoc.id,
        fid,
        tx.fundId,
        tx.fromUserId,
        tx.amount,
        tx.createdAt,
        petboxRequests
      );

      const record: MigrationRecord = {
        fundTxId: txnDoc.id,
        familyId: fid,
        fundId: tx.fundId,
        fromUserId: tx.fromUserId,
        amount: tx.amount,
        matchResult,
        shouldUpdate: matchResult.matched,
      };

      if (matchResult.matched) {
        summary.successfulMatches++;
        summary.updates.push(record);
      } else if (matchResult.matchCount === 0) {
        summary.noMatches++;
      } else {
        summary.multipleMatches++;
      }

      // Log each record
      if (matchResult.matched) {
        console.log(`  ✓ TX ${txnDoc.id.substring(0, 16)}...`);
        console.log(`    Amount: ${(tx.amount / 100).toFixed(2)} pence`);
        console.log(`    Child: ${tx.fromUserId}`);
        console.log(`    → Matches petbox_request: ${matchResult.petboxRequestId}`);
      } else if (verbose) {
        console.log(`  ✗ TX ${txnDoc.id.substring(0, 16)}...`);
        console.log(`    Amount: ${(tx.amount / 100).toFixed(2)} pence`);
        console.log(`    Child: ${tx.fromUserId}`);
        console.log(`    Reason: ${matchResult.reason}`);
        if (matchResult.diagnostics.matchedIds.length > 0) {
          console.log(`    Candidate IDs: ${matchResult.diagnostics.matchedIds.join(', ')}`);
        }
      }
    }

    console.log('');
  }

  // Print summary
  console.log(`
╔════════════════════════════════════════════════════════════════════╗
║  MIGRATION SUMMARY                                                 ║
╚════════════════════════════════════════════════════════════════════╝
  Total legacy transactions:    ${summary.totalUnmatched}
  Successful matches:           ${summary.successfulMatches}
  Multiple matches (skip):      ${summary.multipleMatches}
  No matches (skip):            ${summary.noMatches}
  
  Transactions to update:       ${summary.updates.length}
`);

  if (summary.updates.length === 0) {
    console.log('No updates needed. All legacy donations are either matched or skipped.\n');
    process.exit(0);
  }

  // Show update details
  console.log('Updates that would be applied:');
  console.log('─'.repeat(70));
  for (const record of summary.updates) {
    console.log(
      `  ${record.fundTxId.substring(0, 20)}... → ${record.matchResult.petboxRequestId}`
    );
  }
  console.log('');

  if (dryRun) {
    console.log(`
⚠️  DRY-RUN MODE: No changes made.

To apply these updates, run:
  npm exec tsx scripts/migrate-legacy-petbox-links.ts --apply ${familyIdArg ? `--family ${familyIdArg}` : ''}

Each update will:
  1. Back up the original fund_transaction
  2. Add sourceId field linking to petbox_request
  3. Add sourceRequestId for audit trail
    `);
    process.exit(0);
  }

  // APPLY MODE
  console.log('Applying updates...\n');

  // Create backup directory
  const backupDir = path.join(process.cwd(), 'backups', `migration-${new Date().toISOString().split('T')[0]}`);
  fs.mkdirSync(backupDir, { recursive: true });
  console.log(`Backup directory: ${backupDir}\n`);

  let successCount = 0;
  let errorCount = 0;

  for (const record of summary.updates) {
    try {
      const { fundTxId, familyId: fid, matchResult } = record;

      // Backup original
      const txnDoc = await db
        .collection(`families/${fid}/fund_transactions`)
        .doc(fundTxId)
        .get();
      
      const backupFile = path.join(
        backupDir,
        `${fid}__fund_transaction__${fundTxId}.json`
      );
      fs.writeFileSync(backupFile, JSON.stringify(txnDoc.data(), null, 2));

      // Update with sourceId
      await db
        .collection(`families/${fid}/fund_transactions`)
        .doc(fundTxId)
        .update({
          sourceId: matchResult.petboxRequestId,
          sourceRequestId: matchResult.petboxRequestId, // For audit
          migratedAt: new Date(),
        });

      successCount++;
      console.log(`✓ Updated: ${fundTxId.substring(0, 16)}...`);
    } catch (err: any) {
      errorCount++;
      console.error(`✗ Failed: ${record.fundTxId.substring(0, 16)}... - ${err.message}`);
    }
  }

  console.log(`
Updated:  ${successCount}
Errors:   ${errorCount}

Backup files stored in: ${backupDir}

All updates complete. Fund transactions are now linked to petbox_requests.
  `);

  process.exit(errorCount > 0 ? 1 : 0);
}

// Run migration
runMigration().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
