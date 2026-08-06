import { describe, expect, it, vi } from 'vitest';
import { ViteI18nBackend, MAX_LOAD_ATTEMPTS, type NamespaceLoader } from './backend';

/**
 * Durability contract for lazy namespace loading.
 *
 * A single transient dynamic-import failure (flaky network / momentarily
 * missing chunk) must NOT leave a namespace permanently broken for the session,
 * which is what produced raw keys such as `send.title` in production.
 */
function readOnce(backend: ViteI18nBackend, language = 'en', namespace = 'wallet') {
  return new Promise<{ err: unknown; data: unknown; calls: number }>((resolve) => {
    let calls = 0;
    let last: { err: unknown; data: unknown } = { err: null, data: null };
    backend.read(language, namespace, (err, data) => {
      calls += 1;
      last = { err, data };
      // Give any (incorrect) extra callback a chance to be observed.
      setTimeout(() => resolve({ ...last, calls }), 50);
    });
  });
}

describe('ViteI18nBackend bounded retry', () => {
  it('recovers when an import fails once and succeeds on retry', async () => {
    const loader = vi
      .fn<NamespaceLoader>()
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValue({ default: { send: { title: 'Send Money' } } });

    const backend = new ViteI18nBackend(() => loader);
    const result = await readOnce(backend);

    expect(loader).toHaveBeenCalledTimes(2);
    expect(result.err).toBeNull();
    expect(result.data).toEqual({ send: { title: 'Send Money' } });
    expect(result.calls).toBe(1);
  });

  it('gives up after a bounded number of attempts and reports the original error', async () => {
    const original = new Error('permanent failure');
    const loader = vi.fn<NamespaceLoader>().mockRejectedValue(original);

    const backend = new ViteI18nBackend(() => loader);
    const result = await readOnce(backend);

    expect(loader).toHaveBeenCalledTimes(MAX_LOAD_ATTEMPTS);
    expect(MAX_LOAD_ATTEMPTS).toBeLessThanOrEqual(3);
    expect(result.err).toBe(original);
    expect(result.data).toBeNull();
  });

  it('invokes the callback exactly once (success and permanent failure)', async () => {
    const ok = new ViteI18nBackend(() => () => Promise.resolve({ default: { a: 1 } }));
    const bad = new ViteI18nBackend(() => () => Promise.reject(new Error('nope')));

    expect((await readOnce(ok)).calls).toBe(1);
    expect((await readOnce(bad)).calls).toBe(1);
  });

  it('does not retry an unknown namespace and defers to the fallback chain', async () => {
    const backend = new ViteI18nBackend(() => undefined);
    const result = await readOnce(backend, 'en', 'does-not-exist');
    expect(result.err).toBeNull();
    expect(result.data).toBeNull();
    expect(result.calls).toBe(1);
  });
});
