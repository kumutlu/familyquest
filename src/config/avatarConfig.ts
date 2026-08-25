export const AVATAR_CONFIG_OPTIONS = {
  base: ['round', 'soft', 'bold'],
  skinTone: ['porcelain', 'fair', 'warm', 'tan', 'brown', 'deep'],
  hairStyle: ['short', 'crop', 'bob', 'waves', 'long', 'curls', 'coils', 'ponytail'],
  hairColor: ['black', 'brown', 'chestnut', 'blonde', 'copper', 'pink', 'purple', 'blue'],
  face: ['smile', 'happy', 'bright', 'calm', 'cheeky'],
  accessory: ['none', 'glasses', 'round-glasses', 'cap', 'beanie', 'headband'],
  outfit: ['tee', 'hoodie', 'jacket', 'sweater'],
  outfitColor: ['purple', 'indigo', 'blue', 'teal', 'green', 'coral', 'pink', 'gold'],
  background: ['lilac', 'sky', 'mint', 'peach', 'sunny', 'berry'],
} as const;

type Option<K extends keyof typeof AVATAR_CONFIG_OPTIONS> = (typeof AVATAR_CONFIG_OPTIONS)[K][number];

export interface AvatarConfigV1 {
  version: 1;
  base: Option<'base'>;
  skinTone: Option<'skinTone'>;
  hairStyle: Option<'hairStyle'>;
  hairColor: Option<'hairColor'>;
  face: Option<'face'>;
  accessory: Option<'accessory'>;
  outfit: Option<'outfit'>;
  outfitColor: Option<'outfitColor'>;
  background: Option<'background'>;
}

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
  background: 'lilac',
};

const CONFIG_KEYS = ['version', ...Object.keys(AVATAR_CONFIG_OPTIONS)] as const;

export function isValidAvatarConfig(value: unknown): value is AvatarConfigV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== CONFIG_KEYS.length || !CONFIG_KEYS.every(key => keys.includes(key))) return false;
  if (record.version !== 1) return false;
  return (Object.keys(AVATAR_CONFIG_OPTIONS) as Array<keyof typeof AVATAR_CONFIG_OPTIONS>)
    .every(key => typeof record[key] === 'string' && (AVATAR_CONFIG_OPTIONS[key] as readonly string[]).includes(record[key] as string));
}

export function normalizeAvatarConfig(value: unknown): AvatarConfigV1 | null {
  return isValidAvatarConfig(value) ? { ...value } : null;
}

