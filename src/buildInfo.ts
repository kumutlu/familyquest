declare const __FAMILYQUEST_BUILD_SHA__: string;
declare const __FAMILYQUEST_BUILT_AT__: string;

export interface FamilyQuestBuildInfo {
  sha: string;
  builtAt: string;
}

declare global {
  interface Window {
    __FAMILYQUEST_BUILD__?: FamilyQuestBuildInfo;
  }
}

export const FAMILYQUEST_BUILD: FamilyQuestBuildInfo = Object.freeze({
  sha: __FAMILYQUEST_BUILD_SHA__,
  builtAt: __FAMILYQUEST_BUILT_AT__,
});

if (typeof window !== 'undefined') {
  window.__FAMILYQUEST_BUILD__ = FAMILYQUEST_BUILD;
}
