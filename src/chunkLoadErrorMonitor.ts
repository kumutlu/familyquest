import { logStartupDiagnostic } from './startupDiagnostics';

// Substrings that identify a JavaScript/module chunk-load failure. These are
// the messages the browser emits when a dynamically imported (hashed) chunk
// 404s or is served as HTML instead of JS — the exact failure mode produced by
// a service-worker version mismatch during bootstrap.
const CHUNK_LOAD_SIGNATURES = [
  'ChunkLoadError',
  'Failed to fetch dynamically imported module',
  'Importing a module script failed',
  'Loading chunk',
  'Loading CSS chunk',
];

/**
 * Pure classifier: returns true when the given error looks like a chunk-load
 * failure rather than an ordinary application/runtime error.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const name = error instanceof Error ? error.name : '';
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  const text = `${name} ${message}`;
  return CHUNK_LOAD_SIGNATURES.some((sig) => text.includes(sig));
}

type ErrorTarget = {
  addEventListener: (type: string, listener: (event: any) => void) => void;
  removeEventListener: (type: string, listener: (event: any) => void) => void;
};

/**
 * Installs global `error` / `unhandledrejection` listeners that classify
 * chunk-load failures and emit a `CHUNK_LOAD_ERROR` diagnostic. Returns a
 * cleanup function. The monitor is additive and never suppresses the original
 * error — it only observes and logs.
 */
export function installChunkLoadErrorMonitor(
  target: ErrorTarget | undefined = typeof window !== 'undefined'
    ? (window as unknown as ErrorTarget)
    : undefined,
): () => void {
  if (!target || typeof target.addEventListener !== 'function') {
    return () => {};
  }

  const onError = (event: any) => {
    if (isChunkLoadError(event?.error) || isChunkLoadError(event?.message)) {
      logStartupDiagnostic('CHUNK_LOAD_ERROR');
    }
  };

  const onRejection = (event: any) => {
    if (isChunkLoadError(event?.reason)) {
      logStartupDiagnostic('CHUNK_LOAD_ERROR');
    }
  };

  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);

  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
