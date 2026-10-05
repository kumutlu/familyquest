/**
 * `<WorldPlate />` — the painted theme world.
 *
 * Renders the RECOVERED Queki World System V2 environment plate for a theme:
 * a real, full-bleed painted world served as AVIF → WebP → JPEG at four
 * authored breakpoints. This is the artwork the Theme Shop and the child Home
 * were always meant to show; it is not generated, tinted or approximated
 * here.
 *
 * Presentation-only contract (identical to `<WorldBackground />`):
 *   - `aria-hidden`, `pointer-events: none`, decorative in the a11y tree
 *   - never changes layout dimensions (the host owns the box)
 *   - paints an authored fallback colour before the image decodes, so
 *     entering a theme never flashes white
 *   - degrades to the fallback colour alone when a plate is missing, rather
 *     than throwing or leaving a hole in the design
 *
 * No XP, points, wallet, task or theme-purchase writes.
 */

import { useState, type CSSProperties } from 'react';
import { getThemePlate } from '../../domain/experience/themePlate';
import type { WorldPlate as WorldPlateArt } from '../../assets/worlds/plates';
import { cn } from '../../lib/utils';
import './worldPlate.css';

export interface WorldPlateProps {
  /** Theme whose painted world should be painted. */
  readonly themeId: string | null | undefined;
  /**
   * Optional explicit plate (used by the shop to preview a theme the child
   * has not equipped yet — the plate is decided by the same map either way).
   */
  readonly plate?: WorldPlateArt | undefined;
  /**
   * `'backdrop'` = behind every content surface, all breakpoints.
   * `'card'` = a cropped hero inside a bordered card.
   */
  readonly variant?: 'backdrop' | 'card';
  /** Extra classes for the wrapper (sizing/rounding live with the host). */
  readonly className?: string;
  /**
   * Darken the artwork so overlaid copy keeps its contrast. The card shows no
   * copy on top of the art, so only the backdrop needs it.
   */
  readonly scrim?: boolean;
}

export function WorldPlate({
  themeId,
  plate,
  variant = 'backdrop',
  className,
  scrim = false,
}: WorldPlateProps) {
  const [failed, setFailed] = useState(false);
  const art = plate ?? getThemePlate(themeId);

  // No authored world for this theme (e.g. a future theme) — render nothing
  // rather than a fake placeholder. The token world behind this layer is the
  // legitimate fallback.
  if (!art) return null;

  const { variants } = art;
  const wrapperStyle: CSSProperties = {
    backgroundColor: art.fallbackColor,
    ...(variant === 'card' ? { ['--qk-plate-accent' as string]: art.accent } : {}),
  };

  return (
    <div
      data-testid={`world-plate-${art.id.replace(/\./g, '-')}`}
      data-plate-id={art.id}
      data-plate-variant={variant}
      data-plate-status={failed ? 'fallback' : 'ready'}
      aria-hidden="true"
      className={cn(
        'qk-world-plate pointer-events-none overflow-hidden',
        variant === 'backdrop' ? 'absolute inset-0' : 'relative h-full w-full',
        className,
      )}
      style={wrapperStyle}
    >
      {!failed ? (
        <picture>
          {/* Desktop — the widest authored plate. */}
          <source media="(min-width: 1100px)" type="image/avif" srcSet={variants.desktop.avif} />
          <source media="(min-width: 1100px)" type="image/webp" srcSet={variants.desktop.webp} />
          {/* Landscape tablets — the plate is authored landscape-first, so an
              orientation check keeps the horizon level on tablets. */}
          <source
            media="(min-width: 820px) and (orientation: landscape)"
            type="image/avif"
            srcSet={variants.tabletLandscape.avif}
          />
          <source
            media="(min-width: 820px) and (orientation: landscape)"
            type="image/webp"
            srcSet={variants.tabletLandscape.webp}
          />
          <source media="(min-width: 600px)" type="image/avif" srcSet={variants.tabletPortrait.avif} />
          <source media="(min-width: 600px)" type="image/webp" srcSet={variants.tabletPortrait.webp} />
          <source type="image/avif" srcSet={variants.mobile.avif} />
          <source type="image/webp" srcSet={variants.mobile.webp} />
          <img
            className="qk-world-plate__image h-full w-full object-cover"
            src={variants.desktop.jpg}
            width={variants.mobile.width}
            height={variants.mobile.height}
            alt=""
            decoding="async"
            draggable={false}
            onError={() => setFailed(true)}
          />
        </picture>
      ) : null}

      {/* Authored accent glow — keeps the plate and the token layer in the
          same colour family without recolouring the artwork itself. */}
      <div
        className="qk-world-plate__glow absolute inset-0"
        style={{
          background: `radial-gradient(120% 80% at 50% 115%, ${art.accent}40 0%, transparent 62%)`,
        }}
      />

      {scrim ? <div data-testid="world-plate-scrim" className="qk-world-plate__scrim absolute inset-0" /> : null}
    </div>
  );
}

export default WorldPlate;
