import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Onboarding light-override CSS contract (static, no browser required).
 *
 * Onboarding is a public, pre-auth surface rendered inside <html>. When the
 * persisted appearance is dark (or the OS prefers dark) the global `.dark`
 * token remap in `src/index.css` cascades to every descendant of <html>, so the
 * onboarding subtree would inherit dark styling. The fix scopes a `.light`
 * override to the onboarding root (see src/onboarding/components/
 * OnboardingShell.tsx and the BoundedLoading state in
 * src/onboarding/OnboardingFlow.tsx). This test pins the exact CSS rules that
 * make that override real: the `.light` scope must reset the dark neutral
 * token remap and neutralize the explicit `.dark .<utility>` overrides.
 *
 * It is presentation-only: it does not touch the appearance store,
 * localStorage, or the document-level `dark` class, so an authenticated user's
 * Light/Dark/System preference is unaffected once they leave onboarding.
 */
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

describe('onboarding light override — CSS contract', () => {
  it('defines a .light scope that resets the dark neutral token remap to light defaults', () => {
    expect(css).toMatch(/\.light\s*\{[^}]*--color-gray-50\s*:\s*#f9fafb/);
    expect(css).toMatch(/\.light\s*\{[^}]*--color-gray-900\s*:\s*#111827/);
    expect(css).toMatch(/\.light\s*\{[^}]*--color-amber-50\s*:\s*#fffbeb/);
    expect(css).toMatch(/\.light\s*\{[^}]*--color-primary-50\s*:\s*#eef2ff/);
  });

  it('neutralizes the explicit .dark .bg-white override inside .light', () => {
    expect(css).toMatch(/\.light\s+\.bg-white\s*\{\s*background-color:\s*#ffffff/);
  });

  it('neutralizes the explicit .dark .text-gray-900 override inside .light', () => {
    expect(css).toMatch(/\.light\s+\.text-gray-900\s*\{\s*color:\s*#111827/);
  });

  it('does not delete or overwrite the global .dark rules (only adds a scoped .light override)', () => {
    // The global dark theme must remain intact for the authenticated app.
    expect(css).toMatch(/\.dark\s*\{[^}]*--color-gray-50\s*:\s*#0e1116/);
    expect(css).toMatch(/\.dark\s+\.bg-white\s*\{\s*background-color:\s*#1b212b/);
  });

  it('pins a dark inherited text colour on the .light scope (root cause of the white-on-white input bug)', () => {
    // Without this, `.dark body { color: #f1f5f9 }` inherits into the onboarding
    // subtree and form controls render near-white text on a light input.
    expect(css).toMatch(/\.light\s*\{[^}]*color:\s*var\(--color-gray-900\)/);
  });
});

describe('onboarding light override — form-control contract', () => {
  it('guarantees a light background and dark entered text for inputs under global dark mode', () => {
    expect(css).toMatch(/\.light\s+input[^{]*\{[^}]*background-color:\s*#ffffff/);
    expect(css).toMatch(/\.light\s+input[^{]*\{[^}]*color:\s*#111827/);
    expect(css).toMatch(/\.light\s+input[^{]*\{[^}]*caret-color:\s*#111827/);
  });

  it('keeps placeholders muted but visible (visually secondary, not invisible)', () => {
    expect(css).toMatch(/\.light\s+input::placeholder[^{]*\{[^}]*color:\s*#6b7280/);
  });

  it('keeps disabled controls visually distinct', () => {
    expect(css).toMatch(/\.light\s+input:disabled[^{]*\{[^}]*background-color:\s*#f3f4f6/);
    expect(css).toMatch(/\.light\s+input:disabled[^{]*\{[^}]*color:\s*#9ca3af/);
  });

  it('applies the same contract to textarea and select controls', () => {
    expect(css).toMatch(/\.light\s+textarea[^{]*\{[^}]*color:\s*#111827/);
    expect(css).toMatch(/\.light\s+select[^{]*\{[^}]*color:\s*#111827/);
  });
});
