'use strict'
// Test-only preload: throws if firebase-admin is ever required. Used by
// scripts/cli-help.test.cjs to prove that --help performs zero Firebase/Admin
// SDK initialization. This file is never required by production tooling.
const Module = require('module')
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'firebase-admin') {
    throw new Error('FIREBASE_GUARD: firebase-admin was required during --help')
  }
  return originalLoad.apply(this, arguments)
}
