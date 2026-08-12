import { describe, expect, it } from 'vitest'
import { firebaseReservedNavigationDenylist } from '../pwaNavigation.js'

const isHandledBySpaFallback = (pathname: string) =>
  !firebaseReservedNavigationDenylist.some((pattern) => pattern.test(pathname))

describe('PWA navigation fallback boundaries', () => {
  it.each([
    '/__/auth/handler',
    '/__/auth/iframe',
    '/__/auth/callback',
    '/__/firebase/init.js',
    '/__/firebase/init.json',
    '/__/functions/example',
  ])('excludes Firebase Hosting reserved route %s', (pathname) => {
    expect(isHandledBySpaFallback(pathname)).toBe(false)
  })

  it.each(['/', '/login', '/dashboard'])('preserves SPA fallback for %s', (pathname) => {
    expect(isHandledBySpaFallback(pathname)).toBe(true)
  })
})
