export type FamilyQuestEnvironment = 'DEVELOPMENT' | 'PREVIEW' | 'PRODUCTION';

export interface FamilyQuestBuildInfo {
  /** Application version, sourced from package.json at build time. */
  version: string;
  /** Short git commit SHA, or `unknown` when git metadata is unavailable. */
  sha: string;
  /** ISO-8601 build timestamp. Formatted for display in the UI only. */
  builtAt: string;
  /** Deployment environment derived from the Vite mode. */
  environment: FamilyQuestEnvironment;
  /** Non-secret Firebase project ID from the Firebase web config. */
  firebaseProjectId: string;
}

export const BUILD_INFO_FALLBACK = 'unknown';

/**
 * Normalises a build-time constant, substituting a safe fallback when the value
 * is missing (e.g. `git` unavailable on the build machine).
 */
export function safeBuildValue(value: string | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : BUILD_INFO_FALLBACK;
}

const safe = safeBuildValue;

export function resolveEnvironment(
  mode: string | undefined,
  isProd: boolean,
): FamilyQuestEnvironment {
  const normalised = (mode ?? '').toLowerCase();
  if (normalised === 'preview' || normalised === 'staging') return 'PREVIEW';
  if (normalised === 'production' || isProd) return 'PRODUCTION';
  return 'DEVELOPMENT';
}

declare global {
  interface Window {
    __FAMILYQUEST_BUILD__?: FamilyQuestBuildInfo;
  }
}

export const FAMILYQUEST_BUILD: FamilyQuestBuildInfo = Object.freeze({
  version: safe(
    typeof __FAMILYQUEST_APP_VERSION__ === 'string' ? __FAMILYQUEST_APP_VERSION__ : undefined,
  ),
  sha: safe(
    typeof __FAMILYQUEST_BUILD_SHA__ === 'string'
      ? __FAMILYQUEST_BUILD_SHA__.slice(0, 7)
      : undefined,
  ),
  builtAt: safe(
    typeof __FAMILYQUEST_BUILT_AT__ === 'string' ? __FAMILYQUEST_BUILT_AT__ : undefined,
  ),
  environment: resolveEnvironment(import.meta.env.MODE, import.meta.env.PROD),
  firebaseProjectId: safe(import.meta.env.VITE_FIREBASE_PROJECT_ID),
});

if (typeof window !== 'undefined') {
  window.__FAMILYQUEST_BUILD__ = FAMILYQUEST_BUILD;
}
