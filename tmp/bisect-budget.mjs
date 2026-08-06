/**
 * Expression-budget bisection harness.  READ-ONLY w.r.t. firestore.rules:
 * every variant is built as an in-memory string and handed to the emulator.
 *
 * Two axes the previous investigation never varied:
 *   AXIS 1 (write set) - the penalty commit is ONE request; the 1000-expression
 *                        budget is shared by every document in it. Which
 *                        document is the marginal one?
 *   AXIS 2 (rules)     - which rule edit actually removes the overflow?
 *
 * Run under: firebase emulators:exec --only firestore,auth 'node tmp/bisect-budget.mjs'
 */
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore'
import { readFileSync } from 'node:fs'

const BASE = readFileSync('firestore.rules', 'utf8')
const FAM = 'bisect-family'

/** Replace the heavy 8-type OR-chain create statement with `if false`. */
function stripHeavyLedgerChain(rules) {
  const lines = rules.split('\n')
  const start = lines.findIndex((l) =>
    l.includes("allow create: if familyIsActive(familyId) && ((request.resource.data.type == 'reversal'")
  )
  if (start === -1) throw new Error('heavy chain not found')
  let end = start
  while (end < lines.length && !/\)\)\);\s*$/.test(lines[end])) end++
  lines.splice(start, end - start + 1, '        allow create: if false; // BISECT: heavy chain disabled')
  return lines.join('\n')
}

/** The originally-proposed change: `a == x || a == y`  ->  `a in [x, y]`. */
function applyInOperator(rules) {
  let out = rules.replace(
    "(userDoc.data.get('role', 'null') == 'parent' || userDoc.data.get('role', 'null') == 'owner')",
    "userDoc.data.get('role', 'null') in ['parent', 'owner']"
  )
  out = out.replace(
    "(source.data.role == 'parent' || source.data.role == 'owner')",
    "source.data.role in ['parent', 'owner']"
  )
  if (out === rules) throw new Error('in-operator rewrite matched nothing')
  return out
}

/** Disable the heavy 8-validator wallet-update OR-chain at L1837, keeping the
 *  lean isolated penalty statement at L1850 as the only grant path. */
function stripHeavyWalletChain(rules) {
  const lines = rules.split('\n')
  const start = lines.findIndex((l) =>
    l.includes('allow update: if familyIsActive(familyId) && (') &&
    lines[lines.indexOf(l) + 1]?.includes('isValidDepositCredit')
  )
  if (start === -1) throw new Error('heavy wallet chain not found')
  let end = start
  while (end < lines.length && !/\)\)\);\s*$/.test(lines[end])) end++
  lines.splice(start, end - start + 1, '        allow update: if false; // BISECT: heavy wallet chain disabled')
  return lines.join('\n')
}

const VARIANTS = {
  V0_baseline: BASE,
  V1_no_heavy_ledger_chain: stripHeavyLedgerChain(BASE),
  V2_in_operator_only: applyInOperator(BASE),
  V3_no_heavy_wallet_chain: stripHeavyWalletChain(BASE),
  V4_no_heavy_wallet_chain_plus_in: applyInOperator(stripHeavyWalletChain(BASE)),
}

// Write set grows one document at a time.
const WRITE_SETS = ['wallet', 'wallet+ledger', 'wallet+ledger+event', 'wallet+ledger+event+feed']

async function seed(env) {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const s = ctx.firestore()
    await setDoc(doc(s, `families/${FAM}`), {
      name: 'Bisect', currencyCode: 'GBP', debtLimitPence: -5000, lifecycleState: 'active',
    })
    await setDoc(doc(s, 'users/owner1'), { familyId: FAM, role: 'owner', displayName: 'Owner' })
    await setDoc(doc(s, 'users/child1'), {
      familyId: FAM, role: 'child', displayName: 'Child',
      rewardPoints: 100, lifetimeXP: 0, walletBalance: 0,
    })
    await setDoc(doc(s, `families/${FAM}/wallets/child1`), { balance: 0 })
  })
}

async function attempt(env, writeSet) {
  const db = env.authenticatedContext('owner1').firestore()
  const eventRef = doc(collection(db, `families/${FAM}/behaviour_events`))
  const ledgerRef = doc(collection(db, `families/${FAM}/wallet_transactions`))
  const feedRef = doc(collection(db, `families/${FAM}/family_feed`))
  const walletRef = doc(db, `families/${FAM}/wallets/child1`)
  const reason = 'Because reasons are required here.'
  const snap = {
    schemaVersion: 1, entityType: 'behaviour_event', familyId: FAM,
    actorId: 'owner1', childId: 'child1', pointsDelta: 0,
    walletDeltaPence: -100, xpAdjustment: 0,
  }
  try {
    await runTransaction(db, async (tx) => {
      const w = await tx.get(walletRef)
      const balance = ((w.data()?.balance ?? 0)) - 100
      tx.update(walletRef, { balance, lastPenaltyTxId: ledgerRef.id })
      if (writeSet.includes('ledger')) {
        tx.set(ledgerRef, {
          type: 'financial_penalty', eventId: eventRef.id, sourceId: eventRef.id,
          familyId: FAM, status: 'completed', childId: 'child1', amount: 100, reason,
          createdBy: 'owner1', createdByName: 'Owner', createdAt: serverTimestamp(),
          effectSnapshot: snap,
        })
      }
      if (writeSet.includes('event')) {
        tx.set(eventRef, {
          familyId: FAM, childId: 'child1', type: 'financial', reason,
          pointsDelta: 0, walletDelta: -100, createdBy: 'owner1',
          createdByName: 'Owner', createdAt: serverTimestamp(), effectSnapshot: snap,
        })
      }
      if (writeSet.includes('feed')) {
        tx.set(feedRef, {
          familyId: FAM, type: 'behaviour', childId: 'child1',
          createdBy: 'owner1', createdAt: serverTimestamp(), visibleTo: ['owner1', 'child1'],
        })
      }
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, code: e.code, message: String(e.message || '') }
  }
}

const results = []
for (const [name, rules] of Object.entries(VARIANTS)) {
  const env = await initializeTestEnvironment({
    projectId: `bisect-${name.toLowerCase().replace(/_/g, '-')}`,
    firestore: { rules, host: '127.0.0.1', port: 8080 },
  })
  for (const ws of WRITE_SETS) {
    await seed(env)
    const r = await attempt(env, ws)
    const budget = !r.ok && /maximum of 1000 expressions/i.test(r.message)
    results.push({ variant: name, writeSet: ws, ok: r.ok, budgetOverflow: budget })
    console.log(
      `${name.padEnd(26)} ${ws.padEnd(26)} ${r.ok ? 'ALLOW' : 'DENY '}` +
      `${budget ? '  <-- BUDGET OVERFLOW' : r.ok ? '' : '  (plain denial)'}`
    )
  }
  await env.cleanup()
}

console.log('\n=== summary ===')
for (const v of Object.keys(VARIANTS)) {
  const rs = results.filter((r) => r.variant === v)
  console.log(
    `${v.padEnd(26)} allowed=${rs.filter((r) => r.ok).length}/${rs.length}  ` +
    `budgetOverflows=${rs.filter((r) => r.budgetOverflow).length}`
  )
}
