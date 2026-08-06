'use strict'
/**
 * Shared, safe Firebase Admin initializer for Gate 1 tooling.
 *
 * Uses the modular app API (getApps / initializeApp / getFirestore) from
 * `firebase-admin/app` and `firebase-admin/firestore`. It does NOT rely on the
 * legacy namespace property that exposes the app list, which is not present in
 * the installed module shape and was the root cause of the
 * `Cannot read properties of undefined (reading 'length')` failures.
 *
 * Emulator mode (Gate 1):
 *   - requires FIRESTORE_EMULATOR_HOST (never contacts production)
 *   - never constructs application default credentials
 *   - uses GCLOUD_PROJECT / projectId only as namespace metadata
 *
 * Production mode (preserved, opt-in via `emulator: false`):
 *   - uses application default credentials
 *   - unchanged read/write semantics
 */

const { getApps, initializeApp, applicationDefault } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')

const DEFAULT_PROJECT_ID = 'familyquest-beta-402cb'

/**
 * Initialize (or reuse) the default Firebase Admin app and return a Firestore
 * handle. Safe to call repeatedly: the app is only created when none exists.
 *
 * @param {{ emulator?: boolean }} [opts]
 * @returns {import('firebase-admin/firestore').Firestore}
 */
function initFirestore(opts) {
  opts = opts || {}
  if (opts.emulator) {
    const host = process.env.FIRESTORE_EMULATOR_HOST
    if (!host) {
      throw new Error(
        '--emulator requires FIRESTORE_EMULATOR_HOST to be set (e.g. 127.0.0.1:8080).'
      )
    }
    if (getApps().length === 0) {
      initializeApp({ projectId: process.env.GCLOUD_PROJECT || DEFAULT_PROJECT_ID })
    }
    return getFirestore()
  }
  if (getApps().length === 0) {
    initialize(initializeApp, applicationDefault)
  }
  return getFirestore()
}

// Isolated so the production-only credential path is never exercised in
// emulator mode (applicationDefault is only referenced here).
function initialize(init, cred) {
  init({ credential: cred() })
}

/**
 * Return the projectId of the default app, or null when no app is initialized.
 * @returns {string|null}
 */
function getProjectId() {
  const registered = getApps()
  if (registered.length === 0) return null
  const app = registered[0]
  return (app.options && app.options.projectId) || null
}

module.exports = { initFirestore, getProjectId, DEFAULT_PROJECT_ID }
