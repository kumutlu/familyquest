// Builds two PRODUCTION preview artifacts with DIFFERENT build SHAs so the
// Playwright SW-lifecycle gate can prove a stale controlled client is upgraded
// to a new build.
//
//   e2e-artifacts/old   -> built from current source, SHA = current HEAD short SHA
//   e2e-artifacts/new   -> built from current source, SHA = HEAD after an empty
//                          commit (so the bundle hash differs -> sw.js precache
//                          manifest differs -> the browser detects a NEW SW)
//   e2e-artifacts/sha.json -> { old, new }
//
// The empty commit is reverted with `git reset --soft HEAD~1` so the working
// tree (including the uncommitted lifecycle fix) is left untouched.
//
// Usage: node scripts/build-sw-e2e-artifacts.mjs

import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const ART = join(ROOT, 'e2e-artifacts');

// Expose the deterministic E2E startup-phase hook ONLY in the artifacts built
// for the service-worker lifecycle gate. The hook (`window.__reportStartupPhase`)
// is gated in `src/startupDiagnostics.ts` behind `import.meta.env.VITE_SW_E2E_HOOK`,
// which Vite only defines when this env var is set. Real production/preview
// builds never set it, so the production bundle never exposes the hook.
process.env.VITE_SW_E2E_HOOK = '1';

const sha = () =>
  execSync('git rev-parse --short=7 HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();

const build = () => {
  console.log('[build] npm run build ...');
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
};

const copyDist = (dest) => {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(join(ROOT, 'dist'), dest, { recursive: true });
};

const oldSha = sha();
build();
copyDist(join(ART, 'old'));

// Create a new HEAD with an identical tree so the embedded SHA changes while the
// source (and the uncommitted lifecycle fix) is preserved.
execSync('git commit --allow-empty -m "e2e: marker for NEW build SHA"', { cwd: ROOT, stdio: 'inherit' });
const newSha = sha();
build();
copyDist(join(ART, 'new'));

// Restore HEAD; working tree (incl. the fix) is untouched by --soft.
execSync('git reset --soft HEAD~1', { cwd: ROOT, stdio: 'inherit' });

writeFileSync(join(ART, 'sha.json'), JSON.stringify({ old: oldSha, new: newSha }, null, 2));
console.log(`[build] OLD_SHA=${oldSha}  NEW_SHA=${newSha}`);
console.log(`[build] artifacts: ${join(ART, 'old')}  ${join(ART, 'new')}`);
