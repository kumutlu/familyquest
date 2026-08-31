/**
 * Smart Notifications V1 — Firestore Rules tests.
 *
 * Pins the Smart Notifications V1 security contract:
 *   - Parent may write valid `notificationPreferences` (intensity high → low,
 *     enabled toggle, quietHours change, weatherLocation change).
 *   - Child / Outsider cannot write `notificationPreferences`.
 *   - Unknown preference key is denied.
 *   - Invalid intensity (e.g. "max") is denied.
 *   - Invalid HH:mm (e.g. "25:00" or "9:00") is denied.
 *   - Notification setting + protected family field mutation in the same
 *     write is denied.
 *   - `notification_state` is parent/child-readable, server-only-write.
 *   - `notification_delivery` is server-only.
 *
 * Mirrors the spec §4 contract and the closed-shape validator added
 * to firestore.rules for Smart Notifications V1.
 */

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, getDoc } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

const PROJECT_ID = `smart-notifications-rules-${Date.now()}`
let testEnv: RulesTestEnvironment

const FAMILY_ID = 'family-notif'
const OTHER_FAMILY_ID = 'family-other'
const OWNER_ID = 'owner-1'
const PARENT_ID = 'parent-1'
const CHILD_ID = 'child-1'
const OUTSIDER_ID = 'outsider-1'

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  })
})

afterAll(async () => {
  await testEnv?.cleanup()
})

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await setDoc(doc(db, 'families', FAMILY_ID), { name: 'Smart Notifications Family', timezone: 'UTC' })
    await setDoc(doc(db, 'families', OTHER_FAMILY_ID), { name: 'Other Family' })
    await setDoc(doc(db, 'users', OWNER_ID), { uid: OWNER_ID, familyId: FAMILY_ID, role: 'owner' })
    await setDoc(doc(db, 'users', PARENT_ID), { uid: PARENT_ID, familyId: FAMILY_ID, role: 'parent' })
    await setDoc(doc(db, 'users', CHILD_ID), { uid: CHILD_ID, familyId: FAMILY_ID, role: 'child' })
    await setDoc(doc(db, 'users', OUTSIDER_ID), { uid: OUTSIDER_ID, familyId: OTHER_FAMILY_ID, role: 'parent' })
    await setDoc(doc(db, `families/${FAMILY_ID}/users/${PARENT_ID}`), { uid: PARENT_ID, role: 'parent' })
    await setDoc(doc(db, `families/${FAMILY_ID}/users/${OWNER_ID}`), { uid: OWNER_ID, role: 'owner' })
    await setDoc(doc(db, `families/${FAMILY_ID}/users/${CHILD_ID}`), { uid: CHILD_ID, role: 'child' })
  })
})

function notifPrefsValid(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    intensity: 'high',
    quietHours: { start: '20:30', end: '07:00' },
    morningBrief: true,
    weather: true,
    questReminders: true,
    surgeAlerts: true,
    streakAlerts: true,
    familyProgress: true,
    seasonalEvents: true,
    ...overrides,
  }
}

describe('Smart Notifications Rules — parent writes valid notificationPreferences', () => {
  it('parent: high → low is ALLOWED', async () => {
    const db = testEnv.authenticatedContext(PARENT_ID).firestore()
    await assertSucceeds(
      updateDoc(doc(db, `families/${FAMILY_ID}`), {
        notificationPreferences: notifPrefsValid({ intensity: 'low' }),
      }),
    )
  })

  it('parent: enabled true → false is ALLOWED', async () => {
    const db = testEnv.authenticatedContext(PARENT_ID).firestore()
    await assertSucceeds(
      updateDoc(doc(db, `families/${FAMILY_ID}`), {
        notificationPreferences: notifPrefsValid({ enabled: false }),
      }),
    )
  })

  it('parent: quietHours change is ALLOWED', async () => {
    const db = testEnv.authenticatedContext(PARENT_ID).firestore()
    await assertSucceeds(
      updateDoc(doc(db, `families/${FAMILY_ID}`), {
        notificationPreferences: notifPrefsValid({ quietHours: { start: '21:00', end: '08:00' } }),
      }),
    )
  })

  it('parent: weatherLocation with coarse fields is ALLOWED', async () => {
    const db = testEnv.authenticatedContext(PARENT_ID).firestore()
    await assertSucceeds(
      updateDoc(doc(db, `families/${FAMILY_ID}`), {
        notificationPreferences: notifPrefsValid({
          weatherLocation: { countryCode: 'GB', postalArea: 'NG6', city: 'Nottingham', timezone: 'Europe/London' },
        }),
      }),
    )
  })

  it('parent: weatherLocation with lat/lon is DENIED (no precise GPS allowed)', async () => {
    const db = testEnv.authenticatedContext(PARENT_ID).firestore()
    await assertFails(
      updateDoc(doc(db, `families/${FAMILY_ID}`), {
        notificationPreferences: notifPrefsValid({
          weatherLocation: {
            countryCode: 'GB',
            timezone: 'Europe/London',
            lat: 52.95,
            lon: -1.15,
          } as unknown as Record<string, unknown>,
        }),
      }),
    )
  })
})

