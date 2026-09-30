import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, 'inspectFirestore.ts');

export function inspectChildProvisioning(childId: string, familyId: string) {
  const out = execSync(`npx tsx "${SCRIPT}"`, {
    env: {
      ...process.env,
      INSPECT_QUERY_TYPE: 'check_child_provisioning',
      INSPECT_TARGET_ID: childId,
      INSPECT_FAMILY_ID: familyId,
    },
    encoding: 'utf8',
  });
  return JSON.parse(out.trim());
}

export function inspectChildDeletion(childId: string, familyId: string) {
  const out = execSync(`npx tsx "${SCRIPT}"`, {
    env: {
      ...process.env,
      INSPECT_QUERY_TYPE: 'check_child_deletion',
      INSPECT_TARGET_ID: childId,
      INSPECT_FAMILY_ID: familyId,
    },
    encoding: 'utf8',
  });
  return JSON.parse(out.trim());
}

export function inspectFamilyCounts(familyId: string) {
  const out = execSync(`npx tsx "${SCRIPT}"`, {
    env: {
      ...process.env,
      INSPECT_QUERY_TYPE: 'count_children_and_wallets',
      INSPECT_FAMILY_ID: familyId,
    },
    encoding: 'utf8',
  });
  return JSON.parse(out.trim());
}

export function seedOrphanUser(email: string) {
  const out = execSync(`npx tsx "${SCRIPT}"`, {
    env: {
      ...process.env,
      INSPECT_QUERY_TYPE: 'seed_orphan_user',
      INSPECT_EMAIL: email,
    },
    encoding: 'utf8',
  });
  return JSON.parse(out.trim());
}

export function seedZeroChildFamily(email: string, familyId = 'zero-fam') {
  const out = execSync(`npx tsx "${SCRIPT}"`, {
    env: {
      ...process.env,
      INSPECT_QUERY_TYPE: 'seed_zero_child_family',
      INSPECT_EMAIL: email,
      INSPECT_FAMILY_ID: familyId,
    },
    encoding: 'utf8',
  });
  return JSON.parse(out.trim());
}

export function seedLegacyQrToken() {
  const out = execSync(`npx tsx "${SCRIPT}"`, {
    env: {
      ...process.env,
      INSPECT_QUERY_TYPE: 'seed_legacy_qr_token',
    },
    encoding: 'utf8',
  });
  return JSON.parse(out.trim()).rawToken as string;
}

export function verifyEmailUser(email: string) {
  const out = execSync(`npx tsx "${SCRIPT}"`, {
    env: {
      ...process.env,
      INSPECT_QUERY_TYPE: 'verify_email',
      INSPECT_EMAIL: email,
    },
    encoding: 'utf8',
  });
  return JSON.parse(out.trim());
}
