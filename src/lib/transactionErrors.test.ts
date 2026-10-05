import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  mapTransactionError,
  classifyThemePurchaseFailure,
  ThemePurchaseError,
  THEME_PURCHASE_FRIENDLY_ERROR,
  PROFILE_UPDATE_FRIENDLY_ERROR,
  GENERIC_TRANSACTION_FRIENDLY_ERROR,
} from './transactionErrors';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mapTransactionError', () => {
  it('maps the transaction-order error to the friendly profile update message', () => {
    const out = mapTransactionError(
      { message: 'Firestore transactions require all reads to be executed before all writes.' },
      { operation: 'submitProfileUpdateRequest' },
    );
    expect(out).toBe(PROFILE_UPDATE_FRIENDLY_ERROR);
    expect(out).not.toMatch(/transaction/i);
  });

  it('maps permission-denied to a child-safe, actionable profile message', () => {
    const out = mapTransactionError(
      { code: 'permission-denied', message: 'Missing or insufficient permissions.' },
      { operation: 'submitProfileUpdateRequest' },
    );
    expect(out).not.toBe(PROFILE_UPDATE_FRIENDLY_ERROR);
    expect(out).toMatch(/parent/i);
    expect(out).not.toContain('permission');
  });

  it('maps failed-precondition to a retry-friendly profile message', () => {
    const out = mapTransactionError(
      { code: 'failed-precondition', message: 'transaction aborted' },
      { operation: 'submitProfileUpdateRequest' },
    );
    expect(out).toMatch(/try again/i);
    expect(out).not.toContain('precondition');
  });

  it('maps unavailable to a connection-friendly profile message', () => {
    const out = mapTransactionError(
      { code: 'unavailable', message: 'backend down' },
      { operation: 'submitProfileUpdateRequest' },
    );
    expect(out).toMatch(/connection|try again/i);
    expect(out).not.toContain('backend down');
  });
  it('falls back to the generic friendly message for unknown codes', () => {
    const out = mapTransactionError(
      { code: 'internal', message: 'boom' },
      { operation: 'submitProfileUpdateRequest' },
    );
    expect(out).toBe(PROFILE_UPDATE_FRIENDLY_ERROR);
  });

  it('falls back to the generic message for other operations', () => {
    const out = mapTransactionError(
      { message: 'Firestore transactions require all reads to be executed before all writes.' },
      { operation: 'someOtherOp' },
    );
    expect(out).toBe(GENERIC_TRANSACTION_FRIENDLY_ERROR);
  });

  it('never exposes the raw internal message', () => {
    const raw = 'Firestore transactions require all reads to be executed before all writes.';
    const out = mapTransactionError({ message: raw }, { operation: 'submitProfileUpdateRequest' });
    expect(out).not.toContain(raw);
  });

  it('logs diagnostics in development only', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // import.meta.env.DEV is true under vitest by default.
    mapTransactionError(
      { code: 'unavailable', message: 'internal', stack: 'stack-trace' },
      { operation: 'submitProfileUpdateRequest', requestId: 'req-1', stage: 'write' },
    );
    expect(spy).toHaveBeenCalled();
    const payload = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.code).toBe('unavailable');
    expect(payload.operation).toBe('submitProfileUpdateRequest');
    expect(payload.requestId).toBe('req-1');
    expect(payload.stage).toBe('write');
    expect(payload.stack).toBe('stack-trace');
  });
});

describe('classifyThemePurchaseFailure', () => {
  it('passes the exact shortfall through for an insufficient balance', () => {
    const out = classifyThemePurchaseFailure(
      new ThemePurchaseError('insufficient-points', 'You need 13 more points to buy this theme.'),
    );
    expect(out.kind).toBe('insufficient-points');
    expect(out.message).toBe('You need 13 more points to buy this theme.');
  });

  it('distinguishes every reason a child can act on', () => {
    expect(classifyThemePurchaseFailure(new ThemePurchaseError('already-owned', 'x')).message)
      .toBe('You already own this theme.');
    expect(classifyThemePurchaseFailure(new ThemePurchaseError('unavailable', 'x')).message)
      .toMatch(/available right now/);
    expect(classifyThemePurchaseFailure(new ThemePurchaseError('not-purchasable', 'x')).message)
      .toMatch(/available right now/);
    expect(classifyThemePurchaseFailure(new ThemePurchaseError('shopping-disabled', 'x')).message)
      .toMatch(/turned off/);
    expect(classifyThemePurchaseFailure(new ThemePurchaseError('managed-profile', 'x')).message)
      .toMatch(/can’t buy themes/);
  });

  it('never leaks a Firebase code or internals to the child', () => {
    const denied = Object.assign(new Error('Missing or insufficient permissions.'), {
      code: 'firestore/permission-denied',
    });
    const out = classifyThemePurchaseFailure(denied);
    expect(out.kind).toBe('unknown');
    expect(out.message).toBe(THEME_PURCHASE_FRIENDLY_ERROR);
    expect(out.message).not.toMatch(/permission|firestore/i);
    // …but the raw cause IS preserved for logging.
    expect(out.technical).toMatch(/insufficient permissions/);
  });

  it('still classifies a shortfall thrown by an older cached bundle', () => {
    const out = classifyThemePurchaseFailure(new Error('You need 13 more points to buy this theme.'));
    expect(out.kind).toBe('insufficient-points');
    expect(out.message).toMatch(/13 more points/);
  });

  it('is what mapTransactionError returns for a theme purchase', () => {
    expect(mapTransactionError(
      new ThemePurchaseError('already-owned', 'You already own this theme.'),
      { operation: 'purchaseShopTheme' },
    )).toBe('You already own this theme.');
  });
});
