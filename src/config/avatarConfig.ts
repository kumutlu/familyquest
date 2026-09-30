/**
 * AvatarConfigV1 — closed schema for composable avatar customization.
 * This is the authoritative shape accepted by Firestore Rules and the client API.
 * No arbitrary keys, values, URLs, SVG, CSS, or uploads are permitted.
 */
export interface AvatarConfigV1 {
  version: 1;
  base: 'round' | 'soft' | 'bold';
  skinTone: 'porcelain' | 'fair' | 'warm' | 'tan' | 'brown' | 'deep';
  hairStyle: 'short' | 'crop' | 'bob' | 'waves' | 'long' | 'curls' | 'coils' | 'ponytail';
  hairColor: 'black' | 'brown' | 'chestnut' | 'blonde' | 'copper' | 'pink' | 'purple' | 'blue';
  face: 'smile' | 'happy' | 'bright' | 'calm' | 'cheeky';
  accessory: 'none' | 'glasses' | 'round-glasses' | 'cap' | 'beanie' | 'headband';
  outfit: 'tee' | 'hoodie' | 'jacket' | 'sweater';
  outfitColor: 'purple' | 'indigo' | 'blue' | 'teal' | 'green' | 'coral' | 'pink' | 'gold';
  background: 'lilac' | 'sky' | 'mint' | 'peach' | 'sunny' | 'berry';
}

type ConfigKey = Exclude<keyof AvatarConfigV1, 'version'>;

/**
 * Closed allowlist of every selectable value for each avatar field. The catalog
 * of "options" is the same shape used by the AvatarCreator UI, by the data-URL
 * renderer (so it can never escape the allowlist), and by the random picker.
 */
export const AVATAR_CONFIG_OPTIONS: Readonly<Record<ConfigKey, ReadonlyArray<AvatarConfigV1[ConfigKey]>>> = {
  base: ['round', 'soft', 'bold'],
  skinTone: ['porcelain', 'fair', 'warm', 'tan', 'brown', 'deep'],
  hairStyle: ['short', 'crop', 'bob', 'waves', 'long', 'curls', 'coils', 'ponytail'],
  hairColor: ['black', 'brown', 'chestnut', 'blonde', 'copper', 'pink', 'purple', 'blue'],
  face: ['smile', 'happy', 'bright', 'calm', 'cheeky'],
  accessory: ['none', 'glasses', 'round-glasses', 'cap', 'beanie', 'headband'],
  outfit: ['tee', 'hoodie', 'jacket', 'sweater'],
  outfitColor: ['purple', 'indigo', 'blue', 'teal', 'green', 'coral', 'pink', 'gold'],
  background: ['lilac', 'sky', 'mint', 'peach', 'sunny', 'berry'],
};

/** Sensible default AvatarConfigV1 used by the avatar creator preview and tests. */
export const AVATAR_CONFIG_DEFAULT: AvatarConfigV1 = {
  version: 1,
  base: 'round',
  skinTone: 'warm',
  hairStyle: 'waves',
  hairColor: 'brown',
  face: 'smile',
  accessory: 'none',
  outfit: 'hoodie',
  outfitColor: 'purple',
  background: 'sky',
};

/** Validates an AvatarConfigV1 object against the closed schema. */
export function isValidAvatarConfig(config: unknown): config is AvatarConfigV1 {
  if (!config || typeof config !== 'object') return false;
  const c = config as Record<string, unknown>;
  const requiredKeys: Array<keyof AvatarConfigV1> = [
    'version', 'base', 'skinTone', 'hairStyle', 'hairColor', 'face',
    'accessory', 'outfit', 'outfitColor', 'background'
  ];
  if (!requiredKeys.every(k => k in c)) return false;
  if (c.version !== 1) return false;
  for (const key of requiredKeys) {
    if (key === 'version') continue;
    const allowed = AVATAR_CONFIG_OPTIONS[key];
    if (!allowed.includes(c[key] as AvatarConfigV1[ConfigKey])) return false;
  }
  // Ensure no extra keys
  if (Object.keys(c).length !== requiredKeys.length) return false;
  return true;
}

/**
 * Returns the config unchanged when it satisfies the closed allowlist;
 * otherwise returns null. Use this when you want to "trust" an
 * `avatarConfig` value from Firestore or a request payload — anything not
 * strictly in the allowlist must be discarded so it can never reach the
 * renderer or storage.
 */
