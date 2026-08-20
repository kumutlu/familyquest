// Build three production artifacts for the one-time legacy SW migration gate:
// old = genuine 82422c8 source; new = migration; normal = rollback lifecycle.
// No commits are created.
import { execFileSync, execSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();
const ART = join(ROOT, 'e2e-artifacts');
const OLD_REF = '82422c8';
const NORMAL_SHA = 'f0110ff';

const sha = cwd => execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
}).trim();
const build = (cwd, env = {}) => execSync('npm run build', {
  cwd, env: { ...process.env, ...env }, stdio: 'inherit',
});
const copyDist = (cwd, name) => {
  const dest = join(ART, name);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(join(cwd, 'dist'), dest, { recursive: true });
};

mkdirSync(ART, { recursive: true });
const tempRoot = mkdtempSync(join(tmpdir(), 'queki-sw-old-'));
const oldWorktree = join(tempRoot, 'worktree');
let oldWorktreeAdded = false;
try {
  execFileSync('git', ['worktree', 'add', '--detach', oldWorktree, OLD_REF], { cwd: ROOT, stdio: 'inherit' });
  oldWorktreeAdded = true;
  symlinkSync(join(ROOT, 'node_modules'), join(oldWorktree, 'node_modules'), 'dir');
  build(oldWorktree, { VITE_SW_E2E_HOOK: '1', QUEKI_LEGACY_SW_MIGRATION: '0' });
  copyDist(oldWorktree, 'old');
} finally {
  if (oldWorktreeAdded) {
    execFileSync('git', ['worktree', 'remove', '--force', oldWorktree], { cwd: ROOT, stdio: 'ignore' });
  }
  rmSync(tempRoot, { recursive: true, force: true });
}

const migrationSha = sha(ROOT);
build(ROOT, {
  VITE_SW_E2E_HOOK: '1', VITE_SW_E2E_BUILD_SHA: migrationSha,
  QUEKI_LEGACY_SW_MIGRATION: '1',
});
copyDist(ROOT, 'new');

build(ROOT, {
  VITE_SW_E2E_HOOK: '1', VITE_SW_E2E_BUILD_SHA: NORMAL_SHA,
  QUEKI_LEGACY_SW_MIGRATION: '0',
});
copyDist(ROOT, 'normal');

writeFileSync(join(ART, 'sha.json'), JSON.stringify({
  old: OLD_REF, new: migrationSha, normal: NORMAL_SHA,
}, null, 2));
console.log(`[build] OLD_SHA=${OLD_REF} NEW_SHA=${migrationSha} NORMAL_SHA=${NORMAL_SHA}`);
