import { describe, expect, it } from 'vitest';
import * as avatarConfig from './avatarConfig';

/**
 * Regression test for the P0 blank-page bug:
 *
 * The normal Queki app at `/` was completely blank because the dynamic
 * import of `./App.tsx` (from `main.tsx`) failed at module-evaluation
 * time. App.tsx statically imports `useStore.ts`, which imports
 * `withResolvedAvatar` from `./avatarCatalog.ts`, which in turn imports
 * `avatarConfigToDataUrl` from `./avatarConfig.ts` — but `avatarConfig.ts`
 * did NOT export `avatarConfigToDataUrl`. The browser then threw
 *
 *   SyntaxError: The requested module ... does not provide an export
 *   named 'avatarConfigToDataUrl'
 *
 * during evaluation of the App module graph, and `<div id="root" />` was
 * never populated. `?dev-preview=engagement` was unaffected because the
 * preview surface is mounted from a separate lazy import that does not
 * touch the avatar graph.
 *
 * This test pins down the exact runtime export contract that App.tsx,
 * useStore.ts, avatarCatalog.ts and AvatarCreator.tsx all rely on. If any
 * of these are accidentally dropped, the normal `/` route will go blank
 * again and these tests will fail.
 */
describe('avatarConfig public API surface (App graph contract)', () => {
  it('exports avatarConfigToDataUrl as a callable function', () => {
    expect(typeof avatarConfig.avatarConfigToDataUrl).toBe('function');
    const url = avatarConfig.avatarConfigToDataUrl(avatarConfig.AVATAR_CONFIG_DEFAULT);
    expect(typeof url).toBe('string');
    expect(url.startsWith('data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(url)).toContain('data-avatar-version="1"');
  });

  it('exports AVATAR_CONFIG_OPTIONS for every AvatarConfigV1 selector field', () => {
    expect(avatarConfig.AVATAR_CONFIG_OPTIONS).toBeTypeOf('object');
    for (const key of ['base', 'skinTone', 'hairStyle', 'hairColor', 'face', 'accessory', 'outfit', 'outfitColor', 'background'] as const) {
      expect(Array.isArray(avatarConfig.AVATAR_CONFIG_OPTIONS[key])).toBe(true);
      expect(avatarConfig.AVATAR_CONFIG_OPTIONS[key].length).toBeGreaterThan(1);
    }
  });

  it('exports AVATAR_CONFIG_DEFAULT as a valid v1 config', () => {
    expect(avatarConfig.AVATAR_CONFIG_DEFAULT.version).toBe(1);
    expect(avatarConfig.isValidAvatarConfig(avatarConfig.AVATAR_CONFIG_DEFAULT)).toBe(true);
  });

  it('exports normalizeAvatarConfig that mirrors isValidAvatarConfig', () => {
    expect(typeof avatarConfig.normalizeAvatarConfig).toBe('function');
    expect(avatarConfig.normalizeAvatarConfig(avatarConfig.AVATAR_CONFIG_DEFAULT))
      .toEqual(avatarConfig.AVATAR_CONFIG_DEFAULT);
    expect(avatarConfig.normalizeAvatarConfig({ ...avatarConfig.AVATAR_CONFIG_DEFAULT, version: 2 }))
      .toBeNull();
    expect(avatarConfig.normalizeAvatarConfig(null)).toBeNull();
  });

  it('exports randomAvatarConfig that always returns a valid config', () => {
    expect(typeof avatarConfig.randomAvatarConfig).toBe('function');
    const config = avatarConfig.randomAvatarConfig(() => 0);
    expect(avatarConfig.isValidAvatarConfig(config)).toBe(true);
  });

  it('exports isValidAvatarConfig as the schema gate', () => {
    expect(typeof avatarConfig.isValidAvatarConfig).toBe('function');
    expect(avatarConfig.isValidAvatarConfig(avatarConfig.AVATAR_CONFIG_DEFAULT)).toBe(true);
    expect(avatarConfig.isValidAvatarConfig({ version: 2, base: 'round' })).toBe(false);
  });
});