describe('Smart Notifications Rules — child / outsider denied', () => {
  it('child: notificationPreferences change is DENIED', async () => {
    const db = testEnv.authenticatedContext(CHILD_ID).firestore()
    await assertFails(
      updateDoc(doc(db, `families/${FAMILY_ID}`), {
        notificationPreferences: notifPrefsValid(),
      }),
    )
  })

  it('outsider: notificationPreferences change is DENIED', async () => {
    const db = testEnv.authenticatedContext(OUTSIDER_ID).firestore()
    await assertFails(
      updateDoc(doc(db, `families/${FAMILY_ID}`), {
        notificationPreferences: notifPrefsValid(),
      }),
    )
  })

  it('unauthenticated: notificationPreferences change is DENIED', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(
      updateDoc(doc(db, `families/${FAMILY_ID}`), {
        notificationPreferences: notifPrefsValid(),
      }),
    )
  })
})

describe('Smart Notifications Rules — closed shape enforced', () => {
  it('parent: unknown preference key is DENIED', async () => {
    const db = testEnv.authenticatedContext(PARENT_ID).firestore()
    await assertFails(
      updateDoc(doc(db, `families/${FAMILY_ID}`), {
        notificationPreferences: {
          ...notifPrefsValid(),
          smuggledField: 'evil',
        },
      }),
    )
  })

  it('parent: invalid intensity is DENIED', async () => {
    const db = testEnv.authenticatedContext(PARENT_ID).firestore()
    await assertFails(
      updateDoc(doc(db, `families/${FAMILY_ID}`), {
        notificationPreferences: notifPrefsValid({ intensity: 'max' }),
      }),
    )
  })

  it('parent: invalid HH:mm (25:00) is DENIED', async () => {
    const db = testEnv.authenticatedContext(PARENT_ID).firestore()
    await assertFails(
      updateDoc(doc(db, `families/${FAMILY_ID}`), {
        notificationPreferences: notifPrefsValid({ quietHours: { start: '25:00', end: '07:00' } }),
      }),
    )
  })

  it('parent: invalid HH:mm (9:00 — single-digit hour) is DENIED', async () => {
    const db = testEnv.authenticatedContext(PARENT_ID).firestore()
    await assertFails(
      updateDoc(doc(db, `families/${FAMILY_ID}`), {
        notificationPreferences: notifPrefsValid({ quietHours: { start: '9:00', end: '20:00' } }),
      }),
    )
  })

  it('parent: notification preference + inviteCode mutation in the SAME write is DENIED', async () => {
    const db = testEnv.authenticatedContext(PARENT_ID).firestore()
    await assertFails(
      updateDoc(doc(db, `families/${FAMILY_ID}`), {
        inviteCode: 'ABCDEF',
        notificationPreferences: notifPrefsValid(),
      }),
    )
  })

  it('parent: notification preference + petBoxEnabled mutation in the SAME write is DENIED', async () => {
    const db = testEnv.authenticatedContext(PARENT_ID).firestore()
    await assertFails(
      updateDoc(doc(db, `families/${FAMILY_ID}`), {
        petBoxEnabled: true,
        notificationPreferences: notifPrefsValid(),
      }),
    )
  })

  it('parent: notification preference + lifecycleState mutation in the SAME write is DENIED', async () => {
    const db = testEnv.authenticatedContext(PARENT_ID).firestore()
    await assertFails(
      updateDoc(doc(db, `families/${FAMILY_ID}`), {
        lifecycleState: 'deleting',
        notificationPreferences: notifPrefsValid(),
      }),
    )
  })
})