export function randomAvatarConfig(random: () => number = Math.random): AvatarConfigV1 {
  const pick = <K extends keyof typeof AVATAR_CONFIG_OPTIONS>(key: K): Option<K> => {
    const options = AVATAR_CONFIG_OPTIONS[key];
    return options[Math.min(options.length - 1, Math.floor(Math.max(0, random()) * options.length))] as Option<K>;
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

const SKIN: Record<AvatarConfigV1['skinTone'], string> = {
  porcelain: '#f8d8c6', fair: '#efc2a2', warm: '#d99b73', tan: '#bd7955', brown: '#8b5138', deep: '#583123',
};
const HAIR: Record<AvatarConfigV1['hairColor'], string> = {
  black: '#24202b', brown: '#57382b', chestnut: '#84472f', blonde: '#e6bd62', copper: '#b95d39', pink: '#d85d91', purple: '#7651a8', blue: '#397bb5',
};
const OUTFIT: Record<AvatarConfigV1['outfitColor'], string> = {
  purple: '#7c5ce5', indigo: '#4f46e5', blue: '#3b82c4', teal: '#249e91', green: '#48a867', coral: '#ed756a', pink: '#d85d91', gold: '#d69a2d',
};
const BACKGROUND: Record<AvatarConfigV1['background'], string> = {
  lilac: '#e8e2ff', sky: '#dceeff', mint: '#d9f5e9', peach: '#ffe4d6', sunny: '#fff1bd', berry: '#f4daef',
};

function hairMarkup(config: AvatarConfigV1): string {
  const fill = HAIR[config.hairColor];
  const shapes: Record<AvatarConfigV1['hairStyle'], string> = {
    short: `<path d="M29 47 Q30 17 60 18 Q87 19 89 48 Q76 33 60 36 Q43 32 29 47" fill="${fill}"/>`,
    crop: `<path d="M31 40 Q39 15 62 18 Q82 19 88 42 Q71 31 55 34 Q42 29 31 40" fill="${fill}"/>`,
    bob: `<path d="M25 50 Q25 16 60 17 Q94 18 94 57 L84 72 L79 45 Q62 32 39 43 L35 72 L25 60Z" fill="${fill}"/>`,
    waves: `<path d="M24 62 Q20 24 56 17 Q91 17 96 57 Q88 45 80 51 Q72 31 57 39 Q41 27 31 52 Q30 64 24 62" fill="${fill}"/>`,
    long: `<path d="M23 72 Q18 22 57 16 Q97 20 96 74 L82 88 L80 45 Q58 30 37 45 L35 88Z" fill="${fill}"/>`,
    curls: `<g fill="${fill}"><circle cx="31" cy="40" r="14"/><circle cx="43" cy="27" r="14"/><circle cx="59" cy="24" r="15"/><circle cx="76" cy="28" r="14"/><circle cx="87" cy="43" r="14"/><circle cx="27" cy="57" r="12"/><circle cx="91" cy="59" r="12"/></g>`,
    coils: `<g fill="${fill}"><circle cx="30" cy="39" r="12"/><circle cx="40" cy="25" r="12"/><circle cx="54" cy="20" r="12"/><circle cx="69" cy="22" r="12"/><circle cx="82" cy="31" r="12"/><circle cx="89" cy="46" r="12"/></g>`,
    ponytail: `<circle cx="94" cy="51" r="17" fill="${fill}"/><path d="M28 47 Q30 17 60 18 Q87 19 89 48 Q74 31 58 37 Q42 30 28 47" fill="${fill}"/>`,
  };
  return shapes[config.hairStyle];
}

function faceMarkup(face: AvatarConfigV1['face']): string {
  const mouths: Record<AvatarConfigV1['face'], string> = {
    smile: '<path d="M50 67 Q60 76 70 67" fill="none" stroke="#332b3c" stroke-width="3" stroke-linecap="round"/>',
    happy: '<path d="M49 66 Q60 80 71 66 Q60 72 49 66" fill="#6e3442"/>',
    bright: '<path d="M51 68 Q60 73 69 68" fill="none" stroke="#332b3c" stroke-width="3" stroke-linecap="round"/><circle cx="44" cy="55" r="4" fill="#332b3c"/><circle cx="76" cy="55" r="4" fill="#332b3c"/>',
    calm: '<path d="M52 69 Q60 72 68 69" fill="none" stroke="#332b3c" stroke-width="3" stroke-linecap="round"/>',
    cheeky: '<path d="M51 68 Q62 77 70 65" fill="none" stroke="#332b3c" stroke-width="3" stroke-linecap="round"/>',
  };
  const eyes = face === 'happy'
    ? '<path d="M39 55 Q44 49 49 55 M71 55 Q76 49 81 55" fill="none" stroke="#332b3c" stroke-width="3" stroke-linecap="round"/>'
    : face === 'bright' ? '' : '<circle cx="44" cy="55" r="3.5" fill="#332b3c"/><circle cx="76" cy="55" r="3.5" fill="#332b3c"/>';
  return eyes + mouths[face];
}

function accessoryMarkup(accessory: AvatarConfigV1['accessory']): string {
  const items: Record<AvatarConfigV1['accessory'], string> = {
    none: '',
    glasses: '<path d="M34 52 H53 M67 52 H86 M53 52 Q60 48 67 52" stroke="#45405a" stroke-width="3"/><rect x="34" y="47" width="19" height="14" rx="4" fill="none" stroke="#45405a" stroke-width="3"/><rect x="67" y="47" width="19" height="14" rx="4" fill="none" stroke="#45405a" stroke-width="3"/>',
    'round-glasses': '<circle cx="45" cy="54" r="10" fill="none" stroke="#45405a" stroke-width="3"/><circle cx="75" cy="54" r="10" fill="none" stroke="#45405a" stroke-width="3"/><path d="M55 53 Q60 49 65 53" stroke="#45405a" stroke-width="3"/>',
    cap: '<path d="M31 35 Q40 16 65 18 Q84 20 88 37 Z" fill="#4f46e5"/><path d="M57 36 Q78 31 94 39 Q76 43 57 40Z" fill="#3730a3"/>',
    beanie: '<path d="M31 38 Q36 13 61 14 Q85 16 89 39Z" fill="#7c5ce5"/><rect x="29" y="34" width="62" height="10" rx="5" fill="#5b3fc2"/>',
    headband: '<path d="M30 38 Q58 23 88 39" fill="none" stroke="#ed756a" stroke-width="7"/>',
  };
  return items[accessory];
}

export function avatarConfigToDataUrl(value: AvatarConfigV1): string {
  if (!isValidAvatarConfig(value)) throw new Error('Invalid avatar configuration');
  const faceRx = value.base === 'round' ? 31 : value.base === 'soft' ? 29 : 33;
  const faceRy = value.base === 'bold' ? 32 : 35;
  const outfitDetail = value.outfit === 'hoodie' ? '<path d="M43 91 Q60 105 77 91" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="3"/>'
    : value.outfit === 'jacket' ? '<path d="M60 84 V120 M47 87 L60 98 L73 87" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="3"/>'
      : value.outfit === 'sweater' ? '<path d="M39 96 H81" stroke="rgba(255,255,255,.7)" stroke-width="4"/>' : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" data-avatar-version="1" data-base="${value.base}" data-outfit="${value.outfit}"><rect width="120" height="120" rx="28" fill="${BACKGROUND[value.background]}"/><circle cx="21" cy="22" r="6" fill="rgba(255,255,255,.55)"/><circle cx="101" cy="31" r="4" fill="rgba(255,255,255,.7)"/><path d="M25 120 Q28 82 60 82 Q92 82 95 120Z" fill="${OUTFIT[value.outfitColor]}"/>${outfitDetail}<ellipse cx="60" cy="53" rx="${faceRx}" ry="${faceRy}" fill="${SKIN[value.skinTone]}"/>${hairMarkup(value)}<ellipse cx="35" cy="64" rx="5" ry="3" fill="rgba(222,91,101,.22)"/><ellipse cx="85" cy="64" rx="5" ry="3" fill="rgba(222,91,101,.22)"/>${faceMarkup(value.face)}${accessoryMarkup(value.accessory)}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
