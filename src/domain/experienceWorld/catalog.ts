/**
 * FamilyQuest / Queki — Seasonal World Catalog (V1).
 *
 * Pure data. Worlds are CONTENT, not code. Adding Diwali / Hanukkah /
 * Lunar New Year is a one-line addition here. The renderer is generic.
 *
 * Each world defines:
 *   - lightPalette / darkPalette   (CSS strings — safe to ship)
 *   - texture                       (CSS class hint)
 *   - decorations                   (corners / edges / horizon)
 *   - particles                     (subtle drift / sparkle)
 *   - seasonalLine                  (short deterministic copy)
 *
 * The renderer never inspects `id` for behaviour. It paints.
 *
 * PALETTE CONTRACT
 * ----------------
 * Light and Dark palettes are NOT inverted copies. Each world tunes
 * its own dark/light so the world reads correctly in both modes. The
 * brief explicitly says: "Do NOT simply invert assets."
 */

import type { WorldDefinition, WorldId, WorldDecoration } from './types';

/* -------------------------------------------------------------------------- */
/* Shared decoration payloads                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A tiny inline SVG star field used by the Normal world. Kept as
 * inline markup so the renderer does not need an extra asset request
 * and the markup survives CSS-only / no-asset environments (CI, tests).
 */
const NORMAL_STARS_INLINE = `
<svg viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g fill="rgba(255,255,255,0.85)">
    <circle cx="20" cy="20" r="0.9" />
    <circle cx="60" cy="48" r="0.7" />
    <circle cx="120" cy="14" r="1.1" />
    <circle cx="190" cy="34" r="0.8" />
    <circle cx="240" cy="12" r="0.7" />
    <circle cx="300" cy="44" r="1" />
    <circle cx="350" cy="20" r="0.6" />
    <circle cx="100" cy="80" r="0.6" />
    <circle cx="180" cy="110" r="0.8" />
    <circle cx="260" cy="98" r="0.6" />
    <circle cx="330" cy="120" r="0.9" />
    <circle cx="40" cy="150" r="0.6" />
    <circle cx="140" cy="170" r="0.7" />
    <circle cx="220" cy="150" r="0.6" />
    <circle cx="370" cy="170" r="0.7" />
  </g>
</svg>`.trim();

/**
 * Christmas pine branch silhouette (top corners). Inline SVG so the
 * world layer can render even when the asset CDN is unreachable.
 */
const CHRISTMAS_PINE_BRANCH = `
<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round">
    <path d="M0 0 C 40 30 60 60 60 100" />
    <path d="M0 0 C 60 40 90 60 100 90" />
    <path d="M30 30 C 50 50 65 75 70 100" />
  </g>
  <g fill="currentColor" opacity="0.85">
    <path d="M58 96 l 6 8 -2 -10 8 4 -4 -8 8 -2 -8 -2 4 -8 -8 4 2 -10 -6 8 -2 -8 -2 8 -6 -8 2 10 -8 -4 4 8 -8 2 8 2 -4 8 8 -4 -2 10 z" />
    <path d="M68 70 l 4 6 -2 -7 6 3 -3 -6 6 -2 -6 -2 3 -6 -6 3 2 -7 -4 6 -2 -6 -2 6 -4 -6 2 7 -6 -3 3 6 -6 2 6 2 -3 6 6 -3 -2 7 z" />
  </g>
</svg>`.trim();

/**
 * Christmas snowflake ornament. Renders as a small SVG used in the
 * top-edge and used as inline content for particles too.
 */
const CHRISTMAS_SNOWFLAKE = `
<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
    <line x1="12" y1="2" x2="12" y2="22" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <line x1="5" y1="5" x2="19" y2="19" />
    <line x1="19" y1="5" x2="5" y2="19" />
    <path d="M12 6 l -1.5 -2 M12 6 l 1.5 -2" />
    <path d="M12 18 l -1.5 2 M12 18 l 1.5 2" />
    <path d="M6 12 l -2 -1.5 M6 12 l -2 1.5" />
    <path d="M18 12 l 2 -1.5 M18 12 l 2 1.5" />
  </g>
</svg>`.trim();