describe('Smart Notifications Rules — notification_state is server-owned', () => {
  it('parent can READ notification_state', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `families/${FAMILY_ID}/notification_state/${CHILD_ID}`), {
        localDate: '2026-08-31',
        sentCount: 0,
        sentKeys: [],
      })
    })
    const db = testEnv.authenticatedContext(PARENT_ID).firestore()
    await assertSucceeds(getDoc(doc(db, `families/${FAMILY_ID}/notification_state/${CHILD_ID}`)))
  })

  it('child can READ own notification_state', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `families/${FAMILY_ID}/notification_state/${CHILD_ID}`), {
        localDate: '2026-08-31',
        sentCount: 0,
        sentKeys: [],
      })
    })
    const db = testEnv.authenticatedContext(CHILD_ID).firestore()
    await assertSucceeds(getDoc(doc(db, `families/${FAMILY_ID}/notification_state/${CHILD_ID}`)))
  })

  it('sibling CANNOT READ another child notification_state', async () => {
    const SIBLING_ID = 'child-2'
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', SIBLING_ID), { uid: SIBLING_ID, familyId: FAMILY_ID, role: 'child' })
      await setDoc(doc(context.firestore(), `families/${FAMILY_ID}/notification_state/${CHILD_ID}`), {
        localDate: '2026-08-31',
        sentCount: 0,
        sentKeys: [],
      })
    })
    const db = testEnv.authenticatedContext(SIBLING_ID).firestore()
    await assertFails(getDoc(doc(db, `families/${FAMILY_ID}/notification_state/${CHILD_ID}`)))
  })

  it('parent WRITE to notification_state is DENIED', async () => {
    const db = testEnv.authenticatedContext(PARENT_ID).firestore()
    await assertFails(
      setDoc(doc(db, `families/${FAMILY_ID}/notification_state/${CHILD_ID}`), {
        localDate: '2026-08-31',
        sentCount: 1,
        sentKeys: ['surge:surg-1:child-1'],
      }),
    )
  })

  it('child WRITE to own notification_state is DENIED', async () => {
    const db = testEnv.authenticatedContext(CHILD_ID).firestore()
    await assertFails(
      setDoc(doc(db, `families/${FAMILY_ID}/notification_state/${CHILD_ID}`), {
        localDate: '2026-08-31',
        sentCount: 0,
        sentKeys: [],
      }),
    )
  })

  it('outsider WRITE to notification_state is DENIED', async () => {
    const db = testEnv.authenticatedContext(OUTSIDER_ID).firestore()
    await assertFails(
      setDoc(doc(db, `families/${FAMILY_ID}/notification_state/${CHILD_ID}`), {
        localDate: '2026-08-31',
        sentCount: 0,
        sentKeys: [],
      }),
    )
  })
})

describe('Smart Notifications Rules — notification_delivery is server-owned', () => {
  it('parent WRITE to notification_delivery is DENIED', async () => {
    const db = testEnv.authenticatedContext(PARENT_ID).firestore()
    await assertFails(
      setDoc(doc(db, `families/${FAMILY_ID}/notification_delivery/morning_brief:child-1:2026-08-31`), {
        status: 'sent',
        dedupeKey: 'morning_brief:child-1:2026-08-31',
      }),
    )
  })

  it('child WRITE to notification_delivery is DENIED', async () => {
    const db = testEnv.authenticatedContext(CHILD_ID).firestore()
    await assertFails(
      setDoc(doc(db, `families/${FAMILY_ID}/notification_delivery/morning_brief:child-1:2026-08-31`), {
        status: 'sent',
      }),
    )
  })

  it('outsider WRITE to notification_delivery is DENIED', async () => {
    const db = testEnv.authenticatedContext(OUTSIDER_ID).firestore()
    await assertFails(
      setDoc(doc(db, `families/${FAMILY_ID}/notification_delivery/morning_brief:child-1:2026-08-31`), {
        status: 'sent',
      }),
    )
  })
})