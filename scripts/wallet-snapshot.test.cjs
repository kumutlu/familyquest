#!/usr/bin/env node
'use strict'
// Wallet snapshot — focused hashing tests (Task 0.4). Synthetic fixtures only.
const assert = require('assert')
const ws = require('./wallet-snapshot.cjs')

function runTests() {
  const tests = []
  const add = (name, fn) => tests.push({ name, fn })
  add('key-order independent hash', () => { assert.strictEqual(ws.hashData({ a: 1, b: 2 }), ws.hashData({ b: 2, a: 1 })) })
  add('document-order independent global hash', () => {
    const e1 = [
      { collectionPath: 'families/F1/wallets', docPath: 'families/F1/wallets/C1', data: { balance: 10 } },
      { collectionPath: 'families/F1/wallets', docPath: 'families/F1/wallets/C2', data: { balance: 20 } },
    ]
    assert.strictEqual(ws.buildManifest(e1).globalSha256, ws.buildManifest([e1[1], e1[0]]).globalSha256)
  })
  add('changed value fails verification', () => {
    const m = ws.buildManifest([{ collectionPath: 'c', docPath: 'c/d1', data: { balance: 10 } }])
    const r = ws.verifyManifest(m, [{ collectionPath: 'c', docPath: 'c/d1', data: { balance: 11 } }])
    assert.strictEqual(r.ok, false)
    assert.strictEqual(r.mismatches[0].type, 'modified')
  })
  add('added document fails verification', () => {
    const m = ws.buildManifest([{ collectionPath: 'c', docPath: 'c/d1', data: { x: 1 } }])
    const r = ws.verifyManifest(m, [{ collectionPath: 'c', docPath: 'c/d1', data: { x: 1 } }, { collectionPath: 'c', docPath: 'c/d2', data: { x: 2 } }])
    assert.strictEqual(r.ok, false)
    assert.strictEqual(r.mismatches[0].type, 'added')
  })
  add('deleted document fails verification', () => {
    const m = ws.buildManifest([{ collectionPath: 'c', docPath: 'c/d1', data: { x: 1 } }, { collectionPath: 'c', docPath: 'c/d2', data: { x: 2 } }])
    const r = ws.verifyManifest(m, [{ collectionPath: 'c', docPath: 'c/d1', data: { x: 1 } }])
    assert.strictEqual(r.ok, false)
    assert.strictEqual(r.mismatches[0].type, 'deleted')
  })
  add('timestamp normalises deterministically', () => {
    const a = { _seconds: 1700000000, _nanoseconds: 123 }
    const b = { _seconds: 1700000000, _nanoseconds: 123, extra: 'ignored' }
    assert.strictEqual(ws.hashData({ t: a }), ws.hashData({ t: b }))
    assert.notStrictEqual(ws.hashData({ t: a }), ws.hashData({ t: { _seconds: 1700000001, _nanoseconds: 0 } }))
  })
  add('nested maps and arrays normalise deterministically', () => {
    const a = { m: { x: 1, y: [3, 2, 1] }, z: 'k' }
    const b = { z: 'k', m: { y: [3, 2, 1], x: 1 } }
    assert.strictEqual(ws.hashData(a), ws.hashData(b))
    assert.notStrictEqual(ws.hashData({ y: [1, 2] }), ws.hashData({ y: [2, 1] }))
  })
  add('no sensitive values in report output', () => {
    const m = ws.buildManifest([{ collectionPath: 'families/F1/wallets', docPath: 'families/F1/wallets/C1', data: { balance: 12345 } }])
    const r = ws.verifyManifest(m, [{ collectionPath: 'families/F1/wallets', docPath: 'families/F1/wallets/C1', data: { balance: 99999 } }])
    const report = ws.formatReport(r.mismatches)
    assert.strictEqual(r.ok, false)
    assert.ok(report.indexOf('12345') === -1 && report.indexOf('99999') === -1)
    assert.ok(report.indexOf('MODIFIED') !== -1 && report.indexOf('families/F1/wallets/C1') !== -1)
  })
  add('write methods are forbidden on read-only adapter', () => {
    const fakeDb = { collection: () => ({ doc: () => ({}), get: () => Promise.resolve({ docs: [] }), where: () => ({}), orderBy: () => ({}), limit: () => ({}) }), doc: () => ({}) }
    const ro = new ws.ReadOnlyFirestore(fakeDb)
    const forbidden = [() => ro.collection('x').doc('y').set({}), () => ro.collection('x').doc('y').update({}), () => ro.collection('x').doc('y').delete({}), () => ro.collection('x').add({}), () => ro.batch(), () => ro.runTransaction(), () => ro.bulkWriter()]
    for (const fn of forbidden) assert.throws(fn, /forbidden/i)
  })
  add('gamification-only changes do not affect wallet hash', () => {
    const mk = (bal, rp) => ({ walletBalance: bal, rewardPoints: rp, lifetimeXP: 9, currentStreak: 3 })
    const e1 = [{ collectionPath: 'users', docPath: 'users/U1', data: ws.projectUserWalletFields(mk(100, 50)) }]
    const m1 = ws.buildManifest(e1)
    const e2 = [{ collectionPath: 'users', docPath: 'users/U1', data: ws.projectUserWalletFields(mk(100, 999)) }]
    assert.strictEqual(m1.globalSha256, ws.buildManifest(e2).globalSha256)
    const e3 = [{ collectionPath: 'users', docPath: 'users/U1', data: ws.projectUserWalletFields(mk(200, 50)) }]
    assert.notStrictEqual(m1.globalSha256, ws.buildManifest(e3).globalSha256)
  })
  let passed = 0
  for (const t of tests) { t.fn(); passed += 1 }
  console.log('WALLET-SNAPSHOT TESTS PASSED (' + passed + '/' + tests.length + ')')
}

if (require.main === module) {
  try { runTests() } catch (e) { console.error('TEST FAILED: ' + e.message); process.exit(1) }
}
module.exports = { runTests }
