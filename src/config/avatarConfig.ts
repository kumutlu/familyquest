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

/** Validates an AvatarConfigV1 object against the closed schema. */
export function isValidAvatarConfig(config: unknown): config is AvatarConfigV1 {
  if (!config || typeof config !== 'object') return false;
  const c = config as Record<string, unknown>;
  const requiredKeys = [
    'version', 'base', 'skinTone', 'hairStyle', 'hairColor', 'face',
    'accessory', 'outfit', 'outfitColor', 'background'
  ];
  if (!requiredKeys.every(k => k in c)) return false;
  if (c.version !== 1) return false;
  const allowed = {
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
  for (const [key, values] of Object.entries(allowed)) {
    if (!values.includes(c[key] as string)) return false;
  }
  // Ensure no extra keys
  if (Object.keys(c).length !== requiredKeys.length) return false;
  return true;
}