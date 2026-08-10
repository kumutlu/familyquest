import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./startupDiagnostics', () => ({
  logStartupDiagnostic: vi.fn(),
}));

import { isChunkLoadError, installChunkLoadErrorMonitor } from './chunkLoadErrorMonitor';
import { logStartupDiagnostic } from './startupDiagnostics';

describe('chunkLoadErrorMonitor', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(logStartupDiagnostic).mockClear();
  });

  describe('isChunkLoadError', () => {
    it('detects a webpack/vite ChunkLoadError', () => {
      expect(isChunkLoadError(new Error('Loading chunk 123 failed'))).toBe(true);
      expect(isChunkLoadError(Object.assign(new Error('boom'), { name: 'ChunkLoadError' }))).toBe(true);
    });

    it('detects a dynamic import failure', () => {
      expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module: foo'))).toBe(true);
      expect(isChunkLoadError(new Error('Importing a module script failed'))).toBe(true);
    });

    it('rejects ordinary application errors', () => {
      expect(isChunkLoadError(new Error('something else broke'))).toBe(false);
      expect(isChunkLoadError(new TypeError('Cannot read properties of undefined'))).toBe(false);
    });

    it('handles non-error inputs safely', () => {
      expect(isChunkLoadError(null)).toBe(false);
      expect(isChunkLoadError(undefined)).toBe(false);
      expect(isChunkLoadError('a plain string')).toBe(false);
    });
  });

  describe('installChunkLoadErrorMonitor', () => {
    it('classifies a chunk-load error event as CHUNK_LOAD_ERROR', () => {
      const target = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      installChunkLoadErrorMonitor(target);
      const errorListener = target.addEventListener.mock.calls.find((c) => c[0] === 'error')?.[1];
      expect(errorListener).toBeTypeOf('function');

      errorListener({ error: new Error('Loading chunk 7 failed') });
      expect(logStartupDiagnostic).toHaveBeenCalledWith('CHUNK_LOAD_ERROR');
    });

    it('classifies an unhandledrejection chunk-load as CHUNK_LOAD_ERROR', () => {
      const target = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      installChunkLoadErrorMonitor(target);
      const rejectionListener = target.addEventListener.mock.calls.find(
        (c) => c[0] === 'unhandledrejection',
      )?.[1];
      expect(rejectionListener).toBeTypeOf('function');

      rejectionListener({ reason: new Error('Failed to fetch dynamically imported module') });
      expect(logStartupDiagnostic).toHaveBeenCalledWith('CHUNK_LOAD_ERROR');
    });

    it('ignores non-chunk errors and returns a working cleanup', () => {
      const target = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      const cleanup = installChunkLoadErrorMonitor(target);
      const errorListener = target.addEventListener.mock.calls.find((c) => c[0] === 'error')?.[1];
      errorListener({ error: new Error('plain error') });
      expect(logStartupDiagnostic).not.toHaveBeenCalled();

      cleanup();
      expect(target.removeEventListener).toHaveBeenCalledTimes(2);
    });

    it('returns a no-op cleanup when no target is available', () => {
      expect(installChunkLoadErrorMonitor(undefined)).toBeTypeOf('function');
    });
  });
});
