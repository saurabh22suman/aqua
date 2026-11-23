import { THEMES, type ThemeDefinition, type ThemeId } from "./themes";

// Owner redesign — courtside appearance names.
//
// The Owner surfaces call the three approved presets by their courtside
// names. This is a LABEL layer only:
//
//   mint     → Court Blue
//   lavender → Clay Season
//   dark     → Floodlights
//
// The preset ids, the `aqua_theme` cookie, the ThemeProvider context and
// the `<html data-theme>` attribute stay exactly as they are, so a device
// that chose "Court Blue" still stores and resolves `mint` through the
// same validated enum and the same fallback. Nothing here reads a
// session, a tenant or a permission.
//
// Non-Owner surfaces keep the foundation names: `courtside` defaults to
// false, so existing callers and tests see no change.

export const COURTSIDE_THEMES: Record<ThemeId, ThemeDefinition> = {
  mint: {
    id: "mint",
    label: "Court Blue",
    description: "Warm white surfaces with court-blue actions.",
  },
  lavender: {
    id: "lavender",
    label: "Clay Season",
    description: "Clay-warm surfaces with rich terracotta actions.",
  },
  dark: {
    id: "dark",
    label: "Floodlights",
    description: "Night-court surfaces under warm floodlight.",
  },
};

/**
 * The preset's display definition: courtside names on Owner surfaces,
 * the foundation names everywhere else.
 */
export function themeDefinition(
  theme: ThemeId,
  courtside = false,
): ThemeDefinition {
  return courtside ? COURTSIDE_THEMES[theme] : THEMES[theme];
}
