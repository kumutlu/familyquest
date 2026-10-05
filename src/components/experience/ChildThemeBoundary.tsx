/**
 * <ChildThemeBoundary /> — the SINGLE persistent theme host for the child app.
 *
 * The problem this solves
 * ----------------------
 * A theme was applied by whichever page remembered to mount
 * `ChildExperienceShell`. Only Home and the Theme Shop did, so choosing Space
 * Explorer and tapping "Quests" dropped the child back onto the neutral
 * lavender app. The theme did not "fail" — it was simply never mounted on that
 * route. A theme that only exists on one screen is not a theme.
 *
 * What this is
 * ------------
 * The highest child-only junction in the router: it sits in `AppLayout`
 * directly above `<Outlet />` and wraps EVERY child route, so the resolved
 * world, its painted plate and its token scope persist across navigation
 * instead of being torn down and rebuilt per page:
 *
 *     AppLayout (role-gated)
 *       └── ChildThemeBoundary          ← one resolve, one shell, one plate
 *             └── ChildExperienceShell
 *                   ├── world plate + ambient + pattern  (painted ONCE)
 *                   └── <Outlet />  → Home · Quests · Rewards · Goals · More
 *                                     · Theme Shop · Wallet · History · sheets
 *
 * Boundaries it respects
 * ----------------------
 *   - CHILD ONLY. Parents, owners, admins, auth and onboarding screens are
 *     never wrapped; a parent never sees a child's world.
 *   - It is not a redesign. It adds no layout, no navigation and no data — it
 *     is the existing shell promoted from page-local to layout-level.
 *   - The theme is read through the one authorised hook (`useExperienceTheme`),
 *     so precedence, the Theme of the Week promotion and child equip rights
 *     all keep working exactly as before.
 *
 * Portals
 * -------
 * Child sheets (`BottomSheet`, `MysteryReveal`) render through
 * `createPortal` onto `document.body`, which is OUTSIDE this subtree and would
 * otherwise lose the theme. The boundary therefore mirrors the theme id and its
 * accent onto `<html>` for as long as a child surface is mounted, and removes
 * them on unmount so no parent screen can inherit a child's world.
 */

import { useEffect, useMemo } from 'react';
import { Outlet } from 'react-router-dom';
import { ChildExperienceShell } from './ChildExperienceShell';
import { useExperienceTheme } from '../../hooks/useExperienceTheme';
import { useMascotPresentation } from '../../hooks/useMascotPresentation';
import { validThemeTokens, type ResolvedExperienceTheme } from '../../domain/experience';
import { useThemePreviewOverride } from '../../domain/experience/themePreviewOverride';
import {
  NEUTRAL_PERSONALITY,
  PERSONALITY_ATTRIBUTES,
  PERSONALITY_CUSTOM_PROPERTIES,
  themePersonalityAttributes,
  themePersonalityCustomProperties,
  validThemePersonality,
} from '../../domain/experience/themePersonality';

/** Custom properties mirrored onto `<html>` so portaled sheets stay themed. */
const PORTAL_TOKENS = ['--qk-theme-accent', '--qk-theme-accent-soft'] as const;

export function ChildThemeBoundary() {
  // One resolve for the whole child app. Every route below reads the same
  // world; nothing re-derives eligibility per page.
  const equipped = useExperienceTheme();
  const mascotPresentation = useMascotPresentation();

  // The Theme Shop publishes the world it is previewing. When nothing is
  // published this is `null` and the child's real theme is used unchanged.
  const preview = useThemePreviewOverride();

  const resolvedTheme = useMemo<ResolvedExperienceTheme | null>(
    () => preview ?? equipped ?? null,
    [preview, equipped],
  );

  const themeId = resolvedTheme?.theme?.id ?? null;

  // The non-colour personality for this world. The app chrome and every
  // portaled sheet live OUTSIDE the shell subtree, so they need the same bundle
  // mirrored onto <html> — otherwise a sheet opened over Neon Arcade would
  // suddenly render with Classic's flat surfaces and radius.
  const personality =
    validThemePersonality(resolvedTheme?.theme?.personality) ?? NEUTRAL_PERSONALITY;

  // Mirror the theme onto <html> so portaled sheets inherit it.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const tokens = validThemeTokens(resolvedTheme?.theme?.tokens);
    const applied: string[] = [];

    if (themeId) {
      root.setAttribute('data-child-theme', themeId);
      applied.push('data-child-theme');
    }

    if (tokens) {
      root.style.setProperty('--qk-theme-accent', tokens.accent);
      applied.push(PORTAL_TOKENS[0]);
      if (tokens.accentSoft) {
        root.style.setProperty('--qk-theme-accent-soft', tokens.accentSoft);
        applied.push(PORTAL_TOKENS[1]);
      }
    }

    // Personality: same mirroring discipline as the accent, including cleanup.
    // Removing these on unmount is what stops a parent screen from inheriting a
    // child's glass surfaces once the child route is left.
    for (const [property, value] of Object.entries(
      themePersonalityCustomProperties(personality),
    )) {
      root.style.setProperty(property, value);
      applied.push(property);
    }
    for (const [attribute, value] of Object.entries(themePersonalityAttributes(personality))) {
      root.setAttribute(attribute, value);
      applied.push(attribute);
    }

    return () => {
      if (applied.includes('data-child-theme')) root.removeAttribute('data-child-theme');
      for (const property of PORTAL_TOKENS) {
        if (applied.includes(property)) root.style.removeProperty(property);
      }
      for (const property of PERSONALITY_CUSTOM_PROPERTIES) {
        if (applied.includes(property)) root.style.removeProperty(property);
      }
      for (const attribute of PERSONALITY_ATTRIBUTES) {
        if (applied.includes(attribute)) root.removeAttribute(attribute);
      }
    };
  }, [themeId, resolvedTheme, personality]);

  return (
    <ChildExperienceShell
      resolvedTheme={resolvedTheme}
      mascotPresentation={mascotPresentation.presentation}
      // `.qk-child-theme` + `data-child-theme` land on the shell's own element,
      // which is also where the inline `--qk-theme-accent` lives — so the
      // theme-derived surface ladder resolves against the right accent.
      className="qk-child-theme"
      dataChildTheme={themeId}
    >
      <div data-testid="child-theme-route-outlet" className="contents">
        <Outlet />
      </div>
    </ChildExperienceShell>
  );
}

export default ChildThemeBoundary;
