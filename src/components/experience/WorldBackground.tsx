/**
 * `<WorldBackground />` — the seasonal world layer renderer.
 *
 * The component is presentation-only. It is intentionally generic:
 * it does NOT branch on `if (world === 'christmas')`. It walks the
 * declarative {@link WorldDefinition} and paints each layer.
 *
 * Layer order (back to front):
 *   1. Ambient gradient (set on the shell wrapper via --qk-world-*)
 *   2. Texture / pattern layer
 *   3. Decorative SVGs (corners, edges, horizon)
 *   4. Particles (subtle, reduced-motion aware)
 *
 * Every node in this tree is decorative:
 *   - aria-hidden="true"
 *   - pointer-events: none
 *   - no width/height impact on the parent layout
 *   - no horizontal overflow
 *
 * No asset is rendered above 18 KB. Particles cap at 24 elements.
 *
 * No XP, points, wallet, task-completion, theme-purchase writes.
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  type ResolvedWorld,
  type WorldDecoration,
  type WorldPalette,
} from '../../domain/experienceWorld/types';
import { ASSET_MANIFEST, type WorldAssetBundle } from '../../assets/worlds/manifest';
import { cn } from '../../lib/utils';

export interface WorldBackgroundProps {
  /** The resolved world bundle from `useExperienceWorld()`. */
  readonly world: ResolvedWorld;
  /** Whether the current appearance is dark (drives palette selection). */
  readonly isDark: boolean;
  /** Optional CSS class appended to the outermost wrapper. */
  readonly className?: string;
}

/* -------------------------------------------------------------------------- */
/* Asset selection                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Pick the right asset URL for a decoration. The catalog stores an
 * `asset` key like `"pine-corner"`. The manifest maps keys to URLs.
 * Returns `undefined` when no asset matches — the renderer then
 * falls back to inline SVG or pure CSS.
 */
