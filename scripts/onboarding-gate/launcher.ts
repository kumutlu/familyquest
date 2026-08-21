import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { allocatePortMap, buildFirebaseConfig, buildGateEnvironment, gateExitCode, type GatePorts } from './runtime';

const root = resolve(import.meta.dirname, '../..');
const browser = process.argv[2];
if (browser !== 'chromium' && browser !== 'webkit') {
  process.stderr.write('Usage: tsx scripts/onboarding-gate/launcher.ts <chromium|webkit> [artifact-directory]\n');
  process.exit(2);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const artifactDir = resolve(process.argv[3] ?? join(root, 'test-results', 'onboarding-gate', `${timestamp}-${browser}`));
mkdirSync(artifactDir, { recursive: true });
const runtimeDir = mkdtempSync(join(tmpdir(), `queki-onboarding-gate-${browser}-`));
const configPath = join(runtimeDir, 'firebase.json');
const owned: Array<{ name: string; process: ChildProcess }> = [];

const commandOutput = (command: string, args: string[]) => {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
};

const writeMetadata = (value: Record<string, unknown>) =>
  writeFileSync(join(artifactDir, 'ownership.json'), `${JSON.stringify(value, null, 2)}\n`);

const publicFirebaseEnvironment = () => {
  const allowed = new Set([
    'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET', 'VITE_FIREBASE_MESSAGING_SENDER_ID', 'VITE_FIREBASE_APP_ID',
    'VITE_FIREBASE_MEASUREMENT_ID',
  ]);
  const values: Record<string, string> = {};
  for (const line of readFileSync(join(root, '.env.production'), 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && allowed.has(match[1])) values[match[1]] = match[2];
  }
  return values;
};

const stopOwned = async () => {
  for (const entry of [...owned].reverse()) {
    const pid = entry.process.pid;
    if (!pid || entry.process.exitCode !== null) continue;
    try { process.kill(-pid, 'SIGTERM'); } catch { /* already exited */ }
  }
  await new Promise(resolveWait => setTimeout(resolveWait, 500));
  for (const entry of [...owned].reverse()) {
    const pid = entry.process.pid;
    if (!pid || entry.process.exitCode !== null) continue;
    try { process.kill(-pid, 'SIGKILL'); } catch { /* already exited */ }
  }
};

async function waitForHub(ports: GatePorts, firebaseProcess: ChildProcess) {
  const deadline = Date.now() + 120_000;
  const endpoint = `http://127.0.0.1:${ports.hub}/emulators`;
  while (Date.now() < deadline) {
    if (firebaseProcess.exitCode !== null) throw new Error(`Firebase emulators exited early (${firebaseProcess.exitCode})`);
    try {
      const response = await fetch(endpoint);
      if (response.ok) {
        const metadata = await response.json() as Record<string, unknown>;
        const services = metadata as Record<string, { port?: number }>;
        if (services.auth?.port === ports.auth && services.firestore?.port === ports.firestore && services.functions?.port === ports.functions) {
          return metadata;
        }
      }
    } catch { /* not ready */ }
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  throw new Error(`Owned emulator hub did not become ready at ${endpoint}`);
}

async function main() {
  const ports = await allocatePortMap();
  const env = { ...process.env, ...publicFirebaseEnvironment(), ...buildGateEnvironment(ports, browser, artifactDir) };
  writeFileSync(configPath, `${JSON.stringify(buildFirebaseConfig(ports, root), null, 2)}\n`);
  writeFileSync(join(artifactDir, 'firebase.runtime.json'), readFileSync(configPath));

  const initialMetadata: Record<string, unknown> = {
    worktreePath: root,
    gitSha: commandOutput('git', ['rev-parse', 'HEAD']),
    firebaseToolsVersion: commandOutput(resolve(root, 'node_modules/.bin/firebase'), ['--version']),
    browser,
    ports,
    ownedPids: {},
    startedAt: new Date().toISOString(),
  };
  writeMetadata(initialMetadata);

  const emulatorLog = createWriteStream(join(artifactDir, 'emulator.log'));
  const firebaseProcess = spawn(resolve(root, 'node_modules/.bin/firebase'), [
    'emulators:start', '--only', 'auth,firestore,functions', '--config', configPath, '--project', 'familyquest-beta-402cb',
  ], { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  owned.push({ name: 'firebase-emulators', process: firebaseProcess });
  firebaseProcess.stdout?.pipe(emulatorLog);
  firebaseProcess.stderr?.pipe(emulatorLog);
  initialMetadata.ownedPids = { firebaseEmulatorGroupLeader: firebaseProcess.pid };
  writeMetadata(initialMetadata);

  const hubMetadata = await waitForHub(ports, firebaseProcess);
  initialMetadata.emulatorHubMetadata = hubMetadata;
  initialMetadata.ownershipVerifiedAt = new Date().toISOString();
  writeMetadata(initialMetadata);

  const playwrightLog = createWriteStream(join(artifactDir, 'playwright.log'));
  const playwrightProcess = spawn(resolve(root, 'node_modules/.bin/playwright'), [
    'test', '--config', 'playwright.onboarding-redesign.config.ts', '--project', browser,
  ], { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  owned.push({ name: 'playwright', process: playwrightProcess });
  playwrightProcess.stdout?.pipe(playwrightLog);
  playwrightProcess.stderr?.pipe(playwrightLog);
  initialMetadata.ownedPids = {
    firebaseEmulatorGroupLeader: firebaseProcess.pid,
    playwrightGroupLeader: playwrightProcess.pid,
  };
  writeMetadata(initialMetadata);

  const exitCode = await new Promise<number>((resolveExit, reject) => {
    playwrightProcess.once('error', reject);
    playwrightProcess.once('exit', code => resolveExit(code ?? 1));
  });
  const transportPath = join(artifactDir, 'transport-events.ndjson');
  const attachedTransportEvents = existsSync(transportPath)
    ? readFileSync(transportPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as { stream: string })
    : [];
  const playwrightText = readFileSync(join(artifactDir, 'playwright.log'), 'utf8');
  const loggedMessages = [...new Set(playwrightText.match(/Fetch API cannot load[^\n]+due to access control checks\./g) ?? [])]
    .map(message => ({ stream: /Firestore\/Write\/channel/.test(message) ? 'Write' : 'Listen', message }));
  const transportEvents = attachedTransportEvents.length ? attachedTransportEvents : loggedMessages;
  const transportHealth = {
    writeErrors: transportEvents.filter(event => event.stream === 'Write').length,
    listenErrors: transportEvents.filter(event => event.stream === 'Listen').length,
    passed: transportEvents.length === 0,
  };
  writeFileSync(join(artifactDir, 'transport-health.json'), `${JSON.stringify(transportHealth, null, 2)}\n`);
  initialMetadata.finishedAt = new Date().toISOString();
  initialMetadata.playwrightExitCode = exitCode;
  initialMetadata.functionalOutcome = exitCode === 0 ? 'passed' : 'failed';
  initialMetadata.transportHealth = transportHealth;
  writeMetadata(initialMetadata);
  process.exitCode = gateExitCode(exitCode, transportHealth);
}

const terminate = async (signal: string) => {
  await stopOwned();
  rmSync(runtimeDir, { recursive: true, force: true });
  if (signal) process.exitCode ||= 1;
};

process.once('SIGINT', () => void terminate('SIGINT'));
process.once('SIGTERM', () => void terminate('SIGTERM'));

main()
  .catch(error => {
    writeFileSync(join(artifactDir, 'launcher-error.txt'), `${String(error)}\n`);
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => terminate(''));
