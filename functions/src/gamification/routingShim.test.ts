/**
 * Gamification routing shim — production-safe unit tests (TDD-first).
 *
 * The routing shim is the SINGLE decision point the 7 real authoritative
 * writers call. It is pure (no firebase) and fail-closed: the default resolver
 * always returns `legacy`. These tests prove the pre-cutover contract:
 *   - default legacy route for all 7 writers;
 *   - per-family V4 route resolution + family isolation;
 *   - exactly one resolver invocation per operation (no dual write);
 *   - the route is a single value (one source = one authoritative route);
 *   - legacy behaviour is unchanged (route stays legacy);
 *   - rollback (reset to default resolver) returns every route to legacy;
 *   - exactly the 7 declared writers exist (no hidden source).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  resolveWriterRouteSafe,
  requireLegacyRoute,
  setRouteResolver,
  getRouteResolver,
  ALL_WRITERS,
} from './routingShim'
import {
  defaultFeatureFlags,
  withWriterEnabled,
  withWriterDisabled,
  withAllV4,
  flagRouteResolver,
  legacyRouteResolver,
  type GamificationWriter,
} from '../../../src/domain/gamification/v4/featureFlags'

const FAM_A = 'fam-A'
const FAM_B = 'fam-B'

const EXPECTED_WRITERS: readonly GamificationWriter[] = [
  'task_approval',
  'task_invalidation',
  'day_finalization',
  'behaviour',
  'reward_redemption',
  'challenge_claim',
  'avatar_unlock',
]

afterEach(() => {
  // Always reset to the fail-closed default between tests.
  setRouteResolver(undefined)
})

describe('routing shim — default is legacy for all 7 writers', () => {
  it('resolves every declared writer to legacy by default (fail closed)', async () => {
    expect(ALL_WRITERS).toHaveLength(7)
    for (const writer of ALL_WRITERS) {
      expect(await resolveWriterRouteSafe(writer, FAM_A)).toBe('legacy')
    }
  })

  it('requireLegacyRoute never throws under the default resolver', async () => {
    for (const writer of ALL_WRITERS) {
      await expect(requireLegacyRoute(writer, FAM_A)).resolves.toBeUndefined()
    }
  })
})

describe('routing shim — per-family V4 resolution + family isolation', () => {
  it('routes a per-family-enabled writer to v4 only for that family', async () => {
    setRouteResolver(flagRouteResolver(withWriterEnabled(defaultFeatureFlags(), 'behaviour', FAM_A)))
    expect(await resolveWriterRouteSafe('behaviour', FAM_A)).toBe('v4')
    expect(await resolveWriterRouteSafe('behaviour', FAM_B)).toBe('legacy')
    // Other writers stay legacy everywhere.
    expect(await resolveWriterRouteSafe('task_approval', FAM_A)).toBe('legacy')
    expect(await resolveWriterRouteSafe('avatar_unlock', FAM_B)).toBe('legacy')
  })

  it('global v4 enablement routes every family, and a family override can disable one', async () => {
    setRouteResolver(flagRouteResolver(withAllV4()))
    expect(await resolveWriterRouteSafe('reward_redemption', FAM_A)).toBe('v4')
    expect(await resolveWriterRouteSafe('reward_redemption', FAM_B)).toBe('v4')
    // Override FAM_B back to legacy for this writer.
    setRouteResolver(flagRouteResolver(withWriterDisabled(withAllV4(), 'reward_redemption', FAM_B)))
    expect(await resolveWriterRouteSafe('reward_redemption', FAM_B)).toBe('legacy')
    expect(await resolveWriterRouteSafe('reward_redemption', FAM_A)).toBe('v4')
  })
})

describe('routing shim — one invocation per operation (no dual write)', () => {
  it('invokes the resolver exactly once and returns a single route', async () => {
    const spy = vi.fn(legacyRouteResolver().resolve)
    setRouteResolver({ resolve: spy })
    const route = await resolveWriterRouteSafe('reward_redemption', FAM_A)
    expect(route).toBe('legacy')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('reward_redemption', FAM_A)
    // The route is a single scalar, never an array (no dual/shadow write).
    expect(typeof route).toBe('string')
    expect(['legacy', 'v4']).toContain(route)
  })
})

describe('routing shim — legacy behaviour unchanged', () => {
  it('the active resolver defaults to legacy and is replaceable for tests', async () => {
    expect(getRouteResolver()).toBeDefined()
    setRouteResolver(flagRouteResolver(withAllV4()))
    expect(await resolveWriterRouteSafe('behaviour', FAM_A)).toBe('v4')
    // Resetting to undefined restores the fail-closed default.
    setRouteResolver(undefined)
    expect(await resolveWriterRouteSafe('behaviour', FAM_A)).toBe('legacy')
  })
})

describe('routing shim — rollback returns all routes to legacy', () => {
  it('reset to the default resolver flips every route back to legacy', async () => {
    setRouteResolver(flagRouteResolver(withAllV4()))
    expect(await resolveWriterRouteSafe('behaviour', FAM_A)).toBe('v4')
    // Rollback: reset the active resolver to the fail-closed default.
    setRouteResolver(undefined)
    for (const writer of ALL_WRITERS) {
      expect(await resolveWriterRouteSafe(writer, FAM_A)).toBe('legacy')
    }
  })
})

describe('routing shim — no hidden writer source', () => {
  it('enumerates exactly the 7 declared authoritative writers', () => {
    expect([...ALL_WRITERS].sort()).toEqual([...EXPECTED_WRITERS].sort())
  })
})
