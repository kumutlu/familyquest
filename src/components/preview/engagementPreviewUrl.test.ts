/**
 * URL-contract tests for the dev preview.
 *
 * Pins the rules:
 *   - `dev-preview=engagement` MUST survive fixture navigation.
 *   - Building the URL is a pure function: never hand-roll query strings.
 *   - Unrelated existing query params are preserved.
 *   - Unknown fixture ids are passed through verbatim so the renderer can
 *     produce a safe fallback instead of silently dropping the user.
 *   - The marker value `engagement` is the ONLY value that enables the
 *     preview; `engagement=1`, `engagement=true`, missing, etc. all
 *     disable it.
 */

import { describe, expect, it } from 'vitest'
import {
  buildEngagementPreviewUrl,
  DEV_PREVIEW_PARAM,
  FIXTURE_PARAM,
  isDevPreviewQueryActive,
  parseFixtureFromSearch,
} from './engagementPreviewUrl'

describe('engagementPreviewUrl — URL contract', () => {
  it('builds the index URL when no fixture is provided', () => {
    expect(buildEngagementPreviewUrl(null)).toBe('?dev-preview=engagement')
    expect(buildEngagementPreviewUrl(undefined)).toBe('?dev-preview=engagement')
    expect(buildEngagementPreviewUrl('')).toBe('?dev-preview=engagement')
  })

  it('builds a fixture URL while preserving the dev-preview marker', () => {
    expect(buildEngagementPreviewUrl('mystery_ready')).toBe(
      '?dev-preview=engagement&fixture=mystery_ready',
    )
    expect(buildEngagementPreviewUrl('surge')).toBe(
      '?dev-preview=engagement&fixture=surge',
    )
    expect(buildEngagementPreviewUrl('comeback_7d')).toBe(
      '?dev-preview=engagement&fixture=comeback_7d',
    )
  })

  it('switching fixture preserves the marker', () => {
    const current = buildEngagementPreviewUrl('mystery_ready')
    const next = buildEngagementPreviewUrl('surge', { currentSearch: current })
    expect(next).toBe('?dev-preview=engagement&fixture=surge')
  })

  it('returning to the index clears the fixture but keeps the marker', () => {
    const current = buildEngagementPreviewUrl('surge')
    const next = buildEngagementPreviewUrl(null, { currentSearch: current })
    expect(next).toBe('?dev-preview=engagement')
  })

  it('preserves unrelated safe query params when navigating', () => {
    const next = buildEngagementPreviewUrl('mystery_ready', {
      currentSearch: '?ref=qa-toolkit&foo=bar',
    })
    // Order is not pinned; assert by parse.
    const params = new URLSearchParams(next)
    expect(params.get(DEV_PREVIEW_PARAM)).toBe('engagement')
    expect(params.get(FIXTURE_PARAM)).toBe('mystery_ready')
    expect(params.get('ref')).toBe('qa-toolkit')
    expect(params.get('foo')).toBe('bar')
  })

  it('does NOT let fixture navigation drop the dev-preview marker', () => {
    // Even when the caller passes a current search WITHOUT the marker,
    // the builder must re-add it. This is the bug fix.
    const next = buildEngagementPreviewUrl('mystery_ready', {
      currentSearch: '?fixture=stale&other=x',
    })
    const params = new URLSearchParams(next)
    expect(params.get(DEV_PREVIEW_PARAM)).toBe('engagement')
    expect(params.get(FIXTURE_PARAM)).toBe('mystery_ready')
    expect(params.get('other')).toBe('x')
  })

  it('passes an unknown fixture through verbatim so the renderer can show a safe fallback', () => {
    const next = buildEngagementPreviewUrl('does-not-exist', {
      currentSearch: '?dev-preview=engagement',
    })
    const params = new URLSearchParams(next)
    expect(params.get(FIXTURE_PARAM)).toBe('does-not-exist')
    expect(params.get(DEV_PREVIEW_PARAM)).toBe('engagement')
  })

  it('parseFixtureFromSearch returns null when absent or empty', () => {
    expect(parseFixtureFromSearch('')).toBeNull()
    expect(parseFixtureFromSearch('?dev-preview=engagement')).toBeNull()
    expect(parseFixtureFromSearch('?fixture=')).toBeNull()
    expect(parseFixtureFromSearch('?fixture=%20%20')).toBeNull()
  })

  it('parseFixtureFromSearch returns the id when present', () => {
    expect(parseFixtureFromSearch('?fixture=mystery_ready')).toBe('mystery_ready')
    expect(
      parseFixtureFromSearch('?dev-preview=engagement&fixture=surge'),
    ).toBe('surge')
  })

  it('isDevPreviewQueryActive recognises ONLY ?dev-preview=engagement', () => {
    expect(isDevPreviewQueryActive('?dev-preview=engagement')).toBe(true)
    expect(isDevPreviewQueryActive('?dev-preview=engagement&fixture=surge')).toBe(true)
    expect(isDevPreviewQueryActive('')).toBe(false)
    expect(isDevPreviewQueryActive('?dev-preview=1')).toBe(false)
    expect(isDevPreviewQueryActive('?dev-preview=engagement-extra')).toBe(false)
    expect(isDevPreviewQueryActive('?dev-preview=')).toBe(false)
    expect(isDevPreviewQueryActive('?foo=bar')).toBe(false)
  })
})