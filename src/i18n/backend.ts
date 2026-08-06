import type { BackendModule, ReadCallback } from 'i18next';

/**
 * Lazy namespace loader backed by Vite's `import.meta.glob`.
 *
 * Every `locales/<lng>/<ns>.json` is turned into a code-split dynamic import,
 * so a namespace is only fetched/parsed the first time it is actually used
 * (via `useTranslation('<ns>')` or `i18n.loadNamespaces`). This keeps the
 * initial bundle small and makes "lazy namespaces" a first-class capability.
 */
const loaders = import.meta.glob('./locales/*/*.json', {
  eager: false,
}) as Record<string, () => Promise<{ default: Record<string, unknown> }>>;

export type NamespaceLoader = () => Promise<{ default: Record<string, unknown> }>;
export type LoaderResolver = (language: string, namespace: string) => NamespaceLoader | undefined;

function resolveLoader(language: string, namespace: string): NamespaceLoader | undefined {
  return loaders[`./locales/${language}/${namespace}.json`];
}

/**
 * Bounded retry policy for transient dynamic-import failures (flaky network,
 * a chunk momentarily unavailable behind a CDN). A single failure must never
 * leave a namespace permanently broken for the rest of the session, but we
 * also never loop indefinitely and never swallow a genuine failure.
 */
export const MAX_LOAD_ATTEMPTS = 3;
export const RETRY_BASE_DELAY_MS = 150;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ViteI18nBackend implements BackendModule {
  type = 'backend' as const;

  // The resolver is injectable purely so the retry policy can be unit tested
  // without depending on real dynamic imports. Production always uses the
  // `import.meta.glob` map.
  private readonly resolve: LoaderResolver;

  constructor(resolve: LoaderResolver = resolveLoader) {
    this.resolve = resolve;
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  init(): void {
    /* no-op: loaders are resolved lazily through import.meta.glob */
  }

  read(language: string, namespace: string, callback: ReadCallback): void {
    const loader = this.resolve(language, namespace);
    if (!loader) {
      // Unknown language/namespace: let i18next apply its fallback chain.
      callback(null, null);
      return;
    }

    // `callback` must be invoked exactly once, whatever happens below.
    let settled = false;
    const settle = (err: Error | null, data: Record<string, unknown> | null) => {
      if (settled) return;
      settled = true;
      callback(err, data);
    };

    void (async () => {
      let firstError: Error | null = null;
      for (let attempt = 1; attempt <= MAX_LOAD_ATTEMPTS; attempt += 1) {
        try {
          const mod = await loader();
          settle(null, mod.default as Record<string, unknown>);
          return;
        } catch (err: unknown) {
          const error = err instanceof Error ? err : new Error(String(err));
          // Report the original (most useful) error on final failure.
          firstError ??= error;
          if (attempt < MAX_LOAD_ATTEMPTS) {
            await delay(RETRY_BASE_DELAY_MS * attempt);
          }
        }
      }
      settle(firstError ?? new Error(`Failed to load ${language}/${namespace}`), null);
    })();
  }
}
