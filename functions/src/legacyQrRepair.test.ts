import { describe, expect, it } from 'vitest';
import { planLegacyQrRepair, repairLegacyQrProfile } from './legacyQrRepair';

describe('legacy QR repair eligibility', () => {
  const profile = { hasLogin: true, loginEnabled: true, username: 'Alex', displayName: 'Alex' };
  const status = { state: 'available' as const, identityConnected: true, credentialsExist: false };
  it('refuses to infer username provenance from equality with display name', () => {
    expect(planLegacyQrRepair(profile, status, { providerData: [] }, false).eligible).toBe(false);
  });
  it('plans only credential display fields when creation provenance is verified', () => {
    expect(planLegacyQrRepair(profile, status, { providerData: [] }, true)).toMatchObject({
      eligible: true, after: { hasLogin: false, loginEnabled: false }, remove: ['username'],
    });
  });
  it('rejects password providers and any Auth email', () => {
    expect(planLegacyQrRepair(profile, status, { providerData: [{ providerId: 'password' }] }, true).eligible).toBe(false);
    expect(planLegacyQrRepair(profile, status, { email: 'test@example.com', providerData: [] }, true).eligible).toBe(false);
  });
  it('is a no-op once repaired', () => {
    expect(planLegacyQrRepair({ hasLogin: false, loginEnabled: false }, status, { providerData: [] }, true).reason).toBe('already-normalized');
  });
  it('cannot execute a repair for a non-demo project even if emulator variables are set', async () => {
    await expect(repairLegacyQrProfile({ projectId: 'production' } as any, {} as any, 'family', 'child', { dryRun: false, creationWriteVerified: true }))
      .rejects.toThrow('REPAIR_EXECUTION_EMULATOR_ONLY');
  });
});
