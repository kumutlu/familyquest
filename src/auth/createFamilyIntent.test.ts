import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  capturePreAuthCreateFamilySelection,
  clearBoundCreateFamilyIntent,
  clearCreateFamilyIntent,
  CREATE_FAMILY_INTENT_KEY,
  hasCreateFamilyIntent,
  readCreateFamilyIntent,
  startCreateFamilyIntent,
  subscribeCreateFamilyIntent,
} from './createFamilyIntent';

const MINUTE_MS = 60 * 1000;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('create-family intent', () => {
  it('binds an explicit pre-auth create selection to the first authenticated UID', () => {
    capturePreAuthCreateFamilySelection(1_000);

    expect(readCreateFamilyIntent('uid-a', 2_000)).toEqual({
      version: 1,
      kind: 'create-family',
      authUid: 'uid-a',
      createdAt: 1_000,
    });
  });

  it('does not let a second account reuse a pre-auth selection already bound to another UID', () => {
    capturePreAuthCreateFamilySelection(1_000);
    expect(readCreateFamilyIntent('uid-a', 2_000)).not.toBeNull();

    expect(readCreateFamilyIntent('uid-b', 2_001)).toBeNull();
  });

  it('preserves a pre-auth selection during signed-out bootstrap cleanup but clears a bound intent', () => {
    capturePreAuthCreateFamilySelection(1_000);
    clearBoundCreateFamilyIntent();
    expect(readCreateFamilyIntent('uid-a', 2_000)).not.toBeNull();

    clearBoundCreateFamilyIntent();
    expect(readCreateFamilyIntent('uid-a', 2_001)).toBeNull();
  });

  it('stores only the exact UID-bound envelope in session storage', () => {
    startCreateFamilyIntent('uid-a', 1_000);

    expect(JSON.parse(sessionStorage.getItem(CREATE_FAMILY_INTENT_KEY)!)).toEqual({
      version: 1,
      kind: 'create-family',
      authUid: 'uid-a',
      createdAt: 1_000,
    });
    expect(localStorage.getItem(CREATE_FAMILY_INTENT_KEY)).toBeNull();
    expect(readCreateFamilyIntent('uid-a', 2_000)).toEqual({
      version: 1,
      kind: 'create-family',
      authUid: 'uid-a',
      createdAt: 1_000,
    });
  });

  it('expires and clears at exactly thirty minutes', () => {
    startCreateFamilyIntent('uid-a', 1_000);

    expect(readCreateFamilyIntent('uid-a', 1_000 + 30 * MINUTE_MS - 1)).not.toBeNull();
    expect(readCreateFamilyIntent('uid-a', 1_000 + 30 * MINUTE_MS)).toBeNull();
    expect(sessionStorage.getItem(CREATE_FAMILY_INTENT_KEY)).toBeNull();
  });

  it.each([
    '{not-json',
    JSON.stringify({ version: 1, kind: 'create-family', authUid: 'uid-a', createdAt: 1_000, familyId: 'forged' }),
    JSON.stringify({ version: 1, kind: 'create-family', authUid: 'uid-a', createdAt: 2_001 }),
    JSON.stringify({ version: 1, kind: 'unknown', authUid: 'uid-a', createdAt: 1_000 }),
  ])('rejects malformed, unknown-key, future, or wrong-kind storage and cleans it: %s', raw => {
    sessionStorage.setItem(CREATE_FAMILY_INTENT_KEY, raw);

    expect(readCreateFamilyIntent('uid-a', 2_000)).toBeNull();
    expect(sessionStorage.getItem(CREATE_FAMILY_INTENT_KEY)).toBeNull();
  });

  it('clears an intent when a different account tries to read it', () => {
    startCreateFamilyIntent('uid-a', 1_000);

    expect(readCreateFamilyIntent('uid-b', 2_000)).toBeNull();
    expect(sessionStorage.getItem(CREATE_FAMILY_INTENT_KEY)).toBeNull();
  });

  it('fails closed without throwing when session storage is blocked', () => {
    const blockedStorage = {
      getItem: vi.fn(() => { throw new DOMException('blocked'); }),
      setItem: vi.fn(() => { throw new DOMException('blocked'); }),
      removeItem: vi.fn(() => { throw new DOMException('blocked'); }),
    };
    vi.stubGlobal('sessionStorage', blockedStorage);

    expect(() => startCreateFamilyIntent('uid-a', 1_000)).not.toThrow();
    expect(readCreateFamilyIntent('uid-a', 2_000)).toBeNull();
    expect(() => clearCreateFamilyIntent()).not.toThrow();
  });

  it('notifies same-tab subscribers when start and clear change the valid snapshot', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCreateFamilyIntent(listener);

    expect(hasCreateFamilyIntent('uid-a')).toBe(false);
    startCreateFamilyIntent('uid-a', 1_000);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(hasCreateFamilyIntent('uid-a', 2_000)).toBe(true);

    clearCreateFamilyIntent();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(hasCreateFamilyIntent('uid-a', 2_000)).toBe(false);

    unsubscribe();
    startCreateFamilyIntent('uid-a', 3_000);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
