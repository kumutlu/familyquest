import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  reportStartupPhase,
  getStartupPhase,
  logStartupDiagnostic,
  type StartupDiagnosticCode,
} from './startupDiagnostics';

describe('startupDiagnostics', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('tracks the current startup phase so the SW handler can read it', () => {
    expect(getStartupPhase()).toBe('unknown');
    reportStartupPhase('auth');
    expect(getStartupPhase()).toBe('auth');
    reportStartupPhase('ready');
    expect(getStartupPhase()).toBe('ready');
  });

  it('logs the diagnostic code with non-sensitive detail', () => {
    const code: StartupDiagnosticCode = 'AUTH_TIMEOUT';
    logStartupDiagnostic(code, { phase: 'auth' });
    expect(console.error).toHaveBeenCalledWith('[StartupDiagnostic]', code, { phase: 'auth' });
  });

  it('drops any detail key that could carry sensitive data', () => {
    logStartupDiagnostic('AUTH_TIMEOUT', {
      phase: 'family',
      uid: 'u1',
      email: 'a@b.com',
      familyId: 'f1',
      token: 'secret',
    });
    const logged = (console.error as any).mock.calls[0];
    expect(logged[0]).toBe('[StartupDiagnostic]');
    expect(logged[1]).toBe('AUTH_TIMEOUT');
    expect(logged[2]).toEqual({ phase: 'family' });
    expect(logged[2]).not.toHaveProperty('uid');
    expect(logged[2]).not.toHaveProperty('email');
    expect(logged[2]).not.toHaveProperty('familyId');
    expect(logged[2]).not.toHaveProperty('token');
  });
});
