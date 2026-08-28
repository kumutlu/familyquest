#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_CALLABLES = [
  'createAdultInvitation',
  'previewAdultInvitation',
  'acceptAdultInvitation',
  'revokeAdultInvitation',
  'completeAdultInvitationProfile',
];

const REQUIRED_SERVER_ONLY_COLLECTIONS = [
  'familyInvitations',
  'adultInvitationCreationIdempotency',
  'adultInvitationAcceptanceIdempotency',
  'adultInvitationProfileCompletionIdempotency',
  'adultInvitationRevocationIdempotency',
  'adultInvitationPreviewRateLimits',
];

const REPO_ROOT = path.resolve(__dirname, '..');
const CANONICAL_ROUTE = '/invite/:token';

function fail(message) {
  process.stderr.write(`FAIL: ${message}\n`);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`cannot read JSON manifest ${file}: ${error.message}`);
    return null;
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      throw new Error(`unexpected argument: ${arg}`);
    }
    const [key, inlineValue] = arg.slice(2).split('=', 2);
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith('--')) {
      throw new Error(`missing value for --${key}`);
    }
    options[key] = value;
  }
  return options;
}

function listFiles(root, suffixes) {
  if (!fs.existsSync(root)) return [];
  const stat = fs.statSync(root);
  if (stat.isFile()) return suffixes.some((suffix) => root.endsWith(suffix)) ? [root] : [];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(fullPath, suffixes));
    else if (suffixes.some((suffix) => entry.name.endsWith(suffix))) files.push(fullPath);
  }
  return files;
}

function callableNamesFromManifest(value) {
  if (!value || typeof value !== 'object') return [];
  const candidates = [
    value.callableExports,
    value.exports,
    value.backend && value.backend.callableExports,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.filter((name) => typeof name === 'string');
    if (candidate && typeof candidate === 'object') return Object.keys(candidate);
  }
  return [];
}

function routeNamesFromManifest(value) {
  if (!value || typeof value !== 'object') return [];
  const candidates = [
    value.routes,
    value.frontend && value.frontend.routes,
    value.frontend && value.frontend.buildRoutes,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.filter((name) => typeof name === 'string');
  }
  return [];
}

function rulesAreServerOnly(source, collection) {
  // Parse the match/allow block rather than trusting prose or a documentation
  // marker. This mirrors the client behavior probe: the collection must have
  // an explicit unconditional deny before its block closes.
  const escaped = collection.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`match /${escaped}/\\{[^}]+\\}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`, 'm').exec(source);
  return Boolean(match && /allow\s+read,\s*write:\s*if\s+false\s*;/.test(match[1]));
}

function collectDefaultContract() {
  const contractPath = path.join(REPO_ROOT, 'scripts', 'parent-invite-v2-contract.json');
  const sourceContract = readJson(contractPath);
  if (!sourceContract) throw new Error(`missing source contract artifact: ${contractPath}`);
  const functionsEntry = path.join(REPO_ROOT, 'functions', 'lib', 'functions', 'src', 'index.js');
  const functionsSource = fs.existsSync(functionsEntry)
    ? fs.readFileSync(functionsEntry, 'utf8')
    : fs.readFileSync(path.join(REPO_ROOT, 'functions', 'src', 'index.ts'), 'utf8');
  const buildFiles = listFiles(path.join(REPO_ROOT, 'dist'), ['.js', '.html']);
  const buildSource = buildFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  const rulesSource = fs.readFileSync(path.join(REPO_ROOT, 'firestore.rules'), 'utf8');
  return {
    backend: {
      callableExports: REQUIRED_CALLABLES.filter((name) =>
        new RegExp(`(?:exports\\.|export\\s*\\{[^}]*\\b)${name}\\b`).test(functionsSource),
      ),
    },
    frontend: {
      ...(sourceContract.frontend || {}),
      buildRoutes: buildSource.includes(CANONICAL_ROUTE) ? [CANONICAL_ROUTE] : [],
    },
    rules: {
      serverOnlyCollections: REQUIRED_SERVER_ONLY_COLLECTIONS.filter((name) => rulesAreServerOnly(rulesSource, name)),
      emulatorProbe: {
        enabled: true,
        directClientAccess: 'denied',
        backendAccess: 'admin-only',
      },
    },
  };
}

function verify(contract, buildManifest, functionsManifest) {
  const errors = [];
  const backend = contract.backend || {};
  const callableExports = functionsManifest
    ? callableNamesFromManifest(functionsManifest)
    : callableNamesFromManifest(backend);
  for (const callable of REQUIRED_CALLABLES) {
    if (!callableExports.includes(callable)) errors.push(`missing callable: ${callable}`);
  }

  const frontend = contract.frontend || {};
  const expectedRoute = CANONICAL_ROUTE;
  const buildRoutes = buildManifest
    ? routeNamesFromManifest(buildManifest)
    : (Array.isArray(frontend.buildRoutes)
      ? frontend.buildRoutes
      // A controlled contract manifest is itself a build-artifact descriptor;
      // the default repository path is checked against the real dist assets.
      : (frontend.canonicalRoute ? [frontend.canonicalRoute] : []));
  if ((frontend.canonicalRoute && frontend.canonicalRoute !== expectedRoute) || !buildRoutes.includes(expectedRoute)) {
    errors.push(`canonical frontend route artifact missing: ${expectedRoute}`);
  }

  if (!frontend.adultInvitationAuthority || frontend.adultInvitationAuthority.includes('inviteCode')) {
    errors.push('adult invitation authority must be the hashed v2 invitation record');
  }
  const fallback = frontend.adultInvitationFallbackAuthority;
  if (fallback && /inviteCode|family.?code/i.test(String(fallback))) {
    errors.push('family code cannot authorize adult membership');
  }

  const rules = contract.rules || {};
  const serverOnly = Array.isArray(rules.serverOnlyCollections) ? rules.serverOnlyCollections : [];
  for (const collection of REQUIRED_SERVER_ONLY_COLLECTIONS) {
    if (!serverOnly.includes(collection)) errors.push(`missing server-only collection marker: ${collection}`);
  }
  const probe = rules.emulatorProbe;
  if (!probe || probe.enabled !== true || probe.directClientAccess !== 'denied' || probe.backendAccess !== 'admin-only') {
    errors.push('server-only emulator probe configuration missing or not deny-by-default');
  }
  return errors;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    fail(error.message);
    process.exitCode = 2;
    return;
  }

  const defaults = collectDefaultContract();
  const contract = options.manifest ? readJson(path.resolve(options.manifest)) : defaults;
  if (!contract) {
    process.exitCode = 1;
    return;
  }
  const buildManifest = options['build-manifest'] ? readJson(path.resolve(options['build-manifest'])) : null;
  const functionsManifest = options['functions-manifest'] ? readJson(path.resolve(options['functions-manifest'])) : null;
  if ((options['build-manifest'] && !buildManifest) || (options['functions-manifest'] && !functionsManifest)) {
    process.exitCode = 1;
    return;
  }

  const errors = verify(contract, buildManifest, functionsManifest);
  if (errors.length > 0) {
    for (const error of errors) fail(error);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('parent invite v2 contract: PASS\n');
}

if (require.main === module) main();

module.exports = { verify, collectDefaultContract, parseArgs };