/**
 * Halloween bat silhouette. Pure path. Tiny, two-tone.
 */
const HALLOWEEN_BAT = `
<svg viewBox="0 0 64 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path
    d="M32 6
       C 30 8 28 8 24 8
       C 18 8 12 12 4 16
       C 10 16 14 18 16 22
       C 12 22 8 24 6 28
       C 14 26 20 26 26 24
       C 28 22 30 22 32 22
       C 34 22 36 22 38 24
       C 44 26 50 26 58 28
       C 56 24 52 22 48 22
       C 50 18 54 16 60 16
       C 52 12 46 8 40 8
       C 36 8 34 8 32 6 Z"
    fill="currentColor" />
</svg>`.trim();

/**
 * Halloween pumpkin silhouette. Decorative only — no scary face.
 */
const HALLOWEEN_PUMPKIN = `
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g fill="currentColor">
    <ellipse cx="32" cy="38" rx="22" ry="18" />
    <ellipse cx="22" cy="40" rx="10" ry="14" opacity="0.6" />
    <ellipse cx="42" cy="40" rx="10" ry="14" opacity="0.6" />
    <path d="M32 22 c -2 -6 0 -10 4 -10 c -2 4 0 6 2 8 z" />
  </g>
  <g fill="#1a1530" opacity="0.55">
    <path d="M24 34 l 4 4 4 -4 -4 -2 z" />
    <path d="M34 34 l 4 4 4 -4 -4 -2 z" />
    <path d="M28 44 q 4 4 8 0 z" />
  </g>
</svg>`.trim();

/**
 * Eid hanging lantern. Warm gold.
 */
const EID_LANTERN = `
<svg viewBox="0 0 64 96" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g>
    <line x1="32" y1="0" x2="32" y2="14" stroke="currentColor" stroke-width="1" />
    <rect x="26" y="14" width="12" height="4" rx="1" fill="currentColor" />
    <path
      d="M22 22
         C 14 30 14 60 22 72
         C 28 82 36 82 42 72
         C 50 60 50 30 42 22 Z"
      fill="currentColor" opacity="0.95" />
    <ellipse cx="32" cy="50" rx="10" ry="22" fill="rgba(255,255,255,0.35)" />
    <rect x="26" y="72" width="12" height="4" rx="1" fill="currentColor" />
    <line x1="32" y1="76" x2="32" y2="92" stroke="currentColor" stroke-width="1" />
    <circle cx="32" cy="94" r="2" fill="currentColor" />
  </g>
</svg>`.trim();

/**
 * Eid crescent moon. Calm, decorative.
 */
const EID_CRESCENT = `
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <mask id="eid-moon-mask">
      <rect width="64" height="64" fill="white" />
      <circle cx="40" cy="32" r="22" fill="black" />
    </mask>
  </defs>
  <circle cx="32" cy="32" r="26" fill="currentColor" mask="url(#eid-moon-mask)" />
</svg>`.trim();

/* -------------------------------------------------------------------------- */
/* Worlds                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Normal / default Queki world.
 *
 * Mood: deep purple / indigo, calm, magical, playful.
 *
 * Decorations are sparse. A few stars up top, a faint hill silhouette
 * at the horizon, an occasional sparkle. The base world must NOT feel
 * empty — but it must stay calm so seasonal worlds feel like a
 * genuine shift.
 */
