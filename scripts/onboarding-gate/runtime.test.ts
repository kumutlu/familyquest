import { describe, expect, it } from 'vitest';
import { allocatePortMap, buildFirebaseConfig, buildGateEnvironment, gateExitCode } from './runtime';

describe('owned onboarding gate runtime', () => {
  it('allocates distinct loopback ports without relying on repository defaults', async () => {
    const ports = await allocatePortMap();
    expect(new Set(Object.values(ports)).size).toBe(6);
    expect(Object.values(ports).every(port => Number.isInteger(port) && port > 0)).toBe(true);
    expect(Object.values(ports)).not.toContain(8080);
    expect(Object.values(ports)).not.toContain(9099);
    expect(Object.values(ports)).not.toContain(5001);
  });

  it('flows the owned port map to browser and admin processes', () => {
    const ports = { auth: 19001, firestore: 19002, functions: 19003, hub: 19004, ui: 19005, vite: 19006 };
    const env = buildGateEnvironment(ports, 'webkit', '/tmp/artifacts');
    expect(env.FIRESTORE_EMULATOR_HOST).toBe('127.0.0.1:19002');
    expect(env.FIREBASE_AUTH_EMULATOR_HOST).toBe('127.0.0.1:19001');
    expect(env.VITE_FIRESTORE_EMULATOR_PORT).toBe('19002');
    expect(env.VITE_FIREBASE_AUTH_EMULATOR_PORT).toBe('19001');
    expect(env.PLAYWRIGHT_BASE_URL).toBe('http://127.0.0.1:19006');
    expect(env.ONBOARDING_GATE_BROWSER).toBe('webkit');
  });

  it('builds a temporary Firebase config containing only owned ports and repository rules', () => {
    const ports = { auth: 19001, firestore: 19002, functions: 19003, hub: 19004, ui: 19005, vite: 19006 };
    expect(buildFirebaseConfig(ports, '/repo')).toMatchObject({
      firestore: { rules: '/repo/firestore.rules', indexes: '/repo/firestore.indexes.json' },
      functions: { source: '/repo/functions' },
      emulators: {
        auth: { host: '127.0.0.1', port: 19001 },
        firestore: { host: '127.0.0.1', port: 19002 },
        functions: { host: '127.0.0.1', port: 19003 },
        hub: { host: '127.0.0.1', port: 19004 },
        ui: { enabled: true, host: '127.0.0.1', port: 19005 },
      },
    });
  });

  it('fails functional outcomes without turning recorded transport warnings into functional failures', () => {
    expect(gateExitCode(1, { writeErrors: 0, listenErrors: 0 })).toBe(1);
    expect(gateExitCode(0, { writeErrors: 1, listenErrors: 2 })).toBe(0);
  });
});
