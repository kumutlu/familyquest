/**
 * Smart Notifications V1 — message catalog safety tests.
 *
 * Pins:
 *   - every catalog entry has ≥1 variant in each supported locale
 *   - no rendered string contains any forbidden phrase (guilt,
 *     threats, fear, financial pressure, loss language)
 *   - placeholder substitution never drops unknown tokens
 *   - pickVariant is deterministic for (messageKey, childId, date)
 *   - deepLinkFor maps every NotificationType to a safe route
 */

import { describe, expect, it } from 'vitest'

import {
  CATALOG,
  FORBIDDEN_PHRASES,
  findCatalogEntry,
  pickVariant,
  renderMessage,
} from './catalog'
import { deepLinkFor } from './delivery'
import type { NotificationType } from './types'

const LOCALES = ['en', 'tr'] as const

const ALL_TYPES: readonly NotificationType[] = [
  'morning_brief',
  'surge',
  'streak',
  'family_progress',
  'seasonal',
  'quest_reminder',
]

describe('Smart Notifications — catalog coverage', () => {
  it('every NotificationType has a catalog entry', () => {
    for (const t of ALL_TYPES) {
      const entries = CATALOG.filter(e => e.type === t)
      expect(entries.length).toBeGreaterThan(0)
    }
  })

  it('every catalog entry has at least one variant per locale', () => {
    for (const entry of CATALOG) {
      for (const locale of LOCALES) {
        expect(entry.variants[locale].length, `${entry.messageKey} ${locale}`).toBeGreaterThan(0)
      }
    }
  })

  it('titles and bodies are non-empty strings', () => {
    for (const entry of CATALOG) {
      for (const locale of LOCALES) {
        for (const variant of entry.variants[locale]) {
          expect(variant.title.trim().length, `${entry.messageKey} ${locale} title`).toBeGreaterThan(0)
          expect(variant.body.trim().length, `${entry.messageKey} ${locale} body`).toBeGreaterThan(0)
        }
      }
    }
  })
})

describe('Smart Notifications — catalog forbidden-phrase safety', () => {
  for (const entry of CATALOG) {
    for (const locale of LOCALES) {
      for (const variant of entry.variants[locale]) {
        const haystack = `${variant.title} ${variant.body}`.toLowerCase()
        for (const forbidden of FORBIDDEN_PHRASES) {
          it(`${entry.messageKey} (${locale}) does not contain forbidden phrase "${forbidden}"`, () => {
            expect(haystack.includes(forbidden), `Forbidden phrase "${forbidden}" found in ${entry.messageKey}/${locale}`).toBe(false)
          })
        }
      }
    }
  }
})

describe('Smart Notifications — renderMessage placeholder behaviour', () => {
  it('substitutes known placeholders', () => {
    expect(renderMessage('Hi {name}, you have {n} quests', { name: 'Ali', n: 3 })).toBe('Hi Ali, you have 3 quests')
  })

  it('leaves unknown placeholders intact (no silent drops)', () => {
    expect(renderMessage('Hi {name}, {weather}', { name: 'Ali' })).toBe('Hi Ali, {weather}')
  })

  it('coerces numbers to strings', () => {
    expect(renderMessage('{n}', { n: 42 })).toBe('42')
  })
})

describe('Smart Notifications — pickVariant determinism', () => {
  it('same (key, childId, localDate) → same variant', () => {
    const a = pickVariant({ messageKey: 'morningBrief.greet', locale: 'en', childId: 'ali', localDate: '2026-08-31' })
    const b = pickVariant({ messageKey: 'morningBrief.greet', locale: 'en', childId: 'ali', localDate: '2026-08-31' })
    expect(a?.body).toBe(b?.body)
    expect(a?.title).toBe(b?.title)
  })

  it('different childIds may yield different variants', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 12; i++) {
      const v = pickVariant({ messageKey: 'morningBrief.greet', locale: 'en', childId: `c-${i}`, localDate: '2026-08-31' })
      if (v) seen.add(v.body)
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('unknown message key → null', () => {
    expect(pickVariant({ messageKey: 'does.not.exist', locale: 'en', childId: 'ali', localDate: '2026-08-31' })).toBeNull()
  })

  it('findCatalogEntry returns the right entry', () => {
    expect(findCatalogEntry('surge.alert')?.type).toBe('surge')
    expect(findCatalogEntry('streak.protect')?.type).toBe('streak')
  })
})

describe('Smart Notifications — deepLinkFor', () => {
  it('every NotificationType has a safe route', () => {
    for (const t of ALL_TYPES) {
      const link = deepLinkFor(t)
      expect(link.startsWith('/')).toBe(true)
      expect(link.includes('?')).toBe(false)
      expect(link.includes('{')).toBe(false)
    }
  })
})