export const NORMAL_WORLD: WorldDefinition = Object.freeze({
  id: 'world.normal',
  name: 'Queki World',
  lightPalette: Object.freeze({
    ambientFrom: '#f5f3fb',
    ambientTo: '#ffffff',
    accent: '#7c3aed',
    accentSoft: 'rgba(124, 58, 237, 0.10)',
    glowA: 'rgba(124, 58, 237, 0.10)',
    glowB: 'rgba(99, 102, 241, 0.08)',
  }),
  darkPalette: Object.freeze({
    ambientFrom: '#1a1530',
    ambientTo: '#2a2349',
    accent: '#a78bfa',
    accentSoft: 'rgba(167, 139, 250, 0.18)',
    glowA: 'rgba(124, 58, 237, 0.22)',
    glowB: 'rgba(99, 102, 241, 0.18)',
  }),
  texture: 'starlight',
  decorations: Object.freeze([
    {
      id: 'normal-stars-top',
      slot: 'top-edge',
      inlineSvg: NORMAL_STARS_INLINE,
      opacity: 0.6,
      widthFraction: 1,
      heightFraction: 0.18,
    },
    {
      id: 'normal-horizon',
      slot: 'horizon',
      opacity: 0.35,
      widthFraction: 1,
      heightFraction: 0.16,
    },
  ]),
  particles: Object.freeze({ kind: 'sparkle', density: 0.18 }) as WorldDefinition['particles'],
}) as WorldDefinition;

/**
 * Christmas world — cosy, festive, warm.
 *
 * Deep Queki night + warm red/gold atmospheric edge glow + pine
 * corners + snow + mascot Santa hat (driven by mascot engine).
 *
 * The renderer places pine at top-left and top-right, snowflakes
 * drift slowly, and the texture is snow.
 */
export const CHRISTMAS_WORLD: WorldDefinition = Object.freeze({
  id: 'world.christmas',
  name: 'Festive Lights',
  eventId: 'event.christmas.2026',
  lightPalette: Object.freeze({
    ambientFrom: '#eef4fb',
    ambientTo: '#fff7ed',
    accent: '#b91c1c',
    accentSoft: 'rgba(248, 113, 113, 0.18)',
    glowA: 'rgba(220, 38, 38, 0.18)',
    glowB: 'rgba(252, 211, 77, 0.18)',
  }),
  darkPalette: Object.freeze({
    ambientFrom: '#0f172a',
    ambientTo: '#3f1d1d',
    accent: '#f87171',
    accentSoft: 'rgba(248, 113, 113, 0.22)',
    glowA: 'rgba(220, 38, 38, 0.28)',
    glowB: 'rgba(252, 211, 77, 0.22)',
  }),
  texture: 'snow',
  decorations: Object.freeze([
    {
      id: 'christmas-pine-top-left',
      slot: 'top-left',
      inlineSvg: CHRISTMAS_PINE_BRANCH,
      opacity: 0.55,
      widthFraction: 0.22,
      heightFraction: 0.22,
    },
    {
      id: 'christmas-pine-top-right',
      slot: 'top-right',
      inlineSvg: CHRISTMAS_PINE_BRANCH,
      opacity: 0.55,
      widthFraction: 0.22,
      heightFraction: 0.22,
    },
    {
      id: 'christmas-snowflake-edge',
      slot: 'top-edge',
      inlineSvg: CHRISTMAS_SNOWFLAKE,
      opacity: 0.6,
      widthFraction: 0.6,
      heightFraction: 0.05,
    },
    {
      id: 'christmas-snow-horizon',
      slot: 'horizon',
      opacity: 0.45,
      widthFraction: 1,
      heightFraction: 0.18,
    },
  ]),
  particles: Object.freeze({
    kind: 'snow',
    density: 0.32,
    drift: 0.6,
  }) as WorldDefinition['particles'],
  seasonalLine: "Queki's ready for a cosy Christmas quest!",
}) as WorldDefinition;

/**
 * Halloween world — spooky but child-appropriate.
 *
 * Crescent moon, friendly bats, soft fog, tiny pumpkins at world
 * edges, distant crooked hill silhouette, amber-orange edge glow.
 *
 * NO gore, NO horror imagery. Family-friendly.
 */
