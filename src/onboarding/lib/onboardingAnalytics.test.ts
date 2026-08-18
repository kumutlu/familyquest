import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordOnboardingEvent } from './onboardingAnalytics';

describe('onboardingAnalytics', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('emits a dev-only trace in non-production', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    recordOnboardingEvent('onboarding_started');
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('onboarding:onboarding_started'),
      expect.any(Object),
    );
  });

  it('never serialises PII into the event props', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    recordOnboardingEvent('onboarding_auth_completed', { authProvider: 'google' });
    const [, props] = spy.mock.calls[0];
    expect(JSON.stringify(props)).not.toMatch(/name|email|token/i);
  });

  it('is a no-op in production (no console output)', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.stubEnv('PROD', true);
    recordOnboardingEvent('onboarding_started');
    expect(spy).not.toHaveBeenCalled();
  });
});