export function normalizeAvatarConfig(config: unknown): AvatarConfigV1 | null {
  return isValidAvatarConfig(config) ? config : null;
}

/**
 * Pick a uniformly random allowlisted config. `random` is injectable so
 * the test suite can assert deterministic surprises (e.g. seeded to the last
 * option of every field).
 */
export function randomAvatarConfig(random: () => number = Math.random): AvatarConfigV1 {
  const pick = <K extends ConfigKey>(key: K): AvatarConfigV1[K] => {
    const options = AVATAR_CONFIG_OPTIONS[key] as readonly AvatarConfigV1[K][];
    const index = Math.min(
      options.length - 1,
      Math.max(0, Math.floor(random() * options.length)),
    );
    return options[index];
  };
  return {
    version: 1,
    base: pick('base'),
    skinTone: pick('skinTone'),
    hairStyle: pick('hairStyle'),
    hairColor: pick('hairColor'),
    face: pick('face'),
    accessory: pick('accessory'),
    outfit: pick('outfit'),
    outfitColor: pick('outfitColor'),
    background: pick('background'),
  };
}

/**
 * Render a deterministic, allowlist-only SVG data URL for the config. The
 * URL is built from the closed schema only — no user-supplied strings can
 * reach the markup, no `<script>` tags, no embedded URLs. The renderer is
 * intentionally a pure function of the config (no Math.random, no Date) so
 * the same config always produces the same bytes.
 */
