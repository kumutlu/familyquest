import { render, screen, act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '../../src/i18n/config';
import { Toast, type ToastData } from '../../src/components/ui/Toast';
import {
  composite,
  contrastRatio,
  parseUtility,
  relativeLuminance,
  resolveUtility,
  type Mode,
  type Rgb,
} from './themeTokens';

/**
 * Success-Toast accessibility — dedicated contrast regression test.
 *
 * Production defect: the success snackbar (`src/components/ui/Toast.tsx`) painted
 * its solid surface with `bg-success-500` (#22c55e) and rendered the message,
 * icon and close button in white. White on success-500 only reaches ~2.28:1 —
 * far below WCAG AA (4.5:1) for normal text — so success confirmations were
 * effectively unreadable for low-vision users.
 *
 * The surface moved to `bg-success-700` (#15803d, ~5.01:1) which keeps the green
 * success identity. A toast is a transient *surface*, not a control, so no
 * hover/active shades were introduced.
 *
 * Scope: this test owns the SUCCESS toast surface only. The dark-theme scan
 * (`darkSemanticSurfaces.test.ts`) deliberately ignores solid brand fills, and
 * `successButtonContrast.test.tsx` owns the solid success *action buttons*.
 */

const WHITE: Rgb = [255, 255, 255];
/** WCAG AA (1.4.3) for normal-size text. */
const MIN_TEXT_CONTRAST = 4.5;
/** WCAG AA (1.4.11) for icons / UI component boundaries. */
const MIN_NON_TEXT_CONTRAST = 3;
/** Max relative luminance still considered a "dark" surface in dark mode. */
const MAX_DARK_SURFACE_LUMINANCE = 0.25;

const successToast: ToastData = { id: 1, message: 'Saved!', type: 'success' };

/** Resolve a Tailwind colour class to its effective colour for a theme. */
function resolveClass(className: string, mode: Mode): Rgb {
  const ref = parseUtility(className);
  expect(ref, `${className} is not parsed as a colour utility`).not.toBeNull();
  const colour = resolveUtility(ref as NonNullable<typeof ref>, mode);
  expect(colour, `${className} has no resolved value in ${mode} mode`).not.toBeNull();
  return colour as Rgb;
}

/** The painted snackbar element (the tone-coloured child of the live region). */
function renderSuccessToast() {
  render(<Toast toast={successToast} onDismiss={() => {}} />);
  const surface = screen.getByRole('status').firstElementChild as HTMLElement;
  expect(surface, 'success toast surface not rendered').toBeTruthy();
  return surface;
}

/** Background class actually applied to the snackbar surface, e.g. `bg-success-700`. */
function surfaceBackgroundClass(surface: HTMLElement): string {
  const bg = surface.className.split(/\s+/).find((cls) => /^bg-[a-z]+-\d{2,3}$/.test(cls));
  expect(bg, `no solid background class on: ${surface.className}`).toBeDefined();
  return bg as string;
}

beforeEach(async () => {
  await i18n.loadNamespaces(['common']);
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
});

describe('success Toast — accessible solid surface', () => {
  it('paints the surface with bg-success-700 + white foreground (never bg-success-500)', () => {
    const surface = renderSuccessToast();

    expect(surface.className, `surface className: ${surface.className}`).toContain('bg-success-700');
    expect(surface.className, `surface className: ${surface.className}`).toContain('text-white');
    expect(surface.className, `surface className: ${surface.className}`).not.toContain(
      'bg-success-500',
    );
  });

  it('does not invent hover/active states for a non-interactive surface', () => {
    const surface = renderSuccessToast();
    expect(surface.className).not.toMatch(/(?:hover|active):bg-success/);
  });

  it('leaves the error and info tones untouched (change is scoped to success)', () => {
    render(<Toast toast={{ id: 2, message: 'Boom', type: 'error' }} onDismiss={() => {}} />);
    expect((screen.getByRole('status').firstElementChild as HTMLElement).className).toContain(
      'bg-danger-500',
    );
    cleanup();

    render(<Toast toast={{ id: 3, message: 'FYI', type: 'info' }} onDismiss={() => {}} />);
    expect((screen.getByRole('status').firstElementChild as HTMLElement).className).toContain(
      'bg-gray-900',
    );
  });
});

describe('success Toast — WCAG AA contrast in light and dark appearances', () => {
  it('white message text on the success toast surface clears AA in both appearances', () => {
    const background = surfaceBackgroundClass(renderSuccessToast());

    for (const mode of ['light', 'dark'] as Mode[]) {
      const surface = resolveClass(background, mode);
      const foreground = resolveClass('text-white', mode);
      expect(
        contrastRatio(foreground, surface),
        `white text on ${background} in ${mode} mode`,
      ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    }
  });

  it('keeps the success toast surface dark enough to read in the dark appearance', () => {
    document.documentElement.classList.add('dark');
    const background = surfaceBackgroundClass(renderSuccessToast());

    // A `.dark` remap of the token must never turn the solid toast into a light
    // slab under white text.
    const surface = resolveClass(background, 'dark');
    expect(
      relativeLuminance(surface),
      `${background} is too light in dark mode: rgb(${surface.join(', ')})`,
    ).toBeLessThan(MAX_DARK_SURFACE_LUMINANCE);
  });

  it('renders the same accessible classes in the dark appearance (no light-only fix)', () => {
    document.documentElement.classList.add('dark');
    const surface = renderSuccessToast();
    expect(surface.className).toContain('bg-success-700');
    expect(surface.className).toContain('text-white');
    expect(surface.className).not.toContain('bg-success-500');
  });

  it('regression guard: the old solid success-500 toast surface failed AA', () => {
    // Documents *why* the surface moved to success-700 and stops a future
    // "restore the brighter green" change from silently reintroducing the defect.
    for (const mode of ['light', 'dark'] as Mode[]) {
      expect(
        contrastRatio(WHITE, resolveClass('bg-success-500', mode)),
        `white on bg-success-500 in ${mode} mode`,
      ).toBeLessThan(MIN_TEXT_CONTRAST);
    }
  });
});

describe('success Toast — all content stays readable', () => {
  it('renders message, icon and close button inside the accessible surface', () => {
    const surface = renderSuccessToast();

    // Message/body.
    const message = screen.getByText('Saved!');
    expect(surface.contains(message)).toBe(true);

    // Status icon (decorative, inherits currentColor from the white surface text).
    const icon = surface.querySelector('svg[aria-hidden="true"]');
    expect(icon, 'success toast icon not rendered').not.toBeNull();

    // Close button (the only interactive affordance; this Toast has no title or
    // action slot, so there is nothing else to verify).
    const close = screen.getByRole('button', { name: /dismiss notification/i });
    expect(surface.contains(close)).toBe(true);
  });

  it('icon and close button clear the non-text contrast minimum at their rendered opacity', () => {
    const surface = renderSuccessToast();
    const background = surfaceBackgroundClass(surface);
    const close = screen.getByRole('button', { name: /dismiss notification/i });
    const opacityStep = /(?:^|\s)opacity-(\d+)(?:\s|$)/.exec(close.className)?.[1];
    const closeAlpha = opacityStep ? parseInt(opacityStep, 10) / 100 : 1;

    for (const mode of ['light', 'dark'] as Mode[]) {
      const painted = resolveClass(background, mode);
      const white = resolveClass('text-white', mode);

      // Icon: full-opacity currentColor.
      expect(
        contrastRatio(white, painted),
        `toast icon on ${background} in ${mode} mode`,
      ).toBeGreaterThanOrEqual(MIN_NON_TEXT_CONTRAST);

      // Close button: white glyph at its resting opacity, composited on the surface.
      expect(
        contrastRatio(composite(white, closeAlpha, painted), painted),
        `close button (opacity ${closeAlpha}) on ${background} in ${mode} mode`,
      ).toBeGreaterThanOrEqual(MIN_NON_TEXT_CONTRAST);
    }
  });
});
