// P0 local emulator repro (READ-ONLY w.r.t. production — uses the existing
// read-only snapshot tmp/p0-prod-snapshot.json, never touches production).
// Goal: demonstrate which conjunct of isValidRedemptionDeduction fails for a
// managed-child auth context, since live tokens are not visible via prod reads.
const fs = require('fs')
const path = require('path')
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing')
const { serverTimestamp, collection, doc } = require('firebase/firestore')

const SNAP = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../tmp/p0-prod-snapshot.json'), 'utf8'))
const FAM = SNAP.familyId
const CHILD = 'vc0iyHVfAcXnXQQbmFkr5HfJEkp2' // Mnalium
const childData = SNAP.users[CHILD]

function revive(value) {
  if (Array.isArray(value)) return value.map(revive)
  if (value && typeof value === 'object') {
    if (typeof value.__timestamp === 'string') return new Date(value.__timestamp)
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = revive(v)
    return out
  }
  return value
}

async function main() {
  const env = await initializeTestEnvironment({
    projectId: 'familyquest-p0-live-repro',
    firestore: { rules: fs.readFileSync(path.resolve(__dirname, '../firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 },
  })

  async function seed(overrideChild) {
    await env.clearFirestore()
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await db.doc(`families/${FAM}`).set(revive(SNAP.family))
      for (const [uid, data] of Object.entries(SNAP.users)) {
        const d = uid === CHILD && overrideChild ? { ...revive(data), ...overrideChild } : revive(data)
        await db.doc(`users/${uid}`).set(d)
      }
      for (const [coll, docs] of Object.entries(SNAP.subcollections)) {
        for (const [id, data] of Object.entries(docs)) {
          await db.doc(`families/${FAM}/${coll}/${id}`).set(revive(data))
        }
      }
    })
  }

  // Pick an affordable active reward
  const rewardEntry = Object.entries(SNAP.subcollections.rewards).find(([, r]) =>
    r.isActive === true && Number(r.cost) > 0 && Number(r.cost) <= Number(childData.rewardPoints))
  const [rewardId, reward] = rewardEntry
  const cost = Number(reward.cost)
  const currentPoints = Number(childData.rewardPoints)

  async function attemptRedeem(label, uid, claims) {
    const db = env.authenticatedContext(uid, claims).firestore()
    try {
      await db.runTransaction(async (tx) => {
        const userRef = doc(db, `users/${CHILD}`)
        const redRef = doc(collection(db, `families/${FAM}/redemptions`))
        await tx.get(userRef)
        tx.update(userRef, { rewardPoints: currentPoints - cost, lastRedemptionId: redRef.id })
        tx.set(redRef, {
          rewardId, userId: CHILD, costPaid: cost, redeemedAt: serverTimestamp(), createdAt: serverTimestamp(),
          status: 'completed', familyId: FAM, sourceId: redRef.id, actorId: CHILD,
          effectSnapshot: { entityType: 'reward_redemption', familyId: FAM, actorId: CHILD, childId: CHILD, rewardId, pointsDelta: -cost },
        })
      })
      console.log(`[${label}] ALLOW`)
      return true
    } catch (e) {
      console.log(`[${label}] DENY  code=${e.code} msg=${e.message.split('\n')[0]}`)
      return false
    }
  }

  // Case A: direct child (customClaims {}) — the snapshot's captured identity
  await seed({})
  await attemptRedeem('A direct-child (snapshot identity)', CHILD, {})

  // Case B: managed child, CORRECT token (childId matches, authUid matches, familyId matches)
  const AUTH_UID = 'auth-uid-for-mnalium'
  await seed({ isManaged: true, authUid: AUTH_UID, requiresPasswordChange: false })
  await attemptRedeem('B managed-child CORRECT token', AUTH_UID,
    { managedChild: true, childId: CHILD, familyId: FAM, role: 'child' })

  // Case C: managed child, MISMATCHED childId claim (token.childId != firestore doc id)
  await seed({ isManaged: true, authUid: AUTH_UID, requiresPasswordChange: false })
  await attemptRedeem('C managed-child MISMATCHED childId', AUTH_UID,
    { managedChild: true, childId: 'WRONG-CHILD-ID', familyId: FAM, role: 'child' })

  await env.cleanup()
  process.exit(0)
}
main().catch(e => { console.error('ERR', e); process.exit(1) })
