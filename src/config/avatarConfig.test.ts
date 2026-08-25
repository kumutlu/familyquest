import { describe, expect, it } from 'vitest';
import {
  AVATAR_CONFIG_DEFAULT,
  AVATAR_CONFIG_OPTIONS,
  avatarConfigToDataUrl,
  isValidAvatarConfig,
  normalizeAvatarConfig,
  randomAvatarConfig,
  type AvatarConfigV1,
} from './avatarConfig';
import { resolveAvatarImage, withResolvedAvatar } from './avatarCatalog';

const config: AvatarConfigV1 = {
  version: 1,
  base: 'round',
  skinTone: 'warm',
  hairStyle: 'curls',
  hairColor: 'brown',
  face: 'smile',
  accessory: 'glasses',
  outfit: 'hoodie',
  outfitColor: 'purple',
  background: 'mint',
};

describe('AvatarConfigV1', () => {
  it('accepts exactly the versioned allowlisted shape', () => {
    expect(isValidAvatarConfig(config)).toBe(true);
    expect(normalizeAvatarConfig(config)).toEqual(config);
  });

  it.each([
    ['wrong version', { ...config, version: 2 }],
    ['unknown option', { ...config, hairStyle: 'javascript:alert(1)' }],
    ['extra key', { ...config, url: 'https://evil.example/avatar.svg' }],
    ['missing key', Object.fromEntries(Object.entries(config).filter(([key]) => key !== 'face'))],
    ['wrong value type', { ...config, background: { css: 'red' } }],
  ])('rejects %s', (_name, candidate) => {
    expect(isValidAvatarConfig(candidate)).toBe(false);
    expect(normalizeAvatarConfig(candidate)).toBeNull();
  });

  it('renders the same config to the same safe SVG data URL', () => {
    const first = avatarConfigToDataUrl(config);
    const second = avatarConfigToDataUrl({ ...config });
    expect(first).toBe(second);
    expect(first).toMatch(/^data:image\/svg\+xml,/);
    expect(decodeURIComponent(first)).toContain('data-avatar-version="1"');
    expect(decodeURIComponent(first)).not.toContain('<script');
  });

  it.each(['base', 'skinTone', 'hairStyle', 'hairColor', 'face', 'accessory', 'outfit', 'outfitColor', 'background'] as const)(
    'changing %s changes the rendered avatar',
    key => {
      const alternative = AVATAR_CONFIG_OPTIONS[key].find(value => value !== config[key]);
      expect(avatarConfigToDataUrl({ ...config, [key]: alternative })).not.toBe(avatarConfigToDataUrl(config));
    },
  );

  it('Surprise Me always returns a valid allowlisted config', () => {
    const surprised = randomAvatarConfig(() => 0.9999);
    expect(isValidAvatarConfig(surprised)).toBe(true);
    for (const key of Object.keys(AVATAR_CONFIG_OPTIONS) as Array<keyof typeof AVATAR_CONFIG_OPTIONS>) {
      expect(AVATAR_CONFIG_OPTIONS[key]).toContain(surprised[key]);
    }
  });

  it('falls back from malformed config to legacy avatarId then legacy URL', () => {
    const legacyCatalog = resolveAvatarImage('starter-robot', 'https://legacy.example/avatar.png', { ...config, version: 2 });
    expect(legacyCatalog).toContain('starter-robot');
    expect(resolveAvatarImage(null, 'https://legacy.example/avatar.png', null)).toBe('https://legacy.example/avatar.png');
  });

  it('prefers a valid composable config without changing the legacy fields', () => {
    expect(resolveAvatarImage('starter-robot', 'https://legacy.example/avatar.png', config)).toBe(avatarConfigToDataUrl(config));
    expect(AVATAR_CONFIG_DEFAULT.version).toBe(1);
  });

  it('normalizes Parent and Child surface profiles through the same resolver', () => {
    const profile = { id: 'child-1', avatarId: 'starter-robot', avatarUrl: 'https://legacy.example/avatar.png', avatarConfig: config };
    const resolved = withResolvedAvatar(profile);
    expect(resolved.avatarUrl).toBe(avatarConfigToDataUrl(config));
    expect(profile.avatarUrl).toBe('https://legacy.example/avatar.png');
    expect(resolved.avatarConfig).toEqual(config);
  });
});
