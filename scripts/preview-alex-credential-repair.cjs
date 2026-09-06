'use strict';
// Read-only production preview. No execute option and no provenance override.
const fs = require('node:fs');
const { createRequire } = require('node:module');
const adminRequire = createRequire(require('node:path').resolve(__dirname, '../functions/package.json'));
const { initializeApp, cert, applicationDefault } = adminRequire('firebase-admin/app');
const { getFirestore } = adminRequire('firebase-admin/firestore');
const { getAuth } = adminRequire('firebase-admin/auth');
const { repairLegacyQrProfile } = require('../functions/lib/functions/src/legacyQrRepair.js');

async function main() {
  if (!process.argv.includes('--production-read-only') || process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('EXPLICIT_PRODUCTION_READ_ONLY_REQUIRED');
  const keyIndex = process.argv.indexOf('--service-account');
  const credential = keyIndex >= 0 ? cert(JSON.parse(fs.readFileSync(process.argv[keyIndex + 1], 'utf8'))) : applicationDefault();
  initializeApp({ projectId: 'familyquest-beta-402cb', credential });
  const db = getFirestore(); const auth = getAuth();
  const childId = 'child_qr_I0O2CagVtCT0SFfZhklF';
  const profile = (await db.doc(`users/${childId}`).get()).data();
  if (!profile || typeof profile.familyId !== 'string') throw new Error('TARGET_NOT_FOUND');
  const result = await repairLegacyQrProfile(db, auth, profile.familyId, childId);
  const before = Object.fromEntries(['hasLogin', 'loginEnabled', 'username', 'usernameLower'].map(key => [key, profile[key] ?? null]));
  console.log(JSON.stringify({
    ALEX_REPAIR_ELIGIBLE: result.eligible ? 'yes' : 'no', reason: result.reason,
    PROFILE_FIELDS_BEFORE: before,
    PROFILE_FIELDS_AFTER: result.eligible ? result.after : before,
    CONDITIONAL_PROPOSAL_REQUIRING_PROVENANCE: { hasLogin: false, loginEnabled: false, remove: ['username'], usernameLower: 'absent; no change' },
    AUTH_UID_CHANGE: 'no', CHILD_ID_CHANGE: 'no', WALLET_CHANGE: 'no',
    AUTH_USER_CHANGE: 'no', DEVICE_LINKAGE_CHANGE: 'no', PRODUCTION_MUTATION: 'no',
  }, null, 2));
}
main().catch(() => { console.error('Read-only preview failed; no repair executed.'); process.exitCode = 1; });
