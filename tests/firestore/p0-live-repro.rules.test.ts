/**
 * P0 — live "Missing or insufficient permissions" reproduction.
 *
 * Replays the FIVE failing production flows against the emulator using
 *   - the deployed rules (firestore.rules; verified byte-identical to the
 *     ruleset released to production), and
 *   - a READ-ONLY snapshot of real production documents captured by
 *     `scripts/diagnose-permission-denied.cjs`.
 *
 * Every transaction below mirrors `src/lib/api.ts` write-for-write (same paths,
 * same payloads, same order). Each flow is additionally probed write-by-write
 * so the FIRST denied operation, its path, its payload and the Firestore
 * error code/message are printed.
 *
 * The snapshot lives in tmp/ (git-ignored). When it is absent the suite skips
 * rather than silently testing synthetic data.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  type Firestore,
} from 'firebase/firestore'
import { existsSync, readFileSync } from 'node:fs'

import { calculateBehaviourEffect, DEFAULT_DEBT_LIMIT_PENCE } from '../../src/lib/behaviour'
import { effectSnapshot } from '../../src/lib/reversalContracts'

const SNAPSHOT_PATH = 'tmp/p0-prod-snapshot.json'
const hasSnapshot = existsSync(SNAPSHOT_PATH)

interface Snapshot {
  familyId: string
  family: Record<string, unknown>
  users: Record<string, Record<string, unknown>>
  identities: Record<string, { customClaims?: Record<string, unknown> }>
  subcollections: {
    rewards: Record<string, Record<string, unknown>>
    wallets: Record<string, Record<string, unknown>>
    tasks: Record<string, Record<string, unknown>>
  }
}

const snapshot: Snapshot | null = hasSnapshot
  ? (JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as Snapshot)
  : null

/** Restores `{ __timestamp }` markers produced by the capture script. */
function revive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(revive)
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (typeof obj.__timestamp === 'string') return new Date(obj.__timestamp)
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) out[k] = revive(v)
    return out
  }
  return value
}

interface Probe {
  label: string
  path: string
  payload: unknown
  ok: boolean
  code?: string
  message?: string
}

const probes: Probe[] = []

async function probe(
  label: string,
  path: string,
  payload: unknown,
  run: () => Promise<unknown>,
): Promise<Probe> {
  let result: Probe
  try {
    await run()
    result = { label, path, payload, ok: true }
  } catch (e) {
    const err = e as { code?: string; message?: string }
    result = { label, path, payload, ok: false, code: err.code, message: err.message }
  }
  probes.push(result)
  // Instrumentation required by the investigation brief.
  // eslint-disable-next-line no-console
  console.log(
    [
      `[P0] ${result.ok ? 'ALLOW' : 'DENY '} ${label}`,
      `      path    : ${path}`,
      `      payload : ${JSON.stringify(payload)}`,
      result.ok ? '' : `      code    : ${result.code}\n      message : ${result.message}`,
    ]
      .filter(Boolean)
      .join('\n'),
  )
  return result
}

