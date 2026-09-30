/**
 * Asset manifest for Seasonal Worlds.
 *
 * Vite resolves the imported URLs at build time so the deployed
 * bundle ships hashed, immutable asset paths. Importing here keeps
 * the renderer purely declarative — the renderer just looks up
 * `ASSET_MANIFEST[worldId][name]` and gets back a string URL.
 *
 * No raster backgrounds here on purpose. Every asset is a tiny SVG
 * (≤ 2 KB). The renderer places them with CSS so we never ship a
 * "giant PNG/JPEG screenshot behind the application".
 */

import pineCorner from './christmas/pine-corner.svg';
import snowflake from './christmas/snowflake.svg';
import bats from './halloween/bats.svg';
import pumpkin from './halloween/pumpkin.svg';
import halloweenHorizon from './halloween/horizon.svg';
import lantern from './eid/lantern.svg';
import crescent from './eid/crescent.svg';
import eidPattern from './eid/pattern.svg';
import normalStars from './normal/stars.svg';
import normalHorizon from './normal/horizon.svg';
import type { WorldId } from '../../domain/experienceWorld/types';

/**
 * One bundle of asset URLs for a world. `undefined` when a slot has
 * no asset (e.g. some worlds ship a moon as a CSS-only decoration).
 */
export interface WorldAssetBundle {
  readonly 'pine-corner'?: string;
  readonly snowflake?: string;
  readonly bats?: string;
  readonly pumpkin?: string;
  readonly halloweenHorizon?: string;
  readonly lantern?: string;
  readonly crescent?: string;
  readonly eidPattern?: string;
  readonly stars?: string;
  readonly horizon?: string;
}

export const ASSET_MANIFEST: Readonly<Record<WorldId, WorldAssetBundle>> = Object.freeze({
  'world.normal': Object.freeze({
    stars: normalStars,
    horizon: normalHorizon,
  }) as WorldAssetBundle,
  'world.christmas': Object.freeze({
    'pine-corner': pineCorner,
    snowflake,
  }) as WorldAssetBundle,
  'world.halloween': Object.freeze({
    bats,
    pumpkin,
    halloweenHorizon,
  }) as WorldAssetBundle,
  'world.eid': Object.freeze({
    lantern,
    crescent,
    eidPattern,
  }) as WorldAssetBundle,
  'world.ramadan': Object.freeze({
    lantern,
    crescent,
    eidPattern,
  }) as WorldAssetBundle,
  'world.neon': Object.freeze({}) as WorldAssetBundle,
  // Shop worlds are pure CSS backdrops today (warm-bokeh gradient family);
  // they need no SVG slots, but the manifest must stay total over WorldId.
  'world.space': Object.freeze({}) as WorldAssetBundle,
  'world.rainbow': Object.freeze({}) as WorldAssetBundle,
  'world.pixel': Object.freeze({}) as WorldAssetBundle,
  'world.calm': Object.freeze({}) as WorldAssetBundle,
});