export function avatarConfigToDataUrl(config: AvatarConfigV1): string {
  // Defensive: even though the schema is closed at runtime, never trust
  // callers. If a config somehow leaks through, fall back to the default
  // rather than emit anything attacker-controlled.
  const safe = isValidAvatarConfig(config) ? config : AVATAR_CONFIG_DEFAULT;

  // Map every field to a static palette + shape token. The mapping is purely
  // visual; the schema's job is to forbid anything that isn't in the allowlist,
  // and the renderer's job is to never echo the value back into the markup
  // except via the lookup table.
  const palette = {
    skinTone: {
      porcelain: '#fde7d3', fair: '#f6d4b0', warm: '#e6b48a',
      tan: '#c98a5f', brown: '#8b5a3c', deep: '#4d2e1f',
    },
    hairColor: {
      black: '#1f1f1f', brown: '#4a2c1a', chestnut: '#6b3a1f',
      blonde: '#d9b56a', copper: '#b35a2c', pink: '#f7a8c4',
      purple: '#8a4cc4', blue: '#3a73c4',
    },
    outfitColor: {
      purple: '#8a4cc4', indigo: '#3b3b8f', blue: '#3a73c4',
      teal: '#2a8f8f', green: '#3aa05a', coral: '#f08a6f',
      pink: '#f7a8c4', gold: '#d9b56a',
    },
    background: {
      lilac: '#e9defb', sky: '#cfe7fb', mint: '#cfeede',
      peach: '#fde0cc', sunny: '#fff0b3', berry: '#f3c4e2',
    },
  } as const;

  const skin = palette.skinTone[safe.skinTone];
  const hair = palette.hairColor[safe.hairColor];
  const outfitColorValue = palette.outfitColor[safe.outfitColor];
  const bg = palette.background[safe.background];

  // Face shape: a circle (round), rounded-square (soft), or pentagon-ish
  // polygon (bold). Each variant is hard-coded SVG geometry.
  const baseHead: Record<AvatarConfigV1['base'], string> = {
    round: `<circle cx="120" cy="120" r="62" fill="${skin}" />`,
    bold: `<circle cx="120" cy="120" r="64" fill="${skin}" />`,
    soft: `<circle cx="120" cy="120" r="58" fill="${skin}" />`,
  };

  const hairStyle: Record<AvatarConfigV1['hairStyle'], string> = {
    short: `<path d="M62 96 Q120 50 178 96 Q170 78 120 70 Q70 78 62 96 Z" fill="${hair}" />`,
    crop: `<path d="M70 100 Q120 60 170 100 L170 80 Q120 50 70 80 Z" fill="${hair}" />`,
    bob: `<path d="M58 110 Q120 40 182 110 L182 130 Q120 150 58 130 Z" fill="${hair}" />`,
    waves: `<path d="M58 100 Q70 60 120 55 Q170 60 182 100 Q170 130 120 130 Q70 130 58 100 Z" fill="${hair}" />`,
    long: `<path d="M48 110 Q60 30 120 30 Q180 30 192 110 L188 150 Q120 175 52 150 Z" fill="${hair}" />`,
    curls: `<circle cx="78" cy="78" r="22" fill="${hair}" /><circle cx="120" cy="58" r="26" fill="${hair}" /><circle cx="162" cy="78" r="22" fill="${hair}" /><circle cx="70" cy="110" r="20" fill="${hair}" /><circle cx="170" cy="110" r="20" fill="${hair}" />`,
    coils: `<circle cx="80" cy="78" r="18" fill="${hair}" /><circle cx="110" cy="62" r="20" fill="${hair}" /><circle cx="140" cy="62" r="20" fill="${hair}" /><circle cx="170" cy="78" r="18" fill="${hair}" />`,
    ponytail: `<path d="M58 100 Q120 50 182 100 L192 150 Q210 170 195 188 Q180 175 170 150 L58 130 Z" fill="${hair}" />`,
  };

  const face: Record<AvatarConfigV1['face'], string> = {
    smile: `<path d="M100 130 Q120 150 140 130" stroke="#1f1f1f" stroke-width="3" fill="none" stroke-linecap="round" />`,
    happy: `<path d="M96 130 Q120 158 144 130" stroke="#1f1f1f" stroke-width="3" fill="none" stroke-linecap="round" />`,
    bright: `<path d="M100 132 Q120 148 140 132" stroke="#1f1f1f" stroke-width="3" fill="none" stroke-linecap="round" />`,
    calm: `<path d="M104 132 Q120 138 136 132" stroke="#1f1f1f" stroke-width="2" fill="none" stroke-linecap="round" />`,
    cheeky: `<path d="M98 130 Q120 154 142 130" stroke="#1f1f1f" stroke-width="3" fill="none" stroke-linecap="round" />`,
  };

  const accessory: Record<AvatarConfigV1['accessory'], string> = {
    none: '',
    glasses: `<circle cx="100" cy="112" r="11" fill="none" stroke="#1f1f1f" stroke-width="2" /><circle cx="140" cy="112" r="11" fill="none" stroke="#1f1f1f" stroke-width="2" /><line x1="111" y1="112" x2="129" y2="112" stroke="#1f1f1f" stroke-width="2" />`,
    'round-glasses': `<circle cx="100" cy="112" r="13" fill="none" stroke="#1f1f1f" stroke-width="2" /><circle cx="140" cy="112" r="13" fill="none" stroke="#1f1f1f" stroke-width="2" />`,
    cap: `<path d="M64 84 Q120 38 176 84 L176 96 Q120 100 64 96 Z" fill="${hair}" /><path d="M176 88 Q210 92 210 102 L176 102 Z" fill="${hair}" />`,
    beanie: `<path d="M58 90 Q120 40 182 90 L182 104 Q120 116 58 104 Z" fill="${hair}" /><circle cx="120" cy="46" r="10" fill="${hair}" />`,
    headband: `<rect x="58" y="92" width="124" height="10" fill="${hair}" />`,
  };

  const outfitShapes: Record<AvatarConfigV1['outfit'], string> = {
    tee: `<path d="M40 220 L80 200 L100 220 L140 220 L160 200 L200 220 L180 260 L60 260 Z" fill="${outfitColorValue}" />`,
    hoodie: `<path d="M40 220 L80 200 L100 220 L140 220 L160 200 L200 220 L180 270 L60 270 Z" fill="${outfitColorValue}" /><path d="M100 220 Q120 240 140 220" fill="${bg}" />`,
    jacket: `<path d="M40 220 L80 200 L100 220 L140 220 L160 200 L200 220 L180 270 L60 270 Z" fill="${outfitColorValue}" /><line x1="120" y1="220" x2="120" y2="270" stroke="${bg}" stroke-width="3" />`,
    sweater: `<path d="M40 220 L80 200 L100 220 L140 220 L160 200 L200 220 L180 270 L60 270 Z" fill="${outfitColorValue}" /><path d="M70 240 L170 240 M70 250 L170 250" stroke="${bg}" stroke-width="2" />`,
  };

  const eyes = `<circle cx="100" cy="108" r="4" fill="#1f1f1f" /><circle cx="140" cy="108" r="4" fill="#1f1f1f" />`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 320" data-avatar-version="1">` +
    `<rect width="240" height="320" rx="32" fill="${bg}" />` +
    baseHead[safe.base] +
    hairStyle[safe.hairStyle] +
    accessory[safe.accessory] +
    eyes +
    face[safe.face] +
    outfitShapes[safe.outfit] +
    `</svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}