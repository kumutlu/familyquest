/**
 * `engagementPreviewUrl` — single source of truth for the dev preview URL
 * contract.
 *
 * CONTRACT
 * --------
 *   INDEX_URL    = ?dev-preview=engagement
 *   FIXTURE_URL  = ?dev-preview=engagement&fixture=<id>
 *
 * The `dev-preview=engagement` marker MUST survive any fixture navigation
 * performed through this helper. Removing the marker would cause
 * `main.tsx` to fall through to the normal app bootstrap (Firebase Auth,
 * AuthRoutingGate, onboarding, …) which the preview harness is
 * explicitly designed to bypass.
 *
 * The helper is pure and side-effect free: it never touches
 * `window.history` directly. The component that owns the preview is
 * responsible for calling `history.pushState` / `replaceState` with the
 * URL this helper returns.
 *
 * SAFETY
 * ------
 *   - Unknown fixture IDs are passed through verbatim so the renderer
 *     can produce a "safe fallback" surface instead of silently dropping
 *     the user.
 *   - Existing unrelated query params (e.g. `?ref=foo`) are preserved
 *     unless the caller explicitly clears them.
 *   - The marker value `engagement` is the ONLY value that enables the
 *     preview. Any other value (including empty string) is treated as
 *     "preview disabled".
 */

export const DEV_PREVIEW_PARAM = 'dev-preview'
export const DEV_PREVIEW_VALUE = 'engagement'
export const FIXTURE_PARAM = 'fixture'

/** True iff the URL search string carries `?dev-preview=engagement`. */
export function isDevPreviewQueryActive(search: string): boolean {
  const params = parseSearch(search)
  return params.get(DEV_PREVIEW_PARAM) === DEV_PREVIEW_VALUE
}

/**
 * Build the URL the preview should navigate to.
 *
 * @param fixture   Optional fixture id to encode. Pass `null` / `undefined`
 *                  to produce the index URL (marker only, no fixture).
 * @param options.currentSearch  Optional current search string. When
 *                  provided, any unrelated query params present on it are
 *                  preserved.
 */
export function buildEngagementPreviewUrl(
  fixture: string | null | undefined,
  options?: { currentSearch?: string },
): string {
  const params = parseSearch(options?.currentSearch ?? '')
  // Always re-write the marker so callers can never accidentally drop it.
  params.set(DEV_PREVIEW_PARAM, DEV_PREVIEW_VALUE)
  if (fixture === null || fixture === undefined || fixture === '') {
    params.delete(FIXTURE_PARAM)
  } else {
    params.set(FIXTURE_PARAM, fixture)
  }
  return stringifyParams(params)
}

/**
 * Parse the `fixture` query param from a search string. Returns `null`
 * when the param is absent or empty.
 */
export function parseFixtureFromSearch(search: string): string | null {
  const params = parseSearch(search)
  const raw = params.get(FIXTURE_PARAM)
  if (raw === null) return null
  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
}

function parseSearch(search: string): URLSearchParams {
  // Strip a leading "?" so callers can pass either "?a=b" or "a=b".
  const normalized = search.startsWith('?') ? search.slice(1) : search
  return new URLSearchParams(normalized)
}

function stringifyParams(params: URLSearchParams): string {
  const s = params.toString()
  return s === '' ? '' : `?${s}`
}