export const HALLOWEEN_WORLD: WorldDefinition = Object.freeze({
  id: 'world.halloween',
  name: 'Friendly Spooks',
  eventId: 'event.halloween.2026',
  lightPalette: Object.freeze({
    ambientFrom: '#fdf6e3',
    ambientTo: '#fff7ed',
    accent: '#7c3aed',
    accentSoft: 'rgba(167, 139, 250, 0.18)',
    glowA: 'rgba(124, 58, 237, 0.18)',
    glowB: 'rgba(251, 191, 36, 0.20)',
  }),
  darkPalette: Object.freeze({
    ambientFrom: '#1a1530',
    ambientTo: '#2a1d2a',
    accent: '#a78bfa',
    accentSoft: 'rgba(167, 139, 250, 0.22)',
    glowA: 'rgba(124, 58, 237, 0.30)',
    glowB: 'rgba(251, 146, 60, 0.22)',
  }),
  texture: 'fog',
  decorations: Object.freeze([
    {
      id: 'halloween-moon-top-right',
      slot: 'top-right',
      // Simple soft circle (CSS will style the colour); keeps the
      // decoration declarative and small.
      opacity: 0.7,
      widthFraction: 0.16,
      heightFraction: 0.16,
    },
    {
      id: 'halloween-bats-top',
      slot: 'top-edge',
      inlineSvg: HALLOWEEN_BAT,
      opacity: 0.55,
      widthFraction: 0.4,
      heightFraction: 0.08,
    },
    {
      id: 'halloween-pumpkin-bottom-left',
      slot: 'bottom-left',
      inlineSvg: HALLOWEEN_PUMPKIN,
      opacity: 0.55,
      widthFraction: 0.14,
      heightFraction: 0.14,
    },
    {
      id: 'halloween-pumpkin-bottom-right',
      slot: 'bottom-right',
      inlineSvg: HALLOWEEN_PUMPKIN,
      opacity: 0.45,
      widthFraction: 0.12,
      heightFraction: 0.12,
    },
    {
      id: 'halloween-horizon',
      slot: 'horizon',
      opacity: 0.45,
      widthFraction: 1,
      heightFraction: 0.20,
    },
  ]),
  particles: Object.freeze({
    kind: 'fog-mote',
    density: 0.22,
  }) as WorldDefinition['particles'],
  seasonalLine: 'Spooky season is here!',
}) as WorldDefinition;

/**
 * Eid world — peaceful, joyful, celebratory.
 *
 * Crescent moon, hanging lanterns, stars, very subtle geometric
 * pattern, warm gold lights, distant city silhouette only if
 * culturally tasteful and visually restrained.
 *
 * NOT religious-heavy. NOT intrusive. Activated only through the
 * existing family seasonal preference.
 */
export const EID_WORLD: WorldDefinition = Object.freeze({
  id: 'world.eid',
  name: 'Eid Celebration',
  eventId: 'event.eid.2026',
  lightPalette: Object.freeze({
    ambientFrom: '#f3f0ff',
    ambientTo: '#fffbe6',
    accent: '#047857',
    accentSoft: 'rgba(16, 185, 129, 0.18)',
    glowA: 'rgba(16, 185, 129, 0.16)',
    glowB: 'rgba(252, 211, 77, 0.18)',
  }),
  darkPalette: Object.freeze({
    ambientFrom: '#0e1f3a',
    ambientTo: '#1d2a3f',
    accent: '#34d399',
    accentSoft: 'rgba(52, 211, 153, 0.22)',
    glowA: 'rgba(252, 211, 77, 0.22)',
    glowB: 'rgba(16, 185, 129, 0.20)',
  }),
  texture: 'pattern-subtle',
  decorations: Object.freeze([
    {
      id: 'eid-crescent-top-left',
      slot: 'top-left',
      inlineSvg: EID_CRESCENT,
      opacity: 0.6,
      widthFraction: 0.16,
      heightFraction: 0.16,
    },
    {
      id: 'eid-lantern-top-edge',
      slot: 'top-edge',
      inlineSvg: EID_LANTERN,
      opacity: 0.6,
      widthFraction: 0.5,
      heightFraction: 0.16,
    },
    {
      id: 'eid-stars-edge',
      slot: 'top-edge',
      inlineSvg: NORMAL_STARS_INLINE,
      opacity: 0.45,
      widthFraction: 0.6,
      heightFraction: 0.10,
    },
    {
      id: 'eid-horizon',
      slot: 'horizon',
      opacity: 0.35,
      widthFraction: 1,
      heightFraction: 0.16,
    },
  ]),
  particles: Object.freeze({
    kind: 'gold-dust',
    density: 0.24,
  }) as WorldDefinition['particles'],
  seasonalLine: 'Eid Mubarak! Ready for today\'s quests?',
}) as WorldDefinition;

