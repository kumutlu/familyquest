/**
 * `<WorldPlate />` — the painted theme world renderer.
 *
 * Pins the contract that makes the recovered artwork safe to put behind every
 * child surface:
 *
 *   - it renders the AUTHORED plate for a theme (real asset URLs, responsive
 *     sources down to a JPEG fallback) — not a generated or tinted rectangle
 *   - it is decorative: `aria-hidden`, `pointer-events: none`
 *   - a theme with no authored world renders NOTHING, so the token world stays
 *     the legitimate fallback instead of a fake placeholder
 *   - a broken asset degrades to the authored fallback colour
 *   - it writes nothing: no points, no purchases, no theme state
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorldPlate } from './WorldPlate';
import { getThemePlate } from '../../domain/experience/themePlate';
import { getWorldPlate } from '../../assets/worlds/plates';

describe('WorldPlate', () => {
  it('renders the authored artwork for an equipped shop theme', () => {
    render(<WorldPlate themeId="theme.shop.space" />);

    const plate = screen.getByTestId('world-plate-world-space-explorer');
    expect(plate).toHaveAttribute('data-plate-id', 'world.space-explorer');
    expect(plate).toHaveAttribute('data-plate-status', 'ready');

    // Real exported assets, at the authored breakpoints.
    const img = plate.querySelector('img')!;
    expect(img.getAttribute('src')).toMatch(/space-explorer\/desktop\.jpg$/);
    const avifSources = plate.querySelectorAll('source[type="image/avif"]');
    expect(avifSources.length).toBeGreaterThanOrEqual(4);
    expect(avifSources[0].getAttribute('srcset')).toMatch(/space-explorer\/.*\.avif$/);
    const webpSources = plate.querySelectorAll('source[type="image/webp"]');
    expect(webpSources.length).toBeGreaterThanOrEqual(4);
  });

  it('paints the authored fallback colour so entering a theme never flashes white', () => {
    const art = getWorldPlate('world.candy-kingdom')!;
    render(<WorldPlate themeId="theme.shop.rainbow" />);
    const plate = screen.getByTestId('world-plate-world-candy-kingdom');
    expect(plate.style.backgroundColor).toBeTruthy();
    expect(art.fallbackColor).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('is decorative and never intercepts input', () => {
    render(<WorldPlate themeId="theme.shop.neon" />);
    const plate = screen.getByTestId('world-plate-world-neon-city');
    expect(plate).toHaveAttribute('aria-hidden', 'true');
    expect(plate.className).toContain('pointer-events-none');
    // The image inside carries an empty alt so it is not announced.
    expect(plate.querySelector('img')).toHaveAttribute('alt', '');
  });

  it('renders nothing for a theme with no authored world (token world is the fallback)', () => {
    const { container } = render(<WorldPlate themeId="theme.not-authored" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for an absent theme', () => {
    const { container } = render(<WorldPlate themeId={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('adds the readability scrim only when asked', () => {
    const { rerender } = render(<WorldPlate themeId="theme.shop.calm" scrim />);
    expect(screen.getByTestId('world-plate-scrim')).toBeInTheDocument();

    rerender(<WorldPlate themeId="theme.shop.calm" />);
    expect(screen.queryByTestId('world-plate-scrim')).not.toBeInTheDocument();
  });

  it('degrades to the fallback colour when the artwork fails to load', () => {
    render(<WorldPlate themeId="theme.shop.pixel" />);
    const plate = screen.getByTestId('world-plate-world-dino-jungle');
    fireEvent.error(plate.querySelector('img')!);
    expect(plate).toHaveAttribute('data-plate-status', 'fallback');
    // The painted colour stays behind the broken image, so no hole appears.
    expect(plate.querySelector('img')).toBeNull();
    expect(plate.style.backgroundColor).toBeTruthy();
  });

  it('accepts an explicit plate so the shop can preview an unequipped theme', () => {
    const art = getThemePlate('theme.shop.calm')!;
    render(<WorldPlate themeId={null} plate={art} variant="card" />);
    const plate = screen.getByTestId('world-plate-world-underwater');
    expect(plate).toHaveAttribute('data-plate-variant', 'card');
  });

  it('performs no writes at all (presentation only)', () => {
    // A guard against anyone wiring points/theme state into the art layer.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(''));
    render(<WorldPlate themeId="theme.shop.neon" />);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
