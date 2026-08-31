/**
 * Smart Notifications V1 — curated message catalog.
 *
 * No runtime AI. No template strings the resolver chooses from at
 * runtime. Every string is a frozen constant, hand-authored, with safe
 * variable substitution. Catalog safety tests pin every key against
 * forbidden content (guilt, threats, fear, financial pressure,
 * manipulative loss language).
 *
 * Tone: playful, positive, concise, non-shaming.
 *
 * The catalog is keyed by `${messageKey}.${variant}`; variants are
 * picked deterministically from the variant count so a single family
 * sees different copy across days without sacrificing determinism.
 */

import type { NotificationType } from './types'

export type Locale = 'en' | 'tr'

export interface MessageVariant {
  readonly title: string
  readonly body: string
}

/** A catalog entry holds N deterministic variants per locale. */
export interface CatalogEntry {
  readonly messageKey: string
  readonly type: NotificationType
  readonly variants: Readonly<Record<Locale, readonly MessageVariant[]>>
}

/** Forbidden words / phrases. The catalog safety test asserts that no
 *  rendered string contains any of these substrings (case-insensitive,
 *  whole-word boundaries relaxed for short tokens). */
export const FORBIDDEN_PHRASES: readonly string[] = Object.freeze([
  'disappointed',
  'embarrass',
  'ashamed',
  'shame',
  'guilt',
  'punish',
  'die',          // streak-die language
  'lose everything',
  'gone forever',
  'right now',
  'immediately',
  'or else',
  'pay',
  'cost you',
  'money',
  'wasted',
])

export const MORNING_BRIEF: CatalogEntry = Object.freeze({
  messageKey: 'morningBrief.greet',
  type: 'morning_brief',
  variants: Object.freeze({
    en: Object.freeze([
      { title: 'Good morning, {name}!', body: '{weatherSummary} You have {questsRemaining} quests waiting today.' },
      { title: 'Morning {name}!', body: '{weatherSummary} {questsRemaining} quests are ready when you are.' },
    ]),
    tr: Object.freeze([
      { title: 'Günaydın {name}!', body: '{weatherSummary} Bugün seni bekleyen {questsRemaining} görevin var.' },
      { title: 'Hayırlı sabahlar {name}!', body: '{weatherSummary} Hazır olduğunda {questsRemaining} görev seni bekliyor.' },
    ]),
  }),
})

export const STREAK_PROTECT: CatalogEntry = Object.freeze({
  messageKey: 'streak.protect',
  type: 'streak',
  variants: Object.freeze({
    en: Object.freeze([
      { title: 'Keep your streak going', body: 'One more quest can keep your {streak}-day streak going.' },
      { title: 'A small step counts', body: 'One quest today keeps your {streak}-day streak in your pocket.' },
    ]),
    tr: Object.freeze([
      { title: 'Seriyi koru', body: 'Bir görev daha, {streak} günlük serini koruyabilir.' },
      { title: 'Küçük bir adım yeter', body: 'Bugünkü bir görev, {streak} günlük serini cebinde tutar.' },
    ]),
  }),
})

export const SURGE_ALERT: CatalogEntry = Object.freeze({
  messageKey: 'surge.alert',
  type: 'surge',
  variants: Object.freeze({
    en: Object.freeze([
      { title: 'SURGE — {taskTitle}', body: '+{bonusPoints} bonus for {minutesRemaining} more minutes.' },
      { title: 'Bonus time', body: '{taskTitle} is worth +{bonusPoints} bonus for {minutesRemaining} minutes.' },
    ]),
    tr: Object.freeze([
      { title: 'SURGE — {taskTitle}', body: '+{bonusPoints} bonus, {minutesRemaining} dakika daha geçerli.' },
      { title: 'Bonus zamanı', body: '{taskTitle} şu an +{bonusPoints} bonus değerinde, {minutesRemaining} dakikan var.' },
    ]),
  }),
})

export const FAMILY_PROGRESS_NEAR_COMPLETE: CatalogEntry = Object.freeze({
  messageKey: 'familyProgress.nearComplete',
  type: 'family_progress',
  variants: Object.freeze({
    en: Object.freeze([
      { title: 'Family goal in sight', body: 'Your family is at {percent}%. One quest from you could finish today\u2019s goal.' },
      { title: 'Almost there together', body: '{percent}% of today\u2019s family goal is done. One more from you and you cross the line.' },
    ]),
    tr: Object.freeze([
      { title: 'Aile hedefi göründü', body: 'Ailen bugünün {percent}% kadarını tamamladı. Bir görevle bugünkü hedefe ulaşabilirsiniz.' },
      { title: 'Birlikte neredeyse oldu', body: 'Aile hedefinin {percent}% tamam. Senden bir görev daha, hedefe ulaşıyor.' },
    ]),
  }),
})

export const SEASONAL_NEW_DISCOVERY: CatalogEntry = Object.freeze({
  messageKey: 'seasonal.newDiscovery',
  type: 'seasonal',
  variants: Object.freeze({
    en: Object.freeze([
      { title: 'Something new appeared', body: '{name} is waiting for you in your family world today.' },
      { title: 'A small surprise', body: 'Look around — {name} showed up in your family world.' },
    ]),
    tr: Object.freeze([
      { title: 'Yeni bir şey belirdi', body: 'Aile dünyanda bugün {name} seni bekliyor.' },
      { title: 'Küçük bir sürpriz', body: 'Etrafa bak — aile dünyanda {name} göründü.' },
    ]),
  }),
})

export const QUEST_REMINDER_WAITING: CatalogEntry = Object.freeze({
  messageKey: 'questReminder.waiting',
  type: 'quest_reminder',
  variants: Object.freeze({
    en: Object.freeze([
      { title: 'Quests waiting', body: '{name}, you still have {questsRemaining} quests waiting today.' },
      { title: 'Whenever you are ready', body: 'No rush — {questsRemaining} quests are still on the board for you, {name}.' },
    ]),
    tr: Object.freeze([
      { title: 'Görevler bekliyor', body: '{name}, bugün hâlâ {questsRemaining} görevin var.' },
      { title: 'Hazır olduğunda', body: 'Acele yok — {name}, bugün için {questsRemaining} görev hâlâ seni bekliyor.' },
    ]),
  }),
})

export const CATALOG: readonly CatalogEntry[] = Object.freeze([
  MORNING_BRIEF,
  STREAK_PROTECT,
  SURGE_ALERT,
  FAMILY_PROGRESS_NEAR_COMPLETE,
  SEASONAL_NEW_DISCOVERY,
  QUEST_REMINDER_WAITING,
])

const CATALOG_BY_KEY = new Map(CATALOG.map(e => [e.messageKey, e]))

export function findCatalogEntry(messageKey: string): CatalogEntry | null {
  return CATALOG_BY_KEY.get(messageKey) ?? null
}

/** Pick a deterministic variant for a (child, day, messageKey) triple.
 *  Same triple → same variant. Different days → different variants. */
export function pickVariant(args: {
  messageKey: string
  locale: Locale
  childId: string
  localDate: string
}): MessageVariant | null {
  const entry = findCatalogEntry(args.messageKey)
  if (!entry) return null
  const variants = entry.variants[args.locale]
  if (variants.length === 0) return null
  const seed = hashString(`${args.messageKey}|${args.childId}|${args.localDate}`)
  return variants[seed % variants.length]
}

function hashString(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}

/** Substitute `{name}`-style placeholders. Unknown placeholders are
 *  left as-is so we never silently drop user-visible text. */
export function renderMessage(
  template: string,
  variables: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const v = variables[key]
    if (v === undefined) return match
    return String(v)
  })
}