/**
 * Ramadan world — same language as Eid, plus deeper night atmosphere.
 * Future compatibility per the brief.
 */
export const RAMADAN_WORLD: WorldDefinition = Object.freeze({
  id: 'world.ramadan',
  name: 'Lanterns & Stars',
  eventId: 'event.ramadan.2026',
  lightPalette: Object.freeze({
    ambientFrom: '#f3f0ff',
    ambientTo: '#fefce8',
    accent: '#0d9488',
    accentSoft: 'rgba(20, 184, 166, 0.18)',
    glowA: 'rgba(20, 184, 166, 0.16)',
    glowB: 'rgba(252, 211, 77, 0.18)',
  }),
  darkPalette: Object.freeze({
    ambientFrom: '#0b1530',
    ambientTo: '#1a2240',
    accent: '#2dd4bf',
    accentSoft: 'rgba(45, 212, 191, 0.22)',
    glowA: 'rgba(20, 184, 166, 0.24)',
    glowB: 'rgba(252, 211, 77, 0.20)',
  }),
  texture: 'pattern-subtle',
  decorations: Object.freeze([
    {
      id: 'ramadan-crescent-top-left',
      slot: 'top-left',
      inlineSvg: EID_CRESCENT,
      opacity: 0.6,
      widthFraction: 0.14,
      heightFraction: 0.14,
    },
    {
      id: 'ramadan-lantern-top-edge',
      slot: 'top-edge',
      inlineSvg: EID_LANTERN,
      opacity: 0.55,
      widthFraction: 0.5,
      heightFraction: 0.16,
    },
    {
      id: 'ramadan-horizon',
      slot: 'horizon',
      opacity: 0.30,
      widthFraction: 1,
      heightFraction: 0.18,
    },
  ]),
  particles: Object.freeze({
    kind: 'star-twinkle',
    density: 0.20,
  }) as WorldDefinition['particles'],
  seasonalLine: 'A peaceful, kind week — let\'s take it quest by quest.',
}) as WorldDefinition;

/**
 * Neon Week — weekly accent (not a holiday). Reuses the
 * theme.christmas-style glow on a darker, more electric palette.
 *
 * The brief notes that Neon Week must not turn the quest sheet cyan.
 * We honour that: the world layer only paints the BACKGROUND; core
 * surfaces stay Queki surfaces.
 */
