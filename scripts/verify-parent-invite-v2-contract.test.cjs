const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const verifier = path.join(__dirname, 'verify-parent-invite-v2-contract.cjs');

function fixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parent-invite-v2-'));
  const base = {
    backend: {
      callableExports: [
        'createAdultInvitation',
        'previewAdultInvitation',
        'acceptAdultInvitation',
        'revokeAdultInvitation',
      ],
    },
    frontend: {
      canonicalRoute: '/invite/:token',
      adultInvitationAuthority: 'familyInvitations/{sha256(rawToken)}',
      adultInvitationFallbackAuthority: null,
    },
    rules: {
      serverOnlyCollections: [
        'familyInvitations',
        'adultInvitationCreationIdempotency',
        'adultInvitationAcceptanceIdempotency',
        'adultInvitationRevocationIdempotency',
        'adultInvitationPreviewRateLimits',
      ],
      emulatorProbe: {
        enabled: true,
        directClientAccess: 'denied',
        backendAccess: 'admin-only',
      },
    },
  };
  const manifest = {
    ...base,
    ...overrides,
    backend: { ...base.backend, ...overrides.backend },
    frontend: { ...base.frontend, ...overrides.frontend },
    rules: { ...base.rules, ...overrides.rules },
  };
  fs.writeFileSync(path.join(root, 'contract.json'), JSON.stringify(manifest));
  return { root, manifest, manifestPath: path.join(root, 'contract.json') };
}

function runVerifier(args) {
  return spawnSync(process.execPath, [verifier, ...args], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
}

test('passes a complete controlled contract fixture', () => {
  const { manifestPath } = fixture();
  const result = runVerifier(['--manifest', manifestPath]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /parent invite v2 contract: PASS/);
});

test('fails when the backend lacks any v2 callable export', () => {
  const { manifestPath, manifest } = fixture({
    backend: {
      callableExports: [
        'createAdultInvitation',
        'previewAdultInvitation',
        'revokeAdultInvitation',
      ],
    },
  });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const result = runVerifier(['--manifest', manifestPath]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing callable: acceptAdultInvitation/);
});

test('fails when frontend parent invite configuration falls back to family inviteCode', () => {
  const { manifestPath, manifest } = fixture({
    frontend: {
      canonicalRoute: '/invite/:token',
      adultInvitationAuthority: 'familyInvitations/{sha256(rawToken)}',
      adultInvitationFallbackAuthority: 'families/{familyId}.inviteCode',
    },
  });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const result = runVerifier(['--manifest', manifestPath]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /family code cannot authorize adult membership/);
});

test('fails when route, server-only probe, or required collection marker is absent', () => {
  const { manifestPath, manifest } = fixture({
    frontend: { canonicalRoute: '/join/:token' },
    rules: {
      serverOnlyCollections: ['familyInvitations'],
      emulatorProbe: { enabled: false },
    },
  });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const result = runVerifier(['--manifest', manifestPath]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /canonical frontend route artifact missing: \/invite\/:token/);
  assert.match(result.stderr, /server-only emulator probe configuration missing or not deny-by-default/);
  assert.match(result.stderr, /missing server-only collection marker: adultInvitationAcceptanceIdempotency/);
});

test('accepts build and functions manifests through explicit CLI inputs', () => {
  const { root } = fixture();
  const buildPath = path.join(root, 'build-manifest.json');
  const functionsPath = path.join(root, 'functions-manifest.json');
  fs.writeFileSync(buildPath, JSON.stringify({ routes: ['/invite/:token'] }));
  fs.writeFileSync(functionsPath, JSON.stringify({
    exports: {
      createAdultInvitation: {},
      previewAdultInvitation: {},
      acceptAdultInvitation: {},
      revokeAdultInvitation: {},
    },
  }));
  const result = runVerifier([
    '--manifest', path.join(root, 'contract.json'),
    '--build-manifest', buildPath,
    '--functions-manifest', functionsPath,
  ]);
  assert.equal(result.status, 0, result.stderr);
});
