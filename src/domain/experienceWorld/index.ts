/**
 * Public surface of the Seasonal World Layer.
 *
 * Anything that participates in world rendering imports from here.
 * Components NEVER reach into `catalog.ts` directly.
 */

export type {
  WorldId,
  DecorationSlot,
  WorldDecoration,
  ParticleKind,
  WorldParticles,
  WorldPalette,
  WorldTexture,
  WorldDefinition,
  ResolveWorldInput,
  ResolvedWorld,
} from './types';

export {
  WORLD_CATALOG,
  NORMAL_WORLD,
  CHRISTMAS_WORLD,
  HALLOWEEN_WORLD,
  EID_WORLD,
  RAMADAN_WORLD,
  NEON_WORLD,
  SPACE_WORLD,
  RAINBOW_WORLD,
  PIXEL_WORLD,
  CALM_WORLD,
  THEME_ID_TO_WORLD_ID,
  getWorldById,
} from './catalog';

export { resolveWorld, listWorlds } from './resolver';