export const NEON_WORLD: WorldDefinition = Object.freeze({
  id: 'world.neon',
  name: 'Neon Week',
  eventId: 'event.weekly.neon',
  lightPalette: Object.freeze({
    ambientFrom: '#eef9ff',
    ambientTo: '#ffffff',
    accent: '#06b6d4',
    accentSoft: 'rgba(34, 211, 238, 0.18)',
    glowA: 'rgba(34, 211, 238, 0.20)',
    glowB: 'rgba(99, 102, 241, 0.14)',
  }),
  darkPalette: Object.freeze({
    ambientFrom: '#0f172a',
    ambientTo: '#1e1b4b',
    accent: '#22d3ee',
    accentSoft: 'rgba(34, 211, 238, 0.22)',
    glowA: 'rgba(34, 211, 238, 0.30)',
    glowB: 'rgba(99, 102, 241, 0.22)',
  }),
  texture: 'starlight',
  decorations: Object.freeze([
    {
      id: 'neon-horizon',
      slot: 'horizon',
      opacity: 0.30,
      widthFraction: 1,
      heightFraction: 0.20,
    },
  ]),
  particles: Object.freeze({
    kind: 'sparkle',
    density: 0.28,
  }) as WorldDefinition['particles'],
}) as WorldDefinition;

/**
 * Space Explorer world — premium shop world. Deep night-blue sky, faint
 * nebula glows and a star twinkle particle field. Shares the calm,
 * non-noisy contract of every world: decoration is atmospheric only.
 */
export const SPACE_WORLD: WorldDefinition = Object.freeze({
  id: 'world.space',
  name: 'Space Explorer',
  lightPalette: Object.freeze({
    ambientFrom: '#eef2fb',
    ambientTo: '#ffffff',
    accent: '#4f46e5',
    accentSoft: 'rgba(79, 70, 229, 0.12)',
    glowA: 'rgba(79, 70, 229, 0.14)',
    glowB: 'rgba(14, 165, 233, 0.10)',
  }),
  darkPalette: Object.freeze({
    ambientFrom: '#0b1026',
    ambientTo: '#1e1b4b',
    accent: '#818cf8',
    accentSoft: 'rgba(129, 140, 248, 0.20)',
    glowA: 'rgba(129, 140, 248, 0.26)',
    glowB: 'rgba(56, 189, 248, 0.20)',
  }),
  texture: 'starlight',
  decorations: Object.freeze([
    {
      id: 'space-horizon',
      slot: 'horizon',
      opacity: 0.32,
      widthFraction: 1,
      heightFraction: 0.18,
    },
  ]),
  particles: Object.freeze({
    kind: 'star-twinkle',
    density: 0.30,
  }) as WorldDefinition['particles'],
}) as WorldDefinition;

/**
 * Rainbow Pop world — bright, playful, colourful. The pattern layer
 * carries the playfulness; core surfaces stay Queki surfaces.
 */
export const RAINBOW_WORLD: WorldDefinition = Object.freeze({
  id: 'world.rainbow',
  name: 'Rainbow Pop',
  lightPalette: Object.freeze({
    ambientFrom: '#fdf4ff',
    ambientTo: '#ffffff',
    accent: '#d946ef',
    accentSoft: 'rgba(217, 70, 239, 0.10)',
    glowA: 'rgba(244, 114, 182, 0.14)',
    glowB: 'rgba(250, 204, 21, 0.12)',
  }),
  darkPalette: Object.freeze({
    ambientFrom: '#2a1240',
    ambientTo: '#3b0764',
    accent: '#f0abfc',
    accentSoft: 'rgba(240, 171, 252, 0.20)',
    glowA: 'rgba(244, 114, 182, 0.24)',
    glowB: 'rgba(250, 204, 21, 0.16)',
  }),
  texture: 'warm-bokeh',
  decorations: Object.freeze([
    {
      id: 'rainbow-horizon',
      slot: 'horizon',
      opacity: 0.35,
      widthFraction: 1,
      heightFraction: 0.16,
    },
  ]),
  particles: Object.freeze({
    kind: 'sparkle',
    density: 0.26,
  }) as WorldDefinition['particles'],
}) as WorldDefinition;

/**
 * Pixel Quest world — subtle retro influence. The horizon gradient
 * hints at a game landscape; the pattern layer uses the shared dot
 * motif which reads naturally as a pixel grid.
 */
