/// <reference types="vite/client" />

/**
 * Build-time constants injected by `define` in `vite.config.ts`.
 * Values are resolved once per build; git metadata falls back to `unknown`.
 */
declare const __FAMILYQUEST_BUILD_SHA__: string;
declare const __FAMILYQUEST_BUILT_AT__: string;
declare const __FAMILYQUEST_APP_VERSION__: string;

interface ImportMetaEnv {
  /** Non-secret Firebase project ID; safe to display in the UI. */
  readonly VITE_FIREBASE_PROJECT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