function pickAsset(
  bundle: WorldAssetBundle | undefined,
  key: string | undefined,
): string | undefined {
  if (!bundle || !key) return undefined;
  const value = (bundle as Record<string, string | undefined>)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/* -------------------------------------------------------------------------- */
/* Decoration styling                                                         */
/* -------------------------------------------------------------------------- */

interface SlotStyle {
  readonly position: 'absolute';
  readonly pointerEvents: 'none';
  readonly zIndex: number;
  readonly width: string;
  readonly height: string;
  readonly opacity: number;
  readonly top?: string;
  readonly right?: string;
  readonly bottom?: string;
  readonly left?: string;
  readonly backgroundImage?: string;
  readonly backgroundRepeat?: string;
  readonly backgroundSize?: string;
  readonly backgroundPosition?: string;
  readonly color: string;
  readonly filter?: string;
}

function slotPosition(slot: WorldDecoration['slot']): Pick<SlotStyle, 'top' | 'right' | 'bottom' | 'left'> {
  switch (slot) {
    case 'top-left':
      return { top: '0', left: '0' };
    case 'top-right':
      return { top: '0', right: '0' };
    case 'bottom-left':
      return { bottom: '0', left: '0' };
    case 'bottom-right':
      return { bottom: '0', right: '0' };
    case 'top-edge':
      return { top: '0', left: '0' };
    case 'bottom-edge':
      return { bottom: '0', left: '0' };
    case 'horizon':
    default:
      return { bottom: '0', left: '0' };
  }
}

/**
 * Compute the inline style for a single decoration. The renderer
 * keeps the maths simple — width/height are fractions of the parent.
 */
function decorationStyle(
  decoration: WorldDecoration,
  accent: string,
  assetUrl: string | undefined,
): CSSProperties {
  const slot = slotPosition(decoration.slot);
  const opacity = typeof decoration.opacity === 'number'
    ? Math.min(1, Math.max(0, decoration.opacity))
    : 0.5;
  const widthFraction = typeof decoration.widthFraction === 'number'
    ? Math.min(1, Math.max(0, decoration.widthFraction))
    : 0.2;
  const heightFraction = typeof decoration.heightFraction === 'number'
    ? Math.min(1, Math.max(0, decoration.heightFraction))
    : 0.2;

  // For horizon-style decorations, prefer a background-image repeat so
  // the silhouette scales with the viewport. For corner pieces, use a
  // fixed-aspect block.
  const isHorizon = decoration.slot === 'horizon' || decoration.slot === 'top-edge' || decoration.slot === 'bottom-edge';
  if (isHorizon && assetUrl) {
    return {
      position: 'absolute',
      pointerEvents: 'none',
      top: slot.top,
      left: slot.left,
      right: decoration.slot === 'horizon' || decoration.slot === 'bottom-edge' ? '0' : undefined,
      bottom: slot.bottom,
      width: decoration.slot === 'horizon' || decoration.slot === 'bottom-edge'
        ? '100%'
        : `${widthFraction * 100}%`,
      height: `${heightFraction * 100}%`,
      opacity,
      backgroundImage: `url(${assetUrl})`,
      backgroundRepeat: decoration.slot === 'horizon' ? 'no-repeat' : 'repeat-x',
      backgroundSize: decoration.slot === 'horizon' ? '100% 100%' : 'auto 100%',
      backgroundPosition: 'center bottom',
      color: accent,
    };
  }

  return {
    position: 'absolute',
    pointerEvents: 'none',
    top: slot.top,
    left: slot.left,
    right: slot.right,
    bottom: slot.bottom,
    width: `${widthFraction * 100}%`,
    height: `${heightFraction * 100}%`,
    opacity,
    color: accent,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
  };
}

/* -------------------------------------------------------------------------- */
/* Particles                                                                  */
/* -------------------------------------------------------------------------- */

interface ParticleSeed {
  readonly left: number;     // 0..1 of viewport width
  readonly delay: number;    // seconds
  readonly duration: number; // seconds
  readonly size: number;     // pixels
  readonly drift: number;    // 0..1 of viewport height
  readonly kind: 'sparkle' | 'snow' | 'fog-mote' | 'gold-dust' | 'star-twinkle';
}

/**
 * Cap particles so the world never becomes a particle engine.
 * Brief: "no permanent high-FPS particle engine" and "subtle".
 */
const MAX_PARTICLES = 24;

function generateParticles(
  world: ResolvedWorld,
  seed: number,
): ParticleSeed[] {
  const { particles } = world.definition;
  if (particles.kind === 'none') return [];
  const density = Math.max(0, Math.min(1, particles.density));
  const count = Math.min(MAX_PARTICLES, Math.round(density * MAX_PARTICLES));
  const out: ParticleSeed[] = [];
  for (let i = 0; i < count; i++) {
    // Deterministic seed so the same world renders the same particles
    // on the server and the client (test-friendly).
    const r = ((seed * 9301 + 49297 + i * 233) % 233280) / 233280;
    const r2 = ((seed * 7919 + i * 31337) % 233280) / 233280;
    const r3 = ((seed * 1601 + i * 499) % 233280) / 233280;
    const r4 = ((seed * 1013 + i * 101) % 233280) / 233280;
    out.push({
      left: r,
      delay: r2 * 6,
      duration: 6 + r3 * 6,
      size: 2 + r4 * 4,
      drift: particles.drift ?? 0.6,
      kind: particles.kind,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Texture class                                                              */
/* -------------------------------------------------------------------------- */

function textureClass(texture: string | undefined): string {
  switch (texture) {
    case 'starlight':
      return 'qk-world-texture--starlight';
    case 'snow':
      return 'qk-world-texture--snow';
    case 'fog':
      return 'qk-world-texture--fog';
    case 'warm-bokeh':
      return 'qk-world-texture--warm-bokeh';
    case 'pattern-subtle':
      return 'qk-world-texture--pattern-subtle';
    case 'none':
    default:
      return 'qk-world-texture--none';
  }
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Render the world layer. Generic — no `if (world === ...)` branching.
 */
export function WorldBackground({ world, isDark, className }: WorldBackgroundProps) {
  const definition = world.definition;
  const palette: WorldPalette = isDark ? definition.darkPalette : definition.lightPalette;
  const bundle = ASSET_MANIFEST[definition.id];

  // Reduced motion is hydration-sensitive; mount-time check is enough
  // for the static preview fixtures, and we listen to changes so a
  // user toggling the OS setting sees the world update.
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReducedMotion(mql.matches);
    apply();
    mql.addEventListener?.('change', apply);
    return () => mql.removeEventListener?.('change', apply);
  }, []);

  // Seed particles from the world id so the same world renders the
  // same particles on every mount.
  const seed = useMemo(() => {
    let s = 0;
    for (let i = 0; i < definition.id.length; i++) s = (s * 31 + definition.id.charCodeAt(i)) | 0;
    return Math.abs(s) || 1;
  }, [definition.id]);

  const particles = useMemo(() => generateParticles(world, seed), [world, seed]);

  // The token style is applied to a wrapper so CSS variables cascade
  // to all child layers. Tokens are the only way the renderer touches
  // colour — components never read these tokens.
  const tokensStyle: CSSProperties = useMemo(() => ({
    '--qk-world-from': palette.ambientFrom,
    '--qk-world-to': palette.ambientTo,
    '--qk-world-mid': palette.accentSoft,
    '--qk-world-glow-a': palette.glowA,
    '--qk-world-glow-b': palette.glowB,
    '--qk-world-accent': palette.accent,
  } as CSSProperties), [palette]);

  // World identifier for QA / tests.
  const worldTestId = `world-background-${definition.id.replace(/\./g, '-')}`;

  // Partition decorations: skip those marked for the other breakpoint.
  // We do responsive selection with a media query class on the
  // wrapper — CSS hides the rest.
  return (
    <div
      data-testid={worldTestId}
      data-world-id={definition.id}
      data-world-source={world.source}
      data-world-texture={definition.texture ?? 'none'}
      className={cn(
        'qk-world-background pointer-events-none absolute inset-0 overflow-hidden',
        className,
      )}
      style={tokensStyle}
      aria-hidden="true"
    >
      {/* Texture / pattern layer -------------------------------------- */}
      <div
        data-testid="world-texture"
        aria-hidden="true"
        className={cn(
          'qk-world-texture pointer-events-none absolute inset-0',
          textureClass(definition.texture),
        )}
      />

      {/* Decorations --------------------------------------------------- */}
      {definition.decorations.map((decoration) => {
        const assetKey = decoration.asset;
        const assetUrl = pickAsset(bundle, assetKey);
        // CSS-only decoration (e.g. halloween moon). Render as a
        // styled circle.
        if (!assetUrl && !decoration.inlineSvg) {
          return (
            <div
              key={decoration.id}
              data-testid={`world-decoration-${decoration.id}`}
              data-decoration-slot={decoration.slot}
              className={cn(
                'qk-world-decoration pointer-events-none absolute',
                decoration.slot === 'top-right' ? 'qk-world-moon' : '',
                decoration.desktopOnly ? 'qk-world-desktop-only' : '',
                decoration.mobileOnly ? 'qk-world-mobile-only' : '',
              )}
              style={decorationStyle(decoration, palette.accent, undefined)}
            />
          );
        }
        return (
          <div
            key={decoration.id}
            data-testid={`world-decoration-${decoration.id}`}
            data-decoration-slot={decoration.slot}
            data-decoration-asset={assetUrl ? 'image' : 'inline'}
            className={cn(
              'qk-world-decoration pointer-events-none absolute',
              decoration.desktopOnly ? 'qk-world-desktop-only' : '',
              decoration.mobileOnly ? 'qk-world-mobile-only' : '',
            )}
            style={decorationStyle(decoration, palette.accent, assetUrl)}
          >
            {assetUrl ? (
              <img
                src={assetUrl}
                alt=""
                aria-hidden="true"
                draggable={false}
                className="qk-world-decoration-img pointer-events-none h-full w-full"
                style={{ color: palette.accent }}
              />
            ) : (
              <span
                className="qk-world-decoration-inline pointer-events-none block h-full w-full"
                style={{ color: palette.accent }}
                // The markup is a tiny, project-owned inline SVG. It
                // contains no script, no remote refs, no user data.
                dangerouslySetInnerHTML={{ __html: decoration.inlineSvg ?? '' }}
              />
            )}
          </div>
        );
      })}

      {/* Particles ----------------------------------------------------- */}
      {particles.length > 0 && !reducedMotion ? (
        <div
          data-testid="world-particles"
          data-particle-kind={definition.particles.kind}
          className="qk-world-particles pointer-events-none absolute inset-0"
          aria-hidden="true"
        >
          {particles.map((p, idx) => (
            <span
              key={idx}
              data-testid={`world-particle-${idx}`}
              className={cn(
                'qk-world-particle pointer-events-none absolute',
                `qk-world-particle--${p.kind}`,
              )}
              style={{
                left: `${p.left * 100}%`,
                width: `${p.size}px`,
                height: `${p.size}px`,
                animationDelay: `${p.delay}s`,
                animationDuration: `${p.duration}s`,
                color: palette.accent,
                // Drift distance is exposed to CSS so the @keyframes
                // can be a single reusable rule.
                ['--qk-particle-drift' as string]: `${p.drift * 100}%`,
              } as CSSProperties}
            />
          ))}
        </div>
      ) : null}

      {/* Static particles (reduced motion): same layout, no animation. */}
      {particles.length > 0 && reducedMotion ? (
        <div
          data-testid="world-particles-static"
          data-particle-kind={definition.particles.kind}
          className="qk-world-particles qk-world-particles--static pointer-events-none absolute inset-0"
          aria-hidden="true"
        >
          {particles.map((p, idx) => (
            <span
              key={idx}
              data-testid={`world-particle-static-${idx}`}
              className={cn(
                'qk-world-particle qk-world-particle--static pointer-events-none absolute',
                `qk-world-particle--${p.kind}`,
              )}
              style={{
                left: `${p.left * 100}%`,
                top: `${(p.delay / 6) * 100}%`,
                width: `${p.size}px`,
                height: `${p.size}px`,
                color: palette.accent,
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default WorldBackground;