export const PIXEL_WORLD: WorldDefinition = Object.freeze({
  id: 'world.pixel',
  name: 'Pixel Quest',
  lightPalette: Object.freeze({
    ambientFrom: '#eefbf1',
    ambientTo: '#ffffff',
    accent: '#16a34a',
    accentSoft: 'rgba(22, 163, 74, 0.10)',
    glowA: 'rgba(22, 163, 74, 0.14)',
    glowB: 'rgba(132, 204, 22, 0.10)',
  }),
  darkPalette: Object.freeze({
    ambientFrom: '#0d1f14',
    ambientTo: '#14532d',
    accent: '#4ade80',
    accentSoft: 'rgba(74, 222, 128, 0.20)',
    glowA: 'rgba(74, 222, 128, 0.24)',
    glowB: 'rgba(132, 204, 22, 0.18)',
  }),
  texture: 'pattern-subtle',
  decorations: Object.freeze([
    {
      id: 'pixel-horizon',
      slot: 'horizon',
      opacity: 0.40,
      widthFraction: 1,
      heightFraction: 0.20,
    },
  ]),
  particles: Object.freeze({
    kind: 'none',
    density: 0,
  }) as WorldDefinition['particles'],
}) as WorldDefinition;

/**
 * Calm Pastel world — soft, low-stimulation surfaces for children who
 * prefer less visual intensity. No particles, no strong glows: the
 * quietest world in the catalog by design. The gentle `warm-bokeh`
 * texture keeps the world painting *something* (the "world =
 * atmosphere" contract) while staying the calmest option available.
 */
export const CALM_WORLD: WorldDefinition = Object.freeze({
  id: 'world.calm',
  name: 'Calm Pastel',
  lightPalette: Object.freeze({
    ambientFrom: '#fbf7f4',
    ambientTo: '#ffffff',
    accent: '#0d9488',
    accentSoft: 'rgba(13, 148, 136, 0.08)',
    glowA: 'rgba(13, 148, 136, 0.08)',
    glowB: 'rgba(148, 163, 184, 0.08)',
  }),
  darkPalette: Object.freeze({
    ambientFrom: '#1c1917',
    ambientTo: '#292524',
    accent: '#5eead4',
    accentSoft: 'rgba(94, 234, 212, 0.14)',
    glowA: 'rgba(94, 234, 212, 0.16)',
    glowB: 'rgba(148, 163, 184, 0.12)',
  }),
  texture: 'warm-bokeh',
  decorations: Object.freeze([]) as readonly WorldDecoration[],
  particles: Object.freeze({
    kind: 'none',
    density: 0,
  }) as WorldDefinition['particles'],
}) as WorldDefinition;

/* -------------------------------------------------------------------------- */
/* Catalog                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The full world catalog. Pure data.
 */
export const WORLD_CATALOG: readonly WorldDefinition[] = Object.freeze([
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
]);

/**
 * Map from theme id → world id. Themes already group visuals; the
 * world layer is the atmospheric expansion of a theme. The brief
 * requires the world layer to consume the resolved theme; this map
 * is the lookup the resolver uses.
 */
export const THEME_ID_TO_WORLD_ID: Readonly<Record<string, WorldId>> = Object.freeze({
  'theme.standard': 'world.normal',
  'theme.christmas': 'world.christmas',
  'theme.halloween': 'world.halloween',
  'theme.eid': 'world.eid',
  'theme.ramadan': 'world.ramadan',
  'theme.weekly.neon': 'world.neon',
  'theme.shop.neon': 'world.neon',
  'theme.shop.space': 'world.space',
  'theme.shop.rainbow': 'world.rainbow',
  'theme.shop.pixel': 'world.pixel',
  'theme.shop.calm': 'world.calm',
});

/** Look up a world by id. Returns `undefined` when unknown. */
export function getWorldById(id: WorldId | string | undefined | null): WorldDefinition | undefined {
  if (typeof id !== 'string' || id.length === 0) return undefined;
  return WORLD_CATALOG.find((world) => world.id === id);
}
