import { createServer } from 'node:net';
import { resolve } from 'node:path';

export interface GatePorts {
  auth: number;
  firestore: number;
  functions: number;
  hub: number;
  ui: number;
  vite: number;
}

const freeLoopbackPort = () => new Promise<number>((resolve, reject) => {
  const server = createServer();
  server.unref();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      reject(new Error('Could not allocate a loopback port'));
      return;
    }
    const { port } = address;
    server.close(error => error ? reject(error) : resolve(port));
  });
});

export async function allocatePortMap(): Promise<GatePorts> {
  const allocated = new Set<number>();
  while (allocated.size < 6) allocated.add(await freeLoopbackPort());
  const [auth, firestore, functions, hub, ui, vite] = [...allocated];
  return { auth, firestore, functions, hub, ui, vite };
}

export function buildGateEnvironment(ports: GatePorts, browser: string, artifactDir: string) {
  return {
    VITE_USE_FIREBASE_EMULATOR: 'true',
    VITE_FIREBASE_EMULATOR_HOST: '127.0.0.1',
    VITE_FIREBASE_AUTH_EMULATOR_PORT: String(ports.auth),
    VITE_FIRESTORE_EMULATOR_PORT: String(ports.firestore),
    VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT: String(ports.functions),
    FIRESTORE_EMULATOR_HOST: `127.0.0.1:${ports.firestore}`,
    FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${ports.auth}`,
    FUNCTIONS_EMULATOR_HOST: `127.0.0.1:${ports.functions}`,
    PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${ports.vite}`,
    PLAYWRIGHT_VITE_PORT: String(ports.vite),
    ONBOARDING_GATE_BROWSER: browser,
    ONBOARDING_GATE_ARTIFACT_DIR: artifactDir,
  };
}

export function buildFirebaseConfig(ports: GatePorts, worktreePath: string) {
  return {
    firestore: {
      rules: resolve(worktreePath, 'firestore.rules'),
      indexes: resolve(worktreePath, 'firestore.indexes.json'),
    },
    functions: { source: resolve(worktreePath, 'functions'), runtime: 'nodejs22' },
    emulators: {
      auth: { host: '127.0.0.1', port: ports.auth },
      firestore: { host: '127.0.0.1', port: ports.firestore },
      functions: { host: '127.0.0.1', port: ports.functions },
      hub: { host: '127.0.0.1', port: ports.hub },
      ui: { enabled: true, host: '127.0.0.1', port: ports.ui },
      singleProjectMode: true,
    },
  };
}

export function gateExitCode(
  playwrightExitCode: number,
  _transportHealth: { writeErrors: number; listenErrors: number },
) {
  return playwrightExitCode;
}
