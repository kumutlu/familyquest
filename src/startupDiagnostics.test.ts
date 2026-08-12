import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  reportStartupPhase,
  getStartupPhase,
  logStartupDiagnostic,
  type StartupDiagnosticCode,
  markStartupStage,
  startStartupResource,
  finishStartupResource,
  getStartupMetrics,
  resetStartupMetrics,
} from './startupDiagnostics';

describe('startupDiagnostics', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    resetStartupMetrics();
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

  it('captures ordered startup marks and derived durations without identifiers', () => {
    markStartupStage('APP_SCRIPT_READY', 10);
    markStartupStage('REACT_MOUNT_START', 15);
    markStartupStage('REACT_MOUNTED', 21);
    markStartupStage('CRITICAL_BOOTSTRAP_COMPLETE', 80);
    markStartupStage('DASHBOARD_FIRST_RENDER', 90);

    expect(getStartupMetrics()).toEqual(expect.objectContaining({
      marks: expect.objectContaining({ APP_SCRIPT_READY: 10, REACT_MOUNTED: 21 }),
      durations: expect.objectContaining({
        REACT_MOUNT: 6,
        CRITICAL_BOOTSTRAP: 70,
        DASHBOARD_FIRST_RENDER: 80,
      }),
    }));
    expect(JSON.stringify(getStartupMetrics())).not.toMatch(/uid|familyId|email/i);
  });

  it('records optional resource durations independently', () => {
    startStartupResource('MEMBERS', 100);
    finishStartupResource('MEMBERS', 145);
    startStartupResource('TASKS', 110);
    finishStartupResource('TASKS', 170);

    expect(getStartupMetrics().optional).toEqual({ MEMBERS: 45, TASKS: 60 });
  });
});
