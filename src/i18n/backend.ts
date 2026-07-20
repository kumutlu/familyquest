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

function resolveLoader(language: string, namespace: string) {
  return loaders[`./locales/${language}/${namespace}.json`];
}

export class ViteI18nBackend implements BackendModule {
  type = 'backend' as const;

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  init(): void {
    /* no-op: loaders are resolved lazily through import.meta.glob */
  }

  read(language: string, namespace: string, callback: ReadCallback): void {
    const loader = resolveLoader(language, namespace);
    if (!loader) {
      // Unknown language/namespace: let i18next apply its fallback chain.
      callback(null, null);
      return;
    }
    loader()
      .then((mod) => callback(null, mod.default as Record<string, unknown>))
      .catch((err: unknown) => callback(err as Error, null));
  }
}