describe.skipIf(!hasSnapshot)('P0 live repro — production data + deployed rules', () => {
  let testEnv: RulesTestEnvironment
  const snap = snapshot as Snapshot
  const FAMILY_ID = snap?.familyId

  // Real production identities.
  const PARENT = 'bTEDZNNEQvZf67Y96bF2yxGNAry1' // Kemal (owner)
  const CHILD = 'vc0iyHVfAcXnXQQbmFkr5HfJEkp2' // Mnalium (child, 400 RP, wallet exists)

  const dbFor = (uid: string): Firestore =>
    testEnv.authenticatedContext(uid, snap.identities[uid]?.customClaims ?? {}).firestore()

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'familyquest-p0-live-repro',
      firestore: {
        // Investigation only: allows evaluating a CANDIDATE rules file without
        // modifying the committed firestore.rules. Defaults to the real file.
        rules: readFileSync(process.env.P0_RULES_FILE || 'firestore.rules', 'utf8'),
        host: '127.0.0.1',
        port: 8080,
      },
    })
  })

  afterAll(async () => {
    await testEnv.cleanup()
    // eslint-disable-next-line no-console
    console.log('[P0] summary:')
    for (const p of probes) {
      // eslint-disable-next-line no-console
      console.log(`  ${p.ok ? 'ALLOW' : 'DENY '} ${p.label} ${p.ok ? '' : `(${p.code})`}`)
    }
  })

  beforeEach(async () => {
    await testEnv.clearFirestore()
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await setDoc(doc(db, `families/${FAMILY_ID}`), revive(snap.family) as object)
      for (const [uid, data] of Object.entries(snap.users)) {
        await setDoc(doc(db, `users/${uid}`), revive(data) as object)
      }
      for (const [coll, docs] of Object.entries(snap.subcollections)) {
        for (const [id, data] of Object.entries(docs)) {
          await setDoc(doc(db, `families/${FAMILY_ID}/${coll}/${id}`), revive(data) as object)
        }
      }
    })
  })

  // -------------------------------------------------------------------------
  // Behaviour flows (parent → child): mirrors api.ts addBehaviourEvent
  // -------------------------------------------------------------------------
  async function behaviourFlow(type: 'positive' | 'negative' | 'financial') {
    const db = dbFor(PARENT)
    const child = revive(snap.users[CHILD]) as Record<string, number | string>
    const wallet = revive(snap.subcollections.wallets[CHILD]) as { balance: number }
    const creatorName = snap.users[PARENT].displayName as string
    const reason = 'Investigation probe reason text'
    const input = {
      type,
      reason,
      pointsDelta: type === 'positive' ? 5 : type === 'negative' ? -5 : 0,
      walletDelta: type === 'financial' ? -100 : 0,
    }
    const effect = calculateBehaviourEffect(
      input,
      {
        rewardPoints: Number(child.rewardPoints ?? 0),
        lifetimeXP: Number(child.lifetimeXP ?? 0),
        walletBalance: wallet?.balance ?? 0,
      },
      (snap.family as { debtLimitPence?: number }).debtLimitPence ?? DEFAULT_DEBT_LIMIT_PENCE,
    )

    const eventRef = doc(collection(db, `families/${FAMILY_ID}/behaviour_events`))
    const ledgerRef =
      type === 'financial' ? doc(collection(db, `families/${FAMILY_ID}/wallet_transactions`)) : null
    const feedRef = doc(collection(db, `families/${FAMILY_ID}/feed`))
    const walletRef = doc(db, `families/${FAMILY_ID}/wallets/${CHILD}`)
    const notifRef = doc(db, `families/${FAMILY_ID}/notifications`, `behaviour_${eventRef.id}`)

    const eventPayload = {
      familyId: FAMILY_ID,
      childId: CHILD,
      type,
      reason,
      pointsDelta: effect.pointsDelta,
      walletDelta: effect.walletDelta,
      createdBy: PARENT,
      createdByName: creatorName,
      createdAt: serverTimestamp(),
      effectSnapshot: effectSnapshot({
        entityType: 'behaviour_event',
        familyId: FAMILY_ID,
        actorId: PARENT,
        childId: CHILD,
        pointsDelta: effect.pointsDelta,
        walletDeltaPence: effect.walletDelta,
      }),
    }
    const feedPayload = {
      type: 'behaviour',
      behaviourType: type,
      reason,
      pointsDelta: effect.pointsDelta,
      walletDelta: effect.walletDelta,
      childId: CHILD,
      actorId: PARENT,
      actorName: creatorName,
      text: `Logged behaviour for ${child.displayName}: ${reason}`,
      createdAt: serverTimestamp(),
      timestamp: serverTimestamp(),
    }
    const notifPayload = {
      familyId: FAMILY_ID,
      type: type === 'positive' ? 'behaviour_positive' : 'behaviour_negative',
      actorId: PARENT,
      recipientIds: [CHILD],
      title: 'Behaviour',
      body: reason,
      metadata: {},
      createdAt: serverTimestamp(),
      entityType: 'behaviour_event',
      entityId: eventRef.id,
      actionUrl: `/family/${CHILD}`,
      dedupeKey: `behaviour_${eventRef.id}`,
    }
    const ledgerPayload = ledgerRef
      ? {
          type: 'financial_penalty',
          eventId: eventRef.id,
          sourceId: eventRef.id,
          familyId: FAMILY_ID,
          status: 'completed',
          childId: CHILD,
          amount: -effect.walletDelta,
          reason,
          createdBy: PARENT,
          createdByName: creatorName,
          createdAt: serverTimestamp(),
          effectSnapshot: effectSnapshot({
            entityType: 'behaviour_event',
            familyId: FAMILY_ID,
            actorId: PARENT,
            childId: CHILD,
            walletDeltaPence: effect.walletDelta,
          }),
        }
      : null

    // 1. Full transaction, exactly as api.ts issues it.
    const full = await probe(
      `behaviour:${type} FULL transaction`,
      `families/${FAMILY_ID}/{behaviour_events,wallets,wallet_transactions,feed,notifications}`,
      { eventPayload, ledgerPayload, feedPayload, notifPayload },
      () =>
        runTransaction(db, async (tx) => {
          await tx.get(doc(db, `families/${FAMILY_ID}`))
          await tx.get(doc(db, `users/${CHILD}`))
          await tx.get(walletRef)
          await tx.get(doc(db, `users/${PARENT}`))
          await tx.get(notifRef)
          if (type === 'financial') {
            tx.update(walletRef, {
              balance: effect.walletBalance,
              lastPenaltyTxId: ledgerRef!.id,
            })
          }
          tx.set(eventRef, eventPayload)
          if (ledgerRef && ledgerPayload) tx.set(ledgerRef, ledgerPayload)
          tx.set(feedRef, feedPayload)
          tx.set(notifRef, notifPayload)
        }),
    )

    // 2. Bisect: isolate each write so the FIRST denied document is identified.
    if (!full.ok) {
      await probe(
        `behaviour:${type} isolated behaviour_events create`,
        eventRef.path,
        eventPayload,
        () => setDoc(doc(dbFor(PARENT), eventRef.path), eventPayload),
      )
      await probe(`behaviour:${type} isolated feed create`, feedRef.path, feedPayload, () =>
        setDoc(doc(dbFor(PARENT), feedRef.path), feedPayload),
      )
      await probe(
        `behaviour:${type} isolated notification create`,
        notifRef.path,
        notifPayload,
        () => setDoc(doc(dbFor(PARENT), notifRef.path), notifPayload),
      )
      if (ledgerRef && ledgerPayload) {
        await probe(
          `behaviour:${type} isolated wallet_transactions create`,
          ledgerRef.path,
          ledgerPayload,
          () => setDoc(doc(dbFor(PARENT), ledgerRef.path), ledgerPayload),
        )
        const walletUpdate = { balance: effect.walletBalance, lastPenaltyTxId: ledgerRef.id }
        // Isolated wallet deduction against the REAL production wallet document.
        const p1 = dbFor(PARENT)
        await probe(
          `behaviour:${type} isolated wallets update (production wallet doc)`,
          walletRef.path,
          walletUpdate,
          () =>
            runTransaction(p1, async (tx) => {
              tx.update(doc(p1, walletRef.path), walletUpdate)
              tx.set(doc(p1, ledgerRef.path), ledgerPayload)
            }),
        )
        // Same write against a MINIMAL wallet document (balance only), which is
        // what the pre-existing emulator suite seeded. Isolates document shape
        // as the variable.
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          await setDoc(doc(ctx.firestore(), walletRef.path), { balance: wallet?.balance ?? 0 })
        })
        const p2 = dbFor(PARENT)
        const ledger2 = doc(collection(p2, `families/${FAMILY_ID}/wallet_transactions`))
        await probe(
          `behaviour:${type} isolated wallets update (minimal wallet doc: balance only)`,
          walletRef.path,
          { balance: effect.walletBalance, lastPenaltyTxId: ledger2.id },
          () =>
            runTransaction(p2, async (tx) => {
              tx.update(doc(p2, walletRef.path), {
                balance: effect.walletBalance,
                lastPenaltyTxId: ledger2.id,
              })
              tx.set(doc(p2, ledger2.path), { ...ledgerPayload, eventId: ledger2.id })
            }),
        )
      }
    }
    return full
  }

  it('flow 1 — parent logs positive behaviour', async () => {
    const r = await behaviourFlow('positive')
    expect(r.ok, `denied: ${r.code} ${r.message}`).toBe(true)
  })

  it('flow 2 — parent logs negative behaviour', async () => {
    const r = await behaviourFlow('negative')
    expect(r.ok, `denied: ${r.code} ${r.message}`).toBe(true)
  })

  it('flow 3 — parent logs financial penalty', async () => {
    const r = await behaviourFlow('financial')
    expect(r.ok, `denied: ${r.code} ${r.message}`).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Flow 4 — child redeems a reward: mirrors api.ts redeemReward
  // -------------------------------------------------------------------------
  it('flow 4 — child redeems a reward', async () => {
    const db = dbFor(CHILD)
    const rewardEntry = Object.entries(snap.subcollections.rewards).find(
      ([, r]) =>
        (r as { isActive?: boolean }).isActive === true &&
        Number((r as { cost?: number }).cost ?? 0) > 0 &&
        Number((r as { cost?: number }).cost ?? 0) <= Number(snap.users[CHILD].rewardPoints ?? 0),
    )
    expect(rewardEntry, 'no affordable active reward in production snapshot').toBeTruthy()
    const [rewardId, reward] = rewardEntry as [string, { cost: number; title: string }]
    const cost = Number(reward.cost)
    const currentPoints = Number(snap.users[CHILD].rewardPoints ?? 0)

    const redemptionRef = doc(collection(db, `families/${FAMILY_ID}/redemptions`))
    const feedRef = doc(collection(db, `families/${FAMILY_ID}/feed`))
    const userRef = doc(db, `users/${CHILD}`)
    const notifRef = doc(
      db,
      `families/${FAMILY_ID}/notifications`,
      `reward_requested_${redemptionRef.id}`,
    )
    const approverIds = Object.entries(snap.users)
      .filter(([, u]) => u.role === 'parent' || u.role === 'owner')
      .map(([uid]) => uid)

    const redemptionPayload = {
      rewardId,
      userId: CHILD,
      costPaid: cost,
      redeemedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      status: 'completed',
      familyId: FAMILY_ID,
      sourceId: redemptionRef.id,
      actorId: CHILD,
      effectSnapshot: effectSnapshot({
        entityType: 'reward_redemption',
        familyId: FAMILY_ID,
        actorId: CHILD,
        childId: CHILD,
        rewardId,
        pointsDelta: -cost,
      }),
    }
    const userUpdate = { rewardPoints: currentPoints - cost, lastRedemptionId: redemptionRef.id }
    const feedPayload = {
      actorId: CHILD,
      text: `Redeemed reward: ${reward.title}`,
      timestamp: serverTimestamp(),
    }
    const notifPayload = {
      familyId: FAMILY_ID,
      type: 'reward_requested',
      actorId: CHILD,
      recipientIds: approverIds,
      title: 'Reward approval needed',
      body: 'probe',
      metadata: {},
      createdAt: serverTimestamp(),
      entityType: 'redemption',
      entityId: redemptionRef.id,
      actionUrl: '/',
      dedupeKey: `reward_requested_${redemptionRef.id}`,
    }

    const full = await probe(
      'redeem FULL transaction',
      `families/${FAMILY_ID}/{redemptions,feed,notifications} + users/${CHILD}`,
      { redemptionPayload, userUpdate, feedPayload, notifPayload },
      () =>
        runTransaction(db, async (tx) => {
          await tx.get(doc(db, `families/${FAMILY_ID}/rewards/${rewardId}`))
          await tx.get(userRef)
          await tx.get(notifRef)
          tx.update(userRef, userUpdate)
          tx.set(redemptionRef, redemptionPayload)
          tx.set(feedRef, feedPayload)
          tx.set(notifRef, notifPayload)
        }),
    )

    if (!full.ok) {
      // The redemption create and the user deduction are mutually dependent
      // (getAfter), so probe the independent documents individually.
      await probe('redeem isolated feed create', feedRef.path, feedPayload, () =>
        setDoc(doc(dbFor(CHILD), feedRef.path), feedPayload),
      )
      await probe('redeem isolated notification create', notifRef.path, notifPayload, () =>
        setDoc(doc(dbFor(CHILD), notifRef.path), notifPayload),
      )
      await probe(
        'redeem pair (redemption + user deduction only)',
        `${redemptionRef.path} + users/${CHILD}`,
        { redemptionPayload, userUpdate },
        () =>
          runTransaction(dbFor(CHILD), async (tx) => {
            const c = dbFor(CHILD)
            await tx.get(doc(c, `users/${CHILD}`))
            tx.update(doc(c, `users/${CHILD}`), userUpdate)
            tx.set(doc(c, redemptionRef.path), redemptionPayload)
          }),
      )
    }
    expect(full.ok, `denied: ${full.code} ${full.message}`).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Flow 5 — child requests money: mirrors api.ts createMoneyRequest
  // -------------------------------------------------------------------------
  it('flow 5 — child requests money from a parent', async () => {
    const db = dbFor(CHILD)
    const reqRef = doc(collection(db, `families/${FAMILY_ID}/money_requests`))
    const feedRef = doc(collection(db, `families/${FAMILY_ID}/feed`))
    const requestPayload = {
      familyId: FAMILY_ID,
      requesterId: CHILD,
      requesterName: snap.users[CHILD].displayName,
      requestedFromId: PARENT,
      requestedFromName: snap.users[PARENT].displayName,
      amountPence: 100,
      message: 'probe',
      status: 'pending',
      createdAt: serverTimestamp(),
    }
    const feedPayload = {
      actorId: CHILD,
      text: 'probe requested £1.00',
      entityType: 'money_request',
      entityId: reqRef.id,
      visibleTo: [CHILD, PARENT],
      timestamp: serverTimestamp(),
    }

    const full = await probe(
      'money-request FULL transaction',
      `families/${FAMILY_ID}/{money_requests,feed}`,
      { requestPayload, feedPayload },
      () =>
        runTransaction(db, async (tx) => {
          await tx.get(doc(db, `users/${CHILD}`))
          await tx.get(doc(db, `users/${PARENT}`))
          tx.set(reqRef, requestPayload)
          tx.set(feedRef, feedPayload)
        }),
    )

    if (!full.ok) {
      await probe(
        'money-request isolated money_requests create',
        reqRef.path,
        requestPayload,
        () => setDoc(doc(dbFor(CHILD), reqRef.path), requestPayload),
      )
      await probe('money-request isolated feed create', feedRef.path, feedPayload, () =>
        setDoc(doc(dbFor(CHILD), feedRef.path), feedPayload),
      )
    }
    expect(full.ok, `denied: ${full.code} ${full.message}`).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Write-set escalation: the penalty commit is authorised as ONE request, so
  // the 1000-expression rules budget is shared by every document in it. This
  // isolates the document whose addition pushes the commit over the limit.
  // -------------------------------------------------------------------------
  it('legacy-shape replica — the passing suite’s exact ids/payloads, run inside this harness', async () => {
    const FAM = 'p0-family'
    await testEnv.clearFirestore()
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const sdb = ctx.firestore()
      await setDoc(doc(sdb, `families/${FAM}`), { name: 'P0 family', currencyCode: 'GBP', debtLimitPence: -5000 })
      await setDoc(doc(sdb, 'users/parent'), { familyId: FAM, role: 'parent', displayName: 'Parent' })
      await setDoc(doc(sdb, 'users/child'), { familyId: FAM, role: 'child', displayName: 'Child', rewardPoints: 100, lifetimeXP: 0, walletBalance: 0 })
      await setDoc(doc(sdb, `families/${FAM}/wallets/child`), { balance: 0 })
    })
    const db = testEnv.authenticatedContext('parent').firestore()
    const eventRef = doc(collection(db, `families/${FAM}/behaviour_events`))
    const ledgerRef = doc(collection(db, `families/${FAM}/wallet_transactions`))
    const walletRef = doc(db, `families/${FAM}/wallets/child`)
    const reason = 'Because reasons are required here.'
    const evt = {
      familyId: FAM,
      childId: 'child',
      type: 'financial',
      reason,
      pointsDelta: 0,
      walletDelta: -100,
      createdBy: 'parent',
      createdByName: 'Parent',
      createdAt: serverTimestamp(),
      effectSnapshot: {
        schemaVersion: 1,
        entityType: 'behaviour_event',
        familyId: FAM,
        actorId: 'parent',
        childId: 'child',
        pointsDelta: 0,
        walletDeltaPence: -100,
        xpAdjustment: 0,
      },
    }
    await probe('legacy replica (expected ALLOW — matches passing suite)', walletRef.path, { balance: -100, lastPenaltyTxId: ledgerRef.id }, () =>
      runTransaction(db, async (tx) => {
        const w = await tx.get(walletRef)
        const balance = ((w.data()?.balance as number) ?? 0) - 100
        tx.update(walletRef, { balance, lastPenaltyTxId: ledgerRef.id })
        tx.set(eventRef, evt)
        tx.set(ledgerRef, {
          type: 'financial_penalty',
          eventId: eventRef.id,
          sourceId: eventRef.id,
          familyId: FAM,
          status: 'completed',
          childId: 'child',
          amount: 100,
          reason,
          createdBy: 'parent',
          createdByName: 'Parent',
          createdAt: serverTimestamp(),
          effectSnapshot: {
            schemaVersion: 1,
            entityType: 'behaviour_event',
            familyId: FAM,
            actorId: 'parent',
            childId: 'child',
            walletDeltaPence: -100,
            xpAdjustment: 0,
          },
        })
      }),
    )
  })

  it('data differential — which stored document makes the minimal penalty commit exceed the budget', async () => {
    // Fixed write set: wallet + behaviour_event + ledger (exactly the shape the
    // passing suite tests/firestore/p0-production-flows.rules.test.ts uses).
    // Only the STORED documents vary, so any difference is data-attributable.
    const minimalFamily = { name: 'P0 family', currencyCode: 'GBP', debtLimitPence: -5000 }
    const stages = [
      { name: 'A minimal family + minimal wallet', prodFamily: false, prodWallet: false, feed: false, notification: false },
      { name: 'B production family + minimal wallet', prodFamily: true, prodWallet: false, feed: false, notification: false },
      { name: 'C minimal family + production wallet', prodFamily: false, prodWallet: true, feed: false, notification: false },
      { name: 'D production family + production wallet', prodFamily: true, prodWallet: true, feed: false, notification: false },
      { name: 'E minimal family + minimal wallet, NO claims arg', prodFamily: false, prodWallet: false, noClaims: true, feed: false, notification: false },
      { name: 'F production family + production wallet, NO claims arg', prodFamily: true, prodWallet: true, noClaims: true, feed: false, notification: false },
      { name: 'G minimal everything + MINIMAL users (role parent)', prodFamily: false, prodWallet: false, minimalUsers: 'parent', feed: false, notification: false },
      { name: 'H minimal everything + MINIMAL users (role owner)', prodFamily: false, prodWallet: false, minimalUsers: 'owner', feed: false, notification: false },
      // Real-world confirmation: identical full production data, only the acting
      // parent differs (Bilge role=parent vs Kemal role=owner).
      { name: 'I FULL production data, actor = Bilge (role parent)', prodFamily: true, prodWallet: true, actor: '2OOwJPIs19PxyCyJbakVSNU1Zyv1', feed: true, notification: true },
      { name: 'J FULL production data, actor = Kemal (role owner)', prodFamily: true, prodWallet: true, actor: 'bTEDZNNEQvZf67Y96bF2yxGNAry1', feed: true, notification: true },
    ] as Array<{ name: string; prodFamily: boolean; prodWallet: boolean; noClaims?: boolean; minimalUsers?: string; actor?: string; feed: boolean; notification: boolean }>
    for (const stage of stages) {
      await testEnv.clearFirestore()
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const sdb = ctx.firestore()
        await setDoc(
          doc(sdb, `families/${FAMILY_ID}`),
          stage.prodFamily ? (revive(snap.family) as object) : minimalFamily,
        )
        if (stage.minimalUsers) {
          await setDoc(doc(sdb, `users/${PARENT}`), {
            familyId: FAMILY_ID,
            role: stage.minimalUsers,
            displayName: snap.users[PARENT].displayName as string,
          })
          await setDoc(doc(sdb, `users/${CHILD}`), {
            familyId: FAMILY_ID,
            role: 'child',
            displayName: snap.users[CHILD].displayName as string,
            rewardPoints: 100,
            lifetimeXP: 0,
            walletBalance: 0,
          })
        } else {
          for (const [uid, data] of Object.entries(snap.users)) {
            await setDoc(doc(sdb, `users/${uid}`), revive(data) as object)
          }
        }
        await setDoc(
          doc(sdb, `families/${FAMILY_ID}/wallets/${CHILD}`),
          stage.prodWallet
            ? (revive(snap.subcollections.wallets[CHILD]) as object)
            : { balance: Number((snap.subcollections.wallets[CHILD] as { balance: number }).balance) },
        )
      })

      const ACTOR = stage.actor ?? PARENT
      const db = stage.noClaims
        ? testEnv.authenticatedContext(ACTOR).firestore()
        : dbFor(ACTOR)
      const eventRef = doc(collection(db, `families/${FAMILY_ID}/behaviour_events`))
      const ledgerRef = doc(collection(db, `families/${FAMILY_ID}/wallet_transactions`))
      const feedRef = doc(collection(db, `families/${FAMILY_ID}/feed`))
      const notifRef = doc(db, `families/${FAMILY_ID}/notifications`, `behaviour_${eventRef.id}`)
      const walletRef = doc(db, `families/${FAMILY_ID}/wallets/${CHILD}`)
      const before = Number((snap.subcollections.wallets[CHILD] as { balance: number }).balance)
      const reason = 'Investigation probe reason text'
      const creatorName = snap.users[ACTOR].displayName as string
      const walletUpdate = { balance: before - 100, lastPenaltyTxId: ledgerRef.id }

      await probe(
        `differential ${stage.name}`,
        `${walletRef.path}`,
        walletUpdate,
        () =>
          runTransaction(db, async (tx) => {
            tx.update(walletRef, walletUpdate)
            tx.set(eventRef, {
              familyId: FAMILY_ID,
              childId: CHILD,
              type: 'financial',
              reason,
              pointsDelta: 0,
              walletDelta: -100,
              createdBy: ACTOR,
              createdByName: creatorName,
              createdAt: serverTimestamp(),
              effectSnapshot: effectSnapshot({
                entityType: 'behaviour_event',
                familyId: FAMILY_ID,
                actorId: ACTOR,
                childId: CHILD,
                pointsDelta: 0,
                walletDeltaPence: -100,
              }),
            })
            tx.set(ledgerRef, {
              type: 'financial_penalty',
              eventId: eventRef.id,
              sourceId: eventRef.id,
              familyId: FAMILY_ID,
              status: 'completed',
              childId: CHILD,
              amount: 100,
              reason,
              createdBy: ACTOR,
              createdByName: creatorName,
              createdAt: serverTimestamp(),
              effectSnapshot: effectSnapshot({
                entityType: 'behaviour_event',
                familyId: FAMILY_ID,
                actorId: ACTOR,
                childId: CHILD,
                walletDeltaPence: -100,
              }),
            })
            if (stage.feed) {
              tx.set(feedRef, {
                type: 'behaviour',
                behaviourType: 'financial',
                reason,
                pointsDelta: 0,
                walletDelta: -100,
                childId: CHILD,
                actorId: ACTOR,
                actorName: creatorName,
                text: 'probe',
                createdAt: serverTimestamp(),
                timestamp: serverTimestamp(),
              })
            }
            if (stage.notification) {
              tx.set(notifRef, {
                familyId: FAMILY_ID,
                type: 'behaviour_negative',
                actorId: ACTOR,
                recipientIds: [CHILD],
                title: 'Behaviour noted',
                body: reason,
                metadata: {},
                createdAt: serverTimestamp(),
                entityType: 'behaviour_event',
                entityId: eventRef.id,
                actionUrl: `/family/${CHILD}`,
                dedupeKey: `behaviour_${eventRef.id}`,
              })
            }
          }),
      )
    }
  })

  // -------------------------------------------------------------------------
  // Identity facts asserted by the rules (uid / claims / role / familyId).
  // -------------------------------------------------------------------------
  it('identity facts used by the rules are present in production data', async () => {
    const db = dbFor(PARENT)
    const parentDoc = await getDoc(doc(db, `users/${PARENT}`))
    expect(parentDoc.exists()).toBe(true)
    expect(parentDoc.data()?.familyId).toBe(FAMILY_ID)
    expect(['parent', 'owner']).toContain(parentDoc.data()?.role)
    expect(snap.identities[PARENT].customClaims ?? {}).toEqual({})
    expect(snap.identities[CHILD].customClaims ?? {}).toEqual({})
  })
})
